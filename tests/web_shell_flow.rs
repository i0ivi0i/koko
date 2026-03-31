use chrono::{TimeZone, Utc};
use koko::{
    chat::{ChatState, ConnectionState, ShellScreen},
    contract::{BootstrapSession, JoinedRoomSummary, MessageView, RoomSearchResult, RoomSnapshot},
    web::{resolve_last_open_room_id, select_initial_screen, should_enter_join_flow},
};
use uuid::Uuid;

#[test]
fn boot_with_no_rooms_routes_to_join_flow() {
    let state = bootstrapped_state();

    assert!(should_enter_join_flow(state.joined_rooms()));
    assert_eq!(
        select_initial_screen(state.joined_rooms(), None),
        ShellScreen::JoinByCode
    );
}

#[test]
fn boot_with_rooms_routes_to_conversation_list() {
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(Uuid::from_u128(1), "A1234")]);

    assert!(!should_enter_join_flow(state.joined_rooms()));
    assert_eq!(
        select_initial_screen(state.joined_rooms(), None),
        ShellScreen::ConversationList
    );
}

#[test]
fn last_open_room_id_routes_directly_into_existing_chat() {
    let room_id = Uuid::from_u128(2);
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(room_id, "A1234")]);

    let restored_room_id = resolve_last_open_room_id(state.joined_rooms(), Some(room_id));
    state.restore_last_open_room(restored_room_id);

    assert_eq!(state.screen(), ShellScreen::Chat);
    assert_eq!(state.room_id(), Some(room_id));
    assert_eq!(state.room_code(), "A1234");
}

#[test]
fn stale_last_open_room_id_falls_back_to_list() {
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(Uuid::from_u128(3), "A1234")]);

    let restored_room_id = resolve_last_open_room_id(state.joined_rooms(), Some(Uuid::from_u128(4)));
    state.restore_last_open_room(restored_room_id);

    assert_eq!(state.screen(), ShellScreen::ConversationList);
    assert_eq!(state.room_id(), None);
}

#[test]
fn subscription_refill_merges_second_snapshot_without_duplicates() {
    let room_id = Uuid::from_u128(5);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![
            message_view(Uuid::from_u128(51), "first", 0),
            message_view(Uuid::from_u128(52), "second", 1),
        ],
    ));
    state.start_room_subscription(room_id);

    state.apply_subscription_refill_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![
            message_view(Uuid::from_u128(52), "second", 1),
            message_view(Uuid::from_u128(53), "third", 2),
        ],
    ));

    assert_eq!(state.connection(), ConnectionState::Joined);
    assert_eq!(
        state
            .messages()
            .iter()
            .filter_map(|message| message.message_id)
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(51), Uuid::from_u128(52), Uuid::from_u128(53)]
    );
}

#[test]
fn search_input_updates_without_mutating_remote_truth() {
    let room_id = Uuid::from_u128(6);
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(room_id, "A1234")]);
    state.apply_search_results(vec![search_result(Uuid::from_u128(7), "A1299", false)]);

    state.set_search_query("a12");

    assert_eq!(state.search_query(), "a12");
    assert_eq!(state.joined_rooms().len(), 1);
    assert_eq!(state.joined_rooms()[0].room_id, room_id);
    assert_eq!(state.search_results().len(), 1);
    assert_eq!(state.search_results()[0].room_code, "A1299");
}

#[test]
fn conversation_item_exposes_unread_placeholder_without_becoming_truth_source() {
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(Uuid::from_u128(8), "A1234")]);

    let conversation = &state.joined_rooms()[0];

    assert!(conversation.show_unread_placeholder);
    assert_eq!(conversation.display_title, "A1234");
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
