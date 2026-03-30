use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppErrorCode {
    InvalidSession,
    MembershipRequired,
    InvalidRoomCode,
    InvalidMessageBody,
    Internal,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageView {
    pub message_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSnapshot {
    pub room_id: Uuid,
    pub room_code: String,
    pub messages: Vec<MessageView>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendTextMessageCommand {
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageCreated {
    pub message_id: Uuid,
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppEvent {
    MessageCreated(MessageCreated),
}
