use sqlx::{PgPool, Row, postgres::PgRow};

use crate::{contract, usecase};

use super::{
    Pg仓储, 媒体上传会话授权写入请求, 媒体上传会话记录, 媒体上传运输回执写入参数, 媒体上传运输角色,
    媒体上传运输记录,
};

// 媒体附件适配 owner 只负责回答三类问题：
// 1. 附件真相当前是什么状态；
// 2. 上传 sidecar 的运输事实写到了哪里；
// 3. ready 之后的协作分发与冷源退场元数据如何读写。
// 它不承载成员真相、消息成立真相，也不替 shell 做展示裁决。

/// 把数据库中的附件状态字符串压成用例可理解的稳定枚举。
/// 这里只有数据库状态翻译，不在 adapter 层追加“自动修正”之类的业务判断。
fn 解析附件状态(
    raw_status: &str,
) -> Result<usecase::附件状态读取结果, contract::错误码> {
    match raw_status {
        "prepared" => Ok(usecase::附件状态读取结果::已准备),
        "uploading" => Ok(usecase::附件状态读取结果::上传中),
        "processing" => Ok(usecase::附件状态读取结果::处理中),
        "ready" => Ok(usecase::附件状态读取结果::就绪),
        "failed" => Ok(usecase::附件状态读取结果::失败),
        "expired" | "canceled" | "abandoned" => Ok(usecase::附件状态读取结果::已过期),
        _ => Err(contract::错误码::系统错误),
    }
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
) -> Result<usecase::上传残留清理原因, contract::错误码> {
    match raw {
        "abandoned_session" => Ok(usecase::上传残留清理原因::已放弃会话),
        "finalized_partial" => Ok(usecase::上传残留清理原因::最终合并后的分片残留),
        "expired_unfinished" => Ok(usecase::上传残留清理原因::已过期未完成上传),
        _ => Err(contract::错误码::系统错误),
    }
}

/// 媒体 owner 在写 prepared/ready 附件时，需要先把应用层持有的内部身份反查成数据库主键。
/// 收口后只认 `identity_uuid`，不再把兼容旧串抬回应用层真相。
/// 这个反查只服务媒体链路，因此直接跟着媒体 owner 走，不把“查 owner id”升级成共享垃圾 helper。
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
/// 这样 `locator / 原图内容读取 / origin 描述` 都围绕同一条服务器退字节裁决工作，
/// 不会再出现“定位说该退场，但原图端点还在偷发 206”的双真相。
/// 所以这里直接暴露异步版本，避免再回到 `src/适配.rs` 偷走旧 SQL。
pub(super) async fn 查询附件快照_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
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
            "image" => usecase::附件种类读取结果::图片,
            "video" => usecase::附件种类读取结果::视频,
            "audio" => usecase::附件种类读取结果::语音,
            "gif" => usecase::附件种类读取结果::GIF,
            "file" => usecase::附件种类读取结果::文件,
            _ => return Err(contract::错误码::系统错误),
        };
        let status = 解析附件状态(row.get::<String, _>("status").as_str())?;
        Ok(usecase::附件读取结果 {
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
) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
    repo.在运行时执行(查询附件快照_异步(&repo.pool, 附件标识))
}

/// prepared 附件仍然是媒体 owner 真相的一部分。
/// complete 链路只允许从这里读取它，而不是自己拼表字段。
async fn 查询待完成媒体附件_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::待完成媒体附件读取结果>, contract::错误码> {
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
            "image" => usecase::媒体附件类型::图片,
            "video" => usecase::媒体附件类型::视频,
            _ => return Err(contract::错误码::系统错误),
        };
        Ok(usecase::待完成媒体附件读取结果 {
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
) -> Result<Option<usecase::待完成媒体附件读取结果>, contract::错误码> {
    repo.在运行时执行(查询待完成媒体附件_异步(&repo.pool, 附件标识))
}

/// prepare 只写占位，不越权提前制造 ready 事实。
async fn 创建预备媒体附件记录_异步(
    pool: &PgPool,
    所属匿名身份标识: &str,
    附件: &usecase::媒体附件准备请求,
) -> Result<usecase::媒体附件准备快照, contract::错误码> {
    let owner_db_id = 查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
    let kind = match 附件.种类 {
        usecase::媒体附件类型::图片 => "image",
        usecase::媒体附件类型::视频 => "video",
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

    Ok(usecase::媒体附件准备快照 {
        附件标识: 附件.附件标识.clone(),
        种类: 附件.种类.clone(),
        mime_type: 附件.mime_type.clone(),
        字节大小: 附件.字节大小,
        原始内容存储键: 附件.原始内容存储键.clone(),
        状态: usecase::附件状态读取结果::已准备,
    })
}

pub(super) fn 创建预备媒体附件记录(
    repo: &mut Pg仓储,
    所属匿名身份标识: &str,
    附件: &usecase::媒体附件准备请求,
) -> Result<usecase::媒体附件准备快照, contract::错误码> {
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
    附件: &usecase::媒体附件写入请求,
) -> Result<usecase::媒体附件快照, contract::错误码> {
    let owner_db_id = 查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
    let kind = match 附件.种类 {
        usecase::媒体附件类型::图片 => "image",
        usecase::媒体附件类型::视频 => "video",
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

    Ok(usecase::媒体附件快照 {
        附件标识: 附件.附件标识.clone(),
        种类: 附件.种类.clone(),
        mime_type: 附件.mime_type.clone(),
        字节大小: 附件.字节大小,
        宽: 附件.宽,
        高: 附件.高,
        允许缩略图: 附件.缩略图存储键.is_some(),
        状态: usecase::附件状态读取结果::就绪,
    })
}

pub(super) fn 创建媒体附件记录(
    repo: &mut Pg仓储,
    所属匿名身份标识: &str,
    附件: &usecase::媒体附件写入请求,
) -> Result<usecase::媒体附件快照, contract::错误码> {
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

fn 媒体附件类型转数据库值(种类: &usecase::媒体附件类型) -> &'static str {
    match 种类 {
        usecase::媒体附件类型::图片 => "image",
        usecase::媒体附件类型::视频 => "video",
    }
}

fn 行转可复用媒体资产(
    row: PgRow,
) -> Result<usecase::可复用媒体资产, contract::错误码> {
    let kind = match row.get::<String, _>("kind").as_str() {
        "image" => usecase::媒体附件类型::图片,
        "video" => usecase::媒体附件类型::视频,
        _ => return Err(contract::错误码::系统错误),
    };
    let width = row
        .get::<Option<i32>, _>("width")
        .ok_or(contract::错误码::系统错误)?;
    let height = row
        .get::<Option<i32>, _>("height")
        .ok_or(contract::错误码::系统错误)?;
    Ok(usecase::可复用媒体资产 {
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
    种类: usecase::媒体附件类型,
) -> Result<Option<usecase::可复用媒体资产>, contract::错误码> {
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
    种类: usecase::媒体附件类型,
) -> Result<Option<usecase::可复用媒体资产>, contract::错误码> {
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
    种类: usecase::媒体附件类型,
) -> Result<Option<usecase::可复用媒体资产>, contract::错误码> {
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
    种类: usecase::媒体附件类型,
) -> Result<Option<usecase::可复用媒体资产>, contract::错误码> {
    repo.在运行时执行(查询可转发媒体资产_异步(
        &repo.pool,
        会话标识,
        源附件标识,
        种类,
    ))
}

async fn 写入canonical媒体资产_异步(
    pool: &PgPool,
    请求: &usecase::Canonical媒体资产写入请求,
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
    请求: &usecase::Canonical媒体资产写入请求,
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

/// 分发元数据和 torrent/manifests 都是附件 ready 之后的派生持久化事实。
/// 它们继续围绕 attachment_id 收口，避免形成第二条“媒体分发主链”。
async fn 写入协作分发元数据_异步(
    pool: &PgPool,
    请求: &usecase::协作分发元数据写入请求,
) -> Result<usecase::协作分发元数据快照, contract::错误码> {
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
            (attachment_id, content_id, content_hash, swarm_id, web_seed_until) \
         VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5)) \
         ON CONFLICT (attachment_id) DO UPDATE SET \
            content_id = EXCLUDED.content_id, \
            content_hash = EXCLUDED.content_hash, \
            swarm_id = EXCLUDED.swarm_id, \
            web_seed_until = EXCLUDED.web_seed_until",
    )
    .bind(&请求.附件标识)
    .bind(&请求.content_id)
    .bind(&请求.content_hash)
    .bind(&请求.swarm_id)
    .bind(请求.web_seed_until秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(usecase::协作分发元数据快照 {
        附件标识: 请求.附件标识.clone(),
        content_id: 请求.content_id.clone(),
        content_hash: 请求.content_hash.clone(),
        swarm_id: 请求.swarm_id.clone(),
        web_seed_until秒: 请求.web_seed_until秒,
        最近片段peer存活时间戳秒: None,
        最近完整peer存活时间戳秒: None,
        最近后端强种子存活时间戳秒: None,
        torrent_info_hash: None,
    })
}

pub(super) fn 写入协作分发元数据(
    repo: &mut Pg仓储,
    请求: &usecase::协作分发元数据写入请求,
) -> Result<usecase::协作分发元数据快照, contract::错误码> {
    repo.在运行时执行(写入协作分发元数据_异步(&repo.pool, 请求))
}

async fn 查询协作分发元数据_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::协作分发元数据快照>, contract::错误码> {
    let row = sqlx::query(
        "SELECT dm.attachment_id,
                dm.content_id,
                dm.content_hash,
                dm.swarm_id,
                dm.torrent_info_hash,
                EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch,
                (
                    SELECT EXTRACT(EPOCH FROM MAX(sp.last_seen_at))::BIGINT
                    FROM swarm_peer_presence sp
                    WHERE sp.swarm_id = dm.swarm_id
                      AND sp.peer_kind = $2
                ) AS last_partial_peer_seen_epoch,
                (
                    SELECT EXTRACT(EPOCH FROM MAX(sp.last_seen_at))::BIGINT
                    FROM swarm_peer_presence sp
                    WHERE sp.swarm_id = dm.swarm_id
                      AND sp.peer_kind = $3
                ) AS last_complete_peer_seen_epoch,
                (
                    SELECT EXTRACT(EPOCH FROM MAX(sp.last_seen_at))::BIGINT
                    FROM swarm_peer_presence sp
                    WHERE sp.swarm_id = dm.swarm_id
                      AND sp.peer_kind = $4
                ) AS last_backend_strong_seed_seen_epoch
         FROM attachment_distribution_metadata dm
         WHERE dm.attachment_id = $1",
    )
    .bind(附件标识)
    .bind(usecase::协作分发存活类型片段peer)
    .bind(usecase::协作分发存活类型完整peer)
    .bind(usecase::协作分发存活类型后端强种子)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| usecase::协作分发元数据快照 {
        附件标识: row.get("attachment_id"),
        content_id: row.get("content_id"),
        content_hash: row.get("content_hash"),
        swarm_id: row.get("swarm_id"),
        web_seed_until秒: row.get("web_seed_until_epoch"),
        最近片段peer存活时间戳秒: row.get("last_partial_peer_seen_epoch"),
        最近完整peer存活时间戳秒: row.get("last_complete_peer_seen_epoch"),
        最近后端强种子存活时间戳秒: row.get("last_backend_strong_seed_seen_epoch"),
        torrent_info_hash: row.get("torrent_info_hash"),
    }))
}

pub(super) fn 查询协作分发元数据(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<usecase::协作分发元数据快照>, contract::错误码> {
    repo.在运行时执行(查询协作分发元数据_异步(&repo.pool, 附件标识))
}

/// 列出仍在强 seed 窗口的附件清单。
/// 这里必须收口到“ready + 未删 + 完整 torrent 元信息 + web_seed_until 未过期”的最小集合：
/// 1. 只有 `torrent_info_hash` 但没有 `torrent_bytes/piece_length` 的脏记录，不得继续进入做种对账；
/// 2. 否则 sidecar 会拿到无法解析的 torrent 地址，触发持续 400/重试噪音，掩盖真实在线种子信号；
/// 3. sidecar 启停调度仍由 shell/application 决策，不在 adapter 里直接发网络请求。
async fn 列出待做种协作分发项_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待做种协作分发项>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT a.attachment_id,
                s.session_id AS owner_session_id,
                dm.content_id,
                dm.content_hash,
                dm.swarm_id,
                EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch,
                dm.torrent_info_hash
         FROM attachments a
         JOIN attachment_distribution_metadata dm
           ON dm.attachment_id = a.attachment_id
         JOIN LATERAL (
            SELECT s2.session_id
            FROM sessions s2
            WHERE s2.anonymous_identity_id = a.owner_anonymous_identity_id
            ORDER BY s2.last_seen_at DESC, s2.created_at DESC
            LIMIT 1
         ) s ON TRUE
         WHERE a.status = 'ready'
           AND a.origin_deleted_at IS NULL
           AND dm.torrent_bytes IS NOT NULL
           AND dm.torrent_info_hash IS NOT NULL
           AND dm.piece_length_bytes IS NOT NULL
           AND dm.web_seed_until > TO_TIMESTAMP($1)
         ORDER BY dm.web_seed_until ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| usecase::待做种协作分发项 {
            附件标识: row.get("attachment_id"),
            会话标识: row.get("owner_session_id"),
            content_id: row.get("content_id"),
            content_hash: row.get("content_hash"),
            swarm_id: row.get("swarm_id"),
            web_seed_until秒: row.get("web_seed_until_epoch"),
            torrent_info_hash: row.get("torrent_info_hash"),
        })
        .collect())
}

pub(super) fn 列出待做种协作分发项(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待做种协作分发项>, contract::错误码> {
    repo.在运行时执行(列出待做种协作分发项_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

/// swarm 运行态存活写入走独立表：
/// 1. 主键按 `(swarm_id, session_id, peer_kind)` 去重，避免同一会话重复刷写膨胀；
/// 2. `attachment_id` 只保留最近来源，便于排查与删除清理，不作为可用性裁决锚点；
/// 3. `last_seen_at` 统一由后端时钟写入，避免前端各自发明在线真相。
async fn 写入协作分发swarm存活_异步(
    pool: &PgPool,
    请求: &usecase::协作分发swarm存活写入请求,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "INSERT INTO swarm_peer_presence \
            (swarm_id, session_id, attachment_id, peer_kind, last_seen_at) \
         VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5)) \
         ON CONFLICT (swarm_id, session_id, peer_kind) \
         DO UPDATE SET \
            attachment_id = EXCLUDED.attachment_id, \
            last_seen_at = EXCLUDED.last_seen_at",
    )
    .bind(&请求.swarm_id)
    .bind(&请求.会话标识)
    .bind(&请求.附件标识)
    .bind(&请求.存活类型)
    .bind(请求.最近peer存活时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 写入协作分发swarm存活(
    repo: &mut Pg仓储,
    请求: &usecase::协作分发swarm存活写入请求,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入协作分发swarm存活_异步(&repo.pool, 请求))
}

async fn 写入协作分发torrent元信息_异步(
    pool: &PgPool,
    请求: &usecase::协作分发torrent元信息写入请求,
) -> Result<usecase::协作分发torrent元信息快照, contract::错误码> {
    sqlx::query(
        "UPDATE attachment_distribution_metadata \
         SET torrent_bytes = $2, \
             torrent_info_hash = $3, \
             piece_length_bytes = $4 \
         WHERE attachment_id = $1",
    )
    .bind(&请求.附件标识)
    .bind(&请求.torrent_bytes)
    .bind(&请求.torrent_info_hash)
    .bind(请求.piece_length字节)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(usecase::协作分发torrent元信息快照 {
        附件标识: 请求.附件标识.clone(),
        torrent_bytes: 请求.torrent_bytes.clone(),
        torrent_info_hash: 请求.torrent_info_hash.clone(),
        piece_length字节: 请求.piece_length字节,
    })
}

pub(super) fn 写入协作分发torrent元信息(
    repo: &mut Pg仓储,
    请求: &usecase::协作分发torrent元信息写入请求,
) -> Result<usecase::协作分发torrent元信息快照, contract::错误码> {
    repo.在运行时执行(写入协作分发torrent元信息_异步(&repo.pool, 请求))
}

async fn 查询协作分发torrent元信息_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::协作分发torrent元信息快照>, contract::错误码> {
    let row = sqlx::query(
        "SELECT attachment_id, torrent_bytes, torrent_info_hash, piece_length_bytes \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1 \
           AND torrent_bytes IS NOT NULL \
           AND torrent_info_hash IS NOT NULL \
           AND piece_length_bytes IS NOT NULL",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| usecase::协作分发torrent元信息快照 {
        附件标识: row.get("attachment_id"),
        torrent_bytes: row.get("torrent_bytes"),
        torrent_info_hash: row.get("torrent_info_hash"),
        piece_length字节: row.get("piece_length_bytes"),
    }))
}

pub(super) fn 查询协作分发torrent元信息(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<usecase::协作分发torrent元信息快照>, contract::错误码> {
    repo.在运行时执行(查询协作分发torrent元信息_异步(
        &repo.pool,
        附件标识,
    ))
}

async fn 写入流媒体清单元数据_异步(
    pool: &PgPool,
    请求: &usecase::流媒体清单写入请求,
) -> Result<usecase::流媒体清单快照, contract::错误码> {
    sqlx::query(
        "INSERT INTO attachment_streaming_manifests \
            (attachment_id, hls_master_storage_key, dash_mpd_storage_key, streaming_expires_at, streaming_deleted_at) \
         VALUES ($1, $2, $3, TO_TIMESTAMP($4), TO_TIMESTAMP($5)) \
         ON CONFLICT (attachment_id) DO UPDATE SET \
            hls_master_storage_key = EXCLUDED.hls_master_storage_key, \
            dash_mpd_storage_key = EXCLUDED.dash_mpd_storage_key, \
            streaming_expires_at = EXCLUDED.streaming_expires_at, \
            streaming_deleted_at = EXCLUDED.streaming_deleted_at",
    )
    .bind(&请求.附件标识)
    .bind(&请求.hls主清单存储键)
    .bind(&请求.dash主清单存储键)
    .bind(请求.streaming到期时间戳秒)
    .bind(请求.streaming删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(usecase::流媒体清单快照 {
        附件标识: 请求.附件标识.clone(),
        hls主清单存储键: 请求.hls主清单存储键.clone(),
        dash主清单存储键: 请求.dash主清单存储键.clone(),
        streaming到期时间戳秒: Some(请求.streaming到期时间戳秒),
        streaming删除时间戳秒: 请求.streaming删除时间戳秒,
    })
}

pub(super) fn 写入流媒体清单元数据(
    repo: &mut Pg仓储,
    请求: &usecase::流媒体清单写入请求,
) -> Result<usecase::流媒体清单快照, contract::错误码> {
    repo.在运行时执行(写入流媒体清单元数据_异步(&repo.pool, 请求))
}

async fn 查询流媒体清单元数据_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::流媒体清单快照>, contract::错误码> {
    let row = sqlx::query(
        "SELECT attachment_id, hls_master_storage_key, dash_mpd_storage_key, \
                EXTRACT(EPOCH FROM streaming_expires_at)::BIGINT AS streaming_expires_at_epoch, \
                EXTRACT(EPOCH FROM streaming_deleted_at)::BIGINT AS streaming_deleted_at_epoch \
         FROM attachment_streaming_manifests \
         WHERE attachment_id = $1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| usecase::流媒体清单快照 {
        附件标识: row.get("attachment_id"),
        hls主清单存储键: row.get("hls_master_storage_key"),
        dash主清单存储键: row.get("dash_mpd_storage_key"),
        streaming到期时间戳秒: row.get("streaming_expires_at_epoch"),
        streaming删除时间戳秒: row.get("streaming_deleted_at_epoch"),
    }))
}

pub(super) fn 查询流媒体清单元数据(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<usecase::流媒体清单快照>, contract::错误码> {
    repo.在运行时执行(查询流媒体清单元数据_异步(&repo.pool, 附件标识))
}

/// 流媒体清理查询只回答“哪些服务端 manifest 已经过了冷备窗口”，
/// 不把 swarm metadata 或 peer 存活语义混进这张表。
async fn 列出待清理流媒体清单_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理流媒体清单>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT attachment_id, hls_master_storage_key, dash_mpd_storage_key \
         FROM attachment_streaming_manifests \
         WHERE streaming_expires_at IS NOT NULL \
           AND streaming_expires_at <= TO_TIMESTAMP($1) \
           AND streaming_deleted_at IS NULL \
         ORDER BY streaming_expires_at ASC \
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| usecase::待清理流媒体清单 {
            附件标识: row.get("attachment_id"),
            hls主清单存储键: row.get("hls_master_storage_key"),
            dash主清单存储键: row.get("dash_mpd_storage_key"),
        })
        .collect())
}

pub(super) fn 列出待清理流媒体清单(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理流媒体清单>, contract::错误码> {
    repo.在运行时执行(列出待清理流媒体清单_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记流媒体清单已删除_异步(
    pool: &PgPool,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachment_streaming_manifests
         SET streaming_deleted_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND streaming_deleted_at IS NULL",
    )
    .bind(附件标识)
    .bind(删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(super) fn 标记流媒体清单已删除(
    repo: &mut Pg仓储,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记流媒体清单已删除_异步(
        &repo.pool,
        附件标识,
        删除时间戳秒,
    ))
}

/// prepare 未提交附件允许 owner 自己预览，已经提交给消息主链的附件则继续按房间成员可见性放行。
/// 这里故意复用同一条 SQL 主链，避免 shell 再长一套 preview/full/origin 的鉴权分叉。
async fn 查询附件可读内容_异步(
    pool: &PgPool,
    附件标识: &str,
    会话标识: &str,
    变体: usecase::附件内容变体,
) -> Result<Option<usecase::附件内容读取结果>, contract::错误码> {
    let 变体标签 = match 变体 {
        usecase::附件内容变体::原图 => "origin_raw",
        usecase::附件内容变体::缩略图 => "preview",
        usecase::附件内容变体::完整图 => "full",
        usecase::附件内容变体::资产原图 => "asset_original",
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

    Ok(row.map(|row| usecase::附件内容读取结果 {
        mime_type: row.get("mime_type"),
        存储键: row.get("storage_key"),
    }))
}

pub(super) fn 查询附件可读内容(
    repo: &Pg仓储,
    附件标识: &str,
    会话标识: &str,
    变体: usecase::附件内容变体,
) -> Result<Option<usecase::附件内容读取结果>, contract::错误码> {
    repo.在运行时执行(查询附件可读内容_异步(
        &repo.pool,
        附件标识,
        会话标识,
        变体,
    ))
}

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

/// 冷源清理是媒体 owner 的“尾处理”，只回答谁到了 TTL、谁已经删掉。
/// 真正删对象仍由外壳层控制，避免 adapter 突然拥有对象存储副作用。
async fn 列出待清理媒体冷源_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理媒体冷源>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT attachment_id, storage_key
         FROM attachments
         WHERE status = 'ready'
           AND storage_key IS NOT NULL
           AND origin_expires_at IS NOT NULL
           AND origin_expires_at <= TO_TIMESTAMP($1)
           AND origin_deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1
               FROM attachment_canonical_asset_refs refs
               WHERE refs.attachment_id = attachments.attachment_id
           )
         ORDER BY origin_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| usecase::待清理媒体冷源 {
            附件标识: row.get("attachment_id"),
            原始内容存储键: row.get("storage_key"),
        })
        .collect())
}

pub(super) fn 列出待清理媒体冷源(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理媒体冷源>, contract::错误码> {
    repo.在运行时执行(列出待清理媒体冷源_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记媒体冷源已删除_异步(
    pool: &PgPool,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachments
         SET origin_deleted_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND origin_deleted_at IS NULL",
    )
    .bind(附件标识)
    .bind(删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(super) fn 标记媒体冷源已删除(
    repo: &mut Pg仓储,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记媒体冷源已删除_异步(
        &repo.pool,
        附件标识,
        删除时间戳秒,
    ))
}

async fn 列出待清理canonical媒体资产_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理Canonical媒体资产>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT content_hash, storage_key
         FROM canonical_media_assets
         WHERE origin_expires_at <= TO_TIMESTAMP($1)
           AND origin_deleted_at IS NULL
         ORDER BY origin_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| usecase::待清理Canonical媒体资产 {
            content_hash: row.get("content_hash"),
            存储键: row.get("storage_key"),
        })
        .collect())
}

pub(super) fn 列出待清理canonical媒体资产(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理Canonical媒体资产>, contract::错误码> {
    repo.在运行时执行(列出待清理canonical媒体资产_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记canonical媒体资产已删除_异步(
    pool: &PgPool,
    content_hash: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    let result = sqlx::query(
        "UPDATE canonical_media_assets
         SET origin_deleted_at = TO_TIMESTAMP($2),
             updated_at = NOW()
         WHERE content_hash = $1
           AND origin_deleted_at IS NULL",
    )
    .bind(content_hash)
    .bind(删除时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        tx.rollback()
            .await
            .map_err(|_| contract::错误码::系统错误)?;
        return Err(contract::错误码::附件不存在);
    }

    sqlx::query(
        "UPDATE attachments a
         SET origin_deleted_at = TO_TIMESTAMP($2)
         FROM attachment_canonical_asset_refs refs
         WHERE refs.attachment_id = a.attachment_id
           AND refs.content_hash = $1
           AND a.origin_deleted_at IS NULL",
    )
    .bind(content_hash)
    .bind(删除时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 标记canonical媒体资产已删除(
    repo: &mut Pg仓储,
    content_hash: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记canonical媒体资产已删除_异步(
        &repo.pool,
        content_hash,
        删除时间戳秒,
    ))
}

/// 视频 mezzanine 只是一层 24h 回退母本，因此清理查询必须单独挑 video + mezzanine_*。
async fn 列出待清理媒体回退母本_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理媒体回退母本>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT attachment_id, mezzanine_storage_key
         FROM attachments
         WHERE kind = 'video'
           AND status = 'ready'
           AND mezzanine_storage_key IS NOT NULL
           AND mezzanine_expires_at IS NOT NULL
           AND mezzanine_expires_at <= TO_TIMESTAMP($1)
           AND mezzanine_deleted_at IS NULL
         ORDER BY mezzanine_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| usecase::待清理媒体回退母本 {
            附件标识: row.get("attachment_id"),
            回退母本存储键: row.get("mezzanine_storage_key"),
        })
        .collect())
}

pub(super) fn 列出待清理媒体回退母本(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理媒体回退母本>, contract::错误码> {
    repo.在运行时执行(列出待清理媒体回退母本_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记媒体回退母本已删除_异步(
    pool: &PgPool,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachments
         SET mezzanine_deleted_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND mezzanine_deleted_at IS NULL",
    )
    .bind(附件标识)
    .bind(删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(super) fn 标记媒体回退母本已删除(
    repo: &mut Pg仓储,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记媒体回退母本已删除_异步(
        &repo.pool,
        附件标识,
        删除时间戳秒,
    ))
}

/// 上传残留清理查询继续只回答“哪些 locator 现在已经可以删”。
/// 真正的文件删除仍然留在 shell，避免 adapter 越权拥有文件系统副作用。
async fn 列出待清理上传残留_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待清理上传残留>, contract::错误码> {
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
            Ok(usecase::待清理上传残留 {
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
) -> Result<Vec<usecase::待清理上传残留>, contract::错误码> {
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
    清理原因: usecase::上传残留清理原因,
    清理时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    match 清理原因 {
        usecase::上传残留清理原因::已放弃会话 => {
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
        usecase::上传残留清理原因::最终合并后的分片残留 => {
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
        usecase::上传残留清理原因::已过期未完成上传 => {
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
    清理原因: usecase::上传残留清理原因,
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
