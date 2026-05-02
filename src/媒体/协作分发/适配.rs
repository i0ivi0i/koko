use sqlx::{PgPool, Row};

use crate::{media_distribution, shared::contract};

use super::Pg仓储;

// 协作分发适配只负责 swarm / torrent / manifest 的派生持久化事实。
// 它不拥有附件字节、房间成员或播放器状态，避免形成第二条媒体主链。

/// 分发元数据和 torrent/manifests 都是附件 ready 之后的派生持久化事实。
/// 它们继续围绕 attachment_id 收口，避免形成第二条“媒体分发主链”。
async fn 写入协作分发元数据_异步(
    pool: &PgPool,
    请求: &crate::media::模型::协作分发元数据写入请求,
) -> Result<crate::media::模型::协作分发元数据快照, contract::错误码> {
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

    Ok(crate::media::模型::协作分发元数据快照 {
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
    请求: &crate::media::模型::协作分发元数据写入请求,
) -> Result<crate::media::模型::协作分发元数据快照, contract::错误码> {
    repo.在运行时执行(写入协作分发元数据_异步(&repo.pool, 请求))
}

async fn 查询协作分发元数据_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<crate::media::模型::协作分发元数据快照>, contract::错误码> {
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
    .bind(crate::media::模型::协作分发存活类型片段peer)
    .bind(crate::media::模型::协作分发存活类型完整peer)
    .bind(crate::media::模型::协作分发存活类型后端强种子)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(row.map(|row| crate::media::模型::协作分发元数据快照 {
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
) -> Result<Option<crate::media::模型::协作分发元数据快照>, contract::错误码> {
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
) -> Result<Vec<crate::media::模型::待做种协作分发项>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT a.attachment_id,
                s.session_id AS owner_session_id,
                dm.content_id,
                dm.content_hash,
                dm.swarm_id,
                EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch,
                dm.torrent_info_hash,
                dm.torrent_bytes
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
        .filter_map(|row| {
            let attachment_id: String = row.get("attachment_id");
            let torrent_info_hash: String = row.get("torrent_info_hash");
            let torrent_bytes: Vec<u8> = row.get("torrent_bytes");
            if let Err(error) = media_distribution::诊断协作分发torrent元信息(
                torrent_bytes.as_slice(),
                torrent_info_hash.as_str(),
            ) {
                // 做种对账面对真实 sidecar，不能把历史脏 metainfo 交给 start 再靠 400 重试暴露。
                // 这里降级为对账输入过滤；真正的新写入仍由上传主链生成合法 metainfo。
                tracing::debug!(
                    application = "协作分发做种对账",
                    adapter = "postgres",
                    outcome = "skipped",
                    attachment_id = attachment_id.as_str(),
                    info_hash = torrent_info_hash.as_str(),
                    reason = %error,
                    "跳过不可用于做种的 torrent 元信息"
                );
                return None;
            }
            Some(crate::media::模型::待做种协作分发项 {
                附件标识: attachment_id,
                会话标识: row.get("owner_session_id"),
                content_id: row.get("content_id"),
                content_hash: row.get("content_hash"),
                swarm_id: row.get("swarm_id"),
                web_seed_until秒: row.get("web_seed_until_epoch"),
                torrent_info_hash,
            })
        })
        .collect())
}

pub(super) fn 列出待做种协作分发项(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<crate::media::模型::待做种协作分发项>, contract::错误码> {
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
    请求: &crate::media::模型::协作分发swarm存活写入请求,
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
    请求: &crate::media::模型::协作分发swarm存活写入请求,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(写入协作分发swarm存活_异步(&repo.pool, 请求))
}

async fn 写入协作分发torrent元信息_异步(
    pool: &PgPool,
    请求: &crate::media::模型::协作分发torrent元信息写入请求,
) -> Result<crate::media::模型::协作分发torrent元信息快照, contract::错误码> {
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

    Ok(crate::media::模型::协作分发torrent元信息快照 {
        附件标识: 请求.附件标识.clone(),
        torrent_bytes: 请求.torrent_bytes.clone(),
        torrent_info_hash: 请求.torrent_info_hash.clone(),
        piece_length字节: 请求.piece_length字节,
    })
}

pub(super) fn 写入协作分发torrent元信息(
    repo: &mut Pg仓储,
    请求: &crate::media::模型::协作分发torrent元信息写入请求,
) -> Result<crate::media::模型::协作分发torrent元信息快照, contract::错误码> {
    repo.在运行时执行(写入协作分发torrent元信息_异步(&repo.pool, 请求))
}

async fn 查询协作分发torrent元信息_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<crate::media::模型::协作分发torrent元信息快照>, contract::错误码> {
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

    Ok(
        row.map(|row| crate::media::模型::协作分发torrent元信息快照 {
            附件标识: row.get("attachment_id"),
            torrent_bytes: row.get("torrent_bytes"),
            torrent_info_hash: row.get("torrent_info_hash"),
            piece_length字节: row.get("piece_length_bytes"),
        }),
    )
}

pub(super) fn 查询协作分发torrent元信息(
    repo: &Pg仓储,
    附件标识: &str,
) -> Result<Option<crate::media::模型::协作分发torrent元信息快照>, contract::错误码> {
    repo.在运行时执行(查询协作分发torrent元信息_异步(
        &repo.pool,
        附件标识,
    ))
}

async fn 写入流媒体清单元数据_异步(
    pool: &PgPool,
    请求: &crate::media::模型::流媒体清单写入请求,
) -> Result<crate::media::模型::流媒体清单快照, contract::错误码> {
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

    Ok(crate::media::模型::流媒体清单快照 {
        附件标识: 请求.附件标识.clone(),
        hls主清单存储键: 请求.hls主清单存储键.clone(),
        dash主清单存储键: 请求.dash主清单存储键.clone(),
        streaming到期时间戳秒: Some(请求.streaming到期时间戳秒),
        streaming删除时间戳秒: 请求.streaming删除时间戳秒,
    })
}

pub(super) fn 写入流媒体清单元数据(
    repo: &mut Pg仓储,
    请求: &crate::media::模型::流媒体清单写入请求,
) -> Result<crate::media::模型::流媒体清单快照, contract::错误码> {
    repo.在运行时执行(写入流媒体清单元数据_异步(&repo.pool, 请求))
}

async fn 查询流媒体清单元数据_异步(
    pool: &PgPool,
    附件标识: &str,
) -> Result<Option<crate::media::模型::流媒体清单快照>, contract::错误码> {
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

    Ok(row.map(|row| crate::media::模型::流媒体清单快照 {
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
) -> Result<Option<crate::media::模型::流媒体清单快照>, contract::错误码> {
    repo.在运行时执行(查询流媒体清单元数据_异步(&repo.pool, 附件标识))
}

/// 流媒体清理查询只回答“哪些服务端 manifest 已经过了冷备窗口”，
/// 不把 swarm metadata 或 peer 存活语义混进这张表。
async fn 列出待清理流媒体清单_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<crate::media::模型::待清理流媒体清单>, contract::错误码> {
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
        .map(|row| crate::media::模型::待清理流媒体清单 {
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
) -> Result<Vec<crate::media::模型::待清理流媒体清单>, contract::错误码> {
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
