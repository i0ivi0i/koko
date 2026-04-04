use super::*;
use koko::contract::{AppErrorCode, ErrorLayer, ErrorOperation, RejectedCommandKind};

#[test]
fn command_rejected_must_include_layer_and_operation() {
    let payload = koko::contract::CommandRejected {
        error: koko::contract::ErrorEnvelope {
            code: AppErrorCode::Internal,
            layer: ErrorLayer::Application,
            operation: ErrorOperation::SendTextMessage,
        },
        command: RejectedCommandKind::SendTextMessage,
        room_id: Some(Uuid::from_u128(1)),
        client_message_id: Some(Uuid::from_u128(2)),
    };
    let json = serde_json::to_value(&payload).unwrap();

    assert_eq!(json["layer"], "application");
    assert_eq!(json["operation"], "send_text_message");
}

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

