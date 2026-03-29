use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use koko_core::{
    chat::send_text_message,
    error::DomainError,
    model::{
        GlobalChatPolicy, MessageContent, MessageId, ProfileId, Role, Room, RoomCode,
        RoomGovernanceState, RoomId,
    },
    port::{MessageRepository, RoomRepository},
    room::{
        ensure_can_manage_member, member_action_capabilities, mute_member, promote_admin,
        remove_member,
    },
};
use time::OffsetDateTime;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeDeps {
    inner: Arc<Mutex<FakeState>>,
}

struct FakeState {
    rooms_by_code: HashMap<String, Room>,
    members: HashMap<(RoomId, ProfileId), Role>,
    muted: HashSet<(RoomId, ProfileId)>,
    global_chat_policy: GlobalChatPolicy,
    governance: HashMap<RoomId, RoomGovernanceState>,
}

impl Default for FakeState {
    fn default() -> Self {
        Self {
            rooms_by_code: HashMap::new(),
            members: HashMap::new(),
            muted: HashSet::new(),
            global_chat_policy: GlobalChatPolicy::default(),
            governance: HashMap::new(),
        }
    }
}

impl FakeDeps {
    async fn seed_member(&self, room_id: RoomId, profile_id: ProfileId, role: Role) {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
    }

    async fn set_max_message_length(&self, max_message_length: usize) {
        let mut guard = self.inner.lock().await;
        guard.global_chat_policy = GlobalChatPolicy::new(max_message_length).unwrap();
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

    async fn global_chat_policy(&self) -> Result<GlobalChatPolicy, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.global_chat_policy.clone())
    }

    async fn set_global_chat_policy(&self, policy: GlobalChatPolicy) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        guard.global_chat_policy = policy;
        Ok(())
    }

    async fn governance_state(&self, room_id: RoomId) -> Result<RoomGovernanceState, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.governance.get(&room_id).cloned().unwrap_or_default())
    }

    async fn set_governance_state(
        &self,
        room_id: RoomId,
        state: RoomGovernanceState,
    ) -> Result<(), DomainError> {
        let mut guard = self.inner.lock().await;
        guard.governance.insert(room_id, state);
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
            created_at: OffsetDateTime::now_utc(),
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
async fn 群主应具备治理管理员的权限() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let admin_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, admin_id, Role::Admin).await;

    let (actor_role, target_role) = ensure_can_manage_member(&deps, room_id, owner_id, admin_id)
        .await
        .unwrap();

    assert_eq!(actor_role, Role::Owner);
    assert_eq!(target_role, Role::Admin);
}

#[tokio::test]
async fn 管理员应具备治理普通成员的权限() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let admin_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, admin_id, Role::Admin).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    let (actor_role, target_role) = ensure_can_manage_member(&deps, room_id, admin_id, member_id)
        .await
        .unwrap();

    assert_eq!(actor_role, Role::Admin);
    assert_eq!(target_role, Role::Member);
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
async fn 非成员不应伪装群主提升管理员() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    let outsider_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    let error = promote_admin(&deps, room_id, outsider_id, member_id)
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::SenderIsNotRoomMember);
}

#[tokio::test]
async fn 非成员不应具备治理权限() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    let outsider_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, owner_id, Role::Owner).await;
    deps.seed_member(room_id, member_id, Role::Member).await;

    let error = ensure_can_manage_member(&deps, room_id, outsider_id, member_id)
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::SenderIsNotRoomMember);
}

#[tokio::test]
async fn 任何人都不应具备治理群主的权限() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let admin_id = ProfileId(Uuid::new_v4());
    let owner_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, admin_id, Role::Admin).await;
    deps.seed_member(room_id, owner_id, Role::Owner).await;

    let error = ensure_can_manage_member(&deps, room_id, admin_id, owner_id)
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::CannotModerateRoomOwner);
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

#[tokio::test]
async fn 超过全局最大消息长度时应拒绝发送() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, member_id, Role::Member).await;
    deps.set_max_message_length(4).await;

    let error = send_text_message(&deps, &deps, room_id, member_id, "hello")
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::MessageTooLong);
}

#[tokio::test]
async fn 房间被封禁时应拒绝发送消息() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());
    deps.seed_member(room_id, member_id, Role::Member).await;
    deps.ban_room(room_id).await;

    let error = send_text_message(&deps, &deps, room_id, member_id, "hello")
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::RoomTemporarilyBanned);
}

#[test]
fn 群主视角下普通成员应带有完整治理能力() {
    let owner_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());

    let capabilities = member_action_capabilities(owner_id, Role::Owner, member_id, Role::Member);

    assert!(capabilities.can_promote);
    assert!(capabilities.can_mute);
    assert!(capabilities.can_remove);
}

#[test]
fn 管理员视角下普通成员不应带有升管能力() {
    let admin_id = ProfileId(Uuid::new_v4());
    let member_id = ProfileId(Uuid::new_v4());

    let capabilities = member_action_capabilities(admin_id, Role::Admin, member_id, Role::Member);

    assert!(!capabilities.can_promote);
    assert!(capabilities.can_mute);
    assert!(capabilities.can_remove);
}

#[test]
fn 自己这一行不应带有任何治理能力() {
    let owner_id = ProfileId(Uuid::new_v4());

    let capabilities = member_action_capabilities(owner_id, Role::Owner, owner_id, Role::Owner);

    assert!(!capabilities.can_promote);
    assert!(!capabilities.can_mute);
    assert!(!capabilities.can_remove);
}
