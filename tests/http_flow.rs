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
    contract::{
        BootstrapSession, JoinedRoomSummary, MessageCreated, RoomSearchResult, RoomSnapshot,
    },
    http,
    support::{SystemClock, SystemIdGenerator},
};
use std::{env, path::PathBuf, process::Command};
use std::sync::{Mutex, OnceLock};
use tower::ServiceExt;
use uuid::Uuid;

static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

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
async fn bootstrap_then_join_returns_room_snapshot(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let snapshot = join_room(&harness, &cookie, "a1234").await;

    assert_eq!(snapshot.room_code, "A1234");
    assert!(snapshot.messages.is_empty());
    Ok(())
}

#[sqlx::test]
async fn snapshot_endpoint_returns_joined_room_history(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

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
    Ok(())
}

#[sqlx::test]
async fn joined_rooms_endpoint_requires_bootstrapped_session(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/rooms")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[sqlx::test]
async fn joined_rooms_endpoint_returns_current_memberships(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

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
    Ok(())
}

#[sqlx::test]
async fn joined_rooms_endpoint_reads_koko_session_from_multi_cookie_headers(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "a1234").await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/rooms")
                .header(COOKIE, "theme=dark; tracking=on")
                .header(COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let rooms: Vec<JoinedRoomSummary> =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0].room_id, joined.room_id);
    Ok(())
}

#[sqlx::test]
async fn joined_rooms_endpoint_rejects_invalid_koko_session_in_mixed_cookie_headers(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/rooms")
                .header(COOKIE, "theme=dark; logged_in=true")
                .header(COOKIE, "koko_session=not-a-uuid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[sqlx::test]
async fn room_search_endpoint_returns_case_insensitive_matches(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "a1234").await;
    let other_session_id = Uuid::now_v7();
    seed_active_session(&harness, other_session_id).await;
    let discoverable = join_or_create_room_by_code(
        &harness.store,
        &harness.store,
        &SystemIdGenerator,
        &SystemClock,
        koko::app::JoinOrCreateRoomByCodeCommand {
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
    Ok(())
}

#[tokio::test]
async fn root_entry_serves_frontend_shell() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("koko-web-shell"));
}

#[tokio::test]
async fn frontend_shell_fallback_serves_index_for_unknown_non_api_path() {
    let harness = HttpHarness::frontend_only();

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
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("koko-web-shell"));
}

#[tokio::test]
async fn admin_path_stays_out_of_frontend_shell_fallback() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin/panel")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn assets_theme_css_is_served_as_static_file() {
    let harness = HttpHarness::frontend_only();

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
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains(".tg-shell"));
}

#[tokio::test]
async fn assets_socket_io_client_is_served_as_static_file() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/socket.io.esm.min.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("Socket.IO v4.8.3"));
}

#[tokio::test]
async fn wasm_bundle_js_is_served_as_static_file() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/wasm/koko.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("fixture wasm bundle"));
}

#[tokio::test]
async fn theme_css_exposes_telegram_shell_sections() {
    let harness = HttpHarness::frontend_only();

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
    let body = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains(".tg-conversation-list"));
    assert!(body.contains(".tg-join-by-code"));
    assert!(body.contains(".tg-chat-screen"));
}

#[tokio::test]
async fn missing_static_asset_stays_404_instead_of_falling_back_to_index() {
    let harness = HttpHarness::frontend_only();

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
}

#[tokio::test]
async fn unknown_api_path_stays_404_instead_of_falling_back_to_index() {
    let harness = HttpHarness::frontend_only();

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
}

#[test]
fn default_frontend_paths_point_to_dioxus_public_output() {
    assert_eq!(
        http::default_frontend_dist_dir(),
        PathBuf::from("dist").join("public")
    );
    assert_eq!(
        http::default_frontend_asset_dir(),
        PathBuf::from("dist").join("public").join("assets")
    );
}

#[sqlx::test]
async fn join_requires_bootstrapped_session(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

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
    Ok(())
}

#[sqlx::test]
async fn bootstrap_session_sets_cookie_and_reuses_it_on_followup_request(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

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
    Ok(())
}

#[sqlx::test]
async fn bootstrap_session_tolerates_invalid_existing_koko_session_cookie(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool);

    let response = bootstrap_session_response(&harness, Some("koko_session=not-a-uuid")).await;

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(response.headers().get(SET_COOKIE).is_some());
    Ok(())
}

#[test]
fn app_config_requires_database_url_and_admin_token() {
    let _guard = env_lock();
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::remove_var("KOKO_DATABASE_URL");
        env::remove_var("KOKO_ADMIN_TOKEN");
        env::set_var("KOKO_BIND_ADDR", "127.0.0.1:8080");
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
    let _guard = env_lock();
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::set_var("KOKO_DATABASE_URL", "   ");
        env::set_var("KOKO_ADMIN_TOKEN", "local-admin-token");
        env::set_var("KOKO_BIND_ADDR", "127.0.0.1:8080");
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

#[test]
fn app_config_defaults_bind_addr_to_0_0_0_0_8080() {
    let _guard = env_lock();
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::set_var(
            "KOKO_DATABASE_URL",
            "postgres://koko:koko_local@127.0.0.1:5432/koko_test",
        );
        env::set_var("KOKO_ADMIN_TOKEN", "local-admin-token");
        env::remove_var("KOKO_BIND_ADDR");
    }

    let config = koko::support::AppConfig::from_env().unwrap();

    assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");

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
fn app_config_respects_explicit_bind_addr_override() {
    let _guard = env_lock();
    let original_database_url = env::var("KOKO_DATABASE_URL").ok();
    let original_admin_token = env::var("KOKO_ADMIN_TOKEN").ok();
    let original_bind_addr = env::var("KOKO_BIND_ADDR").ok();

    unsafe {
        env::set_var(
            "KOKO_DATABASE_URL",
            "postgres://koko:koko_local@127.0.0.1:5432/koko_test",
        );
        env::set_var("KOKO_ADMIN_TOKEN", "local-admin-token");
        env::set_var("KOKO_BIND_ADDR", "127.0.0.1:8080");
    }

    let config = koko::support::AppConfig::from_env().unwrap();

    assert_eq!(config.bind_addr.to_string(), "127.0.0.1:8080");

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
fn root_run_script_defaults_to_lan_accessible_bind_addr() {
    let _guard = env_lock();
    let powershell = powershell_exe_path();
    let output = Command::new(powershell)
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "run.ps1",
            "-DryRun",
            "-SkipBundle",
            "-DatabaseUrl",
            "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat",
            "-AdminToken",
            "local-admin-token",
        ])
        .env("PATH", r"C:\Windows\System32")
        .env_remove("PSModulePath")
        .env_remove("PATHEXT")
        .env_remove("PROMPT")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "run.ps1 dry-run should succeed, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Skip web bundle"));
    assert!(stdout.contains("准备数据库结构"));
    assert!(stdout.contains("KOKO_DATABASE_URL"));
    assert!(stdout.contains("cargo build"));
    assert!(stdout.contains("浏览器"));
    assert!(stdout.contains("监听地址: 0.0.0.0:8080"));
    assert!(stdout.contains("127.0.0.1:8080"));
    assert!(stdout.contains("Ctrl+C"));
}

fn powershell_exe_path() -> String {
    let windir = env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".to_string());
    format!(r"{windir}\System32\WindowsPowerShell\v1.0\powershell.exe")
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
