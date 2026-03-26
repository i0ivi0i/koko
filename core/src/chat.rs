use crate::{
    error::DomainError,
    model::{Message, MessageContent, ProfileId, RoomId},
    port::{MessageRepository, RoomRepository},
};

/// 发送文本消息。只有房间成员能发言。
pub async fn send_text_message(
    room_repo: &impl RoomRepository,
    message_repo: &impl MessageRepository,
    room_id: RoomId,
    sender_id: ProfileId,
    content: &str,
) -> Result<Message, DomainError> {
    if room_repo.role_of(room_id, sender_id).await?.is_none() {
        return Err(DomainError::SenderIsNotRoomMember);
    }

    if room_repo.is_muted(room_id, sender_id).await? {
        return Err(DomainError::SenderIsMuted);
    }

    let content = MessageContent::parse(content)?;
    message_repo
        .save_text_message(room_id, sender_id, content)
        .await
}
