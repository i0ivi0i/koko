use koko_core::{
    error::DomainError,
    model::{Message, MessageContent, MessageId, ProfileId, RoomId},
    port::MessageRepository,
};
use sqlx::PgPool;

pub struct PagedMessages {
    pub items: Vec<Message>,
    pub has_more: bool,
}

pub enum ListRoomMessagesError {
    InvalidAnchor,
    Query(sqlx::Error),
}

pub struct PostgresMessageRepository {
    pool: PgPool,
}

impl PostgresMessageRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_room_messages(
        &self,
        room_id: RoomId,
        before_message_id: Option<MessageId>,
        limit: usize,
    ) -> Result<PagedMessages, ListRoomMessagesError> {
        let fetch_count = limit.saturating_add(1) as i64;
        let mut messages: Vec<Message> = if let Some(anchor_id) = before_message_id {
            let anchor = sqlx::query!(
                r#"
                SELECT id, created_at
                FROM messages
                WHERE room_id = $1 AND id = $2
                "#,
                room_id.0,
                anchor_id.0
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(ListRoomMessagesError::Query)?
            .ok_or(ListRoomMessagesError::InvalidAnchor)?;

            sqlx::query!(
                r#"
                SELECT id, room_id, sender_id, content, created_at
                FROM messages
                WHERE room_id = $1
                  AND (
                      created_at < $2
                      OR (created_at = $2 AND id < $3)
                  )
                ORDER BY created_at DESC, id DESC
                LIMIT $4
                "#,
                room_id.0,
                anchor.created_at,
                anchor.id,
                fetch_count
            )
            .fetch_all(&self.pool)
            .await
            .map_err(ListRoomMessagesError::Query)?
            .into_iter()
            .map(|row| Message {
                id: MessageId(row.id),
                room_id: RoomId(row.room_id),
                sender_id: ProfileId(row.sender_id),
                content: MessageContent::parse(&row.content).unwrap(),
            })
            .collect()
        } else {
            sqlx::query!(
                r#"
                SELECT id, room_id, sender_id, content, created_at
                FROM messages
                WHERE room_id = $1
                ORDER BY created_at DESC, id DESC
                LIMIT $2
                "#,
                room_id.0,
                fetch_count
            )
            .fetch_all(&self.pool)
            .await
            .map_err(ListRoomMessagesError::Query)?
            .into_iter()
            .map(|row| Message {
                id: MessageId(row.id),
                room_id: RoomId(row.room_id),
                sender_id: ProfileId(row.sender_id),
                content: MessageContent::parse(&row.content).unwrap(),
            })
            .collect()
        };

        let has_more = messages.len() > limit;
        if has_more {
            messages.truncate(limit);
        }
        messages.reverse();

        Ok(PagedMessages {
            items: messages,
            has_more,
        })
    }
}

impl MessageRepository for PostgresMessageRepository {
    async fn save_text_message(
        &self,
        room_id: RoomId,
        sender_id: ProfileId,
        content: MessageContent,
    ) -> Result<Message, DomainError> {
        let message = Message {
            id: MessageId(uuid::Uuid::new_v4()),
            room_id,
            sender_id,
            content,
        };

        sqlx::query!(
            r#"
            INSERT INTO messages (id, room_id, sender_id, content)
            VALUES ($1, $2, $3, $4)
            "#,
            message.id.0,
            message.room_id.0,
            message.sender_id.0,
            message.content.as_str()
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::EmptyMessageContent)?;

        Ok(message)
    }
}
