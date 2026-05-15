use axum::{
    Json,
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;

use crate::shared::contract;

use super::媒体资产外壳;

/// 广播路径 swarm 运行态上下文。
/// shell 层负责传入，attachments_to_json 负责丰富 distribution_hint JSON。
/// 只在广播含分发线索附件的消息时构造，其他路径传 None。
#[derive(Debug)]
pub(crate) struct SwarmBroadcastContext<'a> {
    /// ticket 签名密钥，无则不签发 join_ticket
    pub ticket_secret: Option<&'a str>,
    /// tracker WebSocket 公开地址
    pub tracker_public_url: &'a str,
    /// STUN/TURN ICE servers（Cloudflare TURN API 失败时为 `[]`）
    pub ice_servers: serde_json::Value,
    /// ticket 有效期（秒）
    pub ticket_ttl_seconds: i64,
    /// 当前 UNIX 时间戳（秒）
    pub now_epoch_seconds: i64,
}

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
/// `swarm_ctx` 只在广播路径传入，历史/订阅/转发路径传 `None`。
pub(crate) fn events_to_json(
    events: Vec<contract::领域事件>,
    session_id: Option<&str>,
    swarm_ctx: Option<&SwarmBroadcastContext<'_>>,
) -> Vec<serde_json::Value> {
    events
        .into_iter()
        .map(|event| event_to_json(event, session_id, swarm_ctx))
        .collect()
}

/// 构造 distribution_hint JSON，可选丰富广播运行态字段。
/// 无 `swarm_ctx` 时只输出四个稳定字段（历史/重播路径）；
/// 有 `swarm_ctx` 时追加 join_ticket、announce_urls、torrent_url、ice_servers，
/// 供前端跳过 HTTP locator 直接创建 prefetch WebTorrent 会话。
fn build_distribution_hint(
    attachment_id: &str,
    hint: &contract::附件分发线索,
    swarm_ctx: Option<&SwarmBroadcastContext<'_>>,
) -> serde_json::Value {
    let mut json = serde_json::json!({
        "content_hash": hint.content_hash,
        "swarm_id": hint.swarm_id,
        "torrent_info_hash": hint.torrent_info_hash,
        "web_seed_until": hint.web_seed_until秒,
    });
    let Some(ctx) = swarm_ctx else { return json };
    // 广播路径：丰富运行态字段供前端直接创建 prefetch WebTorrent 会话
    if let Some(secret) = ctx.ticket_secret {
        let now = ctx.now_epoch_seconds;
        let exp = now + ctx.ticket_ttl_seconds;
        let claims = serde_json::json!({
            "sub": "__room_broadcast__",
            "aid": attachment_id,
            "ih": hint.torrent_info_hash,
            "iat": now as usize,
            "exp": exp as usize,
        });
        if let Ok(ticket) = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
        ) {
            let expires_at = time::OffsetDateTime::from_unix_timestamp(exp)
                .ok()
                .and_then(|dt| dt.format(&time::format_description::well_known::Rfc3339).ok());
            json["join_ticket"] = serde_json::Value::String(ticket.clone());
            json["ticket_expires_at"] = expires_at
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null);
            // torrent_url 用 ticket 鉴权替代 session_id（广播路径无 session_id）
            json["torrent_url"] = serde_json::Value::String(
                format!("/api/media/{}/torrent?ticket={}", attachment_id, ticket),
            );
        }
    }
    json["announce_urls"] = serde_json::json!([ctx.tracker_public_url]);
    // 广播路径 web_seed_url 固定为 null：URL 含 per-session 鉴权无法共享，
    // prefetch (deselect=true) 不下载数据不需要 web_seed
    json["web_seed_url"] = serde_json::Value::Null;
    json["ice_servers"] = ctx.ice_servers.clone();
    json
}

/// 附件槽位状态 → JSON 字符串。
fn 附件槽位状态_to_json(状态: &contract::附件槽位状态) -> &'static str {
    match 状态 {
        contract::附件槽位状态::待上传 => "pending",
        contract::附件槽位状态::上传中 => "uploading",
        contract::附件槽位状态::处理中 => "processing",
        contract::附件槽位状态::已就绪 => "ready",
        contract::附件槽位状态::失败 => "failed",
    }
}

fn attachments_to_json(
    attachments: &[contract::附件快照],
    session_id: Option<&str>,
    swarm_ctx: Option<&SwarmBroadcastContext<'_>>,
) -> Vec<serde_json::Value> {
    attachments
        .iter()
        .map(|attachment| match attachment {
            contract::附件快照::图片(image) => {
                let mut payload = serde_json::json!({
                    "kind": "image",
                    "attachment_id": image.附件标识,
                    "width": image.宽,
                    "height": image.高,
                    "status": 附件槽位状态_to_json(&image.状态),
                    "has_preview_asset": false
                });
                if let Some(ref hint) = image.分发线索 {
                    payload["distribution_hint"] = build_distribution_hint(&image.附件标识, hint, swarm_ctx);
                }
                payload
            }
            contract::附件快照::视频(video) => {
                let mut payload = serde_json::json!({
                    "kind": "video",
                    "attachment_id": video.附件标识,
                    "width": video.宽,
                    "height": video.高,
                    "status": 附件槽位状态_to_json(&video.状态),
                    "has_preview_asset": video.有预览图
                });
                if let Some(ref hint) = video.分发线索 {
                    payload["distribution_hint"] = build_distribution_hint(&video.附件标识, hint, swarm_ctx);
                }
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
/// `swarm_ctx` 只在广播路径传入，其他路径传 `None`。
pub(crate) fn event_to_json(
    event: contract::领域事件,
    session_id: Option<&str>,
    swarm_ctx: Option<&SwarmBroadcastContext<'_>>,
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
            "attachments": attachments_to_json(&附件, session_id, swarm_ctx),
            "event_position": 事件位置
        }),
        contract::领域事件::附件状态已变更 {
            房间标识,
            消息标识,
            附件标识,
            状态,
            附件,
            错误码,
            事件位置,
        } => {
            let mut payload = serde_json::json!({
                "type": "attachment_status_changed",
                "room_id": 房间标识,
                "message_id": 消息标识,
                "attachment_id": 附件标识,
                "status": 附件槽位状态_to_json(&状态),
                "event_position": 事件位置
            });
            if let Some(att) = 附件 {
                payload["attachment"] = attachments_to_json(&[att], session_id, swarm_ctx)
                    .into_iter()
                    .next()
                    .unwrap_or(serde_json::Value::Null);
            }
            if let Some(code) = 错误码 {
                let (_, code_str, _) = map_domain_err_tuple(code);
                payload["error_code"] = serde_json::Value::String(code_str.to_string());
            }
            payload
        }
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
