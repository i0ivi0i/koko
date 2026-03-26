use axum::{
    Router,
    routing::{get, post},
};
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};

use crate::{http, ws::RealtimeHub};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub realtime: RealtimeHub,
}

pub fn build_app(pool: PgPool) -> Router {
    Router::new()
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
        .with_state(AppState {
            pool,
            realtime: RealtimeHub::default(),
        })
}
