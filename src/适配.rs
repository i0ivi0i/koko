use std::io;

use sqlx::{postgres::PgPoolOptions, PgPool, Row};

use crate::{contract, usecase::仓储端口};

/// PostgreSQL 适配层只做持久化翻译与事务提交，不承载业务规则。
pub struct Pg仓储 {
    rt: tokio::runtime::Runtime,
    pool: PgPool,
}

impl Pg仓储 {
    pub fn 连接并迁移(database_url: &str) -> io::Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|err| io::Error::other(format!("创建运行时失败: {err}")))?;
        let pool = rt
            .block_on(async {
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await
            })
            .map_err(|err| io::Error::other(format!("连接数据库失败: {err}")))?;
        rt.block_on(async {
            sqlx::migrate!("./migrations")
                .run(&pool)
                .await
                .map_err(|err| io::Error::other(format!("执行迁移失败: {err}")))
        })?;
        Ok(Self { rt, pool })
    }

    pub fn 查询房间持久化计数(
        &self,
        房间标识: &str,
    ) -> Result<(i64, i64, i64), contract::错误码> {
        self.rt.block_on(async {
            let room = sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
                .bind(房间标识)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let Some(room_row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room_row.get("id");
            let latest: i64 = room_row.get("latest_event_position");

            let event_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM room_events WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            let msg_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            Ok((latest, event_count, msg_count))
        })
    }
}

impl 仓储端口 for Pg仓储 {
    fn 创建匿名会话(&mut self, 显示名: &str) -> Result<contract::快照, contract::错误码> {
        self.rt.block_on(async {
            let row = sqlx::query(
                "INSERT INTO sessions (session_id, display_name) \
                 VALUES (concat('s-', substring(md5(random()::text) from 1 for 12)), $1) \
                 RETURNING session_id, display_name",
            )
            .bind(显示名)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::快照::会话 {
                会话标识: row.get("session_id"),
                显示名: row.get("display_name"),
            })
        })
    }

    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码> {
        self.rt.block_on(async {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let session_db_id: i64 =
                sqlx::query_scalar("SELECT id FROM sessions WHERE session_id = $1")
                    .bind(会话标识)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?
                    .ok_or(contract::错误码::会话无效)?;

            let room_row = sqlx::query(
                "SELECT id, room_id, latest_event_position FROM rooms WHERE room_code = $1",
            )
            .bind(房间短码)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            let (room_db_id, room_id, latest_event_position): (i64, String, i64) =
                if let Some(row) = room_row {
                    (
                        row.get("id"),
                        row.get("room_id"),
                        row.get("latest_event_position"),
                    )
                } else {
                    let created = sqlx::query(
                        "INSERT INTO rooms (room_id, room_code, title, created_by_session_id) \
                         VALUES (concat('r-', substring(md5(random()::text) from 1 for 12)), $1, $2, $3) \
                         RETURNING id, room_id, latest_event_position",
                    )
                    .bind(房间短码)
                    .bind(format!("房间-{房间短码}"))
                    .bind(session_db_id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
                    (
                        created.get("id"),
                        created.get("room_id"),
                        created.get("latest_event_position"),
                    )
                };

            sqlx::query(
                "INSERT INTO room_members (room_id, session_id, left_at) \
                 VALUES ($1, $2, NULL) \
                 ON CONFLICT (room_id, session_id) WHERE left_at IS NULL DO NOTHING",
            )
            .bind(room_db_id)
            .bind(session_db_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::快照::房间 {
                房间标识: room_id,
                最新事件位置: latest_event_position,
            })
        })
    }

    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        self.rt.block_on(async {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) \
                 FROM room_members rm \
                 JOIN rooms r ON r.id = rm.room_id \
                 JOIN sessions s ON s.id = rm.session_id \
                 WHERE r.room_id = $1 AND s.session_id = $2 AND rm.left_at IS NULL",
            )
            .bind(房间标识)
            .bind(会话标识)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            Ok(exists > 0)
        })
    }

    fn 拉取房间快照(&self, 房间标识: &str) -> Result<contract::快照, contract::错误码> {
        self.rt.block_on(async {
            let room = sqlx::query("SELECT room_id, latest_event_position FROM rooms WHERE room_id = $1")
                .bind(房间标识)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let Some(row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            Ok(contract::快照::房间 {
                房间标识: row.get("room_id"),
                最新事件位置: row.get("latest_event_position"),
            })
        })
    }

    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码> {
        self.rt.block_on(async {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let room_row = sqlx::query(
                "SELECT id, latest_event_position FROM rooms WHERE room_id = $1 FOR UPDATE",
            )
            .bind(房间标识)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let Some(room) = room_row else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room.get("id");
            let latest_position: i64 = room.get("latest_event_position");
            let next_position = latest_position + 1;

            let session_db_id: i64 =
                sqlx::query_scalar("SELECT id FROM sessions WHERE session_id = $1")
                    .bind(会话标识)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?
                    .ok_or(contract::错误码::会话无效)?;

            let message_id = format!("{房间标识}-{next_position}");

            sqlx::query(
                "INSERT INTO room_events (room_id, event_position, event_kind, actor_session_id, message_id) \
                 VALUES ($1, $2, 'message_created', $3, $4)",
            )
            .bind(room_db_id)
            .bind(next_position)
            .bind(session_db_id)
            .bind(&message_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            sqlx::query(
                "INSERT INTO messages (message_id, room_id, sender_session_id, client_message_id, event_position, body) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(&message_id)
            .bind(room_db_id)
            .bind(session_db_id)
            .bind(客户端消息标识)
            .bind(next_position)
            .bind(文本)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            sqlx::query("UPDATE rooms SET latest_event_position = $1 WHERE id = $2")
                .bind(next_position)
                .bind(room_db_id)
                .execute(&mut *tx)
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::领域事件::消息已创建 {
                房间标识: 房间标识.to_string(),
                消息标识: message_id,
                客户端消息标识: 客户端消息标识.to_string(),
                发送者会话标识: 会话标识.to_string(),
                文本: 文本.to_string(),
                事件位置: next_position,
            })
        })
    }
}
