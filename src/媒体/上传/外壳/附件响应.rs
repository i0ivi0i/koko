use super::应用状态;
use crate::media_distribution;
use std::time::{SystemTime, UNIX_EPOCH};

// 复用/转发命中 ready 附件时，只在这里做 HTTP 响应投影和 sidecar 做种触发。
// 附件是否可复用、是否可转发，已经由 application owner 裁决。
pub(super) async fn 构造ready媒体附件响应并触发做种(
    state: &应用状态,
    session_id: &str,
    附件: &crate::media::模型::媒体附件快照,
    协作分发: &crate::media::模型::协作分发元数据快照,
    usecase_label: &'static str,
) -> serde_json::Value {
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
    );
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let original_url = super::媒体资产外壳::构造附件受控地址(
        附件.附件标识.as_str(),
        session_id,
        "original",
    );
    let 冷源仍可用 = crate::media::模型::冷源当前可用(
        Some(original_url.as_str()),
        Some(协作分发.web_seed_until秒),
        None,
        now_epoch秒,
    );
    let runtime_distribution = media_distribution::协作分发快照转响应值(
        协作分发,
        media_distribution::协作分发响应上下文 {
            attachment_id: 附件.附件标识.as_str(),
            session_id,
            tracker_public_url: tracker_public_url.as_str(),
            web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
            ticket_secret: state.swarm_ticket_secret.as_deref(),
            ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
            冷源仍可用,
            附件已删除: false,
            now_epoch秒,
            stale_seconds: state.swarm_peer_presence_stale_seconds,
            ice_servers: state.get_turn_ice_servers().await,
        },
    );
    if let Some(启动命令) = super::协作分发做种::从协作分发响应构造做种启动命令(
        &runtime_distribution,
        state.swarm_seeder_tracker_url.as_str(),
    ) {
        if let Err(err) =
            super::协作分发做种::尝试启动协作分发做种(state, &启动命令).await
        {
            tracing::warn!(
                application = usecase_label,
                phase = "seed_start_failed",
                attachment_id = 附件.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "复用已有 canonical 资产后触发 sidecar 做种失败，等待后台对账重试"
            );
        }
    }
    let media_asset = super::媒体资产外壳::构造媒体资产响应体(
        附件,
        super::媒体资产外壳::媒体资产响应上下文 {
            运行态分发: Some(&runtime_distribution),
            分发快照: Some(协作分发),
            原始地址: original_url,
            原始冷源到期时间戳秒: Some(协作分发.web_seed_until秒),
            原始冷源删除时间戳秒: None,
            会话标识: session_id,
            当前时间戳秒: now_epoch秒,
        },
    );
    let preview_asset = super::媒体资产外壳::构造预览资源响应体(
        附件.附件标识.as_str(),
        Some(session_id),
        matches!(附件.种类, crate::media::模型::媒体附件类型::视频) && 附件.允许缩略图,
    );
    super::媒体资产外壳::媒体附件快照转响应体(附件, media_asset, preview_asset)
}
