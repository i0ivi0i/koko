use std::{future::Future, io, sync::Arc};

use sqlx::{PgPool, Row};

use crate::shared::contract;

#[path = "../媒体/上传/适配.rs"]
mod 媒体上传适配;
#[path = "../媒体/协作分发/适配.rs"]
mod 媒体协作分发适配;
#[path = "../媒体/适配.rs"]
mod 媒体附件适配;
#[path = "../房间/适配.rs"]
mod 房间阅读适配;
#[path = "../消息/适配.rs"]
mod 消息事件适配;
#[path = "../身份/适配.rs"]
mod 身份适配;
#[path = "../实时/适配.rs"]
mod 实时适配;
pub(crate) use 媒体上传适配::{
    媒体上传会话授权写入请求, 媒体上传会话记录, 媒体上传运输回执写入参数, 媒体上传运输角色,
    媒体上传运输记录,
};

/// PostgreSQL 共享基座只保留连接池、运行时和共享应用口。
///
/// 维护者边界提醒：
/// 1. 这里可以做 SQL、事务、索引命中相关优化。
/// 2. 这里不可以改“谁能发/谁是成员/消息是否成立”等业务真相。
/// 3. 业务真相必须在领域+用例决定，适配层只负责把结果准确落库/读库。
#[derive(Clone)]
pub struct Pg仓储 {
    handle: tokio::runtime::Handle,
    owned_runtime: Option<Arc<tokio::runtime::Runtime>>,
    pool: PgPool,
}
/// 媒体子域专属 PostgreSQL outbound adapter。
/// 它复用同一份 pool/runtime，但不再把媒体端口直接挂回共享仓储上。
pub struct Pg媒体仓储 {
    repo: Pg仓储,
}
/// realtime 热路径专属 PostgreSQL outbound adapter。
/// 这样 socket 热链和共享冷路径就不会继续共用一个总仓储壳。
pub struct PgRealtime仓储 {
    repo: Pg仓储,
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
            "SELECT ai.identity_uuid::text \
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
        媒体上传适配::写入媒体上传会话授权(self, 授权)
    }

    /// hook 只靠上传令牌做 sidecar 鉴权，但 token 现在只属于上传会话。
    pub(crate) fn 根据上传令牌查询媒体上传会话(
        &self,
        上传令牌: &str,
    ) -> Result<Option<媒体上传会话记录>, contract::错误码> {
        媒体上传适配::根据上传令牌查询媒体上传会话(self, 上传令牌)
    }

    /// 查询当前活跃上传会话上 canonical 的 single/final transport 回执。
    /// complete 只认它，不认 partial。
    pub(crate) fn 查询附件当前最终运输记录(
        &self,
        附件标识: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        媒体上传适配::查询附件当前最终运输记录(self, 附件标识)
    }

    /// business abandon 先裁决业务真相，再由 shell 协调 transport 删除；
    /// 因此这里单独暴露“这条 upload_session 目前对应过哪些 upload id”，
    /// 让官方 termination 调用仍然站在 adapter 提供的运输事实上。
    pub(crate) fn 列出上传会话运输上传标识(
        &self,
        上传会话标识: &str,
    ) -> Result<Vec<String>, contract::错误码> {
        媒体上传适配::列出上传会话运输上传标识(self, 上传会话标识)
    }

    /// transport finished 只登记某条 single/partial/final 上传事实；
    /// prepared -> ready 仍由 complete 主链完成。
    pub(crate) fn 登记媒体上传运输回执(
        &mut self,
        参数: &媒体上传运输回执写入参数,
    ) -> Result<(), contract::错误码> {
        媒体上传适配::登记媒体上传运输回执(self, 参数)
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
        let database_pool = crate::assembly::读取数据库连接池配置()?;
        let pool = rt
            .block_on(async {
                // 旧同步入口仍复用同一套应用池配置，避免测试/后台路径长期背着第二套连接真相。
                tokio::time::timeout(
                    database_pool.connect_timeout(),
                    database_pool.应用连接池选项().connect(database_url),
                )
                .await
            })
            .map_err(|_| io::Error::other("连接数据库超时"))?
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
            owned_runtime: Some(Arc::new(rt)),
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

    /// 共享基座显式拆出媒体专属仓储：
    /// 1. 复用同一份 pool/runtime；
    /// 2. 只改变“对外暴露哪个 bounded context 的 port”；
    /// 3. 防止 `Pg仓储` 再继续挂满所有业务端口。
    pub fn 媒体仓储(&self) -> Pg媒体仓储 {
        Pg媒体仓储 { repo: self.clone() }
    }

    /// realtime 热路径单独拿自己的 outbound adapter，
    /// 避免消息广播链和冷路径读写继续共用一个 concrete type。
    pub fn 实时仓储(&self) -> PgRealtime仓储 {
        PgRealtime仓储 { repo: self.clone() }
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
