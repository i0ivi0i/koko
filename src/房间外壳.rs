use super::{应用状态, 构建共享仓储, err_resp, events_to_json, map_domain_err_tuple, 附件上传模式};
use crate::{contract, usecase};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use image::{DynamicImage, ImageFormat};
use object_store::{path::Path as ObjectPath, signer::Signer, ObjectStoreExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    io::Cursor,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::task;
use uuid::Uuid;

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

/// 图片 prepare 请求体。
#[derive(Deserialize)]
pub(super) struct PrepareImageUploadBody {
    session_id: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    byte_size: Option<i64>,
}

/// 图片 complete 请求体。
#[derive(Deserialize)]
pub(super) struct CompleteImageUploadBody {
    session_id: Option<String>,
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
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "limit 必须是整数"));
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

fn 推导原图扩展名(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".bin",
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

enum 图片内容解析错误 {
    类型不允许(&'static str),
    系统错误(&'static str),
}

/// 旧直传和新 complete 都必须走同一条图片解析链：
/// - 真 MIME 以后端探测为准；
/// - 宽高和缩略图以后端解码结果为准；
/// - 不把“文件后缀/前端 mime”冒充成权威事实。
fn 解析图片内容(bytes: &[u8]) -> Result<图片内容解析结果, 图片内容解析错误> {
    let Some(kind) = infer::get(bytes) else {
        return Err(图片内容解析错误::类型不允许("只允许上传图片"));
    };
    if !kind.mime_type().starts_with("image/") {
        return Err(图片内容解析错误::类型不允许("只允许上传图片"));
    }
    let decoded =
        image::load_from_memory(bytes).map_err(|_| 图片内容解析错误::类型不允许("图片内容非法"))?;
    let normalized_image = 应用exif方向(decoded, 读取exif方向(bytes));
    let 缩略图字节 =
        生成缩略图字节(&normalized_image).map_err(|_| 图片内容解析错误::系统错误("生成图片缩略图失败"))?;
    Ok(图片内容解析结果 {
        mime_type: kind.mime_type().to_string(),
        宽: normalized_image.width() as i32,
        高: normalized_image.height() as i32,
        缩略图字节,
    })
}

fn 读取非空会话标识(
    raw_session_id: Option<String>,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    raw_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((StatusCode::BAD_REQUEST, "invalid_argument", "缺少 session_id"))
}

fn 校验图片准备请求(
    mime_type: &str,
    byte_size: i64,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    if !mime_type.starts_with("image/") {
        return Err((
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "只允许上传图片",
        ));
    }
    if byte_size <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "图片大小非法"));
    }
    if byte_size > 10 * 1024 * 1024 {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "attachment_too_large",
            "图片超过 10MB 上限",
        ));
    }
    Ok(())
}

fn 图片附件快照转响应体(snapshot: &usecase::图片附件快照) -> serde_json::Value {
    serde_json::json!({
        "attachment_id": snapshot.附件标识,
        "kind": "image",
        "mime_type": snapshot.mime_type,
        "byte_size": snapshot.字节大小,
        "width": snapshot.宽,
        "height": snapshot.高,
        "status": "ready",
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
        Ok(contract::快照::房间历史页 { 房间标识, 消息 }) => {
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

/// 冷路径：申请图片附件上传占位。
/// 这一步只创建 prepared 真相，并返回后续直传所需参数；不在这里上传字节。
pub(super) async fn prepare_image_upload(
    State(state): State<应用状态>,
    Json(body): Json<PrepareImageUploadBody>,
) -> impl IntoResponse {
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
        None => return err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 file_name"),
    };
    let mime_type = match body
        .mime_type
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    {
        Some(mime_type) => mime_type,
        None => return err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 mime_type"),
    };
    let byte_size = match body.byte_size {
        Some(byte_size) => byte_size,
        None => return err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 byte_size"),
    };
    if let Err((status, code, message)) = 校验图片准备请求(&mime_type, byte_size) {
        return err_resp(status, code, message);
    }

    let attachment_id = 生成附件标识();
    let original_storage_key = format!(
        "images/{attachment_id}/original{}",
        推导原图扩展名(mime_type.as_str())
    );
    let prepare_request = usecase::图片附件准备请求 {
        附件标识: attachment_id.clone(),
        mime_type: mime_type.clone(),
        字节大小: byte_size,
        原图存储键: original_storage_key.clone(),
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let prepare_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::准备图片附件上传(&mut repo, &session_id_for_usecase, &prepare_request)
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

    // 这里把“浏览器该往哪儿 PUT”收口到 shell 层：
    // - local 回环用于测试与最小回滚窗；
    // - s3 兼容直传则返回真正的预签名 URL。
    let (upload_url, upload_headers) = match &state.attachment_upload_mode {
        附件上传模式::本地回环 => (
            format!("/api/media/{}/upload", snapshot.附件标识),
            serde_json::json!({
                "content-type": snapshot.mime_type,
                "x-koko-session-id": session_id,
            }),
        ),
        附件上传模式::S3兼容直传 { signer } => {
            let signed_url = match signer
                .signed_url(
                    reqwest::Method::PUT,
                    &ObjectPath::from(snapshot.原图存储键.clone()),
                    Duration::from_secs(15 * 60),
                )
                .await
            {
                Ok(url) => url,
                Err(err) => {
                    tracing::error!(
                        usecase = "准备图片上传",
                        adapter = "http",
                        outcome = "failed",
                        request_kind = "图片上传 prepare",
                        session_id = session_id.as_str(),
                        attachment_id = snapshot.附件标识.as_str(),
                        file_name = file_name.as_str(),
                        error_code = "system_error",
                        error = %err,
                        "生成对象存储预签名 URL 失败"
                    );
                    return err_resp(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "生成上传地址失败",
                    );
                }
            };
            (
                signed_url.to_string(),
                serde_json::json!({
                    "content-type": snapshot.mime_type,
                }),
            )
        }
    };
    let expires_at = (SystemTime::now() + Duration::from_secs(15 * 60))
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    tracing::info!(
        usecase = "准备图片上传",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "图片上传 prepare",
        session_id = session_id.as_str(),
        attachment_id = snapshot.附件标识.as_str(),
        file_name = file_name.as_str(),
        byte_size = byte_size,
        "图片上传占位已创建"
    );
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": snapshot.附件标识,
            "upload_method": "PUT",
            "upload_url": upload_url,
            "upload_headers": upload_headers,
            "expires_at": expires_at,
        })),
    )
        .into_response()
}

/// 本地对象存储回环上传入口：
/// 1. 只在 local 存储模式下作为开发/测试兜底；
/// 2. 仍然复用 prepared 真相校验，不允许旁路写对象。
pub(super) async fn upload_prepared_image_content(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let session_id = match headers
        .get("x-koko-session-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(session_id) => session_id,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 x-koko-session-id",
            )
        }
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let prepared = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        usecase::读取待完成图片附件(&repo, &session_id_for_usecase, &attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(prepared)) => prepared,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("本地上传任务执行失败: {err}"),
            )
        }
    };
    if body.len() as i64 != prepared.字节大小 {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "上传文件大小与 prepare 不一致",
        );
    }

    let put_result = match state
        .attachment_store
        .put(&ObjectPath::from(prepared.原图存储键), body.into())
        .await
    {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                usecase = "本地回环上传原图",
                adapter = "http",
                outcome = "failed",
                request_kind = "图片原图 PUT",
                session_id = session_id.as_str(),
                attachment_id = attachment_id.as_str(),
                error_code = "system_error",
                error = %err,
                "写入 prepared 原图对象失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "写入原图对象失败",
            );
        }
    };

    // 这里必须把对象写入后的 ETag 原样回给浏览器上传器：
    // - Uppy 单段 PUT 在 2xx 后还会读取 ETag 作为完成信号；
    // - 如果我们只回 204 不带 ETag，前端就会一直停留在“上传中”，直到 watchdog 超时；
    // - 因此缺少 ETag 不能伪装成成功，必须明确报错。
    let Some(etag) = put_result.e_tag.filter(|value| !value.trim().is_empty()) else {
        tracing::error!(
            usecase = "本地回环上传原图",
            adapter = "http",
            outcome = "failed",
            request_kind = "图片原图 PUT",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "system_error",
            "本地回环上传成功但对象存储未返回 ETag"
        );
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "上传响应缺少 ETag",
        );
    };

    (StatusCode::NO_CONTENT, [(header::ETAG, etag)]).into_response()
}

/// 冷路径：完成图片附件上传。
/// 这里读取已经落到对象存储里的原图，解码并生成缩略图后，再把 prepared 升级成 ready。
pub(super) async fn complete_image_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Json(body): Json<CompleteImageUploadBody>,
) -> impl IntoResponse {
    let session_id = match 读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let prepared = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        usecase::读取待完成图片附件(&repo, &session_id_for_usecase, &attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(prepared)) => prepared,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("complete 任务执行失败: {err}"),
            )
        }
    };

    let original_path = ObjectPath::from(prepared.原图存储键.clone());
    let get_result = match state.attachment_store.get(&original_path).await {
        Ok(result) => result,
        Err(err) => {
            tracing::warn!(
                usecase = "完成图片上传",
                adapter = "http",
                outcome = "rejected",
                request_kind = "图片上传 complete",
                session_id = session_id.as_str(),
                attachment_id = attachment_id.as_str(),
                error_code = "attachment_not_ready",
                error = %err,
                "complete 时原图对象尚未可读"
            );
            return err_resp(StatusCode::CONFLICT, "attachment_not_ready", "原图尚未上传完成");
        }
    };
    let original_bytes = match get_result.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                usecase = "完成图片上传",
                adapter = "http",
                outcome = "failed",
                request_kind = "图片上传 complete",
                session_id = session_id.as_str(),
                attachment_id = attachment_id.as_str(),
                error_code = "system_error",
                error = %err,
                "读取原图对象失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "读取原图对象失败",
            );
        }
    };
    let parsed = match 解析图片内容(original_bytes.as_ref()) {
        Ok(parsed) => parsed,
        Err(图片内容解析错误::类型不允许(message)) => {
            return err_resp(StatusCode::BAD_REQUEST, "attachment_type_not_allowed", message)
        }
        Err(图片内容解析错误::系统错误(message)) => {
            return err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", message)
        }
    };

    let thumbnail_storage_key = format!("images/{attachment_id}/thumbnail.png");
    let thumbnail_path = ObjectPath::from(thumbnail_storage_key.clone());
    if let Err(err) = state
        .attachment_store
        .put(&thumbnail_path, parsed.缩略图字节.into())
        .await
    {
        tracing::error!(
            usecase = "完成图片上传",
            adapter = "http",
            outcome = "failed",
            request_kind = "图片上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "system_error",
            error = %err,
            "写入缩略图对象失败"
        );
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "写入缩略图对象失败",
        );
    }

    let ready_request = usecase::图片附件写入请求 {
        附件标识: attachment_id.clone(),
        mime_type: parsed.mime_type,
        字节大小: original_bytes.len() as i64,
        宽: parsed.宽,
        高: parsed.高,
        原图存储键: prepared.原图存储键.clone(),
        缩略图存储键: Some(thumbnail_storage_key),
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let complete_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::完成图片附件上传(&mut repo, &session_id_for_usecase, &ready_request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    match complete_result {
        Ok(Ok(snapshot)) => (
            StatusCode::OK,
            Json(图片附件快照转响应体(&snapshot)),
        )
            .into_response(),
        Ok(Err((status, code, message))) => err_resp(status, code, message),
        Err(err) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("complete 任务执行失败: {err}"),
        ),
    }
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
