use core::future::Future;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    contract::{
        AdminOverview, AdminRoomSummary, AdminSessionStatus, AppErrorCode, AppEvent,
        BootstrapSession, ErrorEnvelope, JoinedRoomSummary, MessageCreated, MessageView,
        RoomSearchResult, RoomSnapshot,
    },
    domain::{
        AnonymousSession, DomainError, Message, MessageBody, MessageStatus, NewMemberRecord,
        NewRoomCodeRecord, NewRoomRecord, RoomCode, SessionStatus,
    },
};

const ROOM_SNAPSHOT_LIMIT: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscribeRoomStreamInput {
    pub room_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendTextMessageInput {
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinOrCreateRoomByCodeCommand {
    pub room_code: String,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadRoomSnapshotQuery {
    pub room_id: Uuid,
    pub session_id: Uuid,
}

pub use crate::contract::{ListJoinedRoomsQuery, SearchRoomsByCodeQuery};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AppError {
    #[error("session {session_id} is not active")]
    SessionNotActive { session_id: Uuid },
    #[error("session {session_id} is not a member of room {room_id}")]
    NotRoomMember { room_id: Uuid, session_id: Uuid },
    #[error("admin token is invalid")]
    InvalidAdminToken,
    #[error("admin session is required")]
    AdminSessionRequired,
    #[error("admin session is expired")]
    AdminSessionExpired,
    #[error("admin session is replaced by newer login")]
    AdminSessionReplaced,
    #[error("dependency failure")]
    DependencyFailure,
    #[error(transparent)]
    Domain(#[from] DomainError),
}

impl AppError {
    pub fn code(&self) -> AppErrorCode {
        match self {
            Self::SessionNotActive { .. } => AppErrorCode::InvalidSession,
            Self::NotRoomMember { .. } => AppErrorCode::MembershipRequired,
            Self::InvalidAdminToken => AppErrorCode::InvalidAdminToken,
            Self::AdminSessionRequired => AppErrorCode::AdminSessionRequired,
            Self::AdminSessionExpired => AppErrorCode::AdminSessionExpired,
            Self::AdminSessionReplaced => AppErrorCode::AdminSessionReplaced,
            Self::DependencyFailure => AppErrorCode::Internal,
            Self::Domain(DomainError::InvalidRoomCode) => AppErrorCode::InvalidRoomCode,
            Self::Domain(DomainError::EmptyMessageBody) => AppErrorCode::InvalidMessageBody,
        }
    }

    pub fn error_envelope(&self, operation: &'static str) -> ErrorEnvelope {
        ErrorEnvelope {
            code: self.code(),
            // 业务错误语义在 application 层定稿，adapter 只消费这份稳定上下文。
            layer: "application".to_string(),
            operation: operation.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminLoginCommand {
    pub token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdminSessionContext {
    pub session_id: Uuid,
}

impl AdminSessionContext {
    pub fn new(session_id: Uuid) -> Self {
        Self { session_id }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminSessionState {
    Active,
    Required,
    Expired,
    Replaced,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomSnapshotData {
    pub room_id: Uuid,
    pub room_code: RoomCode,
    pub latest_event_position: i64,
    pub messages: Vec<PersistedMessageRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedMessageRecord {
    pub message_id: Uuid,
    pub room_id: Uuid,
    pub sender_session_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub event_position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomStreamSubscription {
    pub room_id: Uuid,
    pub latest_event_position: i64,
}

pub trait AdminCredentialPort {
    fn verify_admin_token(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
}

pub trait AdminSessionPort {
    fn create_admin_session(
        &self,
    ) -> impl Future<Output = Result<AdminSessionContext, AppError>> + Send;

    fn read_admin_session(
        &self,
        context: &AdminSessionContext,
    ) -> impl Future<Output = Result<AdminSessionState, AppError>> + Send;

    fn revoke_admin_session(
        &self,
        context: &AdminSessionContext,
    ) -> impl Future<Output = Result<(), AppError>> + Send;
}

pub trait SessionPort {
    fn is_active_session(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
}

pub trait SessionBootstrapPort {
    fn load_session(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = Result<Option<AnonymousSession>, AppError>> + Send;

    fn save_session(
        &self,
        session: AnonymousSession,
    ) -> impl Future<Output = Result<AnonymousSession, AppError>> + Send;
}

pub trait MembershipPort {
    fn is_room_member(
        &self,
        room_id: Uuid,
        session_id: Uuid,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
}

pub trait JoinedRoomsPort {
    fn list_joined_rooms(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = Result<Vec<JoinedRoomSummary>, AppError>> + Send;
}

pub trait RoomSearchPort {
    fn search_rooms_by_code(
        &self,
        session_id: Uuid,
        input: &str,
    ) -> impl Future<Output = Result<Vec<RoomSearchResult>, AppError>> + Send;
}

pub trait MessageStore {
    fn save_message(
        &self,
        message: Message,
    ) -> impl Future<Output = Result<PersistedMessageRecord, AppError>> + Send;
}

pub trait RoomEntryPort {
    type Tx<'a>: RoomEntryTx
    where
        Self: 'a;

    fn begin_room_entry(
        &self,
        room_code: &RoomCode,
    ) -> impl Future<Output = Result<Self::Tx<'_>, AppError>> + Send;
}

pub trait RoomEntryTx {
    fn find_room_by_code(
        &mut self,
        room_code: &RoomCode,
    ) -> impl Future<Output = Result<Option<Uuid>, AppError>> + Send;

    fn create_room(
        &mut self,
        room: &NewRoomRecord,
        room_code: &NewRoomCodeRecord,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    fn ensure_room_member(
        &mut self,
        member: &NewMemberRecord,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    fn load_recent_messages(
        &mut self,
        room_id: Uuid,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<PersistedMessageRecord>, AppError>> + Send;

    fn commit(self) -> impl Future<Output = Result<(), AppError>> + Send
    where
        Self: Sized;
}

pub trait RoomSnapshotPort {
    fn load_room_snapshot(
        &self,
        room_id: Uuid,
        limit: usize,
    ) -> impl Future<Output = Result<RoomSnapshotData, AppError>> + Send;
}

pub trait RoomEventPositionPort {
    fn latest_room_event_position(
        &self,
        room_id: Uuid,
    ) -> impl Future<Output = Result<i64, AppError>> + Send;
}

pub trait AdminOverviewPort {
    fn get_admin_overview(&self) -> impl Future<Output = Result<AdminOverview, AppError>> + Send;
}

pub trait AdminRoomsPort {
    fn list_admin_rooms(
        &self,
    ) -> impl Future<Output = Result<Vec<AdminRoomSummary>, AppError>> + Send;
}

pub trait IdGenerator {
    fn next_message_id(&self) -> Uuid;

    fn next_room_id(&self) -> Uuid {
        self.next_message_id()
    }

    fn next_room_code_id(&self) -> Uuid {
        self.next_message_id()
    }

    fn next_member_id(&self) -> Uuid {
        self.next_message_id()
    }
}

pub trait Clock {
    fn now(&self) -> DateTime<Utc>;
}

pub async fn bootstrap_anonymous_session<P, C>(
    session_bootstrap_port: &P,
    clock: &C,
    existing_session_id: Option<Uuid>,
    session_id: Uuid,
) -> Result<BootstrapSession, AppError>
where
    P: SessionBootstrapPort,
    C: Clock,
{
    if let Some(existing_session_id) = existing_session_id
        && let Some(existing_session) = session_bootstrap_port
            .load_session(existing_session_id)
            .await?
    {
        let refreshed_session = AnonymousSession {
            last_seen_at: clock.now(),
            ..existing_session
        };
        let persisted = session_bootstrap_port
            .save_session(refreshed_session)
            .await?;

        if persisted.status != SessionStatus::Active || persisted.session_id != existing_session_id {
            return Err(AppError::DependencyFailure);
        }

        return Ok(BootstrapSession {
            session_id: persisted.session_id,
            issued_at: persisted.issued_at,
            last_seen_at: persisted.last_seen_at,
        });
    }

    let now = clock.now();
    let session = AnonymousSession {
        session_id,
        issued_at: now,
        last_seen_at: now,
        status: SessionStatus::Active,
    };
    let persisted = session_bootstrap_port.save_session(session).await?;

    if persisted.session_id != session_id || persisted.status != SessionStatus::Active {
        return Err(AppError::DependencyFailure);
    }

    Ok(BootstrapSession {
        session_id: persisted.session_id,
        issued_at: persisted.issued_at,
        last_seen_at: persisted.last_seen_at,
    })
}

pub async fn get_admin_overview<A, P>(
    admin_session_port: &A,
    admin_overview_port: &P,
    context: AdminSessionContext,
) -> Result<AdminOverview, AppError>
where
    A: AdminSessionPort,
    P: AdminOverviewPort,
{
    // 管理概览与房间列表都必须通过 application 层统一鉴权，防止权限真相散落到 HTTP/CLI/shell。
    authorize_admin_session(admin_session_port, &context).await?;
    admin_overview_port.get_admin_overview().await
}

pub async fn list_admin_rooms<A, P>(
    admin_session_port: &A,
    admin_rooms_port: &P,
    context: AdminSessionContext,
) -> Result<Vec<AdminRoomSummary>, AppError>
where
    A: AdminSessionPort,
    P: AdminRoomsPort,
{
    // 这里与 admin_overview 复用同一授权入口，避免 adapter 自行判断会话状态导致边界漂移。
    authorize_admin_session(admin_session_port, &context).await?;
    admin_rooms_port.list_admin_rooms().await
}

pub async fn login_admin<C, S>(
    credential_port: &C,
    admin_session_port: &S,
    command: AdminLoginCommand,
) -> Result<AdminSessionContext, AppError>
where
    C: AdminCredentialPort,
    S: AdminSessionPort,
{
    let token = command.token.trim();
    if token.is_empty() || !credential_port.verify_admin_token(token).await? {
        return Err(AppError::InvalidAdminToken);
    }

    admin_session_port.create_admin_session().await
}

pub async fn get_admin_session<S>(
    admin_session_port: &S,
    context: &AdminSessionContext,
    idle_timeout_seconds: u64,
) -> Result<AdminSessionStatus, AppError>
where
    S: AdminSessionPort,
{
    // /api/admin/session 只做探活，不续命：避免前端轮询探针悄悄延长后台会话。
    let authenticated = matches!(
        admin_session_port.read_admin_session(context).await?,
        AdminSessionState::Active
    );
    Ok(AdminSessionStatus {
        authenticated,
        idle_timeout_seconds,
    })
}

pub async fn logout_admin<S>(
    admin_session_port: &S,
    context: &AdminSessionContext,
) -> Result<(), AppError>
where
    S: AdminSessionPort,
{
    admin_session_port.revoke_admin_session(context).await
}

pub async fn authorize_admin_session<S>(
    admin_session_port: &S,
    context: &AdminSessionContext,
) -> Result<(), AppError>
where
    S: AdminSessionPort,
{
    match admin_session_port.read_admin_session(context).await? {
        AdminSessionState::Active => Ok(()),
        AdminSessionState::Required => Err(AppError::AdminSessionRequired),
        AdminSessionState::Expired => Err(AppError::AdminSessionExpired),
        AdminSessionState::Replaced => Err(AppError::AdminSessionReplaced),
    }
}

pub async fn list_joined_rooms<S, P>(
    session_port: &S,
    joined_rooms_port: &P,
    query: ListJoinedRoomsQuery,
) -> Result<Vec<JoinedRoomSummary>, AppError>
where
    S: SessionPort,
    P: JoinedRoomsPort,
{
    if !session_port.is_active_session(query.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: query.session_id,
        });
    }

    let mut rooms = joined_rooms_port.list_joined_rooms(query.session_id).await?;
    rooms.sort_by(|left, right| {
        right
            .latest_message_at
            .cmp(&left.latest_message_at)
            .then(left.room_code.cmp(&right.room_code))
    });
    Ok(rooms)
}

pub async fn search_rooms_by_code<S, P>(
    session_port: &S,
    room_search_port: &P,
    query: SearchRoomsByCodeQuery,
) -> Result<Vec<RoomSearchResult>, AppError>
where
    S: SessionPort,
    P: RoomSearchPort,
{
    if !session_port.is_active_session(query.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: query.session_id,
        });
    }

    let normalized_input = query.input.trim().to_ascii_uppercase();
    if normalized_input.is_empty() {
        return Ok(Vec::new());
    }

    let mut rooms = room_search_port
        .search_rooms_by_code(query.session_id, &query.input)
        .await?;
    // 搜索排序保持稳定：先精确命中，再已加入，再最近活跃，最后按群号兜底。
    rooms.sort_by(|left, right| {
        let left_exact = left.room_code.eq_ignore_ascii_case(&normalized_input);
        let right_exact = right.room_code.eq_ignore_ascii_case(&normalized_input);

        right_exact
            .cmp(&left_exact)
            .then(right.is_joined.cmp(&left.is_joined))
            .then(right.latest_message_at.cmp(&left.latest_message_at))
            .then(left.room_code.cmp(&right.room_code))
    });
    Ok(rooms)
}

pub async fn subscribe_room_stream<S, M, P>(
    session_port: &S,
    membership_port: &M,
    room_event_position_port: &P,
    command: SubscribeRoomStreamInput,
) -> Result<RoomStreamSubscription, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    P: RoomEventPositionPort,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    if !membership_port
        .is_room_member(command.room_id, command.session_id)
        .await?
    {
        return Err(AppError::NotRoomMember {
            room_id: command.room_id,
            session_id: command.session_id,
        });
    }

    Ok(RoomStreamSubscription {
        room_id: command.room_id,
        latest_event_position: room_event_position_port
            .latest_room_event_position(command.room_id)
            .await?,
    })
}

pub async fn send_text_message<S, M, R, I, C>(
    session_port: &S,
    membership_port: &M,
    message_store: &R,
    id_generator: &I,
    clock: &C,
    command: SendTextMessageInput,
) -> Result<AppEvent, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    R: MessageStore,
    I: IdGenerator,
    C: Clock,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    if !membership_port
        .is_room_member(command.room_id, command.session_id)
        .await?
    {
        return Err(AppError::NotRoomMember {
            room_id: command.room_id,
            session_id: command.session_id,
        });
    }

    let created_at = clock.now();
    let message = Message {
        message_id: id_generator.next_message_id(),
        room_id: command.room_id,
        sender_session_id: command.session_id,
        body: MessageBody::new(&command.body)?,
        created_at,
        status: MessageStatus::Active,
    };
    let persisted_message = message_store.save_message(message.clone()).await?;
    ensure_persisted_message_matches(&message, &persisted_message)?;

    Ok(AppEvent::MessageCreated(MessageCreated {
        message_id: persisted_message.message_id,
        room_id: persisted_message.room_id,
        session_id: persisted_message.sender_session_id,
        body: persisted_message.body.clone(),
        created_at: persisted_message.created_at,
        event_position: persisted_message.event_position,
        client_message_id: command.client_message_id,
    }))
}

pub async fn join_or_create_room_by_code<S, J, I, C>(
    session_port: &S,
    room_entry_port: &J,
    id_generator: &I,
    clock: &C,
    command: JoinOrCreateRoomByCodeCommand,
) -> Result<RoomSnapshot, AppError>
where
    S: SessionPort,
    J: RoomEntryPort,
    I: IdGenerator,
    C: Clock,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    let room_code = RoomCode::new(&command.room_code)?;
    let mut room_entry = room_entry_port.begin_room_entry(&room_code).await?;
    let room_id = match room_entry.find_room_by_code(&room_code).await? {
        Some(room_id) => room_id,
        None => {
            let now = clock.now();
            let room = NewRoomRecord {
                room_id: id_generator.next_room_id(),
                created_at: now,
            };
            let room_code_record = NewRoomCodeRecord {
                room_code_id: id_generator.next_room_code_id(),
                room_id: room.room_id,
                original_code: room_code.original().to_string(),
                normalized_code: room_code.normalized().to_string(),
                code_version: room_code.code_version,
                created_at: now,
            };
            room_entry.create_room(&room, &room_code_record).await?;

            room.room_id
        }
    };
    let member = NewMemberRecord {
        member_id: id_generator.next_member_id(),
        room_id,
        session_id: command.session_id,
        joined_at: clock.now(),
    };
    room_entry.ensure_room_member(&member).await?;
    let messages = room_entry
        .load_recent_messages(room_id, ROOM_SNAPSHOT_LIMIT)
        .await?;
    let latest_event_position = messages.last().map(|message| message.event_position).unwrap_or(0);
    let snapshot = RoomSnapshotData {
        room_id,
        room_code,
        latest_event_position,
        messages,
    };
    room_entry.commit().await?;

    build_room_snapshot(snapshot)
}

pub async fn load_room_snapshot<S, M, R>(
    session_port: &S,
    membership_port: &M,
    room_snapshot_port: &R,
    query: LoadRoomSnapshotQuery,
) -> Result<RoomSnapshot, AppError>
where
    S: SessionPort,
    M: MembershipPort,
    R: RoomSnapshotPort,
{
    if !session_port.is_active_session(query.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: query.session_id,
        });
    }

    if !membership_port
        .is_room_member(query.room_id, query.session_id)
        .await?
    {
        return Err(AppError::NotRoomMember {
            room_id: query.room_id,
            session_id: query.session_id,
        });
    }

    let snapshot = room_snapshot_port
        .load_room_snapshot(query.room_id, ROOM_SNAPSHOT_LIMIT)
        .await?;
    if snapshot.room_id != query.room_id {
        return Err(AppError::DependencyFailure);
    }

    build_room_snapshot(snapshot)
}

fn build_room_snapshot(snapshot: RoomSnapshotData) -> Result<RoomSnapshot, AppError> {
    let RoomSnapshotData {
        room_id,
        room_code,
        latest_event_position,
        mut messages,
    } = snapshot;

    if messages.iter().any(|message| message.room_id != room_id) {
        return Err(AppError::DependencyFailure);
    }

    messages.sort_by(|left, right| {
        left.event_position
            .cmp(&right.event_position)
            .then(left.message_id.cmp(&right.message_id))
    });

    let message_count = messages.len();
    let skip = message_count.saturating_sub(ROOM_SNAPSHOT_LIMIT);

    Ok(RoomSnapshot {
        room_id,
        room_code: room_code.normalized().to_string(),
        latest_event_position,
        messages: messages
            .into_iter()
            .skip(skip)
            .map(|message| MessageView {
                message_id: message.message_id,
                session_id: message.sender_session_id,
                body: message.body,
                created_at: message.created_at,
                event_position: message.event_position,
            })
            .collect(),
    })
}

fn ensure_persisted_message_matches(
    expected: &Message,
    persisted: &PersistedMessageRecord,
) -> Result<(), AppError> {
    // 持久化层可能会把时间戳规整到数据库精度；这里要守住业务真相字段，而不是把时间精度差异误判成落库失败。
    let matches = expected.message_id == persisted.message_id
        && expected.room_id == persisted.room_id
        && expected.sender_session_id == persisted.sender_session_id
        && expected.body.as_str() == persisted.body
        && expected.status == MessageStatus::Active;

    if matches {
        Ok(())
    } else {
        Err(AppError::DependencyFailure)
    }
}
