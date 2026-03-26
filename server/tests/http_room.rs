use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn 入房或建房接口应返回房间与当前角色(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let profile_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        profile_id,
        "room-device-1"
    )
    .execute(&pool)
    .await
    .unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rooms/join-or-create")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "profile_id": profile_id.to_string(),
                        "code": "1A234",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
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
async fn 房间详情与消息历史接口应返回已创建房间信息(pool: PgPool) {
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
        .clone()
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
    assert_eq!(resolve.status(), StatusCode::OK);
    let resolve_body = to_bytes(resolve.into_body(), usize::MAX).await.unwrap();
    let resolve_payload: Value = serde_json::from_slice(&resolve_body).unwrap();
    assert_eq!(resolve_payload["exists"], true);
    assert_eq!(resolve_payload["room_id"], room_id.to_string());

    let room = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(room.status(), StatusCode::OK);
    let room_body = to_bytes(room.into_body(), usize::MAX).await.unwrap();
    let room_payload: Value = serde_json::from_slice(&room_body).unwrap();
    assert_eq!(room_payload["room_id"], room_id.to_string());
    assert_eq!(room_payload["code"], "2B345");

    let messages = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/messages"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(messages.status(), StatusCode::OK);
    let messages_body = to_bytes(messages.into_body(), usize::MAX).await.unwrap();
    let messages_payload: Value = serde_json::from_slice(&messages_body).unwrap();
    assert_eq!(messages_payload["items"], json!([]));
}

#[sqlx::test(migrations = "../migrations")]
async fn 成员列表接口应返回成员和角色(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

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
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/rooms/{room_id}/members"))
                .body(Body::empty())
                .unwrap(),
        )
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

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "owner-device"
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
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "sender_id": owner_id.to_string(),
                        "content": "hello over http",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(payload["content"], "hello over http");
    assert_eq!(payload["sender_id"], owner_id.to_string());
}
