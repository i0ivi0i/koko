use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCode {
    InvalidSession,
    MembershipRequired,
    InvalidRoomCode,
    InvalidMessageBody,
    InvalidAdminToken,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinOrCreateRoomByCodeCommand {
    pub room_code: String,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscribeRoomStreamCommand {
    pub room_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomStreamSubscribed {
    pub room_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandRejected {
    pub code: AppErrorCode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadRoomSnapshotQuery {
    pub room_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapSession {
    pub session_id: Uuid,
    pub issued_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminOverview {
    pub room_count: i64,
    pub member_count: i64,
    pub message_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminRoomSummary {
    pub room_code: String,
    pub member_count: i64,
    pub message_count: i64,
    pub latest_preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminPanelData {
    pub overview: AdminOverview,
    pub rooms: Vec<AdminRoomSummary>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum AppEvent {
    MessageCreated(MessageCreated),
}
