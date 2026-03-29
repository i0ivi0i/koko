use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use headers::{Authorization, HeaderMapExt, authorization::Basic};
use koko_contract::{
    AdminOverviewResponse, AdminRoomDetailResponse, AdminRoomListItem, AdminRoomListQuery,
    AdminRoomListResponse, BanRoomRequest, BootstrapSessionRequest, BootstrapSessionResponse,
    DemoteAdminRequest, GlobalChatPolicyResponse, MessageResponse, PromoteAdminRequest,
    RoomGovernanceStateResponse, RoomMemberResponse, RoomMembersResponse, RoomMessagesQuery,
    RoomMessagesResponse, RoomResponse, SESSION_HEADER_NAME, SendMessageRequest,
    ServerRealtimeEvent, UpdateGlobalChatPolicyRequest,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    app::{AdminAuthConfig, AppState},
    message_repo::PostgresMessageRepository,
    room_repo::PostgresRoomRepository,
    session,
};
use koko_core::{
    model::{MessageId, ProfileId, Role, Room, RoomId},
    room::member_action_capabilities,
};

const DEFAULT_MESSAGE_PAGE_LIMIT: usize = 40;
const MAX_MESSAGE_PAGE_LIMIT: u16 = 100;
const DEFAULT_ADMIN_ROOM_LIMIT: usize = 50;
const MAX_ADMIN_ROOM_LIMIT: u16 = 200;
const ADMIN_BASIC_REALM: &str = "Basic realm=\"koko-admin\", charset=\"UTF-8\"";

pub(crate) struct RoomSnapshotView {
    pub room: Room,
    pub role: Role,
    pub messages: Vec<MessageResponse>,
    pub has_more_messages: bool,
    pub members: Vec<RoomMemberResponse>,
}

pub(crate) struct RoomMessagesPage {
    pub items: Vec<MessageResponse>,
    pub has_more: bool,
}

pub(crate) struct RoomViewerContext {
    pub room: Room,
    pub role: Role,
}

pub(crate) enum RoomSnapshotQuery {
    Recent {
        limit: Option<u16>,
    },
    Older {
        before_message_id: Option<String>,
        limit: Option<u16>,
    },
}

pub async fn bootstrap_session(
    State(state): State<AppState>,
    Json(request): Json<BootstrapSessionRequest>,
) -> Result<Json<BootstrapSessionResponse>, ApiError> {
    let session = session::bootstrap_session(&state.pool, request.device_token.as_deref()).await?;

    Ok(Json(BootstrapSessionResponse {
        session_id: session.session_id.to_string(),
        profile_id: session.profile_id.to_string(),
        display_name: session.display_name,
        device_token: session.device_token,
    }))
}

pub async fn root_status() -> &'static str {
    "koko 服务运行中"
}

pub async fn require_admin_basic_auth(
    State(admin_auth): State<AdminAuthConfig>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, ApiError> {
    let Some(expected_password) = admin_auth.password.as_deref() else {
        return Err(ApiError::service_unavailable("后台密码未配置"));
    };

    let Some(Authorization(basic)) = request.headers().typed_get::<Authorization<Basic>>() else {
        return Err(ApiError::unauthorized("缺少后台认证"));
    };

    if basic.username() != admin_auth.username || basic.password() != expected_password {
        return Err(ApiError::unauthorized("后台认证无效"));
    }

    Ok(next.run(request).await)
}

pub async fn get_admin_overview(
    State(state): State<AppState>,
) -> Result<Json<AdminOverviewResponse>, ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let message_repo = PostgresMessageRepository::new(state.pool);

    Ok(Json(AdminOverviewResponse {
        total_rooms: room_repo
            .total_rooms()
            .await
            .map_err(|_| ApiError::internal("后台房间统计失败"))?,
        total_memberships: room_repo
            .total_memberships()
            .await
            .map_err(|_| ApiError::internal("后台成员统计失败"))?,
        active_rooms_24h: message_repo
            .active_rooms_24h()
            .await
            .map_err(|_| ApiError::internal("后台活跃房间统计失败"))?,
        messages_24h: message_repo
            .messages_24h()
            .await
            .map_err(|_| ApiError::internal("后台消息统计失败"))?,
        online_connections: state.realtime.online_connections(),
    }))
}

pub async fn get_global_chat_policy(
    State(state): State<AppState>,
) -> Result<Json<GlobalChatPolicyResponse>, ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let policy = koko_core::room::get_global_chat_policy(&room_repo)
        .await
        .map_err(map_domain_error)?;

    Ok(Json(GlobalChatPolicyResponse {
        max_message_length: u32::try_from(policy.max_message_length())
            .map_err(|_| ApiError::internal("全局策略读取失败"))?,
    }))
}

pub async fn update_global_chat_policy(
    State(state): State<AppState>,
    Json(request): Json<UpdateGlobalChatPolicyRequest>,
) -> Result<Json<GlobalChatPolicyResponse>, ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let policy = koko_core::room::update_global_chat_policy(
        &room_repo,
        usize::try_from(request.max_message_length)
            .map_err(|_| ApiError::bad_request("最大消息长度不合法"))?,
    )
    .await
    .map_err(map_domain_error)?;

    Ok(Json(GlobalChatPolicyResponse {
        max_message_length: u32::try_from(policy.max_message_length())
            .map_err(|_| ApiError::internal("全局策略更新失败"))?,
    }))
}

pub async fn list_admin_rooms(
    State(state): State<AppState>,
    Query(query): Query<AdminRoomListQuery>,
) -> Result<Json<AdminRoomListResponse>, ApiError> {
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let items = room_repo
        .list_admin_rooms(
            query.code.as_deref(),
            normalize_admin_room_limit(query.limit),
        )
        .await
        .map_err(|_| ApiError::internal("后台房间列表读取失败"))?
        .into_iter()
        .map(admin_room_to_list_item)
        .collect();

    Ok(Json(AdminRoomListResponse { items }))
}

pub async fn get_admin_room_detail(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<AdminRoomDetailResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let room = room_repo
        .admin_room_detail(room_id)
        .await
        .map_err(|_| ApiError::internal("后台房间详情读取失败"))?
        .ok_or_else(|| ApiError::not_found("房间不存在"))?;

    Ok(Json(AdminRoomDetailResponse {
        room_id: room.room_id.0.to_string(),
        code: room.code,
        member_count: room.member_count,
        last_message_at: format_optional_datetime(room.last_message_at)?,
        banned_until: format_optional_datetime(room.banned_until)?,
        ban_reason: room.ban_reason,
    }))
}

pub async fn list_admin_room_members(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomMembersResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let items = room_repo
        .list_members(room_id)
        .await
        .map_err(|_| ApiError::internal("后台成员列表读取失败"))?
        .into_iter()
        .map(|member| RoomMemberResponse {
            profile_id: member.profile_id.0.to_string(),
            display_name: session::build_display_name(member.profile_id),
            role: role_name(member.role).to_owned(),
            is_muted: member.is_muted,
            can_promote: false,
            can_mute: false,
            can_remove: false,
        })
        .collect();

    Ok(Json(RoomMembersResponse { items }))
}

pub async fn get_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Json<RoomResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let room = load_room_viewer_context(&state.pool, session.profile_id, room_id, None)
        .await?
        .room;

    Ok(Json(RoomResponse {
        room_id: room.id.0.to_string(),
        code: room.code.as_str().to_owned(),
    }))
}

pub async fn list_room_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Query(query): Query<RoomMessagesQuery>,
) -> Result<Json<RoomMessagesResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    require_room_member(&headers, &state.pool, room_id).await?;
    Ok(Json(
        load_room_messages_response(&state.pool, room_id, query.before_message_id, query.limit)
            .await?,
    ))
}

pub async fn list_room_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Json<RoomMembersResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let viewer = load_room_viewer_context(&state.pool, session.profile_id, room_id, None).await?;

    Ok(Json(
        load_room_members_response(&state.pool, room_id, session.profile_id, viewer.role).await?,
    ))
}

#[tracing::instrument(skip(state, headers, request), fields(room_id = %room_id))]
pub async fn send_room_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(request): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());
    let message_repo = PostgresMessageRepository::new(state.pool);
    let message = koko_core::chat::send_text_message(
        &room_repo,
        &message_repo,
        room_id,
        session.profile_id,
        &request.content,
    )
    .await
    .map_err(map_domain_error)?;

    let response = message_to_response(message);
    let event = ServerRealtimeEvent::MessageCreated {
        message_id: response.message_id.clone(),
        room_id: response.room_id.clone(),
        sender_id: response.sender_id.clone(),
        content: response.content.clone(),
        created_at: response.created_at.clone(),
    };
    state.realtime.publish(room_id, event).await;

    Ok(Json(response))
}

pub async fn promote_room_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(request): Json<PromoteAdminRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let target_id = parse_profile_id(&request.target_profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::promote_admin(&room_repo, room_id, session.profile_id, target_id)
        .await
        .map_err(map_domain_error)?;
    crate::ws::publish_room_members_updates(&state, room_id).await;

    Ok(StatusCode::OK)
}

pub async fn demote_room_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(request): Json<DemoteAdminRequest>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let target_id = parse_profile_id(&request.target_profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::demote_admin(&room_repo, room_id, session.profile_id, target_id)
        .await
        .map_err(map_domain_error)?;
    crate::ws::publish_room_members_updates(&state, room_id).await;

    Ok(StatusCode::OK)
}

pub async fn mute_room_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((room_id, member_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let target_id = parse_profile_id(&member_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::mute_member(&room_repo, room_id, session.profile_id, target_id)
        .await
        .map_err(map_domain_error)?;
    crate::ws::publish_room_members_updates(&state, room_id).await;

    Ok(StatusCode::OK)
}

pub async fn remove_room_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((room_id, member_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let session = require_authenticated_session(&headers, &state.pool).await?;
    let target_id = parse_profile_id(&member_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::remove_member(&room_repo, room_id, session.profile_id, target_id)
        .await
        .map_err(map_domain_error)?;
    state
        .realtime
        .remove_profile_from_room(target_id, room_id)
        .await;
    crate::ws::publish_room_members_updates(&state, room_id).await;

    Ok(StatusCode::OK)
}

pub async fn ban_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Json(request): Json<BanRoomRequest>,
) -> Result<Json<RoomGovernanceStateResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    if room_repo
        .find_room(room_id)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?
        .is_none()
    {
        return Err(ApiError::not_found("房间不存在"));
    }
    let banned_until = OffsetDateTime::parse(&request.banned_until, &Rfc3339)
        .map_err(|_| ApiError::bad_request("banned_until 不合法"))?;
    let governance_state =
        koko_core::room::ban_room_until(&room_repo, room_id, banned_until, request.ban_reason)
            .await
            .map_err(map_domain_error)?;

    Ok(Json(governance_state_to_response(
        room_id,
        governance_state,
    )?))
}

pub async fn unban_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<Json<RoomGovernanceStateResponse>, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool);
    if room_repo
        .find_room(room_id)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?
        .is_none()
    {
        return Err(ApiError::not_found("房间不存在"));
    }
    let governance_state = koko_core::room::unban_room(&room_repo, room_id)
        .await
        .map_err(map_domain_error)?;

    Ok(Json(governance_state_to_response(
        room_id,
        governance_state,
    )?))
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

    pub(crate) fn unauthorized(message: &'static str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message,
        }
    }

    pub(crate) fn service_unavailable(message: &'static str) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message,
        }
    }

    pub(crate) fn message(&self) -> &'static str {
        self.message
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (self.status, self.message).into_response();
        if self.status == StatusCode::UNAUTHORIZED {
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                header::HeaderValue::from_static(ADMIN_BASIC_REALM),
            );
        }
        response
    }
}

async fn require_authenticated_session(
    headers: &HeaderMap,
    pool: &sqlx::PgPool,
) -> Result<session::AuthenticatedSession, ApiError> {
    let raw_session_id = headers
        .get(SESSION_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("缺少会话认证"))?;

    session::authenticate_session(pool, raw_session_id).await
}

async fn require_room_member(
    headers: &HeaderMap,
    pool: &sqlx::PgPool,
    room_id: RoomId,
) -> Result<session::AuthenticatedSession, ApiError> {
    let session = require_authenticated_session(headers, pool).await?;
    let room_repo = PostgresRoomRepository::new(pool.clone());
    koko_core::room::ensure_can_read_room(&room_repo, room_id, session.profile_id)
        .await
        .map_err(map_domain_error)?;

    Ok(session)
}

pub(crate) async fn load_room_or_not_found(
    room_repo: &PostgresRoomRepository,
    room_id: RoomId,
) -> Result<Room, ApiError> {
    room_repo
        .find_room(room_id)
        .await
        .map_err(|_| ApiError::internal("房间查询失败"))?
        .ok_or_else(|| ApiError::not_found("房间不存在"))
}

pub(crate) async fn load_room_viewer_context(
    pool: &sqlx::PgPool,
    viewer_profile_id: ProfileId,
    room_id: RoomId,
    known_room: Option<Room>,
) -> Result<RoomViewerContext, ApiError> {
    let room_repo = PostgresRoomRepository::new(pool.clone());
    let role = koko_core::room::ensure_can_read_room(&room_repo, room_id, viewer_profile_id)
        .await
        .map_err(map_domain_error)?;
    let room = match known_room {
        Some(room) => room,
        None => load_room_or_not_found(&room_repo, room_id).await?,
    };

    Ok(RoomViewerContext { room, role })
}

pub(crate) async fn load_room_messages_response(
    pool: &sqlx::PgPool,
    room_id: RoomId,
    before_message_id: Option<String>,
    limit: Option<u16>,
) -> Result<RoomMessagesResponse, ApiError> {
    let page = load_room_messages_page(pool, room_id, before_message_id, limit).await?;

    Ok(RoomMessagesResponse {
        items: page.items,
        has_more: page.has_more,
    })
}

pub(crate) async fn load_room_messages_page(
    pool: &sqlx::PgPool,
    room_id: RoomId,
    before_message_id: Option<String>,
    limit: Option<u16>,
) -> Result<RoomMessagesPage, ApiError> {
    let before_message_id = parse_optional_message_id(before_message_id.as_deref())?;
    let limit = normalize_message_page_limit(limit);
    let message_repo = PostgresMessageRepository::new(pool.clone());
    let page = message_repo
        .list_room_messages(room_id, before_message_id, limit)
        .await
        .map_err(map_list_messages_error)?;

    Ok(RoomMessagesPage {
        items: page.items.into_iter().map(message_to_response).collect(),
        has_more: page.has_more,
    })
}

pub(crate) async fn load_room_members_response(
    pool: &sqlx::PgPool,
    room_id: RoomId,
    viewer_profile_id: ProfileId,
    viewer_role: Role,
) -> Result<RoomMembersResponse, ApiError> {
    let items = load_room_member_items(pool, room_id, viewer_profile_id, viewer_role).await?;

    Ok(RoomMembersResponse { items })
}

pub(crate) async fn load_room_member_items(
    pool: &sqlx::PgPool,
    room_id: RoomId,
    viewer_profile_id: ProfileId,
    viewer_role: Role,
) -> Result<Vec<RoomMemberResponse>, ApiError> {
    let room_repo = PostgresRoomRepository::new(pool.clone());
    let items = room_repo
        .list_members(room_id)
        .await
        .map_err(|_| ApiError::internal("成员列表读取失败"))?
        .into_iter()
        .map(|member| room_member_to_response(viewer_profile_id, viewer_role, member))
        .collect();

    Ok(items)
}

pub(crate) async fn load_room_snapshot_view(
    pool: &sqlx::PgPool,
    viewer_profile_id: ProfileId,
    room: Room,
    viewer_role: Role,
    query: RoomSnapshotQuery,
) -> Result<RoomSnapshotView, ApiError> {
    let messages = match query {
        RoomSnapshotQuery::Recent { limit } => {
            load_room_messages_page(pool, room.id, None, limit).await?
        }
        RoomSnapshotQuery::Older {
            before_message_id,
            limit,
        } => load_room_messages_page(pool, room.id, before_message_id, limit).await?,
    };
    let members = load_room_member_items(pool, room.id, viewer_profile_id, viewer_role).await?;

    Ok(RoomSnapshotView {
        room,
        role: viewer_role,
        messages: messages.items,
        has_more_messages: messages.has_more,
        members,
    })
}

pub(crate) async fn load_room_snapshot_view_for_viewer(
    pool: &sqlx::PgPool,
    viewer_profile_id: ProfileId,
    room_id: RoomId,
    known_room: Option<Room>,
    query: RoomSnapshotQuery,
) -> Result<RoomSnapshotView, ApiError> {
    let viewer = load_room_viewer_context(pool, viewer_profile_id, room_id, known_room).await?;

    load_room_snapshot_view(pool, viewer_profile_id, viewer.room, viewer.role, query).await
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

pub(crate) fn parse_optional_message_id(raw: Option<&str>) -> Result<Option<MessageId>, ApiError> {
    raw.map(|value| {
        Uuid::parse_str(value)
            .map(MessageId)
            .map_err(|_| ApiError::bad_request("before_message_id 不合法"))
    })
    .transpose()
}

pub(crate) fn normalize_message_page_limit(limit: Option<u16>) -> usize {
    match limit {
        Some(0) | None => DEFAULT_MESSAGE_PAGE_LIMIT,
        Some(value) => value.min(MAX_MESSAGE_PAGE_LIMIT) as usize,
    }
}

fn normalize_admin_room_limit(limit: Option<u16>) -> usize {
    match limit {
        Some(0) | None => DEFAULT_ADMIN_ROOM_LIMIT,
        Some(value) => value.min(MAX_ADMIN_ROOM_LIMIT) as usize,
    }
}

pub(crate) fn role_name(role: Role) -> &'static str {
    match role {
        Role::Owner => "owner",
        Role::Admin => "admin",
        Role::Member => "member",
    }
}

pub(crate) fn room_member_to_response(
    viewer_profile_id: ProfileId,
    viewer_role: Role,
    member: crate::room_repo::RoomMemberRecord,
) -> RoomMemberResponse {
    let capabilities = member_action_capabilities(
        viewer_profile_id,
        viewer_role,
        member.profile_id,
        member.role,
    );

    RoomMemberResponse {
        profile_id: member.profile_id.0.to_string(),
        display_name: session::build_display_name(member.profile_id),
        role: role_name(member.role).to_owned(),
        is_muted: member.is_muted,
        can_promote: capabilities.can_promote,
        can_mute: capabilities.can_mute,
        can_remove: capabilities.can_remove,
    }
}

pub(crate) fn message_to_response(message: koko_core::model::Message) -> MessageResponse {
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

fn governance_state_to_response(
    room_id: RoomId,
    state: koko_core::model::RoomGovernanceState,
) -> Result<RoomGovernanceStateResponse, ApiError> {
    let banned_until = state
        .banned_until
        .map(|value| {
            value
                .format(&Rfc3339)
                .map_err(|_| ApiError::internal("房间治理状态格式化失败"))
        })
        .transpose()?;

    Ok(RoomGovernanceStateResponse {
        room_id: room_id.0.to_string(),
        banned_until,
        ban_reason: state.ban_reason,
    })
}

fn admin_room_to_list_item(room: crate::room_repo::AdminRoomRecord) -> AdminRoomListItem {
    AdminRoomListItem {
        room_id: room.room_id.0.to_string(),
        code: room.code,
        member_count: room.member_count,
        last_message_at: format_optional_datetime(room.last_message_at).unwrap_or(None),
        banned_until: format_optional_datetime(room.banned_until).unwrap_or(None),
        ban_reason: room.ban_reason,
    }
}

fn format_optional_datetime(value: Option<OffsetDateTime>) -> Result<Option<String>, ApiError> {
    value
        .map(|value| {
            value
                .format(&Rfc3339)
                .map_err(|_| ApiError::internal("时间格式化失败"))
        })
        .transpose()
}

pub(crate) fn map_domain_error(error: koko_core::error::DomainError) -> ApiError {
    use koko_core::error::DomainError;

    match error {
        DomainError::InvalidRoomCode => ApiError::bad_request("房间短码不合法"),
        DomainError::EmptyDeviceKey => ApiError::bad_request("device_token 不合法"),
        DomainError::EmptyMessageContent => ApiError::bad_request("消息不能为空"),
        DomainError::InvalidMaxMessageLength => ApiError::bad_request("最大消息长度不合法"),
        DomainError::MessageTooLong => ApiError::bad_request("消息超过长度限制"),
        DomainError::RoomTemporarilyBanned => ApiError::forbidden("房间暂时封禁"),
        DomainError::SenderIsNotRoomMember => ApiError::forbidden("不是房间成员"),
        DomainError::TargetIsNotRoomMember => ApiError::bad_request("目标成员不存在"),
        DomainError::SenderIsMuted => ApiError::bad_request("成员已被禁言"),
        DomainError::InsufficientRoomPermission => ApiError::forbidden("房间权限不足"),
        DomainError::CannotModerateRoomOwner => ApiError::forbidden("不能操作群主"),
    }
}

pub(crate) fn map_list_messages_error(
    error: crate::message_repo::ListRoomMessagesError,
) -> ApiError {
    match error {
        crate::message_repo::ListRoomMessagesError::InvalidAnchor => {
            ApiError::bad_request("before_message_id 不存在或不属于当前房间")
        }
        crate::message_repo::ListRoomMessagesError::Query(_) => {
            ApiError::internal("消息历史读取失败")
        }
    }
}
