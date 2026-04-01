use chrono::{TimeZone, Utc};
use dioxus::prelude::VirtualDom;
use koko::{
    chat::ChatState,
    contract::{
        BootstrapSession, JoinedRoomSummary, MessageView, RoomSearchResult, RoomSnapshot,
    },
    view::{ChatPage, ChatPageProps},
};
use uuid::Uuid;

#[test]
fn conversation_list_exposes_navigation_search_and_conversation_regions() {
    let html = render_chat_page(conversation_list_state());

    assert!(html.contains("data-shell-screen=\"conversation-list\""));
    assert!(html.contains("role=\"navigation\""));
    assert!(html.contains("data-shell-region=\"room-search\""));
    assert!(html.contains("data-shell-region=\"conversation-list\""));
}

#[test]
fn join_by_code_exposes_back_navigation_search_and_results_regions() {
    let html = render_chat_page(join_by_code_state());

    assert!(html.contains("data-shell-screen=\"join-by-code\""));
    assert!(html.contains("data-shell-back=\"true\""));
    assert!(html.contains("data-shell-region=\"room-search\""));
    assert!(html.contains("data-shell-region=\"search-results\""));
}

#[test]
fn chat_screen_exposes_navigation_thread_and_composer_regions() {
    let html = render_chat_page(chat_screen_state());

    assert!(html.contains("data-shell-screen=\"chat\""));
    assert!(html.contains("role=\"navigation\""));
    assert!(html.contains("data-shell-region=\"message-thread\""));
    assert!(html.contains("data-shell-region=\"composer\""));
}

#[test]
fn conversation_list_drops_menu_and_tl_framing_for_embedded_ios_chrome() {
    let html = render_chat_page(conversation_list_state());

    assert!(!html.contains(">Menu<"));
    assert!(!html.contains(">TL<"));
    assert!(!html.contains("Search rooms"));
    assert!(html.contains("data-shell-region=\"top-bar-leading\""));
    assert!(html.contains("data-shell-region=\"top-bar-title\""));
    assert!(html.contains("data-shell-region=\"top-bar-trailing\""));
    assert!(html.contains("data-shell-search-style=\"embedded\""));
}

#[test]
fn search_and_chat_top_bars_share_the_same_structural_regions() {
    let join_html = render_chat_page(join_by_code_state());
    let chat_html = render_chat_page(chat_screen_state());

    for html in [join_html, chat_html] {
        assert!(html.contains("data-shell-region=\"top-bar-leading\""));
        assert!(html.contains("data-shell-region=\"top-bar-title\""));
        assert!(html.contains("data-shell-region=\"top-bar-trailing\""));
    }
}

#[test]
fn conversation_rows_expose_stable_avatar_content_and_meta_regions() {
    let html = render_chat_page(conversation_list_state());

    assert!(html.contains("data-shell-row=\"conversation\""));
    assert!(html.contains("data-conversation-region=\"avatar\""));
    assert!(html.contains("data-conversation-region=\"title\""));
    assert!(html.contains("data-conversation-region=\"preview\""));
    assert!(html.contains("data-conversation-region=\"time\""));
    assert!(html.contains("data-conversation-region=\"unread\""));
}

#[test]
fn conversation_rows_mark_keyboard_activation_support() {
    let html = render_chat_page(conversation_list_state());

    assert!(html.contains("data-shell-activatable=\"true\""));
}

#[test]
fn chat_screen_marks_thread_and_composer_subregions_for_telegram_shell() {
    let html = render_chat_page(chat_screen_state());

    assert!(html.contains("data-shell-region=\"message-thread\""));
    assert!(html.contains("class=\"tg-compose__field\""));
    assert!(html.contains("class=\"tg-compose__send\""));
    assert!(html.contains("aria-label=\"Send message\""));
}

#[test]
fn chat_send_control_stays_disabled_for_blank_draft() {
    let html = render_chat_page(chat_screen_state());

    assert!(
        html.contains(
            "class=\"tg-compose__send\" type=\"button\" aria-label=\"Send message\" disabled"
        )
    );
}

fn render_chat_page(state: ChatState) -> String {
    let mut vdom = VirtualDom::new_with_props(
        ChatPage,
        ChatPageProps {
            state,
            on_back_to_list: None,
            on_room_selected: None,
            on_search_input: None,
            on_search_result_selected: None,
            draft: String::new(),
            on_draft_input: None,
            on_send_message: None,
        },
    );
    vdom.rebuild_in_place();
    dioxus_ssr::render(&vdom)
}

fn conversation_list_state() -> ChatState {
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(Uuid::from_u128(1), "A1234")]);
    state
}

fn join_by_code_state() -> ChatState {
    let mut state = conversation_list_state();
    state.show_join_by_code();
    state.set_search_query("A12");
    state.apply_search_results(vec![search_result(Uuid::from_u128(2), "A1299", false)]);
    state
}

fn chat_screen_state() -> ChatState {
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        Uuid::from_u128(3),
        "A1234",
        vec![message_view(Uuid::from_u128(31), "hello koko", 0)],
    ));
    state
}

fn bootstrapped_state() -> ChatState {
    let mut state = ChatState::awaiting_bootstrap();
    state.apply_bootstrap_session(BootstrapSession {
        session_id: Uuid::from_u128(90),
        issued_at: fixed_time(),
        last_seen_at: fixed_time(),
    });
    state
}

fn joined_room(room_id: Uuid, room_code: &str) -> JoinedRoomSummary {
    JoinedRoomSummary {
        room_id,
        room_code: room_code.to_string(),
        display_title: room_code.to_string(),
        latest_preview: format!("{room_code} preview"),
        latest_message_at: Some(fixed_time()),
    }
}

fn search_result(room_id: Uuid, room_code: &str, is_joined: bool) -> RoomSearchResult {
    RoomSearchResult {
        room_id,
        room_code: room_code.to_string(),
        display_title: room_code.to_string(),
        latest_preview: format!("{room_code} preview"),
        latest_message_at: Some(fixed_time()),
        is_joined,
    }
}

fn room_snapshot(room_id: Uuid, room_code: &str, messages: Vec<MessageView>) -> RoomSnapshot {
    RoomSnapshot {
        room_id,
        room_code: room_code.to_string(),
        messages,
    }
}

fn message_view(message_id: Uuid, body: &str, minute_offset: i64) -> MessageView {
    MessageView {
        message_id,
        session_id: Uuid::from_u128(91),
        body: body.to_string(),
        created_at: Utc
            .timestamp_opt(fixed_time().timestamp() + minute_offset * 60, 0)
            .unwrap(),
    }
}

fn fixed_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}
