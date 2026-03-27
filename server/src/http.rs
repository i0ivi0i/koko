use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, DemoteAdminRequest, GovernanceActorRequest,
    JoinOrCreateRoomRequest, JoinOrCreateRoomResponse, MessageResponse, PromoteAdminRequest,
    ResolveRoomRequest, ResolveRoomResponse, RoomMemberResponse, RoomMembersResponse,
    RoomMessagesQuery, RoomMessagesResponse, RoomResponse, SendMessageRequest, ServerWsEvent,
};
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::{
    app::AppState, message_repo::PostgresMessageRepository, room_repo::PostgresRoomRepository,
    session,
};
use koko_core::{
    model::{MessageId, ProfileId, Role, RoomCode, RoomId},
    port::RoomRepository,
};

const DEFAULT_MESSAGE_PAGE_LIMIT: usize = 40;
const MAX_MESSAGE_PAGE_LIMIT: u16 = 100;

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

pub async fn root_status() -> &'static str {
    "koko 服务运行中"
}

#[tracing::instrument(skip(state, request), fields(code = %request.code))]
pub async fn resolve_room(
    State(state): State<AppState>,
    Json(request): Json<ResolveRoomRequest>,
) -> Result<Json<ResolveRoomResponse>, ApiError> {
    let code =
        RoomCode::parse(&request.code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
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

#[tracing::instrument(skip(state, request), fields(code = %request.code, profile_id = %request.profile_id))]
pub async fn join_or_create_room(
    State(state): State<AppState>,
    Json(request): Json<JoinOrCreateRoomRequest>,
) -> Result<Json<JoinOrCreateRoomResponse>, ApiError> {
    let code =
        RoomCode::parse(&request.code).map_err(|_| ApiError::bad_request("房间短码不合法"))?;
    let profile_id = parse_profile_id(&request.profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    let result = koko_core::room::join_or_create_room(&room_repo, profile_id, code)
        .await
        .map_err(|_| ApiError::internal("入房失败"))?;

    Ok(Json(JoinOrCreateRoomResponse {
        room_id: result.room.id.0.to_string(),
        code: result.room.code.as_str().to_owned(),
        role: role_name(result.role).to_owned(),
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
    Query(query): Query<RoomMessagesQuery>,
) -> Result<Json<RoomMessagesResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let before_message_id = parse_optional_message_id(query.before_message_id.as_deref())?;
    let limit = normalize_message_page_limit(query.limit);
    let message_repo = PostgresMessageRepository::new(state.pool);
    let page = message_repo
        .list_room_messages(room_id, before_message_id, limit)
        .await
        .map_err(map_list_messages_error)?;
    let items = page.items.into_iter().map(message_to_response).collect();

    Ok(Json(RoomMessagesResponse {
        items,
        has_more: page.has_more,
    }))
}

pub async fn list_room_members(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomMembersResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    let items = room_repo
        .list_members(room_id)
        .await
        .map_err(|_| ApiError::internal("成员列表读取失败"))?
        .into_iter()
        .map(|member| RoomMemberResponse {
            profile_id: member.profile_id.0.to_string(),
            display_name: session::build_display_name(&member.device_key),
            role: role_name(member.role).to_owned(),
        })
        .collect();

    Ok(Json(RoomMembersResponse { items }))
}

#[tracing::instrument(skip(state, request), fields(room_id = %room_id, sender_id = %request.sender_id))]
pub async fn send_room_message(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let sender_id = parse_profile_id(&request.sender_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let message_repo = PostgresMessageRepository::new(state.pool);
    let message = koko_core::chat::send_text_message(
        &room_repo,
        &message_repo,
        room_id,
        sender_id,
        &request.content,
    )
    .await
    .map_err(|_| ApiError::bad_request("消息发送失败"))?;

    let response = message_to_response(message);
    let event = serde_json::to_string(&ServerWsEvent::MessageCreated {
        message_id: response.message_id.clone(),
        room_id: response.room_id.clone(),
        sender_id: response.sender_id.clone(),
        content: response.content.clone(),
        created_at: response.created_at.clone(),
    })
    .map_err(|_| ApiError::internal("消息广播序列化失败"))?;
    state.realtime.publish(room_id, event);

    Ok(Json(response))
}

pub async fn promote_room_admin(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(request): Json<PromoteAdminRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let actor_id = parse_profile_id(&request.actor_profile_id)?;
    let target_id = parse_profile_id(&request.target_profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);

    koko_core::room::promote_admin(&room_repo, room_id, actor_id, target_id)
        .await
        .map_err(map_domain_error)?;

    Ok(StatusCode::OK)
}

pub async fn demote_room_admin(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(request): Json<DemoteAdminRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let actor_id = parse_profile_id(&request.actor_profile_id)?;
    let target_id = parse_profile_id(&request.target_profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);

    koko_core::room::demote_admin(&room_repo, room_id, actor_id, target_id)
        .await
        .map_err(map_domain_error)?;

    Ok(StatusCode::OK)
}

pub async fn mute_room_member(
    State(state): State<AppState>,
    Path((room_id, member_id)): Path<(String, String)>,
    Json(request): Json<GovernanceActorRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let actor_id = parse_profile_id(&request.actor_profile_id)?;
    let target_id = parse_profile_id(&member_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);

    koko_core::room::mute_member(&room_repo, room_id, actor_id, target_id)
        .await
        .map_err(map_domain_error)?;

    Ok(StatusCode::OK)
}

pub async fn remove_room_member(
    State(state): State<AppState>,
    Path((room_id, member_id)): Path<(String, String)>,
    Json(request): Json<GovernanceActorRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let actor_id = parse_profile_id(&request.actor_profile_id)?;
    let target_id = parse_profile_id(&member_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);

    koko_core::room::remove_member(&room_repo, room_id, actor_id, target_id)
        .await
        .map_err(map_domain_error)?;

    Ok(StatusCode::OK)
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

    pub(crate) fn forbidden(message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
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

fn parse_optional_message_id(raw: Option<&str>) -> Result<Option<MessageId>, ApiError> {
    raw.map(|value| {
        Uuid::parse_str(value)
            .map(MessageId)
            .map_err(|_| ApiError::bad_request("before_message_id 不合法"))
    })
    .transpose()
}

fn normalize_message_page_limit(limit: Option<u16>) -> usize {
    match limit {
        Some(0) | None => DEFAULT_MESSAGE_PAGE_LIMIT,
        Some(value) => value.min(MAX_MESSAGE_PAGE_LIMIT) as usize,
    }
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Owner => "owner",
        Role::Admin => "admin",
        Role::Member => "member",
    }
}

fn message_to_response(message: koko_core::model::Message) -> MessageResponse {
    MessageResponse {
        message_id: message.id.0.to_string(),
        room_id: message.room_id.0.to_string(),
        sender_id: message.sender_id.0.to_string(),
        content: message.content.as_str().to_owned(),
        created_at: message
            .created_at
            .format(&Rfc3339)
            .expect("消息时间应可格式化为 RFC3339"),
    }
}

fn map_domain_error(error: koko_core::error::DomainError) -> ApiError {
    use koko_core::error::DomainError;

    match error {
        DomainError::InvalidRoomCode => ApiError::bad_request("房间短码不合法"),
        DomainError::EmptyDeviceKey => ApiError::bad_request("device_key 不能为空"),
        DomainError::EmptyMessageContent => ApiError::bad_request("消息不能为空"),
        DomainError::SenderIsNotRoomMember | DomainError::TargetIsNotRoomMember => {
            ApiError::bad_request("目标成员不存在")
        }
        DomainError::SenderIsMuted => ApiError::bad_request("成员已被禁言"),
        DomainError::InsufficientRoomPermission => ApiError::forbidden("房间权限不足"),
        DomainError::CannotModerateRoomOwner => ApiError::forbidden("不能操作群主"),
    }
}

fn map_list_messages_error(error: crate::message_repo::ListRoomMessagesError) -> ApiError {
    match error {
        crate::message_repo::ListRoomMessagesError::InvalidAnchor => {
            ApiError::bad_request("before_message_id 不存在或不属于当前房间")
        }
        crate::message_repo::ListRoomMessagesError::Query(_) => {
            ApiError::internal("消息历史读取失败")
        }
    }
}
