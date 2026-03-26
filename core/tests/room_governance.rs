use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use koko_core::{
    chat::send_text_message,
    error::DomainError,
    model::{MessageContent, MessageId, ProfileId, Role, Room, RoomCode, RoomId},
    port::{MessageRepository, RoomRepository},
    room::{mute_member, promote_admin, remove_member},
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeDeps {
    inner: Arc<Mutex<FakeState>>,
}

#[derive(Default)]
struct FakeState {
    rooms_by_code: HashMap<String, Room>,
    members: HashMap<(RoomId, ProfileId), Role>,
    muted: HashSet<(RoomId, ProfileId)>,
}

impl FakeDeps {
    async fn seed_member(&self, room_id: RoomId, profile_id: ProfileId, role: Role) {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
    }
}

impl RoomRepository for FakeDeps {
    async fn find_by_code(&self, code: &RoomCode) -> Result<Option<Room>, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.rooms_by_code.get(code.as_str()).cloned())
    }

    async fn create_room(&self, owner_id: ProfileId, code: RoomCode) -> Result<Room, DomainError> {
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
    ) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
        Ok(())
    }

    async fn role_of(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<Option<Role>, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.members.get(&(room_id, profile_id)).copied())
    }

    async fn set_role(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
        Ok(())
    }

    async fn set_muted(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        muted: bool,
    ) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        if muted {
            guard.muted.insert((room_id, profile_id));
        } else {
            guard.muted.remove(&(room_id, profile_id));
        }
        Ok(())
    }

    async fn is_muted(&self, room_id: RoomId, profile_id: ProfileId) -> Result<bool, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.muted.contains(&(room_id, profile_id)))
    }

    async fn remove_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        guard.members.remove(&(room_id, profile_id));
        guard.muted.remove(&(room_id, profile_id));
        Ok(())
    }
}

impl MessageRepository for FakeDeps {
    async fn save_text_message(
        &self,
        room_id: RoomId,
        sender_id: ProfileId,
        content: MessageContent,
    ) -> Result<koko_core::model::Message, DomainError> {
        Ok(koko_core::model::Message {
            id: MessageId(Uuid::new_v4()),
            room_id,
            sender_id,
            content,
        })
    }
}

#[tokio::test]
async fn 群主应能提升成员为管理员() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    promote_admin(&deps, room_id, owner_id, member_id)
        .await
        .unwrap();

    assert_eq!(
        deps.role_of(room_id, member_id).await.unwrap(),
        Some(Role::Admin)
    );
}

#[tokio::test]
async fn 管理员不应能提升其他成员为管理员() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let admin_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, admin_id, Role::Admin).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    let error = promote_admin(&deps, room_id, admin_id, member_id)
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::InsufficientRoomPermission);
}

#[tokio::test]
async fn 被禁言成员不应继续发送消息() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    mute_member(&deps, room_id, owner_id, member_id)
        .await
        .unwrap();

    let error = send_text_message(&deps, &deps, room_id, member_id, "hello")
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::SenderIsMuted);
}

#[tokio::test]
async fn 群主应能移除普通成员() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    remove_member(&deps, room_id, owner_id, member_id)
        .await
        .unwrap();

    assert_eq!(deps.role_of(room_id, member_id).await.unwrap(), None);
}
