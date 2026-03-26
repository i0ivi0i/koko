use crate::{
    error::DomainError,
    model::{Message, MessageContent, ProfileId, Role, Room, RoomCode, RoomId},
};

/// 房间仓储抽象。
pub trait RoomRepository {
    fn find_by_code(
        &self,
        code: &RoomCode,
    ) -> impl std::future::Future<Output = Result<Option<Room>, DomainError>> + Send;

    fn create_room(
        &self,
        owner_id: ProfileId,
        code: RoomCode,
    ) -> impl std::future::Future<Output = Result<Room, DomainError>> + Send;

    fn ensure_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> impl std::future::Future<Output = Result<(), DomainError>> + Send;

    fn role_of(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> impl std::future::Future<Output = Result<Option<Role>, DomainError>> + Send;
}

/// 消息仓储抽象。
pub trait MessageRepository {
    fn save_text_message(
        &self,
        room_id: RoomId,
        sender_id: ProfileId,
        content: MessageContent,
    ) -> impl std::future::Future<Output = Result<Message, DomainError>> + Send;
}
