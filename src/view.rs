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
    #[props(default)] on_submit_room_code: Option<EventHandler<()>>,
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
                on_submit_room_code,
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
    #[props(default)] on_submit_room_code: Option<EventHandler<()>>,
) -> Element {
    let joined_results = state.joined_search_results();
    let discoverable_results = state.discoverable_search_results();
    let can_submit_room_code = state.search_query_forms_complete_room_code();
    let has_results = !joined_results.is_empty() || !discoverable_results.is_empty();

    rsx! {
        div {
            class: "tg-shell tg-shell--search",
            "data-shell-screen": "join-by-code",
            "data-shell-frame": "phone",
            ShellHeader {
                shows_back: true,
                back_label: "聊天".to_string(),
                title: "搜索".to_string(),
                subtitle: "搜索已存在房间".to_string(),
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
                        hint: "搜索已存在房间，或输入完整房间码直接进入".to_string(),
                        on_input: on_search_input,
                    }
                }
                if can_submit_room_code {
                    div { class: "tg-search-panel__actions",
                        button {
                            class: "tg-search__action tg-search__action--primary",
                            r#type: "button",
                            disabled: on_submit_room_code.is_none(),
                            onclick: move |_| {
                                if let Some(handler) = on_submit_room_code.as_ref() {
                                    handler.call(());
                                }
                            },
                            "进入房间"
                        }
                    }
                }
                if !has_results {
                    EmptyState {
                        title: "没有已存在的匹配房间".to_string(),
                        body: "完整房间码可直接进入，不存在时会创建新房间。".to_string(),
                    }
                } else {
                    div {
                        class: "tg-search-results",
                        role: "list",
                        "data-shell-region": "search-results",
                        if !joined_results.is_empty() {
                            section { class: "tg-search-section", "data-search-section": "joined",
                                div { class: "tg-search-section__title", "我已加入" }
                                for result in joined_results {
                                    SearchResultItem {
                                        result,
                                        on_select: on_search_result_selected,
                                    }
                                }
                            }
                        }
                        if !discoverable_results.is_empty() {
                            section {
                                class: "tg-search-section",
                                "data-search-section": "discoverable",
                                div { class: "tg-search-section__title", "可加入房间" }
                                for result in discoverable_results {
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
    let send_enabled = can_send_message(
        state.connection(),
        &draft,
        on_send_message.is_some(),
    );

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
                    disabled: !send_enabled,
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

fn can_send_message(
    connection: ConnectionState,
    draft: &str,
    has_send_handler: bool,
) -> bool {
    // sender 的权威 message_created 会直接回到当前 socket，发送资格不应被订阅 ack 反向绑死。
    has_send_handler
        && matches!(connection, ConnectionState::Connecting | ConnectionState::Joined)
        && !draft.trim().is_empty()
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
    use crate::contract::RoomSnapshot;
    use dioxus::{
        html::{
            AnimationData, CancelData, ClipboardData, CompositionData, DragData, FileData,
            FocusData, FormData, FormValue, HasFileData, HasFormData, HasMouseData,
            HtmlEventConverter, ImageData, InteractionElementOffset, InteractionLocation,
            KeyboardData, MediaData, ModifiersInteraction, MountedData, MouseData, PointerData,
            PointerInteraction, PlatformEventData, ResizeData, ScrollData, SelectionData,
            ToggleData, TouchData, TransitionData, VisibleData, WheelData, geometry::*,
            input_data::{MouseButton, MouseButtonSet},
            keyboard_types::Modifiers,
            set_event_converter,
        },
        prelude::{Event, Props, VirtualDom},
    };
    use dioxus_core::{ElementId, Mutation, Mutations};
    use std::{
        any::Any,
        rc::Rc,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };
    use uuid::Uuid;

    #[derive(Props, Clone)]
    struct InteractiveChatHarnessProps {
        draft_inputs: Arc<Mutex<Vec<String>>>,
        send_count: Arc<AtomicUsize>,
    }

    impl PartialEq for InteractiveChatHarnessProps {
        fn eq(&self, other: &Self) -> bool {
            Arc::ptr_eq(&self.draft_inputs, &other.draft_inputs)
                && Arc::ptr_eq(&self.send_count, &other.send_count)
        }
    }

    #[derive(Clone)]
    struct TestFormPlatformEvent {
        value: String,
    }

    impl HasFileData for TestFormPlatformEvent {
        fn files(&self) -> Vec<FileData> {
            Vec::new()
        }
    }

    impl HasFormData for TestFormPlatformEvent {
        fn value(&self) -> String {
            self.value.clone()
        }

        fn valid(&self) -> bool {
            true
        }

        fn values(&self) -> Vec<(String, FormValue)> {
            Vec::new()
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[derive(Clone, Default)]
    struct TestMousePlatformEvent;

    impl InteractionLocation for TestMousePlatformEvent {
        fn client_coordinates(&self) -> ClientPoint {
            ClientPoint::new(0.0, 0.0)
        }

        fn screen_coordinates(&self) -> ScreenPoint {
            ScreenPoint::new(0.0, 0.0)
        }

        fn page_coordinates(&self) -> PagePoint {
            PagePoint::new(0.0, 0.0)
        }
    }

    impl InteractionElementOffset for TestMousePlatformEvent {
        fn element_coordinates(&self) -> ElementPoint {
            ElementPoint::new(0.0, 0.0)
        }
    }

    impl ModifiersInteraction for TestMousePlatformEvent {
        fn modifiers(&self) -> Modifiers {
            Modifiers::empty()
        }
    }

    impl PointerInteraction for TestMousePlatformEvent {
        fn trigger_button(&self) -> Option<MouseButton> {
            Some(MouseButton::Primary)
        }

        fn held_buttons(&self) -> MouseButtonSet {
            MouseButtonSet::empty()
        }
    }

    impl HasMouseData for TestMousePlatformEvent {
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    struct TestHtmlEventConverter;

    impl HtmlEventConverter for TestHtmlEventConverter {
        fn convert_animation_data(&self, _: &PlatformEventData) -> AnimationData {
            unreachable!("animation data is not used in this test")
        }

        fn convert_cancel_data(&self, _: &PlatformEventData) -> CancelData {
            unreachable!("cancel data is not used in this test")
        }

        fn convert_clipboard_data(&self, _: &PlatformEventData) -> ClipboardData {
            unreachable!("clipboard data is not used in this test")
        }

        fn convert_composition_data(&self, _: &PlatformEventData) -> CompositionData {
            unreachable!("composition data is not used in this test")
        }

        fn convert_drag_data(&self, _: &PlatformEventData) -> DragData {
            unreachable!("drag data is not used in this test")
        }

        fn convert_focus_data(&self, _: &PlatformEventData) -> FocusData {
            unreachable!("focus data is not used in this test")
        }

        fn convert_form_data(&self, event: &PlatformEventData) -> FormData {
            let input = event
                .downcast::<TestFormPlatformEvent>()
                .unwrap_or_else(|| panic!("missing test form payload"));
            FormData::new(input.clone())
        }

        fn convert_image_data(&self, _: &PlatformEventData) -> ImageData {
            unreachable!("image data is not used in this test")
        }

        fn convert_keyboard_data(&self, _: &PlatformEventData) -> KeyboardData {
            unreachable!("keyboard data is not used in this test")
        }

        fn convert_media_data(&self, _: &PlatformEventData) -> MediaData {
            unreachable!("media data is not used in this test")
        }

        fn convert_mounted_data(&self, _: &PlatformEventData) -> MountedData {
            unreachable!("mounted data is not used in this test")
        }

        fn convert_mouse_data(&self, event: &PlatformEventData) -> MouseData {
            let input = event
                .downcast::<TestMousePlatformEvent>()
                .unwrap_or_else(|| panic!("missing test mouse payload"));
            MouseData::new(input.clone())
        }

        fn convert_pointer_data(&self, _: &PlatformEventData) -> PointerData {
            unreachable!("pointer data is not used in this test")
        }

        fn convert_resize_data(&self, _: &PlatformEventData) -> ResizeData {
            unreachable!("resize data is not used in this test")
        }

        fn convert_scroll_data(&self, _: &PlatformEventData) -> ScrollData {
            unreachable!("scroll data is not used in this test")
        }

        fn convert_selection_data(&self, _: &PlatformEventData) -> SelectionData {
            unreachable!("selection data is not used in this test")
        }

        fn convert_toggle_data(&self, _: &PlatformEventData) -> ToggleData {
            unreachable!("toggle data is not used in this test")
        }

        fn convert_touch_data(&self, _: &PlatformEventData) -> TouchData {
            unreachable!("touch data is not used in this test")
        }

        fn convert_transition_data(&self, _: &PlatformEventData) -> TransitionData {
            unreachable!("transition data is not used in this test")
        }

        fn convert_visible_data(&self, _: &PlatformEventData) -> VisibleData {
            unreachable!("visible data is not used in this test")
        }

        fn convert_wheel_data(&self, _: &PlatformEventData) -> WheelData {
            unreachable!("wheel data is not used in this test")
        }
    }

    fn interactive_chat_state(connection: ConnectionState) -> ChatState {
        let mut state = ChatState::awaiting_bootstrap();
        state.open_room_from_snapshot(RoomSnapshot {
            room_id: Uuid::from_u128(1),
            room_code: "A1234".to_string(),
            latest_event_position: 0,
            messages: Vec::new(),
        });
        state.set_connection(connection);
        state
    }

    fn element_id_with_listener(edits: &[Mutation], event_name: &str) -> ElementId {
        edits
            .iter()
            .find_map(|edit| match edit {
                Mutation::NewEventListener { name, id } if name == event_name => Some(*id),
                _ => None,
            })
            .unwrap_or_else(|| panic!("missing listener for `{event_name}`"))
    }

    fn interactive_chat_harness(props: InteractiveChatHarnessProps) -> Element {
        let draft_inputs = props.draft_inputs.clone();
        let send_count = props.send_count.clone();

        rsx! {
            ChatScreen {
                state: interactive_chat_state(ConnectionState::Connecting),
                draft: "hello koko".to_string(),
                on_draft_input: move |value| {
                    draft_inputs.lock().unwrap().push(value);
                },
                on_send_message: move |_| {
                    send_count.fetch_add(1, Ordering::SeqCst);
                },
            }
        }
    }

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
    fn send_control_allows_connecting_room_before_subscription_ack() {
        assert!(can_send_message(ConnectionState::Connecting, "hello", true));
        assert!(can_send_message(ConnectionState::Joined, "hello", true));
    }

    #[test]
    fn send_control_requires_non_empty_draft_and_handler() {
        assert!(!can_send_message(ConnectionState::Joined, "   ", true));
        assert!(!can_send_message(ConnectionState::Joined, "hello", false));
    }

    #[test]
    fn chat_screen_forwards_draft_input_and_send_click_events() {
        set_event_converter(Box::new(TestHtmlEventConverter));

        let captured_drafts = Arc::new(Mutex::new(Vec::<String>::new()));
        let send_count = Arc::new(AtomicUsize::new(0));
        let mut dom = VirtualDom::new_with_props(
            interactive_chat_harness,
            InteractiveChatHarnessProps {
                draft_inputs: captured_drafts.clone(),
                send_count: send_count.clone(),
            },
        );
        let mut mutations = Mutations::default();
        dom.rebuild(&mut mutations);

        let input_id = element_id_with_listener(&mutations.edits, "input");
        let send_id = element_id_with_listener(&mutations.edits, "click");

        let input_event = Event::new(
            Rc::new(PlatformEventData::new(Box::new(TestFormPlatformEvent {
                value: "new draft".to_string(),
            }))) as Rc<dyn Any>,
            true,
        );
        dom.runtime().handle_event("input", input_event, input_id);

        let click_event = Event::new(
            Rc::new(PlatformEventData::new(Box::new(TestMousePlatformEvent))) as Rc<dyn Any>,
            true,
        );
        dom.runtime().handle_event("click", click_event, send_id);

        assert_eq!(captured_drafts.lock().unwrap().as_slice(), &["new draft"]);
        assert_eq!(send_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn row_activation_keys_accept_enter_and_space_only() {
        assert!(is_row_activation_key(&Key::Enter));
        assert!(is_row_activation_key(&Key::Character(" ".into())));
        assert!(!is_row_activation_key(&Key::Escape));
    }
}
