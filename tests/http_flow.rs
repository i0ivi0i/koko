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
use std::sync::{Mutex, OnceLock};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
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
async fn admin_entry_serves_frontend_shell() {
    let harness = HttpHarness::frontend_only();

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/admin")
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

#[test]
fn admin_route_detection_treats_only_admin_as_backend_entry() {
    assert!(koko::admin::is_admin_shell_path("https://example.com/admin"));
    assert!(!koko::admin::is_admin_shell_path("https://example.com/rooms/a1234"));
}

#[sqlx::test]
async fn bootstrap_then_join_returns_room_snapshot(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let snapshot = join_room(&harness, &cookie, "a1234").await;

    assert_eq!(snapshot.room_code, "A1234");
    assert!(snapshot.messages.is_empty());
    Ok(())
}

#[sqlx::test]
async fn snapshot_endpoint_returns_joined_room_history(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

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
    let harness = HttpHarness::new(pool).await;

    let response = bootstrap_session_response(&harness, Some("koko_session=not-a-uuid")).await;

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(response.headers().get(SET_COOKIE).is_some());
    Ok(())
}

#[test]
fn bootstrap_session_cookie_path_does_not_apply_admin_cookie_secure_yet() {
    let http_source =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/http.rs")).unwrap();
    assert!(!http_source.contains(".secure("));
}

#[test]
fn app_config_requires_database_url() {
    let config_path = temp_config_file_path("requires-db-url");
    let result = koko::support::AppConfig::load_for_test(
        None,
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    );

    assert!(result.is_err());
    remove_temp_config_root(&config_path);
}

#[test]
fn app_config_rejects_empty_database_url() {
    let config_path = temp_config_file_path("rejects-empty-db-url");
    let result = koko::support::AppConfig::load_for_test(
        Some("   "),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    );

    assert!(result.is_err());
    remove_temp_config_root(&config_path);
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
fn app_error_code_exposes_admin_session_codes() {
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionRequired),
        "admin_session_required"
    );
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionExpired),
        "admin_session_expired"
    );
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionReplaced),
        "admin_session_replaced"
    );
}

#[test]
fn app_config_defaults_bind_addr_to_0_0_0_0_8080() {
    let config_path = temp_config_file_path("default-bind-addr");
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        None,
        config_path.clone(),
        Some("local-admin-token"),
        None,
    )
    .unwrap();

    assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
    remove_temp_config_root(&config_path);
}

#[test]
fn app_config_respects_explicit_bind_addr_override() {
    let config_path = temp_config_file_path("explicit-bind-addr");
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    )
    .unwrap();

    assert_eq!(config.bind_addr.to_string(), "127.0.0.1:8080");
    remove_temp_config_root(&config_path);
}

#[test]
fn app_config_bootstraps_admin_token_into_config_file() {
    let config_path = temp_config_file_path("bootstrap-admin-token");
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        None,
        None,
    )
    .unwrap();

    assert!(!config.admin_token.is_empty());
    assert!(config.admin_token_notice.is_some());
    let content = fs::read_to_string(&config_path).unwrap();
    assert_eq!(
        content,
        format!("admin_token = \"{}\"\n", config.admin_token)
    );
    remove_temp_config_root(&config_path);
}

#[test]
fn app_config_imports_admin_token_from_env_once_when_file_missing() {
    let config_path = temp_config_file_path("import-admin-token-once");
    let first = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("migrated-admin-token"),
        None,
    )
    .unwrap();
    assert_eq!(first.admin_token, "migrated-admin-token");
    assert!(
        first
            .admin_token_notice
            .as_deref()
            .unwrap_or_default()
            .contains("KOKO_ADMIN_TOKEN")
    );

    let second = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("ignored-token"),
        None,
    )
    .unwrap();
    assert_eq!(second.admin_token, "migrated-admin-token");
    assert!(second.admin_token_notice.is_none());
    remove_temp_config_root(&config_path);
}

#[test]
fn app_config_respects_admin_cookie_secure_override() {
    let config_path = temp_config_file_path("admin-cookie-secure");
    let secure = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        Some(true),
    )
    .unwrap();
    assert!(secure.admin_cookie_secure);

    let insecure = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        None,
        Some(false),
    )
    .unwrap();
    assert!(!insecure.admin_cookie_secure);
    remove_temp_config_root(&config_path);
}

#[test]
fn startup_banner_renders_home_admin_token_and_notice() {
    let banner = koko::support::StartupBanner {
        home_urls: vec!["http://127.0.0.1:8080/".to_string()],
        lan_urls: vec![],
        admin_url: "http://127.0.0.1:8080/admin".to_string(),
        admin_token: "admin-token".to_string(),
        admin_token_notice: Some("首次启动已写入 config/koko.toml".to_string()),
    };

    let lines = banner.render_lines();

    assert_eq!(lines[0], "==> 首页地址: http://127.0.0.1:8080/");
    assert_eq!(lines[1], "==> 管理入口: http://127.0.0.1:8080/admin");
    assert_eq!(lines[2], "==> 当前管理员口令: admin-token");
    assert_eq!(lines[3], "==> 首次启动已写入 config/koko.toml");
}

#[test]
fn startup_banner_keeps_admin_token_notice_from_app_config() {
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        temp_config_file_path("startup-banner-notice"),
        None,
        None,
    )
    .unwrap();

    let banner = koko::support::build_startup_banner_from_bind_addr(config.bind_addr, &config);
    assert!(banner.admin_token_notice.is_some());
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
    assert!(stdout.contains("/admin"));
    assert!(stdout.contains("127.0.0.1:8080"));
    assert!(!stdout.contains("/api/admin/overview"));
    assert!(!stdout.contains("/api/admin/rooms"));
    assert!(!stdout.contains("已自动生成临时 AdminToken"));
    assert!(!stdout.contains("x-admin-token"));
    assert!(stdout.contains("Ctrl+C"));
}

#[test]
fn root_run_script_prints_admin_entry_without_temporary_admin_token_log() {
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
        "run.ps1 dry-run should keep admin entry output stable, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("/admin"));
    assert!(stdout.contains("监听地址: 0.0.0.0:8080"));
    assert!(!stdout.contains("已自动生成临时 AdminToken"));
    assert!(!stdout.contains("x-admin-token"));
}

#[test]
fn root_run_script_reuses_access_hints_in_real_startup_branch() {
    let script = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("run.ps1")).unwrap();
    let needle = "Write-AccessHints -Urls $accessUrls -OpenBrowser (-not $NoBrowser)";
    assert_eq!(script.matches(needle).count(), 2);
}

#[test]
fn root_run_script_dry_run_without_admin_token_does_not_set_koko_admin_token() {
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
        "run.ps1 dry-run without explicit admin token should succeed, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!stdout.contains("Set KOKO_ADMIN_TOKEN"));
}

#[test]
fn root_run_script_clears_inherited_admin_token_without_explicit_override() {
    let script = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("run.ps1")).unwrap();
    assert!(script.contains("Remove-Item Env:KOKO_ADMIN_TOKEN -ErrorAction SilentlyContinue"));
}

#[test]
fn root_run_script_no_browser_still_prints_homepage_url() {
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
            "-NoBrowser",
            "-DatabaseUrl",
            "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat",
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
        "run.ps1 dry-run with -NoBrowser should succeed, stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("首页地址"));
    assert!(stdout.contains("127.0.0.1:8080"));
    assert!(stdout.contains("浏览器不会自动打开"));
}

#[test]
fn rust_binary_startup_source_prints_current_admin_token() {
    let main_source =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/main.rs")).unwrap();
    assert!(main_source.contains("当前管理员口令:"));
    assert!(main_source.contains("config.admin_token"));
}

#[test]
fn root_run_script_prints_current_admin_token_from_config() {
    let _guard = env_lock();
    let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("config/koko.toml");
    let config_source = fs::read_to_string(&config_path).unwrap();
    let current_admin_token = config_source
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let (_, value) = line.split_once('=')?;
            serde_json::from_str::<String>(value.trim()).ok()
        })
        .expect("repo config should contain a readable admin token");

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
    assert!(stdout.contains("当前管理员口令:"));
    assert!(stdout.contains(&current_admin_token));
}

fn temp_config_file_path(case_name: &str) -> PathBuf {
    env::temp_dir()
        .join("koko-tests")
        .join(format!("{case_name}-{}", Uuid::now_v7()))
        .join("config")
        .join("koko.toml")
}

fn remove_temp_config_root(config_file_path: &Path) {
    let Some(root) = config_file_path.parent().and_then(|value| value.parent()) else {
        return;
    };
    let _ = fs::remove_dir_all(root);
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
