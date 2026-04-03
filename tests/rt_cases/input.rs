use super::*;

#[test]
fn init_tracing_is_idempotent() {
    let first = koko::support::init_tracing("info").unwrap();
    let second = koko::support::init_tracing("debug").unwrap();

    assert!(matches!(
        first,
        koko::support::TracingInit::Initialized | koko::support::TracingInit::AlreadyInitialized
    ));
    assert_eq!(second, koko::support::TracingInit::AlreadyInitialized);
}

#[tokio::test]
async fn subscribe_room_stream_input_uses_authenticated_session() {
    let input = subscribe_room_stream_input(
        AuthenticatedSession {
            session_id: Uuid::from_u128(2),
        },
        SubscribeRoomStreamCommand {
            room_id: Uuid::from_u128(1),
        },
    );

    assert_eq!(
        input,
        SubscribeRoomStreamInput {
            room_id: Uuid::from_u128(1),
            session_id: Uuid::from_u128(2),
        }
    );
}

#[tokio::test]
async fn send_text_message_input_uses_authenticated_session() {
    let input = send_text_message_input(
        AuthenticatedSession {
            session_id: Uuid::from_u128(2),
        },
        SendTextMessageCommand {
            room_id: Uuid::from_u128(1),
            body: "hello".to_string(),
            client_message_id: None,
        },
    );

    assert_eq!(
        input,
        SendTextMessageInput {
            room_id: Uuid::from_u128(1),
            session_id: Uuid::from_u128(2),
            body: "hello".to_string(),
            client_message_id: None,
        }
    );
}

