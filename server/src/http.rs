use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    app::AppState,
    chat::PostgresMessageRepository,
    room::PostgresRoomRepository,
    session,
};
use koko_core::{
    model::{ProfileId, Role, RoomCode, RoomId},
    port::RoomRepository,
};

pub async fn bootstrap_session(
    State(state): State<AppState>,
    Json(request): Json<BootstrapSessionRequest>,
) -> Result<Json<BootstrapSessionResponse>, ApiError> {
    let session = session::bootstrap_session(&state.pool, &request.device_key).await?;

    Ok(Json(BootstrapSessionResponse {
        session_id: session.session_id.to_string(),
        profile_id: session.profile_id.to_string(),
        display_name: session.display_name,
    }))
}

pub async fn resolve_room(
    State(state): State<AppState>,
    Json(request): Json<ResolveRoomRequest>,
) -> Result<Json<ResolveRoomResponse>, ApiError> {
    let code = RoomCode::parse(&request.code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    let room = room_repo
        .find_by_code(&code)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?;

    Ok(Json(ResolveRoomResponse {
        exists: room.is_some(),
        room_id: room.map(|room| room.id.0.to_string()),
    }))
}

pub async fn join_or_create_room(
    State(state): State<AppState>,
    Json(request): Json<JoinOrCreateRoomRequest>,
) -> Result<Json<JoinOrCreateRoomResponse>, ApiError> {
    let code = RoomCode::parse(&request.code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let profile_id = parse_profile_id(&request.profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    let result = koko_core::room::join_or_create_room(&room_repo, profile_id, code)
        .await
        .map_err(|_| ApiError::internal("入房失败"))?;

    Ok(Json(JoinOrCreateRoomResponse {
        room_id: result.room.id.0.to_string(),
        code: result.room.code.as_str().to_owned(),
        role: role_name(result.role),
    }))
}

pub async fn get_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    let room = room_repo
        .find_room(room_id)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?
        .ok_or_else(|| ApiError::not_found("房间不存在"))?;

    Ok(Json(RoomResponse {
        room_id: room.id.0.to_string(),
        code: room.code.as_str().to_owned(),
    }))
}

pub async fn list_room_messages(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomMessagesResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let message_repo = PostgresMessageRepository::new(state.pool);
    let items = message_repo
        .list_room_messages(room_id)
        .await
        .map_err(|_| ApiError::internal("消息历史读取失败"))?
        .into_iter()
        .map(|message| MessageResponse {
            message_id: message.id.0.to_string(),
            sender_id: message.sender_id.0.to_string(),
            content: message.content.as_str().to_owned(),
        })
        .collect();

    Ok(Json(RoomMessagesResponse { items }))
}

#[derive(Debug, Deserialize)]
pub struct BootstrapSessionRequest {
    pub device_key: String,
}

#[derive(Debug, Serialize)]
pub struct BootstrapSessionResponse {
    pub session_id: String,
    pub profile_id: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ResolveRoomRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct ResolveRoomResponse {
    pub exists: bool,
    pub room_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JoinOrCreateRoomRequest {
    pub profile_id: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct JoinOrCreateRoomResponse {
    pub room_id: String,
    pub code: String,
    pub role: &'static str,
}

#[derive(Debug, Serialize)]
pub struct RoomResponse {
    pub room_id: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message_id: String,
    pub sender_id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct RoomMessagesResponse {
    pub items: Vec<MessageResponse>,
}

pub struct ApiError {
    status: StatusCode,
    message: &'static str,
}

impl ApiError {
    pub(crate) fn bad_request(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    pub(crate) fn internal(message: &'static str) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message,
        }
    }

    pub(crate) fn not_found(message: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}

fn parse_profile_id(raw: &str) -> Result<ProfileId, ApiError> {
    Uuid::parse_str(raw)
        .map(ProfileId)
        .map_err(|_| ApiError::bad_request("profile_id 不合法"))
}

fn parse_room_id(raw: &str) -> Result<RoomId, ApiError> {
    Uuid::parse_str(raw)
        .map(RoomId)
        .map_err(|_| ApiError::bad_request("room_id 不合法"))
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Owner => "owner",
        Role::Admin => "admin",
        Role::Member => "member",
    }
}
