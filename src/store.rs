use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    app::{
        AdminOverviewPort, AdminPanelPort, AdminRoomsPort, AppError, MembershipPort, MessageStore,
        RoomEntryPort, RoomEntryTx, RoomSnapshotData, RoomSnapshotPort, SessionBootstrapPort,
        SessionPort,
    },
    contract::{AdminOverview, AdminPanelData, AdminRoomSummary},
    domain::{AnonymousSession, Message, MessageBody, MessageStatus, RoomCode, SessionStatus},
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

impl SessionBootstrapPort for PgStore {
    async fn load_session(&self, session_id: Uuid) -> Result<Option<AnonymousSession>, AppError> {
        let row = sqlx::query(
            "SELECT session_id, issued_at, last_seen_at, status
             FROM anonymous_sessions
             WHERE session_id = $1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let Some(row) = row else {
            return Ok(None);
        };

        let status = row.get::<String, _>("status");
        if status != "active" {
            return Err(AppError::DependencyFailure);
        }

        Ok(Some(AnonymousSession {
            session_id: row.get("session_id"),
            issued_at: row.get("issued_at"),
            last_seen_at: row.get("last_seen_at"),
            status: SessionStatus::Active,
        }))
    }

    async fn save_session(&self, session: AnonymousSession) -> Result<AnonymousSession, AppError> {
        let row = sqlx::query(
            "INSERT INTO anonymous_sessions (session_id, issued_at, last_seen_at, status)
             VALUES ($1, $2, $3, 'active')
             ON CONFLICT (session_id) DO UPDATE
             SET last_seen_at = EXCLUDED.last_seen_at,
                 status = 'active'
             RETURNING session_id, issued_at, last_seen_at, status",
        )
        .bind(session.session_id)
        .bind(session.issued_at)
        .bind(session.last_seen_at)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        let status = row.get::<String, _>("status");
        if status != "active" {
            return Err(AppError::DependencyFailure);
        }

        Ok(AnonymousSession {
            session_id: row.get("session_id"),
            issued_at: row.get("issued_at"),
            last_seen_at: row.get("last_seen_at"),
            status: SessionStatus::Active,
        })
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

pub struct PgRoomEntry<'a> {
    tx: sqlx::Transaction<'a, sqlx::Postgres>,
}

impl RoomEntryPort for PgStore {
    type Tx<'a>
        = PgRoomEntry<'a>
    where
        Self: 'a;

    async fn begin_room_entry(&self, room_code: &RoomCode) -> Result<Self::Tx<'_>, AppError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;

        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1), $2)")
            .bind(room_code.normalized())
            .bind(i32::from(room_code.code_version))
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;

        Ok(PgRoomEntry { tx })
    }
}

impl RoomEntryTx for PgRoomEntry<'_> {
    async fn find_room_by_code(&mut self, room_code: &RoomCode) -> Result<Option<Uuid>, AppError> {
        sqlx::query_scalar(
            "SELECT room_id
             FROM room_codes
             WHERE normalized_code = $1
               AND code_version = $2",
        )
        .bind(room_code.normalized())
        .bind(i16::try_from(room_code.code_version).map_err(|_| AppError::DependencyFailure)?)
        .fetch_optional(&mut *self.tx)
        .await
        .map_err(map_sqlx_error)
    }

    async fn create_room(&mut self, room_code: &RoomCode) -> Result<Uuid, AppError> {
        let now = Utc::now();
        let room_id = Uuid::now_v7();

        sqlx::query(
            "INSERT INTO rooms (room_id, created_at, status)
             VALUES ($1, $2, 'active')",
        )
        .bind(room_id)
        .bind(now)
        .execute(&mut *self.tx)
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
        .execute(&mut *self.tx)
        .await
        .map_err(map_sqlx_error)?;

        Ok(room_id)
    }

    async fn ensure_room_member(
        &mut self,
        room_id: Uuid,
        session_id: Uuid,
    ) -> Result<(), AppError> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO members (member_id, room_id, session_id, joined_at, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (room_id, session_id) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(room_id)
        .bind(session_id)
        .bind(now)
        .execute(&mut *self.tx)
        .await
        .map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn load_recent_messages(
        &mut self,
        room_id: Uuid,
        limit: usize,
    ) -> Result<Vec<Message>, AppError> {
        load_recent_messages(&mut *self.tx, room_id, limit).await
    }

    async fn commit(self) -> Result<(), AppError> {
        self.tx.commit().await.map_err(map_sqlx_error)
    }
}

impl RoomSnapshotPort for PgStore {
    async fn load_room_snapshot(
        &self,
        room_id: Uuid,
        limit: usize,
    ) -> Result<RoomSnapshotData, AppError> {
        let row = sqlx::query(
            "SELECT normalized_code, code_version
             FROM room_codes
             WHERE room_id = $1
             LIMIT 1",
        )
        .bind(room_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_error)?;
        let row = row.ok_or(AppError::DependencyFailure)?;
        let room_code = map_room_code(
            row.get::<String, _>("normalized_code"),
            row.get::<i16, _>("code_version"),
        )?;
        let messages = load_recent_messages(&self.pool, room_id, limit).await?;

        Ok(RoomSnapshotData {
            room_id,
            room_code,
            messages,
        })
    }
}

impl AdminOverviewPort for PgStore {
    async fn get_admin_overview(&self) -> Result<AdminOverview, AppError> {
        let row = sqlx::query(
            "SELECT
                 (SELECT COUNT(*) FROM rooms WHERE status = 'active') AS room_count,
                 (SELECT COUNT(*) FROM members WHERE status = 'active') AS member_count,
                 (SELECT COUNT(*) FROM messages WHERE status = 'active') AS message_count",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(AdminOverview {
            room_count: row.get("room_count"),
            member_count: row.get("member_count"),
            message_count: row.get("message_count"),
        })
    }
}

impl AdminRoomsPort for PgStore {
    async fn list_admin_rooms(&self) -> Result<Vec<AdminRoomSummary>, AppError> {
        let rows = sqlx::query(
            "SELECT
                 room_codes.normalized_code AS room_code,
                 COALESCE(member_stats.member_count, 0) AS member_count,
                 COALESCE(message_stats.message_count, 0) AS message_count,
                 COALESCE(message_stats.latest_preview, '') AS latest_preview
             FROM rooms
             JOIN room_codes ON room_codes.room_id = rooms.room_id
             LEFT JOIN LATERAL (
                 SELECT COUNT(*) AS member_count
                 FROM members
                 WHERE members.room_id = rooms.room_id
                   AND members.status = 'active'
             ) AS member_stats ON TRUE
             LEFT JOIN LATERAL (
                 SELECT
                     COUNT(*) AS message_count,
                     MAX(created_at) AS latest_created_at,
                     (
                         SELECT body
                         FROM messages
                         WHERE messages.room_id = rooms.room_id
                           AND messages.status = 'active'
                         ORDER BY created_at DESC, message_id DESC
                         LIMIT 1
                     ) AS latest_preview
                 FROM messages
                 WHERE messages.room_id = rooms.room_id
                   AND messages.status = 'active'
             ) AS message_stats ON TRUE
             WHERE rooms.status = 'active'
             ORDER BY message_stats.latest_created_at DESC NULLS LAST, room_codes.normalized_code ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows
            .into_iter()
            .map(|row| AdminRoomSummary {
                room_code: row.get("room_code"),
                member_count: row.get("member_count"),
                message_count: row.get("message_count"),
                latest_preview: row.get("latest_preview"),
            })
            .collect())
    }
}

impl AdminPanelPort for PgStore {
    async fn load_admin_panel(&self) -> Result<AdminPanelData, AppError> {
        let overview = self.get_admin_overview().await?;
        let rooms = self.list_admin_rooms().await?;

        Ok(AdminPanelData { overview, rooms })
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

fn map_room_code(normalized_code: String, code_version: i16) -> Result<RoomCode, AppError> {
    let mut room_code = RoomCode::new(&normalized_code).map_err(|_| AppError::DependencyFailure)?;
    room_code.code_version =
        u16::try_from(code_version).map_err(|_| AppError::DependencyFailure)?;
    Ok(room_code)
}

fn map_message_row(row: &sqlx::postgres::PgRow) -> Result<Message, AppError> {
    let status = row.get::<String, _>("status");
    if status != "active" {
        return Err(AppError::DependencyFailure);
    }

    let body =
        MessageBody::new(&row.get::<String, _>("body")).map_err(|_| AppError::DependencyFailure)?;

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
