use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = "../migrations")]
async fn 根路径应返回服务状态(pool: PgPool) {
    let app = koko_server::app::build_app(pool);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[sqlx::test(migrations = "../migrations")]
async fn 响应应自动附带请求_id(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "logging-owner-1"
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
        "5E678"
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
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));
}

#[sqlx::test(migrations = "../migrations")]
async fn 已有请求_id不应被覆盖(pool: PgPool) {
    let app = koko_server::app::build_app(pool.clone());
    let owner_id = Uuid::new_v4();
    let room_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        owner_id,
        "logging-owner-2"
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
        "6F789"
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
                .method("GET")
                .uri(format!("/rooms/{room_id}"))
                .header("x-request-id", "user-fixed-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-request-id"], "user-fixed-id");
}
