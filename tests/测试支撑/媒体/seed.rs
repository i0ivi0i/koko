use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

use super::fixture::最小mp4字节;

/// 直接往数据库写入一条 ready 图片附件真相。
/// 这个 helper 只服务集成测试建数，避免为了某个房间/消息场景倒逼上传 HTTP 主链参与。
/// 说明：随着图片资产协议收口，测试建数也要跟着落三层资产键和原始冷源到期时间，
/// 避免 locator/查看器测试继续吃“只有 original + thumbnail 两列”的过期夹具。
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
            $1, $2, 'image', 'image/png', 68, 1, 1, $3, $4, $5, $6, TO_TIMESTAMP($7), 'ready'
         )",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(format!("original/{附件标识}.png"))
    .bind(format!("thumbnail/{附件标识}.png"))
    .bind(format!("asset-original/{附件标识}.png"))
    .bind(format!("full/{附件标识}.webp"))
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
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
            (attachment_id, content_id, content_hash, swarm_id, web_seed_until) \
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')",
    )
    .bind(附件标识)
    .bind(format!("content_{附件标识}"))
    .bind("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    .bind(format!(
        "swarm_{}",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ))
    .execute(pool)
    .await
    .expect("应能插入协作分发元数据");
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
