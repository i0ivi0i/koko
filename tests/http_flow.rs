mod http_support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header::{COOKIE, SET_COOKIE}},
};
use http_support::HttpHarness;
use koko::{
    app::AppError,
    chat::{ChatState, ConnectionState, DeliveryState},
    contract::{BootstrapSession, MessageCreated, RoomSnapshot},
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

#[test]
fn web_app_uses_bootstrap_state_bridge_in_its_shell() {
    let source = include_str!("../src/web.rs");

    assert!(source.contains("bootstrap_state("));
    assert!(!source.contains("use_signal(bootstrapping_state)"));
}

#[test]
fn web_app_loads_bootstrap_session_through_dioxus_resource() {
    let source = include_str!("../src/web.rs");

    assert!(source.contains("use_resource"));
    assert!(source.contains("load_bootstrap_session"));
}

#[test]
fn web_app_keeps_chat_state_in_a_signal_instead_of_rebuilding_each_render() {
    let source = include_str!("../src/web.rs");

    assert!(source.contains("use_signal"));
    assert!(source.contains("state.set(") || source.contains("state.write()"));
    assert!(!source.contains("let state = match &*bootstrap_session"));
}

#[test]
fn web_app_surfaces_bootstrap_failures_instead_of_hiding_them_as_loading() {
    let source = include_str!("../src/web.rs");

    assert!(source.contains("Some(Err(error))"));
    assert!(source.contains("Bootstrap failed"));
}

#[test]
fn web_shell_does_not_fake_joined_state_or_require_bridge_stub() {
    let source = include_str!("../src/web.rs");

    assert!(!source.contains("ConnectionState::Joined"));
    assert!(!source.contains("SOCKET_BRIDGE_PATH"));
    assert_eq!(ChatState::default().connection(), ConnectionState::Offline);
}

#[test]
fn web_shell_does_not_bootstrap_from_local_default_state() {
    let source = include_str!("../src/web.rs");

    assert!(!source.contains("ChatState::default"));
    assert!(
        source.contains("bootstrap_session")
            || source.contains("bootstrap_anonymous_session")
            || source.contains("/api/session/bootstrap")
    );
}

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

    let snapshot: RoomSnapshot =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
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
    let first_session: BootstrapSession =
        serde_json::from_slice(&to_bytes(first_response.into_body(), usize::MAX).await.unwrap())
            .unwrap();

    let cookie_value = first_set_cookie
        .split(';')
        .next()
        .expect("Set-Cookie should contain a cookie pair")
        .to_string();
    let second_response = bootstrap_session_response(&harness, Some(cookie_value.as_str())).await;
    assert_eq!(second_response.status(), StatusCode::CREATED);

    let second_session: BootstrapSession =
        serde_json::from_slice(&to_bytes(second_response.into_body(), usize::MAX).await.unwrap())
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

async fn bootstrap_session(harness: &HttpHarness) -> BootstrapSession {
    let response = bootstrap_session_response(harness, None).await;

    assert_eq!(response.status(), StatusCode::CREATED);

    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

async fn bootstrap_session_response(
    harness: &HttpHarness,
    cookie: Option<&str>,
) -> axum::http::Response<Body> {
    let mut request = Request::builder().method("POST").uri("/api/session/bootstrap");

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
