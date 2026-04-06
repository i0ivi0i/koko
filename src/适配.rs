use std::{future::Future, io};

use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use uuid::Uuid;

use crate::{contract, usecase::仓储端口};

/// PostgreSQL 适配层只做持久化翻译与事务提交，不承载业务规则。
///
/// 维护者边界提醒：
/// 1. 这里可以做 SQL、事务、索引命中相关优化。
/// 2. 这里不可以改“谁能发/谁是成员/消息是否成立”等业务真相。
/// 3. 业务真相必须在领域+用例决定，适配层只负责把结果准确落库/读库。
pub struct Pg仓储 {
    handle: tokio::runtime::Handle,
    owned_runtime: Option<tokio::runtime::Runtime>,
    pool: PgPool,
}

/// 生成稳定格式的匿名内部身份标识。
/// 约束：这里只负责标识格式，不把展示语义塞进主键。
fn 生成匿名身份标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("a-{}", &raw[..12])
}

/// 生成稳定格式的会话标识。
/// 约束：会话是运行锚点，不承载展示语义。
fn 生成会话标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("s-{}", &raw[..12])
}

/// 当前 MVP 的花名生成器。
/// 设计取舍：
/// 1. 这不是通用基础设施，而是产品展示语义，放在这里足够薄；
/// 2. 花名首次创建后会持久化，因此这里无需做复杂可重放算法；
/// 3. 花名只是展示面，未来允许独立修改。
fn 生成展示花名() -> String {
    const 前缀: [&str; 8] = [
        "暴躁的",
        "爱玩枪的",
        "火锅味",
        "潜水的",
        "早起的",
        "叛逆的",
        "失眠的",
        "开黑的",
    ];
    const 后缀: [&str; 8] = [
        "企鹅", "小鸡", "海豹", "柴犬", "狸猫", "河马", "海鸥", "松鼠",
    ];

    let seed = Uuid::new_v4();
    let bytes = seed.as_bytes();
    let left = 前缀[(bytes[0] as usize) % 前缀.len()];
    let right = 后缀[(bytes[1] as usize) % 后缀.len()];
    format!("{left}{right}")
}

impl Pg仓储 {
    fn 在运行时执行<T>(&self, future: impl Future<Output = T>) -> T {
        if let Some(rt) = &self.owned_runtime {
            rt.block_on(future)
        } else {
            self.handle.block_on(future)
        }
    }

    /// 连接数据库并追平迁移。
    ///
    /// 设计原因：
    /// - 保证任何入口拿到仓储时，库结构已可用。
    /// - 避免“代码已更新但库未迁移”导致的运行期随机报错。
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
        let handle = rt.handle().clone();
        Ok(Self {
            handle,
            owned_runtime: Some(rt),
            pool,
        })
    }

    /// 用共享连接池构造仓储，避免热路径重复创建 `PgPool`。
    pub fn 从连接池构建(pool: PgPool, handle: tokio::runtime::Handle) -> Self {
        Self {
            handle,
            owned_runtime: None,
            pool,
        }
    }

    /// 仅用于测试事务不变量：验证房间锚点、事件条数、消息条数是否同步推进。
    pub fn 查询房间持久化计数(
        &self,
        房间标识: &str,
    ) -> Result<(i64, i64, i64), contract::错误码> {
        self.在运行时执行(async {
            let room =
                sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
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

    /// 按事件位置拉房间增量事件（冷路径补洞接口）。
    ///
    /// 约束：
    /// - 返回顺序必须按 event_position 升序，便于前端做幂等合并。
    /// - 这里只做数据拼装，不在这里判断成员资格或权限。
    pub fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        if 从位置开始 < 0 {
            return Err(contract::错误码::参数非法);
        }
        self.在运行时执行(async {
            let room = sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
                .bind(房间标识)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let Some(room_row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room_row.get("id");
            let latest_event_position: i64 = room_row.get("latest_event_position");

            let rows = sqlx::query(
                "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, s.display_name, m.body \
                 FROM room_events re \
                 LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
                 LEFT JOIN sessions s ON s.id = m.sender_session_id \
                 WHERE re.room_id = $1 AND re.event_position > $2 \
                 ORDER BY re.event_position ASC",
            )
            .bind(room_db_id)
            .bind(从位置开始)
            .fetch_all(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            let mut events = Vec::with_capacity(rows.len());
            for row in rows {
                let msg_id: Option<String> = row.get("message_id");
                let client_id: Option<String> = row.get("client_message_id");
                let sender_session_id: Option<String> = row.get("session_id");
                let sender_alias: Option<String> = row.get("display_name");
                let body: Option<String> = row.get("body");
                events.push(contract::领域事件::消息已创建 {
                    房间标识: 房间标识.to_string(),
                    消息标识: msg_id.unwrap_or_default(),
                    客户端消息标识: client_id.unwrap_or_default(),
                    发送者会话标识: sender_session_id.unwrap_or_default(),
                    发送者花名: sender_alias.unwrap_or_default(),
                    文本: body.unwrap_or_default(),
                    事件位置: row.get("event_position"),
                });
            }

            Ok(contract::快照::房间增量事件 {
                房间标识: 房间标识.to_string(),
                事件: events,
                最新事件位置: latest_event_position,
            })
        })
    }

    /// 后台概览查询（只读）。
    pub fn 后台概览(&self) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            Ok(contract::快照::后台概览 {
                房间总数: room_count as u64,
                消息总数: msg_count as u64,
            })
        })
    }

    /// 后台房间列表查询（只读）。
    pub fn 后台房间列表(&self) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let rows = sqlx::query("SELECT room_id FROM rooms ORDER BY created_at DESC LIMIT 100")
                .fetch_all(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let room_ids = rows
                .into_iter()
                .map(|r| r.get::<String, _>("room_id"))
                .collect::<Vec<_>>();
            Ok(contract::快照::后台房间列表 {
                房间标识列表: room_ids,
            })
        })
    }

    /// 后台房间详情查询（只读）。
    pub fn 后台房间详情(
        &self,
        房间标识: &str,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room =
                sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
                    .bind(房间标识)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            let Some(room_row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room_row.get("id");
            let latest: i64 = room_row.get("latest_event_position");
            let msg_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            Ok(contract::快照::后台房间详情 {
                房间标识: 房间标识.to_string(),
                最新事件位置: latest,
                消息总数: msg_count as u64,
            })
        })
    }
}

impl 仓储端口 for Pg仓储 {
    /// 设备级匿名身份引导：
    /// - 同一设备入口凭证恢复同一个匿名内部身份
    /// - 同一设备入口凭证恢复同一个稳定会话
    /// - 花名首次生成后持久化，后续直接恢复
    fn 引导匿名身份(
        &mut self,
        设备匿名凭证: &str,
    ) -> Result<contract::匿名身份引导结果, contract::错误码> {
        self.在运行时执行(async {
            let existing = sqlx::query(
                "SELECT ai.anonymous_identity_id, ai.display_alias, s.session_id \
                 FROM sessions s \
                 JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
                 WHERE s.device_anonymous_token = $1",
            )
            .bind(设备匿名凭证)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            if let Some(row) = existing {
                return Ok(contract::匿名身份引导结果 {
                    匿名身份标识: row.get("anonymous_identity_id"),
                    展示花名: row.get("display_alias"),
                    会话标识: row.get("session_id"),
                });
            }

            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let anonymous_identity_id = 生成匿名身份标识();
            let display_alias = 生成展示花名();
            let session_id = 生成会话标识();

            let identity_row = sqlx::query(
                "INSERT INTO anonymous_identities (anonymous_identity_id, display_alias) \
                 VALUES ($1, $2) \
                 RETURNING id",
            )
            .bind(&anonymous_identity_id)
            .bind(&display_alias)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let identity_db_id: i64 = identity_row.get("id");

            sqlx::query(
                "INSERT INTO sessions (session_id, display_name, anonymous_identity_id, device_anonymous_token) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(&session_id)
            .bind(&display_alias)
            .bind(identity_db_id)
            .bind(设备匿名凭证)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::匿名身份引导结果 {
                匿名身份标识: anonymous_identity_id,
                展示花名: display_alias,
                会话标识: session_id,
            })
        })
    }

    /// 进房/建房持久化实现：
    /// 在同一事务内完成会话校验、房间存在性判定与成员关系幂等写入。
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            // 事务边界：会话校验、房间存在性、成员关系写入需要同一提交语义。
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

            // 成员关系幂等写入：已是当前成员则不重复插入。
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

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        self.在运行时执行(async {
            let exists =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE session_id = $1")
                    .bind(会话标识)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            Ok(exists > 0)
        })
    }

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        self.在运行时执行(async {
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

    /// 拉取房间基线快照：用于首屏基线与补洞失败兜底。
    fn 拉取房间快照(
        &self, 房间标识: &str
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room =
                sqlx::query("SELECT room_id, latest_event_position FROM rooms WHERE room_id = $1")
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

    /// 提交“消息已创建”事务链：
    /// 锁房间 -> 写事件 -> 写消息 -> 推进房间事件锚点，四步缺一不可。
    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码> {
        self.在运行时执行(async {
            // 核心事务不变量：
            // 1) 锁定房间并计算 next_position
            // 2) 写 room_events
            // 3) 写 messages
            // 4) 推进 rooms.latest_event_position
            // 四步必须同事务提交，否则顺序语义会漂移。
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

            let session_row = sqlx::query(
                "SELECT id, display_name FROM sessions WHERE session_id = $1",
            )
            .bind(会话标识)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?
            .ok_or(contract::错误码::会话无效)?;
            let session_db_id: i64 = session_row.get("id");
            let sender_alias: String = session_row.get("display_name");

            let message_id = format!("{房间标识}-{next_position}");

            // 先落事件，再落消息：确保房间事件流锚点始终连续可追。
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
                发送者花名: sender_alias,
                文本: 文本.to_string(),
                事件位置: next_position,
            })
        })
    }
}
