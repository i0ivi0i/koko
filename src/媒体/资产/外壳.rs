use crate::media::distribution::application as 协作分发应用;
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use crate::{shared::contract, media_distribution, application};
use super::{应用状态, 构建共享仓储};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use object_store::{GetOptions, GetRange, ObjectStoreExt, path::Path as ObjectPath};
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::task;

/// 附件内容 query 的内部稳定形状。
struct ParsedAttachmentContentQuery {
    session_id: String,
    variant: application::附件内容变体,
}

/// 只需要 session_id 的媒体资源 query 内部稳定形状。
struct ParsedSessionQuery {
    session_id: String,
}

struct ParsedDistributionPresencePayload {
    peer_kind: String,
}

/// 标准化后的单段 bytes Range。
struct 标准字节范围 {
    请求: GetRange,
    起始字节: u64,
    结束字节_不含: u64,
}

/// “附件 ready 快照 -> 媒体资产响应体” 需要的协议投影上下文。
/// 这里集中表达所有非业务真相输入，避免 helper 把一长串位置参数越传越胖。
pub(super) struct 媒体资产响应上下文<'a> {
    pub 运行态分发: Option<&'a serde_json::Value>,
    pub 分发快照: Option<&'a application::协作分发元数据快照>,
    pub 原始地址: String,
    pub 原始冷源到期时间戳秒: Option<i64>,
    pub 原始冷源删除时间戳秒: Option<i64>,
    pub 会话标识: &'a str,
    pub 当前时间戳秒: i64,
}

/// 定位接口已经拿到 locator 真相，只需要补一层响应投影环境。
struct 定位媒体资产响应上下文<'a> {
    运行态分发: Option<&'a serde_json::Value>,
    原始地址: String,
    会话标识: &'a str,
    当前时间戳秒: i64,
}

/// 单文件视频资产的协议拼装参数。
struct 单文件视频资产响应参数<'a> {
    附件标识: &'a str,
    运行态分发: &'a serde_json::Value,
    分发快照: &'a application::协作分发元数据快照,
    canonical地址: String,
    mime_type: &'a str,
    宽: Option<i32>,
    高: Option<i32>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
}

/// 图片 blob 资产的协议拼装参数。
struct Blob媒体资产响应参数<'a> {
    附件标识: &'a str,
    会话标识: &'a str,
    运行态分发: Option<&'a serde_json::Value>,
    分发快照: Option<&'a application::协作分发元数据快照>,
    旧原始地址: String,
    mime_type: &'a str,
    宽: Option<i32>,
    高: Option<i32>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
}

fn parse_attachment_content_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedAttachmentContentQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    let variant = match raw_query
        .get("variant")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        None | Some("original") => application::附件内容变体::原图,
        Some("thumbnail") => application::附件内容变体::缩略图,
        Some(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "variant 必须是 original 或 thumbnail",
            ));
        }
    };
    Ok(ParsedAttachmentContentQuery {
        session_id: session_id.to_string(),
        variant,
    })
}

fn parse_session_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedSessionQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    Ok(ParsedSessionQuery {
        session_id: session_id.to_string(),
    })
}

fn parse_distribution_presence_payload(
    raw_body: &[u8],
) -> Result<ParsedDistributionPresencePayload, (StatusCode, &'static str, String)> {
    if raw_body.is_empty() {
        return Ok(ParsedDistributionPresencePayload {
            peer_kind: application::协作分发存活类型旁观意图.to_string(),
        });
    }
    let value: serde_json::Value = serde_json::from_slice(raw_body).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("presence body 不是合法 JSON: {err}"),
        )
    })?;
    let peer_kind = value
        .get("peer_kind")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(application::协作分发存活类型旁观意图);
    if !application::是有效协作分发存活类型(peer_kind) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!(
                "peer_kind 仅支持 {} / {} / {} / {}",
                application::协作分发存活类型旁观意图,
                application::协作分发存活类型片段peer,
                application::协作分发存活类型完整peer,
                application::协作分发存活类型后端强种子
            ),
        ));
    }
    Ok(ParsedDistributionPresencePayload {
        peer_kind: peer_kind.to_string(),
    })
}

fn 解析标准字节范围(
    raw_range: Option<&axum::http::HeaderValue>,
    总字节数: u64,
) -> Result<Option<标准字节范围>, (StatusCode, &'static str, String)> {
    let Some(raw_range) = raw_range else {
        return Ok(None);
    };
    let raw_range = raw_range.to_str().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 请求头必须是合法 ASCII".to_string(),
        )
    })?;
    let raw_range = raw_range.trim();
    let Some(range_spec) = raw_range.strip_prefix("bytes=") else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 只支持 bytes 单位".to_string(),
        ));
    };
    if range_spec.contains(',') {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "当前只支持单段 bytes Range".to_string(),
        ));
    }
    let Some((start_raw, end_raw)) = range_spec.split_once('-') else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 必须形如 bytes=start-end".to_string(),
        ));
    };

    let range = if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range suffix 必须是非负整数".to_string(),
            )
        })?;
        GetRange::Suffix(suffix_len)
    } else if end_raw.is_empty() {
        let start = start_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 起始偏移必须是非负整数".to_string(),
            )
        })?;
        GetRange::Offset(start)
    } else {
        let start = start_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 起始偏移必须是非负整数".to_string(),
            )
        })?;
        let end_inclusive = end_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 结束偏移必须是非负整数".to_string(),
            )
        })?;
        GetRange::Bounded(start..end_inclusive.saturating_add(1))
    };

    let resolved = range.as_range(总字节数).map_err(|err| {
        (
            StatusCode::RANGE_NOT_SATISFIABLE,
            "requested_range_not_satisfiable",
            format!("Range 超出对象范围: {err}"),
        )
    })?;
    Ok(Some(标准字节范围 {
        请求: range,
        起始字节: resolved.start,
        结束字节_不含: resolved.end,
    }))
}

fn 构造content_range值(range: &标准字节范围, 总字节数: u64) -> String {
    format!(
        "bytes {}-{}/{}",
        range.起始字节,
        range.结束字节_不含.saturating_sub(1),
        总字节数
    )
}

/// 下面这组 helper 的 owner 已经跟着“媒体资产外壳”一起迁移。
/// 原因是它们表达的是媒体资产 HTTP 协议面，而不是房间查询协议面；
/// 继续留在房间壳只会让兄弟模块反向依赖一个并不拥有该真相的文件。
pub(super) fn 媒体类型转标签(kind: &application::媒体附件类型) -> &'static str {
    match kind {
        application::媒体附件类型::图片 => "image",
        application::媒体附件类型::视频 => "video",
    }
}

fn 附件状态转标签(status: &application::附件状态读取结果) -> &'static str {
    match status {
        application::附件状态读取结果::已准备 => "prepared",
        application::附件状态读取结果::上传中 => "uploading",
        application::附件状态读取结果::处理中 => "processing",
        application::附件状态读取结果::就绪 => "ready",
        application::附件状态读取结果::失败 => "failed",
        application::附件状态读取结果::已过期 => "deleted",
    }
}

fn 媒体资产种类转标签(kind: &contract::媒体资产种类) -> &'static str {
    match kind {
        contract::媒体资产种类::图片Blob => "blob_image",
        contract::媒体资产种类::单文件视频 => "file_video",
    }
}

fn 媒体冷源角色转标签(role: &contract::媒体冷源角色) -> &'static str {
    match role {
        // 当前协议明确把原始附件压回冷备引导角色，避免它继续假扮正式主链。
        contract::媒体冷源角色::冷备引导 => "cold_backup_only",
    }
}

fn 媒体分发生存模式转标签(mode: &contract::媒体分发生存模式) -> &'static str {
    match mode {
        contract::媒体分发生存模式::服务端冷备窗口 => "server_assisted",
        contract::媒体分发生存模式::到期后仅peer存活 => "peer_only_after_expiry",
    }
}

fn 变体描述转响应体(variant: &contract::变体描述) -> serde_json::Value {
    serde_json::json!({
        "id": variant.标识,
        "mime_type": variant.mime_type,
        "url": variant.地址,
        "width": variant.宽,
        "height": variant.高,
    })
}

fn 媒体冷源描述转响应体(origin: &contract::媒体冷源描述) -> serde_json::Value {
    serde_json::json!({
        "original_url": origin.原始地址,
        "expires_at_epoch_seconds": origin.到期时间戳秒,
        "available": origin.是否可用,
        "role": 媒体冷源角色转标签(&origin.角色),
    })
}

fn 从运行态协作分发响应提取共享分发表面(
    snapshot: &application::协作分发元数据快照,
    runtime_distribution: &serde_json::Value,
) -> contract::媒体分发描述 {
    let announce_urls = runtime_distribution["announce_urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    contract::媒体分发描述 {
        swarm_id: snapshot.swarm_id.clone(),
        announce_urls,
        web_seed_url: runtime_distribution["web_seed_url"]
            .as_str()
            .map(str::to_string),
        join_ticket: runtime_distribution["join_ticket"]
            .as_str()
            .map(str::to_string),
        ticket_expires_at: runtime_distribution["ticket_expires_at"]
            .as_str()
            .map(str::to_string),
        生存模式: match runtime_distribution["survival_mode"].as_str() {
            Some("server_assisted") => contract::媒体分发生存模式::服务端冷备窗口,
            _ => contract::媒体分发生存模式::到期后仅peer存活,
        },
    }
}

fn 媒体分发描述转响应体(
    distribution: &contract::媒体分发描述
) -> serde_json::Value {
    serde_json::json!({
        "swarm_id": distribution.swarm_id,
        "announce_urls": distribution.announce_urls,
        "web_seed_url": distribution.web_seed_url,
        "join_ticket": distribution.join_ticket,
        "ticket_expires_at": distribution.ticket_expires_at,
        "survival_mode": 媒体分发生存模式转标签(&distribution.生存模式),
    })
}

/// 受控附件内容路由是冷源读取的 canonical 入口。
/// 它不承担图片 blob 主链身份，只负责冷备读取与权限承接。
pub(super) fn 构造附件受控地址(
    attachment_id: &str,
    session_id: &str,
    variant: &str,
) -> String {
    format!("/api/attachments/{attachment_id}/content?session_id={session_id}&variant={variant}")
}

/// preview_asset 只有在“附件真相确认有静态封面”且“当前请求带会话上下文”时才能被安全投影。
/// 这样 complete / locator / 房间快照都会复用同一条 still_url 生成规则，而不是各自手搓。
pub(super) fn 构造预览资源响应体(
    attachment_id: &str,
    session_id: Option<&str>,
    有预览图: bool,
) -> Option<serde_json::Value> {
    if !有预览图 {
        return None;
    }
    let session_id = session_id?;
    Some(serde_json::json!({
        "still_url": 构造附件受控地址(attachment_id, session_id, "thumbnail")
    }))
}

fn 媒体允许投影静态预览(kind: &application::媒体附件类型, 有预览图: bool) -> bool {
    matches!(kind, application::媒体附件类型::视频) && 有预览图
}

/// 图片 blob 主链统一收口到 `/api/media/{id}/blob/*`，
/// 避免前端继续把旧附件内容地址误认成正式资产地址。
fn 构造blob受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/media/{attachment_id}/blob/{variant}?session_id={session_id}")
}

fn blob媒体资产描述转响应体(
    asset: &contract::Blob媒体资产描述
) -> serde_json::Value {
    serde_json::json!({
        "asset_id": asset.资产标识,
        "content_hash": asset.内容哈希,
        "kind": 媒体资产种类转标签(&asset.种类),
        "variants": {
            "canonical": asset.canonical.as_ref().map(变体描述转响应体),
        },
        "distribution": asset.分发.as_ref().map(媒体分发描述转响应体),
        "origin": 媒体冷源描述转响应体(&asset.冷源),
    })
}

fn 构造单文件视频资产响应体(
    参数: 单文件视频资产响应参数<'_>
) -> serde_json::Value {
    let canonical = contract::变体描述 {
        标识: "canonical".to_string(),
        // 单文件视频的 canonical 地址就是同一个受控 Range 读取入口；
        // 分发、查看器、自动播和 web seed 都围绕这一份内容哈希协作，不能再分裂成 HLS/DASH 入口。
        mime_type: 参数.mime_type.to_string(),
        地址: 参数.canonical地址.clone(),
        宽: 参数.宽,
        高: 参数.高,
    };
    let distribution =
        从运行态协作分发响应提取共享分发表面(参数.分发快照, 参数.运行态分发);
    serde_json::json!({
        "asset_id": 参数.附件标识,
        "content_hash": 参数.分发快照.content_hash.clone(),
        "kind": 媒体资产种类转标签(&contract::媒体资产种类::单文件视频),
        "variants": {
            "canonical": 变体描述转响应体(&canonical),
        },
        "distribution": 媒体分发描述转响应体(&distribution),
        "origin": 媒体冷源描述转响应体(&application::构造媒体冷源描述(
            Some(参数.canonical地址.clone()),
            参数.原始冷源到期时间戳秒,
            参数.原始冷源删除时间戳秒,
            参数.当前时间戳秒,
        )),
    })
}

fn 构造blob媒体资产响应体(参数: Blob媒体资产响应参数<'_>) -> serde_json::Value {
    let canonical_url = 构造blob受控地址(参数.附件标识, 参数.会话标识, "canonical");
    let asset = contract::Blob媒体资产描述 {
        资产标识: 参数.附件标识.to_string(),
        内容哈希: 参数
            .分发快照
            .map(|snapshot| snapshot.content_hash.clone())
            .unwrap_or_else(|| 参数.附件标识.to_string()),
        种类: contract::媒体资产种类::图片Blob,
        canonical: Some(contract::变体描述 {
            标识: "canonical".to_string(),
            // canonical 是客户端预制后的唯一图片对象，后端只负责校验与受控分发。
            // MIME 继续来自附件 ready 真相，避免响应层重新猜测文件内容。
            mime_type: 参数.mime_type.to_string(),
            地址: canonical_url,
            宽: 参数.宽,
            高: 参数.高,
        }),
        分发: 参数.分发快照.and_then(|snapshot| {
            参数.运行态分发.map(|runtime| {
                从运行态协作分发响应提取共享分发表面(snapshot, runtime)
            })
        }),
        冷源: application::构造媒体冷源描述(
            Some(参数.旧原始地址),
            参数.原始冷源到期时间戳秒,
            参数.原始冷源删除时间戳秒,
            参数.当前时间戳秒,
        ),
    };
    blob媒体资产描述转响应体(&asset)
}

/// 统一把 ready 附件快照翻译成媒体资产协议面。
/// 这个拼装阶段只负责协议投影，不在这里发明新的媒体业务真相。
pub(super) fn 构造媒体资产响应体(
    snapshot: &application::媒体附件快照,
    上下文: 媒体资产响应上下文<'_>,
) -> Option<serde_json::Value> {
    match &snapshot.种类 {
        application::媒体附件类型::视频 => Some(构造单文件视频资产响应体(
            单文件视频资产响应参数 {
                附件标识: snapshot.附件标识.as_str(),
                运行态分发: 上下文.运行态分发?,
                分发快照: 上下文.分发快照?,
                canonical地址: 上下文.原始地址,
                mime_type: snapshot.mime_type.as_str(),
                宽: Some(snapshot.宽),
                高: Some(snapshot.高),
                原始冷源到期时间戳秒: 上下文.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: 上下文.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            },
        )),
        application::媒体附件类型::图片 => {
            Some(构造blob媒体资产响应体(Blob媒体资产响应参数 {
                附件标识: snapshot.附件标识.as_str(),
                会话标识: 上下文.会话标识,
                运行态分发: 上下文.运行态分发,
                分发快照: 上下文.分发快照,
                旧原始地址: 上下文.原始地址,
                mime_type: snapshot.mime_type.as_str(),
                宽: Some(snapshot.宽),
                高: Some(snapshot.高),
                原始冷源到期时间戳秒: 上下文.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: 上下文.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }))
        }
    }
}

fn 构造定位媒体资产响应体(
    locator: &application::媒体定位结果,
    上下文: 定位媒体资产响应上下文<'_>,
) -> Option<(&'static str, serde_json::Value)> {
    match &locator.种类 {
        application::媒体附件类型::视频 => Some((
            "file_asset",
            构造单文件视频资产响应体(单文件视频资产响应参数 {
                附件标识: locator.附件标识.as_str(),
                运行态分发: 上下文.运行态分发?,
                分发快照: locator.协作分发.as_ref()?,
                canonical地址: 上下文.原始地址,
                mime_type: locator.mime_type.as_str(),
                宽: locator.宽,
                高: locator.高,
                原始冷源到期时间戳秒: locator.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: locator.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }),
        )),
        application::媒体附件类型::图片 => Some((
            "blob_asset",
            构造blob媒体资产响应体(Blob媒体资产响应参数 {
                附件标识: locator.附件标识.as_str(),
                会话标识: 上下文.会话标识,
                运行态分发: 上下文.运行态分发,
                分发快照: locator.协作分发.as_ref(),
                旧原始地址: 上下文.原始地址,
                mime_type: locator.mime_type.as_str(),
                宽: locator.宽,
                高: locator.高,
                原始冷源到期时间戳秒: locator.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: locator.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }),
        )),
    }
}

pub(super) fn 媒体附件快照转响应体(
    snapshot: &application::媒体附件快照,
    media_asset: Option<serde_json::Value>,
    preview_asset: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut response = serde_json::json!({
        "attachment_id": snapshot.附件标识,
        "kind": 媒体类型转标签(&snapshot.种类),
        "mime_type": snapshot.mime_type,
        "byte_size": snapshot.字节大小,
        "width": snapshot.宽,
        "height": snapshot.高,
        "status": 附件状态转标签(&snapshot.状态),
    });
    if let Some(media_asset) = media_asset {
        response["media_asset"] = media_asset;
    }
    if let Some(preview_asset) = preview_asset {
        response["preview_asset"] = preview_asset;
    }
    response
}

/// 连接窗口状态只属于运行态调度，不进入持久化真相。
const 连接窗口状态最大保留秒: i64 = 60 * 60;
const 连接窗口状态清理阈值: usize = 4096;

fn 构造协作分发连接窗口键(attachment_id: &str, session_id: &str) -> String {
    format!("{attachment_id}:{session_id}")
}

/// 统一裁决“连接群友 <-> 无在线种子”的轮转节奏。
///
/// 规则：
/// 1. 没有窗口起点时，首次进入 `MEDIA_CONNECTING_TO_PEERS`；
/// 2. 起点后的前 8 秒保持连接态；
/// 3. 8 秒后进入 `MEDIA_NO_ONLINE_SEED`；
/// 4. 15 秒重试预算到点后，开启下一轮连接态。
fn 裁决连接群友窗口轮转(
    窗口起点秒: Option<i64>,
    当前时间戳秒: i64,
) -> (i64, &'static str, i64) {
    let 无在线种子重试周期秒 = media_distribution::无在线种子默认重试毫秒 / 1_000;
    let 当前起点秒 = 窗口起点秒.unwrap_or(当前时间戳秒);
    let 已过去秒 = 当前时间戳秒.saturating_sub(当前起点秒);

    if 窗口起点秒.is_none() || 已过去秒 >= 无在线种子重试周期秒 {
        return (
            当前时间戳秒,
            media_distribution::媒体状态连接群友中,
            media_distribution::连接群友默认重试毫秒,
        );
    }

    if 已过去秒 < media_distribution::连接群友窗口秒 {
        (
            当前起点秒,
            media_distribution::媒体状态连接群友中,
            media_distribution::连接群友默认重试毫秒,
        )
    } else {
        (
            当前起点秒,
            media_distribution::媒体状态无在线种子,
            media_distribution::无在线种子默认重试毫秒,
        )
    }
}

/// 把后端连接窗口节奏收口到 locator 运行态：
/// 1. `READY/DELETED` 清理窗口；
/// 2. `NO_ONLINE_SEED` 按 8 秒连接 + 15 秒重试周期轮转；
/// 3. `CONNECTING_TO_PEERS` 写回短重试节奏，避免壳层自猜。
fn 同步协作分发连接窗口状态(
    state: &应用状态,
    attachment_id: &str,
    session_id: &str,
    当前时间戳秒: i64,
    运行态分发: &mut serde_json::Value,
) {
    let Some(分发表面) = 运行态分发.as_object_mut() else {
        return;
    };
    let Some(媒体状态) = 分发表面
        .get_mut("media_state")
        .and_then(|value| value.as_object_mut())
    else {
        return;
    };
    let Some(状态码) = 媒体状态
        .get("code")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return;
    };
    let 键 = 构造协作分发连接窗口键(attachment_id, session_id);
    let Ok(mut 窗口表) = state.swarm_connecting_window_started_at.lock() else {
        return;
    };

    if 窗口表.len() > 连接窗口状态清理阈值 {
        窗口表.retain(|_, 起点秒| {
            当前时间戳秒.saturating_sub(*起点秒) <= 连接窗口状态最大保留秒
        });
    }

    match 状态码.as_str() {
        media_distribution::媒体状态已就绪 | media_distribution::媒体状态已删除 => {
            窗口表.remove(&键);
        }
        media_distribution::媒体状态连接群友中 => {
            窗口表.entry(键).or_insert(当前时间戳秒);
            媒体状态.insert(
                "retry_after_ms".to_string(),
                serde_json::json!(media_distribution::连接群友默认重试毫秒),
            );
        }
        media_distribution::媒体状态无在线种子 => {
            let (新起点秒, 新状态码, 重试毫秒) =
                裁决连接群友窗口轮转(窗口表.get(&键).copied(), 当前时间戳秒);
            窗口表.insert(键, 新起点秒);
            媒体状态.insert("code".to_string(), serde_json::json!(新状态码));
            媒体状态.insert("retry_after_ms".to_string(), serde_json::json!(重试毫秒));
        }
        _ => {}
    }
}

/// locator 只暴露受控 transport 线索：
/// - 当前先统一收口成受控 HTTP 内容地址；
/// - 后续接入 WebTorrent/锚点时，也继续在这里追加 transport 线索，而不是把存储键下发给壳层。
pub(super) async fn load_media_locator(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let locator = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        协作分发应用::查询媒体定位(&repo, &attachment_id_for_usecase, &session_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(locator)) => locator,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("locator 任务执行失败: {err}"),
            );
        }
    };
    let original_url = 构造附件受控地址(
        attachment_id.as_str(),
        query.session_id.as_str(),
        "original",
    );
    let 允许静态预览 = 媒体允许投影静态预览(&locator.种类, locator.允许缩略图);
    let thumbnail_url = 允许静态预览.then(|| {
        构造附件受控地址(
            attachment_id.as_str(),
            query.session_id.as_str(),
            "thumbnail",
        )
    });
    let preview_asset = 构造预览资源响应体(
        attachment_id.as_str(),
        Some(query.session_id.as_str()),
        允许静态预览,
    );
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
        &headers,
    );
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let 冷源仍可用 = application::冷源当前可用(
        Some(original_url.as_str()),
        locator.原始冷源到期时间戳秒,
        locator.原始冷源删除时间戳秒,
        now_epoch秒,
    );
    let mut runtime_distribution = locator.协作分发.as_ref().map(|snapshot| {
        media_distribution::协作分发快照转响应值(
            snapshot,
            media_distribution::协作分发响应上下文 {
                attachment_id: attachment_id.as_str(),
                session_id: query.session_id.as_str(),
                tracker_public_url: tracker_public_url.as_str(),
                web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                ticket_secret: state.swarm_ticket_secret.as_deref(),
                ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                冷源仍可用,
                附件已删除: locator.状态 == application::附件状态读取结果::已过期,
                now_epoch秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
            },
        )
    });
    if let Some(distribution) = runtime_distribution.as_mut() {
        同步协作分发连接窗口状态(
            &state,
            attachment_id.as_str(),
            query.session_id.as_str(),
            now_epoch秒,
            distribution,
        );
    }
    let mut response = serde_json::json!({
        "attachment_id": locator.附件标识,
        "kind": 媒体类型转标签(&locator.种类),
        "status": 附件状态转标签(&locator.状态),
        "preview_asset": preview_asset,
        "thumbnail_url": thumbnail_url,
        "distribution": runtime_distribution.clone(),
    });
    if let Some((field, asset)) = 构造定位媒体资产响应体(
        &locator,
        定位媒体资产响应上下文 {
            运行态分发: runtime_distribution.as_ref(),
            // 顶层 locator 已不再重复暴露 original_url；
            // 资产投影继续直接复用这份受控冷源地址，避免再从响应 JSON 倒读一遍兼容别名。
            原始地址: original_url.clone(),
            会话标识: query.session_id.as_str(),
            当前时间戳秒: now_epoch秒,
        },
    ) {
        response[field] = asset;
    }
    (StatusCode::OK, Json(response)).into_response()
}

/// blob 图片主链只是旧附件内容读取链的受控别名：
/// - canonical 走附件 storage_key 真相；
/// - 旧 preview/full/original 不再作为正式图片资产入口；
/// - 这样能把正式地址身份切到 `/api/media/.../blob/canonical`，同时不复制第二套读取实现。
pub(super) async fn load_blob_asset_content(
    State(state): State<应用状态>,
    Path((attachment_id, blob_variant)): Path<(String, String)>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_session_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let attachment_variant = match blob_variant.as_str() {
        "canonical" => application::附件内容变体::原图,
        _ => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "blob variant 必须是 canonical",
            );
        }
    };
    读取受控附件内容响应(
        state,
        attachment_id,
        query.session_id,
        attachment_variant,
        headers,
    )
    .await
    .into_response()
}

async fn 读取受控附件内容响应(
    state: 应用状态,
    attachment_id: String,
    session_id: String,
    variant: application::附件内容变体,
    headers: HeaderMap,
) -> axum::response::Response {
    tracing::info!(
        application = "读取附件内容",
        adapter = "http",
        outcome = "accepted",
        request_kind = "附件内容读取",
        attachment_id = attachment_id.as_str(),
        session_id = session_id.as_str(),
        "HTTP 请求已受理"
    );

    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        协作分发应用::读取附件内容(
            &repo,
            &attachment_id_for_usecase,
            &session_id_for_usecase,
            variant,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "读取附件内容任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };

    let target = match result {
        Ok(target) => target,
        Err((status, code, message)) => {
            tracing::warn!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "rejected",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = code,
                "读取附件内容被拒绝"
            );
            return err_resp(status, code, message);
        }
    };

    let object_path = ObjectPath::from(target.存储键.clone());
    let range = if headers.contains_key(header::RANGE) {
        let head_result = match state.attachment_store.head(&object_path).await {
            Ok(meta) => meta,
            Err(err) => {
                tracing::error!(
                    application = "读取附件内容",
                    adapter = "http",
                    outcome = "failed",
                    request_kind = "附件内容读取",
                    attachment_id = attachment_id.as_str(),
                    session_id = session_id.as_str(),
                    error_code = "system_error",
                    error = %err,
                    "对象存储读取元数据失败"
                );
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "附件内容读取失败",
                );
            }
        };
        match 解析标准字节范围(headers.get(header::RANGE), head_result.size) {
            Ok(range) => range,
            Err((status, code, message)) => return err_resp(status, code, message),
        }
    } else {
        None
    };
    let get_result = match range.as_ref() {
        Some(range) => {
            state
                .attachment_store
                .get_opts(
                    &object_path,
                    GetOptions::new().with_range(Some(range.请求.clone())),
                )
                .await
        }
        None => state.attachment_store.get(&object_path).await,
    };
    let get_result = match get_result {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "对象存储读取失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "附件内容读取失败",
            );
        }
    };
    let object_size = get_result.meta.size;
    let body = match get_result.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "对象内容读取失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "附件内容读取失败",
            );
        }
    };

    tracing::info!(
        application = "读取附件内容",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "附件内容读取",
        attachment_id = attachment_id.as_str(),
        session_id = session_id.as_str(),
        "读取附件内容成功"
    );
    match range {
        Some(range) => (
            StatusCode::PARTIAL_CONTENT,
            [
                (header::CONTENT_TYPE, target.mime_type),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (
                    header::CONTENT_RANGE,
                    构造content_range值(&range, object_size),
                ),
            ],
            body,
        )
            .into_response(),
        None => (
            [
                (header::CONTENT_TYPE, target.mime_type),
                (header::ACCEPT_RANGES, "bytes".to_string()),
            ],
            body,
        )
            .into_response(),
    }
}

/// 冷路径：受控读取附件对应的 torrent metainfo。
/// 它先复用 locator 的成员资格与 ready 校验，再返回稳定 metainfo 字节。
pub(super) async fn load_media_torrent(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let torrent_result = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        协作分发应用::查询媒体定位(&repo, &attachment_id_for_usecase, &session_id_for_usecase)
            .map_err(map_domain_err_tuple)?;
        crate::media::application::读取协作分发torrent元信息(&repo, &attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(torrent)) => torrent,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("torrent 任务执行失败: {err}"),
            );
        }
    };
    let Some(torrent) = torrent_result else {
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "附件已就绪但缺少 torrent 元信息",
        );
    };
    (
        [(header::CONTENT_TYPE, "application/x-bittorrent")],
        torrent.torrent_bytes,
    )
        .into_response()
}

/// cooperative 分发 presence 只回答“当前会话仍在参与这份附件的协作分发”。
/// 真正能不能看这份附件，仍然必须复用现有 locator 可见性主链来裁决。
pub(super) async fn update_media_distribution_presence(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
    body: Bytes,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let presence_payload = match parse_distribution_presence_payload(body.as_ref()) {
        Ok(payload) => payload,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        crate::media::application::写入协作分发存活(
            &mut repo,
            &application::协作分发存活写入请求 {
                附件标识: attachment_id_for_usecase,
                会话标识: session_id_for_usecase,
                存活类型: presence_payload.peer_kind.clone(),
                最近peer存活时间戳秒: now_epoch秒,
            },
        )
        .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("presence 任务执行失败: {err}"),
            );
        }
    };
    StatusCode::NO_CONTENT.into_response()
}

/// 冷路径：受控读取附件内容。
pub(super) async fn load_attachment_content(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "rejected",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                error_code = code,
                "读取附件内容缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    读取受控附件内容响应(
        state,
        attachment_id,
        query.session_id,
        query.variant,
        headers,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 连接窗口首次探测会进入连接群友态() {
        let (起点秒, 状态码, 重试毫秒) = 裁决连接群友窗口轮转(None, 1_000);
        assert_eq!(起点秒, 1_000);
        assert_eq!(状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(重试毫秒, media_distribution::连接群友默认重试毫秒);
    }

    #[test]
    fn 连接窗口预算内保持连接群友态预算后进入无在线种子态() {
        let (预算内起点秒, 预算内状态码, 预算内重试毫秒) =
            裁决连接群友窗口轮转(Some(1_000), 1_007);
        assert_eq!(预算内起点秒, 1_000);
        assert_eq!(预算内状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(预算内重试毫秒, media_distribution::连接群友默认重试毫秒);

        let (预算后起点秒, 预算后状态码, 预算后重试毫秒) =
            裁决连接群友窗口轮转(Some(1_000), 1_010);
        assert_eq!(预算后起点秒, 1_000);
        assert_eq!(预算后状态码, media_distribution::媒体状态无在线种子);
        assert_eq!(预算后重试毫秒, media_distribution::无在线种子默认重试毫秒);
    }

    #[test]
    fn 无在线种子重试周期到点后会开启下一轮连接群友态() {
        let (新起点秒, 状态码, 重试毫秒) = 裁决连接群友窗口轮转(Some(1_000), 1_016);
        assert_eq!(新起点秒, 1_016);
        assert_eq!(状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(重试毫秒, media_distribution::连接群友默认重试毫秒);
    }
}
