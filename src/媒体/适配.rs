use sqlx::{postgres::PgRow, PgPool, Row};

use crate::{media, shared::contract};

use super::{Pg媒体仓储, Pg仓储};

#[path = "适配/冷源清理.rs"]
mod 冷源清理;

pub(super) use 冷源清理::{
    列出待清理canonical媒体资产, 列出待清理媒体冷源, 列出待清理媒体回退母本,
    标记canonical媒体资产已删除, 标记媒体冷源已删除, 标记媒体回退母本已删除,
};

// 媒体附件适配只保留附件、canonical 资产、可读内容和冷源退场的数据库事实。
// 上传运输与协作分发已经下沉到各自适配 owner，避免这个文件重新变成总垃圾桶。

/// 把数据库中的附件状态字符串压成用例可理解的稳定枚举。
/// 这里只有数据库状态翻译，不在 adapter 层追加“自动修正”之类的业务判断。
fn 解析附件状态(
    raw_status: &str,
) -> Result<crate::media::模型::附件状态读取结果, contract::错误码> {
    match raw_status {
        "prepared" => Ok(crate::media::模型::附件状态读取结果::已准备),
        "uploading" => Ok(crate::media::模型::附件状态读取结果::上传中),
        "processing" => Ok(crate::media::模型::附件状态读取结果::处理中),
        "ready" => Ok(crate::media::模型::附件状态读取结果::就绪),
        "failed" => Ok(crate::media::模型::附件状态读取结果::失败),
        "expired" | "canceled" | "abandoned" => Ok(crate::media::模型::附件状态读取结果::已过期),
        _ => Err(contract::错误码::系统错误),
    }
}

/// 收口后只认 `identity_uuid`，不再把旧匿名短串抬回应用层真相。
/// 这个反查只服务媒体链路，因此直接跟着媒体 owner 走，不把“查 owner id”升级成共享工具桶。
async fn 查询匿名身份数据库主键_异步(
    pool: &PgPool,
    所属匿名身份标识: &str,
) -> Result<i64, contract::错误码> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id \
         FROM anonymous_identities \
         WHERE identity_uuid::text = $1",
    )
    .bind(所属匿名身份标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?
    .ok_or(contract::错误码::会话无效)
}

/// 统一消息用例和 realtime 查询都会拿这条权威附件快照。
/// 这里顺手把 app-facing 冷备窗口投影成单一真相：
/// 1. 已进入协作分发表的新主链附件优先认 `web_seed_until`；
/// 2. 没有分发表的历史附件才继续回退 `attachments.origin_expires_at`；
/// 3. `origin_deleted_at` 仍然只表达物理删除终态，优先级高于上面两种到期时间。
///
/// 这样 `locator / 原图内容读取 / origin 描述` 都围绕同一条服务器退字节裁决工作，
/// 不会再出现“定位说该退场，但原图端点还在偷发 206”的双真相。所以这里直接暴露异步版本，
/// 避免再回到 `src/适配.rs` 偷走旧 SQL。
pub(super) async fn 查询附件快照_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<crate::media::模型::附件读取结果>, contract::错误码> {
    let row = sqlx::query(
        "SELECT a.attachment_id,
                ai.identity_uuid::text AS owner_identity_text,
                a.kind,
                a.mime_type,
                a.status,
                a.width,
                a.height,
                a.thumbnail_storage_key IS NOT NULL AS has_thumbnail,
                a.asset_original_storage_key,
                a.full_storage_key,
                COALESCE(
                    EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT,
                    EXTRACT(EPOCH FROM a.origin_expires_at)::BIGINT
                ) AS origin_expires_at_epoch,
                EXTRACT(EPOCH FROM a.origin_deleted_at)::BIGINT AS origin_deleted_at_epoch \
         FROM attachments a \
         JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
         LEFT JOIN attachment_distribution_metadata dm
           ON dm.attachment_id = a.attachment_id \
         WHERE a.attachment_id = $1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    row.map(|row| {
        let kind = match row.get::<String, _>("kind").as_str() {
            "image" => crate::media::模型::附件种类读取结果::图片,
            "video" => crate::media::模型::附件种类读取结果::视频,
            "audio" => crate::media::模型::附件种类读取结果::语音,
            "gif" => crate::media::模型::附件种类读取结果::GIF,
            "file" => crate::media::模型::附件种类读取结果::文件,
            _ => return Err(contract::错误码::系统错误),
        };
        let status = 解析附件状态(row.get::<String, _>("status").as_str())?;
        Ok(crate::media::模型::附件读取结果 {
            附件标识: row.get("attachment_id"),
            所属匿名身份标识: row.get("owner_identity_text"),
            种类: kind,
            mime_type: row.get("mime_type"),
            状态: status,
            宽: row.get("width"),
            高: row.get("height"),
            允许缩略图: row.get("has_thumbnail"),
            资产原图存储键: row.get("asset_original_storage_key"),
            完整图存储键: row.get("full_storage_key"),
            原始冷源到期时间戳秒: row.get("origin_expires_at_epoch"),
            原始冷源删除时间戳秒: row.get("origin_deleted_at_epoch"),
        })
    })
    .transpose()
}

pub(super) fn 查询附件快照(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<crate::media::模型::附件读取结果>, contract::错误码> {
    repo.在运行时执行(查询附件快照_异步(&repo.pool, 附件标识))
}

/// 批量查询多条附件快照：一次 SQL 替代 N 次逐条查询。
/// SQL 与单条版 `查询附件快照_异步` 共用同一份字段列表和行解析逻辑，
/// 唯一差异是 WHERE 条件改用 `= ANY($1)` 并用 `fetch_all` 收集。
pub(super) async fn 批量查询附件快照_异步(
    pool: &PgPool,
    附件标识列表: &[String],
) -> Result<Vec<crate::media::模型::附件读取结果>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT a.attachment_id,
                ai.identity_uuid::text AS owner_identity_text,
                a.kind,
                a.mime_type,
                a.status,
                a.width,
                a.height,
                a.thumbnail_storage_key IS NOT NULL AS has_thumbnail,
                a.asset_original_storage_key,
                a.full_storage_key,
                COALESCE(
                    EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT,
                    EXTRACT(EPOCH FROM a.origin_expires_at)::BIGINT
                ) AS origin_expires_at_epoch,
                EXTRACT(EPOCH FROM a.origin_deleted_at)::BIGINT AS origin_deleted_at_epoch \
         FROM attachments a \
         JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
         LEFT JOIN attachment_distribution_metadata dm
           ON dm.attachment_id = a.attachment_id \
         WHERE a.attachment_id = ANY($1)",
    )
    .bind(附件标识列表)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    rows.into_iter()
        .map(|row| {
            let kind = match row.get::<String, _>("kind").as_str() {
                "image" => crate::media::模型::附件种类读取结果::图片,
                "video" => crate::media::模型::附件种类读取结果::视频,
                "audio" => crate::media::模型::附件种类读取结果::语音,
                "gif" => crate::media::模型::附件种类读取结果::GIF,
                "file" => crate::media::模型::附件种类读取结果::文件,
                _ => return Err(contract::错误码::系统错误),
            };
            let status = 解析附件状态(row.get::<String, _>("status").as_str())?;
            Ok(crate::media::模型::附件读取结果 {
                附件标识: row.get("attachment_id"),
                所属匿名身份标识: row.get("owner_identity_text"),
                种类: kind,
                mime_type: row.get("mime_type"),
                状态: status,
                宽: row.get("width"),
                高: row.get("height"),
                允许缩略图: row.get("has_thumbnail"),
                资产原图存储键: row.get("asset_original_storage_key"),
                完整图存储键: row.get("full_storage_key"),
                原始冷源到期时间戳秒: row.get("origin_expires_at_epoch"),
                原始冷源删除时间戳秒: row.get("origin_deleted_at_epoch"),
            })
        })
        .collect()
}

/// prepared 附件仍然是媒体 owner 真相的一部分。
/// complete 链路只允许从这里读取它，而不是自己拼表字段。
async fn 查询待完成媒体附件_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<crate::media::模型::待完成媒体附件读取结果>, contract::错误码> {
    let row = sqlx::query(
        "SELECT a.attachment_id,
                ai.identity_uuid::text AS owner_identity_text,
                a.current_upload_session_id,
                a.kind,
                a.mime_type,
                a.byte_size,
                a.storage_key,
                a.status \
         FROM attachments a \
         JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
         WHERE a.attachment_id = $1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    row.map(|row| {
        let kind = match row.get::<String, _>("kind").as_str() {
            "image" => crate::media::模型::媒体附件类型::图片,
            "video" => crate::media::模型::媒体附件类型::视频,
            _ => return Err(contract::错误码::系统错误),
        };
        Ok(crate::media::模型::待完成媒体附件读取结果 {
            附件标识: row.get("attachment_id"),
            所属匿名身份标识: row.get("owner_identity_text"),
            当前上传会话标识: row.get("current_upload_session_id"),
            种类: kind,
            mime_type: row.get("mime_type"),
            字节大小: row.get("byte_size"),
            原始内容存储键: row.get("storage_key"),
            状态: 解析附件状态(row.get::<String, _>("status").as_str())?,
        })
    })
    .transpose()
}

pub(super) fn 查询待完成媒体附件(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<crate::media::模型::待完成媒体附件读取结果>, contract::错误码> {
    repo.在运行时执行(查询待完成媒体附件_异步(&repo.pool, 附件标识))
}

/// prepare 只写占位，不越权提前制造 ready 事实。
async fn 创建预备媒体附件记录_异步(
    pool: &PgPool,
    所属匿名身份标识: &str,
    附件: &crate::media::模型::媒体附件准备请求,
) -> Result<crate::media::模型::媒体附件准备快照, contract::错误码> {
    let owner_db_id = 查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
    let kind = match 附件.种类 {
        crate::media::模型::媒体附件类型::图片 => "image",
        crate::media::模型::媒体附件类型::视频 => "video",
    };

    sqlx::query(
        "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, NULL, 'prepared')",
    )
    .bind(&附件.附件标识)
    .bind(owner_db_id)
    .bind(kind)
    .bind(&附件.mime_type)
    .bind(附件.字节大小)
    .bind(&附件.原始内容存储键)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(crate::media::模型::媒体附件准备快照 {
        附件标识: 附件.附件标识.clone(),
        种类: 附件.种类.clone(),
        mime_type: 附件.mime_type.clone(),
        字节大小: 附件.字节大小,
        原始内容存储键: 附件.原始内容存储键.clone(),
        状态: crate::media::模型::附件状态读取结果::已准备,
    })
}

pub(super) fn 创建预备媒体附件记录(
    repo: &mut Pg仓储,
    所属匿名身份标识: &str,
    附件: &crate::media::模型::媒体附件准备请求,
) -> Result<crate::media::模型::媒体附件准备快照, contract::错误码> {
    repo.在运行时执行(创建预备媒体附件记录_异步(
        &repo.pool,
        所属匿名身份标识,
        附件,
    ))
}

/// 只有 prepare 第二阶段失败时，才允许把没挂上 upload session 的 prepared 占位整条回滚。
/// 这里直接删 attachment 根事实，让 session/transport 继续靠级联保持干净。
async fn 回滚预备媒体附件记录_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<(), contract::错误码> {
    let delete_result = sqlx::query(
        "DELETE FROM attachments
         WHERE attachment_id = $1
           AND status = 'prepared'
           AND current_upload_session_id IS NULL
           AND NOT EXISTS (
               SELECT 1
               FROM attachment_upload_sessions
               WHERE attachment_upload_sessions.attachment_id = attachments.attachment_id
           )",
    )
    .bind(附件标识)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    if delete_result.rows_affected() == 0 {
        return Err(contract::错误码::系统错误);
    }
    Ok(())
}

pub(super) fn 回滚预备媒体附件记录(
    repo: &mut Pg仓储,
    附件标识: &str,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(回滚预备媒体附件记录_异步(&repo.pool, 附件标识))
}

/// ready 附件落库时，会把图片/视频真正需要长期保留的稳定渲染事实一并写好。
/// 这样消息主链以后只认附件真相，不再反问上传 sidecar。
async fn 创建媒体附件记录_异步(
    pool: &PgPool,
    所属匿名身份标识: &str,
    附件: &crate::media::模型::媒体附件写入请求,
) -> Result<crate::media::模型::媒体附件快照, contract::错误码> {
    let owner_db_id = 查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
    let kind = match 附件.种类 {
        crate::media::模型::媒体附件类型::图片 => "image",
        crate::media::模型::媒体附件类型::视频 => "video",
    };

    sqlx::query(
        "INSERT INTO attachments (
            attachment_id,
            owner_anonymous_identity_id,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            thumbnail_storage_key,
            asset_original_storage_key,
            full_storage_key,
            origin_expires_at,
            origin_deleted_at,
            mezzanine_storage_key,
            mezzanine_expires_at,
            mezzanine_deleted_at,
            status
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TO_TIMESTAMP($12), NULL, $13, TO_TIMESTAMP($14), NULL, 'ready'
         ) \
         ON CONFLICT (attachment_id) DO UPDATE SET \
             kind = EXCLUDED.kind, \
             mime_type = EXCLUDED.mime_type, \
             byte_size = EXCLUDED.byte_size, \
             width = EXCLUDED.width, \
             height = EXCLUDED.height, \
             storage_key = EXCLUDED.storage_key, \
             thumbnail_storage_key = EXCLUDED.thumbnail_storage_key, \
             asset_original_storage_key = EXCLUDED.asset_original_storage_key, \
             full_storage_key = EXCLUDED.full_storage_key, \
             origin_expires_at = EXCLUDED.origin_expires_at, \
             origin_deleted_at = NULL, \
             mezzanine_storage_key = EXCLUDED.mezzanine_storage_key, \
             mezzanine_expires_at = EXCLUDED.mezzanine_expires_at, \
             mezzanine_deleted_at = NULL, \
             status = 'ready' \
         WHERE attachments.owner_anonymous_identity_id = EXCLUDED.owner_anonymous_identity_id",
    )
    .bind(&附件.附件标识)
    .bind(owner_db_id)
    .bind(kind)
    .bind(&附件.mime_type)
    .bind(附件.字节大小)
    .bind(附件.宽)
    .bind(附件.高)
    .bind(&附件.原始内容存储键)
    .bind(&附件.缩略图存储键)
    .bind(&附件.资产原图存储键)
    .bind(&附件.完整图存储键)
    .bind(附件.原始冷源到期时间戳秒)
    .bind(&附件.回退母本存储键)
    .bind(附件.回退母本到期时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(crate::media::模型::媒体附件快照 {
        附件标识: 附件.附件标识.clone(),
        种类: 附件.种类.clone(),
        mime_type: 附件.mime_type.clone(),
        字节大小: 附件.字节大小,
        宽: 附件.宽,
        高: 附件.高,
        允许缩略图: 附件.缩略图存储键.is_some(),
        状态: crate::media::模型::附件状态读取结果::就绪,
    })
}

pub(super) fn 创建媒体附件记录(
    repo: &mut Pg仓储,
    所属匿名身份标识: &str,
    附件: &crate::media::模型::媒体附件写入请求,
) -> Result<crate::media::模型::媒体附件快照, contract::错误码> {
    repo.在运行时执行(创建媒体附件记录_异步(
        &repo.pool,
        所属匿名身份标识,
        附件,
    ))
}

async fn 记录附件source_hash_异步(
    pool: &PgPool,
    附件标识: &str,
    source_hash: &str,
    source_byte_size: i64,
    source_file_name: Option<&str>,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "INSERT INTO attachment_source_hashes
            (attachment_id, source_hash, source_byte_size, source_file_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (attachment_id) DO UPDATE SET
            source_hash = EXCLUDED.source_hash,
            source_byte_size = EXCLUDED.source_byte_size,
            source_file_name = EXCLUDED.source_file_name",
    )
    .bind(附件标识)
    .bind(source_hash)
    .bind(source_byte_size)
    .bind(source_file_name)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 记录附件source_hash(
    repo: &mut Pg仓储,
    附件标识: &str,
    source_hash: &str,
    source_byte_size: i64,
    source_file_name: Option<&str>,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(记录附件source_hash_异步(
        &repo.pool,
        附件标识,
        source_hash,
        source_byte_size,
        source_file_name,
    ))
}

fn 媒体附件类型转数据库值(
    种类: &crate::media::模型::媒体附件类型
) -> &'static str {
    match 种类 {
        crate::media::模型::媒体附件类型::图片 => "image",
        crate::media::模型::媒体附件类型::视频 => "video",
    }
}
fn 行转可复用媒体资产(
    row: PgRow,
) -> Result<crate::media::模型::可复用媒体资产, contract::错误码> {
    let kind = match row.get::<String, _>("kind").as_str() {
        "image" => crate::media::模型::媒体附件类型::图片,
        "video" => crate::media::模型::媒体附件类型::视频,
        _ => return Err(contract::错误码::系统错误),
    };
    let width = row
        .get::<Option<i32>, _>("width")
        .ok_or(contract::错误码::系统错误)?;
    let height = row
        .get::<Option<i32>, _>("height")
        .ok_or(contract::错误码::系统错误)?;
    Ok(crate::media::模型::可复用媒体资产 {
        content_hash: row.get("content_hash"),
        种类: kind,
        mime_type: row.get("mime_type"),
        字节大小: row.get("byte_size"),
        宽: width,
        高: height,
        存储键: row.get("storage_key"),
        torrent_bytes: row.get("torrent_bytes"),
        torrent_info_hash: row.get("torrent_info_hash"),
        piece_length字节: row.get("piece_length_bytes"),
        web_seed_until秒: row.get("web_seed_until_epoch"),
        origin_expires_at秒: row.get("origin_expires_at_epoch"),
    })
}

async fn 查询可复用source_hash媒体资产_异步(
    pool: &PgPool,
    会话标识: &str,
    _目标房间标识: &str,
    当前匿名身份标识: &str,
    source_hash: &str,
    source_byte_size: i64,
    种类: crate::media::模型::媒体附件类型,
) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
    let kind = 媒体附件类型转数据库值(&种类);
    let row = sqlx::query(
        "SELECT
            cma.content_hash,
            cma.kind,
            cma.mime_type,
            cma.byte_size,
            cma.width,
            cma.height,
            cma.storage_key,
            cma.torrent_bytes,
            cma.torrent_info_hash,
            cma.piece_length_bytes,
            EXTRACT(EPOCH FROM cma.web_seed_until)::BIGINT AS web_seed_until_epoch,
            EXTRACT(EPOCH FROM cma.origin_expires_at)::BIGINT AS origin_expires_at_epoch
         FROM attachments a
         JOIN anonymous_identities owner_ai ON owner_ai.id = a.owner_anonymous_identity_id
         JOIN attachment_source_hashes ash ON ash.attachment_id = a.attachment_id
         JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
         JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
         WHERE ash.source_hash = $1
           AND ash.source_byte_size = $2
           AND a.kind = $3
           AND cma.kind = $3
           AND a.status = 'ready'
           AND a.origin_deleted_at IS NULL
           AND cma.origin_deleted_at IS NULL
           AND (
               owner_ai.identity_uuid::text = $4
               OR EXISTS (
                   SELECT 1
                     FROM message_attachment_refs mar
                     JOIN messages m ON m.message_id = mar.message_id
                     JOIN room_members rm ON rm.room_id = m.room_id AND rm.left_at IS NULL
                     JOIN sessions viewer_s ON viewer_s.id = rm.session_id
                    WHERE mar.attachment_id = a.id
                      AND viewer_s.session_id = $5
               )
           )
         ORDER BY a.created_at DESC
          LIMIT 1",
    )
    .bind(source_hash)
    .bind(source_byte_size)
    .bind(kind)
    .bind(当前匿名身份标识)
    .bind(会话标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    row.map(行转可复用媒体资产).transpose()
}

pub(super) fn 查询可复用source_hash媒体资产(
    repo: &Pg仓储,
    会话标识: &str,
    目标房间标识: &str,
    当前匿名身份标识: &str,
    source_hash: &str,
    source_byte_size: i64,
    种类: crate::media::模型::媒体附件类型,
) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
    repo.在运行时执行(查询可复用source_hash媒体资产_异步(
        &repo.pool,
        会话标识,
        目标房间标识,
        当前匿名身份标识,
        source_hash,
        source_byte_size,
        种类,
    ))
}

async fn 查询可转发媒体资产_异步(
    pool: &PgPool,
    会话标识: &str,
    源附件标识: &str,
    种类: crate::media::模型::媒体附件类型,
) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
    let kind = 媒体附件类型转数据库值(&种类);
    let row = sqlx::query(
        "SELECT
            cma.content_hash,
            cma.kind,
            cma.mime_type,
            cma.byte_size,
            cma.width,
            cma.height,
            cma.storage_key,
            cma.torrent_bytes,
            cma.torrent_info_hash,
            cma.piece_length_bytes,
            EXTRACT(EPOCH FROM cma.web_seed_until)::BIGINT AS web_seed_until_epoch,
            EXTRACT(EPOCH FROM cma.origin_expires_at)::BIGINT AS origin_expires_at_epoch
         FROM attachments a
         JOIN message_attachment_refs mar ON mar.attachment_id = a.id
         JOIN messages m ON m.message_id = mar.message_id
         JOIN room_members rm ON rm.room_id = m.room_id AND rm.left_at IS NULL
         JOIN sessions viewer_s ON viewer_s.id = rm.session_id
         JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
         JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
         WHERE viewer_s.session_id = $1
           AND a.attachment_id = $2
           AND a.kind = $3
           AND cma.kind = $3
           AND a.status = 'ready'
           AND a.origin_deleted_at IS NULL
           AND cma.origin_deleted_at IS NULL
         LIMIT 1",
    )
    .bind(会话标识)
    .bind(源附件标识)
    .bind(kind)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    row.map(行转可复用媒体资产).transpose()
}

pub(super) fn 查询可转发媒体资产(
    repo: &Pg仓储,
    会话标识: &str,
    源附件标识: &str,
    种类: crate::media::模型::媒体附件类型,
) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
    repo.在运行时执行(查询可转发媒体资产_异步(
        &repo.pool,
        会话标识,
        源附件标识,
        种类,
    ))
}

async fn 写入canonical媒体资产_异步(
    pool: &PgPool,
    请求: &crate::media::模型::Canonical媒体资产写入请求,
) -> Result<(), contract::错误码> {
    let kind = 媒体附件类型转数据库值(&请求.种类);
    sqlx::query(
        "INSERT INTO canonical_media_assets (
            content_hash,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            torrent_bytes,
            torrent_info_hash,
            piece_length_bytes,
            web_seed_until,
            origin_expires_at
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TO_TIMESTAMP($11), TO_TIMESTAMP($12)
         )
         ON CONFLICT (content_hash) DO UPDATE SET
            -- 已删除资产只有在 fresh complete 真正重新上传字节时才允许恢复；
            -- source_hash 命中路径不会调用这里，因此不会变成“命中即续租 24 小时”的漏洞。
            origin_deleted_at = CASE
                WHEN canonical_media_assets.origin_deleted_at IS NOT NULL THEN NULL
                ELSE canonical_media_assets.origin_deleted_at
            END,
            origin_expires_at = CASE
                WHEN canonical_media_assets.origin_deleted_at IS NOT NULL THEN EXCLUDED.origin_expires_at
                ELSE canonical_media_assets.origin_expires_at
            END,
            web_seed_until = CASE
                WHEN canonical_media_assets.origin_deleted_at IS NOT NULL THEN EXCLUDED.web_seed_until
                ELSE canonical_media_assets.web_seed_until
            END,
            updated_at = NOW()",
    )
    .bind(&请求.content_hash)
    .bind(kind)
    .bind(&请求.mime_type)
    .bind(请求.字节大小)
    .bind(请求.宽)
    .bind(请求.高)
    .bind(&请求.存储键)
    .bind(&请求.torrent_bytes)
    .bind(&请求.torrent_info_hash)
    .bind(请求.piece_length字节)
    .bind(请求.web_seed_until秒)
    .bind(请求.origin_expires_at秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 写入canonical媒体资产(
    repo: &mut Pg仓储,
    请求: &crate::media::模型::Canonical媒体资产写入请求,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入canonical媒体资产_异步(&repo.pool, 请求))
}

async fn 绑定附件canonical媒体资产_异步(
    pool: &PgPool,
    附件标识: &str,
    content_hash: &str,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "INSERT INTO attachment_canonical_asset_refs (attachment_id, content_hash)
         VALUES ($1, $2)
         ON CONFLICT (attachment_id) DO UPDATE SET
            content_hash = EXCLUDED.content_hash",
    )
    .bind(附件标识)
    .bind(content_hash)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 绑定附件canonical媒体资产(
    repo: &mut Pg仓储,
    附件标识: &str,
    content_hash: &str,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(绑定附件canonical媒体资产_异步(
        &repo.pool,
        附件标识,
        content_hash,
    ))
}

/// prepare 未提交附件允许 owner 自己预览，已经提交给消息主链的附件则继续按房间成员可见性放行。
/// 这里故意复用同一条 SQL 主链，避免 shell 再长一套 preview/full/origin 的鉴权分叉。
async fn 查询附件可读内容_异步(
    pool: &PgPool,
    附件标识: &str,
    会话标识: &str,
    变体: crate::media::模型::附件内容变体,
) -> Result<Option<crate::media::模型::附件内容读取结果>, contract::错误码> {
    let 变体标签 = match 变体 {
        crate::media::模型::附件内容变体::原图 => "origin_raw",
        crate::media::模型::附件内容变体::缩略图 => "preview",
        crate::media::模型::附件内容变体::完整图 => "full",
        crate::media::模型::附件内容变体::资产原图 => "asset_original",
    };
    let owner_identity = Pg仓储::查询会话所属匿名身份_异步(pool, 会话标识).await?;
    let row = sqlx::query(
        "SELECT storage_key, mime_type \
         FROM ( \
            SELECT \
                CASE \
                    WHEN $3 = 'preview' AND a.thumbnail_storage_key IS NOT NULL THEN a.thumbnail_storage_key \
                    WHEN $3 = 'full' AND a.full_storage_key IS NOT NULL THEN a.full_storage_key \
                    WHEN $3 = 'asset_original' AND a.asset_original_storage_key IS NOT NULL THEN a.asset_original_storage_key \
                    ELSE a.storage_key \
                END AS storage_key, \
                CASE \
                    WHEN $3 = 'preview' AND a.thumbnail_storage_key IS NOT NULL THEN 'image/png' \
                    WHEN $3 = 'full' AND a.full_storage_key IS NOT NULL THEN 'image/webp' \
                    ELSE a.mime_type \
                END AS mime_type, \
                0 AS priority, \
                NULL::TIMESTAMPTZ AS created_at \
            FROM attachments a \
            JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
            WHERE a.attachment_id = $1 \
              AND a.committed_at IS NULL \
              AND ai.identity_uuid::text = $2 \
            UNION ALL \
            SELECT \
                CASE \
                    WHEN $3 = 'preview' AND a.thumbnail_storage_key IS NOT NULL THEN a.thumbnail_storage_key \
                    WHEN $3 = 'full' AND a.full_storage_key IS NOT NULL THEN a.full_storage_key \
                    WHEN $3 = 'asset_original' AND a.asset_original_storage_key IS NOT NULL THEN a.asset_original_storage_key \
                    ELSE a.storage_key \
                END AS storage_key, \
                CASE \
                    WHEN $3 = 'preview' AND a.thumbnail_storage_key IS NOT NULL THEN 'image/png' \
                    WHEN $3 = 'full' AND a.full_storage_key IS NOT NULL THEN 'image/webp' \
                    ELSE a.mime_type \
                END AS mime_type, \
                1 AS priority, \
                m.created_at AS created_at \
            FROM attachments a \
            JOIN message_attachment_refs mar ON mar.attachment_id = a.id \
            JOIN messages m ON m.message_id = mar.message_id \
            JOIN room_members rm ON rm.room_id = m.room_id AND rm.left_at IS NULL \
            JOIN sessions s ON s.id = rm.session_id \
            WHERE a.attachment_id = $1 AND s.session_id = $4 \
         ) readable \
         ORDER BY priority ASC, created_at DESC NULLS LAST \
         LIMIT 1",
    )
    .bind(附件标识)
    .bind(owner_identity)
    .bind(变体标签)
    .bind(会话标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| crate::media::模型::附件内容读取结果 {
        mime_type: row.get("mime_type"),
        存储键: row.get("storage_key"),
    }))
}

pub(super) fn 查询附件可读内容(
    repo: &Pg仓储,
    附件标识: &str,
    会话标识: &str,
    变体: crate::media::模型::附件内容变体,
) -> Result<Option<crate::media::模型::附件内容读取结果>, contract::错误码> {
    repo.在运行时执行(查询附件可读内容_异步(
        &repo.pool,
        附件标识,
        会话标识,
        变体,
    ))
}

/// 媒体 owner 的持久化端口收口到媒体适配文件。
/// 共享基座不再继续托管附件、上传、协作分发和清理链的具体 impl。
impl media::application::媒体仓储端口 for Pg媒体仓储 {
    fn 查询待完成媒体附件(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::待完成媒体附件读取结果>, contract::错误码> {
        查询待完成媒体附件(&self.repo, 附件标识)
    }

    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &crate::media::模型::媒体附件准备请求,
    ) -> Result<crate::media::模型::媒体附件准备快照, contract::错误码> {
        创建预备媒体附件记录(&mut self.repo, 所属匿名身份标识, 附件)
    }

    fn 回滚预备媒体附件记录(
        &mut self,
        附件标识: &str,
    ) -> Result<(), contract::错误码> {
        回滚预备媒体附件记录(&mut self.repo, 附件标识)
    }

    fn 创建媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &crate::media::模型::媒体附件写入请求,
    ) -> Result<crate::media::模型::媒体附件快照, contract::错误码> {
        创建媒体附件记录(&mut self.repo, 所属匿名身份标识, 附件)
    }

    fn 记录附件source_hash(
        &mut self,
        附件标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        source_file_name: Option<&str>,
    ) -> Result<(), contract::错误码> {
        记录附件source_hash(
            &mut self.repo,
            附件标识,
            source_hash,
            source_byte_size,
            source_file_name,
        )
    }

    fn 查询可复用source_hash媒体资产(
        &self,
        会话标识: &str,
        目标房间标识: &str,
        当前匿名身份标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        种类: crate::media::模型::媒体附件类型,
    ) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
        查询可复用source_hash媒体资产(
            &self.repo,
            会话标识,
            目标房间标识,
            当前匿名身份标识,
            source_hash,
            source_byte_size,
            种类,
        )
    }

    fn 查询可转发媒体资产(
        &self,
        会话标识: &str,
        源附件标识: &str,
        种类: crate::media::模型::媒体附件类型,
    ) -> Result<Option<crate::media::模型::可复用媒体资产>, contract::错误码> {
        查询可转发媒体资产(&self.repo, 会话标识, 源附件标识, 种类)
    }

    fn 写入canonical媒体资产(
        &mut self,
        请求: &crate::media::模型::Canonical媒体资产写入请求,
    ) -> Result<(), contract::错误码> {
        写入canonical媒体资产(&mut self.repo, 请求)
    }

    fn 绑定附件canonical媒体资产(
        &mut self,
        附件标识: &str,
        content_hash: &str,
    ) -> Result<(), contract::错误码> {
        绑定附件canonical媒体资产(&mut self.repo, 附件标识, content_hash)
    }

    fn 写入协作分发元数据(
        &mut self,
        请求: &crate::media::模型::协作分发元数据写入请求,
    ) -> Result<crate::media::模型::协作分发元数据快照, contract::错误码> {
        super::媒体协作分发适配::写入协作分发元数据(&mut self.repo, 请求)
    }

    fn 查询协作分发元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::协作分发元数据快照>, contract::错误码> {
        super::媒体协作分发适配::查询协作分发元数据(&self.repo, 附件标识)
    }

    fn 列出待做种协作分发项(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<crate::media::模型::待做种协作分发项>, contract::错误码> {
        super::媒体协作分发适配::列出待做种协作分发项(&self.repo, 当前时间戳秒, 限制条数)
    }

    fn 写入协作分发swarm存活(
        &mut self,
        请求: &crate::media::模型::协作分发swarm存活写入请求,
    ) -> Result<(), contract::错误码> {
        super::媒体协作分发适配::写入协作分发swarm存活(&mut self.repo, 请求)
    }

    fn 查询协作分发torrent元信息(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::协作分发torrent元信息快照>, contract::错误码> {
        super::媒体协作分发适配::查询协作分发torrent元信息(&self.repo, 附件标识)
    }

    fn 写入协作分发torrent元信息(
        &mut self,
        请求: &crate::media::模型::协作分发torrent元信息写入请求,
    ) -> Result<crate::media::模型::协作分发torrent元信息快照, contract::错误码> {
        super::媒体协作分发适配::写入协作分发torrent元信息(&mut self.repo, 请求)
    }

    fn 查询附件可读内容(
        &self,
        附件标识: &str,
        会话标识: &str,
        变体: crate::media::模型::附件内容变体,
    ) -> Result<Option<crate::media::模型::附件内容读取结果>, contract::错误码> {
        查询附件可读内容(&self.repo, 附件标识, 会话标识, 变体)
    }

    fn 列出待清理媒体冷源(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<crate::media::模型::待清理媒体冷源>, contract::错误码> {
        列出待清理媒体冷源(&self.repo, 当前时间戳秒, 限制条数)
    }

    fn 标记媒体冷源已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        标记媒体冷源已删除(&mut self.repo, 附件标识, 删除时间戳秒)
    }

    fn 列出待清理canonical媒体资产(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<crate::media::模型::待清理Canonical媒体资产>, contract::错误码> {
        列出待清理canonical媒体资产(&self.repo, 当前时间戳秒, 限制条数)
    }

    fn 标记canonical媒体资产已删除(
        &mut self,
        content_hash: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        标记canonical媒体资产已删除(&mut self.repo, content_hash, 删除时间戳秒)
    }

    fn 列出待清理媒体回退母本(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<crate::media::模型::待清理媒体回退母本>, contract::错误码> {
        列出待清理媒体回退母本(&self.repo, 当前时间戳秒, 限制条数)
    }

    fn 标记媒体回退母本已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        标记媒体回退母本已删除(&mut self.repo, 附件标识, 删除时间戳秒)
    }

    fn 标记媒体上传已放弃(
        &mut self,
        附件标识: &str,
        放弃时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        super::媒体上传适配::标记媒体上传已放弃(&mut self.repo, 附件标识, 放弃时间戳秒)
    }

    fn 列出待清理上传残留(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<crate::media::模型::待清理上传残留>, contract::错误码> {
        super::媒体上传适配::列出待清理上传残留(&self.repo, 当前时间戳秒, 限制条数)
    }

    fn 标记上传残留已清理(
        &mut self,
        上传会话标识: &str,
        清理原因: crate::media::模型::上传残留清理原因,
        清理时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        super::媒体上传适配::标记上传残留已清理(
            &mut self.repo,
            上传会话标识,
            清理原因,
            清理时间戳秒,
        )
    }
}
