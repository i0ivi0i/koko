use axum::{
    body::{Body, to_bytes},
    http::{
        Request, StatusCode,
        header::{COOKIE, SET_COOKIE},
    },
};
use std::sync::{Mutex, OnceLock};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use tower::ServiceExt;
use uuid::Uuid;

#[path = "http_support/mod.rs"]
mod http_support;
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

static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[path = "http_cases/chat_state.rs"]
mod chat_state;
#[path = "http_cases/routes.rs"]
mod routes;
#[path = "http_cases/session.rs"]
mod session;
#[path = "http_cases/config.rs"]
mod config;
#[path = "http_cases/startup.rs"]
mod startup;
#[path = "http_cases/run_script.rs"]
mod run_script;
#[path = "http_cases/web_shell.rs"]
mod web_shell;
#[path = "http_cases/view_render.rs"]
mod view_render;
#[path = "http_cases/admin.rs"]
mod admin;

fn run_root_script_with_fake_cargo(args: &[&str], shim_dir: &Path) -> std::process::Output {
    let _guard = env_lock();
    let powershell = powershell_exe_path();
    std::process::Command::new(powershell)
        .args(["-ExecutionPolicy", "Bypass", "-File", "run.ps1"])
        .args(args)
        .env("PATH", format!(r"{};C:\Windows\System32", shim_dir.display()))
        .env("PATHEXT", ".COM;.EXE;.BAT;.CMD")
        .env_remove("KOKO_ADMIN_TOKEN")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .unwrap()
}

fn temp_config_file_path(case_name: &str) -> PathBuf {
    env::temp_dir()
        .join("koko-tests")
        .join(format!("{case_name}-{}", Uuid::now_v7()))
        .join("config")
        .join("koko.toml")
}

fn sample_startup_config() -> koko::support::AppConfig {
    let config_path = temp_config_file_path("startup-banner-sample");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path,
        Some("local-admin-token"),
        None,
    )
    .unwrap()
}

struct TempConfigRootGuard(PathBuf);

impl TempConfigRootGuard {
    fn new(config_file_path: PathBuf) -> Self {
        Self(config_file_path)
    }
}

impl Drop for TempConfigRootGuard {
    fn drop(&mut self) {
        remove_temp_config_root(&self.0);
    }
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

fn bundled_frontend_index_html() -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("dist")
            .join("public")
            .join("index.html"),
    )
    .expect("bundled frontend index should exist")
}

fn bundled_frontend_asset(asset_name: &str) -> String {
    fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("dist")
            .join("public")
            .join("assets")
            .join(asset_name),
    )
    .unwrap_or_else(|_| panic!("bundled frontend asset should exist: {asset_name}"))
}

fn script_src_position(html: &str, script_name: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(script_offset) = html[search_from..].find("<script") {
        let script_start = search_from + script_offset;
        let script_tail = &html[script_start..];
        let script_end = script_tail.find('>')?;
        let tag = &script_tail[..script_end];
        if tag.contains("src=") && tag.contains(script_name) {
            return Some(script_start);
        }
        search_from = script_start + script_end + 1;
    }
    None
}

struct TempDirGuard(PathBuf);

impl TempDirGuard {
    fn new(root: PathBuf) -> Self {
        Self(root)
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn temp_fake_xtask_cargo(exit_code: i32) -> (PathBuf, PathBuf, TempDirGuard) {
    let tool_dir = env::temp_dir()
        .join("koko-tests")
        .join(format!("fake-xtask-cargo-{}", Uuid::now_v7()));
    fs::create_dir_all(&tool_dir).unwrap();
    let log_path = tool_dir.join("cargo.log");

    let cargo_script = tool_dir.join("cargo.cmd");
    fs::write(
        &cargo_script,
        format!(
            "@echo off\r\n\
setlocal\r\n\
echo args^|%*>>\"{log}\"\r\n\
echo env^|KOKO_ADMIN_TOKEN=%KOKO_ADMIN_TOKEN%>>\"{log}\"\r\n\
exit /b {exit_code}\r\n",
            log = log_path.display()
        ),
    )
    .unwrap();

    (tool_dir.clone(), log_path, TempDirGuard::new(tool_dir))
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

async fn send_room_message(
    harness: &HttpHarness,
    cookie: &str,
    room_id: Uuid,
    body: &str,
    client_message_id: Option<Uuid>,
) -> MessageCreated {
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/rooms/{room_id}/messages"))
                .header("content-type", "application/json")
                .header(COOKIE, cookie)
                .body(Body::from(
                    serde_json::json!({
                        "body": body,
                        "client_message_id": client_message_id,
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
