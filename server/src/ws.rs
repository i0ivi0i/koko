use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use koko_contract::{
    ClientRealtimeCommand, ClientRealtimeQuery, ClientWsEvent, RoomMemberResponse,
    ServerRealtimeEvent, ServerWsEvent,
};
use koko_core::model::{ProfileId, RoomCode, RoomId};
use socketioxide::{
    SocketIo,
    extract::{Data, Extension, SocketRef, State as SocketState},
    handler::ConnectHandler,
};
use tokio::sync::broadcast;
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
    inner: Arc<Mutex<HashMap<Uuid, broadcast::Sender<ServerRealtimeEvent>>>>,
    socket_io: Arc<Mutex<Option<SocketIo>>>,
    online_connections: Arc<AtomicUsize>,
}

impl RealtimeHub {
    pub fn subscribe(&self, room_id: RoomId) -> broadcast::Receiver<ServerRealtimeEvent> {
        self.channel(room_id).subscribe()
    }

    pub(crate) fn attach_socket_io(&self, io: SocketIo) {
        *self.socket_io.lock().unwrap() = Some(io);
    }

    pub(crate) async fn publish(&self, room_id: RoomId, event: ServerRealtimeEvent) {
        let _ = self.channel(room_id).send(event.clone());
        let socket_io = self.socket_io.lock().unwrap().clone();
        if let Some(socket_io) = socket_io {
            let _ = socket_io
                .of("/")
                .expect("default namespace should exist")
                .to(room_id.0.to_string())
                .emit(SOCKET_IO_EVENT_NAME, &event)
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

    fn channel(&self, room_id: RoomId) -> broadcast::Sender<ServerRealtimeEvent> {
        let mut rooms = self.inner.lock().unwrap();
        rooms
            .entry(room_id.0)
            .or_insert_with(|| broadcast::channel(128).0)
            .clone()
    }
}

#[derive(Debug, Clone)]
struct SocketSession {
    profile_id: ProfileId,
    room_id: Arc<Mutex<Option<RoomId>>>,
}

impl SocketSession {
    fn new(profile_id: ProfileId, room_id: Option<RoomId>) -> Self {
        Self {
            profile_id,
            room_id: Arc::new(Mutex::new(room_id)),
        }
    }

    fn room_id(&self) -> Option<RoomId> {
        *self.room_id.lock().unwrap()
    }

    fn set_room_id(&self, room_id: RoomId) {
        *self.room_id.lock().unwrap() = Some(room_id);
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

pub(crate) async fn connect(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(query): Query<WsConnectQuery>,
) -> Result<Response, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = session::authenticate_session(&state.pool, &query.session_id).await?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::ensure_can_read_room(&room_repo, room_id, session.profile_id)
        .await
        .map_err(map_domain_error)?;

    Ok(ws
        .on_upgrade(move |socket| handle_legacy_socket(socket, state, room_id, session.profile_id))
        .into_response())
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

    if let Some(room_id) = session.room_id() {
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
            match join_socket_room_by_code(&socket, &state, &session, &code).await {
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

async fn handle_legacy_socket(
    socket: WebSocket,
    state: AppState,
    room_id: RoomId,
    profile_id: ProfileId,
) {
    state.online_connection_opened();
    let (mut sender, mut receiver) = socket.split();
    let mut room_events = state.realtime.subscribe(room_id);

    loop {
        tokio::select! {
            inbound = receiver.next() => match inbound {
                Some(Ok(Message::Text(text))) => {
                    if let Some(event) = handle_legacy_client_text(&state, room_id, profile_id, &text).await {
                        state.realtime.publish(room_id, event).await;
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            outbound = room_events.recv() => match outbound {
                Ok(event) => {
                    let Some(payload) = encode_legacy_event(event) else {
                        continue;
                    };
                    if sender.send(Message::Text(payload.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    state.online_connection_closed();
}

async fn handle_legacy_client_text(
    state: &AppState,
    room_id: RoomId,
    profile_id: ProfileId,
    text: &str,
) -> Option<ServerRealtimeEvent> {
    let event: ClientWsEvent = serde_json::from_str(text).ok()?;

    match event {
        ClientWsEvent::SendMessage { content } => {
            send_message_event(state, room_id, profile_id, &content)
                .await
                .ok()
        }
    }
}

async fn join_socket_room_by_code(
    socket: &SocketRef,
    state: &AppState,
    session: &SocketSession,
    code: &str,
) -> Result<RoomId, ApiError> {
    let code = RoomCode::parse(code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let result = koko_core::room::join_or_create_room(&room_repo, session.profile_id, code)
        .await
        .map_err(map_domain_error)?;

    let room_name = result.room.id.0.to_string();
    socket.join(room_name);
    session.set_room_id(result.room.id);

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

    let room_name = room_id.0.to_string();
    socket.join(room_name);
    session.set_room_id(room_id);

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

fn encode_legacy_event(event: ServerRealtimeEvent) -> Option<String> {
    match event {
        ServerRealtimeEvent::MessageCreated {
            message_id,
            room_id,
            sender_id,
            content,
            created_at,
        } => serde_json::to_string(&ServerWsEvent::MessageCreated {
            message_id,
            room_id,
            sender_id,
            content,
            created_at,
        })
        .ok(),
        _ => None,
    }
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct WsConnectQuery {
    session_id: String,
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
