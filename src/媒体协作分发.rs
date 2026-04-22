use crate::usecase;
use axum::http::{uri::Authority, HeaderMap, Uri};
use bip_metainfo::{DirectAccessor, Metainfo, MetainfoBuilder, PieceLength};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

/// 第一版保底窗口固定 24 小时。
/// 这里故意收口成常量，避免 shell、adapter、前端各自写一份“24 * 60 * 60”。
pub(crate) const WEB_SEED_TTL秒: i64 = 24 * 60 * 60;
pub(crate) const 同源协作分发ANNOUNCE路径: &str = "/api/swarm/announce";
/// `media_state` 是跨壳稳定状态码，前端文案只能从这里派生，不能各端自造状态机。
pub(crate) const 媒体状态已就绪: &str = "MEDIA_READY";
pub(crate) const 媒体状态连接群友中: &str = "MEDIA_CONNECTING_TO_PEERS";
pub(crate) const 媒体状态无在线种子: &str = "MEDIA_NO_ONLINE_SEED";
pub(crate) const 媒体状态已删除: &str = "MEDIA_DELETED";
/// `MEDIA_CONNECTING_TO_PEERS` 的重试节奏必须更激进，避免刚过期窗口里等待过久。
pub(crate) const 连接群友默认重试毫秒: i64 = 2_000;
/// `MEDIA_NO_ONLINE_SEED` 默认重试节奏：让各端共享同一把尺子，避免“有人 3 秒重试，有人 60 秒重试”。
pub(crate) const 无在线种子默认重试毫秒: i64 = 15_000;
/// web_seed 刚过期时先给一次“连接群友”窗口，避免直接从 READY 突兀跳到 NO_ONLINE_SEED。
pub(crate) const 连接群友窗口秒: i64 = 8;

/// 协作分发的内容哈希只认 canonical 共享载荷字节。
/// 这样 Phase 1 就能稳定得到：
/// 1. 与上传主链解耦的内容标识；
/// 2. 不依赖 torrent/runtime 的 swarm 锚点；
/// 3. 后续 Phase 2 生成 metainfo 时仍可继续复用的内容摘要。
pub(crate) fn 生成内容哈希(共享字节: &[u8]) -> String {
    let digest = Sha256::digest(共享字节);
    hex::encode(digest)
}

/// Phase 1 只组装“稳定分发真相”，不生成 metainfo、不碰 tracker ticket。
/// attachment_id 继续是业务锚点，content_hash / swarm_id 只是分发层的稳定附属事实。
pub(crate) fn 构造协作分发元数据写入请求(
    附件标识: &str,
    共享字节: &[u8],
    ready_epoch秒: i64,
) -> usecase::协作分发元数据写入请求 {
    let content_hash = 生成内容哈希(共享字节);
    usecase::协作分发元数据写入请求 {
        附件标识: 附件标识.to_string(),
        content_id: format!("content_{附件标识}"),
        content_hash: content_hash.clone(),
        swarm_id: format!("swarm_{content_hash}"),
        web_seed_until秒: ready_epoch秒 + WEB_SEED_TTL秒,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 附件torrent元信息 {
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length_bytes: i32,
}

/// metainfo 必须只由权威字节派生，不依赖临时文件路径。
/// 这里继续把 torrent 内文件名固定到 `content_hash + canonical 扩展名`：
/// 1. 同内容同 canonical 媒体类型仍可共享同一 info hash；
/// 2. 前端 WebTorrent/file.type 也能拿到浏览器可播放的 MIME，而不是退化成 octet-stream。
pub(crate) fn 生成附件torrent元信息(
    content_hash: &str,
    稳定扩展名: &str,
    共享字节: &[u8],
) -> Result<附件torrent元信息, String> {
    let file_name = format!("content-{content_hash}{稳定扩展名}");
    let accessor = DirectAccessor::new(file_name.as_str(), 共享字节);
    let torrent_bytes = MetainfoBuilder::new()
        .set_private_flag(Some(true))
        .set_piece_length(PieceLength::OptBalanced)
        .build(1, accessor, |_| ())
        .map_err(|err| format!("生成 metainfo 失败: {err}"))?;
    let metainfo = Metainfo::from_bytes(torrent_bytes.as_slice())
        .map_err(|err| format!("解析 metainfo 失败: {err}"))?;
    Ok(附件torrent元信息 {
        torrent_info_hash: hex::encode(metainfo.info().info_hash().as_ref()),
        piece_length_bytes: metainfo.info().piece_length() as i32,
        torrent_bytes,
    })
}

fn 拼接公开地址(public_endpoint: Option<&str>, path: &str) -> String {
    public_endpoint
        .map(|value| format!("{}{}", value.trim_end_matches('/'), path))
        .unwrap_or_else(|| path.to_string())
}

fn 读取首个非空请求头(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| !part.is_empty())
                .map(|part| part.to_string())
        })
}

fn 包装url主机(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn 推导协作分发tracker对外地址(headers: &HeaderMap) -> Option<String> {
    let forwarded_host = 读取首个非空请求头(headers, "x-forwarded-host");
    let raw_host = forwarded_host
        .clone()
        .or_else(|| 读取首个非空请求头(headers, "host"))?;
    let authority = raw_host.parse::<Authority>().ok()?;
    let forwarded_proto = 读取首个非空请求头(headers, "x-forwarded-proto")
        .or_else(|| 读取首个非空请求头(headers, "x-forwarded-scheme"));
    let forwarded_port =
        读取首个非空请求头(headers, "x-forwarded-port").and_then(|value| value.parse::<u16>().ok());
    let ws_scheme = match forwarded_proto.as_deref() {
        Some("https") => "wss",
        _ => "ws",
    };
    let host_for_url = 包装url主机(authority.host());
    let should_trust_forwarded = forwarded_host.is_some() || forwarded_proto.is_some();
    let inferred_proxy_default_port = if should_trust_forwarded {
        match ws_scheme {
            "wss" => Some(443),
            "ws" => Some(80),
            _ => None,
        }
    } else {
        None
    };
    let public_port = forwarded_port
        .or_else(|| authority.port_u16())
        .or(inferred_proxy_default_port);
    let should_omit_port =
        public_port.is_none()
            || (ws_scheme == "ws" && public_port == Some(80))
            || (ws_scheme == "wss" && public_port == Some(443));
    let authority_for_url = if should_omit_port {
        host_for_url
    } else {
        format!("{host_for_url}:{}", public_port.unwrap_or_default())
    };
    Some(format!(
        "{ws_scheme}://{authority_for_url}{}",
        同源协作分发ANNOUNCE路径
    ))
}

fn 是回环tracker公开地址(url: &str) -> bool {
    let Ok(uri) = url.parse::<Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    matches!(authority.host(), "127.0.0.1" | "localhost" | "::1")
}

/// tracker 公网地址显式配置时永远优先；只有沿用本机回环默认值时，
/// 才按本次请求头推导一个 LAN/反向代理可达的 announce 地址。
pub(crate) fn 读取协作分发tracker对外地址(
    configured_tracker_public_url: &str,
    headers: &HeaderMap,
) -> String {
    if !是回环tracker公开地址(configured_tracker_public_url) {
        return configured_tracker_public_url.to_string();
    }
    推导协作分发tracker对外地址(headers)
        .unwrap_or_else(|| configured_tracker_public_url.to_string())
}

pub(crate) fn 裁决协作分发可用性(
    snapshot: &usecase::协作分发元数据快照,
    web_seed仍可用: bool,
    now_epoch秒: i64,
    stale_seconds: i64,
) -> &'static str {
    let 有新鲜完整peer =
        来源仍算活跃(snapshot.最近完整peer存活时间戳秒, now_epoch秒, stale_seconds);
    let 有新鲜后端强种子 =
        来源仍算活跃(snapshot.最近后端强种子存活时间戳秒, now_epoch秒, stale_seconds);

    if web_seed仍可用 || 有新鲜完整peer || 有新鲜后端强种子 {
        "available"
    } else {
        "expired"
    }
}

/// `media_state` 是比 availability 更稳定的跨端真相：
/// 1. availability 先保留给旧前端兼容；
/// 2. 新前端统一消费 media_state.code；
/// 3. 无可用来源时先给短连接窗口，再进入无在线种子。
fn 裁决协作分发媒体状态码(
    snapshot: &usecase::协作分发元数据快照,
    web_seed仍可用: bool,
    附件已删除: bool,
    now_epoch秒: i64,
    stale_seconds: i64,
) -> &'static str {
    if 附件已删除 {
        return 媒体状态已删除;
    }
    let availability = 裁决协作分发可用性(snapshot, web_seed仍可用, now_epoch秒, stale_seconds);
    if availability == "available" {
        return 媒体状态已就绪;
    }

    // partial_peer 说明群友侧已经真实进入 swarm，只是还没补齐成 ready 来源。
    let 有新鲜片段peer =
        来源仍算活跃(snapshot.最近片段peer存活时间戳秒, now_epoch秒, stale_seconds);
    if 有新鲜片段peer || now_epoch秒 <= snapshot.web_seed_until秒.saturating_add(连接群友窗口秒)
    {
        return 媒体状态连接群友中;
    }
    媒体状态无在线种子
}

/// 协作分发来源的新鲜度必须统一裁决，避免不同入口各自拍脑袋理解“最近还活着”。
fn 来源仍算活跃(最近存活时间戳秒: Option<i64>, now_epoch秒: i64, stale_seconds: i64) -> bool {
    最近存活时间戳秒
        .map(|ts| now_epoch秒 - ts <= stale_seconds)
        .unwrap_or(false)
}

/// 统一构造 `media_state` 响应面：
/// - READY / DELETED 不附带重试间隔；
/// - CONNECTING_TO_PEERS 给短周期探测节奏；
/// - NO_ONLINE_SEED 强制附带 retry_after_ms，避免前端自行拍脑袋重试。
fn 构造媒体状态响应(code: &'static str) -> serde_json::Value {
    let retry_after_ms = match code {
        媒体状态连接群友中 => Some(连接群友默认重试毫秒),
        媒体状态无在线种子 => Some(无在线种子默认重试毫秒),
        _ => None,
    };
    serde_json::json!({
        "code": code,
        "retry_after_ms": retry_after_ms,
    })
}

/// 运行态协作分发表达面只依赖这一小撮 HTTP 拼装上下文。
/// 把参数收口成结构体后，调用方更清楚“哪部分是快照真相，哪部分只是外壳投影环境”。
pub(crate) struct 协作分发响应上下文<'a> {
    pub attachment_id: &'a str,
    pub session_id: &'a str,
    pub tracker_public_url: &'a str,
    pub web_seed_public_endpoint: Option<&'a str>,
    /// ticket secret 是启动期/运维期配置，不属于分发快照真相。
    /// 这里通过只读借用透传，避免 handler 自己拼装 secret 或散落签名逻辑。
    pub ticket_secret: Option<&'a str>,
    /// TTL 同样是 runtime gate，而不是领域事实。
    /// 统一从启动配置透传，保证 complete / locator / 未来 refresh 用同一把尺子。
    pub ticket_ttl_seconds: i64,
    /// 这里表达的是“original 变体当前还能不能作为受控冷备入口读取”，
    /// 不是协作分发 availability 本身。availability 还必须再过一层 web_seed TTL 裁决。
    pub 冷源仍可用: bool,
    /// 删除终态属于业务权威事实，优先级高于运行态可用性裁决。
    pub 附件已删除: bool,
    pub now_epoch秒: i64,
    pub stale_seconds: i64,
}

#[derive(serde::Serialize)]
struct 协作分发入群票据声明<'a> {
    /// `sub` 继续锚到会话，后续 tracker/审计链可以追溯“谁拿着这张门票进 swarm”。
    sub: &'a str,
    /// `aid` 锚到业务附件，避免同一 info hash 被错误复用到别的附件上下文。
    aid: &'a str,
    /// `ih` 必须直接绑定 torrent info hash；
    /// tracker 看到的就是它，而不是我们内部的 swarm_id。
    ih: &'a str,
    /// `iat/exp` 统一使用 UNIX 秒，直接复用成熟 JWT 标准字段。
    iat: usize,
    exp: usize,
}

struct 协作分发入群票据签发结果 {
    ticket: String,
    ticket_expires_at: String,
}

/// tracker ticket 只在“当前 swarm 仍值得接入”时签发：
/// 1. secret 没配时直接停签，避免假装有门禁；
/// 2. DELETED/NO_ONLINE_SEED 不签票，避免给已终态或明确无源状态发错误希望；
/// 3. READY/CONNECTING_TO_PEERS 允许签票，便于前端在短窗口里快速探测恢复；
/// 4. info hash 缺失时也不签，避免发出 tracker 根本无法校验的票。
fn 签发协作分发join_ticket(
    snapshot: &usecase::协作分发元数据快照,
    上下文: &协作分发响应上下文<'_>,
    media_state_code: &str,
) -> Option<协作分发入群票据签发结果> {
    if matches!(media_state_code, 媒体状态已删除 | 媒体状态无在线种子) {
        return None;
    }
    let secret = 上下文.ticket_secret?;
    let info_hash = snapshot.torrent_info_hash.as_deref()?;
    let issued_at秒 = 上下文.now_epoch秒.max(0) as usize;
    let expires_at秒 = issued_at秒.saturating_add(上下文.ticket_ttl_seconds as usize);
    let claims = 协作分发入群票据声明 {
        sub: 上下文.session_id,
        aid: 上下文.attachment_id,
        ih: info_hash,
        iat: issued_at秒,
        exp: expires_at秒,
    };
    let ticket = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .ok()?;
    let ticket_expires_at = OffsetDateTime::from_unix_timestamp(expires_at秒 as i64)
        .ok()?
        .format(&Rfc3339)
        .ok()?;
    Some(协作分发入群票据签发结果 {
        ticket,
        ticket_expires_at,
    })
}

/// Phase 2 的 runtime locator 仍然服从同一条边界：
/// 1. 不下发存储键；
/// 2. runtime 线索只包含浏览器真正要用到的 announce / web seed / presence / availability；
/// 3. join_ticket/ticket_expires_at 只表达 swarm 门禁，不扩散成页面流程字段。
pub(crate) fn 协作分发快照转响应值(
    snapshot: &usecase::协作分发元数据快照,
    上下文: 协作分发响应上下文<'_>,
) -> serde_json::Value {
    let web_seed_relative_path = format!(
        "/api/attachments/{}/content?session_id={}&variant=original",
        上下文.attachment_id, 上下文.session_id
    );
    let presence_relative_path = format!(
        "/api/media/{}/presence?session_id={}",
        上下文.attachment_id, 上下文.session_id
    );
    let web_seed仍可用 = 上下文.冷源仍可用 && 上下文.now_epoch秒 <= snapshot.web_seed_until秒;
    let availability = if 上下文.附件已删除 {
        "expired"
    } else {
        裁决协作分发可用性(
            snapshot,
            web_seed仍可用,
            上下文.now_epoch秒,
            上下文.stale_seconds,
        )
    };
    let media_state_code = 裁决协作分发媒体状态码(
        snapshot,
        web_seed仍可用,
        上下文.附件已删除,
        上下文.now_epoch秒,
        上下文.stale_seconds,
    );
    let ticket = 签发协作分发join_ticket(snapshot, &上下文, media_state_code);
    serde_json::json!({
        "content_id": snapshot.content_id,
        "content_hash": snapshot.content_hash,
        "swarm_id": snapshot.swarm_id,
        "web_seed_until": snapshot.web_seed_until秒.to_string(),
        "torrent_url": snapshot
            .torrent_info_hash
            .as_ref()
            .map(|_| format!(
                "/api/media/{}/torrent?session_id={}",
                上下文.attachment_id, 上下文.session_id
            )),
        "torrent_info_hash": snapshot.torrent_info_hash,
        "announce_urls": [上下文.tracker_public_url],
        "web_seed_url": (!上下文.附件已删除 && web_seed仍可用)
            .then(|| 拼接公开地址(上下文.web_seed_public_endpoint, web_seed_relative_path.as_str())),
        "presence_url": presence_relative_path,
        "join_ticket": ticket.as_ref().map(|value| value.ticket.as_str()),
        "ticket_expires_at": ticket
            .as_ref()
            .map(|value| value.ticket_expires_at.as_str()),
        // 兼容字段：旧前端仍消费 availability；
        // 新前端应优先消费 media_state.code。
        "availability": availability,
        "media_state": 构造媒体状态响应(media_state_code),
        // survival_mode 表达的是“服务器流媒体退场后正式靠什么继续活”，
        // 它是稳定共享语义，不等于当前 availability，也不承载前端页面提示文案。
        "survival_mode": "peer_only_after_expiry",
    })
}
