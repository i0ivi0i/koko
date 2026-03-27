use koko_core::{
    error::DomainError,
    model::{GlobalChatPolicy, ProfileId, Role, Room, RoomCode, RoomGovernanceState, RoomId},
    port::RoomRepository,
};
use sqlx::PgPool;
use sqlx::types::time::OffsetDateTime;
use time::Duration;

pub struct PostgresRoomRepository {
    pool: PgPool,
}

pub struct RoomMemberRecord {
    pub profile_id: ProfileId,
    pub device_key: String,
    pub role: Role,
}

pub struct AdminRoomRecord {
    pub room_id: RoomId,
    pub code: String,
    pub member_count: u64,
    pub last_message_at: Option<OffsetDateTime>,
    pub banned_until: Option<OffsetDateTime>,
    pub ban_reason: Option<String>,
}

impl PostgresRoomRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn find_room(&self, room_id: RoomId) -> Result<Option<Room>, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            SELECT r.id, rc.code
            FROM rooms r
            JOIN room_codes rc ON rc.room_id = r.id
            WHERE r.id = $1
            "#,
            room_id.0
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| Room::new(RoomId(row.id), RoomCode::parse(&row.code).unwrap())))
    }

    pub async fn list_members(
        &self,
        room_id: RoomId,
    ) -> Result<Vec<RoomMemberRecord>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT rm.profile_id, p.device_key, rm.role
            FROM room_members rm
            JOIN profiles p ON p.id = rm.profile_id
            WHERE rm.room_id = $1
            ORDER BY rm.created_at ASC
            "#,
            room_id.0
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let role = match row.role.as_str() {
                    "owner" => Role::Owner,
                    "admin" => Role::Admin,
                    "member" => Role::Member,
                    _ => return None,
                };

                Some(RoomMemberRecord {
                    profile_id: ProfileId(row.profile_id),
                    device_key: row.device_key,
                    role,
                })
            })
            .collect())
    }

    pub async fn total_rooms(&self) -> Result<u64, sqlx::Error> {
        let count = sqlx::query_scalar!("SELECT COUNT(*) AS count FROM rooms")
            .fetch_one(&self.pool)
            .await?
            .unwrap_or(0);

        Ok(u64::try_from(count).unwrap_or_default())
    }

    pub async fn total_memberships(&self) -> Result<u64, sqlx::Error> {
        let count = sqlx::query_scalar!("SELECT COUNT(*) AS count FROM room_members")
            .fetch_one(&self.pool)
            .await?
            .unwrap_or(0);

        Ok(u64::try_from(count).unwrap_or_default())
    }

    pub async fn list_admin_rooms(
        &self,
        code: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AdminRoomRecord>, sqlx::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT
                r.id,
                rc.code,
                COUNT(DISTINCT rm.profile_id) AS member_count,
                MAX(m.created_at) AS last_message_at,
                rgs.banned_until,
                rgs.ban_reason
            FROM rooms r
            JOIN room_codes rc ON rc.room_id = r.id
            LEFT JOIN room_members rm ON rm.room_id = r.id
            LEFT JOIN messages m ON m.room_id = r.id
            LEFT JOIN room_governance_state rgs ON rgs.room_id = r.id
            WHERE ($1::text IS NULL OR rc.code ILIKE '%' || $1 || '%')
            GROUP BY r.id, rc.code, rgs.banned_until, rgs.ban_reason
            ORDER BY MAX(m.created_at) DESC NULLS LAST, rc.code ASC
            LIMIT $2
            "#,
            code,
            i64::try_from(limit).unwrap_or(50)
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| AdminRoomRecord {
                room_id: RoomId(row.id),
                code: row.code,
                member_count: u64::try_from(row.member_count.unwrap_or(0)).unwrap_or_default(),
                last_message_at: row.last_message_at,
                banned_until: row.banned_until,
                ban_reason: row.ban_reason,
            })
            .collect())
    }

    pub async fn admin_room_detail(
        &self,
        room_id: RoomId,
    ) -> Result<Option<AdminRoomRecord>, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            SELECT
                r.id,
                rc.code,
                COUNT(DISTINCT rm.profile_id) AS member_count,
                MAX(m.created_at) AS last_message_at,
                rgs.banned_until,
                rgs.ban_reason
            FROM rooms r
            JOIN room_codes rc ON rc.room_id = r.id
            LEFT JOIN room_members rm ON rm.room_id = r.id
            LEFT JOIN messages m ON m.room_id = r.id
            LEFT JOIN room_governance_state rgs ON rgs.room_id = r.id
            WHERE r.id = $1
            GROUP BY r.id, rc.code, rgs.banned_until, rgs.ban_reason
            "#,
            room_id.0
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| AdminRoomRecord {
            room_id: RoomId(row.id),
            code: row.code,
            member_count: u64::try_from(row.member_count.unwrap_or(0)).unwrap_or_default(),
            last_message_at: row.last_message_at,
            banned_until: row.banned_until,
            ban_reason: row.ban_reason,
        }))
    }
}

impl RoomRepository for PostgresRoomRepository {
    async fn find_by_code(&self, code: &RoomCode) -> Result<Option<Room>, DomainError> {
        let row = sqlx::query!(
            r#"
            SELECT r.id, rc.code
            FROM rooms r
            JOIN room_codes rc ON rc.room_id = r.id
            WHERE rc.code = $1
            "#,
            code.as_str()
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(row.map(|row| Room::new(RoomId(row.id), RoomCode::parse(&row.code).unwrap())))
    }

    async fn create_room(&self, owner_id: ProfileId, code: RoomCode) -> Result<Room, DomainError> {
        let room_id = RoomId(uuid::Uuid::new_v4());

        sqlx::query!(
            "INSERT INTO rooms (id, owner_profile_id) VALUES ($1, $2)",
            room_id.0,
            owner_id.0
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        sqlx::query!(
            "INSERT INTO room_codes (room_id, code) VALUES ($1, $2)",
            room_id.0,
            code.as_str()
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        sqlx::query!(
            "INSERT INTO room_members (room_id, profile_id, role) VALUES ($1, $2, $3)",
            room_id.0,
            owner_id.0,
            "owner"
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(Room::new(room_id, code))
    }

    async fn ensure_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> Result<(), DomainError> {
        let role = match role {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Member => "member",
        };

        sqlx::query!(
            r#"
            INSERT INTO room_members (room_id, profile_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (room_id, profile_id) DO UPDATE SET role = EXCLUDED.role
            "#,
            room_id.0,
            profile_id.0,
            role
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(())
    }

    async fn role_of(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<Option<Role>, DomainError> {
        let row = sqlx::query!(
            "SELECT role FROM room_members WHERE room_id = $1 AND profile_id = $2",
            room_id.0,
            profile_id.0
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(row.and_then(|row| match row.role.as_str() {
            "owner" => Some(Role::Owner),
            "admin" => Some(Role::Admin),
            "member" => Some(Role::Member),
            _ => None,
        }))
    }

    async fn set_role(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        role: Role,
    ) -> Result<(), DomainError> {
        let role = match role {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Member => "member",
        };

        sqlx::query!(
            "UPDATE room_members SET role = $3 WHERE room_id = $1 AND profile_id = $2",
            room_id.0,
            profile_id.0,
            role
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InsufficientRoomPermission)?;

        Ok(())
    }

    async fn set_muted(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
        muted: bool,
    ) -> Result<(), DomainError> {
        let until = if muted {
            Some(OffsetDateTime::now_utc() + Duration::hours(24))
        } else {
            None
        };

        sqlx::query!(
            "UPDATE room_members SET muted_until = $3 WHERE room_id = $1 AND profile_id = $2",
            room_id.0,
            profile_id.0,
            until
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InsufficientRoomPermission)?;

        Ok(())
    }

    async fn is_muted(&self, room_id: RoomId, profile_id: ProfileId) -> Result<bool, DomainError> {
        let muted_until = sqlx::query_scalar!(
            "SELECT muted_until FROM room_members WHERE room_id = $1 AND profile_id = $2",
            room_id.0,
            profile_id.0
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| DomainError::InsufficientRoomPermission)?;

        Ok(muted_until
            .flatten()
            .is_some_and(|value| value > OffsetDateTime::now_utc()))
    }

    async fn remove_member(
        &self,
        room_id: RoomId,
        profile_id: ProfileId,
    ) -> Result<(), DomainError> {
        sqlx::query!(
            "DELETE FROM room_members WHERE room_id = $1 AND profile_id = $2",
            room_id.0,
            profile_id.0
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InsufficientRoomPermission)?;

        Ok(())
    }

    async fn global_chat_policy(&self) -> Result<GlobalChatPolicy, DomainError> {
        let row = sqlx::query!(
            "SELECT max_message_length FROM global_chat_policy WHERE singleton = TRUE"
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidMaxMessageLength)?;

        let max_message_length = row
            .and_then(|row| usize::try_from(row.max_message_length).ok())
            .unwrap_or_else(|| GlobalChatPolicy::default().max_message_length());

        GlobalChatPolicy::new(max_message_length).map_err(|_| DomainError::InvalidMaxMessageLength)
    }

    async fn set_global_chat_policy(&self, policy: GlobalChatPolicy) -> Result<(), DomainError> {
        let max_message_length = i32::try_from(policy.max_message_length())
            .map_err(|_| DomainError::InvalidMaxMessageLength)?;

        sqlx::query!(
            r#"
            INSERT INTO global_chat_policy (singleton, max_message_length, updated_at)
            VALUES (TRUE, $1, NOW())
            ON CONFLICT (singleton)
            DO UPDATE SET
                max_message_length = EXCLUDED.max_message_length,
                updated_at = NOW()
            "#,
            max_message_length
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidMaxMessageLength)?;

        Ok(())
    }

    async fn governance_state(&self, room_id: RoomId) -> Result<RoomGovernanceState, DomainError> {
        let row = sqlx::query!(
            "SELECT banned_until, ban_reason FROM room_governance_state WHERE room_id = $1",
            room_id.0
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(match row {
            Some(row) => RoomGovernanceState {
                banned_until: row.banned_until,
                ban_reason: row.ban_reason,
            },
            None => RoomGovernanceState::unbanned(),
        })
    }

    async fn set_governance_state(
        &self,
        room_id: RoomId,
        state: RoomGovernanceState,
    ) -> Result<(), DomainError> {
        sqlx::query!(
            r#"
            INSERT INTO room_governance_state (room_id, banned_until, ban_reason, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (room_id)
            DO UPDATE SET
                banned_until = EXCLUDED.banned_until,
                ban_reason = EXCLUDED.ban_reason,
                updated_at = NOW()
            "#,
            room_id.0,
            state.banned_until,
            state.ban_reason
        )
        .execute(&self.pool)
        .await
        .map_err(|_| DomainError::InvalidRoomCode)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PostgresRoomRepository;
    use koko_core::{
        model::{ProfileId, RoomCode},
        port::RoomRepository,
    };
    use sqlx::PgPool;
    use uuid::Uuid;

    #[sqlx::test(migrations = "../migrations")]
    async fn 创建房间时应持久化短码与群主关系(pool: PgPool) {
        let profile_id = ProfileId(Uuid::new_v4());
        sqlx::query!(
            "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
            profile_id.0,
            "device-1"
        )
        .execute(&pool)
        .await
        .unwrap();

        let repo = PostgresRoomRepository::new(pool.clone());
        let room = repo
            .create_room(profile_id, RoomCode::parse("1A234").unwrap())
            .await
            .unwrap();

        let room_code =
            sqlx::query_scalar!("SELECT code FROM room_codes WHERE room_id = $1", room.id.0)
                .fetch_one(&pool)
                .await
                .unwrap();
        let role = sqlx::query_scalar!(
            "SELECT role FROM room_members WHERE room_id = $1 AND profile_id = $2",
            room.id.0,
            profile_id.0
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(room_code, "1A234");
        assert_eq!(role, "owner");
    }
}
