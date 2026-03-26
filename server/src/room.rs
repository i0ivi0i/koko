use koko_core::{
    error::DomainError,
    model::{ProfileId, Role, Room, RoomCode, RoomId},
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
