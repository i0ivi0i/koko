use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    app::{AppError, MembershipPort, MessageStore, RoomJoinPort, RoomSnapshotData, RoomSnapshotPort, SessionPort},
    domain::{Message, MessageBody, MessageStatus, RoomCode},
};

#[derive(Debug, Clone)]
pub struct PgStore {
    pool: PgPool,
}

impl PgStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

impl SessionPort for PgStore {
    async fn is_active_session(&self, session_id: Uuid) -> Result<bool, AppError> {
        let status: Option<String> = sqlx::query_scalar(
            "SELECT status
             FROM anonymous_sessions
             WHERE session_id = $1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(matches!(status.as_deref(), Some("active")))
    }
}

impl MembershipPort for PgStore {
    async fn is_room_member(&self, room_id: Uuid, session_id: Uuid) -> Result<bool, AppError> {
        sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1
                 FROM members
                 WHERE room_id = $1
                   AND session_id = $2
                   AND status = 'active'
             )",
        )
        .bind(room_id)
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)
    }
}

impl MessageStore for PgStore {
    async fn save_message(&self, message: Message) -> Result<Message, AppError> {
        let row = sqlx::query(
            "INSERT INTO messages (
                 message_id,
                 room_id,
                 sender_session_id,
                 body,
                 created_at,
                 status
             )
             VALUES ($1, $2, $3, $4, $5, 'active')
             RETURNING message_id, room_id, sender_session_id, body, created_at, status",
        )
        .bind(message.message_id)
        .bind(message.room_id)
        .bind(message.sender_session_id)
        .bind(message.body.as_str())
        .bind(message.created_at)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        map_message_row(&row)
    }
}

impl RoomJoinPort for PgStore {
    async fn join_or_create_room_by_code(
        &self,
        room_code: RoomCode,
        limit: usize,
        session_id: Uuid,
    ) -> Result<RoomSnapshotData, AppError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        let now = Utc::now();

        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1), $2)")
            .bind(room_code.normalized())
            .bind(i32::from(room_code.code_version))
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        let room_id = match sqlx::query_scalar(
            "SELECT room_id
             FROM room_codes
             WHERE normalized_code = $1",
        )
        .bind(room_code.normalized())
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_error)?
        {
            Some(room_id) => room_id,
            None => {
                let room_id = Uuid::now_v7();
                sqlx::query(
                    "INSERT INTO rooms (room_id, created_at, status)
                     VALUES ($1, $2, 'active')",
                )
                .bind(room_id)
                .bind(now)
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_error)?;

                sqlx::query(
                    "INSERT INTO room_codes (
                         room_code_id,
                         room_id,
                         original_code,
                         normalized_code,
                         code_version,
                         created_at
                     )
                     VALUES ($1, $2, $3, $4, $5, $6)",
                )
                .bind(Uuid::now_v7())
                .bind(room_id)
                .bind(room_code.original())
                .bind(room_code.normalized())
                .bind(i16::try_from(room_code.code_version).map_err(|_| AppError::DependencyFailure)?)
                .bind(now)
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_error)?;

                room_id
            }
        };

        sqlx::query(
            "INSERT INTO members (member_id, room_id, session_id, joined_at, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (room_id, session_id) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(room_id)
        .bind(session_id)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        let messages = load_recent_messages(&mut *tx, room_id, limit).await?;
        tx.commit().await.map_err(map_sqlx_error)?;

        Ok(RoomSnapshotData {
            room_id,
            room_code,
            messages,
        })
    }
}

impl RoomSnapshotPort for PgStore {
    async fn load_room_snapshot(
        &self,
        room_id: Uuid,
        limit: usize,
    ) -> Result<RoomSnapshotData, AppError> {
        let normalized_code: Option<String> = sqlx::query_scalar(
            "SELECT normalized_code
             FROM room_codes
             WHERE room_id = $1
             LIMIT 1",
        )
        .bind(room_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;
        let room_code = RoomCode::new(
            normalized_code
                .as_deref()
                .ok_or(AppError::DependencyFailure)?,
        )
        .map_err(|_| AppError::DependencyFailure)?;
        let messages = load_recent_messages(&self.pool, room_id, limit).await?;

        Ok(RoomSnapshotData {
            room_id,
            room_code,
            messages,
        })
    }
}

async fn load_recent_messages<'a, E>(
    executor: E,
    room_id: Uuid,
    limit: usize,
) -> Result<Vec<Message>, AppError>
where
    E: sqlx::Executor<'a, Database = sqlx::Postgres>,
{
    let limit = i64::try_from(limit).map_err(|_| AppError::DependencyFailure)?;
    let rows = sqlx::query(
        "SELECT message_id, room_id, sender_session_id, body, created_at, status
         FROM (
             SELECT message_id, room_id, sender_session_id, body, created_at, status
             FROM messages
             WHERE room_id = $1
               AND status = 'active'
             ORDER BY created_at DESC, message_id DESC
             LIMIT $2
         ) AS recent_messages
         ORDER BY created_at ASC, message_id ASC",
    )
    .bind(room_id)
    .bind(limit)
    .fetch_all(executor)
    .await
    .map_err(map_sqlx_error)?;

    rows.into_iter().map(|row| map_message_row(&row)).collect()
}

fn map_message_row(row: &sqlx::postgres::PgRow) -> Result<Message, AppError> {
    let status = row.get::<String, _>("status");
    if status != "active" {
        return Err(AppError::DependencyFailure);
    }

    let body = MessageBody::new(&row.get::<String, _>("body"))
        .map_err(|_| AppError::DependencyFailure)?;

    Ok(Message {
        message_id: row.get("message_id"),
        room_id: row.get("room_id"),
        sender_session_id: row.get("sender_session_id"),
        body,
        created_at: row.get::<DateTime<Utc>, _>("created_at"),
        status: MessageStatus::Active,
    })
}

fn map_sqlx_error(_: sqlx::Error) -> AppError {
    AppError::DependencyFailure
}
