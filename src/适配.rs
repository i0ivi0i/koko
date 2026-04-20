use std::{future::Future, io};

use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use uuid::Uuid;

use crate::{
    contract, domain,
    usecase::{self, 仓储端口},
    user_identity,
};

#[path = "媒体附件适配.rs"]
mod 媒体附件适配;
#[path = "房间阅读适配.rs"]
mod 房间阅读适配;
#[path = "消息事件适配.rs"]
mod 消息事件适配;

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

/// 上传会话授权写入请求只描述 Tus sidecar 所需的最小事实：
/// - attachment_id 仍是业务附件锚点；
/// - upload_session_id 是“一次上传生命周期”的运输锚点；
/// - upload_token 只属于上传会话，不再错误地复制到每一条 partial/final transport 上。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传会话授权写入请求 {
    pub 上传会话标识: String,
    pub 附件标识: String,
    pub 运输方式: String,
    pub 上传令牌: String,
    pub 令牌有效期秒数: i64,
}

/// 上传会话记录服务于 shell / hook 判断“这次 token 到底属于哪个 attachment/session”。
/// 注意：
/// 1. 这里仍然是 adapter 侧运输事实，不上浮为领域消息真相；
/// 2. 令牌有效性、会话是否已放弃，都只服务上传链收口，不服务房间成员或权限判断。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传会话记录 {
    pub 上传会话标识: String,
    pub 附件标识: String,
    pub 运输方式: String,
    pub 上传令牌: String,
    pub 令牌仍有效: bool,
    pub 废弃时间戳秒: Option<i64>,
}

/// 单条上传运输回执在 adapter 边界上的最小输入。
/// 把上传链八个字段收口成一个结构体，避免跨层函数长期维持高参数噪音。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传运输回执写入参数 {
    pub 上传会话标识: String,
    pub 附件标识: String,
    pub 运输方式: String,
    pub 运输角色: 媒体上传运输角色,
    pub concat_order: Option<i32>,
    pub transport_upload_id: String,
    pub storage_locator: String,
    pub byte_size: i64,
}

/// partial / final / single 只在 adapter 停留，用来翻译 Tus Concatenation 协议负载。
/// 业务层依然只认“transport finished != attachment ready”这一条稳定原则。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum 媒体上传运输角色 {
    单文件,
    分片,
    最终合并,
}

impl 媒体上传运输角色 {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::单文件 => "single",
            Self::分片 => "partial",
            Self::最终合并 => "final",
        }
    }

    pub(crate) fn from_db(value: &str) -> Result<Self, contract::错误码> {
        match value {
            "single" => Ok(Self::单文件),
            "partial" => Ok(Self::分片),
            "final" => Ok(Self::最终合并),
            _ => Err(contract::错误码::系统错误),
        }
    }
}

/// transport 记录只描述某一条 single / partial / final 上传事实。
/// 它不拥有 token，也不负责声明哪个 transport 才是业务可 complete 的 canonical final。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传运输记录 {
    pub 上传会话标识: String,
    pub 附件标识: String,
    pub 运输方式: String,
    pub 运输角色: 媒体上传运输角色,
    pub concat_order: Option<i32>,
    pub transport_upload_id: Option<String>,
    pub storage_locator: Option<String>,
    pub 字节大小: Option<i64>,
    pub 完成时间戳秒: Option<i64>,
    pub 废弃时间戳秒: Option<i64>,
}

/// 生成迁移窗口内仍需保留的兼容匿名身份短标识。
/// 约束：
/// 1. 它只是旧链路兼容缝，不再冒充内部真实主键；
/// 2. 真正的内部身份已经升级到 `anonymous_identities.identity_uuid`。
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

/// bootstrap 的共享契约现在只允许带回最小表面：
/// - 展示花名
/// - 会话锚点
///
/// 内部身份、主题键和迁移缝字段都留在持久化层，不再直接进入公共返回值。
async fn 查询引导结果_异步(
    pool: &PgPool,
    设备匿名凭证: &str,
) -> Result<Option<contract::匿名身份引导结果>, contract::错误码> {
    let existing = sqlx::query(
        "SELECT ai.id, ai.display_alias, s.session_id, ai.identity_uuid::text AS identity_uuid_text, ai.theme_key \
         FROM sessions s \
         JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
         WHERE s.device_anonymous_token = $1",
    )
    .bind(设备匿名凭证)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let Some(row) = existing else {
        return Ok(None);
    };

    let identity_db_id: i64 = row.get("id");
    let identity_uuid_text: Option<String> = row.get("identity_uuid_text");
    let theme_key: Option<String> = row.get("theme_key");
    if identity_uuid_text.is_none() || theme_key.is_none() {
        回填匿名身份影子字段_异步(pool, identity_db_id).await?;
    }

    Ok(Some(contract::匿名身份引导结果 {
        展示花名: row.get("display_alias"),
        会话标识: row.get("session_id"),
    }))
}

/// 存量匿名身份在迁移窗口里可能还缺 `identity_uuid/theme_key`；
/// 这里用幂等 UPDATE 把缺口补上，保证后续链路只有一处真实身份 owner。
async fn 回填匿名身份影子字段_异步(
    pool: &PgPool,
    identity_db_id: i64,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "UPDATE anonymous_identities \
         SET identity_uuid = COALESCE(identity_uuid, $1::uuid), \
             theme_key = COALESCE(theme_key, 'legacy') \
         WHERE id = $2",
    )
    .bind(user_identity::生成内部身份().to_string())
    .bind(identity_db_id)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

/// 只把 `device_anonymous_token` 唯一约束冲突视为 bootstrap 幂等竞态。
/// 发生这类冲突时必须回查既有记录，而不是再造第二条匿名身份。
fn 是设备匿名凭证幂等冲突(err: &sqlx::Error) -> bool {
    matches!(
        err,
        sqlx::Error::Database(db_err)
            if db_err.code().as_deref() == Some("23505")
                && db_err
                    .constraint()
                    .is_some_and(|name| name.contains("device_anonymous_token"))
    )
}

impl Pg仓储 {
    /// 读取当前会话对应的稳定匿名内部身份标识。
    async fn 查询会话所属匿名身份_异步(
        pool: &PgPool,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        sqlx::query_scalar(
            // 应用层从这一刻开始只消费内部 identity_uuid；
            // 旧 anonymous_identity_id 留在库里只是迁移缝，不能继续冒充身份真相。
            "SELECT COALESCE(ai.identity_uuid::text, ai.anonymous_identity_id) \
             FROM sessions s \
             JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
             WHERE s.session_id = $1",
        )
        .bind(会话标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)
    }

    fn 在运行时执行<T>(&self, future: impl Future<Output = T>) -> T {
        if let Some(rt) = &self.owned_runtime {
            rt.block_on(future)
        } else {
            self.handle.block_on(future)
        }
    }

    /// prepare 结束后要把“当前 attachment 的活跃上传会话”落到权威库里，
    /// 避免前端和 sidecar 各自凭感觉发明第二条会话真相。
    pub(crate) fn 写入媒体上传会话授权(
        &mut self,
        授权: &媒体上传会话授权写入请求,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::写入媒体上传会话授权(self, 授权)
    }

    /// hook 只靠上传令牌做 sidecar 鉴权，但 token 现在只属于上传会话。
    pub(crate) fn 根据上传令牌查询媒体上传会话(
        &self,
        上传令牌: &str,
    ) -> Result<Option<媒体上传会话记录>, contract::错误码> {
        媒体附件适配::根据上传令牌查询媒体上传会话(self, 上传令牌)
    }

    /// 查询当前活跃上传会话上 canonical 的 single/final transport 回执。
    /// complete 只认它，不认 partial。
    pub(crate) fn 查询附件当前最终运输记录(
        &self,
        附件标识: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        媒体附件适配::查询附件当前最终运输记录(self, 附件标识)
    }

    /// business abandon 先裁决业务真相，再由 shell 协调 transport 删除；
    /// 因此这里单独暴露“这条 upload_session 目前对应过哪些 upload id”，
    /// 让官方 termination 调用仍然站在 adapter 提供的运输事实上。
    pub(crate) fn 列出上传会话运输上传标识(
        &self,
        上传会话标识: &str,
    ) -> Result<Vec<String>, contract::错误码> {
        媒体附件适配::列出上传会话运输上传标识(self, 上传会话标识)
    }

    /// transport finished 只登记某条 single/partial/final 上传事实；
    /// prepared -> ready 仍由 complete 主链完成。
    pub(crate) fn 登记媒体上传运输回执(
        &mut self,
        参数: &媒体上传运输回执写入参数,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::登记媒体上传运输回执(self, 参数)
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

    pub fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间增量事件(self, 房间标识, 从位置开始)
    }

    /// 后台概览查询（只读）。
    pub fn 后台概览(&self) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::后台概览(self)
    }

    /// 后台房间列表查询（只读）。
    pub fn 后台房间列表(&self) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::后台房间列表(self)
    }

    /// 后台房间详情查询（只读）。
    pub fn 后台房间详情(
        &self,
        房间标识: &str,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::后台房间详情(self, 房间标识)
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
            if let Some(existing) = 查询引导结果_异步(&self.pool, 设备匿名凭证).await? {
                return Ok(existing);
            }

            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let anonymous_identity_id = 生成匿名身份标识();
            let internal_identity = user_identity::生成内部身份();
            let projection = user_identity::随机分配资料投影();
            let session_id = 生成会话标识();

            let identity_row = sqlx::query(
                "INSERT INTO anonymous_identities (anonymous_identity_id, identity_uuid, theme_key, display_alias) \
                 VALUES ($1, $2::uuid, $3, $4) \
                 RETURNING id",
            )
            .bind(&anonymous_identity_id)
            .bind(internal_identity.to_string())
            .bind(&projection.theme_key)
            .bind(&projection.display_alias)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let identity_db_id: i64 = identity_row.get("id");

            let session_insert = sqlx::query(
                // `sessions.display_name` 是历史表字段名；当前语义上它承载的是展示花名投影。
                "INSERT INTO sessions (session_id, display_name, anonymous_identity_id, device_anonymous_token) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(&session_id)
            .bind(&projection.display_alias)
            .bind(identity_db_id)
            .bind(设备匿名凭证)
            .execute(&mut *tx)
            .await;
            if let Err(err) = session_insert {
                if 是设备匿名凭证幂等冲突(&err) {
                    tx.rollback()
                        .await
                        .map_err(|_| contract::错误码::系统错误)?;
                    return 查询引导结果_异步(&self.pool, 设备匿名凭证)
                        .await?
                        .ok_or(contract::错误码::系统错误);
                }
                return Err(contract::错误码::系统错误);
            }

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::匿名身份引导结果 {
                展示花名: projection.display_alias,
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
        房间阅读适配::按短码进房或建房(self, 会话标识, 房间短码)
    }

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查会话存在(self, 会话标识)
    }

    /// 会话 -> 匿名内部身份的解析留在 adapter 查询，不把数据库主键暴露给应用层。
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        房间阅读适配::查询会话所属匿名身份(self, 会话标识)
    }

    /// 房间存在性检查只回答“有没有这个 room_id”。
    /// 这样应用层可以先区分 `room_not_found`，再决定成员资格分支。
    fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查房间存在(self, 房间标识)
    }

    /// 房间最新事件位置是顺序真相的一部分。
    /// 这里仅读取，不把它和恢复窗口或阅读推进策略混在一起。
    fn 查询房间最新事件位置(
        &self,
        房间标识: &str,
    ) -> Result<Option<i64>, contract::错误码> {
        房间阅读适配::查询房间最新事件位置(self, 房间标识)
    }

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        房间阅读适配::检查成员资格(self, 房间标识, 会话标识)
    }

    /// 统一消息用例通过这个只读端口拿附件事实，不直连数据库字段名。
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
        媒体附件适配::查询附件快照(self, 附件标识)
    }

    /// prepared 附件读取只暴露给上传链，不下放到其它业务入口。
    fn 查询待完成媒体附件(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::待完成媒体附件读取结果>, contract::错误码> {
        媒体附件适配::查询待完成媒体附件(self, 附件标识)
    }

    /// prepare 阶段先只落占位记录，不提前伪造 ready 元数据。
    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件准备请求,
    ) -> Result<usecase::媒体附件准备快照, contract::错误码> {
        媒体附件适配::创建预备媒体附件记录(self, 所属匿名身份标识, 附件)
    }

    fn 回滚预备媒体附件记录(&mut self, 附件标识: &str) -> Result<(), contract::错误码> {
        媒体附件适配::回滚预备媒体附件记录(self, 附件标识)
    }

    /// 媒体上传链的元数据落库入口。
    fn 创建媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件写入请求,
    ) -> Result<usecase::媒体附件快照, contract::错误码> {
        媒体附件适配::创建媒体附件记录(self, 所属匿名身份标识, 附件)
    }

    /// 用例层只通过这个端口写入 Phase 1 分发元数据，不绕过应用层去拼 SQL。
    fn 写入协作分发元数据(
        &mut self,
        请求: &usecase::协作分发元数据写入请求,
    ) -> Result<usecase::协作分发元数据快照, contract::错误码> {
        媒体附件适配::写入协作分发元数据(self, 请求)
    }

    fn 查询协作分发元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::协作分发元数据快照>, contract::错误码> {
        媒体附件适配::查询协作分发元数据(self, 附件标识)
    }

    fn 写入协作分发最近peer存活时间(
        &mut self,
        附件标识: &str,
        最近peer存活时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::写入协作分发最近peer存活时间(
            self,
            附件标识,
            最近peer存活时间戳秒,
        )
    }

    fn 查询协作分发torrent元信息(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::协作分发torrent元信息快照>, contract::错误码> {
        媒体附件适配::查询协作分发torrent元信息(self, 附件标识)
    }

    fn 写入协作分发torrent元信息(
        &mut self,
        请求: &usecase::协作分发torrent元信息写入请求,
    ) -> Result<usecase::协作分发torrent元信息快照, contract::错误码> {
        媒体附件适配::写入协作分发torrent元信息(self, 请求)
    }

    fn 写入流媒体清单元数据(
        &mut self,
        请求: &usecase::流媒体清单写入请求,
    ) -> Result<usecase::流媒体清单快照, contract::错误码> {
        媒体附件适配::写入流媒体清单元数据(self, 请求)
    }

    fn 查询流媒体清单元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::流媒体清单快照>, contract::错误码> {
        媒体附件适配::查询流媒体清单元数据(self, 附件标识)
    }

    fn 列出待清理流媒体清单(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<usecase::待清理流媒体清单>, contract::错误码> {
        媒体附件适配::列出待清理流媒体清单(self, 当前时间戳秒, 限制条数)
    }

    fn 标记流媒体清单已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::标记流媒体清单已删除(self, 附件标识, 删除时间戳秒)
    }

    /// 附件内容读取仍然走成员可见性，不单独再长一套 ACL。
    fn 查询附件可读内容(
        &self,
        附件标识: &str,
        会话标识: &str,
        变体: usecase::附件内容变体,
    ) -> Result<Option<usecase::附件内容读取结果>, contract::错误码> {
        媒体附件适配::查询附件可读内容(self, 附件标识, 会话标识, 变体)
    }

    fn 列出待清理媒体冷源(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<usecase::待清理媒体冷源>, contract::错误码> {
        媒体附件适配::列出待清理媒体冷源(self, 当前时间戳秒, 限制条数)
    }

    fn 标记媒体冷源已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::标记媒体冷源已删除(self, 附件标识, 删除时间戳秒)
    }

    fn 列出待清理媒体回退母本(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<usecase::待清理媒体回退母本>, contract::错误码> {
        媒体附件适配::列出待清理媒体回退母本(self, 当前时间戳秒, 限制条数)
    }

    fn 标记媒体回退母本已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::标记媒体回退母本已删除(self, 附件标识, 删除时间戳秒)
    }

    fn 标记媒体上传已放弃(
        &mut self,
        附件标识: &str,
        放弃时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::标记媒体上传已放弃(self, 附件标识, 放弃时间戳秒)
    }

    fn 列出待清理上传残留(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<usecase::待清理上传残留>, contract::错误码> {
        媒体附件适配::列出待清理上传残留(self, 当前时间戳秒, 限制条数)
    }

    fn 标记上传残留已清理(
        &mut self,
        上传会话标识: &str,
        清理原因: usecase::上传残留清理原因,
        清理时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        媒体附件适配::标记上传残留已清理(self, 上传会话标识, 清理原因, 清理时间戳秒)
    }

    /// 拉取当前身份在房间里的阅读锚点。
    /// 这里返回的是身份级事实，不是页面态或 socket 连接态。
    fn 查询房间阅读位置(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<Option<i64>, contract::错误码> {
        房间阅读适配::查询房间阅读位置(self, 房间标识, 会话标识)
    }

    /// 拉取房间恢复快照：当前由应用层先裁决已读/未读语义，再交给适配层按锚点拼装首屏。
    fn 拉取房间快照(
        &self,
        房间标识: &str,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间快照(self, 房间标识, 上次已读事件位置, 首条未读事件位置)
    }

    /// 拉取更早历史页：用于“当前最老消息之前再看一页”。
    /// 这里仍只做数据读取，不把成员资格规则塞进仓储层。
    fn 拉取房间历史页(
        &self,
        房间标识: &str,
        截止位置之前: i64,
        限制条数: i64,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间历史页(self, 房间标识, 截止位置之前, 限制条数)
    }

    /// 拉取房间增量事件：用于冷路径补洞与 realtime 订阅首帧补齐。
    /// 成员资格不在这里裁决，只保证位置语义和事件顺序稳定。
    fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间增量事件(self, 房间标识, 从位置开始)
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
        消息事件适配::创建消息事件(self, 房间标识, 客户端消息标识, 会话标识, 文本)
    }

    /// 统一消息主链把纯文本和附件消息都收口到同一个事务提交入口。
    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        消息事件适配::创建统一消息事件(
            self,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
    }

    /// 身份级阅读锚点写入：
    /// 1. 会话只用来解析出匿名内部身份；
    /// 2. 真正持久化主键是 `(anonymous_identity_id, room_id)`；
    /// 3. 写入只能单调前进，较早位置不会覆盖更靠后的已读事实。
    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), contract::错误码> {
        房间阅读适配::推进房间阅读位置(self, 房间标识, 会话标识, 已读到事件位置)
    }
}

impl usecase::Realtime仓储端口 for Pg仓储 {
    async fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查会话存在_异步(&self.pool, 会话标识).await
    }

    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        房间阅读适配::查询会话所属匿名身份_异步(&self.pool, 会话标识).await
    }

    async fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查房间存在_异步(&self.pool, 房间标识).await
    }

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        房间阅读适配::检查成员资格_异步(&self.pool, 房间标识, 会话标识).await
    }

    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间增量事件_异步(&self.pool, 房间标识, 从位置开始).await
    }

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
        媒体附件适配::查询附件快照_异步(&self.pool, 附件标识).await
    }

    async fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码> {
        消息事件适配::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            &[],
        )
        .await
    }

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        消息事件适配::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
        .await
    }
}
