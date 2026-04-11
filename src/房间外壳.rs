use super::{
    err_resp, events_to_json, map_domain_err_tuple, 应用状态, 构建共享仓储,
};
use crate::{
    adapter::{媒体上传运输授权写入请求, 媒体上传运输记录},
    contract,
    media_distribution,
    usecase::{self, 仓储端口},
};
use axum::{
    extract::{Path, Query, State},
    http::{header, uri::Authority, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use image::{DynamicImage, ImageFormat};
use nom_exif::{MediaParser, MediaSource, TrackInfo, TrackInfoTag};
use object_store::{path::Path as ObjectPath, ObjectStoreExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path as StdPath, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::fs;
use tokio::task;
use uuid::Uuid;

const 媒体上传运输方式_TUS: &str = "tus";
const 媒体上传授权有效期秒数: u64 = 15 * 60;
const 完成媒体上传等待回执最大轮询次数: usize = 20;
const 完成媒体上传等待回执轮询间隔: Duration = Duration::from_millis(50);

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

/// 媒体 prepare 请求体。
#[derive(Deserialize)]
pub(super) struct PrepareMediaUploadBody {
    session_id: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    byte_size: Option<i64>,
}

/// 媒体 complete 请求体。
#[derive(Deserialize)]
pub(super) struct CompleteMediaUploadBody {
    session_id: Option<String>,
}

/// Rustus hook 顶层负载。
/// 我们只解析自己真正依赖的最小字段，其余字段继续留给 Rustus 自己演进。
#[derive(Deserialize)]
pub(super) struct RustusHookBody {
    upload: RustusUploadBody,
}

/// Rustus v2 hook 里和我们有关的上传字段。
#[derive(Deserialize)]
pub(super) struct RustusUploadBody {
    id: String,
    offset: i64,
    length: i64,
    path: Option<String>,
    metadata: HashMap<String, String>,
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

fn 生成附件标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("att-{}", &raw[..12])
}

fn 生成媒体上传令牌() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("tus-{}", raw)
}

fn 解析媒体类型(
    raw_kind: &str,
) -> Result<usecase::媒体附件类型, (StatusCode, &'static str, &'static str)> {
    match raw_kind {
        "image" => Ok(usecase::媒体附件类型::图片),
        "video" => Ok(usecase::媒体附件类型::视频),
        _ => Err((
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "只允许上传图片或视频",
        )),
    }
}

fn 媒体类型转标签(kind: &usecase::媒体附件类型) -> &'static str {
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

fn 推导原始内容扩展名(
    kind: &usecase::媒体附件类型, mime_type: &str
) -> &'static str {
    match kind {
        usecase::媒体附件类型::图片 => match mime_type {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".bin",
        },
        usecase::媒体附件类型::视频 => match mime_type {
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            "video/quicktime" => ".mov",
            "video/3gpp" => ".3gp",
            _ => ".bin",
        },
    }
}

fn 读取exif方向(bytes: &[u8]) -> u32 {
    let mut cursor = Cursor::new(bytes);
    exif::Reader::new()
        .read_from_container(&mut cursor)
        .ok()
        .and_then(|reader| {
            reader
                .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|field| field.value.get_uint(0))
        })
        .unwrap_or(1)
}

fn 应用exif方向(image: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn 生成缩略图字节(image: &DynamicImage) -> Result<Vec<u8>, image::ImageError> {
    let thumbnail = image.thumbnail(512, 512);
    let mut cursor = Cursor::new(Vec::new());
    thumbnail.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

struct 图片内容解析结果 {
    mime_type: String,
    宽: i32,
    高: i32,
    缩略图字节: Vec<u8>,
}

struct 视频内容解析结果 {
    mime_type: String,
    宽: i32,
    高: i32,
}

enum 媒体内容解析结果 {
    图片(图片内容解析结果),
    视频(视频内容解析结果),
}

enum 媒体内容解析错误 {
    类型不允许(&'static str),
    系统错误(&'static str),
}

/// 旧直传和新 complete 都必须走同一条图片解析链：
/// - 真 MIME 以后端探测为准；
/// - 宽高和缩略图以后端解码结果为准；
/// - 不把“文件后缀/前端 mime”冒充成权威事实。
fn 解析图片内容(bytes: &[u8]) -> Result<图片内容解析结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许("只允许上传图片"));
    };
    if !kind.mime_type().starts_with("image/") {
        return Err(媒体内容解析错误::类型不允许("只允许上传图片"));
    }
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| 媒体内容解析错误::类型不允许("图片内容非法"))?;
    let normalized_image = 应用exif方向(decoded, 读取exif方向(bytes));
    let 缩略图字节 = 生成缩略图字节(&normalized_image)
        .map_err(|_| 媒体内容解析错误::系统错误("生成图片缩略图失败"))?;
    Ok(图片内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: normalized_image.width() as i32,
        高: normalized_image.height() as i32,
        缩略图字节,
    })
}

/// 视频元数据探测继续复用成熟纯 Rust 轮子：
/// - 真 MIME 仍以后端探测为准；
/// - 宽高从容器元数据读取，不靠前端 file.type 或文件后缀冒充；
/// - 当前只收口 ready 所需的最小事实，不在后端手搓转码或截图链。
fn 解析视频内容(bytes: &[u8]) -> Result<视频内容解析结果, 媒体内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    };
    if !kind.mime_type().starts_with("video/") {
        return Err(媒体内容解析错误::类型不允许("只允许上传视频"));
    }
    let mut parser = MediaParser::new();
    let media_source = MediaSource::seekable(Cursor::new(bytes))
        .map_err(|_| 媒体内容解析错误::系统错误("构建视频元数据数据源失败"))?;
    if !media_source.has_track() {
        return Err(媒体内容解析错误::类型不允许("视频内容非法"));
    }
    let info: TrackInfo = parser
        .parse(media_source)
        .map_err(|_| 媒体内容解析错误::类型不允许("视频内容非法"))?;
    let 宽 = info
        .get(TrackInfoTag::ImageWidth)
        .and_then(解析视频轨道整数)
        .filter(|value| *value > 0)
        .ok_or(媒体内容解析错误::类型不允许(
            "视频缺少宽度元数据",
        ))?;
    let 高 = info
        .get(TrackInfoTag::ImageHeight)
        .and_then(解析视频轨道整数)
        .filter(|value| *value > 0)
        .ok_or(媒体内容解析错误::类型不允许(
            "视频缺少高度元数据",
        ))?;
    Ok(视频内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: 宽 as i32,
        高: 高 as i32,
    })
}

fn 解析视频轨道整数(value: &nom_exif::EntryValue) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_u32().map(u64::from))
        .or_else(|| value.as_u16().map(u64::from))
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<u64>().ok()))
}

fn 解析媒体内容(
    kind: &usecase::媒体附件类型,
    bytes: &[u8],
) -> Result<媒体内容解析结果, 媒体内容解析错误> {
    match kind {
        usecase::媒体附件类型::图片 => 解析图片内容(bytes).map(媒体内容解析结果::图片),
        usecase::媒体附件类型::视频 => 解析视频内容(bytes).map(媒体内容解析结果::视频),
    }
}

fn 读取非空会话标识(
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

fn 读取rustus_hook名称(
    headers: &HeaderMap,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    headers
        .get("Hook-Name")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 Hook-Name",
        ))
}

fn 读取媒体上传令牌(
    headers: &HeaderMap,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    let Some(raw_authorization) = headers
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "缺少 Authorization",
        ));
    };
    raw_authorization
        .strip_prefix("Bearer ")
        .or_else(|| raw_authorization.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "上传令牌非法",
        ))
}

fn 读取rustus_metadata字段(
    metadata: &HashMap<String, String>,
    key: &'static str,
) -> Result<String, (StatusCode, &'static str, String)> {
    metadata
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("缺少 metadata.{key}"),
        ))
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

/// `RUSTUS_PUBLIC_ENDPOINT` 没显式配置时，这里按当前 HTTP 请求 Host 推导一个 LAN 可达的地址。
///
/// 边界约束：
/// 1. 显式配置永远优先，生产反向代理场景仍应直接给出权威 public endpoint；
/// 2. 这里只作为本机/局域网开发兜底，避免 prepare 默认把 `127.0.0.1` 塞给异机浏览器；
/// 3. 推导结果仍然只描述“Tus sidecar 暴露在哪”，不改变业务真相归属。
fn 推导rustus对外入口(
    headers: &HeaderMap,
    rustus_server_port: u16,
    rustus_url: &str,
) -> Option<String> {
    let forwarded_host = 读取首个非空请求头(headers, "x-forwarded-host");
    let raw_host = forwarded_host
        .clone()
        .or_else(|| 读取首个非空请求头(headers, "host"))?;
    let authority = raw_host.parse::<Authority>().ok()?;
    let forwarded_proto = 读取首个非空请求头(headers, "x-forwarded-proto")
        .or_else(|| 读取首个非空请求头(headers, "x-forwarded-scheme"));
    let forwarded_port = 读取首个非空请求头(headers, "x-forwarded-port")
        .and_then(|value| value.parse::<u16>().ok());
    let scheme = forwarded_proto
        .clone()
        .unwrap_or_else(|| "http".to_string());
    let hostname = authority.host();
    let host_for_url = 包装url主机(hostname);

    // 端口推导要区分“公网 authority”与“内部 Rustus 监听端口”：
    // 1. 开发/LAN 直连时，Host 通常只是应用入口端口（例如 8080），Tus 仍应落到单独的 Rustus 端口；
    // 2. 反向代理场景若已经通过 forwarded 头给出公网端口/authority，就应该优先沿用公网信息，
    //    不能再把内部 1081 一类监听端口泄漏给浏览器。
    let should_trust_authority_port =
        forwarded_host.is_some() || forwarded_proto.is_some() || forwarded_port.is_some();
    let inferred_proxy_default_port = if should_trust_authority_port {
        match scheme.as_str() {
            "https" => Some(443),
            "http" => Some(80),
            _ => None,
        }
    } else {
        None
    };
    let public_port = forwarded_port
        .or_else(|| should_trust_authority_port.then(|| authority.port_u16()).flatten())
        .or(inferred_proxy_default_port)
        .unwrap_or(rustus_server_port);
    let should_omit_port =
        (scheme == "http" && public_port == 80) || (scheme == "https" && public_port == 443);
    let authority_for_url = if should_omit_port {
        host_for_url
    } else {
        format!("{host_for_url}:{public_port}")
    };
    Some(format!("{scheme}://{authority_for_url}{rustus_url}"))
}

fn 读取媒体_tus对外地址(state: &应用状态, headers: &HeaderMap) -> String {
    state
        .rustus_public_endpoint
        .clone()
        .or_else(|| 推导rustus对外入口(headers, state.rustus_server_port, &state.rustus_url))
        .unwrap_or_else(|| format!("http://127.0.0.1:{}{}", state.rustus_server_port, state.rustus_url))
}

/// storage locator 来自 sidecar，不可被客户端随意扩展成任意磁盘路径。
/// 这里统一解析并锁死在 Rustus shared data dir 之内，避免 token 持有者伪造路径探测主机文件。
fn 解析rustus临时文件路径(
    rustus_data_dir: &str,
    storage_locator: &str,
) -> Result<PathBuf, (StatusCode, &'static str, String)> {
    let shared_root = PathBuf::from(rustus_data_dir);
    let candidate = PathBuf::from(storage_locator);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        shared_root.join(candidate)
    };
    let canonical_root = std::fs::canonicalize(&shared_root).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 Rustus shared dir 失败: {err}"),
        )
    })?;
    let canonical_file = std::fs::canonicalize(&resolved).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 Rustus 临时文件失败: {err}"),
        )
    })?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "storage locator 超出 Rustus data dir".to_string(),
        ));
    }
    if !StdPath::new(&canonical_file).is_file() {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "storage locator 不是文件".to_string(),
        ));
    }
    Ok(canonical_file)
}

fn 校验媒体准备请求(
    kind: &usecase::媒体附件类型,
    mime_type: &str,
    byte_size: i64,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    if byte_size <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "媒体大小非法"));
    }
    match kind {
        usecase::媒体附件类型::图片 => {
            if !mime_type.starts_with("image/") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "attachment_type_not_allowed",
                    "只允许上传图片",
                ));
            }
            if byte_size > 10 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "attachment_too_large",
                    "图片超过 10MB 上限",
                ));
            }
        }
        usecase::媒体附件类型::视频 => {
            if !mime_type.starts_with("video/") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "attachment_type_not_allowed",
                    "只允许上传视频",
                ));
            }
            if byte_size > 50 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "attachment_too_large",
                    "视频超过 50MB 上限",
                ));
            }
        }
    }
    Ok(())
}

fn 媒体附件快照转响应体(snapshot: &usecase::媒体附件快照) -> serde_json::Value {
    serde_json::json!({
        "attachment_id": snapshot.附件标识,
        "kind": 媒体类型转标签(&snapshot.种类),
        "mime_type": snapshot.mime_type,
        "byte_size": snapshot.字节大小,
        "width": snapshot.宽,
        "height": snapshot.高,
        "status": 附件状态转标签(&snapshot.状态),
    })
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

/// 冷路径：申请媒体附件上传占位。
/// 这一步只创建 prepared 真相，并返回后续直传所需参数；不在这里上传字节。
pub(super) async fn prepare_media_upload(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<PrepareMediaUploadBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match 读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let file_name = match body
        .file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(file_name) => file_name,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 file_name",
            )
        }
    };
    let mime_type = match body
        .mime_type
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    {
        Some(mime_type) => mime_type,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 mime_type",
            )
        }
    };
    let byte_size = match body.byte_size {
        Some(byte_size) => byte_size,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 byte_size",
            )
        }
    };
    if let Err((status, code, message)) =
        校验媒体准备请求(&media_kind, &mime_type, byte_size)
    {
        return err_resp(status, code, message);
    }

    let attachment_id = 生成附件标识();
    let storage_prefix = match media_kind {
        usecase::媒体附件类型::图片 => "images",
        usecase::媒体附件类型::视频 => "videos",
    };
    let original_storage_key = format!(
        "{storage_prefix}/{attachment_id}/original{}",
        推导原始内容扩展名(&media_kind, mime_type.as_str())
    );
    let prepare_request = usecase::媒体附件准备请求 {
        附件标识: attachment_id.clone(),
        种类: media_kind.clone(),
        mime_type: mime_type.clone(),
        字节大小: byte_size,
        原始内容存储键: original_storage_key.clone(),
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let prepare_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::准备媒体附件上传(&mut repo, &session_id_for_usecase, &prepare_request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let snapshot = match prepare_result {
        Ok(Ok(snapshot)) => snapshot,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("prepare 任务执行失败: {err}"),
            )
        }
    };

    // prepare 只负责：
    // 1. 落 prepared 附件真相；
    // 2. 下发一段短期 Tus 运输授权；
    // 3. 不把 transport token/upload id 倒灌进附件业务表。
    let upload_token = 生成媒体上传令牌();
    let transport_auth = 媒体上传运输授权写入请求 {
        附件标识: snapshot.附件标识.clone(),
        运输方式: 媒体上传运输方式_TUS.to_string(),
        上传令牌: upload_token.clone(),
        令牌有效期秒数: 媒体上传授权有效期秒数 as i64,
        字节大小: snapshot.字节大小,
    };
    let state_for_transport = state.clone();
    let transport_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_transport);
        repo.写入媒体上传运输授权(&transport_auth)
            .map_err(map_domain_err_tuple)
    })
    .await;
    match transport_result {
        Ok(Ok(())) => {}
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("prepare 运输授权任务执行失败: {err}"),
            )
        }
    }

    let expires_at = (SystemTime::now() + Duration::from_secs(媒体上传授权有效期秒数))
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    tracing::info!(
        usecase = "准备媒体上传",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "媒体上传 prepare",
        session_id = session_id.as_str(),
        attachment_id = snapshot.附件标识.as_str(),
        attachment_kind = 媒体类型转标签(&snapshot.种类),
        file_name = file_name.as_str(),
        byte_size = byte_size,
        "媒体上传占位已创建"
    );
    let response_attachment_id = snapshot.附件标识.clone();
    let response_kind = 媒体类型转标签(&snapshot.种类);
    let response_mime_type = snapshot.mime_type.clone();
    let response_byte_size = snapshot.字节大小;
    let rustus_public_endpoint = 读取媒体_tus对外地址(&state, &headers);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": response_attachment_id,
            "kind": response_kind,
            "upload_method": 媒体上传运输方式_TUS,
            "tus_endpoint": rustus_public_endpoint,
            "tus_headers": {
                "Authorization": format!("Bearer {upload_token}"),
            },
            "tus_metadata": {
                "attachment_id": snapshot.附件标识,
                "file_name": file_name,
                "mime_type": response_mime_type,
                "byte_size": response_byte_size.to_string(),
            },
            "expires_at": expires_at,
        })),
    )
        .into_response()
}

/// Rustus hook 收口点：
/// 1. `pre-create` 负责阻止非法上传创建；
/// 2. `post-finish` 只登记运输回执；
/// 3. 无论哪个 hook，都不能越权把 prepared 直接升级成 ready。
pub(super) async fn handle_rustus_hook(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<RustusHookBody>,
) -> Response {
    let hook_name = match 读取rustus_hook名称(&headers) {
        Ok(name) => name,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    match hook_name.as_str() {
        "pre-create" => handle_rustus_hook_pre_create(state, headers, body).await,
        "post-finish" => handle_rustus_hook_post_finish(state, headers, body).await,
        _ => err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("不支持的 Hook-Name: {hook_name}"),
        )
        .into_response(),
    }
}

async fn handle_rustus_hook_pre_create(
    state: 应用状态,
    headers: HeaderMap,
    body: RustusHookBody,
) -> Response {
    let upload_token = match 读取媒体上传令牌(&headers) {
        Ok(token) => token,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id = match 读取rustus_metadata字段(&body.upload.metadata, "attachment_id") {
        Ok(value) => value,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    /*
     * `pre-create` 发生在 Rustus 真正接收字节之前：
     * - `length` 代表客户端声明的总长度；
     * - `offset` 此时应当还是 0；
     * - 真正“offset == length”的完成事实只允许出现在 `post-finish`。
     *
     * 同时，这里不能再把 `metadata.byte_size` 当成硬依赖：
     * - prepare / transport 授权里已经持有权威字节大小；
     * - create-upload 场景下 sidecar 透传回来的 metadata 并不保证完整回显所有键；
     * - attachment_id 继续作为 sidecar -> 主服务之间唯一稳定的业务锚点。
     */
    if body.upload.offset != 0 {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "pre-create 要求 offset 必须为 0",
        )
        .into_response();
    }

    let state_for_repo = state.clone();
    let check_result = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_repo);
        let Some(transport) = repo
            .根据上传令牌查询媒体上传运输记录(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !transport.令牌仍有效 || transport.运输方式 != 媒体上传运输方式_TUS {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if transport.附件标识 != attachment_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&transport.附件标识)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        };
        if !matches!(prepared.状态, usecase::附件状态读取结果::已准备) {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        }
        if prepared.字节大小 != body.upload.length {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "上传文件大小与 prepare 不一致".to_string(),
            ));
        }
        Ok::<_, (StatusCode, &'static str, String)>(())
    })
    .await
    {
        Ok(result) => result,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("Rustus pre-create 任务执行失败: {err}"),
            )
            .into_response()
        }
    };
    match check_result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err((status, code, message)) => err_resp(status, code, message).into_response(),
    }
}

async fn handle_rustus_hook_post_finish(
    state: 应用状态,
    headers: HeaderMap,
    body: RustusHookBody,
) -> Response {
    let upload_token = match 读取媒体上传令牌(&headers) {
        Ok(token) => token,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id = match 读取rustus_metadata字段(&body.upload.metadata, "attachment_id") {
        Ok(value) => value,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let storage_locator = match body
        .upload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => path.to_string(),
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "post-finish 缺少 upload.path",
            )
            .into_response()
        }
    };
    if body.upload.offset != body.upload.length {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "post-finish 只接受 offset 等于 length 的完成回执",
        )
        .into_response();
    }

    let state_for_repo = state.clone();
    let upload_id = body.upload.id.clone();
    let update_result = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_repo);
        let Some(transport) = repo
            .根据上传令牌查询媒体上传运输记录(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !transport.令牌仍有效 || transport.运输方式 != 媒体上传运输方式_TUS {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if transport.附件标识 != attachment_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&transport.附件标识)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        };
        if !matches!(prepared.状态, usecase::附件状态读取结果::已准备) {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        }
        解析rustus临时文件路径(&state_for_repo.rustus_data_dir, &storage_locator)?;
        repo.更新媒体上传运输回执(
            &transport.附件标识,
            &upload_id,
            &storage_locator,
            body.upload.length,
        )
        .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>(())
    })
    .await
    {
        Ok(result) => result,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("Rustus post-finish 任务执行失败: {err}"),
            )
            .into_response()
        }
    };
    match update_result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err((status, code, message)) => err_resp(status, code, message).into_response(),
    }
}

fn 媒体上传运输回执已就绪(transport: &媒体上传运输记录) -> bool {
    transport.完成时间戳秒.is_some()
        && transport
            .storage_locator
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
}

async fn 等待complete所需运输回执(
    state: 应用状态,
    attachment_id: &str,
    mut transport: Option<媒体上传运输记录>,
) -> Result<Option<媒体上传运输记录>, (StatusCode, &'static str, String)> {
    if transport.as_ref().is_some_and(媒体上传运输回执已就绪) {
        return Ok(transport);
    }
    // `upload-success` 只代表客户端拿到了最终 PATCH 响应；
    // 但主服务真正依赖的是 `post-finish` 已经把 finished 回执落库。
    // 这里做一个短暂、受控的等待窗口，吸收 sidecar hook 晚于浏览器成功回调的正常竞态，
    // 避免把基础设施时序细节直接泄漏给前端壳。
    for _ in 0..完成媒体上传等待回执最大轮询次数 {
        tokio::time::sleep(完成媒体上传等待回执轮询间隔).await;
        let state_for_usecase = state.clone();
        let attachment_id_for_usecase = attachment_id.to_string();
        transport = match task::spawn_blocking(move || {
            let repo = 构建共享仓储(&state_for_usecase);
            repo.查询媒体上传运输记录(&attachment_id_for_usecase)
                .map_err(map_domain_err_tuple)
        })
        .await
        {
            Ok(result) => result?,
            Err(err) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("等待 transport 回执任务执行失败: {err}"),
                ))
            }
        };
        if transport.as_ref().is_some_and(媒体上传运输回执已就绪) {
            return Ok(transport);
        }
    }
    Ok(transport)
}

/// 冷路径：完成媒体附件上传。
/// 这里消费 Rustus finished 回执指向的 shared file，写回 canonical store 后，再把 prepared 升级成 ready。
pub(super) async fn complete_media_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Json(body): Json<CompleteMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match 读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let prepared_and_transport = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let prepared = usecase::读取待完成媒体附件(
            &repo,
            &session_id_for_usecase,
            &attachment_id_for_usecase,
        )
        .map_err(map_domain_err_tuple)?;
        let transport = repo
            .查询媒体上传运输记录(&attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>((prepared, transport))
    })
    .await
    {
        Ok(Ok(payload)) => payload,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("complete 任务执行失败: {err}"),
            )
        }
    };
    let (prepared, transport) = prepared_and_transport;
    let transport = match 等待complete所需运输回执(state.clone(), &attachment_id, transport).await {
        Ok(transport) => transport,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    // transport finished 是 complete 的前置 gate：
    // - prepare 成功不等于上传完成；
    // - sidecar 还没给出 finished 回执时，不能偷跑 ready 升级；
    // - 这一层先只做 gate，后续再把 shared file 消费完全切过来。
    let Some(transport) = transport else {
        tracing::warn!(
            usecase = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执超时"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    };
    if transport.完成时间戳秒.is_none() {
        tracing::warn!(
            usecase = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执后仍未拿到 finished_at"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    }

    let Some(storage_locator) = transport
        .storage_locator
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        tracing::warn!(
            usecase = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执后仍缺少 storage_locator"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    };
    let temp_file_path = match 解析rustus临时文件路径(&state.rustus_data_dir, storage_locator) {
        Ok(path) => path,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let original_bytes = match fs::read(&temp_file_path).await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                usecase = "完成媒体上传",
                adapter = "http",
                outcome = "failed",
                request_kind = "媒体上传 complete",
                session_id = session_id.as_str(),
                attachment_id = attachment_id.as_str(),
                error_code = "system_error",
                error = %err,
                "读取 Rustus 临时原图文件失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "读取原图临时文件失败",
            );
        }
    };
    let parsed = match 解析媒体内容(&prepared.种类, original_bytes.as_ref()) {
        Ok(parsed) => parsed,
        Err(媒体内容解析错误::类型不允许(message)) => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "attachment_type_not_allowed",
                message,
            )
        }
        Err(媒体内容解析错误::系统错误(message)) => {
            return err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", message)
        }
    };
    let original_path = ObjectPath::from(prepared.原始内容存储键.clone());
    if let Err(err) = state
        .attachment_store
        .put(&original_path, original_bytes.clone().into())
        .await
    {
        tracing::error!(
            usecase = "完成媒体上传",
            adapter = "http",
            outcome = "failed",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "system_error",
            error = %err,
            "写入 canonical 原图对象失败"
        );
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "写入原图对象失败",
        );
    }

    let ready_request = match parsed {
        媒体内容解析结果::图片(parsed) => {
            let thumbnail_storage_key = format!("images/{attachment_id}/thumbnail.png");
            let thumbnail_path = ObjectPath::from(thumbnail_storage_key.clone());
            if let Err(err) = state
                .attachment_store
                .put(&thumbnail_path, parsed.缩略图字节.into())
                .await
            {
                tracing::error!(
                    usecase = "完成媒体上传",
                    adapter = "http",
                    outcome = "failed",
                    request_kind = "媒体上传 complete",
                    session_id = session_id.as_str(),
                    attachment_id = attachment_id.as_str(),
                    attachment_kind = 媒体类型转标签(&prepared.种类),
                    error_code = "system_error",
                    error = %err,
                    "写入图片缩略图对象失败"
                );
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "写入图片缩略图对象失败",
                );
            }
            usecase::媒体附件写入请求 {
                附件标识: attachment_id.clone(),
                种类: prepared.种类.clone(),
                mime_type: parsed.mime_type,
                字节大小: original_bytes.len() as i64,
                宽: parsed.宽,
                高: parsed.高,
                原始内容存储键: prepared.原始内容存储键.clone(),
                缩略图存储键: Some(thumbnail_storage_key),
            }
        }
        媒体内容解析结果::视频(parsed) => usecase::媒体附件写入请求 {
            附件标识: attachment_id.clone(),
            种类: prepared.种类.clone(),
            mime_type: parsed.mime_type,
            字节大小: original_bytes.len() as i64,
            宽: parsed.宽,
            高: parsed.高,
            原始内容存储键: prepared.原始内容存储键.clone(),
            缩略图存储键: None,
        },
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let complete_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::完成媒体附件上传(&mut repo, &session_id_for_usecase, &ready_request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    match complete_result {
        Ok(Ok(snapshot)) => {
            // ready 真相已经成立后，马上补齐协作分发元数据。
            // 这里故意不把 hash / swarm_id 交给前端推导，避免多端各算各的。
            let ready_epoch秒 = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_secs() as i64)
                .unwrap_or(0);
            let distribution_request = media_distribution::构造协作分发元数据写入请求(
                &attachment_id,
                original_bytes.as_ref(),
                ready_epoch秒,
            );
            let state_for_distribution = state.clone();
            let distribution_result = task::spawn_blocking(move || {
                let mut repo = 构建共享仓储(&state_for_distribution);
                usecase::写入协作分发元数据(&mut repo, &distribution_request)
                    .map_err(map_domain_err_tuple)
            })
            .await;

            match distribution_result {
                Ok(Ok(_)) => {
                    (StatusCode::OK, Json(媒体附件快照转响应体(&snapshot))).into_response()
                }
                Ok(Err((status, code, message))) => err_resp(status, code, message),
                Err(err) => err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("分发元数据任务执行失败: {err}"),
                ),
            }
        }
        Ok(Err((status, code, message))) => err_resp(status, code, message),
        Err(err) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("complete 任务执行失败: {err}"),
        ),
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
    let original_url = format!(
        "/api/attachments/{attachment_id}/content?session_id={}&variant=original",
        query.session_id
    );
    let thumbnail_url = locator.允许缩略图.then(|| {
        format!(
            "/api/attachments/{attachment_id}/content?session_id={}&variant=thumbnail",
            query.session_id
        )
    });
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": locator.附件标识,
            "kind": 媒体类型转标签(&locator.种类),
            "status": 附件状态转标签(&locator.状态),
            "original_url": original_url,
            "thumbnail_url": thumbnail_url,
            "distribution": locator
                .协作分发
                .as_ref()
                .map(media_distribution::协作分发快照转响应值),
        })),
    )
        .into_response()
}

/// 冷路径：受控读取附件内容。
pub(super) async fn load_attachment_content(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
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
    tracing::info!(
        usecase = "读取附件内容",
        adapter = "http",
        outcome = "accepted",
        request_kind = "附件内容读取",
        attachment_id = attachment_id.as_str(),
        session_id = query.session_id.as_str(),
        "HTTP 请求已受理"
    );

    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let variant = query.variant;
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
                session_id = query.session_id.as_str(),
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
                session_id = query.session_id.as_str(),
                error_code = code,
                "读取附件内容被拒绝"
            );
            return err_resp(status, code, message);
        }
    };

    let object_path = ObjectPath::from(target.存储键.clone());
    let get_result = match state.attachment_store.get(&object_path).await {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                usecase = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = query.session_id.as_str(),
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
    let body = match get_result.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                usecase = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = query.session_id.as_str(),
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
        session_id = query.session_id.as_str(),
        "读取附件内容成功"
    );
    ([(header::CONTENT_TYPE, target.mime_type)], body).into_response()
}
