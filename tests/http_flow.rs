mod http_support;

use axum::{
    body::{Body, to_bytes},
    http::{
        Request, StatusCode,
        header::{COOKIE, SET_COOKIE},
    },
};
use http_support::HttpHarness;
use koko::{
    app::{AppError, join_or_create_room_by_code},
    chat::{ChatState, ConnectionState, DeliveryState},
    contract::{BootstrapSession, JoinedRoomSummary, MessageCreated, RoomSearchResult, RoomSnapshot},
    support::{SystemClock, SystemIdGenerator},
};
use std::env;
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn web_state_promotes_pending_message_only_after_server_confirmation() {
    let mut state = ChatState::default();
    let room_id = Uuid::from_u128(90);
    let session_id = Uuid::from_u128(91);
    let pending_id = state.enqueue_pending(room_id, session_id, " hello koko ");

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Pending);
    assert_eq!(state.messages()[0].body, "hello koko");
    assert!(state.confirmed_messages().is_empty());

    state.confirm_message(MessageCreated {
        message_id: Uuid::from_u128(92),
        room_id,
        session_id,
        body: "hello koko".to_string(),
        created_at: chrono::Utc::now(),
        client_message_id: Some(pending_id),
    });

    assert_eq!(state.messages().len(), 1);
    assert_eq!(state.messages()[0].delivery, DeliveryState::Confirmed);
    assert_eq!(state.messages()[0].message_id, Some(Uuid::from_u128(92)));
    assert_eq!(state.confirmed_messages().len(), 1);
}

#[test]
fn web_state_applies_bootstrap_session_without_joining_room() {
    let mut state = ChatState::awaiting_bootstrap();
    let session = BootstrapSession {
        session_id: Uuid::from_u128(93),
        issued_at: chrono::Utc::now(),
        last_seen_at: chrono::Utc::now(),
    };

    state.apply_bootstrap_session(session.clone());

    assert_eq!(state.session_id(), session.session_id);
    assert_eq!(state.connection(), ConnectionState::Offline);
    assert_eq!(state.room_id(), None);
    assert!(state.messages().is_empty());
}

#[test]
fn web_bootstrap_state_applies_backend_session_to_chat_state() {
    let session = BootstrapSession {
        session_id: Uuid::from_u128(94),
        issued_at: chrono::Utc::now(),
        last_seen_at: chrono::Utc::now(),
    };

    let state = koko::web::bootstrap_state(session.clone());

    assert_eq!(state.session_id(), session.session_id);
    assert_eq!(state.connection(), ConnectionState::Offline);
    assert_eq!(state.room_id(), None);
    assert!(state.messages().is_empty());
}

#[tokio::test]
async fn admin_panel_route_is_not_exposed_from_http_router() {
    let harness = HttpHarness::new("admin_panel_route_is_not_exposed_from_http_router").await;

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
    harness.cleanup().await;
}

#[tokio::test]
async fn bootstrap_then_join_returns_room_snapshot() {
    let harness = HttpHarness::new("bootstrap_then_join_returns_room_snapshot").await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let snapshot = join_room(&harness, &cookie, "a1234").await;

    assert_eq!(snapshot.room_code, "A1234");
    assert!(snapshot.messages.is_empty());
    harness.cleanup().await;
}

#[tokio::test]
async fn snapshot_endpoint_returns_joined_room_history() {
    let harness = HttpHarness::new("snapshot_endpoint_returns_joined_room_history").await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "b1234").await;
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/rooms/{}/snapshot", joined.room_id))
                .header(COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let snapshot: RoomSnapshot =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(snapshot.room_id, joined.room_id);
    assert_eq!(snapshot.room_code, "B1234");
    harness.cleanup().await;
}

#[tokio::test]
async fn joined_rooms_endpoint_requires_bootstrapped_session() {
    let harness = HttpHarness::new("joined_rooms_endpoint_requires_bootstrapped_session").await;

    let response = harness
        .router
        .clone()
        .oneshot(Request::builder().uri("/api/rooms").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    harness.cleanup().await;
}

#[tokio::test]
async fn joined_rooms_endpoint_returns_current_memberships() {
    let harness = HttpHarness::new("joined_rooms_endpoint_returns_current_memberships").await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let first = join_room(&harness, &cookie, "a1234").await;
    let second = join_room(&harness, &cookie, "b1234").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/rooms")
                .header(COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let rooms: Vec<JoinedRoomSummary> =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(rooms.len(), 2);
    assert_eq!(rooms[0].room_id, first.room_id);
    assert_eq!(rooms[1].room_id, second.room_id);
    harness.cleanup().await;
}

#[tokio::test]
async fn room_search_endpoint_returns_case_insensitive_matches() {
    let harness = HttpHarness::new("room_search_endpoint_returns_case_insensitive_matches").await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "a1234").await;
    let other_session_id = Uuid::now_v7();
    seed_active_session(&harness, other_session_id).await;
    let discoverable = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        koko::contract::JoinOrCreateRoomByCodeCommand {
            room_code: "A1299".to_string(),
            session_id: other_session_id,
        },
    )
    .await
    .unwrap();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/rooms/search?query=a12")
                .header(COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let rooms: Vec<RoomSearchResult> =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(rooms.len(), 2);
    assert_eq!(rooms[0].room_id, joined.room_id);
    assert!(rooms[0].is_joined);
    assert_eq!(rooms[1].room_id, discoverable.room_id);
    assert!(!rooms[1].is_joined);
    harness.cleanup().await;
}

#[tokio::test]
async fn root_entry_serves_frontend_shell() {
    let harness = HttpHarness::new("root_entry_serves_frontend_shell").await;

    let response = harness
        .router
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec())
        .unwrap();
    assert!(body.contains("koko-web-shell"));
    harness.cleanup().await;
}

#[tokio::test]
async fn frontend_shell_fallback_serves_index_for_unknown_non_api_path() {
    let harness = HttpHarness::new("frontend_shell_fallback_serves_index_for_unknown_non_api_path").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/rooms/a1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec())
        .unwrap();
    assert!(body.contains("koko-web-shell"));
    harness.cleanup().await;
}

#[tokio::test]
async fn assets_theme_css_is_served_as_static_file() {
    let harness = HttpHarness::new("assets_theme_css_is_served_as_static_file").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/theme.css")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec())
        .unwrap();
    assert!(body.contains(".tg-shell"));
    harness.cleanup().await;
}

#[tokio::test]
async fn missing_static_asset_stays_404_instead_of_falling_back_to_index() {
    let harness = HttpHarness::new("missing_static_asset_stays_404_instead_of_falling_back_to_index").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/missing-theme.css")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    harness.cleanup().await;
}

#[tokio::test]
async fn unknown_api_path_stays_404_instead_of_falling_back_to_index() {
    let harness = HttpHarness::new("unknown_api_path_stays_404_instead_of_falling_back_to_index").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/unknown-path")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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

#[tokio::test]
async fn bootstrap_session_sets_cookie_and_reuses_it_on_followup_request() {
    let harness =
        HttpHarness::new("bootstrap_session_sets_cookie_and_reuses_it_on_followup_request").await;

    let first_response = bootstrap_session_response(&harness, None).await;
    assert_eq!(first_response.status(), StatusCode::CREATED);

    let first_set_cookie = first_response
        .headers()
        .get(SET_COOKIE)
        .expect("bootstrap should return Set-Cookie for a reusable anonymous session")
        .to_str()
        .unwrap()
        .to_string();
    let first_session: BootstrapSession = serde_json::from_slice(
        &to_bytes(first_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let cookie_value = first_set_cookie
        .split(';')
        .next()
        .expect("Set-Cookie should contain a cookie pair")
        .to_string();
    let second_response = bootstrap_session_response(&harness, Some(cookie_value.as_str())).await;
    assert_eq!(second_response.status(), StatusCode::CREATED);

    let second_session: BootstrapSession = serde_json::from_slice(
        &to_bytes(second_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(second_session.session_id, first_session.session_id);
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
        env::set_var(
            "KOKO_DATABASE_URL",
            "postgres://koko:koko_local@127.0.0.1:5432/koko_test",
        );
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

#[test]
fn app_config_rejects_empty_database_url() {
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::set_var("KOKO_DATABASE_URL", "   ");
        env::set_var("KOKO_ADMIN_TOKEN", "local-admin-token");
        env::set_var("KOKO_BIND_ADDR", "127.0.0.1:4000");
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

#[test]
fn app_error_code_exposes_stable_membership_required_code() {
    let code = koko::support::app_error_code(&AppError::NotRoomMember {
        room_id: Uuid::from_u128(120),
        session_id: Uuid::from_u128(121),
    });

    assert_eq!(code, "membership_required");
}

async fn bootstrap_session_with_cookie(harness: &HttpHarness) -> (BootstrapSession, String) {
    let response = bootstrap_session_response(harness, None).await;

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

async fn bootstrap_session_response(
    harness: &HttpHarness,
    cookie: Option<&str>,
) -> axum::http::Response<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri("/api/session/bootstrap");

    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie);
    }

    harness
        .router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn join_room(harness: &HttpHarness, cookie: &str, room_code: &str) -> RoomSnapshot {
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

async fn seed_active_session(harness: &HttpHarness, session_id: Uuid) {
    let now = chrono::Utc::now();
    sqlx::query(
        "INSERT INTO anonymous_sessions (session_id, issued_at, last_seen_at, status)
         VALUES ($1, $2, $3, 'active')",
    )
    .bind(session_id)
    .bind(now)
    .bind(now)
    .execute(harness.store.pool())
    .await
    .unwrap();
}
