#[test]
fn send_message_trace_fields_must_be_present() {
    let log_line = koko::support::trace_line(
        "application",
        "send_text_message",
        &koko::support::TraceContext {
            request_id: uuid::Uuid::from_u128(1),
            session_id: Some(uuid::Uuid::from_u128(2)),
            room_id: Some(uuid::Uuid::from_u128(3)),
            client_message_id: Some(uuid::Uuid::from_u128(4)),
            event_position: Some(5),
        },
    );

    assert!(
        log_line.contains("request_id"),
        "log line must include request_id: {log_line}"
    );
    assert!(
        log_line.contains("session_id"),
        "log line must include session_id: {log_line}"
    );
    assert!(
        log_line.contains("room_id"),
        "log line must include room_id: {log_line}"
    );
    assert!(
        log_line.contains("client_message_id"),
        "log line must include client_message_id: {log_line}"
    );
    assert!(
        log_line.contains("event_position"),
        "log line must include event_position: {log_line}"
    );
}
