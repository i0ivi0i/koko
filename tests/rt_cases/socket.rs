use super::*;

#[tokio::test]
async fn sender_receives_message_accepted_but_not_message_created() {
    let room_id = Uuid::from_u128(11);
    let sender_session_id = Uuid::from_u128(12);
    let receiver_session_id = Uuid::from_u128(13);
    let client_message_id = Uuid::from_u128(14);
    let message_id = Uuid::from_u128(15);
    let harness = RealtimeHarness::spawn(
        RealtimeTestStore::new(
            [sender_session_id, receiver_session_id],
            [(room_id, sender_session_id), (room_id, receiver_session_id)],
        ),
        message_id,
    )
    .await;

    assert!(
        connect_error_text(harness.base_url())
            .await
            .contains("not active")
    );

    let mut sender_room_stream = mpsc::unbounded_channel();
    let mut sender_message_accepted = mpsc::unbounded_channel();
    let mut sender_message_created = mpsc::unbounded_channel();
    let mut sender_connected = mpsc::unbounded_channel();
    let mut sender = connect_client(
        harness.base_url(),
        sender_session_id,
        ClientChannels::new(
            sender_connected.0,
            sender_room_stream.0,
            sender_message_accepted.0,
            sender_message_created.0,
        ),
    )
    .await
    .unwrap();

    let mut receiver_room_stream = mpsc::unbounded_channel();
    let mut receiver_message_accepted = mpsc::unbounded_channel();
    let mut receiver_message_created = mpsc::unbounded_channel();
    let mut receiver_connected = mpsc::unbounded_channel();
    let mut receiver = connect_client(
        harness.base_url(),
        receiver_session_id,
        ClientChannels::new(
            receiver_connected.0,
            receiver_room_stream.0,
            receiver_message_accepted.0,
            receiver_message_created.0,
        ),
    )
    .await
    .unwrap();

    next_event("sender connected", &mut sender_connected.1).await;
    next_event("receiver connected", &mut receiver_connected.1).await;

    sender
        .emit("subscribe_room_stream", json!({ "room_id": room_id }))
        .await
        .unwrap();
    receiver
        .emit("subscribe_room_stream", json!({ "room_id": room_id }))
        .await
        .unwrap();

    assert_eq!(
        next_event("sender subscribed", &mut sender_room_stream.1).await,
        RoomStreamSubscribed { room_id }
    );
    assert_eq!(
        next_event("receiver subscribed", &mut receiver_room_stream.1).await,
        RoomStreamSubscribed { room_id }
    );

    sender
        .emit(
            "send_text_message",
            json!({
                "room_id": room_id,
                "body": " hello direct realtime ",
                "client_message_id": client_message_id,
            }),
        )
        .await
        .unwrap();

    let accepted = next_event("sender message_accepted", &mut sender_message_accepted.1).await;
    assert_eq!(
        accepted,
        MessageCreated {
            message_id,
            room_id,
            session_id: sender_session_id,
            body: "hello direct realtime".to_string(),
            created_at: fixed_time(),
            client_message_id: Some(client_message_id),
        }
    );

    assert_eq!(
        next_event("receiver message_created", &mut receiver_message_created.1).await,
        accepted.clone()
    );
    assert!(
        timeout(Duration::from_millis(300), sender_message_created.1.recv())
            .await
            .is_err()
    );
    assert!(receiver_message_accepted.1.try_recv().is_err());

    sender.disconnect().await.unwrap();
    receiver.disconnect().await.unwrap();
    harness.shutdown().await;
}

#[sqlx::test]
async fn smoke_http_bootstrap_join_then_realtime_subscribe_shares_same_server(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let server = HttpHarness::new(pool).await.spawn().await;
    let room_code = format!("z{:04}", Uuid::now_v7().as_u128() % 10_000);
    let (_session, cookie) = server.bootstrap_session_with_cookie().await;
    let room = server.join_room(&cookie, &room_code).await;

    let mut room_stream = mpsc::unbounded_channel();
    let message_accepted = mpsc::unbounded_channel();
    let message_created = mpsc::unbounded_channel();
    let mut connected = mpsc::unbounded_channel();
    let mut socket = connect_client_with_cookie(
        server.base_url(),
        &cookie,
        ClientChannels::new(
            connected.0,
            room_stream.0,
            message_accepted.0,
            message_created.0,
        ),
    )
    .await
    .unwrap();

    next_event("connected", &mut connected.1).await;
    socket
        .emit("subscribe_room_stream", json!({ "room_id": room.room_id }))
        .await
        .unwrap();

    assert_eq!(
        next_event("room_stream_subscribed", &mut room_stream.1).await,
        RoomStreamSubscribed {
            room_id: room.room_id,
        }
    );

    socket.disconnect().await.unwrap();
    server.shutdown().await;
    Ok(())
}

#[tokio::test]
async fn authenticate_realtime_session_reads_koko_session_from_multi_cookie_header() {
    let session_id = Uuid::from_u128(1);
    let mut headers = HeaderMap::new();
    headers.append(COOKIE, HeaderValue::from_static("theme=dark; other=value"));
    headers.append(
        COOKIE,
        HeaderValue::from_str(&format!("tracking=on; koko_session={session_id}")).unwrap(),
    );

    let authenticated = authenticate_realtime_session(&FakeSessionPort::allow(), &headers)
        .await
        .unwrap();

    assert_eq!(authenticated.session_id, session_id);
}

#[tokio::test]
async fn authenticate_realtime_session_reads_quoted_koko_session_cookie_value() {
    let session_id = Uuid::from_u128(3);
    let mut headers = HeaderMap::new();
    headers.append(
        COOKIE,
        HeaderValue::from_str(&format!("theme=dark; koko_session=\"{session_id}\"")).unwrap(),
    );

    let authenticated = authenticate_realtime_session(&FakeSessionPort::allow(), &headers)
        .await
        .unwrap();

    assert_eq!(authenticated.session_id, session_id);
}

#[tokio::test]
async fn authenticate_realtime_session_rejects_missing_or_invalid_cookie() {
    let missing_cookie = HeaderMap::new();
    let missing_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::allow(), &missing_cookie)
            .await
            .unwrap_err();
    assert_eq!(
        missing_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
    );

    let mut invalid_cookie = HeaderMap::new();
    invalid_cookie.append(COOKIE, HeaderValue::from_static("koko_session=not-a-uuid"));
    let invalid_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::allow(), &invalid_cookie)
            .await
            .unwrap_err();
    assert_eq!(
        invalid_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
    );

    let mut inactive_cookie = HeaderMap::new();
    inactive_cookie.append(
        COOKIE,
        HeaderValue::from_str(&format!("koko_session={}", Uuid::from_u128(2))).unwrap(),
    );
    let inactive_cookie_error =
        authenticate_realtime_session(&FakeSessionPort::deny(), &inactive_cookie)
            .await
            .unwrap_err();
    assert_eq!(
        inactive_cookie_error.code(),
        koko::contract::AppErrorCode::InvalidSession
    );
}

