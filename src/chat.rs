use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::contract::{
    BootstrapSession, JoinedRoomSummary, MessageCreated, RoomSearchResult, RoomSnapshot,
};
use crate::domain::RoomCode;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellScreen {
    JoinByCode,
    ConversationList,
    Chat,
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
pub struct ConversationItem {
    pub room_id: Uuid,
    pub room_code: String,
    pub display_title: String,
    pub latest_preview: String,
    pub latest_message_at: Option<DateTime<Utc>>,
    pub show_unread_placeholder: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastOpenRoom {
    pub room_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RoomSearchState {
    query: String,
    results: Vec<RoomSearchResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTimelineState {
    room_id: Option<Uuid>,
    room_code: String,
    connection: ConnectionState,
    draft: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatState {
    session_id: Uuid,
    screen: ShellScreen,
    joined_rooms: Vec<ConversationItem>,
    last_open_room: Option<LastOpenRoom>,
    search: RoomSearchState,
    timeline: ChatTimelineState,
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
            screen: ShellScreen::JoinByCode,
            joined_rooms: Vec::new(),
            last_open_room: None,
            search: RoomSearchState::default(),
            timeline: ChatTimelineState {
                room_id: None,
                room_code: String::new(),
                connection: ConnectionState::Offline,
                draft: String::new(),
                messages: Vec::new(),
            },
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.session_id
    }

    pub fn apply_bootstrap_session(&mut self, session: BootstrapSession) {
        self.session_id = session.session_id;
    }

    pub fn screen(&self) -> ShellScreen {
        self.screen
    }

    pub fn joined_rooms(&self) -> &[ConversationItem] {
        &self.joined_rooms
    }

    pub fn search_query(&self) -> &str {
        &self.search.query
    }

    pub fn search_results(&self) -> &[RoomSearchResult] {
        &self.search.results
    }

    pub fn search_query_forms_complete_room_code(&self) -> bool {
        query_forms_complete_room_code(self.search_query())
    }

    // 这里只给壳层提供分组视图，成员归属真相仍以后端返回的 `is_joined` 为准。
    pub fn joined_search_results(&self) -> Vec<RoomSearchResult> {
        self.search
            .results
            .iter()
            .filter(|room| room.is_joined)
            .cloned()
            .collect()
    }

    pub fn discoverable_search_results(&self) -> Vec<RoomSearchResult> {
        self.search
            .results
            .iter()
            .filter(|room| !room.is_joined)
            .cloned()
            .collect()
    }

    pub fn room_id(&self) -> Option<Uuid> {
        self.timeline.room_id
    }

    pub fn room_code(&self) -> &str {
        &self.timeline.room_code
    }

    pub fn connection(&self) -> ConnectionState {
        self.timeline.connection
    }

    pub fn draft(&self) -> &str {
        &self.timeline.draft
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.timeline.messages
    }

    pub fn confirmed_messages(&self) -> Vec<&ChatMessage> {
        self.timeline
            .messages
            .iter()
            .filter(|message| message.delivery == DeliveryState::Confirmed)
            .collect()
    }

    pub fn apply_joined_rooms(&mut self, rooms: Vec<JoinedRoomSummary>) {
        self.joined_rooms = rooms
            .into_iter()
            .map(|room| ConversationItem {
                room_id: room.room_id,
                room_code: room.room_code,
                display_title: room.display_title,
                latest_preview: room.latest_preview,
                latest_message_at: room.latest_message_at,
                show_unread_placeholder: true,
            })
            .collect();

        if self.timeline.room_id.is_none() {
            self.screen = fallback_screen(&self.joined_rooms);
        }
    }

    pub fn restore_last_open_room(&mut self, room_id: Option<Uuid>) {
        let Some(room_id) = room_id else {
            self.last_open_room = None;
            self.clear_open_room();
            self.screen = fallback_screen(&self.joined_rooms);
            return;
        };

        let Some(room) = self
            .joined_rooms
            .iter()
            .find(|room| room.room_id == room_id)
        else {
            self.last_open_room = None;
            self.clear_open_room();
            self.screen = fallback_screen(&self.joined_rooms);
            return;
        };

        self.last_open_room = Some(LastOpenRoom { room_id });
        self.screen = ShellScreen::Chat;
        self.timeline.room_id = Some(room.room_id);
        self.timeline.room_code = room.room_code.clone();
        self.timeline.connection = ConnectionState::Offline;
        self.timeline.draft.clear();
        self.timeline.messages.clear();
    }

    pub fn open_room_from_snapshot(&mut self, snapshot: RoomSnapshot) {
        self.last_open_room = Some(LastOpenRoom {
            room_id: snapshot.room_id,
        });
        self.screen = ShellScreen::Chat;
        self.timeline.room_id = Some(snapshot.room_id);
        self.timeline.room_code = snapshot.room_code;
        self.timeline.connection = ConnectionState::Offline;
        self.timeline.draft.clear();
        self.timeline.messages = snapshot
            .messages
            .into_iter()
            .map(|message| snapshot_message(snapshot.room_id, message))
            .collect();
        self.sort_messages();
    }

    pub fn start_room_subscription(&mut self, room_id: Uuid) {
        if self.timeline.room_id == Some(room_id) {
            self.timeline.connection = ConnectionState::Joined;
        }
    }

    pub fn apply_subscription_refill_snapshot(&mut self, snapshot: RoomSnapshot) {
        if self.timeline.room_id != Some(snapshot.room_id) {
            return;
        }

        self.timeline.room_code = snapshot.room_code;
        for message in snapshot.messages {
            self.upsert_confirmed_message(snapshot_message(snapshot.room_id, message));
        }
        self.sort_messages();
    }

    pub fn apply_search_results(&mut self, results: Vec<RoomSearchResult>) {
        self.search.results = results;
    }

    pub fn set_search_query(&mut self, query: &str) {
        self.search.query = query.to_string();
    }

    pub fn set_draft(&mut self, draft: &str) {
        self.timeline.draft = draft.to_string();
    }

    pub fn clear_draft(&mut self) {
        self.timeline.draft.clear();
    }

    pub fn show_join_by_code(&mut self) {
        self.screen = ShellScreen::JoinByCode;
        self.timeline.room_id = None;
        self.timeline.room_code.clear();
        self.timeline.connection = ConnectionState::Offline;
        self.timeline.draft.clear();
        self.timeline.messages.clear();
    }

    pub fn enter_room(&mut self, snapshot: RoomSnapshot) {
        self.open_room_from_snapshot(snapshot);
        self.timeline.connection = ConnectionState::Joined;
    }

    pub fn enqueue_pending(&mut self, room_id: Uuid, session_id: Uuid, body: &str) -> Uuid {
        let pending_id = Uuid::now_v7();
        let body = body.trim().to_string();

        self.screen = ShellScreen::Chat;
        self.timeline.room_id = Some(room_id);
        self.timeline.messages.push(ChatMessage {
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
            && let Some(index) = self
                .timeline
                .messages
                .iter()
                .position(|message| message.client_message_id == Some(client_message_id))
        {
            self.timeline.messages[index].message_id = Some(event.message_id);
            self.timeline.messages[index].body = event.body;
            self.timeline.messages[index].created_at = event.created_at;
            self.timeline.messages[index].delivery = DeliveryState::Confirmed;
            self.remove_duplicate_message_id(event.message_id, Some(index));
            self.sort_messages();
            return;
        }

        if self.timeline.room_id != Some(event.room_id) {
            return;
        }

        self.upsert_confirmed_message(ChatMessage {
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
            .timeline
            .messages
            .iter_mut()
            .find(|message| message.client_message_id == Some(client_message_id))
        {
            message.delivery = DeliveryState::Failed;
        }
    }

    pub fn set_connection(&mut self, connection: ConnectionState) {
        self.timeline.connection = connection;
    }

    fn sort_messages(&mut self) {
        self.timeline.messages.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then(left.message_id.cmp(&right.message_id))
                .then(left.client_message_id.cmp(&right.client_message_id))
        });
    }

    fn upsert_confirmed_message(&mut self, message: ChatMessage) {
        if let Some(message_id) = message.message_id
            && let Some(existing) = self
                .timeline
                .messages
                .iter_mut()
                .find(|existing| existing.message_id == Some(message_id))
        {
            *existing = message;
            return;
        }

        self.timeline.messages.push(message);
    }

    fn clear_open_room(&mut self) {
        self.timeline.room_id = None;
        self.timeline.room_code.clear();
        self.timeline.connection = ConnectionState::Offline;
        self.timeline.draft.clear();
        self.timeline.messages.clear();
    }

    fn remove_duplicate_message_id(&mut self, message_id: Uuid, keep_index: Option<usize>) {
        self.timeline.messages.retain_with_index(|index, message| {
            if message.message_id != Some(message_id) {
                return true;
            }

            match keep_index {
                Some(keep_index) => index == keep_index,
                None => index == 0,
            }
        });
    }
}

fn snapshot_message(room_id: Uuid, message: crate::contract::MessageView) -> ChatMessage {
    ChatMessage {
        room_id,
        session_id: message.session_id,
        client_message_id: None,
        message_id: Some(message.message_id),
        body: message.body,
        created_at: message.created_at,
        delivery: DeliveryState::Confirmed,
    }
}

pub fn query_forms_complete_room_code(query: &str) -> bool {
    RoomCode::new(query).is_ok()
}

fn fallback_screen(joined_rooms: &[ConversationItem]) -> ShellScreen {
    if joined_rooms.is_empty() {
        ShellScreen::JoinByCode
    } else {
        ShellScreen::ConversationList
    }
}

trait RetainWithIndex<T> {
    fn retain_with_index(&mut self, predicate: impl FnMut(usize, &T) -> bool);
}

impl<T> RetainWithIndex<T> for Vec<T> {
    fn retain_with_index(&mut self, mut predicate: impl FnMut(usize, &T) -> bool) {
        let mut index = 0;
        self.retain(|item| {
            let keep = predicate(index, item);
            index += 1;
            keep
        });
    }
}
