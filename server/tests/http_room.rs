use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
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
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
async fn socketio握手端点跨源_get_应返回_cors_响应头(pool: PgPool) {
    let app = koko_server::app::build_app(pool);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/socket.io/?EIO=4&transport=polling")
                .header("origin", "http://127.0.0.1:8317")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("*")
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn socketio握手端点跨源_options_不应被误判为坏握手(pool: PgPool) {
    let app = koko_server::app::build_app(pool);

    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/socket.io/?EIO=4&transport=polling")
                .header("origin", "http://127.0.0.1:8317")
                .header("access-control-request-method", "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("*")
    );
}

#[sqlx::test(migrations = "../migrations")]
async fn legacy_raw_ws_路由不应继续暴露(pool: PgPool) {
    let app = koko_server::app::build_app(pool);
    let room_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/ws/rooms/{room_id}?session_id={session_id}"))
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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
        .clone()
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
    drop(app);
}

#[sqlx::test(migrations = "../migrations")]
async fn 消息历史接口应只返回最新一页并标记是否还有更早消息(pool: PgPool) {
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
        .clone()
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
    drop(app);
}

#[sqlx::test(migrations = "../migrations")]
async fn 消息历史接口应按时间与消息id稳定分页(pool: PgPool) {
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
        .clone()
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
    drop(app);
}

#[sqlx::test(migrations = "../migrations")]
async fn 非法或跨房间锚点应返回四百(pool: PgPool) {
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
        .clone()
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
    drop(app);
}

#[sqlx::test(migrations = "../migrations")]
async fn 房间读取接口应拒绝非成员会话(pool: PgPool) {
    let app = koko_server::app::build_http_app_without_socket_io(pool.clone());
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
        .clone()
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
    drop(app);
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

