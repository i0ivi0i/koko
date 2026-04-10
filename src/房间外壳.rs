use super::{应用状态, 构建共享仓储, err_resp, events_to_json, map_domain_err_tuple};
use crate::{contract, usecase};
use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use image::{DynamicImage, ImageFormat};
use object_store::{path::Path as ObjectPath, ObjectStoreExt};
use serde::Deserialize;
use std::{collections::HashMap, io::Cursor};
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

fn 生成上传诊断标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("upl-{}", &raw[..12])
}

/// 上传链诊断头只服务排障：
/// 1. 它不进入共享 contract；
/// 2. 也不参与业务判断；
/// 3. 只用于把“前端这次失败”和“后端哪条日志”快速对上。
fn 附带上传诊断头(
    response: impl IntoResponse,
    upload_trace_id: &str,
) -> Response {
    let mut response = response.into_response();
    if let Ok(value) = HeaderValue::from_str(upload_trace_id) {
        response
            .headers_mut()
            .insert(header::HeaderName::from_static("x-koko-upload-id"), value);
    }
    response
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

/// 冷路径：上传图片附件。
/// 约束：
/// 1. 上传成功只创建附件，不创建消息
/// 2. 真 MIME 必须以后端探测为准
/// 3. 存储写入失败时不应留下“已 ready 的数据库真相”
pub(super) async fn upload_image_attachment(
    State(state): State<应用状态>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let upload_trace_id = 生成上传诊断标识();
    let content_length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-");
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-");
    let mut session_id: Option<String> = None;
    let mut file_bytes: Option<axum::body::Bytes> = None;

    loop {
        let next = match multipart.next_field().await {
            Ok(next) => next,
            Err(err) => {
                tracing::warn!(
                    usecase = "上传图片附件",
                    adapter = "http",
                    outcome = "rejected",
                    request_kind = "图片附件上传",
                    upload_trace_id = upload_trace_id.as_str(),
                    content_length = content_length,
                    user_agent = user_agent,
                    error_code = "invalid_argument",
                    error = %err,
                    "multipart 载荷解析失败"
                );
                return 附带上传诊断头(
                    err_resp(
                        StatusCode::BAD_REQUEST,
                        "invalid_argument",
                        "multipart 载荷非法",
                    ),
                    &upload_trace_id,
                );
            }
        };
        let Some(field) = next else {
            break;
        };
        match field.name().unwrap_or_default() {
            "session_id" => match field.text().await {
                Ok(value) => session_id = Some(value),
                Err(err) => {
                    tracing::warn!(
                        usecase = "上传图片附件",
                        adapter = "http",
                        outcome = "rejected",
                        request_kind = "图片附件上传",
                        upload_trace_id = upload_trace_id.as_str(),
                        content_length = content_length,
                        user_agent = user_agent,
                        error_code = "invalid_argument",
                        error = %err,
                        "session_id 字段读取失败"
                    );
                    return 附带上传诊断头(
                        err_resp(
                            StatusCode::BAD_REQUEST,
                            "invalid_argument",
                            "session_id 字段非法",
                        ),
                        &upload_trace_id,
                    );
                }
            },
            "file" => match field.bytes().await {
                Ok(bytes) => file_bytes = Some(bytes),
                Err(err) => {
                    tracing::warn!(
                        usecase = "上传图片附件",
                        adapter = "http",
                        outcome = "rejected",
                        request_kind = "图片附件上传",
                        upload_trace_id = upload_trace_id.as_str(),
                        content_length = content_length,
                        user_agent = user_agent,
                        error_code = "invalid_argument",
                        error = %err,
                        "图片文件字段读取失败"
                    );
                    return 附带上传诊断头(
                        err_resp(
                            StatusCode::BAD_REQUEST,
                            "invalid_argument",
                            "图片文件字段非法",
                        ),
                        &upload_trace_id,
                    );
                }
            },
            _ => {}
        }
    }

    let Some(session_id) = session_id.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) else {
        tracing::warn!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "rejected",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            content_length = content_length,
            user_agent = user_agent,
            error_code = "invalid_argument",
            "上传图片附件缺少 session_id"
        );
        return 附带上传诊断头(
            err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 session_id",
            ),
            &upload_trace_id,
        );
    };
    let Some(file_bytes) = file_bytes else {
        tracing::warn!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "rejected",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            content_length = content_length,
            user_agent = user_agent,
            session_id = session_id.as_str(),
            error_code = "invalid_argument",
            "上传图片附件缺少 file"
        );
        return 附带上传诊断头(
            err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 file"),
            &upload_trace_id,
        );
    };

    tracing::info!(
        usecase = "上传图片附件",
        adapter = "http",
        outcome = "accepted",
        request_kind = "图片附件上传",
        upload_trace_id = upload_trace_id.as_str(),
        content_length = content_length,
        user_agent = user_agent,
        session_id = session_id.as_str(),
        file_byte_size = file_bytes.len(),
        "HTTP 请求已受理"
    );

    let sniffed = infer::get(file_bytes.as_ref());
    let Some(kind) = sniffed else {
        tracing::warn!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "rejected",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            session_id = session_id.as_str(),
            error_code = "attachment_type_not_allowed",
            "无法识别上传文件类型"
        );
        return 附带上传诊断头(
            err_resp(
                StatusCode::BAD_REQUEST,
                "attachment_type_not_allowed",
                "只允许上传图片",
            ),
            &upload_trace_id,
        );
    };
    if !kind.mime_type().starts_with("image/") {
        tracing::warn!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "rejected",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            session_id = session_id.as_str(),
            sniffed_mime = kind.mime_type(),
            error_code = "attachment_type_not_allowed",
            "上传文件不是图片"
        );
        return 附带上传诊断头(
            err_resp(
                StatusCode::BAD_REQUEST,
                "attachment_type_not_allowed",
                "只允许上传图片",
            ),
            &upload_trace_id,
        );
    }

    let decoded = match image::load_from_memory(file_bytes.as_ref()) {
        Ok(image) => image,
        Err(err) => {
            tracing::warn!(
                usecase = "上传图片附件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "图片附件上传",
                upload_trace_id = upload_trace_id.as_str(),
                session_id = session_id.as_str(),
                sniffed_mime = kind.mime_type(),
                error_code = "attachment_type_not_allowed",
                error = %err,
                "图片解码失败"
            );
            return 附带上传诊断头(
                err_resp(
                    StatusCode::BAD_REQUEST,
                    "attachment_type_not_allowed",
                    "图片内容非法",
                ),
                &upload_trace_id,
            );
        }
    };
    let normalized_image = 应用exif方向(decoded, 读取exif方向(file_bytes.as_ref()));
    let width = normalized_image.width() as i32;
    let height = normalized_image.height() as i32;
    let thumbnail_bytes = match 生成缩略图字节(&normalized_image) {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                usecase = "上传图片附件",
                adapter = "http",
                outcome = "failed",
                request_kind = "图片附件上传",
                upload_trace_id = upload_trace_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "生成图片缩略图失败"
            );
            return 附带上传诊断头(
                err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "生成图片缩略图失败",
                ),
                &upload_trace_id,
            );
        }
    };

    let attachment_id = 生成附件标识();
    let original_storage_key = format!(
        "images/{attachment_id}/original{}",
        推导原图扩展名(kind.mime_type())
    );
    let thumbnail_storage_key = format!("images/{attachment_id}/thumbnail.png");
    let original_path = ObjectPath::from(original_storage_key.clone());
    let thumbnail_path = ObjectPath::from(thumbnail_storage_key.clone());

    if let Err(err) = state
        .attachment_store
        .put(&original_path, file_bytes.clone().into())
        .await
    {
        tracing::error!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "failed",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            session_id = session_id.as_str(),
            error_code = "system_error",
            error = %err,
            "写入原图对象失败"
        );
        return 附带上传诊断头(
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "写入原图对象失败",
            ),
            &upload_trace_id,
        );
    }
    if let Err(err) = state
        .attachment_store
        .put(&thumbnail_path, thumbnail_bytes.into())
        .await
    {
        let _ = state.attachment_store.delete(&original_path).await;
        tracing::error!(
            usecase = "上传图片附件",
            adapter = "http",
            outcome = "failed",
            request_kind = "图片附件上传",
            upload_trace_id = upload_trace_id.as_str(),
            session_id = session_id.as_str(),
            error_code = "system_error",
            error = %err,
            "写入图片缩略图失败"
        );
        return 附带上传诊断头(
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "写入图片缩略图失败",
            ),
            &upload_trace_id,
        );
    }

    let state_for_usecase = state.clone();
    let request = usecase::图片附件写入请求 {
        附件标识: attachment_id.clone(),
        mime_type: kind.mime_type().to_string(),
        字节大小: file_bytes.len() as i64,
        宽: width,
        高: height,
        原图存储键: original_storage_key.clone(),
        缩略图存储键: Some(thumbnail_storage_key.clone()),
    };
    let session_id_for_usecase = session_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::登记图片附件(&mut repo, &session_id_for_usecase, &request)
            .map_err(map_domain_err_tuple)
    })
    .await;

    let result = match result {
        Ok(v) => v,
        Err(err) => {
            let _ = state.attachment_store.delete(&original_path).await;
            let _ = state.attachment_store.delete(&thumbnail_path).await;
            tracing::error!(
                usecase = "上传图片附件",
                adapter = "http",
                outcome = "failed",
                request_kind = "图片附件上传",
                upload_trace_id = upload_trace_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "上传图片附件任务执行失败"
            );
            return 附带上传诊断头(
                err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("任务执行失败: {err}"),
                ),
                &upload_trace_id,
            );
        }
    };

    match result {
        Ok(snapshot) => {
            tracing::info!(
                usecase = "上传图片附件",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "图片附件上传",
                upload_trace_id = upload_trace_id.as_str(),
                session_id = session_id.as_str(),
                attachment_id = snapshot.附件标识.as_str(),
                "上传图片附件成功"
            );
            附带上传诊断头(
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "attachment_id": snapshot.附件标识,
                        "kind": "image",
                        "mime_type": snapshot.mime_type,
                        "byte_size": snapshot.字节大小,
                        "width": snapshot.宽,
                        "height": snapshot.高,
                        "status": "ready",
                    })),
                ),
                &upload_trace_id,
            )
        }
        Err((status, code, message)) => {
            let _ = state.attachment_store.delete(&original_path).await;
            let _ = state.attachment_store.delete(&thumbnail_path).await;
            tracing::warn!(
                usecase = "上传图片附件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "图片附件上传",
                upload_trace_id = upload_trace_id.as_str(),
                session_id = session_id.as_str(),
                error_code = code,
                "上传图片附件被拒绝"
            );
            附带上传诊断头(err_resp(status, code, message), &upload_trace_id)
        }
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
