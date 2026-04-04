use std::sync::Arc;

use crate::HttpHarness;
use chrono::{TimeZone, Utc};
use koko::{
    admin::AdminPanelState,
    app::{AdminLoginCommand, AdminSessionPort, AdminSessionState, login_admin},
    contract::{AdminOverview, AdminRoomSummary, AdminSessionStatus, AppErrorCode},
    store::PgStore,
};
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
        &koko::support::AdminTokenVerifier::new("local-admin-token".to_string()),
        &FakeAdminSessionPort,
        AdminLoginCommand {
            token: "wrong-token".to_string(),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidAdminToken);
}

#[sqlx::test]
async fn admin_login_cookie_unlocks_admin_overview_and_rooms(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await.spawn().await;

    let (_first_session, first_cookie) = harness.bootstrap_session_with_cookie().await;
    let (_second_session, second_cookie) = harness.bootstrap_session_with_cookie().await;
    let _ = harness.join_room(&first_cookie, "e1234").await;
    let _ = harness.join_room(&second_cookie, "e1234").await;

    let admin_cookie = harness.admin_login_with_cookie().await;

    let overview_response = harness
        .client()
        .get(format!("{}/api/admin/overview", harness.base_url()))
        .header(reqwest::header::COOKIE, &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(overview_response.status(), reqwest::StatusCode::OK);
    let overview: AdminOverview = overview_response.json().await.unwrap();
    assert_eq!(overview.room_count, 1);
    assert_eq!(overview.member_count, 2);
    assert_eq!(overview.message_count, 0);

    let rooms_response = harness
        .client()
        .get(format!("{}/api/admin/rooms", harness.base_url()))
        .header(reqwest::header::COOKIE, admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(rooms_response.status(), reqwest::StatusCode::OK);
    let rooms: Vec<AdminRoomSummary> = rooms_response.json().await.unwrap();
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0].room_code, "E1234");
    assert_eq!(rooms[0].member_count, 2);
    assert_eq!(rooms[0].message_count, 0);
    assert_eq!(rooms[0].latest_preview, "");

    harness.shutdown().await;
    Ok(())
}

#[sqlx::test]
async fn admin_session_survives_server_restart(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool.clone()).await.spawn().await;
    let admin_cookie = harness.admin_login_with_cookie().await;
    harness.shutdown().await;

    let restarted = HttpHarness::new(pool).await.spawn().await;
    let overview = restarted
        .client()
        .get(format!("{}/api/admin/overview", restarted.base_url()))
        .header(reqwest::header::COOKIE, admin_cookie)
        .send()
        .await
        .unwrap();

    assert_eq!(overview.status(), reqwest::StatusCode::OK);
    restarted.shutdown().await;
    Ok(())
}

#[sqlx::test]
async fn admin_logout_flushes_cookie_back_to_login_required(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await.spawn().await;
    let admin_cookie = harness.admin_login_with_cookie().await;

    let logout_response = harness
        .client()
        .post(format!("{}/api/admin/session/logout", harness.base_url()))
        .header(reqwest::header::COOKIE, &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(logout_response.status(), reqwest::StatusCode::OK);
    let logout_set_cookies: Vec<String> = logout_response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap().to_string())
        .collect();
    assert!(
        logout_set_cookies
            .iter()
            .any(|cookie| cookie.starts_with("koko_admin_session=")
                && (cookie.contains("Max-Age=0")
                    || cookie.contains("max-age=0")
                    || cookie.contains("Expires="))),
        "logout should clear the admin session cookie, got: {logout_set_cookies:?}"
    );

    let status_response = harness
        .client()
        .get(format!("{}/api/admin/session", harness.base_url()))
        .header(reqwest::header::COOKIE, &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(status_response.status(), reqwest::StatusCode::OK);
    let status: AdminSessionStatus = status_response.json().await.unwrap();
    assert!(!status.authenticated);

    let overview_response = harness
        .client()
        .get(format!("{}/api/admin/overview", harness.base_url()))
        .header(reqwest::header::COOKIE, admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(
        overview_response.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    let payload: serde_json::Value = overview_response.json().await.unwrap();
    assert_eq!(payload["code"], "admin_session_required");

    harness.shutdown().await;
    Ok(())
}

#[sqlx::test]
async fn admin_overview_requires_backend_session_cookie(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await.spawn().await;

    let response = harness
        .client()
        .get(format!("{}/api/admin/overview", harness.base_url()))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    let payload: serde_json::Value = response.json().await.unwrap();
    assert_eq!(payload["code"], "admin_session_required");

    harness.shutdown().await;
    Ok(())
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

    let active_session_id: String =
        sqlx::query_scalar("SELECT active_session_id FROM admin_session_truth")
            .fetch_one(store.pool())
            .await?;
    assert_eq!(active_session_id, session_id.to_string());
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

    let active_session_id: String =
        sqlx::query_scalar("SELECT active_session_id FROM admin_session_truth")
            .fetch_one(store.pool())
            .await?;
    assert_eq!(active_session_id, session_id.to_string());
    Ok(())
}

#[sqlx::test]
async fn admin_session_old_fingerprint_does_not_clear_new_active_session(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let store = PgStore::new(pool);
    let original_fingerprint = koko::support::admin_token_fingerprint("local-admin-token");
    let rotated_fingerprint = koko::support::admin_token_fingerprint("rotated-admin-token");
    let old_session_id = Uuid::from_u128(7042);
    let new_session_id = Uuid::from_u128(7043);
    let issued_at = fixed_admin_time();
    let rotated_at = issued_at + chrono::TimeDelta::minutes(1);

    store
        .replace_active_admin_session(old_session_id, &original_fingerprint, issued_at)
        .await
        .unwrap();
    store
        .replace_active_admin_session(new_session_id, &rotated_fingerprint, rotated_at)
        .await
        .unwrap();

    assert_eq!(
        store
            .read_admin_session_state(
                old_session_id,
                &original_fingerprint,
                rotated_at + chrono::TimeDelta::seconds(1),
                true,
            )
            .await
            .unwrap(),
        AdminSessionState::Required
    );
    assert_eq!(
        store
            .read_admin_session_state(
                new_session_id,
                &rotated_fingerprint,
                rotated_at + chrono::TimeDelta::seconds(2),
                false,
            )
            .await
            .unwrap(),
        AdminSessionState::Active
    );

    let active_session_id: String =
        sqlx::query_scalar("SELECT active_session_id FROM admin_session_truth")
            .fetch_one(store.pool())
            .await?;
    assert_eq!(active_session_id, new_session_id.to_string());
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
