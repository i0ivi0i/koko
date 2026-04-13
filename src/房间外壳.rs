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
use object_store::{path::Path as ObjectPath, GetOptions, GetRange, ObjectStoreExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path as StdPath, PathBuf},
    process::Command,
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

/// 打包阶段先把本地产物清单和最终入库键分开：
/// - 本地产物路径只活在当前 complete 调度里；
/// - object_store 存储键才是后续 locator/stream 路由共享的稳定真相。
struct 流媒体打包文件 {
    相对路径: String,
    本地路径: PathBuf,
}

struct 流媒体打包结果 {
    hls主清单相对路径: String,
    dash主清单相对路径: String,
    文件列表: Vec<流媒体打包文件>,
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
    let (宽, 高) = 应用mp4展示方向到视频宽高(bytes, 宽, 高);
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

fn 应用mp4展示方向到视频宽高(bytes: &[u8], 宽: u64, 高: u64) -> (u64, u64) {
    if !mp4视频轨道矩阵需要交换宽高(bytes) {
        return (宽, 高);
    }
    (高, 宽)
}

/// 手机竖拍 MP4 常把编码宽高写成横屏，再用 tkhd 矩阵声明展示方向。
/// `nom-exif` 负责主元数据解析，这里只补齐它尚未暴露的展示矩阵，不另造视频解析核心。
fn mp4视频轨道矩阵需要交换宽高(bytes: &[u8]) -> bool {
    let mut reader = Cursor::new(bytes);
    let Ok(mp4) = mp4::Mp4Reader::read_header(&mut reader, bytes.len() as u64) else {
        return false;
    };
    mp4.tracks().values().any(|track| {
        matches!(track.track_type(), Ok(mp4::TrackType::Video)) && {
            let matrix = &track.trak.tkhd.matrix;
            mp4矩阵表示直角竖屏旋转(matrix.a, matrix.b, matrix.c, matrix.d)
        }
    })
}

fn mp4矩阵表示直角竖屏旋转(a: i32, b: i32, c: i32, d: i32) -> bool {
    const MP4矩阵_一: i32 = 0x0001_0000;
    a == 0
        && d == 0
        && ((b == MP4矩阵_一 && c == -MP4矩阵_一) || (b == -MP4矩阵_一 && c == MP4矩阵_一))
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

fn 媒体分发描述转响应体(distribution: &contract::媒体分发描述) -> serde_json::Value {
    serde_json::json!({
        "swarm_id": distribution.swarm_id,
        "announce_urls": distribution.announce_urls,
        "web_seed_url": distribution.web_seed_url,
        "join_ticket": distribution.join_ticket,
    })
}

fn 构造流媒体受控地址(attachment_id: &str, session_id: &str, asset_path: &str) -> String {
    format!("/api/media/{attachment_id}/stream/{asset_path}?session_id={session_id}")
}

/// 旧附件内容读取路由仍要保留给兼容调用方和冷源 origin。
/// 但它不再承担图片正式 blob 主链的地址身份。
fn 构造附件受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/attachments/{attachment_id}/content?session_id={session_id}&variant={variant}")
}

/// 图片 blob 主链统一收口到 `/api/media/{id}/blob/*`，
/// 避免前端继续把旧附件内容地址误认成正式资产地址。
fn 构造blob受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/media/{attachment_id}/blob/{variant}?session_id={session_id}")
}

fn 推导流媒体对象前缀(attachment_id: &str) -> String {
    format!("streams/{attachment_id}/")
}

fn 流媒体存储键转受控路径<'a>(attachment_id: &str, storage_key: &'a str) -> &'a str {
    storage_key
        .strip_prefix(推导流媒体对象前缀(attachment_id).as_str())
        .unwrap_or(storage_key)
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

fn blob媒体资产描述转响应体(asset: &contract::Blob媒体资产描述) -> serde_json::Value {
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
                构造流媒体受控地址(
                    attachment_id,
                    session_id,
                    流媒体存储键转受控路径(
                        attachment_id,
                        manifest.hls主清单存储键.as_str(),
                    ),
                )
            }),
            dash主清单地址: streaming_manifest.map(|manifest| {
                构造流媒体受控地址(
                    attachment_id,
                    session_id,
                    流媒体存储键转受控路径(
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
            distribution_snapshot.web_seed_until秒,
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
    now_epoch秒: i64,
) -> serde_json::Value {
    let origin_expiry = distribution_snapshot
        .map(|snapshot| snapshot.web_seed_until秒)
        .unwrap_or(now_epoch秒);
    let preview_url = preview_available.then(|| 构造blob受控地址(attachment_id, session_id, "preview"));
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
            mime_type: mime_type.to_string(),
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
        冷源: usecase::构造媒体冷源描述(Some(legacy_original_url), origin_expiry, now_epoch秒),
    };
    blob媒体资产描述转响应体(&asset)
}

fn 构造媒体资产响应体(
    snapshot: &usecase::媒体附件快照,
    runtime_distribution: Option<&serde_json::Value>,
    distribution_snapshot: Option<&usecase::协作分发元数据快照>,
    streaming_manifest: Option<&usecase::流媒体清单快照>,
    original_url: String,
    thumbnail_url: Option<String>,
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
                now_epoch秒,
            ),
        )),
    }
}

fn 媒体附件快照转响应体(
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

fn 推导流媒体对象存储键(attachment_id: &str, asset_path: &str) -> String {
    format!("streams/{attachment_id}/{asset_path}")
}

fn 推导流媒体内容类型(asset_path: &str) -> &'static str {
    match StdPath::new(asset_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
    {
        "m3u8" => "application/vnd.apple.mpegurl",
        "mpd" => "application/dash+xml",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn 执行外部命令(command: &mut Command, step: &str) -> Result<(), (StatusCode, &'static str, String)> {
    let output = command.output().map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("{step} 启动失败: {err}"),
        )
    })?;
    if output.status.success() {
        return Ok(());
    }
    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        "system_error",
        format!(
            "{step} 失败: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout).trim(),
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    ))
}

fn ffprobe检测首音轨是否存在(
    ffprobe_bin: &str,
    输入文件: &StdPath,
) -> Result<bool, (StatusCode, &'static str, String)> {
    let output = Command::new(ffprobe_bin)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(输入文件)
        .output()
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("ffprobe 启动失败: {err}"),
            )
        })?;
    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!(
                "ffprobe 失败: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn 收集目录文件(
    root: &StdPath,
    prefix: &str,
    files: &mut Vec<流媒体打包文件>,
) -> Result<(), (StatusCode, &'static str, String)> {
    let entries = std::fs::read_dir(root).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("读取打包产物目录失败: {err}"),
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("遍历打包产物目录失败: {err}"),
            )
        })?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if path.is_dir() {
            收集目录文件(path.as_path(), relative.as_str(), files)?;
        } else {
            files.push(流媒体打包文件 {
                相对路径: relative,
                本地路径: path,
            });
        }
    }
    Ok(())
}

fn 生成流媒体打包产物(
    ffmpeg_bin: &str,
    ffprobe_bin: &str,
    shaka_packager_bin: &str,
    attachment_id: &str,
    输入文件: &StdPath,
) -> Result<流媒体打包结果, (StatusCode, &'static str, String)> {
    let workdir = std::env::temp_dir().join(format!("koko-stream-{attachment_id}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(workdir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建流媒体打包工作目录失败: {err}"),
        )
    })?;
    let hls_video_dir = workdir.join("hls").join("video");
    let hls_audio_dir = workdir.join("hls").join("audio");
    let dash_dir = workdir.join("dash");
    std::fs::create_dir_all(hls_video_dir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建 HLS 视频目录失败: {err}"),
        )
    })?;
    std::fs::create_dir_all(dash_dir.as_path()).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("创建 DASH 目录失败: {err}"),
        )
    })?;

    let 视频轨道文件 = workdir.join("video.mp4");
    let mut 转码视频 = Command::new(ffmpeg_bin);
    转码视频.args([
        "-y",
        "-i",
    ]);
    转码视频.arg(输入文件);
    转码视频.args([
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-sc_threshold",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-an",
    ]);
    转码视频.arg(视频轨道文件.as_os_str());
    执行外部命令(&mut 转码视频, "FFmpeg 视频转码")?;

    let 有音轨 = ffprobe检测首音轨是否存在(ffprobe_bin, 输入文件)?;
    let 音频轨道文件 = workdir.join("audio.mp4");
    if 有音轨 {
        std::fs::create_dir_all(hls_audio_dir.as_path()).map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("创建 HLS 音频目录失败: {err}"),
            )
        })?;
        let mut 转码音频 = Command::new(ffmpeg_bin);
        转码音频.args(["-y", "-i"]);
        转码音频.arg(输入文件);
        转码音频.args([
            "-map",
            "0:a:0",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-vn",
        ]);
        转码音频.arg(音频轨道文件.as_os_str());
        执行外部命令(&mut 转码音频, "FFmpeg 音频转码")?;
    }

    let mut 打包命令 = Command::new(shaka_packager_bin);
    打包命令.arg(format!(
        "in={},stream=video,init_segment={},segment_template={},playlist_name={}",
        视频轨道文件.display(),
        hls_video_dir.join("init.mp4").display(),
        hls_video_dir.join("$Number$.m4s").display(),
        hls_video_dir.join("main.m3u8").display()
    ));
    if 有音轨 {
        打包命令.arg(format!(
            "in={},stream=audio,init_segment={},segment_template={},playlist_name={},hls_group_id=audio,hls_name=audio",
            音频轨道文件.display(),
            hls_audio_dir.join("init.mp4").display(),
            hls_audio_dir.join("$Number$.m4s").display(),
            hls_audio_dir.join("main.m3u8").display()
        ));
    }
    打包命令.arg("--mpd_output");
    打包命令.arg(dash_dir.join("stream.mpd").as_os_str());
    打包命令.arg("--hls_master_playlist_output");
    打包命令.arg(workdir.join("hls").join("master.m3u8").as_os_str());
    执行外部命令(&mut 打包命令, "Shaka Packager 打包")?;

    let mut 文件列表 = Vec::new();
    收集目录文件(workdir.join("hls").as_path(), "hls", &mut 文件列表)?;
    收集目录文件(workdir.join("dash").as_path(), "dash", &mut 文件列表)?;
    Ok(流媒体打包结果 {
        hls主清单相对路径: "hls/master.m3u8".to_string(),
        dash主清单相对路径: "dash/stream.mpd".to_string(),
        文件列表,
    })
}

async fn 上传流媒体打包产物(
    state: &应用状态,
    attachment_id: &str,
    打包结果: 流媒体打包结果,
) -> Result<usecase::流媒体清单写入请求, (StatusCode, &'static str, String)> {
    for file in &打包结果.文件列表 {
        let storage_key = 推导流媒体对象存储键(attachment_id, file.相对路径.as_str());
        let bytes = fs::read(file.本地路径.as_path()).await.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("读取流媒体打包产物失败: {err}"),
            )
        })?;
        state
            .attachment_store
            .put(&ObjectPath::from(storage_key), bytes.into())
            .await
            .map_err(|err| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("写入流媒体打包产物失败: {err}"),
                )
            })?;
    }

    Ok(usecase::流媒体清单写入请求 {
        附件标识: attachment_id.to_string(),
        hls主清单存储键: 推导流媒体对象存储键(
            attachment_id,
            打包结果.hls主清单相对路径.as_str(),
        ),
        dash主清单存储键: 推导流媒体对象存储键(
            attachment_id,
            打包结果.dash主清单相对路径.as_str(),
        ),
    })
}

fn 解析流媒体相对路径(base_asset_path: &str, referenced_path: &str) -> String {
    if referenced_path.starts_with("http://") || referenced_path.starts_with("https://") {
        return referenced_path.to_string();
    }
    let mut parts = base_asset_path
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !parts.is_empty() {
        parts.pop();
    }
    for part in referenced_path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part.to_string()),
        }
    }
    parts.join("/")
}

fn 重写_hls清单内容(
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
    content: &str,
) -> String {
    content
        .lines()
        .map(|line| {
            if let Some(prefix) = line.split("URI=\"").next() {
                if prefix.len() != line.len() {
                    let mut rewritten = line.to_string();
                    if let Some(start) = line.find("URI=\"") {
                        let value_start = start + 5;
                        if let Some(end_rel) = line[value_start..].find('"') {
                            let value_end = value_start + end_rel;
                            let raw = &line[value_start..value_end];
                            let resolved = 解析流媒体相对路径(asset_path, raw);
                            let absolute = 构造流媒体受控地址(
                                attachment_id,
                                session_id,
                                resolved.as_str(),
                            );
                            rewritten.replace_range(value_start..value_end, absolute.as_str());
                            return rewritten;
                        }
                    }
                }
            }
            if line.starts_with('#') || line.trim().is_empty() {
                return line.to_string();
            }
            let resolved = 解析流媒体相对路径(asset_path, line.trim());
            构造流媒体受控地址(attachment_id, session_id, resolved.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn 重写_xml属性路径(
    content: String,
    attribute_name: &str,
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
) -> String {
    let needle = format!(r#"{attribute_name}=""#);
    let mut current = content;
    let mut search_from = 0;
    while let Some(start_rel) = current[search_from..].find(needle.as_str()) {
        let start = search_from + start_rel;
        let value_start = start + needle.len();
        let Some(end_rel) = current[value_start..].find('"') else {
            break;
        };
        let value_end = value_start + end_rel;
        let raw = current[value_start..value_end].to_string();
        let resolved = 解析流媒体相对路径(asset_path, raw.as_str());
        let absolute = 构造流媒体受控地址(attachment_id, session_id, resolved.as_str());
        current.replace_range(value_start..value_end, absolute.as_str());
        // 必须把扫描游标推进到本次替换之后；
        // 否则下一轮又会命中同一个属性，MPD 重写会在原地自旋。
        search_from = value_start + absolute.len();
    }
    current
}

fn 重写_dash清单内容(
    attachment_id: &str,
    session_id: &str,
    asset_path: &str,
    content: &str,
) -> String {
    let rewritten = 重写_xml属性路径(
        content.to_string(),
        "initialization",
        attachment_id,
        session_id,
        asset_path,
    );
    重写_xml属性路径(
        rewritten,
        "media",
        attachment_id,
        session_id,
        asset_path,
    )
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

    let mut streaming_manifest_request = None;
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
        媒体内容解析结果::视频(parsed) => {
            let 打包结果 = match task::spawn_blocking({
                let ffmpeg_bin = state.ffmpeg_bin.clone();
                let ffprobe_bin = state.ffprobe_bin.clone();
                let shaka_packager_bin = state.shaka_packager_bin.clone();
                let attachment_id = attachment_id.clone();
                let temp_file_path = temp_file_path.clone();
                move || {
                    生成流媒体打包产物(
                        ffmpeg_bin.as_str(),
                        ffprobe_bin.as_str(),
                        shaka_packager_bin.as_str(),
                        attachment_id.as_str(),
                        temp_file_path.as_path(),
                    )
                }
            })
            .await
            {
                Ok(Ok(result)) => result,
                Ok(Err((status, code, message))) => return err_resp(status, code, message),
                Err(err) => {
                    return err_resp(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        format!("流媒体打包任务执行失败: {err}"),
                    )
                }
            };
            streaming_manifest_request =
                match 上传流媒体打包产物(&state, &attachment_id, 打包结果).await {
                    Ok(request) => Some(request),
                    Err((status, code, message)) => return err_resp(status, code, message),
                };
            usecase::媒体附件写入请求 {
                附件标识: attachment_id.clone(),
                种类: prepared.种类.clone(),
                mime_type: parsed.mime_type,
                字节大小: original_bytes.len() as i64,
                宽: parsed.宽,
                高: parsed.高,
                原始内容存储键: prepared.原始内容存储键.clone(),
                缩略图存储键: None,
            }
        }
    };
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
    let torrent = match media_distribution::生成附件torrent元信息(
        distribution_request.content_hash.as_str(),
        original_bytes.as_ref(),
    ) {
        Ok(torrent) => torrent,
        Err(message) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                message,
            );
        }
    };
    let torrent_request = usecase::协作分发torrent元信息写入请求 {
        附件标识: attachment_id.clone(),
        torrent_bytes: torrent.torrent_bytes,
        torrent_info_hash: torrent.torrent_info_hash,
        piece_length字节: torrent.piece_length_bytes,
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let distribution_request_for_write = distribution_request.clone();
    let torrent_request_for_write = torrent_request.clone();
    let streaming_manifest_request_for_write = streaming_manifest_request.clone();
    let complete_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        let snapshot = usecase::完成媒体附件上传(&mut repo, &session_id_for_usecase, &ready_request)
            .map_err(map_domain_err_tuple)?;
        usecase::写入协作分发元数据(&mut repo, &distribution_request_for_write)
            .map_err(map_domain_err_tuple)?;
        usecase::写入协作分发torrent元信息(&mut repo, &torrent_request_for_write)
            .map_err(map_domain_err_tuple)?;
        if let Some(request) = streaming_manifest_request_for_write.as_ref() {
            usecase::写入流媒体清单元数据(&mut repo, request).map_err(map_domain_err_tuple)?;
        }
        Ok::<_, (StatusCode, &'static str, String)>(snapshot)
    })
    .await;
    match complete_result {
        Ok(Ok(snapshot)) => {
            let distribution_snapshot = usecase::协作分发元数据快照 {
                附件标识: attachment_id.clone(),
                content_id: distribution_request.content_id.clone(),
                content_hash: distribution_request.content_hash.clone(),
                swarm_id: distribution_request.swarm_id.clone(),
                web_seed_until秒: distribution_request.web_seed_until秒,
                最近peer存活时间戳秒: None,
                torrent_info_hash: Some(torrent_request.torrent_info_hash.clone()),
            };
            let now_epoch秒 = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or_default();
            let original_url =
                构造附件受控地址(attachment_id.as_str(), session_id.as_str(), "original");
            let thumbnail_url = match &snapshot.种类 {
                usecase::媒体附件类型::图片 => Some(构造附件受控地址(
                    attachment_id.as_str(),
                    session_id.as_str(),
                    "thumbnail",
                )),
                usecase::媒体附件类型::视频 => None,
            };
            let runtime_distribution = media_distribution::协作分发快照转响应值(
                &distribution_snapshot,
                attachment_id.as_str(),
                session_id.as_str(),
                state.swarm_tracker_public_url.as_str(),
                state.swarm_web_seed_public_endpoint.as_deref(),
                now_epoch秒,
                state.swarm_peer_presence_stale_seconds,
            );
            let streaming_manifest_snapshot =
                streaming_manifest_request.as_ref().map(|request| usecase::流媒体清单快照 {
                    附件标识: request.附件标识.clone(),
                    hls主清单存储键: request.hls主清单存储键.clone(),
                    dash主清单存储键: request.dash主清单存储键.clone(),
                });
            let media_asset = 构造媒体资产响应体(
                &snapshot,
                Some(&runtime_distribution),
                Some(&distribution_snapshot),
                streaming_manifest_snapshot.as_ref(),
                original_url,
                thumbnail_url,
                session_id.as_str(),
                now_epoch秒,
            );
            (StatusCode::OK, Json(媒体附件快照转响应体(&snapshot, media_asset))).into_response()
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
    let original_url = 构造附件受控地址(attachment_id.as_str(), query.session_id.as_str(), "original");
    let thumbnail_url = locator.允许缩略图.then(|| {
        构造附件受控地址(attachment_id.as_str(), query.session_id.as_str(), "thumbnail")
    });
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let runtime_distribution = locator.协作分发.as_ref().map(|snapshot| {
        media_distribution::协作分发快照转响应值(
            snapshot,
            attachment_id.as_str(),
            query.session_id.as_str(),
            state.swarm_tracker_public_url.as_str(),
            state.swarm_web_seed_public_endpoint.as_deref(),
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
    Query(mut raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let attachment_variant = match blob_variant.as_str() {
        "preview" => "thumbnail",
        "full" | "original" => "original",
        _ => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "blob variant 必须是 preview、full 或 original",
            )
        }
    };
    raw_query.insert("variant".to_string(), attachment_variant.to_string());
    load_attachment_content(State(state), Path(attachment_id), Query(raw_query), headers)
        .await
        .into_response()
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
        || asset_path.split('/').any(|part| part.is_empty() || part == "." || part == "..")
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

    let object_path = ObjectPath::from(推导流媒体对象存储键(
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
            重写_hls清单内容(
                attachment_id.as_str(),
                query.session_id.as_str(),
                asset_path.as_str(),
                text.as_str(),
            )
        } else {
            重写_dash清单内容(
                attachment_id.as_str(),
                query.session_id.as_str(),
                asset_path.as_str(),
                text.as_str(),
            )
        };
        return (
            [(
                header::CONTENT_TYPE,
                推导流媒体内容类型(asset_path.as_str()).to_string(),
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
                    推导流媒体内容类型(asset_path.as_str()).to_string(),
                ),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (header::CONTENT_RANGE, 构造content_range值(&range, object_size)),
            ],
            body,
        )
            .into_response(),
        None => (
            [
                (
                    header::CONTENT_TYPE,
                    推导流媒体内容类型(asset_path.as_str()).to_string(),
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
                    session_id = query.session_id.as_str(),
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
