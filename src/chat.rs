use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::contract::{BootstrapSession, MessageCreated, RoomSnapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryState {
    Pending,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Offline,
    Connecting,
    Joined,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub client_message_id: Option<Uuid>,
    pub message_id: Option<Uuid>,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub delivery: DeliveryState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatState {
    session_id: Uuid,
    room_id: Option<Uuid>,
    room_code: String,
    connection: ConnectionState,
    messages: Vec<ChatMessage>,
}

impl Default for ChatState {
    fn default() -> Self {
        Self::new(Uuid::nil())
    }
}

impl ChatState {
    pub fn awaiting_bootstrap() -> Self {
        Self::default()
    }

    pub fn new(session_id: Uuid) -> Self {
        Self {
            session_id,
            room_id: None,
            room_code: String::new(),
            connection: ConnectionState::Offline,
            messages: Vec::new(),
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.session_id
    }

    pub fn apply_bootstrap_session(&mut self, session: BootstrapSession) {
        self.session_id = session.session_id;
    }

    pub fn room_id(&self) -> Option<Uuid> {
        self.room_id
    }

    pub fn room_code(&self) -> &str {
        &self.room_code
    }

    pub fn connection(&self) -> ConnectionState {
        self.connection
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    pub fn confirmed_messages(&self) -> Vec<&ChatMessage> {
        self.messages
            .iter()
            .filter(|message| message.delivery == DeliveryState::Confirmed)
            .collect()
    }

    pub fn enter_room(&mut self, snapshot: RoomSnapshot) {
        self.room_id = Some(snapshot.room_id);
        self.room_code = snapshot.room_code;
        self.connection = ConnectionState::Joined;
        self.messages = snapshot
            .messages
            .into_iter()
            .map(|message| ChatMessage {
                room_id: snapshot.room_id,
                session_id: message.session_id,
                client_message_id: None,
                message_id: Some(message.message_id),
                body: message.body,
                created_at: message.created_at,
                delivery: DeliveryState::Confirmed,
            })
            .collect();
        self.sort_messages();
    }

    pub fn enqueue_pending(&mut self, room_id: Uuid, session_id: Uuid, body: &str) -> Uuid {
        let pending_id = Uuid::now_v7();
        let body = body.trim().to_string();

        self.room_id = Some(room_id);
        self.messages.push(ChatMessage {
            room_id,
            session_id,
            client_message_id: Some(pending_id),
            message_id: None,
            body,
            created_at: Utc::now(),
            delivery: DeliveryState::Pending,
        });
        self.sort_messages();
        pending_id
    }

    pub fn confirm_message(&mut self, event: MessageCreated) {
        if let Some(client_message_id) = event.client_message_id
            && let Some(message) = self
                .messages
                .iter_mut()
                .find(|message| message.client_message_id == Some(client_message_id))
        {
            message.message_id = Some(event.message_id);
            message.body = event.body;
            message.created_at = event.created_at;
            message.delivery = DeliveryState::Confirmed;
            self.sort_messages();
            return;
        }

        self.messages.push(ChatMessage {
            room_id: event.room_id,
            session_id: event.session_id,
            client_message_id: event.client_message_id,
            message_id: Some(event.message_id),
            body: event.body,
            created_at: event.created_at,
            delivery: DeliveryState::Confirmed,
        });
        self.sort_messages();
    }

    pub fn reject_pending(&mut self, client_message_id: Uuid) {
        if let Some(message) = self
            .messages
            .iter_mut()
            .find(|message| message.client_message_id == Some(client_message_id))
        {
            message.delivery = DeliveryState::Failed;
        }
    }

    pub fn set_connection(&mut self, connection: ConnectionState) {
        self.connection = connection;
    }

    fn sort_messages(&mut self) {
        self.messages.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then(left.message_id.cmp(&right.message_id))
                .then(left.client_message_id.cmp(&right.client_message_id))
        });
    }
}
