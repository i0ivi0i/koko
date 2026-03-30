use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
pub enum AppEvent {
    MessageCreated(MessageCreated),
}
