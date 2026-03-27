use axum::{
    Router,
    extract::Request,
    middleware,
    routing::{get, post},
};
use sqlx::PgPool;
use tower::ServiceBuilder;
use tower_http::ServiceBuilderExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::request_id::MakeRequestUuid;
use tower_http::trace::{DefaultOnFailure, DefaultOnRequest, DefaultOnResponse, TraceLayer};
use tracing::{Level, info_span};

use crate::{http, ws::RealtimeHub};

const DEFAULT_ADMIN_USERNAME: &str = "admin";

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub realtime: RealtimeHub,
}

#[derive(Clone)]
pub struct AdminAuthConfig {
    pub username: String,
    pub password: Option<String>,
}

impl AdminAuthConfig {
    pub fn from_env() -> Self {
        Self {
            username: std::env::var("KOKO_ADMIN_USER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_ADMIN_USERNAME.to_owned()),
            password: std::env::var("KOKO_ADMIN_PASSWORD")
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        }
    }

    pub fn configured(username: impl Into<String>, password: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            password: Some(password.into()),
        }
    }
}

impl AppState {
    pub fn online_connection_opened(&self) {
        self.realtime.connection_opened();
    }

    pub fn online_connection_closed(&self) {
        self.realtime.connection_closed();
    }
}

pub fn build_app(pool: PgPool) -> Router {
    build_app_with_admin_auth(pool, AdminAuthConfig::from_env())
}

pub fn build_app_with_admin_auth(pool: PgPool, admin_auth: AdminAuthConfig) -> Router {
    let state = AppState {
        pool,
        realtime: RealtimeHub::default(),
    };

    let admin_routes = Router::new()
        .route("/overview", get(http::get_admin_overview))
        .route(
            "/policy",
            get(http::get_global_chat_policy).post(http::update_global_chat_policy),
        )
        .route("/rooms", get(http::list_admin_rooms))
        .route("/rooms/{room_id}", get(http::get_admin_room_detail))
        .route("/rooms/{room_id}/members", get(http::list_admin_room_members))
        .route("/rooms/{room_id}/ban", post(http::ban_room))
        .route("/rooms/{room_id}/unban", post(http::unban_room))
        .route_layer(middleware::from_fn_with_state(
            admin_auth,
            http::require_admin_basic_auth,
        ));

    Router::new()
        .route("/", get(http::root_status))
        .nest("/admin", admin_routes)
        .route("/session/bootstrap", post(http::bootstrap_session))
        .route("/rooms/resolve", post(http::resolve_room))
        .route("/rooms/join-or-create", post(http::join_or_create_room))
        .route(
            "/rooms/{room_id}/roles/promote",
            post(http::promote_room_admin),
        )
        .route(
            "/rooms/{room_id}/roles/demote",
            post(http::demote_room_admin),
        )
        .route("/rooms/{room_id}", get(http::get_room))
        .route(
            "/rooms/{room_id}/messages",
            get(http::list_room_messages).post(http::send_room_message),
        )
        .route("/rooms/{room_id}/members", get(http::list_room_members))
        .route(
            "/rooms/{room_id}/members/{member_id}/mute",
            post(http::mute_room_member),
        )
        .route(
            "/rooms/{room_id}/members/{member_id}/remove",
            post(http::remove_room_member),
        )
        .route("/ws/rooms/{room_id}", get(crate::ws::connect))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(
            ServiceBuilder::new()
                .set_x_request_id(MakeRequestUuid)
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(|request: &Request<_>| {
                            let request_id = request
                                .headers()
                                .get("x-request-id")
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or("-");
                            info_span!(
                                "http.request",
                                request_id = %request_id,
                                method = %request.method(),
                                path = %request.uri().path()
                            )
                        })
                        .on_request(DefaultOnRequest::new().level(Level::INFO))
                        .on_response(DefaultOnResponse::new().level(Level::INFO))
                        .on_failure(DefaultOnFailure::new().level(Level::ERROR)),
                )
                .propagate_x_request_id(),
        )
        .with_state(state)
}
