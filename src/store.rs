use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    app::{
        AdminOverviewPort, AdminRoomsPort, AdminSessionState, AppError, JoinedRoomsPort,
        MembershipPort, MessageStore, RoomEntryPort, RoomEntryTx, RoomSearchPort, RoomSnapshotData,
        RoomSnapshotPort, SessionBootstrapPort, SessionPort,
    },
    contract::{AdminOverview, AdminRoomSummary, JoinedRoomSummary, RoomSearchResult},
    domain::{
        AnonymousSession, Message, MessageBody, MessageStatus, NewMemberRecord, NewRoomCodeRecord,
        NewRoomRecord, RoomCode, SessionStatus,
    },
};

const ADMIN_SESSION_TRUTH_LOCK_NAME: &str = "admin_session_truth";
const ADMIN_SESSION_TRUTH_LOCK_NAMESPACE: i32 = 1;
const ADMIN_SESSION_IDLE_TIMEOUT: time::Duration = time::Duration::days(3);

#[derive(Debug, Clone)]
pub struct PgStore {
    pool: PgPool,
}

#[derive(Debug)]
struct AdminSessionTruthRow {
    active_session_id: String,
    admin_token_fingerprint: String,
    last_seen_at: DateTime<Utc>,
}

impl PgStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn replace_active_admin_session(
        &self,
        session_id: Uuid,
        token_fingerprint: &str,
        now: DateTime<Utc>,
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        lock_admin_session_truth(&mut tx).await?;

        // 后台只保留一条真相行，避免数据库里并存多条“当前管理员会话”造成双活与边界漂移。
        sqlx::query(
            "INSERT INTO admin_session_truth (
                 singleton_key,
                 active_session_id,
                 admin_token_fingerprint,
                 issued_at,
                 last_seen_at
             )
             VALUES (TRUE, $1, $2, $3, $3)
             ON CONFLICT (singleton_key) DO UPDATE
             SET active_session_id = EXCLUDED.active_session_id,
                 admin_token_fingerprint = EXCLUDED.admin_token_fingerprint,
                 issued_at = EXCLUDED.issued_at,
                 last_seen_at = EXCLUDED.last_seen_at",
        )
        .bind(session_id.to_string())
        .bind(token_fingerprint)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)
    }

    pub async fn read_admin_session_state(
        &self,
        session_id: Uuid,
        token_fingerprint: &str,
        now: DateTime<Utc>,
        touch_last_seen: bool,
    ) -> Result<AdminSessionState, AppError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        lock_admin_session_truth(&mut tx).await?;

        let Some(truth) = load_admin_session_truth(&mut tx).await? else {
            tx.commit().await.map_err(map_sqlx_error)?;
            return Ok(AdminSessionState::Required);
        };

        let session_id = session_id.to_string();
        if truth.admin_token_fingerprint != token_fingerprint {
            // 管理员口令一旦轮换，旧指纹对应的请求必须立刻失效；但数据库中的当前真相行代表新口令下的新活跃会话，不能被旧请求反向撤销。
            tx.commit().await.map_err(map_sqlx_error)?;
            return Ok(AdminSessionState::Required);
        }

        if truth.active_session_id != session_id {
            tx.commit().await.map_err(map_sqlx_error)?;
            return Ok(AdminSessionState::Replaced);
        }

        if admin_session_is_expired(truth.last_seen_at, now)? {
            clear_admin_session_truth(&mut tx).await?;
            tx.commit().await.map_err(map_sqlx_error)?;
            return Ok(AdminSessionState::Expired);
        }

        if touch_last_seen && now > truth.last_seen_at {
            sqlx::query(
                "UPDATE admin_session_truth
                 SET last_seen_at = $1
                 WHERE singleton_key = TRUE",
            )
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_error)?;
        }

        tx.commit().await.map_err(map_sqlx_error)?;
        Ok(AdminSessionState::Active)
    }

    pub async fn clear_admin_session(&self, session_id: Uuid) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_error)?;
        lock_admin_session_truth(&mut tx).await?;

        sqlx::query(
            "DELETE FROM admin_session_truth
             WHERE singleton_key = TRUE
               AND active_session_id = $1",
        )
        .bind(session_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_error)?;

        tx.commit().await.map_err(map_sqlx_error)
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

impl JoinedRoomsPort for PgStore {
    async fn list_joined_rooms(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<JoinedRoomSummary>, AppError> {
        let rows = sqlx::query(
            "SELECT
                 rooms.room_id,
                 room_codes.normalized_code AS room_code,
                 room_codes.normalized_code AS display_title,
                 COALESCE(message_stats.latest_preview, '') AS latest_preview,
                 message_stats.latest_message_at
             FROM members
             JOIN rooms ON rooms.room_id = members.room_id
             JOIN room_codes ON room_codes.room_id = rooms.room_id
             LEFT JOIN LATERAL (
                 SELECT
                     messages.created_at AS latest_message_at,
                     messages.body AS latest_preview
                 FROM messages
                 WHERE messages.room_id = rooms.room_id
                   AND messages.status = 'active'
                 ORDER BY messages.created_at DESC, messages.message_id DESC
                 LIMIT 1
             ) AS message_stats ON TRUE
             WHERE members.session_id = $1
               AND members.status = 'active'
               AND rooms.status = 'active'
             ORDER BY message_stats.latest_message_at DESC NULLS LAST, room_codes.normalized_code ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows
            .into_iter()
            .map(|row| JoinedRoomSummary {
                room_id: row.get("room_id"),
                room_code: row.get("room_code"),
                display_title: row.get("display_title"),
                latest_preview: row.get("latest_preview"),
                latest_message_at: row.get("latest_message_at"),
            })
            .collect())
    }
}

impl RoomSearchPort for PgStore {
    async fn search_rooms_by_code(
        &self,
        session_id: Uuid,
        input: &str,
    ) -> Result<Vec<RoomSearchResult>, AppError> {
        let normalized_prefix = input.trim().to_ascii_uppercase();
        if normalized_prefix.is_empty() {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(
            "SELECT
                 rooms.room_id,
                 room_codes.normalized_code AS room_code,
                 room_codes.normalized_code AS display_title,
                 COALESCE(message_stats.latest_preview, '') AS latest_preview,
                 message_stats.latest_message_at,
                 EXISTS(
                     SELECT 1
                     FROM members
                     WHERE members.room_id = rooms.room_id
                       AND members.session_id = $1
                       AND members.status = 'active'
                 ) AS is_joined
             FROM rooms
             JOIN room_codes ON room_codes.room_id = rooms.room_id
             LEFT JOIN LATERAL (
                 SELECT
                     messages.created_at AS latest_message_at,
                     messages.body AS latest_preview
                 FROM messages
                 WHERE messages.room_id = rooms.room_id
                   AND messages.status = 'active'
                 ORDER BY messages.created_at DESC, messages.message_id DESC
                 LIMIT 1
             ) AS message_stats ON TRUE
             WHERE rooms.status = 'active'
               AND room_codes.normalized_code LIKE $2
             ORDER BY
                 CASE WHEN room_codes.normalized_code = $3 THEN 0 ELSE 1 END,
                 CASE
                     WHEN EXISTS(
                         SELECT 1
                         FROM members
                         WHERE members.room_id = rooms.room_id
                           AND members.session_id = $1
                           AND members.status = 'active'
                     ) THEN 0
                     ELSE 1
                 END,
                 message_stats.latest_message_at DESC NULLS LAST,
                 room_codes.normalized_code ASC",
        )
        .bind(session_id)
        .bind(format!("{normalized_prefix}%"))
        .bind(&normalized_prefix)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_error)?;

        Ok(rows
            .into_iter()
            .map(|row| RoomSearchResult {
                room_id: row.get("room_id"),
                room_code: row.get("room_code"),
                display_title: row.get("display_title"),
                latest_preview: row.get("latest_preview"),
                latest_message_at: row.get("latest_message_at"),
                is_joined: row.get("is_joined"),
            })
            .collect())
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

    async fn create_room(
        &mut self,
        room: &NewRoomRecord,
        room_code: &NewRoomCodeRecord,
    ) -> Result<(), AppError> {
        if room_code.room_id != room.room_id {
            return Err(AppError::DependencyFailure);
        }

        sqlx::query(
            "INSERT INTO rooms (room_id, created_at, status)
             VALUES ($1, $2, 'active')",
        )
        .bind(room.room_id)
        .bind(room.created_at)
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
        .bind(room_code.room_code_id)
        .bind(room_code.room_id)
        .bind(&room_code.original_code)
        .bind(&room_code.normalized_code)
        .bind(i16::try_from(room_code.code_version).map_err(|_| AppError::DependencyFailure)?)
        .bind(room_code.created_at)
        .execute(&mut *self.tx)
        .await
        .map_err(map_sqlx_error)?;

        Ok(())
    }

    async fn ensure_room_member(&mut self, member: &NewMemberRecord) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO members (member_id, room_id, session_id, joined_at, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT (room_id, session_id) DO NOTHING",
        )
        .bind(member.member_id)
        .bind(member.room_id)
        .bind(member.session_id)
        .bind(member.joined_at)
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

async fn lock_admin_session_truth(tx: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1), $2)")
        .bind(ADMIN_SESSION_TRUTH_LOCK_NAME)
        .bind(ADMIN_SESSION_TRUTH_LOCK_NAMESPACE)
        .execute(&mut **tx)
        .await
        .map_err(map_sqlx_error)?;

    Ok(())
}

async fn load_admin_session_truth(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Option<AdminSessionTruthRow>, AppError> {
    let row = sqlx::query(
        "SELECT active_session_id, admin_token_fingerprint, last_seen_at
         FROM admin_session_truth
         WHERE singleton_key = TRUE",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(map_sqlx_error)?;

    Ok(row.map(|row: sqlx::postgres::PgRow| AdminSessionTruthRow {
        active_session_id: row.get("active_session_id"),
        admin_token_fingerprint: row.get("admin_token_fingerprint"),
        last_seen_at: row.get("last_seen_at"),
    }))
}

async fn clear_admin_session_truth(tx: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    sqlx::query("DELETE FROM admin_session_truth WHERE singleton_key = TRUE")
        .execute(&mut **tx)
        .await
        .map_err(map_sqlx_error)?;

    Ok(())
}

fn admin_session_is_expired(
    last_seen_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<bool, AppError> {
    let timeout = chrono::TimeDelta::seconds(ADMIN_SESSION_IDLE_TIMEOUT.whole_seconds());
    let idle = now.signed_duration_since(last_seen_at);
    if idle < chrono::TimeDelta::zero() {
        return Ok(false);
    }

    Ok(idle > timeout)
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
