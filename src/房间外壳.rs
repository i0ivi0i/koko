use super::{
    err_resp, events_to_json, map_domain_err_tuple, 流媒体打包, 应用状态, 构建共享仓储,
};
use crate::{contract, media_distribution, usecase};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use object_store::{path::Path as ObjectPath, GetOptions, GetRange, ObjectStoreExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::task;

/// 匿名身份引导请求体。
///
/// 这属于房间冷路径入口自己的协议形状，留在房间外壳最贴近真实调用方。
#[derive(Deserialize)]
pub(super) struct BootstrapBody {
    /// 新 MVP 的设备入口凭证。
    /// 当前 Web 会把它持久化在本地；未来 iOS/Android/CLI 可各自换存储实现。
    device_anonymous_token: Option<String>,
}

/// 进房请求体。
#[derive(Deserialize)]
pub(super) struct JoinBody {
    /// 当前会话标识。
    session_id: String,
    /// 用户输入的房间短码。
    room_code: String,
}

/// 阅读推进请求体。
#[derive(Deserialize)]
pub(super) struct UpdateReadAnchorBody {
    /// 当前会话标识。
    /// 这里仍使用稳定会话锚点承接调用身份，但最终阅读真相不会挂在 session 上。
    session_id: Option<String>,
    /// 本次确认已读到的最大事件位置。
    /// 它表达“用户阅读已经越过哪里”，不是滚动条像素位置。
    last_read_event_position: Option<i64>,
}

/// 房间快照查询参数。
#[derive(Deserialize)]
pub(super) struct SnapshotQuery {
    /// 请求方会话标识，用于成员资格校验。
    session_id: String,
}

/// 增量事件查询参数的内部稳定形状。
///
/// 仍然坚持先用宽松 query map 接住，再手动收口，避免让框架提前吐出项目外错误格式。
pub(super) struct ParsedEventsQuery {
    /// 请求方会话标识，用于会话有效性与成员资格校验。
    session_id: String,
    /// 从该事件位置之后开始拉取增量。
    from: i64,
}

/// 房间历史分页查询参数的内部稳定形状。
pub(super) struct ParsedHistoryQuery {
    /// 请求方会话标识，用于会话有效性与成员资格校验。
    session_id: String,
    /// 只返回严格早于该事件位置的消息。
    before_event_position: i64,
    /// 本页最多返回多少条消息。
    limit: i64,
}

/// 附件内容读取参数。
pub(super) struct ParsedAttachmentContentQuery {
    session_id: String,
    variant: usecase::附件内容变体,
}

/// 流媒体资产读取不需要 variant，但仍需要稳定会话锚点做可见性校验。
pub(super) struct ParsedStreamingAssetQuery {
    session_id: String,
}

/// 标准单段 bytes range。
/// 这里仍然只服务 HTTP adapter：
/// - 业务层不关心传输切片；
/// - shell 只负责把 Range 翻译成 object_store 的成熟能力；
/// - 目前先明确拒绝多段 range，避免在 Phase 2 提前手搓 multipart/byteranges。
struct 标准字节范围 {
    请求: GetRange,
    起始字节: u64,
    结束字节_不含: u64,
}

/// 先把宽松 query map 收口成稳定内部参数。
///
/// 这样缺参和格式错误也能继续走项目自己的错误 JSON，而不是被框架提前拦截。
pub(super) fn parse_events_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedEventsQuery, (StatusCode, &'static str, &'static str)> {
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
    let Some(from_raw) = raw_query
        .get("from")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "缺少 from"));
    };
    let Ok(from) = from_raw.parse::<i64>() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "from 必须是整数",
        ));
    };
    Ok(ParsedEventsQuery {
        session_id: session_id.to_string(),
        from,
    })
}

/// 先把宽松 query map 收口成历史分页的稳定内部参数。
pub(super) fn parse_history_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedHistoryQuery, (StatusCode, &'static str, &'static str)> {
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
    let Some(before_raw) = raw_query
        .get("before_event_position")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 before_event_position",
        ));
    };
    let Some(limit_raw) = raw_query
        .get("limit")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "缺少 limit"));
    };
    let Ok(before_event_position) = before_raw.parse::<i64>() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "before_event_position 必须是整数",
        ));
    };
    let Ok(limit) = limit_raw.parse::<i64>() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "limit 必须是整数",
        ));
    };
    Ok(ParsedHistoryQuery {
        session_id: session_id.to_string(),
        before_event_position,
        limit,
    })
}

pub(super) fn parse_attachment_content_query(
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

pub(super) fn parse_streaming_asset_query(
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

pub(super) fn 读取非空会话标识(
    raw_session_id: Option<String>,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    raw_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ))
}

fn 媒体资产种类转标签(kind: &contract::媒体资产种类) -> &'static str {
    match kind {
        contract::媒体资产种类::图片Blob => "blob_image",
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
    })
}

/// 旧附件内容读取路由仍要保留给兼容调用方和冷源 origin。
/// 但它不再承担图片正式 blob 主链的地址身份。
pub(super) fn 构造附件受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/attachments/{attachment_id}/content?session_id={session_id}&variant={variant}")
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
        "preview": asset.preview.as_ref().map(变体描述转响应体),
        "full": asset.full.as_ref().map(变体描述转响应体),
        "original": asset.original.as_ref().map(变体描述转响应体),
        "distribution": asset.分发.as_ref().map(媒体分发描述转响应体),
        "origin": 媒体冷源描述转响应体(&asset.冷源),
    })
}

fn 构造流媒体资产响应体(
    attachment_id: &str,
    runtime_distribution: &serde_json::Value,
    distribution_snapshot: &usecase::协作分发元数据快照,
    streaming_manifest: Option<&usecase::流媒体清单快照>,
    original_url: String,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    session_id: &str,
    now_epoch秒: i64,
) -> serde_json::Value {
    let asset = contract::流媒体资产描述 {
        // 真实独立 media_asset_id 还没落表前，先显式复用 attachment_id 当稳定资产锚点；
        // 这样能把共享协议面立起来，但不会伪造第二个尚不存在的权威主键。
        资产标识: attachment_id.to_string(),
        内容哈希: distribution_snapshot.content_hash.clone(),
        种类: contract::媒体资产种类::流媒体视频,
        清单: contract::媒体清单描述 {
            hls主清单地址: streaming_manifest.map(|manifest| {
                流媒体打包::构造流媒体受控地址(
                    attachment_id,
                    session_id,
                    流媒体打包::流媒体存储键转受控路径(
                        attachment_id,
                        manifest.hls主清单存储键.as_str(),
                    ),
                )
            }),
            dash主清单地址: streaming_manifest.map(|manifest| {
                流媒体打包::构造流媒体受控地址(
                    attachment_id,
                    session_id,
                    流媒体打包::流媒体存储键转受控路径(
                        attachment_id,
                        manifest.dash主清单存储键.as_str(),
                    ),
                )
            }),
        },
        分发: 从运行态协作分发响应提取共享分发表面(
            distribution_snapshot,
            runtime_distribution,
        ),
        冷源: usecase::构造媒体冷源描述(
            Some(original_url),
            原始冷源到期时间戳秒,
            原始冷源删除时间戳秒,
            now_epoch秒,
        ),
    };
    流媒体资产描述转响应体(&asset)
}

fn 构造blob媒体资产响应体(
    attachment_id: &str,
    session_id: &str,
    runtime_distribution: Option<&serde_json::Value>,
    distribution_snapshot: Option<&usecase::协作分发元数据快照>,
    legacy_original_url: String,
    preview_available: bool,
    mime_type: &str,
    width: Option<i32>,
    height: Option<i32>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    now_epoch秒: i64,
) -> serde_json::Value {
    let preview_url =
        preview_available.then(|| 构造blob受控地址(attachment_id, session_id, "preview"));
    let full_url = 构造blob受控地址(attachment_id, session_id, "full");
    let original_url = 构造blob受控地址(attachment_id, session_id, "original");
    let asset = contract::Blob媒体资产描述 {
        资产标识: attachment_id.to_string(),
        内容哈希: distribution_snapshot
            .map(|snapshot| snapshot.content_hash.clone())
            .unwrap_or_else(|| attachment_id.to_string()),
        种类: contract::媒体资产种类::图片Blob,
        preview: preview_url.map(|url| contract::变体描述 {
            标识: "preview".to_string(),
            mime_type: "image/png".to_string(),
            地址: url,
            宽: width,
            高: height,
        }),
        full: Some(contract::变体描述 {
            标识: "full".to_string(),
            // full 现在是真实的查看器资产，统一压成 WebP，
            // 不能继续把原图 MIME 冒充成 full 资产类型。
            mime_type: "image/webp".to_string(),
            地址: full_url,
            宽: width,
            高: height,
        }),
        original: Some(contract::变体描述 {
            标识: "original".to_string(),
            mime_type: mime_type.to_string(),
            地址: original_url,
            宽: width,
            高: height,
        }),
        分发: distribution_snapshot.and_then(|snapshot| {
            runtime_distribution.map(|runtime| {
                从运行态协作分发响应提取共享分发表面(snapshot, runtime)
            })
        }),
        冷源: usecase::构造媒体冷源描述(
            Some(legacy_original_url),
            原始冷源到期时间戳秒,
            原始冷源删除时间戳秒,
            now_epoch秒,
        ),
    };
    blob媒体资产描述转响应体(&asset)
}

pub(super) fn 构造媒体资产响应体(
    snapshot: &usecase::媒体附件快照,
    runtime_distribution: Option<&serde_json::Value>,
    distribution_snapshot: Option<&usecase::协作分发元数据快照>,
    streaming_manifest: Option<&usecase::流媒体清单快照>,
    original_url: String,
    thumbnail_url: Option<String>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    session_id: &str,
    now_epoch秒: i64,
) -> Option<serde_json::Value> {
    match &snapshot.种类 {
        usecase::媒体附件类型::视频 => Some(构造流媒体资产响应体(
            snapshot.附件标识.as_str(),
            runtime_distribution?,
            distribution_snapshot?,
            streaming_manifest,
            original_url,
            原始冷源到期时间戳秒,
            原始冷源删除时间戳秒,
            session_id,
            now_epoch秒,
        )),
        usecase::媒体附件类型::图片 => Some(构造blob媒体资产响应体(
            snapshot.附件标识.as_str(),
            session_id,
            runtime_distribution,
            distribution_snapshot,
            original_url,
            thumbnail_url.is_some(),
            snapshot.mime_type.as_str(),
            Some(snapshot.宽),
            Some(snapshot.高),
            原始冷源到期时间戳秒,
            原始冷源删除时间戳秒,
            now_epoch秒,
        )),
    }
}

fn 构造定位媒体资产响应体(
    locator: &usecase::媒体定位结果,
    runtime_distribution: Option<&serde_json::Value>,
    original_url: String,
    session_id: &str,
    now_epoch秒: i64,
) -> Option<(&'static str, serde_json::Value)> {
    match &locator.种类 {
        usecase::媒体附件类型::视频 => Some((
            "streaming_asset",
            构造流媒体资产响应体(
                locator.附件标识.as_str(),
                runtime_distribution?,
                locator.协作分发.as_ref()?,
                locator.流媒体清单.as_ref(),
                original_url,
                locator.原始冷源到期时间戳秒,
                locator.原始冷源删除时间戳秒,
                session_id,
                now_epoch秒,
            ),
        )),
        usecase::媒体附件类型::图片 => Some((
            "blob_asset",
            构造blob媒体资产响应体(
                locator.附件标识.as_str(),
                session_id,
                runtime_distribution,
                locator.协作分发.as_ref(),
                original_url,
                locator.允许缩略图,
                locator.mime_type.as_str(),
                locator.宽,
                locator.高,
                locator.原始冷源到期时间戳秒,
                locator.原始冷源删除时间戳秒,
                now_epoch秒,
            ),
        )),
    }
}

pub(super) fn 媒体附件快照转响应体(
    snapshot: &usecase::媒体附件快照,
    media_asset: Option<serde_json::Value>,
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
    response
}

/// 冷路径：引导匿名身份。
///
/// 这里只做协议解码和结果转码；业务规则仍在 usecase 层。
pub(super) async fn bootstrap_session(
    State(state): State<应用状态>,
    Json(body): Json<BootstrapBody>,
) -> impl IntoResponse {
    let Some(device_anonymous_token) = body.device_anonymous_token else {
        tracing::warn!(
            usecase = "引导匿名身份",
            adapter = "http",
            outcome = "rejected",
            request_kind = "匿名身份引导",
            error_code = "invalid_argument",
            "引导匿名身份缺少设备入口凭证"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 device_anonymous_token",
        );
    };
    tracing::info!(
        usecase = "引导匿名身份",
        adapter = "http",
        outcome = "accepted",
        request_kind = "匿名身份引导",
        "HTTP 请求已受理"
    );
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::引导匿名身份(&mut repo, &device_anonymous_token).map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "failed",
                request_kind = "匿名身份引导",
                error_code = "system_error",
                error = %err,
                "引导匿名身份任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(out) => {
            tracing::info!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "匿名身份引导",
                anonymous_identity_id = out.匿名身份标识,
                session_id = out.会话标识,
                "引导匿名身份成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "anonymous_identity_id": out.匿名身份标识,
                    "display_alias": out.展示花名,
                    "session_id": out.会话标识,
                })),
            )
                .into_response()
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "rejected",
                request_kind = "匿名身份引导",
                error_code = code,
                "引导匿名身份被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按短码进房或建房。
pub(super) async fn join_or_create_room(
    State(state): State<应用状态>,
    Json(body): Json<JoinBody>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "按短码进房或建房",
        adapter = "http",
        outcome = "accepted",
        request_kind = "短码进房或建房",
        session_id = body.session_id.as_str(),
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let session_id = body.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let room_code = body.room_code.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::按短码进房或建房(&mut repo, &session_id_for_usecase, &room_code)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "failed",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "按短码进房或建房任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
            上次已读事件位置,
            首条未读事件位置,
            首屏消息,
            首屏前仍有更早历史,
        }) => {
            tracing::info!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "短码进房或建房",
                session_id = session_id,
                room_id = 房间标识,
                event_position = 最新事件位置,
                "按短码进房或建房成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "latest_event_position": 最新事件位置,
                    "last_read_event_position": 上次已读事件位置,
                    "first_unread_event_position": 首条未读事件位置,
                    "snapshot_messages": events_to_json(首屏消息),
                    "has_more_before": 首屏前仍有更早历史,
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "failed",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = "system_error",
                "按短码进房或建房返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "rejected",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = code,
                "按短码进房或建房被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：加载房间快照。
pub(super) async fn load_room_snapshot(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<SnapshotQuery>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "加载房间快照",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间快照查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间快照(&repo, &room_id_copy, &session_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "加载房间快照任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
            上次已读事件位置,
            首条未读事件位置,
            首屏消息,
            首屏前仍有更早历史,
        }) => {
            tracing::info!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间快照查询",
                room_id = 房间标识,
                session_id = session_id,
                event_position = 最新事件位置,
                "加载房间快照成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "latest_event_position": 最新事件位置,
                    "last_read_event_position": 上次已读事件位置,
                    "first_unread_event_position": 首条未读事件位置,
                    "snapshot_messages": events_to_json(首屏消息),
                    "has_more_before": 首屏前仍有更早历史,
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                "加载房间快照返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = code,
                "加载房间快照被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：推进房间阅读位置。
pub(super) async fn update_room_read_anchor(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Json(body): Json<UpdateReadAnchorBody>,
) -> impl IntoResponse {
    let Some(session_id) = body
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        tracing::warn!(
            usecase = "推进房间阅读位置",
            adapter = "http",
            outcome = "rejected",
            request_kind = "房间阅读位置推进",
            room_id = room_id.as_str(),
            error_code = "invalid_argument",
            "推进房间阅读位置缺少 session_id"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        );
    };
    let Some(last_read_event_position) = body.last_read_event_position else {
        tracing::warn!(
            usecase = "推进房间阅读位置",
            adapter = "http",
            outcome = "rejected",
            request_kind = "房间阅读位置推进",
            room_id = room_id.as_str(),
            session_id = session_id.as_str(),
            error_code = "invalid_argument",
            "推进房间阅读位置缺少 last_read_event_position"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 last_read_event_position",
        );
    };
    tracing::info!(
        usecase = "推进房间阅读位置",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间阅读位置推进",
        room_id = room_id.as_str(),
        session_id = session_id.as_str(),
        event_position = last_read_event_position,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_for_usecase = room_id.clone();
    let session_id_for_usecase = session_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::推进房间阅读位置(
            &mut repo,
            &room_id_for_usecase,
            &session_id_for_usecase,
            last_read_event_position,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = "system_error",
                error = %err,
                "推进房间阅读位置任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::命令结果::成功) => {
            tracing::info!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                "推进房间阅读位置成功"
            );
            (StatusCode::OK, Json(serde_json::json!({}))).into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = "system_error",
                "推进房间阅读位置返回了错误的命令结果类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回命令结果类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = code,
                "推进房间阅读位置被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按位置拉房间增量事件。
pub(super) async fn load_room_events(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_events_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间增量事件查询",
                room_id = room_id.as_str(),
                error_code = code,
                "加载房间增量事件缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    tracing::info!(
        usecase = "加载房间增量事件",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间增量事件查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        from = query.from,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let from = query.from;
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间增量事件(&repo, &room_id_copy, &session_id_for_usecase, from)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = "system_error",
                error = %err,
                "加载房间增量事件任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        }) => {
            let event_count = 事件.len();
            tracing::info!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间增量事件查询",
                room_id = 房间标识,
                session_id = session_id,
                from = from,
                event_position = 最新事件位置,
                event_count = event_count,
                "加载房间增量事件成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "latest_event_position": 最新事件位置,
                    "events": events_to_json(事件)
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = "system_error",
                "加载房间增量事件返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = code,
                "加载房间增量事件被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按顺序锚点加载更早历史页。
pub(super) async fn load_room_history(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_history_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间历史分页查询",
                room_id = room_id.as_str(),
                error_code = code,
                "加载房间历史页缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    tracing::info!(
        usecase = "加载房间历史页",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间历史分页查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        before_event_position = query.before_event_position,
        limit = query.limit,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let before_event_position = query.before_event_position;
    let limit = query.limit;
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间历史页(
            &repo,
            &room_id_copy,
            &session_id_for_usecase,
            before_event_position,
            limit,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                before_event_position = before_event_position,
                limit = limit,
                error_code = "system_error",
                error = %err,
                "加载房间历史页任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间历史页 {
            房间标识, 消息
        }) => {
            tracing::info!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间历史分页查询",
                room_id = 房间标识,
                session_id = session_id,
                before_event_position = before_event_position,
                limit = limit,
                "加载房间历史页成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "messages": events_to_json(消息),
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                "加载房间历史页返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                error_code = code,
                "加载房间历史页被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// locator 只暴露受控 transport 线索：
/// - 当前先统一收口成受控 HTTP 内容地址；
/// - 后续接入 WebTorrent/锚点时，也继续在这里追加 transport 线索，而不是把存储键下发给壳层。
pub(super) async fn load_media_locator(
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
    let thumbnail_url = locator.允许缩略图.then(|| {
        构造附件受控地址(
            attachment_id.as_str(),
            query.session_id.as_str(),
            "thumbnail",
        )
    });
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
            attachment_id.as_str(),
            query.session_id.as_str(),
            state.swarm_tracker_public_url.as_str(),
            state.swarm_web_seed_public_endpoint.as_deref(),
            冷源仍可用,
            now_epoch秒,
            state.swarm_peer_presence_stale_seconds,
        )
    });
    let mut response = serde_json::json!({
        "attachment_id": locator.附件标识,
        "kind": 媒体类型转标签(&locator.种类),
        "status": 附件状态转标签(&locator.状态),
        "original_url": original_url,
        "thumbnail_url": thumbnail_url,
        "distribution": runtime_distribution.clone(),
    });
    if let Some((field, asset)) = 构造定位媒体资产响应体(
        &locator,
        runtime_distribution.as_ref(),
        response["original_url"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_default(),
        query.session_id.as_str(),
        now_epoch秒,
    ) {
        response[field] = asset;
    }
    (StatusCode::OK, Json(response)).into_response()
}

/// blob 图片主链只是旧附件内容读取链的受控别名：
/// - preview 走 thumbnail 真相；
/// - full/original 都走 canonical original 真相；
/// - 这样能立刻把正式地址身份切到 `/api/media/.../blob/*`，同时不复制第二套读取实现。
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
        "preview" => usecase::附件内容变体::缩略图,
        "full" => usecase::附件内容变体::完整图,
        "original" => usecase::附件内容变体::资产原图,
        _ => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "blob variant 必须是 preview、full 或 original",
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

    let object_path = ObjectPath::from(流媒体打包::推导流媒体对象存储键(
        attachment_id.as_str(),
        asset_path.as_str(),
    ));
    if asset_path.ends_with(".m3u8") || asset_path.ends_with(".mpd") {
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
            [(
                header::CONTENT_TYPE,
                流媒体打包::推导流媒体内容类型(asset_path.as_str()).to_string(),
            )],
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
                (
                    header::CONTENT_TYPE,
                    流媒体打包::推导流媒体内容类型(asset_path.as_str()).to_string(),
                ),
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
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let result = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::写入协作分发存活(
            &mut repo,
            &usecase::协作分发存活写入请求 {
                附件标识: attachment_id_for_usecase,
                会话标识: session_id_for_usecase,
                最近peer存活时间戳秒: now_epoch秒,
            },
        )
        .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(())) => (),
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("presence 任务执行失败: {err}"),
            )
        }
    };
    let _ = result;
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

#[cfg(test)]
mod 媒体内容解析迁移测试 {
    use image::{DynamicImage, ImageFormat};
    use std::io::Cursor;

    #[test]
    fn 新模块会拒绝非图片字节() {
        let err = super::媒体内容解析::解析图片内容(b"not an image")
            .expect_err("非图片字节必须被拒绝");
        assert!(
            matches!(err, super::媒体内容解析::媒体内容解析错误::类型不允许(_)),
            "错误类型必须继续表达成类型不允许，而不是被吞成系统错误"
        );
    }

    #[test]
    fn 新模块会从图片字节里读出稳定宽高() {
        let mut cursor = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(1, 1)
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("应能编码 1x1 png");
        let parsed = super::媒体内容解析::解析图片内容(cursor.get_ref())
            .expect("最小 png 应该能被新模块解析");
        assert_eq!(parsed.宽, 1);
        assert_eq!(parsed.高, 1);
    }

    #[test]
    fn 新模块会给最小_mp4_返回展示尺寸() {
        let parsed = super::媒体内容解析::解析视频内容(include_bytes!("../tests/fixtures/minimal.mp4"))
            .expect("最小 mp4 应该能被新模块解析");
        assert!(parsed.宽 > 0);
        assert!(parsed.高 > 0);
    }
}

#[cfg(test)]
mod 流媒体打包迁移测试 {
    #[test]
    fn 新模块会把_hls_相对路径重写成受控地址() {
        let rewritten = super::流媒体打包::重写_hls清单内容(
            "att-1",
            "session-1",
            "hls/master.m3u8",
            "#EXTM3U\nvideo/main.m3u8\n",
        );
        assert!(rewritten.contains("/api/media/att-1/stream/hls/video/main.m3u8?session_id=session-1"));
    }

    #[test]
    fn 新模块会把_dash_模板重写成受控地址() {
        let rewritten = super::流媒体打包::重写_dash清单内容(
            "att-1",
            "session-1",
            "dash/stream.mpd",
            r#"<SegmentTemplate initialization="video/init.mp4" media="video/$Number$.m4s" />"#,
        );
        assert!(rewritten.contains("/api/media/att-1/stream/dash/video/init.mp4?session_id=session-1"));
        assert!(rewritten.contains("/api/media/att-1/stream/dash/video/$Number$.m4s?session_id=session-1"));
    }
}
