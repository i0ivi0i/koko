use crate::{
    error::DomainError,
    model::{ProfileId, Role, Room, RoomCode},
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
