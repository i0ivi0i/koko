use sqlx::{postgres::PgRow, PgPool, Row};

use crate::shared::contract;

use super::Pg仓储;

// 上传运输适配只负责 Tus/upload session/transport/residue 的数据库事实。
// 附件是否 ready、消息是否成立和成员是否可见，仍由各自 application/domain owner 裁决。

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
/// 上传会话读取既要服务 `prepare/complete`，也要服务 Tus hook token 鉴权。
/// 这里统一行映射，避免 adapter 各处再手搓“token 属于谁”的第二套真相。
fn 行转媒体上传会话记录(row: PgRow) -> 媒体上传会话记录 {
    媒体上传会话记录 {
        上传会话标识: row.get("upload_session_id"),
        附件标识: row.get("attachment_id"),
        运输方式: row.get("transport_kind"),
        上传令牌: row.get("upload_token"),
        令牌仍有效: row.get("token_is_active"),
        废弃时间戳秒: row.get("abandoned_at_epoch"),
    }
}

/// transport 记录在 complete / cleanup 两条路径都会读。
/// 把 `role/order/finished` 的翻译都收口在这里，避免每个调用方自己猜 partial/final 语义。
fn 行转媒体上传运输记录(
    row: PgRow,
) -> Result<媒体上传运输记录, contract::错误码> {
    Ok(媒体上传运输记录 {
        上传会话标识: row.get("upload_session_id"),
        附件标识: row.get("attachment_id"),
        运输方式: row.get("transport_kind"),
        运输角色: 媒体上传运输角色::from_db(
            row.get::<String, _>("transport_role").as_str(),
        )?,
        concat_order: row.get("concat_order"),
        transport_upload_id: row.get("transport_upload_id"),
        storage_locator: row.get("storage_locator"),
        字节大小: row.get("byte_size"),
        完成时间戳秒: row.get("finished_at_epoch"),
        废弃时间戳秒: row.get("abandoned_at_epoch"),
    })
}

fn 解析上传残留清理原因(
    raw: &str,
) -> Result<crate::media::模型::上传残留清理原因, contract::错误码> {
    match raw {
        "abandoned_session" => Ok(crate::media::模型::上传残留清理原因::已放弃会话),
        "finalized_partial" => Ok(crate::media::模型::上传残留清理原因::最终合并后的分片残留),
        "expired_unfinished" => Ok(crate::media::模型::上传残留清理原因::已过期未完成上传),
        _ => Err(contract::错误码::系统错误),
    }
}

/// 媒体 owner 在写 prepared/ready 附件时，需要先把应用层持有的内部身份反查成数据库主键。
async fn 写入媒体上传会话授权_异步(
    pool: &PgPool,
    授权: &媒体上传会话授权写入请求,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    sqlx::query(
        "INSERT INTO attachment_upload_sessions \
            (upload_session_id, attachment_id, transport_kind, upload_token, token_expires_at, abandoned_at) \
         VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 second'), NULL) \
         ON CONFLICT (upload_session_id) DO UPDATE SET \
            transport_kind = EXCLUDED.transport_kind, \
            upload_token = EXCLUDED.upload_token, \
            token_expires_at = EXCLUDED.token_expires_at, \
            abandoned_at = NULL",
    )
    .bind(&授权.上传会话标识)
    .bind(&授权.附件标识)
    .bind(&授权.运输方式)
    .bind(&授权.上传令牌)
    .bind(授权.令牌有效期秒数)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    sqlx::query(
        "UPDATE attachments \
         SET current_upload_session_id = $2 \
         WHERE attachment_id = $1",
    )
    .bind(&授权.附件标识)
    .bind(&授权.上传会话标识)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 写入媒体上传会话授权(
    repo: &mut Pg仓储,
    授权: &媒体上传会话授权写入请求,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入媒体上传会话授权_异步(&repo.pool, 授权))
}

async fn 根据上传令牌查询媒体上传会话_异步(
    pool: &PgPool,
    上传令牌: &str,
) -> Result<Option<媒体上传会话记录>, contract::错误码> {
    let row = sqlx::query(
        "SELECT \
            upload_session_id, \
            attachment_id, \
            transport_kind, \
            upload_token, \
            token_expires_at > NOW() AS token_is_active, \
            EXTRACT(EPOCH FROM abandoned_at)::BIGINT AS abandoned_at_epoch \
         FROM attachment_upload_sessions \
         WHERE upload_token = $1",
    )
    .bind(上传令牌)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(行转媒体上传会话记录))
}

pub(super) fn 根据上传令牌查询媒体上传会话(
    repo: &Pg仓储,
    上传令牌: &str,
) -> Result<Option<媒体上传会话记录>, contract::错误码> {
    repo.在运行时执行(根据上传令牌查询媒体上传会话_异步(
        &repo.pool,
        上传令牌,
    ))
}

async fn 查询附件当前最终运输记录_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    let row = sqlx::query(
        "SELECT \
            t.upload_session_id, \
            t.attachment_id, \
            t.transport_kind, \
            t.transport_role, \
            t.concat_order, \
            EXTRACT(EPOCH FROM COALESCE(t.abandoned_at, s.abandoned_at))::BIGINT AS abandoned_at_epoch, \
            t.transport_upload_id, \
            t.storage_locator, \
            t.byte_size, \
            EXTRACT(EPOCH FROM t.finished_at)::BIGINT AS finished_at_epoch \
         FROM attachments a \
         JOIN attachment_upload_sessions s ON s.upload_session_id = a.current_upload_session_id \
         JOIN attachment_upload_transports t ON t.upload_session_id = s.upload_session_id \
         WHERE a.attachment_id = $1 \
           AND t.transport_role IN ('single', 'final') \
         ORDER BY CASE t.transport_role WHEN 'final' THEN 0 ELSE 1 END, t.finished_at DESC NULLS LAST \
         LIMIT 1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    row.map(行转媒体上传运输记录).transpose()
}

pub(super) fn 查询附件当前最终运输记录(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    repo.在运行时执行(查询附件当前最终运输记录_异步(
        &repo.pool,
        附件标识,
    ))
}

/// abandon 想协调官方 termination 时，需要先知道“当前 upload_session 下有哪些 upload id 还活过”。
/// 这里只回传去重后的 transport upload id，不在 adapter 层直接发 DELETE。
async fn 列出上传会话运输上传标识_异步(
    pool: &PgPool,
    上传会话标识: &str,
) -> Result<Vec<String>, contract::错误码> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT transport_upload_id
         FROM attachment_upload_transports
         WHERE upload_session_id = $1
           AND transport_upload_id IS NOT NULL
           AND transport_upload_id <> ''
         ORDER BY transport_upload_id ASC",
    )
    .bind(上传会话标识)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(rows)
}

pub(super) fn 列出上传会话运输上传标识(
    repo: &Pg仓储,
    上传会话标识: &str,
) -> Result<Vec<String>, contract::错误码> {
    repo.在运行时执行(列出上传会话运输上传标识_异步(
        &repo.pool,
        上传会话标识,
    ))
}

/// 运输回执只登记 transport finished 事实，不在这里偷偷把附件升级成 ready。
/// 注意现在的主键已经换成“上传会话 + transport 角色/上传资源”，而不是 attachment 自己。
async fn 登记媒体上传运输回执_异步(
    pool: &PgPool,
    参数: &媒体上传运输回执写入参数,
) -> Result<(), contract::错误码> {
    /*
     * 这里必须把 `ON CONFLICT` 的谓词写全：
     * - `transport_upload_id` 现在靠“非空时唯一”的 partial unique index 兜住幂等；
     * - PostgreSQL 不会从裸 `ON CONFLICT (transport_upload_id)` 自动推导这个 partial index；
     * - 如果不写 `WHERE transport_upload_id IS NOT NULL`，happy path 也会直接炸成 system_error。
     */
    sqlx::query(
        "INSERT INTO attachment_upload_transports \
            (attachment_id, upload_session_id, transport_kind, transport_role, concat_order, abandoned_at, transport_upload_id, storage_locator, byte_size, finished_at) \
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, NOW()) \
         ON CONFLICT (transport_upload_id) WHERE transport_upload_id IS NOT NULL DO UPDATE SET \
            storage_locator = EXCLUDED.storage_locator, \
            byte_size = EXCLUDED.byte_size, \
            finished_at = EXCLUDED.finished_at, \
            abandoned_at = NULL",
    )
    .bind(参数.附件标识.as_str())
    .bind(参数.上传会话标识.as_str())
    .bind(参数.运输方式.as_str())
    .bind(参数.运输角色.as_str())
    .bind(参数.concat_order)
    .bind(参数.transport_upload_id.as_str())
    .bind(参数.storage_locator.as_str())
    .bind(参数.byte_size)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(())
}

pub(super) fn 登记媒体上传运输回执(
    repo: &mut Pg仓储,
    参数: &媒体上传运输回执写入参数,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(登记媒体上传运输回执_异步(&repo.pool, 参数))
}
/// 上传残留清理查询继续只回答“哪些 locator 现在已经可以删”。
/// 真正的文件删除仍然留在 shell，避免 adapter 越权拥有文件系统副作用。
async fn 列出待清理上传残留_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<crate::media::模型::待清理上传残留>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT
            t.attachment_id,
            t.upload_session_id,
            t.storage_locator,
            CASE
                WHEN s.abandoned_at IS NOT NULL THEN 'abandoned_session'
                WHEN t.transport_role = 'partial'
                     AND EXISTS (
                        SELECT 1
                        FROM attachment_upload_transports tf
                        WHERE tf.upload_session_id = t.upload_session_id
                          AND tf.transport_role = 'final'
                          AND tf.finished_at IS NOT NULL
                          AND tf.abandoned_at IS NULL
                     ) THEN 'finalized_partial'
                WHEN s.token_expires_at <= TO_TIMESTAMP($1)
                     AND a.current_upload_session_id = s.upload_session_id
                     AND a.status IN ('prepared', 'uploading', 'processing', 'failed')
                     AND NOT EXISTS (
                        SELECT 1
                        FROM attachment_upload_transports tf
                        WHERE tf.upload_session_id = t.upload_session_id
                          AND tf.transport_role IN ('single', 'final')
                          AND tf.finished_at IS NOT NULL
                          AND tf.abandoned_at IS NULL
                     ) THEN 'expired_unfinished'
                ELSE NULL
            END AS cleanup_reason
         FROM attachment_upload_sessions s
         JOIN attachments a ON a.attachment_id = s.attachment_id
         JOIN attachment_upload_transports t ON t.upload_session_id = s.upload_session_id
         WHERE t.storage_locator IS NOT NULL
           AND (
                s.abandoned_at IS NOT NULL
                OR (
                    t.transport_role = 'partial'
                    AND EXISTS (
                        SELECT 1
                        FROM attachment_upload_transports tf
                        WHERE tf.upload_session_id = t.upload_session_id
                          AND tf.transport_role = 'final'
                          AND tf.finished_at IS NOT NULL
                          AND tf.abandoned_at IS NULL
                    )
                )
                OR (
                    s.token_expires_at <= TO_TIMESTAMP($1)
                    AND a.current_upload_session_id = s.upload_session_id
                    AND a.status IN ('prepared', 'uploading', 'processing', 'failed')
                    AND NOT EXISTS (
                        SELECT 1
                        FROM attachment_upload_transports tf
                        WHERE tf.upload_session_id = t.upload_session_id
                          AND tf.transport_role IN ('single', 'final')
                          AND tf.finished_at IS NOT NULL
                          AND tf.abandoned_at IS NULL
                    )
                )
           )
         ORDER BY COALESCE(s.abandoned_at, s.token_expires_at, t.finished_at, t.created_at) ASC, t.id ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    rows.into_iter()
        .map(|row| {
            let raw_reason: Option<String> = row.get("cleanup_reason");
            let storage_locator: Option<String> = row.get("storage_locator");
            let Some(raw_reason) = raw_reason else {
                return Err(contract::错误码::系统错误);
            };
            let Some(storage_locator) = storage_locator else {
                return Err(contract::错误码::系统错误);
            };
            Ok(crate::media::模型::待清理上传残留 {
                附件标识: row.get("attachment_id"),
                上传会话标识: row.get("upload_session_id"),
                临时文件定位: storage_locator,
                清理原因: 解析上传残留清理原因(raw_reason.as_str())?,
            })
        })
        .collect()
}

pub(super) fn 列出待清理上传残留(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<crate::media::模型::待清理上传残留>, contract::错误码> {
    repo.在运行时执行(列出待清理上传残留_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

/// 文件删完之后，adapter 只负责把“这些 locator 已经退场”回写到数据库。
/// 这里按 cleanup reason 收口不同的状态推进，避免 shell 自己拼 UPDATE。
async fn 标记上传残留已清理_异步(
    pool: &PgPool,
    上传会话标识: &str,
    清理原因: crate::media::模型::上传残留清理原因,
    清理时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    match 清理原因 {
        crate::media::模型::上传残留清理原因::已放弃会话 => {
            sqlx::query(
                "UPDATE attachment_upload_transports
                 SET storage_locator = NULL
                 WHERE upload_session_id = $1
                   AND storage_locator IS NOT NULL",
            )
            .bind(上传会话标识)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
        }
        crate::media::模型::上传残留清理原因::最终合并后的分片残留 => {
            sqlx::query(
                "UPDATE attachment_upload_transports
                 SET storage_locator = NULL
                 WHERE upload_session_id = $1
                   AND transport_role = 'partial'
                   AND storage_locator IS NOT NULL",
            )
            .bind(上传会话标识)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
        }
        crate::media::模型::上传残留清理原因::已过期未完成上传 => {
            sqlx::query(
                "UPDATE attachment_upload_transports
                 SET storage_locator = NULL
                 WHERE upload_session_id = $1
                   AND storage_locator IS NOT NULL",
            )
            .bind(上传会话标识)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            sqlx::query(
                "UPDATE attachments
                 SET status = 'expired',
                     current_upload_session_id = NULL
                 WHERE current_upload_session_id = $1
                   AND status <> 'ready'",
            )
            .bind(上传会话标识)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            sqlx::query(
                "UPDATE attachment_upload_sessions
                 SET abandoned_at = COALESCE(abandoned_at, TO_TIMESTAMP($2))
                 WHERE upload_session_id = $1",
            )
            .bind(上传会话标识)
            .bind(清理时间戳秒)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
        }
    }
    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 标记上传残留已清理(
    repo: &mut Pg仓储,
    上传会话标识: &str,
    清理原因: crate::media::模型::上传残留清理原因,
    清理时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记上传残留已清理_异步(
        &repo.pool,
        上传会话标识,
        清理原因,
        清理时间戳秒,
    ))
}

/// 放弃旧上传必须同时污染附件与 transport：
/// 1. 附件状态显式切到 abandoned，complete 不再允许继续推进；
/// 2. 当前 upload session 与它已经落库的 transport 事实都要一起留下 abandoned_at；
/// 3. 这样 restart 之后，旧 token、旧 post-finish、旧 complete 都只能读到“这轮上传已死”的同一真相。
async fn 标记媒体上传已放弃_异步(
    pool: &PgPool,
    附件标识: &str,
    放弃时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    let attachment_result = sqlx::query(
        "UPDATE attachments
         SET status = 'abandoned',
             abandoned_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND abandoned_at IS NULL",
    )
    .bind(附件标识)
    .bind(放弃时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    if attachment_result.rows_affected() == 0 {
        let existing_status = sqlx::query_scalar::<_, Option<String>>(
            "SELECT status FROM attachments WHERE attachment_id = $1",
        )
        .bind(附件标识)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| contract::错误码::系统错误)?
        .flatten();
        return match existing_status.as_deref() {
            Some("abandoned") => {
                tx.rollback().await.ok();
                Ok(())
            }
            Some(_) => Err(contract::错误码::附件不存在),
            None => Err(contract::错误码::附件不存在),
        };
    }
    sqlx::query(
        "UPDATE attachment_upload_sessions
         SET abandoned_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND abandoned_at IS NULL",
    )
    .bind(附件标识)
    .bind(放弃时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    sqlx::query(
        "UPDATE attachment_upload_transports
         SET abandoned_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND abandoned_at IS NULL",
    )
    .bind(附件标识)
    .bind(放弃时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 标记媒体上传已放弃(
    repo: &mut Pg仓储,
    附件标识: &str,
    放弃时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记媒体上传已放弃_异步(
        &repo.pool,
        附件标识,
        放弃时间戳秒,
    ))
}
