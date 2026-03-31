use chrono::{DateTime, Utc};
use thiserror::Error;
use uuid::Uuid;

const ROOM_CODE_LENGTH: usize = 5;
const ROOM_CODE_DIGIT_COUNT: usize = 4;
const ROOM_CODE_LETTER_COUNT: usize = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("room code must contain exactly 4 digits and 1 letter")]
    InvalidRoomCode,
    #[error("message body must not be empty")]
    EmptyMessageBody,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomStatus {
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberStatus {
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageStatus {
    Active,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnonymousSession {
    pub session_id: Uuid,
    pub issued_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Room {
    pub room_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub status: RoomStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRoomRecord {
    pub room_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomCode {
    original: String,
    normalized: String,
    pub code_version: u16,
}

impl RoomCode {
    pub fn new(raw: &str) -> Result<Self, DomainError> {
        let original = raw.trim();
        let normalized = original.to_ascii_uppercase();
        let digit_count = normalized.chars().filter(|ch| ch.is_ascii_digit()).count();
        let letter_count = normalized.chars().filter(|ch| ch.is_ascii_alphabetic()).count();
        let is_valid = normalized.len() == ROOM_CODE_LENGTH
            && digit_count == ROOM_CODE_DIGIT_COUNT
            && letter_count == ROOM_CODE_LETTER_COUNT
            && normalized.chars().all(|ch| ch.is_ascii_alphanumeric());

        if !is_valid {
            return Err(DomainError::InvalidRoomCode);
        }

        Ok(Self {
            original: original.to_string(),
            normalized,
            code_version: 1,
        })
    }

    pub fn original(&self) -> &str {
        &self.original
    }

    pub fn normalized(&self) -> &str {
        &self.normalized
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRoomCodeRecord {
    pub room_code_id: Uuid,
    pub room_id: Uuid,
    pub original_code: String,
    pub normalized_code: String,
    pub code_version: u16,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub member_id: Uuid,
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub joined_at: DateTime<Utc>,
    pub status: MemberStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMemberRecord {
    pub member_id: Uuid,
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageBody(String);

impl MessageBody {
    pub fn new(raw: &str) -> Result<Self, DomainError> {
        let body = raw.trim();
        if body.is_empty() {
            return Err(DomainError::EmptyMessageBody);
        }

        Ok(Self(body.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub message_id: Uuid,
    pub room_id: Uuid,
    pub sender_session_id: Uuid,
    pub body: MessageBody,
    pub created_at: DateTime<Utc>,
    pub status: MessageStatus,
}
