use std::path::{Path as FsPath, PathBuf};

use axum::{
    Json, Router,
    extract::{Path as RoutePath, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use serde::Deserialize;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

use crate::{
    app::{
        AppError, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, bootstrap_anonymous_session,
        join_or_create_room_by_code, list_joined_rooms, load_room_snapshot, search_rooms_by_code,
    },
    contract::{
        AdminOverview, AdminRoomSummary, JoinedRoomSummary, RoomSearchResult, RoomSnapshot,
    },
    store::PgStore,
    support,
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

#[derive(Clone)]
struct HttpState {
    store: PgStore,
    admin_access: support::StaticAdminAccess,
}

#[derive(Debug, Deserialize)]
struct JoinRoomRequest {
    room_code: String,
}

#[derive(Debug, Deserialize)]
struct SearchRoomsParams {
    query: String,
}

pub const FRONTEND_DIST_DIR: &str = "dist/public";
pub const FRONTEND_ASSET_DIR: &str = "dist/public/assets";

pub fn api_router(store: PgStore, admin_token: String, _admin_cookie_secure: bool) -> Router {
    Router::new()
        .route("/session/bootstrap", post(bootstrap_session))
        .route("/rooms", get(joined_rooms))
        .route("/rooms/search", get(search_rooms))
        .route("/rooms/join", post(join_room))
        .route("/rooms/{room_id}/snapshot", get(room_snapshot))
        .route("/admin/overview", get(admin_overview))
        .route("/admin/rooms", get(admin_rooms))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .with_state(HttpState {
            store,
            admin_access: support::StaticAdminAccess::new(admin_token),
        })
}

pub fn app_router(
    store: PgStore,
    admin_token: String,
    admin_cookie_secure: bool,
    frontend_dist_dir: impl Into<PathBuf>,
    asset_dir: impl Into<PathBuf>,
) -> Router {
    let frontend_dist_dir = frontend_dist_dir.into();
    let index_file = frontend_dist_dir.join("index.html");
    let wasm_dir = frontend_dist_dir.join("wasm");

    Router::new()
        .nest("/api", api_router(store, admin_token, admin_cookie_secure))
        .nest_service("/assets", ServeDir::new(asset_dir.into()))
        .nest_service("/wasm", ServeDir::new(wasm_dir))
        .route_service("/", ServeFile::new(index_file.clone()))
        .route("/admin", get(frontend_reserved_not_found))
        .route("/admin/{*path}", get(frontend_reserved_not_found))
        .fallback_service(
            // 非 API 深链接统一回到入口壳，静态资源由 /assets 与 /wasm 独立承接。
            ServeFile::new(index_file),
        )
}

pub fn server_router(
    store: PgStore,
    admin_token: String,
    admin_cookie_secure: bool,
    frontend_dist_dir: impl Into<PathBuf>,
    asset_dir: impl Into<PathBuf>,
) -> Router {
    let (socket_layer, io) = socketioxide::SocketIo::new_layer();
    let realtime = Arc::new(crate::rt::RealtimeState::new(
        store.clone(),
        support::SystemIdGenerator,
        support::SystemClock,
    ));
    crate::rt::install_realtime(&io, realtime);
    app_router(
        store,
        admin_token,
        admin_cookie_secure,
        frontend_dist_dir,
        asset_dir,
    )
    .layer(socket_layer)
}

pub fn default_frontend_dist_dir() -> PathBuf {
    FsPath::new(FRONTEND_DIST_DIR).to_path_buf()
}

pub fn default_frontend_asset_dir() -> PathBuf {
    FsPath::new(FRONTEND_ASSET_DIR).to_path_buf()
}

async fn frontend_reserved_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

async fn bootstrap_session(
    State(state): State<HttpState>,
    jar: CookieJar,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorPayload>)> {
    let existing_session_id = jar
        .get(support::SESSION_COOKIE_NAME)
        .and_then(|cookie| Uuid::parse_str(cookie.value()).ok());
    let session = bootstrap_anonymous_session(
        &state.store,
        &support::SystemClock,
        existing_session_id,
        Uuid::now_v7(),
    )
    .await
    .map_err(map_http_error)?;
    let cookie = Cookie::build((support::SESSION_COOKIE_NAME, session.session_id.to_string()))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .build();

    Ok((jar.add(cookie), (StatusCode::CREATED, Json(session))))
}

async fn join_room(
    State(state): State<HttpState>,
    jar: CookieJar,
    Json(request): Json<JoinRoomRequest>,
) -> Result<Json<RoomSnapshot>, (StatusCode, Json<ErrorPayload>)> {
    let session_id = resolve_session_id(&jar)?;
    let snapshot = join_or_create_room_by_code(
        &state.store,
        &state.store,
        &support::SystemIdGenerator,
        &support::SystemClock,
        JoinOrCreateRoomByCodeCommand {
            room_code: request.room_code,
            session_id,
        },
    )
    .await
    .map_err(map_http_error)?;
    Ok(Json(snapshot))
}

async fn joined_rooms(
    State(state): State<HttpState>,
    jar: CookieJar,
) -> Result<Json<Vec<JoinedRoomSummary>>, (StatusCode, Json<ErrorPayload>)> {
    let session_id = resolve_session_id(&jar)?;
    let rooms = list_joined_rooms(
        &state.store,
        &state.store,
        crate::app::ListJoinedRoomsQuery { session_id },
    )
    .await
    .map_err(map_http_error)?;
    Ok(Json(rooms))
}

async fn search_rooms(
    State(state): State<HttpState>,
    jar: CookieJar,
    axum::extract::Query(params): axum::extract::Query<SearchRoomsParams>,
) -> Result<Json<Vec<RoomSearchResult>>, (StatusCode, Json<ErrorPayload>)> {
    let session_id = resolve_session_id(&jar)?;
    let rooms = search_rooms_by_code(
        &state.store,
        &state.store,
        crate::app::SearchRoomsByCodeQuery {
            session_id,
            input: params.query,
        },
    )
    .await
    .map_err(map_http_error)?;
    Ok(Json(rooms))
}

async fn room_snapshot(
    State(state): State<HttpState>,
    RoutePath(room_id): RoutePath<Uuid>,
    jar: CookieJar,
) -> Result<Json<RoomSnapshot>, (StatusCode, Json<ErrorPayload>)> {
    let session_id = resolve_session_id(&jar)?;
    let snapshot = load_room_snapshot(
        &state.store,
        &state.store,
        &state.store,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .map_err(map_http_error)?;
    Ok(Json(snapshot))
}

async fn admin_overview(
    State(state): State<HttpState>,
    headers: HeaderMap,
) -> Result<Json<AdminOverview>, (StatusCode, Json<ErrorPayload>)> {
    authorize_admin_token(&state.admin_access, &headers).await?;
    let overview = crate::app::AdminOverviewPort::get_admin_overview(&state.store)
        .await
        .map_err(map_http_error)?;
    Ok(Json(overview))
}

async fn admin_rooms(
    State(state): State<HttpState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminRoomSummary>>, (StatusCode, Json<ErrorPayload>)> {
    authorize_admin_token(&state.admin_access, &headers).await?;
    let rooms = crate::app::AdminRoomsPort::list_admin_rooms(&state.store)
        .await
        .map_err(map_http_error)?;
    Ok(Json(rooms))
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct ErrorPayload {
    code: String,
}

fn resolve_admin_token(
    headers: &HeaderMap,
) -> Result<&str, (StatusCode, Json<ErrorPayload>)> {
    headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(invalid_admin_token_error)
}

async fn authorize_admin_token(
    admin_access: &support::StaticAdminAccess,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<ErrorPayload>)> {
    let token = resolve_admin_token(headers)?;
    let authorized = crate::app::AdminCredentialPort::verify_admin_token(admin_access, token)
        .await
        .map_err(map_http_error)?;
    if authorized {
        Ok(())
    } else {
        Err(invalid_admin_token_error())
    }
}

fn resolve_session_id(jar: &CookieJar) -> Result<Uuid, (StatusCode, Json<ErrorPayload>)> {
    jar.get(support::SESSION_COOKIE_NAME)
        .and_then(|cookie| Uuid::parse_str(cookie.value()).ok())
        .ok_or_else(invalid_session_error)
}

fn invalid_session_error() -> (StatusCode, Json<ErrorPayload>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorPayload {
            code: support::app_error_code(&AppError::SessionNotActive {
                session_id: Uuid::nil(),
            })
            .to_string(),
        }),
    )
}

fn invalid_admin_token_error() -> (StatusCode, Json<ErrorPayload>) {
    map_http_error(AppError::InvalidAdminToken)
}

fn map_http_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    let status = match error {
        AppError::SessionNotActive { .. } => StatusCode::UNAUTHORIZED,
        AppError::NotRoomMember { .. } => StatusCode::FORBIDDEN,
        AppError::InvalidAdminToken
        | AppError::AdminSessionRequired
        | AppError::AdminSessionExpired
        | AppError::AdminSessionReplaced => StatusCode::UNAUTHORIZED,
        AppError::Domain(crate::domain::DomainError::InvalidRoomCode)
        | AppError::Domain(crate::domain::DomainError::EmptyMessageBody) => StatusCode::BAD_REQUEST,
        AppError::DependencyFailure => StatusCode::INTERNAL_SERVER_ERROR,
    };

    (
        status,
        Json(ErrorPayload {
            code: support::app_error_code(&error).to_string(),
        }),
    )
}
