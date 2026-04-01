use chrono::{DateTime, Utc};
use dioxus::prelude::*;
use uuid::Uuid;

use crate::{
    admin::AdminPanelState,
    chat::{ChatMessage, ChatState, ConnectionState, ConversationItem, DeliveryState, ShellScreen},
    contract::{AdminRoomSummary, RoomSearchResult},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

#[component]
pub fn ChatPage(
    state: ChatState,
    #[props(default)] on_back_to_list: Option<EventHandler<()>>,
    #[props(default)] on_room_selected: Option<EventHandler<Uuid>>,
    #[props(default)] on_search_input: Option<EventHandler<String>>,
    #[props(default)] on_search_result_selected: Option<EventHandler<RoomSearchResult>>,
    #[props(default)] draft: String,
    #[props(default)] on_draft_input: Option<EventHandler<String>>,
    #[props(default)] on_send_message: Option<EventHandler<()>>,
) -> Element {
    // 这里只做壳层分流，消息、成员、搜索结果都仍由 ChatState 提供真相。
    match state.screen() {
        ShellScreen::JoinByCode => rsx! {
            JoinByCodeScreen {
                state,
                on_back_to_list,
                on_search_input,
                on_search_result_selected,
            }
        },
        ShellScreen::ConversationList => rsx! {
            ConversationListScreen {
                state,
                on_room_selected,
                on_search_input,
            }
        },
        ShellScreen::Chat => rsx! {
            ChatScreen {
                state,
                on_back_to_list,
                draft,
                on_draft_input,
                on_send_message,
            }
        },
    }
}

#[component]
fn ConversationListScreen(
    state: ChatState,
    #[props(default)] on_room_selected: Option<EventHandler<Uuid>>,
    #[props(default)] on_search_input: Option<EventHandler<String>>,
) -> Element {
    let room_count = state.joined_rooms().len();

    rsx! {
        div {
            class: "tg-shell tg-shell--list",
            "data-shell-screen": "conversation-list",
            "data-shell-frame": "phone",
            ShellHeader {
                shows_back: false,
                back_label: String::new(),
                title: "聊天".to_string(),
                subtitle: format!("已加入 {room_count} 个房间"),
                shows_compose_action: true,
                on_back_to_list: None,
            }
            section { class: "tg-shell__body tg-shell__body--list",
                div {
                    class: "tg-shell__search-card",
                    role: "search",
                    "data-shell-region": "room-search",
                    "data-shell-search-style": "embedded",
                    RoomSearchBar {
                        value: state.search_query().to_string(),
                        placeholder: "按房间码搜索".to_string(),
                        hint: String::new(),
                        on_input: on_search_input,
                    }
                }
                if room_count == 0 {
                    EmptyState {
                        title: "还没有聊天".to_string(),
                        body: "先搜索并加入一个房间，再开始聊天。".to_string(),
                    }
                } else {
                    div {
                        class: "tg-chat-list",
                        role: "list",
                        "data-shell-region": "conversation-list",
                        for room in state.joined_rooms().iter().cloned() {
                            ConversationListItem {
                                room,
                                on_select: on_room_selected,
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn JoinByCodeScreen(
    state: ChatState,
    #[props(default)] on_back_to_list: Option<EventHandler<()>>,
    #[props(default)] on_search_input: Option<EventHandler<String>>,
    #[props(default)] on_search_result_selected: Option<EventHandler<RoomSearchResult>>,
) -> Element {
    let result_count = state.search_results().len();

    rsx! {
        div {
            class: "tg-shell tg-shell--search",
            "data-shell-screen": "join-by-code",
            "data-shell-frame": "phone",
            ShellHeader {
                shows_back: true,
                back_label: "聊天".to_string(),
                title: "搜索".to_string(),
                subtitle: "输入房间码".to_string(),
                shows_compose_action: false,
                on_back_to_list,
            }
            section { class: "tg-shell__body tg-shell__body--search",
                div {
                    class: "tg-search-panel",
                    role: "search",
                    "data-shell-region": "room-search",
                    "data-shell-search-style": "embedded",
                    RoomSearchBar {
                        value: state.search_query().to_string(),
                        placeholder: "输入房间码".to_string(),
                        hint: String::new(),
                        on_input: on_search_input,
                    }
                }
                if result_count == 0 {
                    EmptyState {
                        title: "还没有匹配结果".to_string(),
                        body: "输入房间码后，匹配的房间会显示在这里。".to_string(),
                    }
                } else {
                    div {
                        class: "tg-search-results",
                        role: "list",
                        "data-shell-region": "search-results",
                        for result in state.search_results().iter().cloned() {
                            SearchResultItem {
                                result,
                                on_select: on_search_result_selected,
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn ChatScreen(
    state: ChatState,
    #[props(default)] on_back_to_list: Option<EventHandler<()>>,
    #[props(default)] draft: String,
    #[props(default)] on_draft_input: Option<EventHandler<String>>,
    #[props(default)] on_send_message: Option<EventHandler<()>>,
) -> Element {
    let room_code = shell_room_code(state.room_code());

    rsx! {
        div {
            class: "tg-shell tg-shell--chat",
            "data-shell-screen": "chat",
            "data-shell-frame": "phone",
            ShellHeader {
                shows_back: true,
                back_label: "聊天".to_string(),
                title: room_code.clone(),
                subtitle: connection_label(state.connection()).to_string(),
                shows_compose_action: false,
                on_back_to_list,
            }
            section { class: "tg-shell__body tg-shell__body--chat",
                if state.messages().is_empty() {
                    EmptyState {
                        title: "还没有消息".to_string(),
                        body: "房间消息加载完成后，会显示在这里。".to_string(),
                    }
                } else {
                    div {
                        class: "tg-thread",
                        "data-shell-region": "message-thread",
                        for message in state.messages().iter().cloned() {
                            MessageBubble { message }
                        }
                    }
                }
            }
            footer {
                class: "tg-compose",
                "data-shell-region": "composer",
                div { class: "tg-compose__field",
                    input {
                        class: "tg-compose__input",
                        r#type: "text",
                        value: "{draft}",
                        placeholder: "输入消息",
                        readonly: on_draft_input.is_none(),
                        disabled: on_draft_input.is_none(),
                        oninput: move |event| {
                            if let Some(handler) = on_draft_input.as_ref() {
                                handler.call(event.value());
                            }
                        },
                    }
                }
                button {
                    class: "tg-compose__send",
                    r#type: "button",
                    "aria-label": "发送消息",
                    disabled: on_send_message.is_none() || draft.trim().is_empty(),
                    onclick: move |_| {
                        if let Some(handler) = on_send_message.as_ref() {
                            handler.call(());
                        }
                    },
                    "↑"
                }
            }
        }
    }
}

#[component]
fn ShellHeader(
    shows_back: bool,
    back_label: String,
    title: String,
    subtitle: String,
    shows_compose_action: bool,
    #[props(default)] on_back_to_list: Option<EventHandler<()>>,
) -> Element {
    rsx! {
        header {
            class: "tg-nav",
            role: "navigation",
            "data-shell-back": if shows_back { "true" } else { "false" },
            div { class: "tg-nav__leading", "data-shell-region": "top-bar-leading",
                if shows_back {
                    button {
                        class: "tg-nav__back",
                        r#type: "button",
                        disabled: on_back_to_list.is_none(),
                        onclick: move |_| {
                            if let Some(handler) = on_back_to_list.as_ref() {
                                handler.call(());
                            }
                        },
                        "{back_label}"
                    }
                } else {
                    div { class: "tg-nav__leading-spacer", "aria-hidden": "true" }
                }
            }
            div { class: "tg-nav__title", "data-shell-region": "top-bar-title",
                div { class: "tg-nav__name", "{title}" }
                div { class: "tg-nav__meta", "{subtitle}" }
            }
            div { class: "tg-nav__trailing", "data-shell-region": "top-bar-trailing",
                if shows_compose_action {
                    div { class: "tg-nav__action", "aria-hidden": "true", "+" }
                } else {
                    div { class: "tg-nav__trailing-spacer", "aria-hidden": "true" }
                }
            }
        }
    }
}

#[component]
fn RoomSearchBar(
    value: String,
    placeholder: String,
    hint: String,
    #[props(default)] on_input: Option<EventHandler<String>>,
) -> Element {
    rsx! {
        div { class: "tg-search-panel__field",
            span { class: "tg-search-panel__icon", "aria-hidden": "true", "⌕" }
            input {
                class: "tg-search-panel__input",
                r#type: "search",
                value: "{value}",
                placeholder: "{placeholder}",
                readonly: on_input.is_none(),
                disabled: on_input.is_none(),
                oninput: move |event| {
                    if let Some(handler) = on_input.as_ref() {
                        handler.call(event.value());
                    }
                },
            }
        }
        if !hint.trim().is_empty() {
            div { class: "tg-search-panel__hint", "{hint}" }
        }
    }
}

#[component]
fn EmptyState(title: String, body: String) -> Element {
    rsx! {
        article {
            class: "tg-empty-state",
            "data-shell-region": "empty-state",
            "data-empty-style": "shell",
            div { class: "tg-empty-state__title", "{title}" }
            p { class: "tg-empty-state__body", "{body}" }
        }
    }
}

#[component]
fn ConversationListItem(
    room: ConversationItem,
    #[props(default)] on_select: Option<EventHandler<Uuid>>,
) -> Element {
    let room_code = shell_room_code(&room.room_code);
    let latest_time = room.latest_message_at.map(format_clock).unwrap_or_default();
    let unread_label = if room.show_unread_placeholder {
        "未读"
    } else {
        ""
    };

    rsx! {
        article {
            class: "tg-chat-card",
            role: "button",
            tabindex: "0",
            "data-shell-row": "conversation",
            "data-shell-activatable": "true",
            onclick: move |_| {
                if let Some(handler) = on_select.as_ref() {
                    handler.call(room.room_id);
                }
            },
            onkeydown: move |event| {
                if let Some(handler) = on_select.as_ref()
                    && is_row_activation_key(&event.key())
                {
                    event.prevent_default();
                    handler.call(room.room_id);
                }
            },
            div {
                class: "tg-chat-card__avatar",
                "data-conversation-region": "avatar",
                "{room_code.chars().next().unwrap_or('K')}"
            }
            div { class: "tg-chat-card__content",
                div {
                    class: "tg-chat-card__title",
                    "data-conversation-region": "title",
                    "{room.display_title}"
                }
                div {
                    class: "tg-chat-card__preview",
                    "data-conversation-region": "preview",
                    "{conversation_preview(&room.latest_preview)}"
                }
            }
            div { class: "tg-chat-card__meta",
                div {
                    class: "tg-chat-card__time",
                    "data-conversation-region": "time",
                    "{latest_time}"
                }
                div {
                    class: "tg-chat-card__unread",
                    "data-conversation-region": "unread",
                    "{unread_label}"
                }
            }
        }
    }
}

#[component]
fn SearchResultItem(
    result: RoomSearchResult,
    #[props(default)] on_select: Option<EventHandler<RoomSearchResult>>,
) -> Element {
    let room_code = shell_room_code(&result.room_code);

    rsx! {
        article {
            class: "tg-search-result",
            role: "button",
            tabindex: "0",
            onclick: move |_| {
                if let Some(handler) = on_select.as_ref() {
                    handler.call(result.clone());
                }
            },
            div { class: "tg-search-result__avatar", "{room_code.chars().next().unwrap_or('K')}" }
            div { class: "tg-search-result__content",
                div { class: "tg-search-result__title", "{result.display_title}" }
                div { class: "tg-search-result__preview",
                    "{conversation_preview(&result.latest_preview)}"
                }
            }
            div { class: "tg-search-result__meta",
                if result.is_joined {
                    div { class: "tg-search-result__chip tg-search-result__chip--joined", "已加入" }
                } else {
                    div { class: "tg-search-result__chip", "进入" }
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
        ConnectionState::Offline => "未连接",
        ConnectionState::Connecting => "连接中",
        ConnectionState::Joined => "已连接",
    }
}

fn delivery_label(state: DeliveryState) -> &'static str {
    match state {
        DeliveryState::Pending => "发送中",
        DeliveryState::Confirmed => "已送达",
        DeliveryState::Failed => "发送失败",
    }
}

fn conversation_preview(preview: &str) -> String {
    if preview.trim().is_empty() {
        "暂无消息预览".to_string()
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

fn is_row_activation_key(key: &Key) -> bool {
    matches!(key, Key::Enter) || matches!(key, Key::Character(value) if value == " ")
}

#[component]
pub fn AdminPanel(state: AdminPanelState) -> Element {
    rsx! {
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div {
                    class: "admin-shell__eyebrow",
                    "Koko 管理台"
                }
                h1 { class: "admin-shell__title", "只读运维视图" }
                p {
                    class: "admin-shell__summary",
                    "{state.overview.room_count} 个房间，{state.overview.member_count} 位成员，{state.overview.message_count} 条消息"
                }
            }
            section { class: "admin-shell__stats",
                AdminStatCard { label: "房间", value: state.overview.room_count.to_string() }
                AdminStatCard { label: "成员", value: state.overview.member_count.to_string() }
                AdminStatCard { label: "消息", value: state.overview.message_count.to_string() }
            }
            section { class: "admin-shell__list",
                div { class: "admin-shell__list-head",
                    h2 { "活跃房间" }
                    span { "已追踪 {state.rooms.len()} 个" }
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
                "{room.member_count} 位成员"
            }
            div { class: "admin-room__meta",
                "{room.message_count} 条消息"
            }
            div { class: "admin-room__preview", "{room.latest_preview}" }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_preview_uses_placeholder_when_empty() {
        assert_eq!(conversation_preview(""), "暂无消息预览");
        assert_eq!(conversation_preview("   "), "暂无消息预览");
    }

    #[test]
    fn shell_room_code_normalizes_empty_values() {
        assert_eq!(shell_room_code(""), "KOKO");
        assert_eq!(shell_room_code("  a1234  "), "a1234");
    }

    #[test]
    fn connection_label_keeps_shell_status_text_stable() {
        assert_eq!(connection_label(ConnectionState::Offline), "未连接");
        assert_eq!(connection_label(ConnectionState::Connecting), "连接中");
        assert_eq!(connection_label(ConnectionState::Joined), "已连接");
    }

    #[test]
    fn row_activation_keys_accept_enter_and_space_only() {
        assert!(is_row_activation_key(&Key::Enter));
        assert!(is_row_activation_key(&Key::Character(" ".into())));
        assert!(!is_row_activation_key(&Key::Escape));
    }
}
