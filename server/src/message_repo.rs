use koko_core::{
    error::DomainError,
    model::{Message, MessageContent, MessageId, ProfileId, RoomId},
    port::MessageRepository,
};
use sqlx::PgPool;

pub struct PostgresMessageRepository {
    pool: PgPool,
}

impl PostgresMessageRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_room_messages(&self, room_id: RoomId) -> Result<Vec<Message>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT id, room_id, sender_id, content
            FROM messages
            WHERE room_id = $1
            ORDER BY created_at ASC
            "#,
            room_id.0
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| Message {
                id: MessageId(row.id),
                room_id: RoomId(row.room_id),
                sender_id: ProfileId(row.sender_id),
                content: MessageContent::parse(&row.content).unwrap(),
            })
            .collect())
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
