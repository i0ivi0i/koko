use crate::{
    error::DomainError,
    model::{ProfileId, Role, Room, RoomCode, RoomId},
    port::RoomRepository,
};

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
        let role = repo.role_of(room.id, profile_id).await?.unwrap_or(Role::Member);
        repo.ensure_member(room.id, profile_id, role).await?;
        return Ok(JoinRoomResult { room, role });
    }

    let room = repo.create_room(profile_id, code).await?;
    Ok(JoinRoomResult {
        room,
        role: Role::Owner,
    })
}

pub async fn promote_admin(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let actor_role = member_role(repo, room_id, actor_id).await?;
    if actor_role != Role::Owner {
        return Err(DomainError::InsufficientRoomPermission);
    }

    let target_role = member_role(repo, room_id, target_id).await?;
    if target_role == Role::Owner {
        return Err(DomainError::CannotModerateRoomOwner);
    }

    repo.set_role(room_id, target_id, Role::Admin).await
}

pub async fn demote_admin(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let actor_role = member_role(repo, room_id, actor_id).await?;
    if actor_role != Role::Owner {
        return Err(DomainError::InsufficientRoomPermission);
    }

    let target_role = member_role(repo, room_id, target_id).await?;
    if target_role == Role::Owner {
        return Err(DomainError::CannotModerateRoomOwner);
    }

    repo.set_role(room_id, target_id, Role::Member).await
}

pub async fn mute_member(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let actor_role = member_role(repo, room_id, actor_id).await?;
    let target_role = member_role(repo, room_id, target_id).await?;

    match actor_role {
        Role::Owner => {}
        Role::Admin if target_role == Role::Member => {}
        _ => return Err(DomainError::InsufficientRoomPermission),
    }

    if target_role == Role::Owner {
        return Err(DomainError::CannotModerateRoomOwner);
    }

    repo.set_muted(room_id, target_id, true).await
}

pub async fn remove_member(
    repo: &impl RoomRepository,
    room_id: RoomId,
    actor_id: ProfileId,
    target_id: ProfileId,
) -> Result<(), DomainError> {
    let actor_role = member_role(repo, room_id, actor_id).await?;
    let target_role = member_role(repo, room_id, target_id).await?;

    match actor_role {
        Role::Owner => {}
        Role::Admin if target_role == Role::Member => {}
        _ => return Err(DomainError::InsufficientRoomPermission),
    }

    if target_role == Role::Owner {
        return Err(DomainError::CannotModerateRoomOwner);
    }

    repo.remove_member(room_id, target_id).await
}

async fn member_role(
    repo: &impl RoomRepository,
    room_id: RoomId,
    profile_id: ProfileId,
) -> Result<Role, DomainError> {
    repo.role_of(room_id, profile_id)
        .await?
        .ok_or(DomainError::TargetIsNotRoomMember)
}
