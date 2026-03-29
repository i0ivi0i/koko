use std::{
    sync::OnceLock,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use koko_contract::{ClientRealtimeCommand, ClientRealtimeQuery, ServerRealtimeEvent};
use koko_core::model::{ProfileId, Role, Room, RoomCode, RoomId};
use socketioxide::{
    SocketIo,
    extract::{Data, Extension, SocketRef, State as SocketState},
    handler::ConnectHandler,
};
use uuid::Uuid;

use crate::{
    app::AppState,
    http::{
        ApiError, RoomSnapshotQuery, RoomSnapshotView, load_room_snapshot_view,
        load_room_viewer_context, map_domain_error, message_to_response, role_name,
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

    pub(crate) async fn publish_to_profile(
        &self,
        profile_id: ProfileId,
        event: ServerRealtimeEvent,
    ) {
        if let Some(io) = self.socket_io.get().cloned() {
            let _ = io
                .to(profile_room_name(profile_id))
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
            RoomSnapshotSeed::lookup(room_id),
            RoomSnapshotQuery::Recent {
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
                Ok(seed) => {
                    if let Err(error) = emit_room_snapshot(
                        &socket,
                        &state,
                        &session,
                        seed,
                        RoomSnapshotQuery::Recent {
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
        ClientRealtimeQuery::LoadRecentMessages { limit } => RoomSnapshotQuery::Recent { limit },
        ClientRealtimeQuery::LoadOlderMessages {
            before_message_id,
            limit,
        } => RoomSnapshotQuery::Older {
            before_message_id,
            limit,
        },
    };

    if let Err(error) = emit_room_snapshot(
        &socket,
        &state,
        &session,
        RoomSnapshotSeed::lookup(room_id),
        snapshot_query,
    )
    .await
    {
        emit_socket_error(&socket, error.message());
    }
}

async fn resolve_socket_room_by_code(
    state: &AppState,
    session: &SocketSession,
    code: &str,
) -> Result<RoomSnapshotSeed, ApiError> {
    let code = RoomCode::parse(code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let result = koko_core::room::join_or_create_room(&room_repo, session.profile_id, code)
        .await
        .map_err(map_domain_error)?;

    Ok(RoomSnapshotSeed::known(result.room))
}

async fn emit_room_snapshot(
    socket: &SocketRef,
    state: &AppState,
    session: &SocketSession,
    seed: RoomSnapshotSeed,
    query: RoomSnapshotQuery,
) -> Result<(), ApiError> {
    let room_id = seed.room_id;
    let viewer =
        load_room_viewer_context(&state.pool, session.profile_id, room_id, seed.room).await?;
    let current_room_id = session.room_id();
    let is_room_transition = current_room_id != Some(room_id);
    if is_room_transition {
        if let Some(current_room_id) = current_room_id {
            socket.leave(socket_room_name(current_room_id));
        }
        session.clear_room_id();
    }

    let snapshot = load_room_snapshot_view(
        &state.pool,
        session.profile_id,
        viewer.room,
        viewer.role,
        query,
    )
    .await?;
    let event = build_room_snapshot_event(snapshot);

    socket
        .emit(SOCKET_IO_EVENT_NAME, &event)
        .map_err(|_| ApiError::internal("房间快照发送失败"))?;

    if is_room_transition {
        socket.join(socket_room_name(room_id));
        session.activate_room(room_id);
    }

    Ok(())
}

pub(crate) async fn publish_room_members_updates(state: &AppState, room_id: RoomId) {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let Ok(members) = room_repo.list_members(room_id).await else {
        return;
    };

    for member in &members {
        let event =
            build_room_members_snapshot_event(room_id, member.profile_id, member.role, &members);

        state
            .realtime
            .publish_to_profile(member.profile_id, event)
            .await;
    }
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

#[derive(Clone)]
struct RoomSnapshotSeed {
    room: Option<Room>,
    room_id: RoomId,
}

impl RoomSnapshotSeed {
    fn known(room: Room) -> Self {
        Self {
            room_id: room.id,
            room: Some(room),
        }
    }

    fn lookup(room_id: RoomId) -> Self {
        Self {
            room: None,
            room_id,
        }
    }
}

fn build_room_snapshot_event(snapshot: RoomSnapshotView) -> ServerRealtimeEvent {
    ServerRealtimeEvent::RoomSnapshot {
        room_id: snapshot.room.id.0.to_string(),
        code: snapshot.room.code.as_str().to_owned(),
        role: role_name(snapshot.role).to_owned(),
        messages: snapshot.messages,
        has_more_messages: snapshot.has_more_messages,
        members: snapshot.members,
    }
}

fn build_room_members_snapshot_event(
    room_id: RoomId,
    viewer_profile_id: ProfileId,
    role: Role,
    members: &[crate::room_repo::RoomMemberRecord],
) -> ServerRealtimeEvent {
    let members = members
        .iter()
        .copied()
        .map(|member| crate::http::room_member_to_response(viewer_profile_id, role, member))
        .collect();

    ServerRealtimeEvent::RoomMembersSnapshot {
        room_id: room_id.0.to_string(),
        role: role_name(role).to_owned(),
        members,
    }
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
