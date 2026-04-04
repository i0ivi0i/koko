use chrono::{TimeZone, Utc};
use koko::{
    chat::{ChatState, ConnectionState, DeliveryState, ShellScreen},
    contract::{
        BootstrapSession, JoinedRoomSummary, MessageAccepted, MessageCreated, MessageView,
        RoomSearchResult, RoomSnapshot,
    },
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

    let restored_room_id =
        resolve_last_open_room_id(state.joined_rooms(), Some(Uuid::from_u128(4)));
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
        vec![
            Uuid::from_u128(51),
            Uuid::from_u128(52),
            Uuid::from_u128(53)
        ]
    );
}

#[test]
fn message_created_from_other_room_does_not_pollute_current_timeline() {
    let current_room_id = Uuid::from_u128(10);
    let other_room_id = Uuid::from_u128(11);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        current_room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(101), "current", 0)],
    ));

    state.confirm_message(message_created(
        other_room_id,
        Uuid::from_u128(102),
        "other room",
        1,
    ));

    assert_eq!(
        state
            .messages()
            .iter()
            .map(|message| (message.room_id, message.message_id, message.body.as_str()))
            .collect::<Vec<_>>(),
        vec![(
            current_room_id,
            Some(Uuid::from_u128(101)),
            "current"
        )]
    );
}

#[test]
fn message_created_for_current_room_appends_to_timeline() {
    let room_id = Uuid::from_u128(12);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(121), "first", 0)],
    ));

    state.confirm_message(message_created(room_id, Uuid::from_u128(122), "second", 1));

    assert_eq!(
        state
            .messages()
            .iter()
            .map(|message| (message.room_id, message.message_id, message.body.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (room_id, Some(Uuid::from_u128(121)), "first"),
            (room_id, Some(Uuid::from_u128(122)), "second"),
        ]
    );
    assert_eq!(state.confirmed_messages().len(), 2);
}

#[test]
fn send_message_keeps_pending_until_authoritative_message_created_arrives() {
    let room_id = Uuid::from_u128(14);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(room_id, "A1234", Vec::new()));

    let pending_id = state.enqueue_pending(room_id, state.session_id(), "  hello koko  ");

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.confirmed_messages().len(), 0);

    state.note_message_accepted(MessageAccepted {
        room_id,
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.confirmed_messages().len(), 0);

    state.confirm_message(MessageCreated {
        message_id: Uuid::from_u128(141),
        room_id,
        session_id: state.session_id(),
        body: "hello koko".to_string(),
        created_at: fixed_time(),
        event_position: 0,
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Confirmed);
    assert_eq!(state.messages()[0].message_id, Some(Uuid::from_u128(141)));
    assert_eq!(state.confirmed_messages().len(), 1);
}

#[test]
fn message_accepted_from_other_room_keeps_current_pending_unchanged() {
    let room_id = Uuid::from_u128(18);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(room_id, "A1234", Vec::new()));

    let pending_id = state.enqueue_pending(room_id, state.session_id(), " hello ");
    state.note_message_accepted(MessageAccepted {
        room_id: Uuid::from_u128(19),
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.confirmed_messages().len(), 0);
}

#[test]
fn refill_snapshot_does_not_duplicate_message_created_already_in_timeline() {
    let room_id = Uuid::from_u128(13);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(131), "first", 0)],
    ));

    state.confirm_message(message_created(room_id, Uuid::from_u128(132), "second", 1));

    state.apply_subscription_refill_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![
            message_view(Uuid::from_u128(132), "second", 1),
            message_view(Uuid::from_u128(133), "third", 2),
        ],
    ));

    assert_eq!(
        state
            .messages()
            .iter()
            .map(|message| message.message_id)
            .collect::<Vec<_>>(),
        vec![
            Some(Uuid::from_u128(131)),
            Some(Uuid::from_u128(132)),
            Some(Uuid::from_u128(133))
        ]
    );
}

#[test]
fn subscription_refill_then_realtime_event_does_not_duplicate_message() {
    let room_id = Uuid::from_u128(15);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(room_id, "A1234", Vec::new()));

    let pending_id = state.enqueue_pending(room_id, state.session_id(), "hello refill");
    state.apply_subscription_refill_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(151), "hello refill", 0)],
    ));

    state.confirm_message(MessageCreated {
        message_id: Uuid::from_u128(151),
        room_id,
        session_id: state.session_id(),
        body: "hello refill".to_string(),
        created_at: fixed_time(),
        event_position: 0,
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Confirmed);
    assert_eq!(state.messages()[0].message_id, Some(Uuid::from_u128(151)));
}

#[test]
fn stale_subscription_refill_for_previous_room_is_ignored() {
    let first_room_id = Uuid::from_u128(16);
    let second_room_id = Uuid::from_u128(17);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        first_room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(161), "first room", 0)],
    ));
    state.open_room_from_snapshot(room_snapshot(
        second_room_id,
        "B1234",
        vec![message_view(Uuid::from_u128(171), "second room", 1)],
    ));

    state.apply_subscription_refill_snapshot(room_snapshot(
        first_room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(162), "late refill", 2)],
    ));

    assert_eq!(state.room_id(), Some(second_room_id));
    assert_eq!(
        state
            .messages()
            .iter()
            .map(|message| (message.room_id, message.message_id))
            .collect::<Vec<_>>(),
        vec![(second_room_id, Some(Uuid::from_u128(171)))]
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

#[test]
fn joined_rooms_can_manually_enter_join_flow() {
    let mut state = bootstrapped_state();
    state.apply_joined_rooms(vec![joined_room(Uuid::from_u128(9), "A1234")]);

    state.show_join_by_code();

    assert_eq!(state.screen(), ShellScreen::JoinByCode);
    assert_eq!(state.joined_rooms().len(), 1);
    assert_eq!(state.room_id(), None);
}

#[test]
fn active_room_ignores_message_created_from_other_room() {
    let room_id = Uuid::from_u128(10);
    let other_room_id = Uuid::from_u128(11);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(
        room_id,
        "A1234",
        vec![message_view(Uuid::from_u128(101), "first", 0)],
    ));

    state.confirm_message(MessageCreated {
        message_id: Uuid::from_u128(102),
        room_id: other_room_id,
        session_id: Uuid::from_u128(91),
        body: "foreign".to_string(),
        created_at: fixed_time(),
        event_position: 0,
        client_message_id: None,
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].room_id, room_id);
}

#[test]
fn draft_is_local_shell_state_and_can_be_cleared_after_enqueue() {
    let room_id = Uuid::from_u128(12);
    let mut state = bootstrapped_state();
    state.open_room_from_snapshot(room_snapshot(room_id, "A1234", Vec::new()));
    state.set_draft("  hello koko  ");

    assert_eq!(state.draft(), "  hello koko  ");

    let session_id = state.session_id();
    let draft = state.draft().to_string();
    let pending_id = state.enqueue_pending(room_id, session_id, &draft);
    state.clear_draft();

    assert_eq!(state.draft(), "");
    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].client_message_id, Some(pending_id));
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.messages()[0].body, "hello koko");
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
        latest_event_position: 0,
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
        event_position: 0,
    }
}

fn message_created(
    room_id: Uuid,
    message_id: Uuid,
    body: &str,
    minute_offset: i64,
) -> koko::contract::MessageCreated {
    koko::contract::MessageCreated {
        message_id,
        room_id,
        session_id: Uuid::from_u128(91),
        body: body.to_string(),
        created_at: Utc
            .timestamp_opt(fixed_time().timestamp() + minute_offset * 60, 0)
            .unwrap(),
        event_position: 0,
        client_message_id: None,
    }
}

fn fixed_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
}
