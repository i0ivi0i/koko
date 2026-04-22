use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

use super::fixture::{最小mp4字节, 最小webp字节};

/// 直接往数据库写入一条 ready 图片附件真相。
/// 这个 helper 只服务集成测试建数，避免为了某个房间/消息场景倒逼上传 HTTP 主链参与。
/// 说明：图片资产协议已经收口成一份 canonical.webp，测试建数也必须跟着收口；
/// 否则 locator/查看器测试会继续吃 preview/full/original 派生列，掩盖真实主链。
pub async fn 插入ready图片附件记录(pool: &PgPool, 会话标识: &str, 附件标识: &str) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

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
            status
         ) VALUES (
            $1, $2, 'image', 'image/webp', $3, 1, 1, $4, NULL, NULL, NULL, TO_TIMESTAMP($5), 'ready'
         )",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(最小webp字节().len() as i64)
    .bind(format!("images/{附件标识}/canonical.webp"))
    .bind(未来冷源到期时间戳秒())
    .execute(pool)
    .await
    .expect("应能插入 ready 图片附件");
}

/// 图片冷源测试夹具必须用“当前时间之后”的 TTL。
/// 否则整套协作分发/清理回归一起跑时，会被后台清理逻辑误删，测试结果就会漂。
pub fn 未来冷源到期时间戳秒() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs() as i64
        + 24 * 60 * 60
}

/// 视频 ready helper 和图片 helper 保持同一层级：
/// - 它只负责给集成测试准备“附件真相已成立”的前置条件；
/// - 不替代真实上传链，也不把 HTTP/对象存储细节混进消息主链测试。
pub async fn 插入ready视频附件记录(pool: &PgPool, 会话标识: &str, 附件标识: &str) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

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
            mezzanine_storage_key,
            mezzanine_expires_at,
            status
         ) VALUES (
            $1, $2, 'video', 'video/mp4', $3, 320, 240, $4, NULL, $4, TO_TIMESTAMP($5), 'ready'
         )",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(最小mp4字节().len() as i64)
    .bind(format!("videos/{附件标识}/mezzanine.mp4"))
    .bind(未来冷源到期时间戳秒())
    .execute(pool)
    .await
    .expect("应能插入 ready 视频附件");
}

/// Phase 1 先把协作分发元数据视作独立真相面，
/// 这里直接插入最小记录，专门服务 locator 回归测试。
pub async fn 插入附件协作分发元数据记录(pool: &PgPool, 附件标识: &str) {
    let content_hash = 生成测试content_hash(附件标识);
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
            (attachment_id, content_id, content_hash, swarm_id, web_seed_until) \
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')",
    )
    .bind(附件标识)
    .bind(format!("content_{附件标识}"))
    .bind(content_hash.as_str())
    .bind(format!("swarm_{content_hash}"))
    .execute(pool)
    .await
    .expect("应能插入协作分发元数据");
}

fn 生成测试content_hash(附件标识: &str) -> String {
    let base = 附件标识
        .bytes()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut out = String::new();
    while out.len() < 64 {
        out.push_str(base.as_str());
    }
    out.truncate(64);
    out
}

/// 过渡完成后，ready 视频测试建数也要补齐正式 manifest 真相。
/// 这里先只插最小清单元数据，不替代真实打包链；真正的产物字节仍应由 complete 上传链回归测试覆盖。
pub async fn 插入流媒体清单元数据记录(pool: &PgPool, 附件标识: &str) {
    sqlx::query(
        "INSERT INTO attachment_streaming_manifests \
            (attachment_id, hls_master_storage_key, dash_mpd_storage_key) \
         VALUES ($1, $2, $3)",
    )
    .bind(附件标识)
    .bind(format!("streams/{附件标识}/hls/master.m3u8"))
    .bind(format!("streams/{附件标识}/dash/stream.mpd"))
    .execute(pool)
    .await
    .expect("应能插入流媒体清单元数据");
}

/// 把某个会话登记为“同 swarm 的完整 peer”：
/// 1. 这里明确写入 `swarm_peer_presence`，不再回写 attachment 级 last_peer_seen_at；
/// 2. `swarm_id` 从权威 distribution 元数据查询，避免测试手工拼错；
/// 3. 用于验证“shared swarm 合法续命”与“streaming 退场后 peer-only 仍可用”这两类语义。
pub async fn 写入完整peer存活记录(
    pool: &PgPool,
    附件标识: &str,
    会话标识: &str,
) {
    sqlx::query(
        "INSERT INTO swarm_peer_presence \
            (swarm_id, session_id, attachment_id, peer_kind, last_seen_at) \
         SELECT swarm_id, $2, $1, 'complete_peer', NOW() \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1 \
         ON CONFLICT (swarm_id, session_id, peer_kind) \
         DO UPDATE SET \
            attachment_id = EXCLUDED.attachment_id, \
            last_seen_at = EXCLUDED.last_seen_at",
    )
    .bind(附件标识)
    .bind(会话标识)
    .execute(pool)
    .await
    .expect("应能写入完整 peer 存活记录");
}
