use axum::{
    Json,
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;

use crate::shared::contract;

use super::媒体资产外壳;

/// 统一错误响应体（跨 HTTP 接口稳定结构）。
#[derive(Serialize)]
struct ApiError {
    /// 稳定错误码，供前端逻辑判断。
    code: &'static str,
    /// 可读错误信息，主要用于显示和排障。
    message: String,
}

/// 领域事件 -> 传输 JSON 的稳定映射层。
/// 约束：只做字段翻译，不添加业务语义。
pub(crate) fn events_to_json(
    events: Vec<contract::领域事件>,
    session_id: Option<&str>,
) -> Vec<serde_json::Value> {
    events
        .into_iter()
        .map(|event| event_to_json(event, session_id))
        .collect()
}

fn attachments_to_json(
    attachments: &[contract::附件快照],
    session_id: Option<&str>,
) -> Vec<serde_json::Value> {
    attachments
        .iter()
        .map(|attachment| match attachment {
            contract::附件快照::图片(image) => {
                serde_json::json!({
                    "kind": "image",
                    "attachment_id": image.附件标识,
                    "width": image.宽,
                    "height": image.高,
                    "has_preview_asset": false
                })
            }
            contract::附件快照::视频(video) => {
                let mut payload = serde_json::json!({
                    "kind": "video",
                    "attachment_id": video.附件标识,
                    "width": video.宽,
                    "height": video.高,
                    "has_preview_asset": video.有预览图
                });
                if let Some(preview_asset) = 媒体资产外壳::构造预览资源响应体(
                    video.附件标识.as_str(),
                    session_id,
                    video.有预览图,
                ) {
                    payload["preview_asset"] = preview_asset;
                }
                payload
            }
        })
        .collect()
}

/// 单条领域事件 -> JSON。
pub(crate) fn event_to_json(
    event: contract::领域事件,
    session_id: Option<&str>,
) -> serde_json::Value {
    match event {
        contract::领域事件::消息已创建 {
            房间标识,
            消息标识,
            客户端消息标识,
            发送者会话标识,
            发送者花名,
            文本,
            附件,
            事件位置,
        } => serde_json::json!({
            "type": "message_created",
            "room_id": 房间标识,
            "message_id": 消息标识,
            "client_message_id": 客户端消息标识,
            "sender_session_id": 发送者会话标识,
            "sender_display_alias": 发送者花名,
            "text": 文本,
            "body": 文本,
            "attachments": attachments_to_json(&附件, session_id),
            "event_position": 事件位置
        }),
    }
}

/// 领域错误码 -> HTTP 状态码 + 稳定错误码的映射表。
/// 约束：这里不做领域判断，只做“已得到错误码”的协议转码。
pub(crate) fn map_domain_err_tuple(code: contract::错误码) -> (StatusCode, &'static str, String) {
    match code {
        contract::错误码::参数非法 => (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "请求参数非法".to_string(),
        ),
        contract::错误码::会话无效 => (
            StatusCode::UNAUTHORIZED,
            "invalid_session",
            "会话无效".to_string(),
        ),
        contract::错误码::房间不存在 => (
            StatusCode::NOT_FOUND,
            "room_not_found",
            "房间不存在".to_string(),
        ),
        contract::错误码::成员资格不足 => (
            StatusCode::FORBIDDEN,
            "membership_required",
            "成员资格不足".to_string(),
        ),
        contract::错误码::附件不存在 => (
            StatusCode::NOT_FOUND,
            "attachment_not_found",
            "附件不存在".to_string(),
        ),
        contract::错误码::附件不属于当前发送者 => (
            StatusCode::FORBIDDEN,
            "attachment_not_owned",
            "附件不属于当前发送者".to_string(),
        ),
        contract::错误码::附件未就绪 => (
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "附件尚未就绪".to_string(),
        ),
        contract::错误码::附件类型不支持 => (
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "附件类型不支持".to_string(),
        ),
        contract::错误码::附件数量超限 => (
            StatusCode::BAD_REQUEST,
            "attachment_count_exceeded",
            "附件数量超限".to_string(),
        ),
        contract::错误码::消息文本过长 => (
            StatusCode::BAD_REQUEST,
            "message_text_too_long",
            "消息文本过长".to_string(),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "系统错误".to_string(),
        ),
    }
}

/// 统一 API 错误响应构造器。
pub(crate) fn err_resp(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> axum::response::Response {
    (
        status,
        Json(ApiError {
            code,
            message: message.into(),
        }),
    )
        .into_response()
}
