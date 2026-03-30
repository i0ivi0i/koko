use core::future::Future;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    contract::{
        AppEvent, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, MessageCreated,
        MessageView, RoomSnapshot, SendTextMessageCommand,
    },
    domain::{DomainError, Message, MessageBody, MessageStatus, RoomCode},
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AppError {
    #[error("session {session_id} is not active")]
    SessionNotActive { session_id: Uuid },
    #[error("session {session_id} is not a member of room {room_id}")]
    NotRoomMember { room_id: Uuid, session_id: Uuid },
    #[error("dependency failure in {dependency}")]
    DependencyFailure { dependency: &'static str },
    #[error(transparent)]
    Domain(#[from] DomainError),
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
    ) -> impl Future<Output = Result<(), AppError>> + Send;
}

pub trait RoomEntryPort {
    fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        session_id: Uuid,
    ) -> impl Future<Output = Result<RoomSnapshotData, AppError>> + Send;
}

pub trait RoomSnapshotPort {
    fn load_room_snapshot(
        &self,
        room_id: Uuid,
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
    message_store.save_message(message.clone()).await?;

    Ok(AppEvent::MessageCreated(MessageCreated {
        message_id: message.message_id,
        room_id: message.room_id,
        session_id: message.sender_session_id,
        body: message.body.as_str().to_string(),
        created_at: message.created_at,
        client_message_id: command.client_message_id,
    }))
}

pub async fn join_or_create_room_by_code<S, R>(
    session_port: &S,
    room_entry_port: &R,
    command: JoinOrCreateRoomByCodeCommand,
) -> Result<RoomSnapshot, AppError>
where
    S: SessionPort,
    R: RoomEntryPort,
{
    if !session_port.is_active_session(command.session_id).await? {
        return Err(AppError::SessionNotActive {
            session_id: command.session_id,
        });
    }

    let room_code = RoomCode::new(&command.room_code)?;
    let snapshot = room_entry_port
        .join_or_create_room_by_code(room_code, command.session_id)
        .await?;

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

    let snapshot = room_snapshot_port.load_room_snapshot(query.room_id).await?;
    Ok(build_room_snapshot(snapshot))
}

fn build_room_snapshot(snapshot: RoomSnapshotData) -> RoomSnapshot {
    RoomSnapshot {
        room_id: snapshot.room_id,
        room_code: snapshot.room_code.normalized().to_string(),
        messages: snapshot
            .messages
            .into_iter()
            .map(|message| MessageView {
                message_id: message.message_id,
                session_id: message.sender_session_id,
                body: message.body.as_str().to_string(),
                created_at: message.created_at,
            })
            .collect(),
    }
}
