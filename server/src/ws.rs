use std::{
    sync::OnceLock,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use koko_contract::{
    ClientRealtimeCommand, ClientRealtimeQuery, RoomMemberResponse, ServerRealtimeEvent,
};
use koko_core::model::{ProfileId, RoomCode, RoomId};
use socketioxide::{
    SocketIo,
    extract::{Data, Extension, SocketRef, State as SocketState},
    handler::ConnectHandler,
};
use uuid::Uuid;

use crate::{
    app::AppState,
    http::{
        ApiError, map_domain_error, map_list_messages_error, message_to_response,
        normalize_message_page_limit, parse_optional_message_id, role_name,
    },
    message_repo::PostgresMessageRepository,
    room_repo::PostgresRoomRepository,
    session,
};

const SOCKET_IO_EVENT_NAME: &str = "event";
const SOCKET_IO_COMMAND_NAME: &str = "command";
const SOCKET_IO_QUERY_NAME: &str = "query";
const SOCKET_IO_ERROR_NAME: &str = "error";
const DEFAULT_SNAPSHOT_LIMIT: Option<u16> = Some(40);

#[derive(Clone, Default)]
pub struct RealtimeHub {
    socket_io: Arc<OnceLock<SocketIo>>,
    online_connections: Arc<AtomicUsize>,
}

impl RealtimeHub {
    pub fn attach_socket_io(&self, io: SocketIo) {
        self.socket_io
            .set(io)
            .expect("同一个 RealtimeHub 不应重复绑定多套 socket.io 应用");
    }

    pub(crate) async fn publish(&self, room_id: RoomId, event: ServerRealtimeEvent) {
        if let Some(io) = self.socket_io.get().cloned() {
            let _ = io
                .to(socket_room_name(room_id))
                .emit(SOCKET_IO_EVENT_NAME, &event)
                .await;
        }
    }

    pub(crate) async fn evict_profile_from_room(&self, profile_id: ProfileId, room_id: RoomId) {
        if let Some(io) = self.socket_io.get().cloned() {
            let _ = io
                .within(profile_room_name(profile_id))
                .leave(socket_room_name(room_id))
                .await;
        }
    }

    pub(crate) fn online_connections(&self) -> u64 {
        self.online_connections.load(Ordering::Relaxed) as u64
    }

    pub(crate) fn connection_opened(&self) {
        self.online_connections.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn connection_closed(&self) {
        self.online_connections.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone)]
struct SocketSession {
    profile_id: ProfileId,
    initial_room_id: Option<RoomId>,
    joined_room_id: Arc<Mutex<Option<RoomId>>>,
}

impl SocketSession {
    fn new(profile_id: ProfileId, initial_room_id: Option<RoomId>) -> Self {
        Self {
            profile_id,
            initial_room_id,
            joined_room_id: Arc::new(Mutex::new(None)),
        }
    }

    fn initial_room_id(&self) -> Option<RoomId> {
        self.initial_room_id
    }

    fn room_id(&self) -> Option<RoomId> {
        *self.joined_room_id.lock().unwrap()
    }

    fn clear_room_id(&self) {
        *self.joined_room_id.lock().unwrap() = None;
    }

    fn activate_room(&self, room_id: RoomId) {
        let mut guard = self.joined_room_id.lock().unwrap();
        *guard = Some(room_id);
    }
}

#[derive(Debug, serde::Deserialize)]
struct SocketIoAuth {
    session_id: String,
    room_id: Option<String>,
}

pub(crate) fn configure_socket_io(io: &SocketIo) {
    io.ns("/", on_socket_io_connection.with(authenticate_socket_io));
}

async fn authenticate_socket_io(
    socket: SocketRef,
    Data(auth): Data<SocketIoAuth>,
    SocketState(state): SocketState<AppState>,
) -> Result<(), String> {
    let session = session::authenticate_session(&state.pool, &auth.session_id)
        .await
        .map_err(|_| "会话认证无效".to_owned())?;
    let room_id = auth
        .room_id
        .as_deref()
        .map(parse_room_id)
        .transpose()
        .map_err(|_| "room_id 不合法".to_owned())?;

    socket
        .extensions
        .insert(Arc::new(SocketSession::new(session.profile_id, room_id)));

    Ok(())
}

async fn on_socket_io_connection(
    socket: SocketRef,
    Extension(session): Extension<Arc<SocketSession>>,
    SocketState(state): SocketState<AppState>,
) {
    state.online_connection_opened();
    socket.join(profile_room_name(session.profile_id));

    if let Some(room_id) = session.initial_room_id() {
        if let Err(error) = emit_room_snapshot(
            &socket,
            &state,
            &session,
            room_id,
            SnapshotQuery::Recent {
                limit: DEFAULT_SNAPSHOT_LIMIT,
            },
        )
        .await
        {
            emit_socket_error(&socket, error.message());
            let _ = socket.disconnect();
            state.online_connection_closed();
            return;
        }
    }

    socket.on(SOCKET_IO_COMMAND_NAME, on_socket_io_command);
    socket.on(SOCKET_IO_QUERY_NAME, on_socket_io_query);
    socket.on_disconnect(
        async |Extension(session): Extension<Arc<SocketSession>>,
               SocketState(state): SocketState<AppState>| {
            let _ = session;
            state.online_connection_closed();
        },
    );
}

async fn on_socket_io_command(
    socket: SocketRef,
    Data(command): Data<ClientRealtimeCommand>,
    Extension(session): Extension<Arc<SocketSession>>,
    SocketState(state): SocketState<AppState>,
) {
    match command {
        ClientRealtimeCommand::JoinRoom { code } => {
            match resolve_socket_room_by_code(&state, &session, &code).await {
                Ok(room_id) => {
                    if let Err(error) = emit_room_snapshot(
                        &socket,
                        &state,
                        &session,
                        room_id,
                        SnapshotQuery::Recent {
                            limit: DEFAULT_SNAPSHOT_LIMIT,
                        },
                    )
                    .await
                    {
                        emit_socket_error(&socket, error.message());
                    }
                }
                Err(error) => emit_socket_error(&socket, error.message()),
            }
        }
        ClientRealtimeCommand::SendMessage { content } => {
            let Some(room_id) = session.room_id() else {
                emit_socket_error(&socket, "尚未加入房间");
                return;
            };

            match send_message_event(&state, room_id, session.profile_id, &content).await {
                Ok(event) => state.realtime.publish(room_id, event).await,
                Err(error) => emit_socket_error(&socket, error.message()),
            }
        }
    }
}

async fn on_socket_io_query(
    socket: SocketRef,
    Data(query): Data<ClientRealtimeQuery>,
    Extension(session): Extension<Arc<SocketSession>>,
    SocketState(state): SocketState<AppState>,
) {
    let Some(room_id) = session.room_id() else {
        emit_socket_error(&socket, "尚未加入房间");
        return;
    };

    let snapshot_query = match query {
        ClientRealtimeQuery::LoadRecentMessages { limit } => SnapshotQuery::Recent { limit },
        ClientRealtimeQuery::LoadOlderMessages {
            before_message_id,
            limit,
        } => SnapshotQuery::Older {
            before_message_id,
            limit,
        },
    };

    if let Err(error) = emit_room_snapshot(&socket, &state, &session, room_id, snapshot_query).await
    {
        emit_socket_error(&socket, error.message());
    }
}

async fn resolve_socket_room_by_code(
    state: &AppState,
    session: &SocketSession,
    code: &str,
) -> Result<RoomId, ApiError> {
    let code = RoomCode::parse(code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let result = koko_core::room::join_or_create_room(&room_repo, session.profile_id, code)
        .await
        .map_err(map_domain_error)?;

    Ok(result.room.id)
}

async fn emit_room_snapshot(
    socket: &SocketRef,
    state: &AppState,
    session: &SocketSession,
    room_id: RoomId,
    query: SnapshotQuery,
) -> Result<(), ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let role = koko_core::room::ensure_can_read_room(&room_repo, room_id, session.profile_id)
        .await
        .map_err(map_domain_error)?;

    let current_room_id = session.room_id();
    let is_room_transition = current_room_id != Some(room_id);
    if is_room_transition {
        if let Some(current_room_id) = current_room_id {
            socket.leave(socket_room_name(current_room_id));
        }
        session.clear_room_id();
    }

    let room = room_repo
        .find_room(room_id)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?
        .ok_or_else(|| ApiError::not_found("房间不存在"))?;

    let (before_message_id, limit) = match query {
        SnapshotQuery::Recent { limit } => (None, normalize_message_page_limit(limit)),
        SnapshotQuery::Older {
            before_message_id,
            limit,
        } => (
            parse_optional_message_id(before_message_id.as_deref())?,
            normalize_message_page_limit(limit),
        ),
    };

    let message_repo = PostgresMessageRepository::new(state.pool.clone());
    let page = message_repo
        .list_room_messages(room_id, before_message_id, limit)
        .await
        .map_err(map_list_messages_error)?;
    let messages = page.items.into_iter().map(message_to_response).collect();

    let members = room_repo
        .list_members(room_id)
        .await
        .map_err(|_| ApiError::internal("成员列表读取失败"))?
        .into_iter()
        .map(|member| RoomMemberResponse {
            profile_id: member.profile_id.0.to_string(),
            display_name: session::build_display_name(member.profile_id),
            role: role_name(member.role).to_owned(),
        })
        .collect();

    socket
        .emit(
            SOCKET_IO_EVENT_NAME,
            &ServerRealtimeEvent::RoomSnapshot {
                room_id: room.id.0.to_string(),
                code: room.code.as_str().to_owned(),
                role: role_name(role).to_owned(),
                messages,
                has_more_messages: page.has_more,
                members,
            },
        )
        .map_err(|_| ApiError::internal("房间快照发送失败"))?;

    if is_room_transition {
        socket.join(socket_room_name(room_id));
        session.activate_room(room_id);
    }

    Ok(())
}

async fn send_message_event(
    state: &AppState,
    room_id: RoomId,
    profile_id: ProfileId,
    content: &str,
) -> Result<ServerRealtimeEvent, ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let message_repo = PostgresMessageRepository::new(state.pool.clone());
    let message =
        koko_core::chat::send_text_message(&room_repo, &message_repo, room_id, profile_id, content)
            .await
            .map_err(map_domain_error)?;
    let response = message_to_response(message);

    Ok(ServerRealtimeEvent::MessageCreated {
        message_id: response.message_id,
        room_id: response.room_id,
        sender_id: response.sender_id,
        content: response.content,
        created_at: response.created_at,
    })
}

fn emit_socket_error(socket: &SocketRef, message: &'static str) {
    let _ = socket.emit(SOCKET_IO_ERROR_NAME, message);
}

enum SnapshotQuery {
    Recent {
        limit: Option<u16>,
    },
    Older {
        before_message_id: Option<String>,
        limit: Option<u16>,
    },
}

fn parse_room_id(raw: &str) -> Result<RoomId, ApiError> {
    Uuid::parse_str(raw)
        .map(RoomId)
        .map_err(|_| ApiError::bad_request("room_id 不合法"))
}

fn socket_room_name(room_id: RoomId) -> String {
    room_id.0.to_string()
}

fn profile_room_name(profile_id: ProfileId) -> String {
    format!("profile:{}", profile_id.0)
}
