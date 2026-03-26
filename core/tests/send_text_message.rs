use std::{collections::HashMap, sync::Arc};

use koko_core::{
    error::DomainError,
    model::{MessageContent, MessageId, ProfileId, Role, RoomId},
    port::{MessageRepository, RoomRepository},
    chat::send_text_message,
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
struct FakeDeps {
    inner: Arc<Mutex<FakeState>>,
}

#[derive(Default)]
struct FakeState {
    members: HashMap<(RoomId, ProfileId), Role>,
    saved_messages: Vec<(RoomId, ProfileId, String)>,
}

impl FakeDeps {
    async fn add_member(&self, room_id: RoomId, profile_id: ProfileId, role: Role) {
        let mut guard = self.inner.lock().await;
        guard.members.insert((room_id, profile_id), role);
    }
}

impl RoomRepository for FakeDeps {
    async fn find_by_code(
        &self,
        _code: &koko_core::model::RoomCode,
    ) -> Result<Option<koko_core::model::Room>, DomainError> {
        Ok(None)
    }

    async fn create_room(
        &self,
        _owner_id: ProfileId,
        _code: koko_core::model::RoomCode,
    ) -> Result<koko_core::model::Room, DomainError> {
        unreachable!()
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

    async fn role_of(&self, room_id: RoomId, profile_id: ProfileId) -> Result<Option<Role>, DomainError> {
        let guard = self.inner.lock().await;
        Ok(guard.members.get(&(room_id, profile_id)).copied())
    }
}

impl MessageRepository for FakeDeps {
    async fn save_text_message(
        &self,
        room_id: RoomId,
        sender_id: ProfileId,
        content: MessageContent,
    ) -> Result<koko_core::model::Message, DomainError> {
        let mut guard = self.inner.lock().await;
        guard
            .saved_messages
            .push((room_id, sender_id, content.as_str().to_owned()));
        Ok(koko_core::model::Message {
            id: MessageId(Uuid::new_v4()),
            room_id,
            sender_id,
            content,
        })
    }
}

#[tokio::test]
async fn 房间成员应能发送文本消息() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let sender_id = ProfileId(Uuid::new_v4());
    deps.add_member(room_id, sender_id, Role::Member).await;

    let message = send_text_message(&deps, &deps, room_id, sender_id, "hello")
        .await
        .unwrap();

    assert_eq!(message.content.as_str(), "hello");
}

#[tokio::test]
async fn 非成员发送消息应失败() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let stranger_id = ProfileId(Uuid::new_v4());

    let error = send_text_message(&deps, &deps, room_id, stranger_id, "hello")
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::SenderIsNotRoomMember);
}

#[tokio::test]
async fn 空消息应失败() {
    let deps = FakeDeps::default();
    let room_id = RoomId(Uuid::new_v4());
    let sender_id = ProfileId(Uuid::new_v4());
    deps.add_member(room_id, sender_id, Role::Member).await;

    let error = send_text_message(&deps, &deps, room_id, sender_id, "   ")
        .await
        .unwrap_err();

    assert_eq!(error, DomainError::EmptyMessageContent);
}
