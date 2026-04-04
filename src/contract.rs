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
    AdminSessionRequired,
    AdminSessionExpired,
    AdminSessionReplaced,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscribeRoomStreamCommand {
    pub room_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomStreamSubscribed {
    pub room_id: Uuid,
    pub latest_event_position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageAccepted {
    pub room_id: Uuid,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectedCommandKind {
    SubscribeRoomStream,
    SendTextMessage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorLayer {
    Application,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorOperation {
    BootstrapAnonymousSession,
    JoinOrCreateRoomByCode,
    ListJoinedRooms,
    SearchRoomsByCode,
    LoadRoomSnapshot,
    SubscribeRoomStream,
    SendTextMessage,
    LoginAdmin,
    GetAdminSession,
    LogoutAdmin,
    GetAdminOverview,
    ListAdminRooms,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub code: AppErrorCode,
    pub layer: ErrorLayer,
    pub operation: ErrorOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandRejected {
    #[serde(flatten)]
    pub error: ErrorEnvelope,
    pub command: RejectedCommandKind,
    pub room_id: Option<Uuid>,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListJoinedRoomsQuery {
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchRoomsByCodeQuery {
    pub session_id: Uuid,
    pub input: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JoinedRoomSummary {
    pub room_id: Uuid,
    pub room_code: String,
    pub display_title: String,
    pub latest_preview: String,
    pub latest_message_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSearchResult {
    pub room_id: Uuid,
    pub room_code: String,
    pub display_title: String,
    pub latest_preview: String,
    pub latest_message_at: Option<DateTime<Utc>>,
    pub is_joined: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapSession {
    pub session_id: Uuid,
    pub issued_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminLoginRequest {
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminSessionStatus {
    pub authenticated: bool,
    pub idle_timeout_seconds: u64,
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
pub struct MessageView {
    pub message_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub event_position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSnapshot {
    pub room_id: Uuid,
    pub room_code: String,
    pub latest_event_position: i64,
    pub messages: Vec<MessageView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendTextMessageCommand {
    pub room_id: Uuid,
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
    pub event_position: i64,
    pub client_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum AppEvent {
    MessageCreated(MessageCreated),
}
