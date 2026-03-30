use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    app::{
        AppError, bootstrap_anonymous_session, get_admin_overview, join_or_create_room_by_code,
        list_admin_rooms, load_room_snapshot,
    },
    contract::{
        AdminOverview, AdminRoomSummary, JoinOrCreateRoomByCodeCommand, LoadRoomSnapshotQuery,
        RoomSnapshot,
    },
    store::PgStore,
    support,
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

#[derive(Clone)]
struct HttpState {
    store: PgStore,
    admin_token: String,
}

#[derive(Debug, Deserialize)]
struct JoinRoomRequest {
    room_code: String,
    session_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct SnapshotQuery {
    session_id: Uuid,
}

pub fn app_router(store: PgStore, admin_token: String) -> Router {
    Router::new()
        .route("/api/session/bootstrap", post(bootstrap_session))
        .route("/api/rooms/join", post(join_room))
        .route("/api/rooms/{room_id}/snapshot", get(room_snapshot))
        .route("/api/admin/overview", get(admin_overview))
        .route("/api/admin/rooms", get(admin_rooms))
        .with_state(HttpState { store, admin_token })
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
    Json(request): Json<JoinRoomRequest>,
) -> Result<Json<RoomSnapshot>, (StatusCode, Json<ErrorPayload>)> {
    let snapshot = join_or_create_room_by_code(
        &state.store,
        &state.store,
        JoinOrCreateRoomByCodeCommand {
            room_code: request.room_code,
            session_id: request.session_id,
        },
    )
    .await
    .map_err(map_http_error)?;
    Ok(Json(snapshot))
}

async fn room_snapshot(
    State(state): State<HttpState>,
    Path(room_id): Path<Uuid>,
    Query(query): Query<SnapshotQuery>,
) -> Result<Json<RoomSnapshot>, (StatusCode, Json<ErrorPayload>)> {
    let snapshot = load_room_snapshot(
        &state.store,
        &state.store,
        &state.store,
        LoadRoomSnapshotQuery {
            room_id,
            session_id: query.session_id,
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
    require_admin_token(&state.admin_token, &headers)?;
    let overview = get_admin_overview(&state.store)
        .await
        .map_err(map_http_error)?;
    Ok(Json(overview))
}

async fn admin_rooms(
    State(state): State<HttpState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminRoomSummary>>, (StatusCode, Json<ErrorPayload>)> {
    require_admin_token(&state.admin_token, &headers)?;
    let rooms = list_admin_rooms(&state.store)
        .await
        .map_err(map_http_error)?;
    Ok(Json(rooms))
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct ErrorPayload {
    code: String,
}

fn require_admin_token(
    expected_token: &str,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, Json<ErrorPayload>)> {
    let provided = headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok());

    if provided == Some(expected_token) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorPayload {
                code: support::admin_token_error_code().to_string(),
            }),
        ))
    }
}

fn map_http_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    let status = match error {
        AppError::SessionNotActive { .. } => StatusCode::UNAUTHORIZED,
        AppError::NotRoomMember { .. } => StatusCode::FORBIDDEN,
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
