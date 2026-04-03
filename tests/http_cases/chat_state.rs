use super::*;

#[test]
fn web_state_promotes_pending_message_only_after_server_confirmation() {
    let mut state = ChatState::default();
    let room_id = Uuid::from_u128(90);
    let session_id = Uuid::from_u128(91);
    let pending_id = state.enqueue_pending(room_id, session_id, " hello koko ");

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.messages()[0].body, "hello koko");
    assert!(state.confirmed_messages().is_empty());

    state.confirm_message(MessageCreated {
        message_id: Uuid::from_u128(92),
        room_id,
        session_id,
        body: "hello koko".to_string(),
        created_at: chrono::Utc::now(),
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Confirmed);
    assert_eq!(state.messages()[0].message_id, Some(Uuid::from_u128(92)));
    assert_eq!(state.confirmed_messages().len(), 1);
}

#[test]
fn web_state_applies_bootstrap_session_without_joining_room() {
    let mut state = ChatState::awaiting_bootstrap();
    let session = BootstrapSession {
        session_id: Uuid::from_u128(93),
        issued_at: chrono::Utc::now(),
        last_seen_at: chrono::Utc::now(),
    };

    state.apply_bootstrap_session(session.clone());

    assert_eq!(state.session_id(), session.session_id);
    assert_eq!(state.connection(), ConnectionState::Offline);
    assert_eq!(state.room_id(), None);
    assert!(state.messages().is_empty());
}

#[test]
fn web_bootstrap_state_applies_backend_session_to_chat_state() {
    let session = BootstrapSession {
        session_id: Uuid::from_u128(94),
        issued_at: chrono::Utc::now(),
        last_seen_at: chrono::Utc::now(),
    };

    let state = koko::web::bootstrap_state(session.clone());

    assert_eq!(state.session_id(), session.session_id);
    assert_eq!(state.connection(), ConnectionState::Offline);
    assert_eq!(state.room_id(), None);
    assert!(state.messages().is_empty());
}

#[test]
fn search_query_can_report_when_it_forms_a_complete_room_code() {
    let mut state = ChatState::awaiting_bootstrap();

    state.set_search_query("A1234");
    assert!(state.search_query_forms_complete_room_code());

    state.set_search_query("A12");
    assert!(!state.search_query_forms_complete_room_code());
}

#[test]
fn search_results_split_into_joined_and_discoverable_sections() {
    let mut state = ChatState::awaiting_bootstrap();
    state.apply_search_results(vec![
        RoomSearchResult {
            room_id: Uuid::from_u128(1),
            room_code: "A1234".to_string(),
            display_title: "A1234".to_string(),
            latest_preview: "joined".to_string(),
            latest_message_at: None,
            is_joined: true,
        },
        RoomSearchResult {
            room_id: Uuid::from_u128(2),
            room_code: "A1299".to_string(),
            display_title: "A1299".to_string(),
            latest_preview: "discover".to_string(),
            latest_message_at: None,
            is_joined: false,
        },
    ]);

    assert_eq!(state.joined_search_results().len(), 1);
    assert_eq!(state.discoverable_search_results().len(), 1);
}

