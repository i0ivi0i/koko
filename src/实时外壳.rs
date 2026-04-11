use super::{event_to_json, events_to_json, map_domain_err_tuple, 应用状态, 构建共享仓储};
use crate::{contract, usecase};
use serde::Deserialize;
use socketioxide::{
    extract::SocketRef,
    socket::DisconnectReason,
    BroadcastError, SendError, SocketError,
};
use tokio::task;

/// 连接握手携带的最小认证数据。
#[derive(Deserialize, Clone)]
pub(super) struct RealtimeConnectAuth {
    /// 当前连接声明的会话标识。
    session_id: String,
}

/// 存放在 socket extension 内的已认证会话。
#[derive(Clone)]
pub(super) struct 已认证会话 {
    pub(super) session_id: String,
}

/// Realtime 订阅命令负载。
#[derive(Deserialize, Clone)]
pub(super) struct RealtimeSubscribeBody {
    /// 订阅目标房间。
    pub(super) room_id: String,
    /// 客户端已持有的最新位置，用于增量续接。
    pub(super) from: i64,
}

/// Realtime 统一创建消息命令负载。
#[derive(Deserialize, Clone)]
pub(super) struct RealtimeCreateMessageBody {
    /// 目标房间标识。
    pub(super) room_id: String,
    /// 客户端消息标识（幂等链路锚点）。
    pub(super) client_message_id: String,
    /// 消息文本原文。
    pub(super) text: String,
    /// 当前消息挂载的附件标识列表。
    /// 纯文本消息时这里为空数组。
    pub(super) attachment_ids: Vec<String>,
}

/// Realtime 发送失败分级。
///
/// 这个枚举属于热路径 adapter 自己的运行态判断，不上升为共享业务语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum 实时发送失败级别 {
    正常断开,
    背压,
    序列化,
    适配器,
}

pub(super) fn 分类单连接发送失败(err: &SendError) -> 实时发送失败级别 {
    match err {
        SendError::Socket(SocketError::Closed) => 实时发送失败级别::正常断开,
        SendError::Socket(SocketError::InternalChannelFull) => 实时发送失败级别::背压,
        SendError::Serialize(_) => 实时发送失败级别::序列化,
    }
}

pub(super) fn 分类广播发送失败(err: &BroadcastError) -> 实时发送失败级别 {
    match err {
        BroadcastError::Socket(socket_errors)
            if socket_errors
                .iter()
                .all(|socket_error| matches!(socket_error, SocketError::Closed)) =>
        {
            实时发送失败级别::正常断开
        }
        BroadcastError::Socket(_) => 实时发送失败级别::背压,
        BroadcastError::Serialize(_) => 实时发送失败级别::序列化,
        BroadcastError::Adapter(_) => 实时发送失败级别::适配器,
    }
}

pub(super) fn 分类断开原因(reason: DisconnectReason) -> 实时发送失败级别 {
    match reason {
        DisconnectReason::TransportClose
        | DisconnectReason::ClientNSDisconnect
        | DisconnectReason::ServerNSDisconnect
        | DisconnectReason::ClosingServer => 实时发送失败级别::正常断开,
        DisconnectReason::HeartbeatTimeout
        | DisconnectReason::TransportError
        | DisconnectReason::PacketParsingError
        | DisconnectReason::MultipleHttpPollingError => 实时发送失败级别::适配器,
    }
}

/// 统一记录 realtime 连接断开，给后续排查断线/心跳超时留一条稳定主链。
///
/// 这里故意只记录“连接运行态事实”，不把房间成员资格或在线真相塞进 socket 层。
pub(super) fn 记录realtime断开(socket: SocketRef, reason: DisconnectReason) {
    let session_id = socket
        .extensions
        .get::<已认证会话>()
        .map(|auth| auth.session_id)
        .unwrap_or_else(|| "unknown".to_string());
    match 分类断开原因(reason) {
        实时发送失败级别::正常断开 => tracing::info!(
            usecase = "实时连接断开",
            adapter = "socketioxide",
            outcome = "dropped",
            session_id = session_id,
            disconnect_reason = %reason,
            "realtime 连接已正常断开"
        ),
        实时发送失败级别::适配器 => tracing::warn!(
            usecase = "实时连接断开",
            adapter = "socketioxide",
            outcome = "failed",
            session_id = session_id,
            disconnect_reason = %reason,
            error_code = "socket_disconnect_abnormal",
            "realtime 连接异常断开"
        ),
        实时发送失败级别::背压 | 实时发送失败级别::序列化 => {
            unreachable!("断开原因分类不应落到发送失败语义")
        }
    }
}

/// connect middleware：把会话认证收口到连接握手。
///
/// 这里继续只确认会话存在并写入 socket extension，不裁决房间权限。
pub(super) async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    let session_id = match auth {
        Ok(auth) => auth.session_id,
        Err(_) => {
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                error_code = "invalid_session",
                "realtime 连接认证载荷非法"
            );
            return Err("invalid_session".to_string());
        }
    };
    tracing::info!(
        usecase = "实时连接认证",
        adapter = "socketioxide",
        outcome = "accepted",
        session_id = session_id,
        "realtime 连接认证已受理"
    );
    let state = state.clone();
    let session_id_for_check = session_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::校验实时连接会话(&repo, &session_id_for_check)
    })
    .await;

    match result {
        Ok(Ok(())) => {
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "succeeded",
                session_id = session_id,
                "realtime 连接认证成功"
            );
            socket.extensions.insert(已认证会话 { session_id });
            Ok(())
        }
        Ok(Err(contract::错误码::会话无效)) => {
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                session_id = session_id,
                error_code = "invalid_session",
                "realtime 连接认证被拒绝"
            );
            Err("invalid_session".to_string())
        }
        Ok(Err(_)) => {
            tracing::error!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "failed",
                session_id = session_id,
                error_code = "system_error",
                "realtime 连接认证失败"
            );
            Err("system_error".to_string())
        }
        Err(err) => {
            tracing::error!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "failed",
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "realtime 连接认证任务执行失败"
            );
            Err("system_error".to_string())
        }
    }
}

/// Realtime 控制面：订阅房间事件流。
///
/// 语义分离约束：
/// 1. `control_result` 仅承载订阅结果/错误，不代表领域事实。
/// 2. `room_events` 仅承载已成立领域事件。
pub(super) async fn handle_realtime_subscribe(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSubscribeBody,
    state: 应用状态,
) {
    tracing::info!(
        usecase = "订阅房间事件流",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        from = payload.from,
        "realtime 订阅请求已受理"
    );
    let room_id = payload.room_id.clone();
    let from = payload.from;
    let session_id = auth.session_id.clone();
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间增量事件(&repo, &room_id, &session_id, from)
            .map_err(map_domain_err_tuple)
    })
    .await;

    match result {
        Ok(Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        })) => {
            if from > 最新事件位置 {
                tracing::info!(
                    usecase = "订阅房间事件流",
                    adapter = "socketioxide",
                    outcome = "recovered",
                    room_id = 房间标识,
                    session_id = auth.session_id,
                    expected_position = from,
                    latest_event_position = 最新事件位置,
                    "订阅锚点超前，要求客户端回退到 HTTP 快照"
                );
                let control = serde_json::json!({
                    "kind": "need_snapshot_reload",
                    "room_id": 房间标识,
                    "expected_position": from,
                });
                if let Err(err) = socket.emit("control_result", &control) {
                    tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "emit_failed",
                        error = %err,
                        "订阅恢复控制消息发送失败"
                    );
                }
                return;
            }
            socket.join(房间标识.clone());
            let control = serde_json::json!({
                "kind": "subscribed",
                "room_id": 房间标识,
                "from": from,
                "latest_event_position": 最新事件位置
            });
            let events_json = serde_json::json!({
                "room_id": 房间标识,
                "latest_event_position": 最新事件位置,
                "events": events_to_json(事件)
            });
            if let Err(err) = socket.emit("control_result", &control) {
                match 分类单连接发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_closed",
                        error = %err,
                        "订阅控制消息在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_backpressure",
                        error = %err,
                        "订阅控制消息发送失败：socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "serialize_failed",
                        error = %err,
                        "订阅控制消息序列化失败"
                    ),
                    实时发送失败级别::适配器 => unreachable!("单连接发送不应出现 adapter 级错误"),
                }
                return;
            }
            if let Err(err) = socket.emit("room_events", &events_json) {
                match 分类单连接发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_closed",
                        error = %err,
                        "订阅增量事件在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_backpressure",
                        error = %err,
                        "订阅增量事件发送失败：socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "serialize_failed",
                        error = %err,
                        "订阅增量事件序列化失败"
                    ),
                    实时发送失败级别::适配器 => unreachable!("单连接发送不应出现 adapter 级错误"),
                }
                return;
            }
            tracing::info!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "succeeded",
                room_id = 房间标识,
                session_id = auth.session_id,
                from = from,
                event_position = 最新事件位置,
                "订阅房间事件流成功"
            );
        }
        Ok(Ok(_)) => {
            tracing::error!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = "system_error",
                "订阅返回了错误的快照类型"
            );
            let payload =
                serde_json::json!({"kind":"error","code":"system_error","message":"快照类型不匹配"});
            let _ = socket.emit("control_result", &payload);
        }
        Ok(Err((_, code, message))) => {
            tracing::info!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = code,
                "订阅房间事件流被拒绝"
            );
            let payload = serde_json::json!({"kind":"rejected","code":code,"message":message});
            let _ = socket.emit("control_result", &payload);
        }
        Err(err) => {
            tracing::error!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = "system_error",
                error = %err,
                "订阅房间事件流任务执行失败"
            );
            let payload = serde_json::json!({
                "kind":"error",
                "code":"system_error",
                "message": format!("任务执行失败: {err}")
            });
            let _ = socket.emit("control_result", &payload);
        }
    }
}

/// Realtime 业务命令：创建统一消息。
///
/// 语义分离约束：
/// 1. `room_event` 仅在“消息已成立”后发出。
/// 2. 命令拒绝和系统错误走 `control_result`。
pub(super) async fn handle_realtime_create_message(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeCreateMessageBody,
    state: 应用状态,
) {
    tracing::info!(
        usecase = "创建消息",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        client_message_id = payload.client_message_id.as_str(),
        "realtime 创建消息请求已受理"
    );
    let state = state.clone();
    let session_id = auth.session_id.clone();
    let room_id_for_log = payload.room_id.clone();
    let client_message_id_for_log = payload.client_message_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::创建消息(
            &mut repo,
            &payload.room_id,
            &session_id,
            &payload.client_message_id,
            &payload.text,
            &payload.attachment_ids,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;

    match result {
        Ok(Ok(event)) => {
            let (room_id, client_message_id, event_position) = match &event {
                contract::领域事件::消息已创建 {
                    房间标识,
                    客户端消息标识,
                    事件位置,
                    ..
                } => (房间标识.clone(), 客户端消息标识.clone(), *事件位置),
            };
            let payload = event_to_json(event);
            if let Err(err) = socket.within(room_id.clone()).emit("room_event", &payload).await {
                match 分类广播发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "创建消息",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "socket_closed",
                        error = %err,
                        "房间权威事件在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "创建消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "socket_backpressure",
                        error = %err,
                        "房间权威事件广播失败：存在 socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "创建消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "serialize_failed",
                        error = %err,
                        "房间权威事件广播失败：事件序列化失败"
                    ),
                    实时发送失败级别::适配器 => tracing::error!(
                        usecase = "创建消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "adapter_failed",
                        error = %err,
                        "房间权威事件广播失败：adapter 层出错"
                    ),
                }
            } else {
                tracing::info!(
                    usecase = "创建消息",
                    adapter = "socketioxide",
                    outcome = "succeeded",
                    room_id = room_id,
                    session_id = auth.session_id,
                    client_message_id = client_message_id,
                    event_position = event_position,
                    "创建消息成功"
                );
            }
        }
        Ok(Err((_, code, message))) => {
            tracing::info!(
                usecase = "创建消息",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = code,
                "创建消息被拒绝"
            );
            let payload = serde_json::json!({"kind":"rejected","code":code,"message":message});
            let _ = socket.emit("control_result", &payload);
        }
        Err(err) => {
            tracing::error!(
                usecase = "创建消息",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = "system_error",
                error = %err,
                "创建消息任务执行失败"
            );
            let payload = serde_json::json!({
                "kind":"error",
                "code":"system_error",
                "message": format!("任务执行失败: {err}")
            });
            let _ = socket.emit("control_result", &payload);
        }
    }
}

#[cfg(test)]
mod 实时外壳测试 {
    use super::{分类单连接发送失败, 分类广播发送失败, 分类断开原因, 实时发送失败级别};
    use crate::contract;
    use socketioxide::{socket::DisconnectReason, BroadcastError, SendError, SocketError};

    #[test]
    fn create_message负载允许文本和附件列表并存() {
        let payload: super::RealtimeCreateMessageBody = serde_json::from_value(serde_json::json!({
            "room_id": "room-1",
            "client_message_id": "client-1",
            "text": "hello",
            "attachment_ids": ["att-1", "att-2"]
        }))
        .expect("应能解析统一 create_message 负载");

        assert_eq!(payload.room_id, "room-1");
        assert_eq!(payload.client_message_id, "client-1");
        assert_eq!(payload.text, "hello");
        assert_eq!(payload.attachment_ids, vec!["att-1", "att-2"]);
    }

    #[test]
    fn 单连接发送到已关闭socket时降级为正常断开() {
        let level = 分类单连接发送失败(&SendError::Socket(SocketError::Closed));
        assert_eq!(level, 实时发送失败级别::正常断开);
    }

    #[test]
    fn 广播里只要出现内部通道已满就归类为背压() {
        let level = 分类广播发送失败(&BroadcastError::Socket(vec![
            SocketError::Closed,
            SocketError::InternalChannelFull,
        ]));
        assert_eq!(level, 实时发送失败级别::背压);
    }

    #[test]
    fn 主动断开和客户端正常关闭都归类为正常断开() {
        assert_eq!(
            分类断开原因(DisconnectReason::TransportClose),
            实时发送失败级别::正常断开
        );
        assert_eq!(
            分类断开原因(DisconnectReason::ClientNSDisconnect),
            实时发送失败级别::正常断开
        );
        assert_eq!(
            分类断开原因(DisconnectReason::ServerNSDisconnect),
            实时发送失败级别::正常断开
        );
    }

    #[test]
    fn 心跳超时和传输错误会归类为失败() {
        assert_eq!(
            分类断开原因(DisconnectReason::HeartbeatTimeout),
            实时发送失败级别::适配器
        );
        assert_eq!(
            分类断开原因(DisconnectReason::TransportError),
            实时发送失败级别::适配器
        );
    }

    #[test]
    fn 发送成功时仍然通过room_event表达权威事实而不是control_result成功() {
        // 这条测试锁住“消息成立真相”的承载通道。
        // 发送成功必须表现为领域事件 payload，而不是再长出一个 control_result 成功分支。
        let payload = super::event_to_json(contract::领域事件::消息已创建 {
            房间标识: "room-1".to_string(),
            消息标识: "msg-1".to_string(),
            客户端消息标识: "client-1".to_string(),
            发送者会话标识: "session-1".to_string(),
            发送者花名: "花名-1".to_string(),
            文本: "hello".to_string(),
            附件: Vec::new(),
            事件位置: 1,
        });

        assert_eq!(payload["type"], "message_created");
        assert_eq!(payload["room_id"], "room-1");
        assert!(payload.get("kind").is_none(), "权威消息事件不应冒充 control_result");
    }
}
