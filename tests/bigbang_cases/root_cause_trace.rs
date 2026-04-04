#[test]
fn send_message_trace_fields_must_be_present() {
    // 基线守卫：先确认日志里缺什么，后续重构再补齐。
    let log_line = "layer=application operation=send_text_message";

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
