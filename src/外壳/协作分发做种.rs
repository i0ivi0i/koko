use super::{应用状态, 构建共享仓储};
use crate::{media::distribution::application as 协作分发应用, media_distribution};
use std::{
    collections::HashSet,
    io,
    time::{SystemTime, UNIX_EPOCH},
};

/// 后端 owner 发给 seeder sidecar 的最小启动命令。
/// 这里只保留协议执行所需字段，不把业务裁决泄漏到 sidecar。
#[derive(Debug, Clone)]
pub(super) struct 协作分发做种启动命令 {
    pub info_hash: String,
    pub announce_urls: Vec<String>,
    pub web_seed_url: Option<String>,
    pub torrent_url: Option<String>,
    pub join_ticket: Option<String>,
}

/// 后端 strong seed 是基础设施 owner，不应冒充任何前端会话。
/// 这里使用固定系统会话标识，专门记录 backend seeder 的 swarm presence。
#[allow(non_upper_case_globals)]
const 后端强种子系统会话标识: &str = "__backend_strong_seed__";

/// sidecar 拉取 `.torrent` / `web seed` 时必须拿到绝对 URL：
/// 1. 优先允许运维显式指定 `SWARM_SEEDER_MEDIA_BASE_URL`；
/// 2. 没配时回退到本机后端 `APP_PORT`（默认 8080）；
/// 3. 只在 sidecar 命令面使用，不影响前端 contract 里继续保留相对地址真相。
fn 读取sidecar媒体基准地址() -> String {
    let from_env = std::env::var("SWARM_SEEDER_MEDIA_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    if let Some(value) = from_env {
        return value;
    }
    let app_port = std::env::var("APP_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(8080);
    format!("http://127.0.0.1:{app_port}")
}

/// 把 runtime 分发里的相对路径收口成 sidecar 可直接请求的绝对 URL。
/// 这样可以避免 Node 端把 `/api/...` 误判成 `Invalid torrent identifier`。
fn 归一化sidecar媒体地址(raw: Option<&str>) -> Option<String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty())?;
    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(value.to_string());
    }
    let base_url = 读取sidecar媒体基准地址();
    if value.starts_with('/') {
        return Some(format!("{base_url}{value}"));
    }
    Some(format!("{base_url}/{}", value.trim_start_matches('/')))
}

/// 把 runtime 分发响应收口成 sidecar 可执行命令。
/// 约束：
/// 1. 缺少 `torrent_info_hash` 时不能启动做种；
/// 2. 缺少 `join_ticket` 时不能启动做种；后端 strong seed 也必须走同源 tracker 门禁；
/// 3. sidecar 只吃 transport 线索，不承载页面态字段；
/// 4. 浏览器 public announce 已在 locator contract 里返回，这里只能使用 sidecar 私有 announce。
pub(super) fn 从协作分发响应构造做种启动命令(
    runtime_distribution: &serde_json::Value,
    seeder_tracker_url: &str,
) -> Option<协作分发做种启动命令> {
    let info_hash = runtime_distribution["torrent_info_hash"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let seeder_tracker_url = seeder_tracker_url.trim();
    // 注意：runtime_distribution["announce_urls"] 是浏览器公开入口，HTTPS 下通常是 WSS 反代地址。
    // Node sidecar 在服务端本机做强种子，应走内网 tracker，避免把公开反代入口误当成基础设施回环。
    let announce_urls = if seeder_tracker_url.is_empty() {
        Vec::new()
    } else {
        vec![seeder_tracker_url.to_string()]
    };
    let web_seed_url = 归一化sidecar媒体地址(runtime_distribution["web_seed_url"].as_str());
    let torrent_url = 归一化sidecar媒体地址(runtime_distribution["torrent_url"].as_str());
    let join_ticket = runtime_distribution["join_ticket"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)?;
    Some(协作分发做种启动命令 {
        info_hash,
        announce_urls,
        web_seed_url,
        torrent_url,
        join_ticket: Some(join_ticket),
    })
}

/// 尝试触发一次 seeder start。
/// 失败时调用方可自行决定是否降级重试；这里保持错误可见，不吞掉基础设施问题。
pub(super) async fn 尝试启动协作分发做种(
    state: &应用状态,
    命令: &协作分发做种启动命令,
) -> io::Result<()> {
    let url = format!("{}/seed/start", state.swarm_seeder_control_base_url);
    let payload = serde_json::json!({
        "infoHash": 命令.info_hash,
        "announceUrls": 命令.announce_urls,
        "webSeedUrl": 命令.web_seed_url,
        "torrentUrl": 命令.torrent_url,
        "joinTicket": 命令.join_ticket,
    });
    let response = reqwest::Client::new()
        .post(url.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|err| io::Error::other(format!("调用 seeder start 失败: {err}")))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let detail = response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<empty>"));
    Err(io::Error::other(format!(
        "调用 seeder start 返回非成功状态: status={status}, detail={detail}"
    )))
}

/// 周期性做种对账：
/// 1. 从权威库拉取仍在 0-24h 强 seed 窗口的附件；
/// 2. 逐条尝试 start（幂等）；
/// 3. 再把当前活跃 info_hash 集合下发给 sidecar reconcile，回收过期会话。
pub async fn 执行一次协作分发做种对账(state: 应用状态) -> io::Result<()> {
    let 当前时间戳秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_query = state.clone();
    let 待做种项 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        let media_repo = repo.媒体仓储();
        协作分发应用::列出待做种协作分发项(&media_repo, 当前时间戳秒, 256)
            .map_err(|err| io::Error::other(format!("查询待做种协作分发项失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("做种对账查询任务失败: {err}")))??;

    let mut active_info_hashes = HashSet::new();
    for 待做种 in 待做种项 {
        let distribution_snapshot = crate::media::模型::协作分发元数据快照 {
            附件标识: 待做种.附件标识.clone(),
            content_id: 待做种.content_id.clone(),
            content_hash: 待做种.content_hash.clone(),
            swarm_id: 待做种.swarm_id.clone(),
            web_seed_until秒: 待做种.web_seed_until秒,
            最近片段peer存活时间戳秒: None,
            最近完整peer存活时间戳秒: None,
            最近后端强种子存活时间戳秒: None,
            torrent_info_hash: Some(待做种.torrent_info_hash.clone()),
        };
        let runtime_distribution = media_distribution::协作分发快照转响应值(
            &distribution_snapshot,
            media_distribution::协作分发响应上下文 {
                attachment_id: 待做种.附件标识.as_str(),
                session_id: 待做种.会话标识.as_str(),
                tracker_public_url: state.swarm_tracker_public_url.as_str(),
                web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                ticket_secret: state.swarm_ticket_secret.as_deref(),
                ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                冷源仍可用: 当前时间戳秒 <= 待做种.web_seed_until秒,
                附件已删除: false,
                now_epoch秒: 当前时间戳秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
            },
        );
        let Some(启动命令) = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            state.swarm_seeder_tracker_url.as_str(),
        ) else {
            continue;
        };
        active_info_hashes.insert(启动命令.info_hash.clone());
        if let Err(err) = 尝试启动协作分发做种(&state, &启动命令).await {
            tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "周期做种 start 失败，等待下一轮重试"
            );
            continue;
        }
        let state_for_presence = state.clone();
        let swarm_id = 待做种.swarm_id.clone();
        let attachment_id = 待做种.附件标识.clone();
        let upsert_presence = tokio::task::spawn_blocking(move || {
            let repo = 构建共享仓储(&state_for_presence);
            let mut media_repo = repo.媒体仓储();
            协作分发应用::写入协作分发swarm存活(
                &mut media_repo,
                &crate::media::模型::协作分发swarm存活写入请求 {
                    swarm_id,
                    附件标识: attachment_id,
                    会话标识: 后端强种子系统会话标识.to_string(),
                    存活类型: crate::media::模型::协作分发存活类型后端强种子.to_string(),
                    最近peer存活时间戳秒: 当前时间戳秒,
                },
            )
            .map_err(|err| io::Error::other(format!("写入 backend strong seed 存活失败: {err:?}")))
        })
        .await;
        match upsert_presence {
            Ok(Ok(())) => {}
            Ok(Err(err)) => tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "做种 start 成功但写入 backend strong seed 存活失败，等待下一轮重试"
            ),
            Err(err) => tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "写入 backend strong seed 存活任务失败，等待下一轮重试"
            ),
        }
    }

    let mut active_info_hashes = active_info_hashes.into_iter().collect::<Vec<_>>();
    active_info_hashes.sort();
    let reconcile_payload = serde_json::json!({
        "activeInfoHashes": active_info_hashes
    });
    let reconcile_url = format!("{}/seed/reconcile", state.swarm_seeder_control_base_url);
    let reconcile_response = reqwest::Client::new()
        .post(reconcile_url.as_str())
        .json(&reconcile_payload)
        .send()
        .await
        .map_err(|err| io::Error::other(format!("调用 seeder reconcile 失败: {err}")))?;
    if reconcile_response.status().is_success() {
        return Ok(());
    }
    let status = reconcile_response.status();
    let detail = reconcile_response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<empty>"));
    Err(io::Error::other(format!(
        "调用 seeder reconcile 返回非成功状态: status={status}, detail={detail}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 做种启动命令缺少join_ticket时不得启动受保护tracker() {
        let runtime_distribution = serde_json::json!({
            "torrent_info_hash": "0123456789abcdef0123456789abcdef01234567",
            "torrent_url": "/api/media/att-test/torrent?session_id=s-test",
            "web_seed_url": "/api/attachments/att-test/content?session_id=s-test&variant=original",
            "join_ticket": null,
        });

        let 命令 = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            "ws://127.0.0.1:18080/api/swarm/announce",
        );

        assert!(
            命令.is_none(),
            "sidecar 强种子也必须持票入群；缺票时不能构造 start 命令再让 tracker 打 missing_ticket"
        );
    }

    #[test]
    fn 做种启动命令会保留有效join_ticket() {
        let runtime_distribution = serde_json::json!({
            "torrent_info_hash": "0123456789abcdef0123456789abcdef01234567",
            "torrent_url": "/api/media/att-test/torrent?session_id=s-test",
            "web_seed_url": "/api/attachments/att-test/content?session_id=s-test&variant=original",
            "join_ticket": "ticket-valid",
        });

        let 命令 = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            "ws://127.0.0.1:18080/api/swarm/announce",
        )
        .expect("有 info_hash 与 join_ticket 时应能构造做种命令");

        assert_eq!(命令.join_ticket.as_deref(), Some("ticket-valid"));
    }
}
