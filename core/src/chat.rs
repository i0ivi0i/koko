use crate::{
    error::DomainError,
    model::{Message, MessageContent, ProfileId, RoomId},
    port::{MessageRepository, RoomRepository},
    room::ensure_can_send_message,
};

/// 发送文本消息。只有房间成员能发言。
pub async fn send_text_message(
    room_repo: &impl RoomRepository,
    message_repo: &impl MessageRepository,
    room_id: RoomId,
    sender_id: ProfileId,
    content: &str,
) -> Result<Message, DomainError> {
    let _ = ensure_can_send_message(room_repo, room_id, sender_id).await?;

    let policy = room_repo.global_chat_policy().await?;
    let content = MessageContent::parse_with_limit(content, policy.max_message_length())?;
    message_repo
        .save_text_message(room_id, sender_id, content)
        .await
}
