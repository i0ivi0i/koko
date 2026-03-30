mod http_support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http_support::HttpHarness;
use koko::contract::{BootstrapSession, RoomSnapshot};
use std::env;
use tower::ServiceExt;

#[tokio::test]
async fn bootstrap_then_join_returns_room_snapshot() {
    let harness = HttpHarness::new("bootstrap_then_join_returns_room_snapshot").await;

    let session = bootstrap_session(&harness).await;
    let snapshot = join_room(&harness, session.session_id, "a1234").await;

    assert_eq!(snapshot.room_code, "A1234");
    assert!(snapshot.messages.is_empty());
    harness.cleanup().await;
}

#[tokio::test]
async fn snapshot_endpoint_returns_joined_room_history() {
    let harness = HttpHarness::new("snapshot_endpoint_returns_joined_room_history").await;

    let session = bootstrap_session(&harness).await;
    let joined = join_room(&harness, session.session_id, "b1234").await;
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/rooms/{}/snapshot?session_id={}",
                    joined.room_id, session.session_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let snapshot: RoomSnapshot = serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
    )
    .unwrap();
    assert_eq!(snapshot.room_id, joined.room_id);
    assert_eq!(snapshot.room_code, "B1234");
    harness.cleanup().await;
}

#[tokio::test]
async fn join_requires_bootstrapped_session() {
    let harness = HttpHarness::new("join_requires_bootstrapped_session").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/rooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "room_code": "C1234",
                        "session_id": uuid::Uuid::now_v7(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    harness.cleanup().await;
}

#[test]
fn app_config_requires_database_url_and_admin_token() {
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::remove_var("KOKO_DATABASE_URL");
        env::remove_var("KOKO_ADMIN_TOKEN");
        env::set_var("KOKO_BIND_ADDR", "127.0.0.1:4000");
    }

    assert!(koko::support::AppConfig::from_env().is_err());

    unsafe {
        env::set_var("KOKO_DATABASE_URL", "postgres://koko:koko_local@127.0.0.1:5432/koko_test");
        env::set_var("KOKO_ADMIN_TOKEN", "");
    }

    assert!(koko::support::AppConfig::from_env().is_err());

    unsafe {
        match original_database_url {
            Some(value) => env::set_var("KOKO_DATABASE_URL", value),
            None => env::remove_var("KOKO_DATABASE_URL"),
        }
        match original_admin_token {
            Some(value) => env::set_var("KOKO_ADMIN_TOKEN", value),
            None => env::remove_var("KOKO_ADMIN_TOKEN"),
        }
        match original_bind_addr {
            Some(value) => env::set_var("KOKO_BIND_ADDR", value),
            None => env::remove_var("KOKO_BIND_ADDR"),
        }
    }
}

async fn bootstrap_session(harness: &HttpHarness) -> BootstrapSession {
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/session/bootstrap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);

    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

async fn join_room(harness: &HttpHarness, session_id: uuid::Uuid, room_code: &str) -> RoomSnapshot {
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/rooms/join")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "room_code": room_code,
                        "session_id": session_id,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
