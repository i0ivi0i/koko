use core::future::Future;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    contract::{
        AdminOverview, AdminPanelData, AdminRoomSummary, AppErrorCode, AppEvent, BootstrapSession,
        JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, MessageCreated, MessageView,
        RoomSnapshot, SendTextMessageCommand, SubscribeRoomStreamCommand,
    },
    domain::{
        AnonymousSession, DomainError, Message, MessageBody, MessageStatus, RoomCode, SessionStatus,
    },
};

const ROOM_SNAPSHOT_LIMIT: usize = 50;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AppError {
    #[error("session {session_id} is not active")]
    SessionNotActive { session_id: Uuid },
    #[error("session {session_id} is not a member of room {room_id}")]
    NotRoomMember { room_id: Uuid, session_id: Uuid },
    #[error("admin access denied")]
    AdminAccessDenied,
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
            Self::AdminAccessDenied => AppErrorCode::InvalidAdminToken,
            Self::DependencyFailure => AppErrorCode::Internal,
            Self::Domain(DomainError::InvalidRoomCode) => AppErrorCode::InvalidRoomCode,
            Self::Domain(DomainError::EmptyMessageBody) => AppErrorCode::InvalidMessageBody,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminQueryContext {
    pub admin_token: String,
}

impl AdminQueryContext {
    pub fn new(admin_token: String) -> Self {
        Self { admin_token }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomSnapshotData {
    pub room_id: Uuid,
    pub room_code: RoomCode,
    pub messages: Vec<Message>,
}

pub trait AdminAccessPort {
    fn is_authorized_admin(
        &self,
        context: &AdminQueryContext,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
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

pub trait MessageStore {
    fn save_message(
        &self,
        message: Message,
    ) -> impl Future<Output = Result<Message, AppError>> + Send;
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
        room_code: &RoomCode,
    ) -> impl Future<Output = Result<Uuid, AppError>> + Send;

    fn ensure_room_member(
        &mut self,
        room_id: Uuid,
        session_id: Uuid,
    ) -> impl Future<Output = Result<(), AppError>> + Send;

    fn load_recent_messages(
        &mut self,
        room_id: Uuid,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Message>, AppError>> + Send;

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

pub trait AdminOverviewPort {
    fn get_admin_overview(&self) -> impl Future<Output = Result<AdminOverview, AppError>> + Send;
}

pub trait AdminRoomsPort {
    fn list_admin_rooms(
        &self,
    ) -> impl Future<Output = Result<Vec<AdminRoomSummary>, AppError>> + Send;
}

pub trait AdminPanelPort {
    fn load_admin_panel(&self) -> impl Future<Output = Result<AdminPanelData, AppError>> + Send;
}

pub trait IdGenerator {
    fn next_message_id(&self) -> Uuid;
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
    access_port: &A,
    admin_overview_port: &P,
    context: AdminQueryContext,
) -> Result<AdminOverview, AppError>
where
    A: AdminAccessPort,
    P: AdminOverviewPort,
{
    if !access_port.is_authorized_admin(&context).await? {
        return Err(AppError::AdminAccessDenied);
    }

    admin_overview_port.get_admin_overview().await
}

pub async fn list_admin_rooms<A, P>(
    access_port: &A,
    admin_rooms_port: &P,
    context: AdminQueryContext,
) -> Result<Vec<AdminRoomSummary>, AppError>
where
    A: AdminAccessPort,
    P: AdminRoomsPort,
{
    if !access_port.is_authorized_admin(&context).await? {
        return Err(AppError::AdminAccessDenied);
    }

    admin_rooms_port.list_admin_rooms().await
}

pub async fn load_admin_panel<P>(admin_panel_port: &P) -> Result<AdminPanelData, AppError>
where
    P: AdminPanelPort,
{
    admin_panel_port.load_admin_panel().await
}

pub async fn subscribe_room_stream<S, M>(
    session_port: &S,
    membership_port: &M,
    command: SubscribeRoomStreamCommand,
) -> Result<(), AppError>
where
    S: SessionPort,
    M: MembershipPort,
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

    Ok(())
}

pub async fn send_text_message<S, M, R, I, C>(
    session_port: &S,
    membership_port: &M,
    message_store: &R,
    id_generator: &I,
    clock: &C,
    command: SendTextMessageCommand,
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
        body: persisted_message.body.as_str().to_string(),
        created_at: persisted_message.created_at,
        client_message_id: command.client_message_id,
    }))
}

pub async fn join_or_create_room_by_code<S, J>(
    session_port: &S,
    room_entry_port: &J,
    command: JoinOrCreateRoomByCodeCommand,
) -> Result<RoomSnapshot, AppError>
where
    S: SessionPort,
    J: RoomEntryPort,
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
        None => room_entry.create_room(&room_code).await?,
    };
    room_entry
        .ensure_room_member(room_id, command.session_id)
        .await?;
    let snapshot = RoomSnapshotData {
        room_id,
        room_code,
        messages: room_entry
            .load_recent_messages(room_id, ROOM_SNAPSHOT_LIMIT)
            .await?,
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
        mut messages,
    } = snapshot;

    if messages.iter().any(|message| message.room_id != room_id) {
        return Err(AppError::DependencyFailure);
    }

    messages.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then(left.message_id.cmp(&right.message_id))
    });

    let message_count = messages.len();
    let skip = message_count.saturating_sub(ROOM_SNAPSHOT_LIMIT);

    Ok(RoomSnapshot {
        room_id,
        room_code: room_code.normalized().to_string(),
        messages: messages
            .into_iter()
            .skip(skip)
            .map(|message| MessageView {
                message_id: message.message_id,
                session_id: message.sender_session_id,
                body: message.body.as_str().to_string(),
                created_at: message.created_at,
            })
            .collect(),
    })
}

fn ensure_persisted_message_matches(
    expected: &Message,
    persisted: &Message,
) -> Result<(), AppError> {
    let matches = expected.message_id == persisted.message_id
        && expected.room_id == persisted.room_id
        && expected.sender_session_id == persisted.sender_session_id
        && expected.body == persisted.body
        && expected.created_at == persisted.created_at
        && expected.status == persisted.status;

    if matches {
        Ok(())
    } else {
        Err(AppError::DependencyFailure)
    }
}
