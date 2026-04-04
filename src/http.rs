use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path as RoutePath, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{any, get, post},
};
use axum_extra::extract::cookie::Cookie;
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tower_sessions::{Expiry, Session, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore as AdminSessionStore;
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    app::{
        AdminLoginCommand, AdminSessionContext, AdminSessionPort, AdminSessionState, AppError,
        Clock, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery, SendTextMessageInput,
        bootstrap_anonymous_session, get_admin_overview, get_admin_session,
        join_or_create_room_by_code, list_admin_rooms, list_joined_rooms, load_room_snapshot,
        login_admin, logout_admin, search_rooms_by_code, send_text_message,
    },
    contract::{
        AdminLoginRequest, AdminOverview, AdminRoomSummary, AdminSessionStatus, AppEvent,
        ErrorOperation, JoinedRoomSummary, MessageCreated, RoomSearchResult, RoomSnapshot,
    },
    store::{ADMIN_SESSION_IDLE_TIMEOUT, PgStore},
    support,
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

#[derive(Clone)]
struct HttpState {
    store: PgStore,
    io: socketioxide::SocketIo,
}

#[derive(Clone)]
struct AdminHttpState {
    store: PgStore,
    admin_token_verifier: support::AdminTokenVerifier,
    admin_token_fingerprint: String,
}

#[derive(Debug, Clone)]
struct HttpAdminSessionPort {
    store: PgStore,
    session: Session,
    admin_token_fingerprint: String,
    touch_last_seen: bool,
}

#[derive(Debug, Deserialize)]
struct JoinRoomRequest {
    room_code: String,
}

#[derive(Debug, Deserialize)]
struct SearchRoomsParams {
    query: String,
}

#[derive(Debug, Deserialize)]
struct SendMessageRequest {
    body: String,
    client_message_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct ErrorPayload {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    layer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<String>,
}

pub const FRONTEND_DIST_DIR: &str = "dist/public";
// Dioxus 会把 public/ 合并进 dist/public；服务端运行时真正对外暴露的是打包后的 dist/public/assets。
pub const FRONTEND_ASSET_DIR: &str = "dist/public/assets";
pub const ADMIN_SESSION_COOKIE_NAME: &str = "koko_admin_session";
const ADMIN_SESSION_MARKER_KEY: &str = "authenticated";

pub type AdminSessionLayer = SessionManagerLayer<AdminSessionStore>;

pub fn build_admin_session_layer(store: AdminSessionStore, secure: bool) -> AdminSessionLayer {
    SessionManagerLayer::new(store)
        .with_name(ADMIN_SESSION_COOKIE_NAME)
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_path("/")
        .with_secure(secure)
        .with_expiry(Expiry::OnInactivity(ADMIN_SESSION_IDLE_TIMEOUT))
}

pub fn api_router(store: PgStore, io: socketioxide::SocketIo) -> Router {
    Router::new()
        .route("/session/bootstrap", post(bootstrap_session))
        .route("/rooms", get(joined_rooms))
        .route("/rooms/search", get(search_rooms))
        .route("/rooms/join", post(join_room))
        .route("/rooms/{room_id}/snapshot", get(room_snapshot))
        .route("/rooms/{room_id}/messages", post(send_room_message))
        .with_state(HttpState { store, io })
}

pub fn admin_api_router(store: PgStore, admin_token: String) -> Router {
    Router::new()
        .route("/admin/session/login", post(admin_login))
        .route("/admin/session", get(admin_session))
        .route("/admin/session/logout", post(admin_logout))
        .route("/admin/overview", get(admin_overview))
        .route("/admin/rooms", get(admin_rooms))
        .with_state(AdminHttpState {
            store,
            admin_token_verifier: support::AdminTokenVerifier::new(admin_token.clone()),
            admin_token_fingerprint: support::admin_token_fingerprint(&admin_token),
        })
}

pub fn frontend_shell_router(
    frontend_dist_dir: impl Into<PathBuf>,
    asset_dir: impl Into<PathBuf>,
) -> Router {
    frontend_shell_router_inner(frontend_dist_dir, asset_dir, true)
}

fn traced_api_router(
    store: PgStore,
    io: socketioxide::SocketIo,
    admin_token: String,
    admin_session_layer: AdminSessionLayer,
) -> Router {
    Router::new()
        .merge(api_router(store.clone(), io))
        .merge(admin_api_router(store, admin_token).layer(admin_session_layer))
        .route("/", any(frontend_reserved_not_found))
        .fallback(frontend_reserved_not_found)
        .layer(TraceLayer::new_for_http())
}

fn frontend_shell_router_inner(
    frontend_dist_dir: impl Into<PathBuf>,
    asset_dir: impl Into<PathBuf>,
    reserve_api_paths: bool,
) -> Router {
    let frontend_dist_dir = frontend_dist_dir.into();
    let index_file = frontend_dist_dir.join("index.html");
    let wasm_dir = frontend_dist_dir.join("wasm");

    let router = Router::new().nest_service("/assets", ServeDir::new(asset_dir.into()))
        .nest_service("/wasm", ServeDir::new(wasm_dir))
        .route_service("/", ServeFile::new(index_file.clone()))
        .route_service("/admin", ServeFile::new(index_file.clone()))
        .route("/admin/{*path}", get(frontend_reserved_not_found));

    let router = if reserve_api_paths {
        router
            .route("/api", any(frontend_reserved_not_found))
            .route("/api/{*path}", any(frontend_reserved_not_found))
    } else {
        router
    };

    router.fallback_service(
        // 前端静态壳测试只验证入口与回退规则，不该硬走完整生产 router，否则会被真实 session/数据库装配误伤。
        ServeFile::new(index_file),
    )
}

pub fn server_router(
    store: PgStore,
    admin_token: String,
    admin_session_layer: AdminSessionLayer,
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

    frontend_shell_router_inner(frontend_dist_dir, asset_dir, false)
        .nest("/api", traced_api_router(store, io, admin_token, admin_session_layer))
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
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::BootstrapAnonymousSession))?;
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
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::JoinOrCreateRoomByCode))?;
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
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::ListJoinedRooms))?;
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
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::SearchRoomsByCode))?;
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
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::LoadRoomSnapshot))?;
    Ok(Json(snapshot))
}

async fn send_room_message(
    State(state): State<HttpState>,
    RoutePath(room_id): RoutePath<Uuid>,
    jar: CookieJar,
    Json(request): Json<SendMessageRequest>,
) -> Result<Json<MessageCreated>, (StatusCode, Json<ErrorPayload>)> {
    let session_id = resolve_session_id(&jar)?;
    let request_id = Uuid::now_v7();
    let event = match send_text_message(
        &state.store,
        &state.store,
        &state.store,
        &support::SystemIdGenerator,
        &support::SystemClock,
        SendTextMessageInput {
            room_id,
            session_id,
            body: request.body,
            client_message_id: request.client_message_id,
        },
    )
    .await
    {
        Ok(event) => event,
        Err(error) => {
            let trace = support::trace_line(
                "adapter_http",
                "send_text_message",
                &support::TraceContext {
                    request_id,
                    session_id: Some(session_id),
                    room_id: Some(room_id),
                    client_message_id: request.client_message_id,
                    event_position: None,
                },
            );
            warn!(
                trace = %trace,
                code = support::app_error_code(&error),
                "send_room_message rejected"
            );
            return Err(map_http_error_with_operation(
                error,
                ErrorOperation::SendTextMessage,
            ));
        }
    };

    let AppEvent::MessageCreated(payload) = event;
    let trace = support::trace_line(
        "adapter_http",
        "send_text_message",
        &support::TraceContext {
            request_id,
            session_id: Some(session_id),
            room_id: Some(room_id),
            client_message_id: payload.client_message_id,
            event_position: Some(payload.event_position),
        },
    );
    info!(trace = %trace, "send_room_message accepted");
    let _ = state
        .io
        .to(room_id.to_string())
        .emit("message_created", &payload)
        .await;

    Ok(Json(payload))
}

async fn admin_login(
    State(state): State<AdminHttpState>,
    session: Session,
    Json(request): Json<AdminLoginRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    let admin_session_port = build_http_admin_session_port(&state, session.clone(), true);
    login_admin(
        &state.admin_token_verifier,
        &admin_session_port,
        AdminLoginCommand {
            token: request.token,
        },
    )
    .await
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::LoginAdmin))?;
    Ok(StatusCode::OK)
}

async fn admin_session(
    State(state): State<AdminHttpState>,
    session: Session,
) -> Result<Json<AdminSessionStatus>, (StatusCode, Json<ErrorPayload>)> {
    let Some(context) = resolve_admin_session_context(&session)? else {
        return Ok(Json(unauthenticated_admin_session_status()));
    };
    // 这个 GET 只做探活，不刷新 last_seen_at；否则轮询会把 3 天空闲期悄悄续命。
    let admin_session_port = build_http_admin_session_port(&state, session, false);
    let status = get_admin_session(
        &admin_session_port,
        &context,
        admin_session_idle_timeout_seconds(),
    )
    .await
    .map_err(|error| map_http_error_with_operation(error, ErrorOperation::GetAdminSession))?;
    Ok(Json(status))
}

async fn admin_logout(
    State(state): State<AdminHttpState>,
    session: Session,
) -> Result<StatusCode, (StatusCode, Json<ErrorPayload>)> {
    if let Some(context) = resolve_admin_session_context(&session)? {
        let admin_session_port = build_http_admin_session_port(&state, session.clone(), true);
        logout_admin(&admin_session_port, &context)
            .await
            .map_err(|error| map_http_error_with_operation(error, ErrorOperation::LogoutAdmin))?;
    }
    session.flush().await.map_err(map_session_error)?;
    Ok(StatusCode::OK)
}

async fn admin_overview(
    State(state): State<AdminHttpState>,
    session: Session,
) -> Result<Json<AdminOverview>, (StatusCode, Json<ErrorPayload>)> {
    // Session/cookie 只属于 HTTP adapter；真正“这个后台会话是否有效”的裁决仍必须回 application + store。
    let context = require_admin_session_context(&session, ErrorOperation::GetAdminOverview)?;
    let admin_session_port = build_http_admin_session_port(&state, session, true);
    let overview = get_admin_overview(&admin_session_port, &state.store, context)
        .await
        .map_err(|error| map_http_error_with_operation(error, ErrorOperation::GetAdminOverview))?;
    Ok(Json(overview))
}

async fn admin_rooms(
    State(state): State<AdminHttpState>,
    session: Session,
) -> Result<Json<Vec<AdminRoomSummary>>, (StatusCode, Json<ErrorPayload>)> {
    // 这里继续复用 application 用例做后台授权，避免 handler 自己判断“已登录/过期/被顶掉”而把业务真相散落回 adapter。
    let context = require_admin_session_context(&session, ErrorOperation::ListAdminRooms)?;
    let admin_session_port = build_http_admin_session_port(&state, session, true);
    let rooms = list_admin_rooms(&admin_session_port, &state.store, context)
        .await
        .map_err(|error| map_http_error_with_operation(error, ErrorOperation::ListAdminRooms))?;
    Ok(Json(rooms))
}

impl HttpAdminSessionPort {
    fn new(
        store: PgStore,
        session: Session,
        admin_token_fingerprint: String,
        touch_last_seen: bool,
    ) -> Self {
        Self {
            store,
            session,
            admin_token_fingerprint,
            touch_last_seen,
        }
    }
}

impl AdminSessionPort for HttpAdminSessionPort {
    async fn create_admin_session(&self) -> Result<AdminSessionContext, AppError> {
        if self.session.id().is_some() {
            self.session
                .cycle_id()
                .await
                .map_err(|_| AppError::DependencyFailure)?;
        }
        self.session
            .insert(ADMIN_SESSION_MARKER_KEY, true)
            .await
            .map_err(|_| AppError::DependencyFailure)?;
        self.session.save().await.map_err(|_| AppError::DependencyFailure)?;

        let context = require_admin_session_context_from_app(&self.session)?;
        self.store
            .replace_active_admin_session(
                context.session_id,
                &self.admin_token_fingerprint,
                support::SystemClock.now(),
            )
            .await?;

        Ok(context)
    }

    async fn read_admin_session(
        &self,
        context: &AdminSessionContext,
    ) -> Result<AdminSessionState, AppError> {
        self.store
            .read_admin_session_state(
                context.session_id,
                &self.admin_token_fingerprint,
                support::SystemClock.now(),
                self.touch_last_seen,
            )
            .await
    }

    async fn revoke_admin_session(
        &self,
        context: &AdminSessionContext,
    ) -> Result<(), AppError> {
        self.store.clear_admin_session(context.session_id).await
    }
}

fn build_http_admin_session_port(
    state: &AdminHttpState,
    session: Session,
    touch_last_seen: bool,
) -> HttpAdminSessionPort {
    HttpAdminSessionPort::new(
        state.store.clone(),
        session,
        state.admin_token_fingerprint.clone(),
        touch_last_seen,
    )
}

fn resolve_session_id(jar: &CookieJar) -> Result<Uuid, (StatusCode, Json<ErrorPayload>)> {
    jar.get(support::SESSION_COOKIE_NAME)
        .and_then(|cookie| Uuid::parse_str(cookie.value()).ok())
        .ok_or_else(invalid_session_error)
}

fn resolve_admin_session_context(
    session: &Session,
) -> Result<Option<AdminSessionContext>, (StatusCode, Json<ErrorPayload>)> {
    let Some(session_id) = session.id() else {
        return Ok(None);
    };
    Ok(Some(AdminSessionContext::new(admin_session_uuid(session_id))))
}

fn require_admin_session_context(
    session: &Session,
    operation: ErrorOperation,
) -> Result<AdminSessionContext, (StatusCode, Json<ErrorPayload>)> {
    resolve_admin_session_context(session)?
        .ok_or_else(|| map_http_error_with_operation(AppError::AdminSessionRequired, operation))
}

fn require_admin_session_context_from_app(session: &Session) -> Result<AdminSessionContext, AppError> {
    let Some(session_id) = session.id() else {
        return Err(AppError::AdminSessionRequired);
    };
    Ok(AdminSessionContext::new(admin_session_uuid(session_id)))
}

fn admin_session_uuid(session_id: tower_sessions::session::Id) -> Uuid {
    Uuid::from_u128(session_id.0 as u128)
}

fn invalid_session_error() -> (StatusCode, Json<ErrorPayload>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorPayload {
            code: support::app_error_code(&AppError::SessionNotActive {
                session_id: Uuid::nil(),
            })
            .to_string(),
            layer: None,
            operation: None,
        }),
    )
}

fn map_http_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    map_http_error_payload(error, None)
}

fn map_http_error_with_operation(
    error: AppError,
    operation: ErrorOperation,
) -> (StatusCode, Json<ErrorPayload>) {
    map_http_error_payload(error, Some(operation))
}

fn map_http_error_payload(
    error: AppError,
    operation: Option<ErrorOperation>,
) -> (StatusCode, Json<ErrorPayload>) {
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
        Json(error_payload(&error, operation)),
    )
}

fn map_session_error(_: tower_sessions::session::Error) -> (StatusCode, Json<ErrorPayload>) {
    map_http_error(AppError::DependencyFailure)
}

fn admin_session_idle_timeout_seconds() -> u64 {
    ADMIN_SESSION_IDLE_TIMEOUT.whole_seconds() as u64
}

fn unauthenticated_admin_session_status() -> AdminSessionStatus {
    AdminSessionStatus {
        authenticated: false,
        idle_timeout_seconds: admin_session_idle_timeout_seconds(),
    }
}

fn error_payload(error: &AppError, operation: Option<ErrorOperation>) -> ErrorPayload {
    let (layer, operation) = match operation.map(|operation| error.error_envelope(operation)) {
        Some(context) => (
            Some(support::serde_wire_name(&context.layer)),
            Some(support::serde_wire_name(&context.operation)),
        ),
        None => (None, None),
    };

    ErrorPayload {
        code: support::app_error_code(error).to_string(),
        layer,
        operation,
    }
}
