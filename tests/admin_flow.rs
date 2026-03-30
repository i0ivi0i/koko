mod http_support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use chrono::{TimeZone, Utc};
use http_support::HttpHarness;
use koko::{
    admin::{AdminPanelState, AdminRoomSummary, render_admin_panel},
    app::send_text_message,
    contract::{AdminOverview, BootstrapSession, SendTextMessageCommand},
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn admin_panel_renders_room_summary_and_member_count() {
    let panel = render_admin_panel(&AdminPanelState::new(
        AdminOverview {
            room_count: 3,
            member_count: 18,
            message_count: 42,
        },
        vec![
            AdminRoomSummary::new("A1234", 12, 21, "hello admin"),
            AdminRoomSummary::new("B1234", 6, 21, "world admin"),
        ],
    ));

    assert!(panel.contains("Rooms"));
    assert!(panel.contains("A1234"));
    assert!(panel.contains("12 members"));
    assert!(panel.contains("hello admin"));
}

#[test]
fn admin_app_no_longer_boots_from_preview_state() {
    let source = include_str!("../src/admin.rs");

    assert!(!source.contains("AdminPanelState::preview()"));
}

#[tokio::test]
async fn admin_overview_returns_room_member_and_message_counts() {
    let harness = HttpHarness::new("admin_overview_returns_room_member_and_message_counts").await;

    let first_session = bootstrap_session(&harness).await;
    let second_session = bootstrap_session(&harness).await;
    let room = join_room(&harness, first_session.session_id, "d1234").await;
    let _ = join_room(&harness, second_session.session_id, "d1234").await;

    let event = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FixedIdGenerator(Uuid::from_u128(9)),
        &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        SendTextMessageCommand {
            room_id: room.room_id,
            session_id: first_session.session_id,
            body: "hello admin".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();
    assert!(matches!(event, koko::contract::AppEvent::MessageCreated(_)));

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/overview")
                .header("x-admin-token", "local-admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let overview: AdminOverview =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(overview.room_count, 1);
    assert_eq!(overview.member_count, 2);
    assert_eq!(overview.message_count, 1);
    harness.cleanup().await;
}

#[tokio::test]
async fn admin_overview_requires_admin_token() {
    let harness = HttpHarness::new("admin_overview_requires_admin_token").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/overview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    harness.cleanup().await;
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

async fn join_room(
    harness: &HttpHarness,
    session_id: uuid::Uuid,
    room_code: &str,
) -> koko::contract::RoomSnapshot {
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

struct FixedIdGenerator(Uuid);

impl koko::app::IdGenerator for FixedIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.0
    }
}

struct FixedClock(chrono::DateTime<Utc>);

impl koko::app::Clock for FixedClock {
    fn now(&self) -> chrono::DateTime<Utc> {
        self.0
    }
}
