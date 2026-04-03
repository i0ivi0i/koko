use super::*;

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
    let socket_io_position = script_src_position(&index_html, "socket.io.min.js")
        .expect("bundled index should preload socket.io.min.js");
    let wasm_bootstrap_position =
        script_src_position(&index_html, "koko.js").expect("bundled index should load koko.js");

    assert!(
        socket_io_position < wasm_bootstrap_position,
        "socket.io preload must appear before wasm bootstrap in dist/public/index.html"
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

