use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use koko_contract::ServerRealtimeEvent;
use koko_core::model::RoomId;
use rust_socketio::{
    ClientBuilder as SocketIoClientBuilder, Payload as SocketIoPayload, TransportType,
    client::Client as SocketIoClient,
};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{net::SocketAddr, panic::AssertUnwindSafe};
use tokio::{
    net::TcpListener,
    sync::{
        OnceCell,
        mpsc::{UnboundedReceiver, unbounded_channel},
    },
    time::{Duration, timeout},
};
use tower::ServiceExt;
use uuid::Uuid;

const SESSION_HEADER: &str = "x-koko-session-id";
static MIGRATIONS_READY: OnceCell<()> = OnceCell::const_new();

#[tokio::test]
async fn socketio入房后服务端应可直接通过socketioxide房间广播() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "socketio-room-owner").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (app, handles) = koko_server::app::build_app_with_test_handles(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    handles
        .publish_room_event(
            RoomId(room_id),
            ServerRealtimeEvent::MessageCreated {
                message_id: Uuid::new_v4().to_string(),
                room_id: room_id.to_string(),
                sender_id: owner_id.to_string(),
                content: "socketioxide direct".into(),
                created_at: "2026-03-28T12:00:00Z".into(),
            },
        )
        .await;

    let event = socket.next_event().await;
    assert_eq!(event.0, "event");
    assert_eq!(event.1["type"], "message_created");
    assert_eq!(event.1["room_id"], room_id.to_string());
    assert_eq!(event.1["content"], "socketioxide direct");

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 共享realtimehub重复挂载到两套socketio应用应立即失败() {
    let pool = test_pool().await;
    let shared = koko_server::ws::RealtimeHub::default();

    let _first = koko_server::app::build_app_with_realtime(pool.clone(), shared.clone());

    let duplicate = std::panic::catch_unwind(AssertUnwindSafe(|| {
        koko_server::app::build_app_with_realtime(pool, shared)
    }));

    assert!(duplicate.is_err(), "重复挂载应立即失败");
}

#[tokio::test]
async fn 被禁言成员通过socketio发送消息应被领域规则拒绝() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let member_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "socketio-owner").await;
    insert_profile(&pool, member_id, "socketio-member").await;
    insert_session(&pool, member_session_id, member_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;
    mute_member_until_future(&pool, room_id, member_id).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, member_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["room_id"], room_id.to_string());

    socket
        .send_command(json!({
            "type": "send_message",
            "content": "muted over socketio",
        }))
        .await;

    let error_event = socket.next_event().await;
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

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn http发送消息后socketio客户端应收到_message_created广播() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "socketio-http-owner").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
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

    let event = socket.next_event().await;
    assert_eq!(event.0, "event");
    assert_eq!(event.1["type"], "message_created");
    assert_eq!(event.1["room_id"], room_id.to_string());
    assert_eq!(event.1["sender_id"], owner_id.to_string());
    assert_eq!(event.1["content"], "http to socketio");

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn socketio首个_room_snapshot应与_http房间视图保持一致() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);
    let message_id = Uuid::new_v4();

    insert_profile(&pool, owner_id, "snapshot-owner").await;
    insert_profile(&pool, member_id, "snapshot-member").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;
    mute_member_until_future(&pool, room_id, member_id).await;

    sqlx::query!(
        r#"
        INSERT INTO messages (id, room_id, sender_id, content, created_at)
        VALUES ($1, $2, $3, $4, NOW() - INTERVAL '5 minutes')
        "#,
        message_id,
        room_id,
        owner_id,
        "snapshot-baseline"
    )
    .execute(&pool)
    .await
    .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["room_id"], room_id.to_string());

    let room = http_app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(room.status(), StatusCode::OK);
    let room_body = to_bytes(room.into_body(), usize::MAX).await.unwrap();
    let room_payload: Value = serde_json::from_slice(&room_body).unwrap();

    let messages = http_app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/messages"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(messages.status(), StatusCode::OK);
    let messages_body = to_bytes(messages.into_body(), usize::MAX).await.unwrap();
    let messages_payload: Value = serde_json::from_slice(&messages_body).unwrap();

    let members = http_app
        .oneshot(with_session(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/members"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(members.status(), StatusCode::OK);
    let members_body = to_bytes(members.into_body(), usize::MAX).await.unwrap();
    let members_payload: Value = serde_json::from_slice(&members_body).unwrap();

    assert_eq!(room_snapshot.1["code"], room_payload["code"]);
    assert_eq!(room_snapshot.1["messages"], messages_payload["items"]);
    assert_eq!(
        room_snapshot.1["has_more_messages"],
        messages_payload["has_more"]
    );
    assert_eq!(room_snapshot.1["members"], members_payload["items"]);

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn socketio切房后不应继续收到旧房间广播() {
    let pool = test_pool().await;
    let profile_id = Uuid::new_v4();
    let owner_a_id = Uuid::new_v4();
    let owner_b_id = Uuid::new_v4();
    let room_a_id = Uuid::new_v4();
    let room_b_id = Uuid::new_v4();
    let profile_session_id = Uuid::new_v4();
    let owner_a_session_id = Uuid::new_v4();
    let owner_b_session_id = Uuid::new_v4();
    let room_a_code = unique_room_code(room_a_id);
    let room_b_code = unique_room_code(room_b_id);

    insert_profile(&pool, profile_id, "switch-member").await;
    insert_profile(&pool, owner_a_id, "switch-owner-a").await;
    insert_profile(&pool, owner_b_id, "switch-owner-b").await;
    insert_session(&pool, profile_session_id, profile_id).await;
    insert_session(&pool, owner_a_session_id, owner_a_id).await;
    insert_session(&pool, owner_b_session_id, owner_b_id).await;
    insert_room_with_owner(&pool, room_a_id, owner_a_id, &room_a_code).await;
    insert_room_with_owner(&pool, room_b_id, owner_b_id, &room_b_code).await;
    insert_member(&pool, room_a_id, profile_id, "member").await;
    insert_member(&pool, room_b_id, profile_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, profile_session_id, &room_a_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["room_id"], room_a_id.to_string());

    socket
        .send_command(json!({
            "type": "join_room",
            "code": room_b_code,
        }))
        .await;

    let switched_snapshot = socket.next_event().await;
    assert_eq!(switched_snapshot.0, "event");
    assert_eq!(switched_snapshot.1["type"], "room_snapshot");
    assert_eq!(switched_snapshot.1["room_id"], room_b_id.to_string());

    let owner_a_send = http_app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_a_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "old room should not arrive",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_a_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(owner_a_send.status(), StatusCode::OK);

    socket.assert_no_event(Duration::from_millis(200)).await;

    let owner_b_send = http_app
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
    assert_eq!(owner_b_send.status(), StatusCode::OK);

    let new_room_event = socket.next_event().await;
    assert_eq!(new_room_event.0, "event");
    assert_eq!(new_room_event.1["type"], "message_created");
    assert_eq!(new_room_event.1["room_id"], room_b_id.to_string());
    assert_eq!(new_room_event.1["content"], "new room should arrive");

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn socketio切房命令发出后旧房间广播不应抢在新快照前到达() {
    let pool = test_pool().await;
    let profile_id = Uuid::new_v4();
    let owner_a_id = Uuid::new_v4();
    let owner_b_id = Uuid::new_v4();
    let room_a_id = Uuid::new_v4();
    let room_b_id = Uuid::new_v4();
    let profile_session_id = Uuid::new_v4();
    let owner_a_session_id = Uuid::new_v4();
    let room_a_code = unique_room_code(room_a_id);
    let room_b_code = unique_room_code(room_b_id);

    insert_profile(&pool, profile_id, "switch-race-member").await;
    insert_profile(&pool, owner_a_id, "switch-race-owner-a").await;
    insert_profile(&pool, owner_b_id, "switch-race-owner-b").await;
    insert_session(&pool, profile_session_id, profile_id).await;
    insert_session(&pool, owner_a_session_id, owner_a_id).await;
    insert_room_with_owner(&pool, room_a_id, owner_a_id, &room_a_code).await;
    insert_room_with_owner(&pool, room_b_id, owner_b_id, &room_b_code).await;
    insert_member(&pool, room_a_id, profile_id, "member").await;
    insert_member(&pool, room_b_id, profile_id, "member").await;

    for index in 0..120 {
        sqlx::query(
            "INSERT INTO messages (id, room_id, sender_id, content) VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4())
        .bind(room_b_id)
        .bind(owner_b_id)
        .bind(format!("warmup-{index}"))
        .execute(&pool)
        .await
        .unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut socket, initial_snapshot) =
        SocketIoTestClient::connect_and_join(address, profile_session_id, &room_a_code).await;
    assert_eq!(initial_snapshot.0, "event");
    assert_eq!(initial_snapshot.1["type"], "room_snapshot");
    assert_eq!(initial_snapshot.1["room_id"], room_a_id.to_string());

    socket
        .send_command(json!({
            "type": "join_room",
            "code": room_b_code,
        }))
        .await;

    let first_after_join = socket.next_event().await;
    assert_eq!(first_after_join.0, "event");
    assert_eq!(first_after_join.1["type"], "room_snapshot");
    assert_eq!(first_after_join.1["room_id"], room_b_id.to_string());

    let owner_a_send = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_a_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "old room must not overtake snapshot",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_a_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(owner_a_send.status(), StatusCode::OK);

    socket.assert_no_event(Duration::from_millis(200)).await;

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn socketio通过不存在短码入房时应创建房间并返回快照() {
    let pool = test_pool().await;
    let profile_id = Uuid::new_v4();
    let existing_room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let existing_room_code = unique_room_code(existing_room_id);
    let room_code = unique_room_code(Uuid::new_v4());

    insert_profile(&pool, profile_id, "socketio-create-owner").await;
    insert_session(&pool, session_id, profile_id).await;
    insert_room_with_owner(&pool, existing_room_id, profile_id, &existing_room_code).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["code"], room_code);
    assert_eq!(room_snapshot.1["role"], "owner");
    assert_eq!(room_snapshot.1["messages"], json!([]));
    assert_eq!(room_snapshot.1["has_more_messages"], Value::Bool(false));
    assert_eq!(
        room_snapshot.1["members"][0]["profile_id"],
        profile_id.to_string()
    );
    assert_eq!(room_snapshot.1["members"][0]["role"], "owner");

    let room_id = Uuid::parse_str(room_snapshot.1["room_id"].as_str().unwrap()).unwrap();
    let persisted_room_id = sqlx::query_scalar!(
        r#"
        SELECT r.id AS "id!: Uuid"
        FROM rooms r
        JOIN room_codes rc ON rc.room_id = r.id
        WHERE rc.code = $1
        "#,
        room_code
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(persisted_room_id, room_id);

    socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 房间被封禁后老成员仍可通过socketio入房而新成员应被拒绝() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let joiner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let member_session_id = Uuid::new_v4();
    let joiner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "banned-socketio-owner").await;
    insert_profile(&pool, member_id, "banned-socketio-member").await;
    insert_profile(&pool, joiner_id, "banned-socketio-joiner").await;
    insert_session(&pool, member_session_id, member_id).await;
    insert_session(&pool, joiner_session_id, joiner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;

    sqlx::query(
        r#"
        INSERT INTO room_governance_state (room_id, banned_until, ban_reason)
        VALUES ($1, NOW() + INTERVAL '1 hour', $2)
        "#,
    )
    .bind(room_id)
    .bind("socketio governance test")
    .execute(&pool)
    .await
    .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (member_socket, member_snapshot) =
        SocketIoTestClient::connect_and_join(address, member_session_id, &room_code).await;
    assert_eq!(member_snapshot.0, "event");
    assert_eq!(member_snapshot.1["type"], "room_snapshot");
    assert_eq!(member_snapshot.1["room_id"], room_id.to_string());

    let (joiner_socket, joiner_error) =
        SocketIoTestClient::connect_and_join_expect_error(address, joiner_session_id, &room_code)
            .await;
    assert_eq!(joiner_error.0, "error");
    assert_eq!(joiner_error.1, Value::String("房间暂时封禁".into()));

    member_socket.close().await;
    joiner_socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 成员被移除后不应继续收到房间广播() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let member_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "remove-owner").await;
    insert_profile(&pool, member_id, "remove-member").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_session(&pool, member_session_id, member_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut member_socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, member_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");
    assert_eq!(room_snapshot.1["room_id"], room_id.to_string());

    let remove = http_app
        .clone()
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/members/{member_id}/remove"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(remove.status(), StatusCode::OK);

    let room_left = member_socket.next_event().await;
    assert_eq!(room_left.0, "event");
    assert_eq!(room_left.1["type"], "room_left");
    assert_eq!(room_left.1["room_id"], room_id.to_string());
    assert_eq!(room_left.1["reason"], "removed");

    let owner_send = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "content": "removed member should not receive this",
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(owner_send.status(), StatusCode::OK);

    member_socket
        .assert_no_event(Duration::from_millis(300))
        .await;

    member_socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 提升管理员后在线房间成员应收到更新后的_room_members_snapshot() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "promote-owner").await;
    insert_profile(&pool, member_id, "promote-member").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut owner_socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    let promote = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/roles/promote"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "target_profile_id": member_id.to_string(),
                    })
                    .to_string(),
                ))
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(promote.status(), StatusCode::OK);

    let updated_snapshot = owner_socket.next_event().await;
    assert_eq!(updated_snapshot.0, "event");
    assert_eq!(updated_snapshot.1["type"], "room_members_snapshot");
    assert_eq!(updated_snapshot.1["room_id"], room_id.to_string());
    assert_eq!(updated_snapshot.1["role"], "owner");
    assert_eq!(
        updated_snapshot.1["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|member| member["profile_id"] == member_id.to_string())
            .unwrap()["role"],
        "admin"
    );

    owner_socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 禁言成员后在线房间成员应收到带禁言状态的_room_members_snapshot() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "mute-owner").await;
    insert_profile(&pool, member_id, "mute-member").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut owner_socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    let mute = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/members/{member_id}/mute"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(mute.status(), StatusCode::OK);

    let updated_snapshot = owner_socket.next_event().await;
    assert_eq!(updated_snapshot.0, "event");
    assert_eq!(updated_snapshot.1["type"], "room_members_snapshot");
    assert_eq!(updated_snapshot.1["room_id"], room_id.to_string());
    assert_eq!(
        updated_snapshot.1["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|member| member["profile_id"] == member_id.to_string())
            .unwrap()["is_muted"],
        true
    );

    owner_socket.close().await;
    shutdown_test_server(server).await;
}

#[tokio::test]
async fn 移除成员后在线剩余成员应收到更新后的_room_members_snapshot() {
    let pool = test_pool().await;
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();
    let owner_session_id = Uuid::new_v4();
    let room_code = unique_room_code(room_id);

    insert_profile(&pool, owner_id, "remove-owner-snapshot").await;
    insert_profile(&pool, member_id, "remove-member-snapshot").await;
    insert_session(&pool, owner_session_id, owner_id).await;
    insert_room_with_owner(&pool, room_id, owner_id, &room_code).await;
    insert_member(&pool, room_id, member_id, "member").await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = koko_server::app::build_app(pool.clone());
    let http_app = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let (mut owner_socket, room_snapshot) =
        SocketIoTestClient::connect_and_join(address, owner_session_id, &room_code).await;
    assert_eq!(room_snapshot.0, "event");
    assert_eq!(room_snapshot.1["type"], "room_snapshot");

    let remove = http_app
        .oneshot(with_session(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/members/{member_id}/remove"))
                .body(Body::empty())
                .unwrap(),
            owner_session_id,
        ))
        .await
        .unwrap();
    assert_eq!(remove.status(), StatusCode::OK);

    let updated_snapshot = owner_socket.next_event().await;
    assert_eq!(updated_snapshot.0, "event");
    assert_eq!(updated_snapshot.1["type"], "room_members_snapshot");
    assert_eq!(updated_snapshot.1["room_id"], room_id.to_string());
    assert_eq!(updated_snapshot.1["role"], "owner");
    assert_eq!(updated_snapshot.1["members"].as_array().unwrap().len(), 1);
    assert_eq!(
        updated_snapshot.1["members"][0]["profile_id"],
        owner_id.to_string()
    );

    owner_socket.close().await;
    shutdown_test_server(server).await;
}

type SocketIoEvent = (String, Value);

struct SocketIoTestClient {
    socket: SocketIoClient,
    events: UnboundedReceiver<SocketIoEvent>,
}

impl SocketIoTestClient {
    async fn connect(address: SocketAddr, session_id: Uuid) -> Self {
        let (tx, rx) = unbounded_channel();
        let url = format!("http://{address}");
        let socket = tokio::task::spawn_blocking(move || {
            let event_tx = tx.clone();
            let open_tx = tx.clone();
            let error_tx = tx;
            SocketIoClientBuilder::new(url)
                .namespace("/")
                .transport_type(TransportType::Websocket)
                .reconnect(false)
                .reconnect_on_disconnect(false)
                .auth(json!({
                    "session_id": session_id.to_string(),
                }))
                .on("open", move |payload, _| {
                    let _ = open_tx.send(("open".to_owned(), payload_to_value(payload)));
                })
                .on("event", move |payload, _| {
                    let _ = event_tx.send(("event".to_owned(), payload_to_value(payload)));
                })
                .on("error", move |payload, _| {
                    let _ = error_tx.send(("error".to_owned(), payload_to_value(payload)));
                })
                .connect()
        })
        .await
        .expect("socketio 测试客户端连接任务不应 panic")
        .expect("rust_socketio 客户端应连接成功");

        let mut client = Self { socket, events: rx };
        let opened = client.next_event().await;
        assert_eq!(
            opened.0, "open",
            "socketio 客户端应先进入 open，再发送业务命令: {:?}",
            opened.1
        );

        client
    }

    async fn connect_and_join(
        address: SocketAddr,
        session_id: Uuid,
        room_code: &str,
    ) -> (Self, SocketIoEvent) {
        let mut socket = Self::connect(address, session_id).await;
        socket
            .send_command(json!({
                "type": "join_room",
                "code": room_code,
            }))
            .await;
        let snapshot = socket.next_event().await;
        assert_eq!(
            snapshot.0, "event",
            "join_room 应返回 room_snapshot 而不是错误: {:?}",
            snapshot.1
        );

        (socket, snapshot)
    }

    async fn connect_and_join_expect_error(
        address: SocketAddr,
        session_id: Uuid,
        room_code: &str,
    ) -> (Self, SocketIoEvent) {
        let mut socket = Self::connect(address, session_id).await;
        socket
            .send_command(json!({
                "type": "join_room",
                "code": room_code,
            }))
            .await;
        let error = socket.next_event().await;
        assert_eq!(
            error.0, "error",
            "join_room 应返回错误而不是 room_snapshot: {:?}",
            error.1
        );

        (socket, error)
    }

    async fn send_command(&self, command: Value) {
        let socket = self.socket.clone();
        tokio::task::spawn_blocking(move || socket.emit("command", command))
            .await
            .expect("socketio command 发送任务不应 panic")
            .expect("socketio command 发送应成功");
    }

    async fn next_event(&mut self) -> SocketIoEvent {
        timeout(Duration::from_secs(1), self.events.recv())
            .await
            .expect("应收到 socket.io 消息")
            .expect("socket.io 事件通道不应提前关闭")
    }

    async fn assert_no_event(&mut self, wait_for: Duration) {
        match timeout(wait_for, self.events.recv()).await {
            Err(_) => {}
            Ok(Some(event)) => panic!("unexpected socket.io event: {event:?}"),
            Ok(None) => panic!("socket.io 事件通道不应提前关闭"),
        }
    }

    async fn close(self) {
        let socket = self.socket;
        tokio::task::spawn_blocking(move || socket.disconnect())
            .await
            .expect("socketio 客户端断开任务不应 panic")
            .expect("socketio 客户端断开应成功");
    }
}

fn payload_to_value(payload: SocketIoPayload) -> Value {
    match payload {
        SocketIoPayload::Text(mut values) => {
            if values.len() == 1 {
                values.remove(0)
            } else {
                Value::Array(values)
            }
        }
        SocketIoPayload::Binary(bytes) => {
            Value::Array(bytes.iter().copied().map(Value::from).collect())
        }
        #[allow(deprecated)]
        SocketIoPayload::String(text) => serde_json::from_str(&text).unwrap_or(Value::String(text)),
    }
}

async fn shutdown_test_server(server: tokio::task::JoinHandle<()>) {
    server.abort();
    let _ = server.await;
}

async fn test_pool() -> PgPool {
    let database_url =
        std::env::var("DATABASE_URL").expect("socketio 集成测试依赖 DATABASE_URL 指向本地测试库");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("应能连接本地测试库");

    MIGRATIONS_READY
        .get_or_init(|| async {
            sqlx::migrate!("../migrations")
                .run(&pool)
                .await
                .expect("应能初始化测试库迁移");
        })
        .await;

    pool
}

fn with_session(request: Request<Body>, session_id: Uuid) -> Request<Body> {
    let (mut parts, body) = request.into_parts();
    parts.headers.insert(
        SESSION_HEADER,
        session_id.to_string().parse().expect("测试会话头应合法"),
    );
    Request::from_parts(parts, body)
}

async fn insert_profile(pool: &PgPool, profile_id: Uuid, device_key: &str) {
    sqlx::query("INSERT INTO profiles (id, device_key) VALUES ($1, $2)")
        .bind(profile_id)
        .bind(format!("{device_key}-{profile_id}"))
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

fn unique_room_code(seed: Uuid) -> String {
    let bytes = seed.as_bytes();
    let letter = (b'A' + (bytes[1] % 26)) as char;
    format!(
        "{}{}{}{}{}",
        bytes[0] % 10,
        letter,
        bytes[2] % 10,
        bytes[3] % 10,
        bytes[4] % 10
    )
}
