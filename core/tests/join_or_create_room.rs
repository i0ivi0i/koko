use std::{collections::HashMap, sync::Arc};

use koko_core::{
    model::{GlobalChatPolicy, ProfileId, Role, Room, RoomCode, RoomGovernanceState, RoomId},
    port::RoomRepository,
    room::join_or_create_room,
};
use time::OffsetDateTime;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeRoomRepository {
    inner: Arc<Mutex<FakeState>>,
}

#[derive(Default)]
struct FakeState {
    rooms_by_code: HashMap<String, Room>,
    members: HashMap<(RoomId, ProfileId), Role>,
    governance: HashMap<RoomId, RoomGovernanceState>,
}

impl FakeRoomRepository {
    async fn seed_room(&self, room: Room, profile_id: ProfileId, role: Role) {
        let mut guard = self.inner.lock().await;
        guard
            .rooms_by_code
            .insert(room.code.as_str().to_owned(), room.clone());
        guard.members.insert((room.id, profile_id), role);
    }

    async fn ban_room(&self, room_id: RoomId) {
        let mut guard = self.inner.lock().await;
        guard.governance.insert(
            room_id,
            RoomGovernanceState::active_ban(
                OffsetDateTime::now_utc() + time::Duration::hours(1),
                None,
            ),
        );
    }
}

impl RoomRepository for FakeRoomRepository {
    async fn find_by_code(
        &self,
        code: &RoomCode,
    ) -> Result<Option<Room>, koko_core::error::DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.rooms_by_code.get(code.as_str()).cloned())
    }

    async fn create_room(
        &self,
        owner_id: ProfileId,
        code: RoomCode,
    ) -> Result<Room, koko_core::error::DomainError> {
        let room = Room::new(RoomId(Uuid::new_v4()), code);
        let mut guard = self.inner.lock().await;
        guard
            .rooms_by_code
            .insert(room.code.as_str().to_owned(), room.clone());
        guard.members.insert((room.id, owner_id), Role::Owner);
        Ok(room)
    }

    async fn ensure_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> Result<(), koko_core::error::DomainError> {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
        Ok(())
    }

    async fn role_of(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<Option<Role>, koko_core::error::DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.members.get(&(room_id, profile_id)).copied())
    }

    async fn set_role(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> Result<(), koko_core::error::DomainError> {
        self.ensure_member(room_id, profile_id, role).await
    }

    async fn set_muted(
        &self,
        _room_id: RoomId,
        _profile_id: ProfileId,
        _muted: bool,
    ) -> Result<(), koko_core::error::DomainError> {
        Ok(())
    }

    async fn is_muted(
        &self,
        _room_id: RoomId,
        _profile_id: ProfileId,
    ) -> Result<bool, koko_core::error::DomainError> {
        Ok(false)
    }

    async fn remove_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<(), koko_core::error::DomainError> {
        let mut guard = self.inner.lock().await;
        guard.members.remove(&(room_id, profile_id));
        Ok(())
    }

    async fn global_chat_policy(&self) -> Result<GlobalChatPolicy, koko_core::error::DomainError> {
        Ok(GlobalChatPolicy::default())
    }

    async fn set_global_chat_policy(
        &self,
        _policy: GlobalChatPolicy,
    ) -> Result<(), koko_core::error::DomainError> {
        Ok(())
    }

    async fn governance_state(
        &self,
        room_id: RoomId,
    ) -> Result<RoomGovernanceState, koko_core::error::DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.governance.get(&room_id).cloned().unwrap_or_default())
    }

    async fn set_governance_state(
        &self,
        room_id: RoomId,
        state: RoomGovernanceState,
    ) -> Result<(), koko_core::error::DomainError> {
        let mut guard = self.inner.lock().await;
        guard.governance.insert(room_id, state);
        Ok(())
    }
}

#[tokio::test]
async fn 短码不存在时应创建房间并授予群主() {
    let repo = FakeRoomRepository::default();
    let profile_id = ProfileId(Uuid::new_v4());

    let result = join_or_create_room(&repo, profile_id, RoomCode::parse("1A234").unwrap())
        .await
        .unwrap();

    assert_eq!(result.role, Role::Owner);
    assert_eq!(result.room.code.as_str(), "1A234");
}

#[tokio::test]
async fn 短码已存在时应加入已有房间() {
    let repo = FakeRoomRepository::default();
    let existing_room = Room::new(RoomId(Uuid::new_v4()), RoomCode::parse("1A234").unwrap());
    let owner_id = ProfileId(Uuid::new_v4());
    let joiner_id = ProfileId(Uuid::new_v4());
    repo.seed_room(existing_room.clone(), owner_id, Role::Owner)
        .await;

    let result = join_or_create_room(&repo, joiner_id, RoomCode::parse("1A234").unwrap())
        .await
        .unwrap();

    assert_eq!(result.role, Role::Member);
    assert_eq!(result.room.id, existing_room.id);
    assert_eq!(result.room.code.as_str(), "1A234");
}

#[tokio::test]
async fn 房间被封禁时不应允许继续入房() {
    let repo = FakeRoomRepository::default();
    let existing_room = Room::new(RoomId(Uuid::new_v4()), RoomCode::parse("1A234").unwrap());
    let owner_id = ProfileId(Uuid::new_v4());
    let joiner_id = ProfileId(Uuid::new_v4());
    repo.seed_room(existing_room.clone(), owner_id, Role::Owner)
        .await;
    repo.ban_room(existing_room.id).await;

    let error = join_or_create_room(&repo, joiner_id, RoomCode::parse("1A234").unwrap())
        .await
        .unwrap_err();

    assert_eq!(error, koko_core::error::DomainError::RoomTemporarilyBanned);
}

#[tokio::test]
async fn 房间被封禁时已有成员仍可重新进入查看历史() {
    let repo = FakeRoomRepository::default();
    let existing_room = Room::new(RoomId(Uuid::new_v4()), RoomCode::parse("1A234").unwrap());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    repo.seed_room(existing_room.clone(), owner_id, Role::Owner)
        .await;
    repo.seed_room(existing_room.clone(), member_id, Role::Member)
        .await;
    repo.ban_room(existing_room.id).await;

    let result = join_or_create_room(&repo, member_id, RoomCode::parse("1A234").unwrap())
        .await
        .unwrap();

    assert_eq!(result.room.id, existing_room.id);
    assert_eq!(result.role, Role::Member);
}
