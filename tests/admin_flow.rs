mod http_support;

use std::sync::Arc;

use axum::{
    body::{Body, to_bytes},
    http::{
        Request, StatusCode,
        header::{COOKIE, SET_COOKIE},
    },
};
use chrono::{TimeZone, Utc};
use http_support::HttpHarness;
use koko::{
    admin::AdminPanelState,
    app::{
        AdminLoginCommand, AdminSessionPort, AdminSessionState, SendTextMessageInput, login_admin,
        send_text_message,
    },
    contract::{AdminOverview, AdminRoomSummary, AppErrorCode, BootstrapSession},
    store::PgStore,
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn admin_panel_state_keeps_room_summary_and_member_count() {
    let panel = AdminPanelState::new(
        AdminOverview {
            room_count: 3,
            member_count: 18,
            message_count: 42,
        },
        vec![
            AdminRoomSummary {
                room_code: "A1234".to_string(),
                member_count: 12,
                message_count: 21,
                latest_preview: "hello admin".to_string(),
            },
            AdminRoomSummary {
                room_code: "B1234".to_string(),
                member_count: 6,
                message_count: 21,
                latest_preview: "world admin".to_string(),
            },
        ],
    );

    assert_eq!(panel.overview.room_count, 3);
    assert_eq!(panel.rooms[0].room_code, "A1234");
    assert_eq!(panel.rooms[0].member_count, 12);
    assert_eq!(panel.rooms[0].latest_preview, "hello admin");
}

#[test]
fn admin_panel_state_wraps_backend_overview_without_fake_rooms() {
    let state = koko::admin::admin_panel_state(
        AdminOverview {
            room_count: 5,
            member_count: 12,
            message_count: 44,
        },
        vec![],
    );

    assert_eq!(state.overview.room_count, 5);
    assert!(state.rooms.is_empty());
}

#[test]
fn admin_panel_state_composes_overview_and_rooms_from_stable_queries() {
    let state = koko::admin::admin_panel_state(
        AdminOverview {
            room_count: 2,
            member_count: 7,
            message_count: 19,
        },
        vec![AdminRoomSummary {
            room_code: "A1234".to_string(),
            member_count: 3,
            message_count: 5,
            latest_preview: "hello".to_string(),
        }],
    );

    assert_eq!(state.overview.room_count, 2);
    assert_eq!(state.rooms.len(), 1);
}

#[tokio::test]
async fn login_admin_rejects_invalid_token() {
    let error = login_admin(
        &koko::support::StaticAdminAccess::new("local-admin-token".to_string()),
        &FakeAdminSessionPort::default(),
        AdminLoginCommand {
            token: "wrong-token".to_string(),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidAdminToken);
}

#[sqlx::test]
async fn admin_rooms_returns_live_room_summaries(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let (first_session, first_cookie) = bootstrap_session_with_cookie(&harness).await;
    let (_second_session, second_cookie) = bootstrap_session_with_cookie(&harness).await;
    let room = join_room(&harness, &first_cookie, "e1234").await;
    let _ = join_room(&harness, &second_cookie, "e1234").await;

    let event = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FixedIdGenerator(Uuid::from_u128(29)),
        &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 13, 0, 0).unwrap()),
        SendTextMessageInput {
            room_id: room.room_id,
            session_id: first_session.session_id,
            body: "room summary body".to_string(),
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
                .uri("/api/admin/rooms")
                .header("x-admin-token", "local-admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let rooms: Vec<AdminRoomSummary> =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0].room_code, "E1234");
    assert_eq!(rooms[0].member_count, 2);
    assert_eq!(rooms[0].message_count, 1);
    assert_eq!(rooms[0].latest_preview, "room summary body");
    Ok(())
}

#[tokio::test]
async fn admin_panel_route_is_not_exposed_anymore() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/panel")
                .header("x-admin-token", "local-admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn admin_overview_returns_room_member_and_message_counts(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let (first_session, first_cookie) = bootstrap_session_with_cookie(&harness).await;
    let (_second_session, second_cookie) = bootstrap_session_with_cookie(&harness).await;
    let room = join_room(&harness, &first_cookie, "d1234").await;
    let _ = join_room(&harness, &second_cookie, "d1234").await;

    let event = send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FixedIdGenerator(Uuid::from_u128(9)),
        &FixedClock(Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()),
        SendTextMessageInput {
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
    Ok(())
}

#[tokio::test]
async fn admin_overview_requires_admin_token() {
    let harness = HttpHarness::frontend_only();

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
}

#[tokio::test]
async fn admin_rooms_requires_admin_token() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/rooms")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn admin_session_rotation_replaces_previous_session(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let token_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let first_session = Uuid::from_u128(701);
    let second_session = Uuid::from_u128(702);
    let issued_at = fixed_admin_time();
    let rotated_at = issued_at + chrono::TimeDelta::minutes(5);

    store
        .replace_active_admin_session(first_session, &token_fingerprint, issued_at)
        .await
        .unwrap();
    store
        .replace_active_admin_session(second_session, &token_fingerprint, rotated_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(first_session, &token_fingerprint, rotated_at, true)
            .await
            .unwrap(),
        AdminSessionState::Replaced
    );
    assert_eq!(
        store
            .read_admin_session_state(second_session, &token_fingerprint, rotated_at, true)
            .await
            .unwrap(),
        AdminSessionState::Active
    );

    let truth_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_session_truth")
        .fetch_one(store.pool())
        .await?;
    assert_eq!(truth_rows, 1);
    Ok(())
}

#[sqlx::test]
async fn admin_session_expires_after_three_idle_days(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let token_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let session_id = Uuid::from_u128(703);
    let issued_at = fixed_admin_time();
    let expired_at = issued_at + chrono::TimeDelta::days(3) + chrono::TimeDelta::seconds(1);

    store
        .replace_active_admin_session(session_id, &token_fingerprint, issued_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(session_id, &token_fingerprint, expired_at, true)
            .await
            .unwrap(),
        AdminSessionState::Expired
    );

    let truth_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_session_truth")
        .fetch_one(store.pool())
        .await?;
    assert_eq!(truth_rows, 0);
    Ok(())
}

#[sqlx::test]
async fn admin_session_becomes_invalid_after_admin_token_rotation(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let original_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let rotated_fingerprint = koko::support::admin_token_fingerprint("rotated-admin-token");
    let session_id = Uuid::from_u128(704);
    let issued_at = fixed_admin_time();

    store
        .replace_active_admin_session(session_id, &original_fingerprint, issued_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(
                session_id,
                &rotated_fingerprint,
                issued_at + chrono::TimeDelta::minutes(1),
                true,
            )
            .await
            .unwrap(),
        AdminSessionState::Required
    );

    let truth_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_session_truth")
        .fetch_one(store.pool())
        .await?;
    assert_eq!(truth_rows, 0);
    Ok(())
}

#[sqlx::test]
async fn admin_session_becomes_invalid_when_token_only_changes_outer_whitespace(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let original_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let whitespace_rotated_fingerprint =
        koko::support::admin_token_fingerprint(" local-admin-token ");
    let session_id = Uuid::from_u128(7041);
    let issued_at = fixed_admin_time();

    store
        .replace_active_admin_session(session_id, &original_fingerprint, issued_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(
                session_id,
                &whitespace_rotated_fingerprint,
                issued_at + chrono::TimeDelta::minutes(1),
                true,
            )
            .await
            .unwrap(),
        AdminSessionState::Required
    );

    let truth_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_session_truth")
        .fetch_one(store.pool())
        .await?;
    assert_eq!(truth_rows, 0);
    Ok(())
}

#[sqlx::test]
async fn admin_session_probe_does_not_refresh_last_seen(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let token_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let session_id = Uuid::from_u128(705);
    let issued_at = fixed_admin_time();
    let probe_at = issued_at + chrono::TimeDelta::days(2);
    let expired_at = issued_at + chrono::TimeDelta::days(3) + chrono::TimeDelta::seconds(1);

    store
        .replace_active_admin_session(session_id, &token_fingerprint, issued_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(session_id, &token_fingerprint, probe_at, false)
            .await
            .unwrap(),
        AdminSessionState::Active
    );

    let last_seen_at: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT last_seen_at FROM admin_session_truth")
            .fetch_one(store.pool())
            .await?;
    assert_eq!(last_seen_at, issued_at);

    assert_eq!(
        store
            .read_admin_session_state(session_id, &token_fingerprint, expired_at, false)
            .await
            .unwrap(),
        AdminSessionState::Expired
    );
    Ok(())
}

#[sqlx::test]
async fn concurrent_admin_logins_leave_only_one_active_session(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let store = Arc::new(PgStore::new(pool));
    let token_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let barrier = Arc::new(tokio::sync::Barrier::new(3));
    let first_session = Uuid::from_u128(706);
    let second_session = Uuid::from_u128(707);
    let now = fixed_admin_time();

    let first_login = {
        let store = store.clone();
        let token_fingerprint = token_fingerprint.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            store
                .replace_active_admin_session(first_session, &token_fingerprint, now)
                .await
        })
    };
    let second_login = {
        let store = store.clone();
        let token_fingerprint = token_fingerprint.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            store
                .replace_active_admin_session(second_session, &token_fingerprint, now)
                .await
        })
    };

    barrier.wait().await;
    first_login.await.unwrap().unwrap();
    second_login.await.unwrap().unwrap();

    let first_state = store
        .read_admin_session_state(first_session, &token_fingerprint, now, false)
        .await
        .unwrap();
    let second_state = store
        .read_admin_session_state(second_session, &token_fingerprint, now, false)
        .await
        .unwrap();

    assert!(matches!(
        (first_state, second_state),
        (AdminSessionState::Active, AdminSessionState::Replaced)
            | (AdminSessionState::Replaced, AdminSessionState::Active)
    ));

    let truth_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_session_truth")
        .fetch_one(store.pool())
        .await?;
    assert_eq!(truth_rows, 1);
    Ok(())
}

async fn bootstrap_session_with_cookie(harness: &HttpHarness) -> (BootstrapSession, String) {
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

    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .expect("bootstrap should set a reusable session cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let session =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();

    (session, cookie)
}

async fn join_room(
    harness: &HttpHarness,
    cookie: &str,
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
                .header(COOKIE, cookie)
                .body(Body::from(
                    serde_json::json!({
                        "room_code": room_code,
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

fn fixed_admin_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 4, 2, 10, 0, 0).unwrap()
}

#[derive(Debug, Default)]
struct FakeAdminSessionPort;

impl AdminSessionPort for FakeAdminSessionPort {
    async fn create_admin_session(
        &self,
    ) -> Result<koko::app::AdminSessionContext, koko::app::AppError> {
        panic!("invalid token should short-circuit before creating admin session");
    }

    async fn read_admin_session(
        &self,
        _context: &koko::app::AdminSessionContext,
    ) -> Result<koko::app::AdminSessionState, koko::app::AppError> {
        panic!("login flow should not read admin session state");
    }

    async fn revoke_admin_session(
        &self,
        _context: &koko::app::AdminSessionContext,
    ) -> Result<(), koko::app::AppError> {
        panic!("login flow should not revoke admin session");
    }
}
