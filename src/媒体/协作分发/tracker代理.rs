use crate::{media_distribution, shell::应用状态};
use axum::{
    extract::{
        OriginalUri, State,
        ws::{CloseFrame as AxumCloseFrame, Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite;

/// 协作分发 tracker 同源代理：
/// 1. 浏览器永远连当前应用域名下的 `/api/swarm/announce`，不再直连 tracker upstream；
/// 2. 这里是明确的协议适配 owner，只做首帧门禁和 websocket 字节转发；
/// 3. 验证通过后首帧原样透传给成熟 tracker，避免我们手搓第二套 swarm 真相。
pub(crate) async fn proxy_swarm_tracker_announce(
    State(state): State<应用状态>,
    original_uri: OriginalUri,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let announce_query = original_uri.0.query().unwrap_or_default();
    let upstream_url =
        拼接tracker上游查询(state.swarm_tracker_upstream_url.as_str(), announce_query);
    let ticket_secret = state.swarm_ticket_secret.clone();
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = relay_swarm_tracker_socket(socket, upstream_url, ticket_secret).await {
            if error.应该写启动器warn() {
                tracing::warn!(
                    application = "协作分发tracker代理",
                    adapter = "http",
                    outcome = "failed",
                    error_code = "swarm_tracker_proxy_failed",
                    detail = %error,
                    "同源 tracker 代理转发失败"
                );
            } else {
                tracing::debug!(
                    application = "协作分发tracker验票",
                    adapter = "http",
                    outcome = "rejected",
                    error_code = "swarm_tracker_join_ticket_rejected",
                    invalid_reason = error.invalid_reason().unwrap_or("unknown"),
                    info_hash = error.info_hash().unwrap_or("unknown"),
                    detail = %error,
                    "tracker 首帧被入场门禁拒绝"
                );
            }
        }
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tracker代理错误 {
    门禁拒绝 {
        invalid_reason: &'static str,
        detail: String,
        info_hash: Option<String>,
    },
    代理转发失败(String),
}

impl Tracker代理错误 {
    fn 应该写启动器warn(&self) -> bool {
        matches!(self, Self::代理转发失败(_))
    }

    fn invalid_reason(&self) -> Option<&'static str> {
        match self {
            Self::门禁拒绝 { invalid_reason, .. } => Some(*invalid_reason),
            Self::代理转发失败(_) => None,
        }
    }

    fn info_hash(&self) -> Option<&str> {
        match self {
            Self::门禁拒绝 { info_hash, .. } => info_hash.as_deref(),
            Self::代理转发失败(_) => None,
        }
    }
}

impl std::fmt::Display for Tracker代理错误 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::门禁拒绝 { detail, .. } | Self::代理转发失败(detail) => {
                formatter.write_str(detail)
            }
        }
    }
}

async fn relay_swarm_tracker_socket(
    socket: WebSocket,
    upstream_url: String,
    ticket_secret: Option<String>,
) -> Result<(), Tracker代理错误> {
    let (mut client_writer, mut client_reader) = socket.split();
    let first_client_message = client_reader
        .next()
        .await
        .ok_or_else(|| Tracker代理错误::门禁拒绝 {
            invalid_reason: "client_closed_before_first_frame",
            detail: "客户端在发送 tracker 首帧前已断开".to_string(),
            info_hash: None,
        })?
        .map_err(|error| Tracker代理错误::门禁拒绝 {
            invalid_reason: "read_first_frame_failed",
            detail: format!("读取客户端 tracker 首帧失败: {error}"),
            info_hash: None,
        })?;

    // 这里不是自研 tracker：只做业务入场门禁，验证首帧后不维护 peer、offer、swarm 状态。
    // WebTorrent signaling 全部交给成熟 tracker upstream。
    校验tracker首帧门禁(&first_client_message, ticket_secret.as_deref())?;

    let first_upstream_message = axum_ws_message_to_tungstenite(first_client_message)
        .ok_or_else(|| Tracker代理错误::门禁拒绝 {
            invalid_reason: "non_forwardable_first_frame",
            detail: "tracker 首帧不是可转发消息".to_string(),
            info_hash: None,
        })?;
    let (upstream_socket, _) = tokio_tungstenite::connect_async(upstream_url.as_str())
        .await
        .map_err(|error| {
            Tracker代理错误::代理转发失败(format!("连接 tracker upstream 失败: {error}"))
        })?;
    let (mut upstream_writer, mut upstream_reader) = upstream_socket.split();
    upstream_writer
        .send(first_upstream_message)
        .await
        .map_err(|error| {
            Tracker代理错误::代理转发失败(format!("写入 tracker upstream 首帧失败: {error}"))
        })?;

    let client_to_upstream = async {
        while let Some(message_result) = client_reader.next().await {
            let message = message_result.map_err(|error| {
                Tracker代理错误::代理转发失败(format!("读取客户端 websocket 失败: {error}"))
            })?;
            let Some(upstream_message) = axum_ws_message_to_tungstenite(message) else {
                continue;
            };
            upstream_writer
                .send(upstream_message)
                .await
                .map_err(|error| {
                    Tracker代理错误::代理转发失败(format!(
                        "写入 tracker upstream websocket 失败: {error}"
                    ))
                })?;
        }
        Ok::<(), Tracker代理错误>(())
    };

    let upstream_to_client = async {
        while let Some(message_result) = upstream_reader.next().await {
            let message = message_result.map_err(|error| {
                Tracker代理错误::代理转发失败(format!(
                    "读取 tracker upstream websocket 失败: {error}"
                ))
            })?;
            let Some(client_message) = tungstenite_message_to_axum_ws(message) else {
                continue;
            };
            client_writer
                .send(client_message)
                .await
                .map_err(|error| {
                    Tracker代理错误::代理转发失败(format!("写入客户端 websocket 失败: {error}"))
                })?;
        }
        Ok::<(), Tracker代理错误>(())
    };

    tokio::select! {
        forward_result = client_to_upstream => forward_result?,
        backward_result = upstream_to_client => backward_result?,
    }
    Ok(())
}

fn 拼接tracker上游查询(base_url: &str, announce_query: &str) -> String {
    if announce_query.is_empty() {
        return base_url.to_string();
    }
    let separator = if base_url.contains('?') { '&' } else { '?' };
    format!("{base_url}{separator}{announce_query}")
}

fn 校验tracker首帧门禁(
    message: &AxumWsMessage,
    ticket_secret: Option<&str>,
) -> Result<(), Tracker代理错误> {
    let Some(secret) = ticket_secret else {
        return Ok(());
    };

    let (info_hash, ticket) = 解析tracker首帧门禁字段(message).map_err(|error| {
        // 旧页面、旧 service worker 或探测流可能发来不完整首帧；这里仍然拒绝，
        // 但它不是 tracker upstream 故障，不能污染 run.ps1 的 WARN 面。
        Tracker代理错误::门禁拒绝 {
            invalid_reason: "malformed_first_frame",
            detail: error,
            info_hash: None,
        }
    })?;
    let Some(ticket) = ticket else {
        return Err(Tracker代理错误::门禁拒绝 {
            invalid_reason: "missing_ticket",
            detail: "join_ticket_invalid".to_string(),
            info_hash: Some(info_hash),
        });
    };

    match media_distribution::诊断协作分发join_ticket(secret, info_hash.as_str(), ticket.as_str())
    {
        media_distribution::协作分发入群票据校验诊断::通过 => Ok(()),
        media_distribution::协作分发入群票据校验诊断::票据解码失败 => {
            Err(Tracker代理错误::门禁拒绝 {
                invalid_reason: "ticket_decode_failed",
                detail: "join_ticket_invalid".to_string(),
                info_hash: Some(info_hash),
            })
        }
        media_distribution::协作分发入群票据校验诊断::InfoHash不匹配 {
            票据内info_hash,
            session_id,
            attachment_id,
        } => Err(Tracker代理错误::门禁拒绝 {
            invalid_reason: "ticket_info_hash_mismatch",
            detail: format!(
                "join_ticket_invalid: expected_info_hash={info_hash}, ticket_info_hash={票据内info_hash}, session_id={}, attachment_id={}",
                session_id.as_deref().unwrap_or("unknown"),
                attachment_id.as_deref().unwrap_or("unknown")
            ),
            info_hash: Some(info_hash),
        }),
    }
}

fn 解析tracker首帧门禁字段(
    message: &AxumWsMessage,
) -> Result<(String, Option<String>), String> {
    let raw = match message {
        AxumWsMessage::Text(text) => text.as_str().as_bytes().to_vec(),
        AxumWsMessage::Binary(bytes) => bytes.to_vec(),
        _ => return Err("tracker 首帧必须是 JSON 文本或二进制 JSON".to_string()),
    };
    let value = serde_json::from_slice::<serde_json::Value>(raw.as_slice())
        .map_err(|error| format!("解析 tracker 首帧 JSON 失败: {error}"))?;
    let info_hash = value
        .get("info_hash")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "tracker 首帧缺少 info_hash".to_string())
        .and_then(归一化tracker_info_hash)?;
    let ticket = value
        .get("ticket")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    Ok((info_hash, ticket))
}

fn 归一化tracker_info_hash(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.len() == 40 && value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Ok(value.to_ascii_lowercase());
    }

    let mut bytes = Vec::with_capacity(20);
    for ch in value.chars() {
        let code = ch as u32;
        if code > u8::MAX as u32 {
            return Err("tracker 首帧 info_hash 不是 20 字节或 40 位 hex".to_string());
        }
        bytes.push(code as u8);
    }
    if bytes.len() != 20 {
        return Err("tracker 首帧 info_hash 不是 20 字节或 40 位 hex".to_string());
    }
    Ok(hex::encode(bytes))
}

fn axum_ws_message_to_tungstenite(message: AxumWsMessage) -> Option<tungstenite::Message> {
    match message {
        AxumWsMessage::Text(text) => Some(tungstenite::Message::Text(text.to_string().into())),
        AxumWsMessage::Binary(bytes) => Some(tungstenite::Message::Binary(bytes)),
        AxumWsMessage::Ping(bytes) => Some(tungstenite::Message::Ping(bytes)),
        AxumWsMessage::Pong(bytes) => Some(tungstenite::Message::Pong(bytes)),
        AxumWsMessage::Close(_) => Some(tungstenite::Message::Close(None)),
    }
}

fn tungstenite_message_to_axum_ws(message: tungstenite::Message) -> Option<AxumWsMessage> {
    match message {
        tungstenite::Message::Text(text) => Some(AxumWsMessage::Text(text.to_string().into())),
        tungstenite::Message::Binary(bytes) => Some(AxumWsMessage::Binary(bytes)),
        tungstenite::Message::Ping(bytes) => Some(AxumWsMessage::Ping(bytes)),
        tungstenite::Message::Pong(bytes) => Some(AxumWsMessage::Pong(bytes)),
        tungstenite::Message::Close(_) => Some(AxumWsMessage::Close(None::<AxumCloseFrame>)),
        tungstenite::Message::Frame(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker首帧缺少join_ticket是门禁拒绝而不是代理失败() {
        let message = AxumWsMessage::Text(
            r#"{"action":"announce","info_hash":"0123456789abcdef0123456789abcdef01234567","peer_id":"aaaaaaaaaaaaaaaaaaaa"}"#
                .to_string()
                .into(),
        );

        let error = 校验tracker首帧门禁(&message, Some("tracker-proxy-secret"))
            .expect_err("缺少 join_ticket 的首帧必须被门禁拒绝");

        assert!(
            !error.应该写启动器warn(),
            "旧浏览器或旧 service worker 的无票 announce 只是入场门禁拒绝，不能再冒充 run.ps1 的代理失败 WARN"
        );
        assert!(matches!(
            error,
            Tracker代理错误::门禁拒绝 {
                invalid_reason: "missing_ticket",
                info_hash: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn tracker首帧info_hash畸形是门禁拒绝而不是代理失败() {
        let message = AxumWsMessage::Text(
            r#"{"action":"announce","info_hash":"not-a-valid-info-hash","peer_id":"aaaaaaaaaaaaaaaaaaaa","ticket":"stale-ticket"}"#
                .to_string()
                .into(),
        );

        let error = 校验tracker首帧门禁(&message, Some("tracker-proxy-secret"))
            .expect_err("畸形 info_hash 的首帧必须被门禁拒绝");

        assert!(
            !error.应该写启动器warn(),
            "畸形旧首帧同样属于协议门禁拒绝，不应污染启动器 WARN"
        );
        assert!(matches!(
            error,
            Tracker代理错误::门禁拒绝 {
                invalid_reason: "malformed_first_frame",
                ..
            }
        ));
    }

    #[test]
    fn tracker真实转发失败仍然要写启动器warn() {
        let error = Tracker代理错误::代理转发失败("连接 tracker upstream 失败: refused".to_string());

        assert!(
            error.应该写启动器warn(),
            "真正的 upstream/转发故障仍必须保留 WARN，不能被门禁降噪一起吞掉"
        );
    }
}
