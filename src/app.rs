use core::future::Future;

use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    contract::{AppEvent, MessageCreated, SendTextMessageCommand},
    domain::{DomainError, Message, MessageBody, MessageStatus},
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AppError {
    #[error("session {session_id} is not active")]
    SessionNotActive { session_id: Uuid },
    #[error("session {session_id} is not a member of room {room_id}")]
    NotRoomMember { room_id: Uuid, session_id: Uuid },
    #[error(transparent)]
    Domain(#[from] DomainError),
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
    let saved_message = message_store.save_message(message).await?;

    Ok(AppEvent::MessageCreated(MessageCreated {
        message_id: saved_message.message_id,
        room_id: saved_message.room_id,
        session_id: saved_message.sender_session_id,
        body: saved_message.body.as_str().to_string(),
        created_at: saved_message.created_at,
        client_message_id: command.client_message_id,
    }))
}
