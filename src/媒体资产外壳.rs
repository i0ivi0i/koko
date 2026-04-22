use super::{err_resp, map_domain_err_tuple, 应用状态, 构建共享仓储, 流媒体打包};
use crate::{contract, media_distribution, usecase};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use object_store::{path::Path as ObjectPath, GetOptions, GetRange, ObjectMeta, ObjectStoreExt};
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::task;

/// 附件内容 query 的内部稳定形状。
struct ParsedAttachmentContentQuery {
    session_id: String,
    variant: usecase::附件内容变体,
}

/// 流媒体资源 query 的内部稳定形状。
struct ParsedStreamingAssetQuery {
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
    pub 分发快照: Option<&'a usecase::协作分发元数据快照>,
    pub 流媒体清单: Option<&'a usecase::流媒体清单快照>,
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

/// 流媒体资产的协议拼装参数。
struct 流媒体资产响应参数<'a> {
    附件标识: &'a str,
    运行态分发: &'a serde_json::Value,
    分发快照: &'a usecase::协作分发元数据快照,
    流媒体清单: Option<&'a usecase::流媒体清单快照>,
    原始地址: String,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    会话标识: &'a str,
    当前时间戳秒: i64,
}

/// 单文件视频资产的协议拼装参数。
struct 单文件视频资产响应参数<'a> {
    附件标识: &'a str,
    运行态分发: &'a serde_json::Value,
    分发快照: &'a usecase::协作分发元数据快照,
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
    分发快照: Option<&'a usecase::协作分发元数据快照>,
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
        None | Some("original") => usecase::附件内容变体::原图,
        Some("thumbnail") => usecase::附件内容变体::缩略图,
        Some(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "variant 必须是 original 或 thumbnail",
            ))
        }
    };
    Ok(ParsedAttachmentContentQuery {
        session_id: session_id.to_string(),
        variant,
    })
}

fn parse_streaming_asset_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedStreamingAssetQuery, (StatusCode, &'static str, &'static str)> {
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
    Ok(ParsedStreamingAssetQuery {
        session_id: session_id.to_string(),
    })
}

fn parse_distribution_presence_payload(
    raw_body: &[u8],
) -> Result<ParsedDistributionPresencePayload, (StatusCode, &'static str, String)> {
    if raw_body.is_empty() {
        return Ok(ParsedDistributionPresencePayload {
            peer_kind: usecase::协作分发存活类型旁观意图.to_string(),
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
        .unwrap_or(usecase::协作分发存活类型旁观意图);
    if !usecase::是有效协作分发存活类型(peer_kind) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!(
                "peer_kind 仅支持 {} / {} / {}",
                usecase::协作分发存活类型旁观意图,
                usecase::协作分发存活类型完整peer,
                usecase::协作分发存活类型后端强种子
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

fn 流媒体清单缓存控制值() -> &'static str {
    // manifest 是“当前标准流媒体平面是否仍然成立”的入口真相。
    // 即使正文可被本地缓存，也必须每次先回源重验证，避免沿用已退场清单。
    "private, no-cache"
}

fn 流媒体分段缓存控制值() -> &'static str {
    // segment 在服务端 24 小时标准流媒体窗口内属于稳定对象：
    // 1. 允许浏览器在当前会话内强复用，降低重复观看时的源站压力；
    // 2. 标成 private，避免带 session_id 的受控 URL 被共享缓存误存；
    // 3. 生命周期由服务端清理任务兜底，窗口内可以安全 immutable。
    "private, max-age=86400, immutable"
}

fn 构造流媒体对象etag(meta: &ObjectMeta, asset_path: &str) -> String {
    if let Some(raw) = meta
        .e_tag
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if raw.starts_with("W/\"") || (raw.starts_with('"') && raw.ends_with('"')) {
            return raw.to_string();
        }
        return format!("\"{raw}\"");
    }
    // 本地文件对象存储未必原生提供 e_tag，这里退回到“路径 + 长度 + 最后修改时间”组成的弱校验值。
    // 对当前受控清单读取来说，这已经足够支撑浏览器条件请求，而不用额外读取正文做哈希。
    let normalized_path = asset_path.replace(['/', '\\', ':', '.'], "_");
    format!(
        "W/\"{}-{}-{normalized_path}\"",
        meta.size,
        meta.last_modified.timestamp_millis(),
    )
}

fn 构造流媒体对象最后修改时间(meta: &ObjectMeta) -> String {
    let last_modified: SystemTime = meta.last_modified.into();
    httpdate::fmt_http_date(last_modified)
}

fn 请求命中if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .any(|candidate| candidate == "*" || candidate == etag)
        })
        .unwrap_or(false)
}

fn 请求命中if_modified_since(headers: &HeaderMap, meta: &ObjectMeta) -> bool {
    let Some(raw) = headers
        .get(header::IF_MODIFIED_SINCE)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Ok(since) = httpdate::parse_http_date(raw) else {
        return false;
    };
    let last_modified: SystemTime = meta.last_modified.into();
    // HTTP-date 只有秒级精度；这里按秒对齐，避免对象存储里的毫秒时间把本可命中的条件请求误判成未命中。
    let since_epoch_secs = since
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_secs());
    let last_modified_epoch_secs = last_modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_secs());
    match (since_epoch_secs, last_modified_epoch_secs) {
        (Some(since), Some(last_modified)) => since >= last_modified,
        _ => false,
    }
}

/// 下面这组 helper 的 owner 已经跟着“媒体资产外壳”一起迁移。
/// 原因是它们表达的是媒体资产 HTTP 协议面，而不是房间查询协议面；
/// 继续留在房间壳只会让兄弟模块反向依赖一个并不拥有该真相的文件。
pub(super) fn 媒体类型转标签(kind: &usecase::媒体附件类型) -> &'static str {
    match kind {
        usecase::媒体附件类型::图片 => "image",
        usecase::媒体附件类型::视频 => "video",
    }
}

fn 附件状态转标签(status: &usecase::附件状态读取结果) -> &'static str {
    match status {
        usecase::附件状态读取结果::已准备 => "prepared",
        usecase::附件状态读取结果::上传中 => "uploading",
        usecase::附件状态读取结果::处理中 => "processing",
        usecase::附件状态读取结果::就绪 => "ready",
        usecase::附件状态读取结果::失败 => "failed",
        usecase::附件状态读取结果::已过期 => "expired",
    }
}

fn 媒体资产种类转标签(kind: &contract::媒体资产种类) -> &'static str {
    match kind {
        contract::媒体资产种类::图片Blob => "blob_image",
        contract::媒体资产种类::单文件视频 => "file_video",
        contract::媒体资产种类::流媒体视频 => "streaming_video",
        contract::媒体资产种类::流媒体音频 => "streaming_audio",
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

fn 媒体清单描述转响应体(manifest: &contract::媒体清单描述) -> serde_json::Value {
    serde_json::json!({
        "hls_master_url": manifest.hls主清单地址,
        "dash_mpd_url": manifest.dash主清单地址,
    })
}

fn 流媒体生命周期描述转响应体(
    lifecycle: &contract::流媒体生命周期描述,
) -> serde_json::Value {
    serde_json::json!({
        "streaming_expires_at": lifecycle.streaming到期时间戳秒,
        "streaming_deleted_at": lifecycle.streaming删除时间戳秒,
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
    snapshot: &usecase::协作分发元数据快照,
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

/// 旧附件内容读取路由仍要保留给兼容调用方和冷源 origin。
/// 但它不再承担图片正式 blob 主链的地址身份。
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

fn 媒体允许投影静态预览(kind: &usecase::媒体附件类型, 有预览图: bool) -> bool {
    matches!(kind, usecase::媒体附件类型::视频) && 有预览图
}

/// 图片 blob 主链统一收口到 `/api/media/{id}/blob/*`，
/// 避免前端继续把旧附件内容地址误认成正式资产地址。
fn 构造blob受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/media/{attachment_id}/blob/{variant}?session_id={session_id}")
}

fn 流媒体资产描述转响应体(asset: &contract::流媒体资产描述) -> serde_json::Value {
    serde_json::json!({
        "asset_id": asset.资产标识,
        "content_hash": asset.内容哈希,
        "kind": 媒体资产种类转标签(&asset.种类),
        "manifest": 媒体清单描述转响应体(&asset.清单),
        "lifecycle": 流媒体生命周期描述转响应体(&asset.生命周期),
        "distribution": 媒体分发描述转响应体(&asset.分发),
        "origin": 媒体冷源描述转响应体(&asset.冷源),
    })
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

fn 构造流媒体资产响应体(参数: 流媒体资产响应参数<'_>) -> serde_json::Value {
    // `streaming_deleted_at` 是服务端流媒体入口的退场事实。
    // 事实一旦写入，locator/complete 仍可继续告知生命周期与 peer-only 分发，
    // 但不能再把 HLS/DASH manifest 地址投影给前端，避免服务器冷备悄悄复活成长期主链。
    let 流媒体入口仍可暴露 = 参数
        .流媒体清单
        .is_some_and(|manifest| manifest.streaming删除时间戳秒.is_none());
    let asset = contract::流媒体资产描述 {
        // 真实独立 media_asset_id 还没落表前，先显式复用 attachment_id 当稳定资产锚点；
        // 这样能把共享协议面立起来，但不会伪造第二个尚不存在的权威主键。
        资产标识: 参数.附件标识.to_string(),
        内容哈希: 参数.分发快照.content_hash.clone(),
        种类: contract::媒体资产种类::流媒体视频,
        清单: contract::媒体清单描述 {
            hls主清单地址: if 流媒体入口仍可暴露 {
                参数.流媒体清单.map(|manifest| {
                    流媒体打包::构造流媒体受控地址(
                        参数.附件标识,
                        参数.会话标识,
                        流媒体打包::流媒体存储键转受控路径(
                            参数.附件标识,
                            manifest.hls主清单存储键.as_str(),
                        ),
                    )
                })
            } else {
                None
            },
            dash主清单地址: if 流媒体入口仍可暴露 {
                参数.流媒体清单.map(|manifest| {
                    流媒体打包::构造流媒体受控地址(
                        参数.附件标识,
                        参数.会话标识,
                        流媒体打包::流媒体存储键转受控路径(
                            参数.附件标识,
                            manifest.dash主清单存储键.as_str(),
                        ),
                    )
                })
            } else {
                None
            },
        },
        生命周期: contract::流媒体生命周期描述 {
            streaming到期时间戳秒: 参数.流媒体清单.and_then(|manifest| {
                manifest
                    .streaming到期时间戳秒
                    .map(|value| value.to_string())
            }),
            streaming删除时间戳秒: 参数.流媒体清单.and_then(|manifest| {
                manifest
                    .streaming删除时间戳秒
                    .map(|value| value.to_string())
            }),
        },
        分发: 从运行态协作分发响应提取共享分发表面(
            参数.分发快照,
            参数.运行态分发,
        ),
        冷源: usecase::构造媒体冷源描述(
            Some(参数.原始地址),
            参数.原始冷源到期时间戳秒,
            参数.原始冷源删除时间戳秒,
            参数.当前时间戳秒,
        ),
    };
    流媒体资产描述转响应体(&asset)
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
        "manifest": serde_json::Value::Null,
        "lifecycle": serde_json::Value::Null,
        "distribution": 媒体分发描述转响应体(&distribution),
        "origin": 媒体冷源描述转响应体(&usecase::构造媒体冷源描述(
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
        冷源: usecase::构造媒体冷源描述(
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
    snapshot: &usecase::媒体附件快照,
    上下文: 媒体资产响应上下文<'_>,
) -> Option<serde_json::Value> {
    match &snapshot.种类 {
        usecase::媒体附件类型::视频 => {
            if 上下文.流媒体清单.is_some() {
                return Some(构造流媒体资产响应体(流媒体资产响应参数 {
                    附件标识: snapshot.附件标识.as_str(),
                    运行态分发: 上下文.运行态分发?,
                    分发快照: 上下文.分发快照?,
                    流媒体清单: 上下文.流媒体清单,
                    原始地址: 上下文.原始地址,
                    原始冷源到期时间戳秒: 上下文.原始冷源到期时间戳秒,
                    原始冷源删除时间戳秒: 上下文.原始冷源删除时间戳秒,
                    会话标识: 上下文.会话标识,
                    当前时间戳秒: 上下文.当前时间戳秒,
                }));
            }
            Some(构造单文件视频资产响应体(
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
            ))
        }
        usecase::媒体附件类型::图片 => {
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
    locator: &usecase::媒体定位结果,
    上下文: 定位媒体资产响应上下文<'_>,
) -> Option<(&'static str, serde_json::Value)> {
    match &locator.种类 {
        usecase::媒体附件类型::视频 => {
            if locator.流媒体清单.is_some() {
                return Some((
                    "streaming_asset",
                    构造流媒体资产响应体(流媒体资产响应参数 {
                        附件标识: locator.附件标识.as_str(),
                        运行态分发: 上下文.运行态分发?,
                        分发快照: locator.协作分发.as_ref()?,
                        流媒体清单: locator.流媒体清单.as_ref(),
                        原始地址: 上下文.原始地址,
                        原始冷源到期时间戳秒: locator.原始冷源到期时间戳秒,
                        原始冷源删除时间戳秒: locator.原始冷源删除时间戳秒,
                        会话标识: 上下文.会话标识,
                        当前时间戳秒: 上下文.当前时间戳秒,
                    }),
                ));
            }
            Some((
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
            ))
        }
        usecase::媒体附件类型::图片 => Some((
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
    snapshot: &usecase::媒体附件快照,
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
        usecase::查询媒体定位(&repo, &attachment_id_for_usecase, &session_id_for_usecase)
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
            )
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
    let 冷源仍可用 = usecase::冷源当前可用(
        Some(original_url.as_str()),
        locator.原始冷源到期时间戳秒,
        locator.原始冷源删除时间戳秒,
        now_epoch秒,
    );
    let runtime_distribution = locator.协作分发.as_ref().map(|snapshot| {
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
                now_epoch秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
            },
        )
    });
    let mut response = serde_json::json!({
        "attachment_id": locator.附件标识,
        "kind": 媒体类型转标签(&locator.种类),
        "status": 附件状态转标签(&locator.状态),
        "original_url": original_url,
        "preview_asset": preview_asset,
        "thumbnail_url": thumbnail_url,
        "distribution": runtime_distribution.clone(),
    });
    if let Some((field, asset)) = 构造定位媒体资产响应体(
        &locator,
        定位媒体资产响应上下文 {
            运行态分发: runtime_distribution.as_ref(),
            原始地址: response["original_url"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_default(),
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
    let query = match parse_streaming_asset_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let attachment_variant = match blob_variant.as_str() {
        "canonical" => usecase::附件内容变体::原图,
        _ => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "blob variant 必须是 canonical",
            )
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
    variant: usecase::附件内容变体,
    headers: HeaderMap,
) -> axum::response::Response {
    tracing::info!(
        usecase = "读取附件内容",
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
        usecase::读取附件内容(
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
                usecase = "读取附件内容",
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
                usecase = "读取附件内容",
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
                    usecase = "读取附件内容",
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
                usecase = "读取附件内容",
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
                usecase = "读取附件内容",
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
        usecase = "读取附件内容",
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

/// 冷路径：受控读取流媒体主链产物。
/// manifest 会被动态重写成带 session_id 的受控 URL，避免浏览器顺着相对路径绕过成员校验。
pub(super) async fn load_streaming_asset_content(
    State(state): State<应用状态>,
    Path((attachment_id, asset_path)): Path<(String, String)>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_streaming_asset_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let asset_path = asset_path.trim().trim_start_matches('/').to_string();
    if asset_path.is_empty()
        || asset_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !(asset_path.starts_with("hls/") || asset_path.starts_with("dash/"))
    {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "流媒体资源路径非法",
        );
    }

    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let locator = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        usecase::查询媒体定位(&repo, &attachment_id_for_usecase, &session_id_for_usecase)
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
                format!("流媒体资产读取任务执行失败: {err}"),
            )
        }
    };
    if !matches!(locator.种类, usecase::媒体附件类型::视频) {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "attachment_type_not_supported",
            "当前附件不是流媒体视频",
        );
    }
    if locator.流媒体清单.is_none() {
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "流媒体清单尚未准备完成",
        );
    }
    if locator
        .流媒体清单
        .as_ref()
        .and_then(|manifest| manifest.streaming删除时间戳秒)
        .is_some()
    {
        // 这里直接拦住对象存储读取，避免已退场的服务端流媒体平面被旧 URL 或缓存路径继续命中。
        return err_resp(
            StatusCode::NOT_FOUND,
            "attachment_not_ready",
            "流媒体冷备窗口已结束",
        );
    }

    let object_path = ObjectPath::from(流媒体打包::推导流媒体对象存储键(
        attachment_id.as_str(),
        asset_path.as_str(),
    ));
    if asset_path.ends_with(".m3u8") || asset_path.ends_with(".mpd") {
        let head_result = match state.attachment_store.head(&object_path).await {
            Ok(meta) => meta,
            Err(err) => {
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("读取流媒体清单元数据失败: {err}"),
                )
            }
        };
        let etag = 构造流媒体对象etag(&head_result, asset_path.as_str());
        let last_modified = 构造流媒体对象最后修改时间(&head_result);
        if 请求命中if_none_match(&headers, etag.as_str())
            || 请求命中if_modified_since(&headers, &head_result)
        {
            return (
                StatusCode::NOT_MODIFIED,
                [
                    (header::CACHE_CONTROL, 流媒体清单缓存控制值().to_string()),
                    (header::ETAG, etag),
                    (header::LAST_MODIFIED, last_modified),
                ],
            )
                .into_response();
        }
        let get_result = match state.attachment_store.get(&object_path).await {
            Ok(result) => result,
            Err(err) => {
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("读取流媒体清单失败: {err}"),
                )
            }
        };
        let body = match get_result.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("读取流媒体清单内容失败: {err}"),
                )
            }
        };
        let text = match String::from_utf8(body.to_vec()) {
            Ok(text) => text,
            Err(_) => {
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "流媒体清单不是合法 UTF-8",
                )
            }
        };
        let rewritten = if asset_path.ends_with(".m3u8") {
            流媒体打包::重写_hls清单内容(
                attachment_id.as_str(),
                query.session_id.as_str(),
                asset_path.as_str(),
                text.as_str(),
            )
        } else {
            流媒体打包::重写_dash清单内容(
                attachment_id.as_str(),
                query.session_id.as_str(),
                asset_path.as_str(),
                text.as_str(),
            )
        };
        return (
            [
                (
                    header::CONTENT_TYPE,
                    流媒体打包::推导流媒体内容类型(asset_path.as_str()).to_string(),
                ),
                (header::CACHE_CONTROL, 流媒体清单缓存控制值().to_string()),
                (header::ETAG, etag),
                (header::LAST_MODIFIED, last_modified),
            ],
            rewritten,
        )
            .into_response();
    }

    let range = if headers.contains_key(header::RANGE) {
        let head_result = match state.attachment_store.head(&object_path).await {
            Ok(meta) => meta,
            Err(err) => {
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("读取流媒体对象元数据失败: {err}"),
                )
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
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("读取流媒体对象失败: {err}"),
            )
        }
    };
    let object_last_modified = 构造流媒体对象最后修改时间(&get_result.meta);
    let object_size = get_result.meta.size;
    let body = match get_result.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("读取流媒体对象内容失败: {err}"),
            )
        }
    };
    match range {
        Some(range) => (
            StatusCode::PARTIAL_CONTENT,
            [
                (
                    header::CONTENT_TYPE,
                    流媒体打包::推导流媒体内容类型(asset_path.as_str()).to_string(),
                ),
                (header::CACHE_CONTROL, 流媒体分段缓存控制值().to_string()),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (
                    header::CONTENT_RANGE,
                    构造content_range值(&range, object_size),
                ),
                (header::LAST_MODIFIED, object_last_modified.clone()),
            ],
            body,
        )
            .into_response(),
        None => (
            [
                (
                    header::CONTENT_TYPE,
                    流媒体打包::推导流媒体内容类型(asset_path.as_str()).to_string(),
                ),
                (header::CACHE_CONTROL, 流媒体分段缓存控制值().to_string()),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (header::LAST_MODIFIED, object_last_modified),
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
        usecase::查询媒体定位(&repo, &attachment_id_for_usecase, &session_id_for_usecase)
            .map_err(map_domain_err_tuple)?;
        usecase::读取协作分发torrent元信息(&repo, &attachment_id_for_usecase)
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
            )
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
        usecase::写入协作分发存活(
            &mut repo,
            &usecase::协作分发存活写入请求 {
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
            )
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
                usecase = "读取附件内容",
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
