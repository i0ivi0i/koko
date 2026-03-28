use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use futures_util::{SinkExt, StreamExt};
use koko_contract::ServerRealtimeEvent;
use koko_core::model::RoomId;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::time::{Duration, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tower::ServiceExt;
use uuid::Uuid;

const SESSION_HEADER: &str = "x-koko-session-id";

#[sqlx::test(migrations = "../migrations")]
async fn 入房或建房接口应返回房间与当前角色(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let profile_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        profile_id,
        "room-device-1"
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_session(&pool, session_id, profile_id).await;

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri("/rooms/join-or-create")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "1A234",
                    })
                    .to_string(),
                ))
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["code"], "1A234");
    assert_eq!(payload["role"], "owner");
    assert!(payload["room_id"].as_str().is_some());
}

#[sqlx::test(migrations = "../migrations")]
async fn 入房接口应忽略客户端伪造的_profile_id并使用会话身份(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let actual_profile_id = Uuid::new_v4();
    let forged_profile_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    insert_profile(&pool, actual_profile_id, "join-actual-device").await;
    insert_profile(&pool, forged_profile_id, "join-forged-device").await;
    insert_session(&pool, session_id, actual_profile_id).await;

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri("/rooms/join-or-create")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "profile_id": forged_profile_id.to_string(),
                        "code": "9J012",
                    })
                    .to_string(),
                ))
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    let room_id = Uuid::parse_str(payload["room_id"].as_str().unwrap()).unwrap();

    let owner_id = sqlx::query_scalar!("SELECT owner_profile_id FROM rooms WHERE id = $1", room_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(owner_id, actual_profile_id);
}

#[sqlx::test(migrations = "../migrations")]
async fn 公开房间短码解析接口不应继续暴露房间存在性(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "room-device-2"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "2B345"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)",
        room_id,
        owner_id,
        "owner"
    )
    .execute(&pool)
    .await
    .unwrap();

    let resolve = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rooms/resolve")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "2B345",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resolve.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[sqlx::test(migrations = "../migrations")]
async fn 房间详情与消息历史接口应返回已创建房间信息(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "room-device-2"
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_session(&pool, session_id, owner_id).await;

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "2B345"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)",
        room_id,
        owner_id,
        "owner"
    )
    .execute(&pool)
    .await
    .unwrap();

    let room = app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(room.status(), StatusCode::OK);
    let room_body = to_bytes(room.into_body(), usize::MAX).await.unwrap();
    let room_payload: Value = serde_json::from_slice(&room_body).unwrap();
    assert_eq!(room_payload["room_id"], room_id.to_string());
    assert_eq!(room_payload["code"], "2B345");

    let messages = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/messages"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(messages.status(), StatusCode::OK);
    let messages_body = to_bytes(messages.into_body(), usize::MAX).await.unwrap();
    let messages_payload: Value = serde_json::from_slice(&messages_body).unwrap();
    assert_eq!(messages_payload["items"], json!([]));
    assert_eq!(messages_payload["has_more"], false);
}

#[sqlx::test(migrations = "../migrations")]
async fn 成员列表接口应返回成员和角色(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2), ($3, $4)",
        owner_id,
        "owner-device",
        member_id,
        "member-device"
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_session(&pool, session_id, owner_id).await;

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "3C456"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3), ($1, $4, $5)",
        room_id,
        owner_id,
        "owner",
        member_id,
        "member"
    )
    .execute(&pool)
    .await
    .unwrap();

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/members"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["items"].as_array().unwrap().len(), 2);
    assert_eq!(payload["items"][0]["role"], "owner");
}

#[sqlx::test(migrations = "../migrations")]
async fn 发送消息接口应返回新消息(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "owner-device"
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_session(&pool, session_id, owner_id).await;

    sqlx::query!(
        "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
        room_id,
        owner_id
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
        room_id,
        "4D567"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)",
        room_id,
        owner_id,
        "owner"
    )
    .execute(&pool)
    .await
    .unwrap();

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "hello over http",
                    })
                    .to_string(),
                ))
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["content"], "hello over http");
    assert_eq!(payload["sender_id"], owner_id.to_string());
    assert!(payload["created_at"].as_str().is_some());
}

#[sqlx::test(migrations = "../migrations")]
async fn socketio握手端点应已装配到现有应用(pool: PgPool) {
    let app = koko_server::app::build_app(pool);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/socket.io/?EIO=4&transport=polling")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload = String::from_utf8(body.to_vec()).unwrap();
    assert!(
        payload.starts_with("0{"),
        "unexpected handshake payload: {payload}"
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn socketio入房后服务端应可直接通过socketioxide房间广播(pool: PgPool) {
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "socketio-room-owner").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "4D573").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (app, io) = koko_server::app::build_app_with_socket_io(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mut socket = connect_socket_io(
        address,
        json!({
            "session_id": owner_session_id.to_string(),
            "room_id": room_id.to_string(),
        }),
    )
    .await;

    let room_snapshot = next_socket_io_event(&mut socket).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    io.to(room_id.to_string())
        .emit(
            "event",
            &ServerRealtimeEvent::MessageCreated {
                message_id: Uuid::new_v4().to_string(),
                room_id: room_id.to_string(),
                sender_id: owner_id.to_string(),
                content: "socketioxide direct".into(),
                created_at: "2026-03-28T12:00:00Z".into(),
            },
        )
        .await
        .unwrap();

    let event = next_socket_io_event(&mut socket).await;
    assert_eq!(event.0, "event");
    assert_eq!(event.1["type"], "message_created");
    assert_eq!(event.1["room_id"], room_id.to_string());
    assert_eq!(event.1["content"], "socketioxide direct");

    server.abort();
}

#[sqlx::test(migrations = "../migrations")]
async fn http发送消息后realtime_adapter应收到_message_created(pool: PgPool) {
    let realtime = koko_server::ws::RealtimeHub::default();
    let app = koko_server::app::build_app_with_realtime(pool.clone(), realtime.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "owner-device").await;
    insert_session(&pool, session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "4D568").await;

    let mut events = realtime.subscribe(RoomId(room_id));

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "hello over http and socketio",
                    })
                    .to_string(),
                ))
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    let event = timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("应收到 realtime 事件")
        .expect("realtime 通道不应关闭");

    assert_eq!(
        event,
        ServerRealtimeEvent::MessageCreated {
            message_id: payload["message_id"].as_str().unwrap().to_owned(),
            room_id: room_id.to_string(),
            sender_id: owner_id.to_string(),
            content: "hello over http and socketio".into(),
            created_at: payload["created_at"].as_str().unwrap().to_owned(),
        }
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn 被禁言成员通过socketio发送消息应被领域规则拒绝(pool: PgPool) {
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let member_session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "socketio-owner").await;
    insert_profile(&pool, member_id, "socketio-member").await;
    insert_session(&pool, member_session_id, member_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "4D569").await;
    insert_member(&pool, room_id, member_id, "member").await;
    mute_member_until_future(&pool, room_id, member_id).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mut socket = connect_socket_io(
        address,
        json!({
            "session_id": member_session_id.to_string(),
            "room_id": room_id.to_string(),
        }),
    )
    .await;

    let room_snapshot = next_socket_io_event(&mut socket).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["room_id"], room_id.to_string());

    send_socket_io_command(
        &mut socket,
        json!({
            "type": "send_message",
            "content": "muted over socketio",
        }),
    )
    .await;

    let error_event = next_socket_io_event(&mut socket).await;
    assert_eq!(error_event.0, "error");
    assert_eq!(error_event.1, Value::String("成员已被禁言".into()));

    let message_count = sqlx::query_scalar!(
        "SELECT COUNT(*) AS count FROM messages WHERE room_id = $1",
        room_id
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();

    assert_eq!(message_count, 0);

    server.abort();
}

#[sqlx::test(migrations = "../migrations")]
async fn http发送消息后socketio客户端应收到_message_created广播(pool: PgPool) {
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "socketio-http-owner").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "4D570").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mut socket = connect_socket_io(
        address,
        json!({
            "session_id": owner_session_id.to_string(),
            "room_id": room_id.to_string(),
        }),
    )
    .await;

    let room_snapshot = next_socket_io_event(&mut socket).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    let response = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "http to socketio",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let event = next_socket_io_event(&mut socket).await;
    assert_eq!(event.0, "event");
    assert_eq!(event.1["type"], "message_created");
    assert_eq!(event.1["room_id"], room_id.to_string());
    assert_eq!(event.1["sender_id"], owner_id.to_string());
    assert_eq!(event.1["content"], "http to socketio");

    server.abort();
}

#[sqlx::test(migrations = "../migrations")]
async fn socketio切房后不应继续收到旧房间广播(pool: PgPool) {
    let profile_id = Uuid::new_v4();
    let owner_a_id = Uuid::new_v4();
    let owner_b_id = Uuid::new_v4();
    let room_a_id = Uuid::new_v4();
    let room_b_id = Uuid::new_v4();
    let profile_session_id = Uuid::new_v4();
    let owner_a_session_id = Uuid::new_v4();
    let owner_b_session_id = Uuid::new_v4();

    insert_profile(&pool, profile_id, "switch-member").await;
    insert_profile(&pool, owner_a_id, "switch-owner-a").await;
    insert_profile(&pool, owner_b_id, "switch-owner-b").await;
    insert_session(&pool, profile_session_id, profile_id).await;
    insert_session(&pool, owner_a_session_id, owner_a_id).await;
    insert_session(&pool, owner_b_session_id, owner_b_id).await;
    insert_room_with_owner(&pool, room_a_id, owner_a_id, "4D571").await;
    insert_room_with_owner(&pool, room_b_id, owner_b_id, "4D572").await;
    insert_member(&pool, room_a_id, profile_id, "member").await;
    insert_member(&pool, room_b_id, profile_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mut socket = connect_socket_io(
        address,
        json!({
            "session_id": profile_session_id.to_string(),
            "room_id": room_a_id.to_string(),
        }),
    )
    .await;

    let initial_snapshot = next_socket_io_event(&mut socket).await;
    assert_eq!(initial_snapshot.0, "event");
    assert_eq!(initial_snapshot.1["type"], "room_snapshot");
    assert_eq!(initial_snapshot.1["room_id"], room_a_id.to_string());

    send_socket_io_command(
        &mut socket,
        json!({
            "type": "join_room",
            "code": "4D572",
        }),
    )
    .await;

    let switched_snapshot = next_socket_io_event(&mut socket).await;
    assert_eq!(switched_snapshot.0, "event");
    assert_eq!(switched_snapshot.1["type"], "room_snapshot");
    assert_eq!(switched_snapshot.1["room_id"], room_b_id.to_string());

    let old_room_response = http_app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_a_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "old room should stay silent",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_a_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(old_room_response.status(), StatusCode::OK);

    assert_no_socket_io_event(&mut socket, Duration::from_millis(250)).await;

    let new_room_response = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_b_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "new room should arrive",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_b_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(new_room_response.status(), StatusCode::OK);

    let new_room_event = next_socket_io_event(&mut socket).await;
    assert_eq!(new_room_event.0, "event");
    assert_eq!(new_room_event.1["type"], "message_created");
    assert_eq!(new_room_event.1["room_id"], room_b_id.to_string());
    assert_eq!(new_room_event.1["content"], "new room should arrive");

    server.abort();
}

#[sqlx::test(migrations = "../migrations")]
async fn 发送消息接口应忽略客户端伪造的_sender_id并使用会话身份(
    pool: PgPool,
) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let outsider_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "message-owner").await;
    insert_profile(&pool, outsider_id, "message-outsider").await;
    insert_session(&pool, session_id, outsider_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "7G890").await;

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "sender_id": owner_id.to_string(),
                        "content": "forged sender",
                    })
                    .to_string(),
                ))
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../migrations")]
async fn 消息历史接口应只返回最新一页并标记是否还有更早消息(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "page-owner").await;
    insert_session(&pool, session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "5E678").await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
        room_id,
        owner_id,
        "message-1",
        "2026-03-27T00:00:01Z",
    )
    .await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap(),
        room_id,
        owner_id,
        "message-2",
        "2026-03-27T00:00:02Z",
    )
    .await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap(),
        room_id,
        owner_id,
        "message-3",
        "2026-03-27T00:00:03Z",
    )
    .await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000004").unwrap(),
        room_id,
        owner_id,
        "message-4",
        "2026-03-27T00:00:04Z",
    )
    .await;

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/messages?limit=2"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["has_more"], true);
    assert_eq!(payload["items"].as_array().unwrap().len(), 2);
    assert_eq!(payload["items"][0]["content"], "message-3");
    assert_eq!(payload["items"][1]["content"], "message-4");
}

#[sqlx::test(migrations = "../migrations")]
async fn 消息历史接口应按时间与消息id稳定分页(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let anchor_id = Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap();
    let session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "anchor-owner").await;
    insert_session(&pool, session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "6F789").await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
        room_id,
        owner_id,
        "older-1",
        "2026-03-27T00:00:01Z",
    )
    .await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap(),
        room_id,
        owner_id,
        "older-2",
        "2026-03-27T00:00:02Z",
    )
    .await;
    insert_message(
        &pool,
        anchor_id,
        room_id,
        owner_id,
        "anchor",
        "2026-03-27T00:00:02Z",
    )
    .await;
    insert_message(
        &pool,
        Uuid::parse_str("00000000-0000-0000-0000-000000000004").unwrap(),
        room_id,
        owner_id,
        "latest",
        "2026-03-27T00:00:03Z",
    )
    .await;

    let response = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/rooms/{room_id}/messages?before_message_id={anchor_id}&limit=2"
                ))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["has_more"], false);
    assert_eq!(payload["items"].as_array().unwrap().len(), 2);
    assert_eq!(payload["items"][0]["content"], "older-1");
    assert_eq!(payload["items"][1]["content"], "older-2");
}

#[sqlx::test(migrations = "../migrations")]
async fn 非法或跨房间锚点应返回四百(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let other_owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let other_room_id = Uuid::new_v4();
    let other_message_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "owner-a").await;
    insert_profile(&pool, other_owner_id, "owner-b").await;
    insert_session(&pool, session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "7G890").await;
    insert_room_with_owner(&pool, other_room_id, other_owner_id, "8H901").await;
    insert_message(
        &pool,
        other_message_id,
        other_room_id,
        other_owner_id,
        "other-room-message",
        "2026-03-27T00:00:01Z",
    )
    .await;

    let malformed = app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/rooms/{room_id}/messages?before_message_id=not-a-uuid&limit=2"
                ))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);

    let cross_room = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/rooms/{room_id}/messages?before_message_id={other_message_id}&limit=2"
                ))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(cross_room.status(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "../migrations")]
async fn 房间读取接口应拒绝非成员会话(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let outsider_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "read-owner").await;
    insert_profile(&pool, outsider_id, "read-outsider").await;
    insert_session(&pool, session_id, outsider_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, "1K234").await;

    let room = app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(room.status(), StatusCode::FORBIDDEN);

    let messages = app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/messages"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(messages.status(), StatusCode::FORBIDDEN);

    let members = app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/members"))
                .body(Body::empty())
                .unwrap(),
            session_id,
        ))
        .await
        .unwrap();
    assert_eq!(members.status(), StatusCode::FORBIDDEN);
}

async fn insert_profile(pool: &PgPool, profile_id: Uuid, device_key: &str) {
    sqlx::query("INSERT INTO profiles (id, device_key) VALUES ($1, $2)")
        .bind(profile_id)
        .bind(device_key)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_session(pool: &PgPool, session_id: Uuid, profile_id: Uuid) {
    sqlx::query("INSERT INTO sessions (id, profile_id) VALUES ($1, $2)")
        .bind(session_id)
        .bind(profile_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_member(pool: &PgPool, room_id: Uuid, profile_id: Uuid, role: &str) {
    sqlx::query("INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)")
        .bind(room_id)
        .bind(profile_id)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

async fn mute_member_until_future(pool: &PgPool, room_id: Uuid, profile_id: Uuid) {
    sqlx::query(
        "UPDATE room_members SET muted_until = NOW() + INTERVAL '1 hour' WHERE room_id = $1 AND profile_id = $2",
    )
    .bind(room_id)
    .bind(profile_id)
    .execute(pool)
    .await
    .unwrap();
}

fn with_session(request: Request<Body>, session_id: Uuid) -> Request<Body> {
    let (mut parts, body) = request.into_parts();
    parts.headers.insert(
        SESSION_HEADER,
        session_id.to_string().parse().expect("测试会话头应合法"),
    );
    Request::from_parts(parts, body)
}

async fn insert_room_with_owner(pool: &PgPool, room_id: Uuid, owner_id: Uuid, code: &str) {
    sqlx::query("INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)")
        .bind(room_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_codes (room_id, code) VALUES ($1, $2)")
        .bind(room_id)
        .bind(code)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)")
        .bind(room_id)
        .bind(owner_id)
        .bind("owner")
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_message(
    pool: &PgPool,
    message_id: Uuid,
    room_id: Uuid,
    sender_id: Uuid,
    content: &str,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO messages (id, room_id, sender_id, content, created_at) VALUES ($1, $2, $3, $4, $5::timestamptz)",
    )
    .bind(message_id)
    .bind(room_id)
    .bind(sender_id)
    .bind(content)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn connect_socket_io(
    address: SocketAddr,
    auth: Value,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut socket, _) = connect_async(format!(
        "ws://{address}/socket.io/?EIO=4&transport=websocket"
    ))
    .await
    .unwrap();

    let open_packet = timeout(Duration::from_secs(1), socket.next())
        .await
        .expect("应收到 engine.io open packet")
        .expect("socket 不应提前关闭")
        .expect("open packet 不应出错");
    let Message::Text(open_packet) = open_packet else {
        panic!("expected text open packet");
    };
    assert!(
        open_packet.starts_with("0{"),
        "unexpected open packet: {open_packet}"
    );

    socket
        .send(Message::Text(format!("40{}", auth).into()))
        .await
        .unwrap();

    socket
}

async fn send_socket_io_command(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    command: Value,
) {
    socket
        .send(Message::Text(format!("42[\"command\",{}]", command).into()))
        .await
        .unwrap();
}

async fn next_socket_io_event(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> (String, Value) {
    loop {
        let message = timeout(Duration::from_secs(1), socket.next())
            .await
            .expect("应收到 socket.io 消息")
            .expect("socket 不应提前关闭")
            .expect("socket.io 消息不应出错");

        let Message::Text(text) = message else {
            continue;
        };

        if text == "2" {
            socket.send(Message::Text("3".into())).await.unwrap();
            continue;
        }

        if text.starts_with("0{") || text.starts_with("40") {
            continue;
        }

        let Some(payload) = text.strip_prefix("42") else {
            continue;
        };
        let packet: Value = serde_json::from_str(payload).unwrap();
        let event_name = packet[0]
            .as_str()
            .expect("socket.io event name 应为字符串")
            .to_owned();
        let event_payload = packet[1].clone();
        return (event_name, event_payload);
    }
}

async fn assert_no_socket_io_event(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    wait_for: Duration,
) {
    let result = timeout(wait_for, next_socket_io_event(socket)).await;
    assert!(
        result.is_err(),
        "unexpected socket.io event: {:?}",
        result.unwrap()
    );
}
