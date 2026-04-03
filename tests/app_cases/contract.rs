use super::*;

#[test]
fn app_error_code_serializes_to_stable_wire_value() {
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidSession).unwrap(),
        "\"invalid_session\""
    );
    assert_eq!(
        serde_json::to_string(&AppErrorCode::InvalidAdminToken).unwrap(),
        "\"invalid_admin_token\""
    );
}

#[test]
fn app_event_serializes_to_tagged_wire_format() {
    let json = serde_json::to_string(&AppEvent::MessageCreated(koko::contract::MessageCreated {
        message_id: Uuid::from_u128(1),
        room_id: Uuid::from_u128(2),
        session_id: Uuid::from_u128(3),
        body: "hello".to_string(),
        created_at: fixed_time(),
        client_message_id: Some(Uuid::from_u128(4)),
    }))
    .unwrap();

    assert_eq!(
        json,
        "{\"type\":\"message_created\",\"payload\":{\"message_id\":\"00000000-0000-0000-0000-000000000001\",\"room_id\":\"00000000-0000-0000-0000-000000000002\",\"session_id\":\"00000000-0000-0000-0000-000000000003\",\"body\":\"hello\",\"created_at\":\"2026-03-30T12:00:00Z\",\"client_message_id\":\"00000000-0000-0000-0000-000000000004\"}}"
    );
}

#[test]
fn subscribe_room_stream_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SubscribeRoomStreamCommand {
        room_id: Uuid::from_u128(1),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000001\"}"
    );
}

#[test]
fn send_text_message_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SendTextMessageCommand {
        room_id: Uuid::from_u128(2),
        body: "hello".to_string(),
        client_message_id: Some(Uuid::from_u128(3)),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000002\",\"body\":\"hello\",\"client_message_id\":\"00000000-0000-0000-0000-000000000003\"}"
    );
}

#[test]
fn joined_room_queries_live_in_contract_with_stable_wire_shape() {
    let list_json = serde_json::to_string(&koko::contract::ListJoinedRoomsQuery {
        session_id: Uuid::from_u128(10),
    })
    .unwrap();
    let search_json = serde_json::to_string(&koko::contract::SearchRoomsByCodeQuery {
        session_id: Uuid::from_u128(11),
        input: " a1234 ".to_string(),
    })
    .unwrap();

    assert_eq!(
        list_json,
        "{\"session_id\":\"00000000-0000-0000-0000-00000000000a\"}"
    );
    assert_eq!(
        search_json,
        "{\"session_id\":\"00000000-0000-0000-0000-00000000000b\",\"input\":\" a1234 \"}"
    );
}

