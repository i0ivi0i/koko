use sqlx::{postgres::PgRow, PgPool, Row};

use crate::{contract, usecase};

use super::{Pg仓储, 媒体上传运输授权写入请求, 媒体上传运输记录};

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
        "expired" | "canceled" => Ok(usecase::附件状态读取结果::已过期),
        _ => Err(contract::错误码::系统错误),
    }
}

/// 运输记录在两条查询路径里都要做同一套行映射。
/// 把它收口在 owner 内，避免 `attachment_id/upload_token` 两个入口各手搓一遍。
fn 行转媒体上传运输记录(row: PgRow) -> 媒体上传运输记录 {
    媒体上传运输记录 {
        附件标识: row.get("attachment_id"),
        运输方式: row.get("transport_kind"),
        上传令牌: row.get("upload_token"),
        令牌仍有效: row.get("token_is_active"),
        transport_upload_id: row.get("transport_upload_id"),
        storage_locator: row.get("storage_locator"),
        字节大小: row.get("byte_size"),
        完成时间戳秒: row.get("finished_at_epoch"),
    }
}

/// 媒体 owner 在写 prepared/ready 附件时，需要先把应用层持有的内部身份反查成数据库主键。
/// 迁移窗口里优先吃 `identity_uuid`，只在存量还没补齐时回落兼容旧串。
/// 这个反查只服务媒体链路，因此直接跟着媒体 owner 走，不把“查 owner id”升级成共享垃圾 helper。
async fn 查询匿名身份数据库主键_异步(
    pool: &PgPool,
    所属匿名身份标识: &str,
) -> Result<i64, contract::错误码> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id \
         FROM anonymous_identities \
         WHERE COALESCE(identity_uuid::text, anonymous_identity_id) = $1",
    )
    .bind(所属匿名身份标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?
    .ok_or(contract::错误码::会话无效)
}

/// 统一消息用例和 realtime 查询都会拿这条权威附件快照。
/// 所以这里直接暴露异步版本，避免再回到 `src/适配.rs` 偷走旧 SQL。
pub(super) async fn 查询附件快照_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
    let row = sqlx::query(
        "SELECT a.attachment_id,
                COALESCE(ai.identity_uuid::text, ai.anonymous_identity_id) AS owner_identity_text,
                a.kind,
                a.mime_type,
                a.status,
                a.width,
                a.height,
                a.thumbnail_storage_key IS NOT NULL AS has_thumbnail,
                a.asset_original_storage_key,
                a.full_storage_key,
                EXTRACT(EPOCH FROM a.origin_expires_at)::BIGINT AS origin_expires_at_epoch,
                EXTRACT(EPOCH FROM a.origin_deleted_at)::BIGINT AS origin_deleted_at_epoch \
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
                COALESCE(ai.identity_uuid::text, ai.anonymous_identity_id) AS owner_identity_text,
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
            status
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TO_TIMESTAMP($12), NULL, 'ready'
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
        最近peer存活时间戳秒: None,
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
        "SELECT attachment_id, content_id, content_hash, swarm_id, torrent_info_hash, \
                EXTRACT(EPOCH FROM web_seed_until)::BIGINT AS web_seed_until_epoch, \
                EXTRACT(EPOCH FROM last_peer_seen_at)::BIGINT AS last_peer_seen_epoch \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| usecase::协作分发元数据快照 {
        附件标识: row.get("attachment_id"),
        content_id: row.get("content_id"),
        content_hash: row.get("content_hash"),
        swarm_id: row.get("swarm_id"),
        web_seed_until秒: row.get("web_seed_until_epoch"),
        最近peer存活时间戳秒: row.get("last_peer_seen_epoch"),
        torrent_info_hash: row.get("torrent_info_hash"),
    }))
}

pub(super) fn 查询协作分发元数据(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<usecase::协作分发元数据快照>, contract::错误码> {
    repo.在运行时执行(查询协作分发元数据_异步(&repo.pool, 附件标识))
}

async fn 写入协作分发最近peer存活时间_异步(
    pool: &PgPool,
    附件标识: &str,
    最近peer存活时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachment_distribution_metadata \
         SET last_peer_seen_at = TO_TIMESTAMP($2) \
         WHERE attachment_id = $1",
    )
    .bind(附件标识)
    .bind(最近peer存活时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(super) fn 写入协作分发最近peer存活时间(
    repo: &mut Pg仓储,
    附件标识: &str,
    最近peer存活时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入协作分发最近peer存活时间_异步(
        &repo.pool,
        附件标识,
        最近peer存活时间戳秒,
    ))
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
            (attachment_id, hls_master_storage_key, dash_mpd_storage_key) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (attachment_id) DO UPDATE SET \
            hls_master_storage_key = EXCLUDED.hls_master_storage_key, \
            dash_mpd_storage_key = EXCLUDED.dash_mpd_storage_key",
    )
    .bind(&请求.附件标识)
    .bind(&请求.hls主清单存储键)
    .bind(&请求.dash主清单存储键)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(usecase::流媒体清单快照 {
        附件标识: 请求.附件标识.clone(),
        hls主清单存储键: 请求.hls主清单存储键.clone(),
        dash主清单存储键: 请求.dash主清单存储键.clone(),
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
        "SELECT attachment_id, hls_master_storage_key, dash_mpd_storage_key \
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
    }))
}

pub(super) fn 查询流媒体清单元数据(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<usecase::流媒体清单快照>, contract::错误码> {
    repo.在运行时执行(查询流媒体清单元数据_异步(&repo.pool, 附件标识))
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
              AND COALESCE(ai.identity_uuid::text, ai.anonymous_identity_id) = $2 \
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

async fn 写入媒体上传运输授权_异步(
    pool: &PgPool,
    授权: &媒体上传运输授权写入请求,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "INSERT INTO attachment_upload_transports \
            (attachment_id, transport_kind, upload_token, token_expires_at, transport_upload_id, storage_locator, byte_size, finished_at) \
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'), NULL, NULL, $5, NULL) \
         ON CONFLICT (attachment_id) DO UPDATE SET \
            transport_kind = EXCLUDED.transport_kind, \
            upload_token = EXCLUDED.upload_token, \
            token_expires_at = EXCLUDED.token_expires_at, \
            transport_upload_id = NULL, \
            storage_locator = NULL, \
            byte_size = EXCLUDED.byte_size, \
            finished_at = NULL",
    )
    .bind(&授权.附件标识)
    .bind(&授权.运输方式)
    .bind(&授权.上传令牌)
    .bind(授权.令牌有效期秒数)
    .bind(授权.字节大小)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(())
}

pub(super) fn 写入媒体上传运输授权(
    repo: &mut Pg仓储,
    授权: &媒体上传运输授权写入请求,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入媒体上传运输授权_异步(&repo.pool, 授权))
}

async fn 查询媒体上传运输记录_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    let row = sqlx::query(
        "SELECT \
            attachment_id, \
            transport_kind, \
            upload_token, \
            token_expires_at > NOW() AS token_is_active, \
            transport_upload_id, \
            storage_locator, \
            byte_size, \
            EXTRACT(EPOCH FROM finished_at)::BIGINT AS finished_at_epoch \
         FROM attachment_upload_transports \
         WHERE attachment_id = $1",
    )
    .bind(附件标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(行转媒体上传运输记录))
}

pub(super) fn 查询媒体上传运输记录(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    repo.在运行时执行(查询媒体上传运输记录_异步(&repo.pool, 附件标识))
}

async fn 根据上传令牌查询媒体上传运输记录_异步(
    pool: &PgPool,
    上传令牌: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    let row = sqlx::query(
        "SELECT \
            attachment_id, \
            transport_kind, \
            upload_token, \
            token_expires_at > NOW() AS token_is_active, \
            transport_upload_id, \
            storage_locator, \
            byte_size, \
            EXTRACT(EPOCH FROM finished_at)::BIGINT AS finished_at_epoch \
         FROM attachment_upload_transports \
         WHERE upload_token = $1",
    )
    .bind(上传令牌)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(行转媒体上传运输记录))
}

pub(super) fn 根据上传令牌查询媒体上传运输记录(
    repo: &Pg仓储,
    上传令牌: &str,
) -> Result<Option<媒体上传运输记录>, contract::错误码> {
    repo.在运行时执行(根据上传令牌查询媒体上传运输记录_异步(
        &repo.pool,
        上传令牌,
    ))
}

/// 运输回执只登记 transport finished 事实，不在这里偷偷把附件升级成 ready。
/// 这样 complete 主链仍然是 prepared -> ready 的唯一入口。
async fn 更新媒体上传运输回执_异步(
    pool: &PgPool,
    附件标识: &str,
    transport_upload_id: &str,
    storage_locator: &str,
    byte_size: i64,
) -> Result<(), contract::错误码> {
    sqlx::query(
        "UPDATE attachment_upload_transports \
         SET transport_upload_id = $2, storage_locator = $3, byte_size = $4, finished_at = NOW() \
         WHERE attachment_id = $1",
    )
    .bind(附件标识)
    .bind(transport_upload_id)
    .bind(storage_locator)
    .bind(byte_size)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(())
}

pub(super) fn 更新媒体上传运输回执(
    repo: &mut Pg仓储,
    附件标识: &str,
    transport_upload_id: &str,
    storage_locator: &str,
    byte_size: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(更新媒体上传运输回执_异步(
        &repo.pool,
        附件标识,
        transport_upload_id,
        storage_locator,
        byte_size,
    ))
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
