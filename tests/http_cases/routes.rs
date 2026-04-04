use super::*;
use chrono::{TimeZone, Utc};
use std::{io, sync::{Arc, Mutex}};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::EnvFilter;

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
async fn unknown_api_path_emits_trace_in_full_server_router(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("trace"))
        .with_writer(BufferWriter(buffer.clone()))
        .with_ansi(false)
        .compact()
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

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
    let output = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert!(
        output.contains("tower_http::trace"),
        "full server router should trace unknown /api requests, got: {output}"
    );
    Ok(())
}

#[sqlx::test]
async fn join_room_endpoint_returns_invalid_room_code_error_payload(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let (_session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/rooms/join")
                .header("content-type", "application/json")
                .header(COOKIE, &cookie)
                .body(Body::from(r#"{ "room_code": "ABCDE" }"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let payload: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(payload["code"], "invalid_room_code");
    assert_eq!(payload["layer"], "application");
    assert_eq!(payload["operation"], "join_or_create_room_by_code");
    Ok(())
}

#[sqlx::test]
async fn send_room_message_returns_application_error_context_payload(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let (_owner_session, owner_cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &owner_cookie, "d1234").await;
    let (_other_session, other_cookie) = bootstrap_session_with_cookie(&harness).await;

    let response = harness
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/rooms/{}/messages", joined.room_id))
                .header("content-type", "application/json")
                .header(COOKIE, &other_cookie)
                .body(Body::from(r#"{ "body": "blocked" }"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let payload: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(payload["code"], "membership_required");
    assert_eq!(payload["layer"], "application");
    assert_eq!(payload["operation"], "send_text_message");
    Ok(())
}

#[sqlx::test]
async fn snapshot_endpoint_returns_joined_room_history(pool: sqlx::PgPool) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let (session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "b1234").await;
    koko::app::send_text_message(
        &harness.store,
        &harness.store,
        &harness.store,
        &FixedIdGenerator(Uuid::from_u128(5001)),
        &FixedClock(fixed_time()),
        koko::app::SendTextMessageInput {
            room_id: joined.room_id,
            session_id: session.session_id,
            body: " snapshot message ".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap();

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
    assert_eq!(snapshot.latest_event_position, 1);
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].body, "snapshot message");
    assert_eq!(snapshot.messages[0].event_position, 1);
    Ok(())
}

#[sqlx::test]
async fn send_room_message_endpoint_returns_authoritative_message_created(
    pool: sqlx::PgPool,
) -> sqlx::Result<()> {
    let harness = HttpHarness::new(pool).await;

    let (session, cookie) = bootstrap_session_with_cookie(&harness).await;
    let joined = join_room(&harness, &cookie, "c1234").await;
    let client_message_id = Uuid::from_u128(6001);

    let created = send_room_message(
        &harness,
        &cookie,
        joined.room_id,
        " http send message ",
        Some(client_message_id),
    )
    .await;

    assert_eq!(created.room_id, joined.room_id);
    assert_eq!(created.session_id, session.session_id);
    assert_eq!(created.body, "http send message");
    assert_eq!(created.client_message_id, Some(client_message_id));
    assert_eq!(created.event_position, 1);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct FixedIdGenerator(Uuid);

impl koko::app::IdGenerator for FixedIdGenerator {
    fn next_message_id(&self) -> Uuid {
        self.0
    }
}

#[derive(Debug, Clone, Copy)]
struct FixedClock(chrono::DateTime<Utc>);

impl koko::app::Clock for FixedClock {
    fn now(&self) -> chrono::DateTime<Utc> {
        self.0
    }
}

fn fixed_time() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 30, 12, 0, 0).unwrap()
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
                .uri("/assets/socket.io.min.js")
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
    assert!(
        body.contains("globalThis?globalThis:t||self).io=n()"),
        "socket.io static asset should be the browser UMD bundle that exposes global io"
    );
    assert!(
        !body.contains("export default"),
        "socket.io static asset must not be the ESM build because index.html loads it as a classic script"
    );
}

#[tokio::test]
async fn old_socket_io_client_asset_is_no_longer_served() {
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

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[test]
fn bundled_index_preloads_socket_io_before_wasm_bootstrap() {
    let index_html = bundled_frontend_index_html();
    assert!(
        index_html.contains(r#"src="./assets/socket.io.min.js""#)
            || index_html.contains(r#"src="/assets/socket.io.min.js""#),
        "bundled index should point socket.io preload at the static /assets route"
    );
    assert!(
        !index_html.contains("./public/assets/socket.io.min.js"),
        "bundled index must not point socket.io preload at the nonexistent /public/assets route"
    );
    let socket_io_position = script_src_position(&index_html, "socket.io.min.js")
        .expect("bundled index should preload socket.io.min.js");
    let wasm_bootstrap_position = script_src_position(&index_html, "koko-")
        .expect("bundled index should load the hashed wasm bootstrap script");

    assert!(
        socket_io_position < wasm_bootstrap_position,
        "socket.io preload must appear before wasm bootstrap in dist/public/index.html"
    );
}

#[test]
fn bundled_index_never_references_dioxus_dev_runtime() {
    let index_html = bundled_frontend_index_html();

    assert!(
        !index_html.contains("/_dioxus"),
        "Axum static shell must not leak any Dioxus dev runtime path into dist/public/index.html"
    );
    assert!(
        !index_html.contains("dx serve"),
        "bundled index must stay detached from dx serve-specific runtime hints"
    );
}

#[test]
fn bundled_socket_io_asset_stays_browser_umd() {
    let socket_io_asset = bundled_frontend_asset("socket.io.min.js");

    assert!(
        socket_io_asset.contains("globalThis?globalThis:t||self).io=n()"),
        "bundled socket.io asset should expose global io for the realtime bridge"
    );
    assert!(
        !socket_io_asset.contains("export default"),
        "bundled socket.io asset must not regress to the ESM build"
    );
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

#[test]
fn dioxus_production_resources_stay_on_static_assets_route() {
    let dioxus_toml = dioxus_toml_contents();

    assert!(
        dioxus_toml.contains("[web.resource]\r\nscript = [\"/assets/socket.io.min.js\"]")
            || dioxus_toml.contains("[web.resource]\nscript = [\"/assets/socket.io.min.js\"]"),
        "Dioxus production resources must keep socket.io on the static /assets route"
    );
    assert!(
        !dioxus_toml.contains("./public/assets/socket.io.min.js"),
        "production resources must not point back to the source-only ./public/assets path"
    );
    assert!(
        !dioxus_toml.contains("/_dioxus"),
        "Dioxus config must not leak dev runtime endpoints into the static shell config"
    );
    assert!(
        !dioxus_toml.contains("socket.io.esm.min.js"),
        "Dioxus config must not regress to the ESM socket.io bundle for classic script loading"
    );
}

struct BufferWriter(Arc<Mutex<Vec<u8>>>);

struct BufferGuard(Arc<Mutex<Vec<u8>>>);

impl<'a> MakeWriter<'a> for BufferWriter {
    type Writer = BufferGuard;

    fn make_writer(&'a self) -> Self::Writer {
        BufferGuard(self.0.clone())
    }
}

impl io::Write for BufferGuard {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

