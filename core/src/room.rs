use crate::{
    error::DomainError,
    model::{GlobalChatPolicy, ProfileId, Role, Room, RoomCode, RoomGovernanceState, RoomId},
    port::RoomRepository,
};
use time::OffsetDateTime;

/// 入房或建房后的最小结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinRoomResult {
    pub room: Room,
    pub role: Role,
}

/// 通过短码进入已有房间，或在不存在时创建新房间。
pub async fn join_or_create_room(
    repo: &impl RoomRepository,
    profile_id: ProfileId,
    code: RoomCode,
) -> Result<JoinRoomResult, DomainError> {
    if let Some(room) = repo.find_by_code(&code).await? {
        let current_role = repo.role_of(room.id, profile_id).await?;
        if repo
            .governance_state(room.id)
            .await?
            .is_banned_at(OffsetDateTime::now_utc())
            && current_role.is_none()
        {
            return Err(DomainError::RoomTemporarilyBanned);
        }

        let role = current_role.unwrap_or(Role::Member);
        repo.ensure_member(room.id, profile_id, role).await?;
        return Ok(JoinRoomResult { room, role });
    }

    let room = repo.create_room(profile_id, code).await?;
    Ok(JoinRoomResult {
        room,
        role: Role::Owner,
    })
}

pub async fn get_global_chat_policy(
    repo: &impl RoomRepository,
) -> Result<GlobalChatPolicy, DomainError> {
    repo.global_chat_policy().await
}

/// 确认调用者具备读取房间的权限。
pub async fn ensure_can_read_room(
    repo: &impl RoomRepository,
    room_id: RoomId,
    profile_id: ProfileId,
) -> Result<Role, DomainError> {
    repo.role_of(room_id, profile_id)
        .await?
        .ok_or(DomainError::SenderIsNotRoomMember)
}

/// 确认调用者具备发送消息的权限。
pub async fn ensure_can_send_message(
    repo: &impl RoomRepository,
    room_id: RoomId,
    sender_id: ProfileId,
) -> Result<Role, DomainError> {
    let role = ensure_can_read_room(repo, room_id, sender_id).await?;

    if repo
        .governance_state(room_id)
        .await?
        .is_banned_at(OffsetDateTime::now_utc())
    {
        return Err(DomainError::RoomTemporarilyBanned);
    }

    if repo.is_muted(room_id, sender_id).await? {
        return Err(DomainError::SenderIsMuted);
    }

    Ok(role)
}

/// 确认调用者具备治理目标成员的基础权限。
pub async fn ensure_can_manage_member(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(Role, Role), DomainError> {
    let actor_role = actor_role(repo, room_id, actor_id).await?;
    let target_role = target_role(repo, room_id, target_id).await?;

    if target_role == Role::Owner {
        return Err(DomainError::CannotModerateRoomOwner);
    }

    match actor_role {
        Role::Owner => Ok((actor_role, target_role)),
        Role::Admin if target_role == Role::Member => Ok((actor_role, target_role)),
        _ => Err(DomainError::InsufficientRoomPermission),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemberActionCapabilities {
    pub can_promote: bool,
    pub can_mute: bool,
    pub can_remove: bool,
}

pub fn member_action_capabilities(
    actor_id: ProfileId,
    actor_role: Role,
    target_id: ProfileId,
    target_role: Role,
) -> MemberActionCapabilities {
    if actor_id == target_id || target_role == Role::Owner {
        return MemberActionCapabilities::default();
    }

    let can_manage = matches!(actor_role, Role::Owner)
        || matches!((actor_role, target_role), (Role::Admin, Role::Member));

    MemberActionCapabilities {
        can_promote: actor_role == Role::Owner && target_role == Role::Member,
        can_mute: can_manage,
        can_remove: can_manage,
    }
}

pub async fn update_global_chat_policy(
    repo: &impl RoomRepository,
    max_message_length: usize,
) -> Result<GlobalChatPolicy, DomainError> {
    let policy = GlobalChatPolicy::new(max_message_length)?;
    repo.set_global_chat_policy(policy.clone()).await?;
    Ok(policy)
}

pub async fn ban_room_until(
    repo: &impl RoomRepository,
    room_id: RoomId,
    banned_until: OffsetDateTime,
    ban_reason: Option<String>,
) -> Result<RoomGovernanceState, DomainError> {
    let state = RoomGovernanceState::active_ban(banned_until, ban_reason);
    repo.set_governance_state(room_id, state.clone()).await?;
    Ok(state)
}

pub async fn unban_room(
    repo: &impl RoomRepository,
    room_id: RoomId,
) -> Result<RoomGovernanceState, DomainError> {
    let state = RoomGovernanceState::unbanned();
    repo.set_governance_state(room_id, state.clone()).await?;
    Ok(state)
}

pub async fn promote_admin(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let (actor_role, _) = ensure_can_manage_member(repo, room_id, actor_id, target_id).await?;
    if actor_role != Role::Owner {
        return Err(DomainError::InsufficientRoomPermission);
    }

    repo.set_role(room_id, target_id, Role::Admin).await
}

pub async fn demote_admin(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let (actor_role, _) = ensure_can_manage_member(repo, room_id, actor_id, target_id).await?;
    if actor_role != Role::Owner {
        return Err(DomainError::InsufficientRoomPermission);
    }

    repo.set_role(room_id, target_id, Role::Member).await
}

pub async fn mute_member(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let _ = ensure_can_manage_member(repo, room_id, actor_id, target_id).await?;

    repo.set_muted(room_id, target_id, true).await
}

pub async fn remove_member(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let _ = ensure_can_manage_member(repo, room_id, actor_id, target_id).await?;

    repo.remove_member(room_id, target_id).await
}

async fn actor_role(
    repo: &impl RoomRepository,
    room_id: RoomId,
    profile_id: ProfileId,
) -> Result<Role, DomainError> {
    repo.role_of(room_id, profile_id)
        .await?
        .ok_or(DomainError::SenderIsNotRoomMember)
}

async fn target_role(
    repo: &impl RoomRepository,
    room_id: RoomId,
    profile_id: ProfileId,
) -> Result<Role, DomainError> {
    repo.role_of(room_id, profile_id)
        .await?
        .ok_or(DomainError::TargetIsNotRoomMember)
}
