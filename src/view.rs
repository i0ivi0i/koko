use chrono::{DateTime, Utc};
use dioxus::prelude::*;

use crate::{
    admin::AdminPanelState,
    chat::{ChatMessage, ChatState, ConnectionState, ConversationItem, DeliveryState, ShellScreen},
    contract::AdminRoomSummary,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

#[component]
pub fn ChatPage(state: ChatState) -> Element {
    // 这里只做壳层分流，消息、成员、搜索结果都仍由 ChatState 提供真相。
    match state.screen() {
        ShellScreen::JoinByCode => rsx! { JoinByCodeScreen { state } },
        ShellScreen::ConversationList => rsx! { ConversationListScreen { state } },
        ShellScreen::Chat => rsx! { ChatScreen { state } },
    }
}

#[component]
fn ConversationListScreen(state: ChatState) -> Element {
    let room_count = state.joined_rooms().len();

    rsx! {
        div { class: "tg-shell tg-shell--list",
            ShellHeader {
                back_label: "Menu".to_string(),
                title: "Chats".to_string(),
                subtitle: format!("{room_count} joined rooms"),
                badge: "TL".to_string(),
            }
            section { class: "tg-shell__body tg-shell__body--list",
                div { class: "tg-shell__search-card",
                    div { class: "tg-shell__search-card-title", "Search rooms" }
                    div { class: "tg-shell__search-card-copy",
                        "Search by room code to jump into a room."
                    }
                }
                if room_count == 0 {
                    EmptyState {
                        title: "No conversations yet".to_string(),
                        body: "Open search and join a room to start chatting.".to_string(),
                    }
                } else {
                    div { class: "tg-chat-list",
                        for room in state.joined_rooms().iter().cloned() {
                            ConversationListItem { room }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn JoinByCodeScreen(state: ChatState) -> Element {
    let result_count = state.search_results().len();

    rsx! {
        div { class: "tg-shell tg-shell--search",
            ShellHeader {
                back_label: "Chats".to_string(),
                title: "Search".to_string(),
                subtitle: "Enter a room code".to_string(),
                badge: "TL".to_string(),
            }
            section { class: "tg-shell__body tg-shell__body--search",
                div { class: "tg-search-panel",
                    div { class: "tg-search-panel__label", "Room code" }
                    div { class: "tg-search-panel__field", "{search_query_or_placeholder(state.search_query())}" }
                    div { class: "tg-search-panel__hint",
                        "Case-insensitive prefix search over normalized room codes."
                    }
                }
                if result_count == 0 {
                    EmptyState {
                        title: "No matches yet".to_string(),
                        body: "Type a room code and matching rooms will appear here.".to_string(),
                    }
                } else {
                    div { class: "tg-search-results",
                        for result in state.search_results().iter().cloned() {
                            SearchResultItem { result }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn ChatScreen(state: ChatState) -> Element {
    let room_code = shell_room_code(state.room_code());

    rsx! {
        div { class: "tg-shell tg-shell--chat",
            ShellHeader {
                back_label: "Chats".to_string(),
                title: room_code.clone(),
                subtitle: connection_label(state.connection()).to_string(),
                badge: room_code.chars().next().unwrap_or('K').to_string(),
            }
            section { class: "tg-shell__body tg-shell__body--chat",
                if state.messages().is_empty() {
                    EmptyState {
                        title: "No messages yet".to_string(),
                        body: "Messages will appear here once the room timeline loads.".to_string(),
                    }
                } else {
                    div { class: "tg-thread",
                        for message in state.messages().iter().cloned() {
                            MessageBubble { message }
                        }
                    }
                }
            }
            footer { class: "tg-compose",
                div { class: "tg-compose__field",
                    span { class: "tg-compose__placeholder", "Message" }
                }
                button {
                    class: "tg-compose__send",
                    r#type: "button",
                    disabled: true,
                    "Send"
                }
            }
        }
    }
}

#[component]
fn ShellHeader(back_label: String, title: String, subtitle: String, badge: String) -> Element {
    rsx! {
        header { class: "tg-nav",
            div { class: "tg-nav__back", "{back_label}" }
            div { class: "tg-nav__title",
                div { class: "tg-nav__name", "{title}" }
                div { class: "tg-nav__meta", "{subtitle}" }
            }
            div { class: "tg-nav__avatar", "{badge}" }
        }
    }
}

#[component]
fn EmptyState(title: String, body: String) -> Element {
    rsx! {
        article { class: "tg-empty-state",
            div { class: "tg-empty-state__title", "{title}" }
            p { class: "tg-empty-state__body", "{body}" }
        }
    }
}

#[component]
fn ConversationListItem(room: ConversationItem) -> Element {
    let room_code = shell_room_code(&room.room_code);
    let latest_time = room.latest_message_at.map(format_clock).unwrap_or_default();
    let unread_label = if room.show_unread_placeholder {
        "Unread"
    } else {
        ""
    };

    rsx! {
        article { class: "tg-chat-card",
            div { class: "tg-chat-card__avatar", "{room_code.chars().next().unwrap_or('K')}" }
            div { class: "tg-chat-card__content",
                div { class: "tg-chat-card__title", "{room.display_title}" }
                div { class: "tg-chat-card__preview",
                    "{conversation_preview(&room.latest_preview)}"
                }
            }
            div { class: "tg-chat-card__meta",
                div { class: "tg-chat-card__time", "{latest_time}" }
                div { class: "tg-chat-card__unread", "{unread_label}" }
            }
        }
    }
}

#[component]
fn SearchResultItem(result: crate::contract::RoomSearchResult) -> Element {
    let room_code = shell_room_code(&result.room_code);

    rsx! {
        article { class: "tg-search-result",
            div { class: "tg-search-result__avatar", "{room_code.chars().next().unwrap_or('K')}" }
            div { class: "tg-search-result__content",
                div { class: "tg-search-result__title", "{result.display_title}" }
                div { class: "tg-search-result__preview",
                    "{conversation_preview(&result.latest_preview)}"
                }
            }
            div { class: "tg-search-result__meta",
                if result.is_joined {
                    div { class: "tg-search-result__chip tg-search-result__chip--joined", "Joined" }
                } else {
                    div { class: "tg-search-result__chip", "Open" }
                }
            }
        }
    }
}

#[component]
fn MessageBubble(message: ChatMessage) -> Element {
    rsx! {
        article { class: "{bubble_class(&message)}",
            div { class: "tg-bubble__body", "{message.body}" }
            div { class: "tg-bubble__meta",
                span { "{delivery_label(message.delivery)}" }
                span { "{format_clock(message.created_at)}" }
            }
        }
    }
}

fn bubble_class(message: &ChatMessage) -> &'static str {
    match message.delivery {
        DeliveryState::Pending => "tg-bubble tg-bubble--pending",
        DeliveryState::Confirmed => "tg-bubble tg-bubble--confirmed",
        DeliveryState::Failed => "tg-bubble tg-bubble--failed",
    }
}

fn connection_label(state: ConnectionState) -> &'static str {
    match state {
        ConnectionState::Offline => "Offline",
        ConnectionState::Connecting => "Connecting",
        ConnectionState::Joined => "Connected",
    }
}

fn delivery_label(state: DeliveryState) -> &'static str {
    match state {
        DeliveryState::Pending => "Sending",
        DeliveryState::Confirmed => "Delivered",
        DeliveryState::Failed => "Retry",
    }
}

fn search_query_or_placeholder(query: &str) -> String {
    if query.trim().is_empty() {
        "Type a room code".to_string()
    } else {
        query.to_string()
    }
}

fn conversation_preview(preview: &str) -> String {
    if preview.trim().is_empty() {
        "No preview yet".to_string()
    } else {
        preview.to_string()
    }
}

fn shell_room_code(room_code: &str) -> String {
    let trimmed = room_code.trim();
    if trimmed.is_empty() {
        "KOKO".to_string()
    } else {
        trimmed.to_string()
    }
}

fn format_clock(time: DateTime<Utc>) -> String {
    time.format("%H:%M").to_string()
}

#[component]
pub fn AdminPanel(state: AdminPanelState) -> Element {
    rsx! {
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div {
                    class: "admin-shell__eyebrow",
                    "Koko admin"
                }
                h1 { class: "admin-shell__title", "Read-only operations" }
                p {
                    class: "admin-shell__summary",
                    "{state.overview.room_count} rooms, {state.overview.member_count} members, {state.overview.message_count} messages"
                }
            }
            section { class: "admin-shell__stats",
                AdminStatCard { label: "Rooms", value: state.overview.room_count.to_string() }
                AdminStatCard { label: "Members", value: state.overview.member_count.to_string() }
                AdminStatCard { label: "Messages", value: state.overview.message_count.to_string() }
            }
            section { class: "admin-shell__list",
                div { class: "admin-shell__list-head",
                    h2 { "Active rooms" }
                    span { "{state.rooms.len()} tracked" }
                }
                for room in state.rooms {
                    AdminRoomCard { room: room.clone() }
                }
            }
        }
    }
}

#[component]
fn AdminStatCard(label: String, value: String) -> Element {
    rsx! {
        article { class: "admin-stat",
            div { class: "admin-stat__label", "{label}" }
            div { class: "admin-stat__value", "{value}" }
        }
    }
}

#[component]
fn AdminRoomCard(room: AdminRoomSummary) -> Element {
    rsx! {
        article { class: "admin-room",
            div { class: "admin-room__code", "{room.room_code}" }
            div { class: "admin-room__meta",
                "{room.member_count} members"
            }
            div { class: "admin-room__meta",
                "{room.message_count} messages"
            }
            div { class: "admin-room__preview", "{room.latest_preview}" }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_query_or_placeholder_falls_back_to_prompt() {
        assert_eq!(search_query_or_placeholder(""), "Type a room code");
        assert_eq!(search_query_or_placeholder("  "), "Type a room code");
    }

    #[test]
    fn search_query_or_placeholder_keeps_user_input() {
        assert_eq!(search_query_or_placeholder("a1234"), "a1234");
    }

    #[test]
    fn conversation_preview_uses_placeholder_when_empty() {
        assert_eq!(conversation_preview(""), "No preview yet");
        assert_eq!(conversation_preview("   "), "No preview yet");
    }

    #[test]
    fn shell_room_code_normalizes_empty_values() {
        assert_eq!(shell_room_code(""), "KOKO");
        assert_eq!(shell_room_code("  a1234  "), "a1234");
    }

    #[test]
    fn connection_label_keeps_shell_status_text_stable() {
        assert_eq!(connection_label(ConnectionState::Offline), "Offline");
        assert_eq!(connection_label(ConnectionState::Connecting), "Connecting");
        assert_eq!(connection_label(ConnectionState::Joined), "Connected");
    }
}
