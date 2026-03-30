use core::future::Future;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    contract::{
        AppErrorCode, AppEvent, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery,
        MessageCreated, MessageView, RoomSnapshot, SendTextMessageCommand,
    },
    domain::{DomainError, Message, MessageBody, MessageStatus, RoomCode},
};

const ROOM_SNAPSHOT_LIMIT: usize = 50;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AppError {
    #[error("session {session_id} is not active")]
    SessionNotActive { session_id: Uuid },
    #[error("session {session_id} is not a member of room {room_id}")]
    NotRoomMember { room_id: Uuid, session_id: Uuid },
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
            Self::DependencyFailure => AppErrorCode::Internal,
            Self::Domain(DomainError::InvalidRoomCode) => AppErrorCode::InvalidRoomCode,
            Self::Domain(DomainError::EmptyMessageBody) => AppErrorCode::InvalidMessageBody,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomSnapshotData {
    pub room_id: Uuid,
    pub room_code: RoomCode,
    pub messages: Vec<Message>,
}

pub trait SessionPort {
    fn is_active_session(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = Result<bool, AppError>> + Send;
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

pub trait RoomJoinPort {
    fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        session_id: Uuid,
    ) -> impl Future<Output = Result<Uuid, AppError>> + Send;
}

pub trait RoomSnapshotPort {
    fn load_room_snapshot(
        &self,
        room_id: Uuid,
        limit: usize,
    ) -> impl Future<Output = Result<RoomSnapshotData, AppError>> + Send;
}

pub trait IdGenerator {
    fn next_message_id(&self) -> Uuid;
}

pub trait Clock {
    fn now(&self) -> DateTime<Utc>;
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

pub async fn join_or_create_room_by_code<S, J, R>(
    session_port: &S,
    room_join_port: &J,
    room_snapshot_port: &R,
    command: JoinOrCreateRoomByCodeCommand,
) -> Result<RoomSnapshot, AppError>
where
    S: SessionPort,
    J: RoomJoinPort,
    R: RoomSnapshotPort,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    let room_code = RoomCode::new(&command.room_code)?;
    let room_id = room_join_port
        .join_or_create_room_by_code(room_code, command.session_id)
        .await?;
    let snapshot = room_snapshot_port
        .load_room_snapshot(room_id, ROOM_SNAPSHOT_LIMIT)
        .await?;
    if snapshot.room_id != room_id {
        return Err(AppError::DependencyFailure);
    }

    Ok(build_room_snapshot(snapshot))
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

    Ok(build_room_snapshot(snapshot))
}

fn build_room_snapshot(snapshot: RoomSnapshotData) -> RoomSnapshot {
    let message_count = snapshot.messages.len();
    let skip = message_count.saturating_sub(ROOM_SNAPSHOT_LIMIT);

    RoomSnapshot {
        room_id: snapshot.room_id,
        room_code: snapshot.room_code.normalized().to_string(),
        messages: snapshot
            .messages
            .into_iter()
            .skip(skip)
            .map(|message| MessageView {
                message_id: message.message_id,
                session_id: message.sender_session_id,
                body: message.body.as_str().to_string(),
                created_at: message.created_at,
            })
            .collect(),
    }
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
