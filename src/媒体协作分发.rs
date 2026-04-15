use crate::usecase;
use bip_metainfo::{DirectAccessor, Metainfo, MetainfoBuilder, PieceLength};
use sha2::{Digest, Sha256};

/// 第一版保底窗口固定 24 小时。
/// 这里故意收口成常量，避免 shell、adapter、前端各自写一份“24 * 60 * 60”。
pub(crate) const WEB_SEED_TTL秒: i64 = 24 * 60 * 60;

/// 协作分发的内容哈希先只认 canonical 原始字节。
/// 这样 Phase 1 就能稳定得到：
/// 1. 与上传主链解耦的内容标识；
/// 2. 不依赖 torrent/runtime 的 swarm 锚点；
/// 3. 后续 Phase 2 生成 metainfo 时仍可继续复用的内容摘要。
pub(crate) fn 生成内容哈希(原始字节: &[u8]) -> String {
    let digest = Sha256::digest(原始字节);
    hex::encode(digest)
}

/// Phase 1 只组装“稳定分发真相”，不生成 metainfo、不碰 tracker ticket。
/// attachment_id 继续是业务锚点，content_hash / swarm_id 只是分发层的稳定附属事实。
pub(crate) fn 构造协作分发元数据写入请求(
    附件标识: &str,
    原始字节: &[u8],
    ready_epoch秒: i64,
) -> usecase::协作分发元数据写入请求 {
    let content_hash = 生成内容哈希(原始字节);
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
/// 这里把 torrent 内文件名固定到 content_hash 上，确保同内容附件能共享同一 info hash。
pub(crate) fn 生成附件torrent元信息(
    content_hash: &str,
    原始字节: &[u8],
) -> Result<附件torrent元信息, String> {
    let file_name = format!("content-{content_hash}.bin");
    let accessor = DirectAccessor::new(file_name.as_str(), 原始字节);
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

pub(crate) fn 裁决协作分发可用性(
    snapshot: &usecase::协作分发元数据快照,
    web_seed仍可用: bool,
    now_epoch秒: i64,
    stale_seconds: i64,
) -> &'static str {
    let 最近peer仍算活跃 = snapshot
        .最近peer存活时间戳秒
        .map(|ts| now_epoch秒 - ts <= stale_seconds)
        .unwrap_or(false);

    if web_seed仍可用 || 最近peer仍算活跃 {
        "available"
    } else {
        "expired"
    }
}

/// 运行态协作分发表达面只依赖这一小撮 HTTP 拼装上下文。
/// 把参数收口成结构体后，调用方更清楚“哪部分是快照真相，哪部分只是外壳投影环境”。
pub(crate) struct 协作分发响应上下文<'a> {
    pub attachment_id: &'a str,
    pub session_id: &'a str,
    pub tracker_public_url: &'a str,
    pub web_seed_public_endpoint: Option<&'a str>,
    /// 这里表达的是“original 变体当前还能不能作为受控冷备入口读取”，
    /// 不是协作分发 availability 本身。availability 还必须再过一层 web_seed TTL 裁决。
    pub 冷源仍可用: bool,
    pub now_epoch秒: i64,
    pub stale_seconds: i64,
}

/// Phase 2 的 runtime locator 仍然服从同一条边界：
/// 1. 不下发存储键；
/// 2. runtime 线索只包含浏览器真正要用到的 announce / web seed / presence / availability；
/// 3. ticket 位置先留空，不提前伪造门禁真相。
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
    let availability = 裁决协作分发可用性(
        snapshot,
        web_seed仍可用,
        上下文.now_epoch秒,
        上下文.stale_seconds,
    );
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
        "web_seed_url": web_seed仍可用
            .then(|| 拼接公开地址(上下文.web_seed_public_endpoint, web_seed_relative_path.as_str())),
        "presence_url": presence_relative_path,
        "join_ticket": serde_json::Value::Null,
        "ticket_expires_at": serde_json::Value::Null,
        "availability": availability,
    })
}
