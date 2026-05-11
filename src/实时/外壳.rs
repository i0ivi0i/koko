use crate::message::application as 消息应用;
use crate::realtime::application as 实时应用;
use crate::shared::contract;
use crate::shell::{
    协议响应::{event_to_json, events_to_json, map_domain_err_tuple},
    应用状态, 构建共享仓储,
};
use serde::Deserialize;
use socketioxide::{
    extract::SocketRef, socket::DisconnectReason, BroadcastError, SendError, SocketError,
};

/// 连接握手携带的最小认证数据。
#[derive(Deserialize, Clone)]
pub(crate) struct RealtimeConnectAuth {
    /// 当前连接声明的会话标识。
    session_id: String,
    /// PoW 门禁令牌（由 /api/pow/verify 签发）。
    /// 防御禁用时为 None，允许无 token 连接。
    pow_token: Option<String>,
}

/// 存放在 socket extension 内的已认证会话。
#[derive(Clone)]
pub(crate) struct 已认证会话 {
    pub(crate) session_id: String,
}

/// 每连接令牌桶容量：允许短时间连发的消息上限。
const 令牌桶容量: f64 = 10.0;
/// 令牌补充速率：每秒恢复的令牌数。
const 令牌补充速率: f64 = 5.0;

/// 每连接消息发送令牌桶，存放在 socket extension 中。
/// 纯运行态值对象，不依赖外部计时器：每次 `try_consume` 时按实际流逝时间补充令牌。
/// 线程安全由外层 `std::sync::Mutex` 保证（socketioxide 的 handler 可能跨线程调度）。
pub(crate) struct 连接消息令牌桶 {
    /// 当前可用令牌数。
    tokens: f64,
    /// 上次补充时间戳。
    last_refill: std::time::Instant,
}

impl 连接消息令牌桶 {
    /// 生产环境入口：以当前时刻为起点，满桶开始。
    pub fn new() -> Self {
        Self {
            tokens: 令牌桶容量,
            last_refill: std::time::Instant::now(),
        }
    }

    /// 测试专用入口：允许注入确定性时间戳，避免测试依赖 wall-clock。
    #[cfg(test)]
    pub fn new_with_instant(now: std::time::Instant) -> Self {
        Self {
            tokens: 令牌桶容量,
            last_refill: now,
        }
    }

    /// 尝试消费一个令牌（生产环境用）。
    pub fn try_consume(&mut self) -> bool {
        self.try_consume_at(std::time::Instant::now())
    }

    /// 在指定时刻尝试消费一个令牌。
    /// 先按流逝时间补充令牌（封顶为桶容量），再判断是否可扣减。
    pub fn try_consume_at(&mut self, now: std::time::Instant) -> bool {
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * 令牌补充速率).min(令牌桶容量);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Realtime 订阅命令负载。
#[derive(Deserialize, Clone)]
pub(crate) struct RealtimeSubscribeBody {
    /// 订阅目标房间。
    pub(crate) room_id: String,
    /// 客户端已持有的最新位置，用于增量续接。
    pub(crate) from: i64,
}

/// Realtime 取消订阅命令负载。
#[derive(Deserialize, Clone)]
pub(crate) struct RealtimeUnsubscribeBody {
    /// 要离开的房间标识。
    pub(crate) room_id: String,
}

/// Realtime 统一创建消息命令负载。
#[derive(Deserialize, Clone)]
pub(crate) struct RealtimeCreateMessageBody {
    /// 目标房间标识。
    pub(crate) room_id: String,
    /// 客户端消息标识（幂等链路锚点）。
    pub(crate) client_message_id: String,
    /// 消息文本原文。
    pub(crate) text: String,
    /// 当前消息挂载的附件标识列表。
    /// 纯文本消息时这里为空数组。
    pub(crate) attachment_ids: Vec<String>,
}

/// Realtime 发送失败分级。
///
/// 这个枚举属于热路径 adapter 自己的运行态判断，不上升为共享业务语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum 实时发送失败级别 {
    正常断开,
    背压,
    序列化,
    适配器,
}

/// RoomRuntime 广播批次的内部运行观测。
///
/// 这里故意只记录“广播这一批发生了什么”，不把它升级成消息是否成立、
/// 成员是否在线这类业务真相；消息成立真相只来自用例返回的领域事件。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct 房间广播运行观测 {
    broadcast_attempts: u64,
    broadcast_delivered: u64,
    broadcast_channel_full: u64,
    broadcast_closed_socket: u64,
    broadcast_serialize_errors: u64,
    broadcast_adapter_errors: u64,
    room_runtime_continues: bool,
}

fn 归纳房间广播运行观测(result: Result<(), &BroadcastError>) -> 房间广播运行观测 {
    let mut observation = 房间广播运行观测 {
        broadcast_attempts: 1,
        room_runtime_continues: true,
        ..房间广播运行观测::default()
    };

    match result {
        Ok(()) => {
            observation.broadcast_delivered = 1;
        }
        Err(BroadcastError::Socket(socket_errors)) => {
            for socket_error in socket_errors {
                match socket_error {
                    SocketError::Closed => observation.broadcast_closed_socket += 1,
                    SocketError::InternalChannelFull => observation.broadcast_channel_full += 1,
                }
            }
        }
        Err(BroadcastError::Serialize(_)) => {
            observation.broadcast_serialize_errors = 1;
        }
        Err(BroadcastError::Adapter(_)) => {
            observation.broadcast_adapter_errors = 1;
        }
    }

    observation
}

pub(crate) fn 分类单连接发送失败(err: &SendError) -> 实时发送失败级别 {
    match err {
        SendError::Socket(SocketError::Closed) => 实时发送失败级别::正常断开,
        SendError::Socket(SocketError::InternalChannelFull) => 实时发送失败级别::背压,
        SendError::Serialize(_) => 实时发送失败级别::序列化,
    }
}

pub(crate) fn 分类广播发送失败(err: &BroadcastError) -> 实时发送失败级别 {
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

pub(crate) fn 分类断开原因(reason: DisconnectReason) -> 实时发送失败级别 {
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

/// 订阅控制面 payload 仍由 realtime adapter 自己翻译。
/// 这样 handler 只负责拿权威结果，不再在分支里散落 JSON 细节。
fn 构造需要重拉快照控制面(
    房间标识: &str, expected_position: i64
) -> serde_json::Value {
    serde_json::json!({
        "kind": "need_snapshot_reload",
        "room_id": 房间标识,
        "expected_position": expected_position,
    })
}

fn 构造订阅已建立控制面(
    房间标识: &str,
    from: i64,
    最新事件位置: i64,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "subscribed",
        "room_id": 房间标识,
        "from": from,
        "latest_event_position": 最新事件位置,
    })
}

fn 构造拒绝控制面(code: &str, message: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "rejected",
        "code": code,
        "message": message,
    })
}

fn 构造系统错误控制面(message: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "error",
        "code": "system_error",
        "message": message,
    })
}

fn 构造房间增量事件载荷(
    房间标识: &str,
    最新事件位置: i64,
    事件: Vec<serde_json::Value>,
) -> serde_json::Value {
    serde_json::json!({
        "room_id": 房间标识,
        "latest_event_position": 最新事件位置,
        "events": 事件,
    })
}

/// 订阅链路的单连接回包必须统一按同一套失败分级记录。
/// 否则某些 `control_result` 分支会静默吞错，后续排查会失真。
fn 记录订阅单连接发送失败(
    room_id: &str,
    session_id: &str,
    from: i64,
    phase: &str,
    err: &SendError,
) {
    match 分类单连接发送失败(err) {
        实时发送失败级别::正常断开 => tracing::info!(
            application = "订阅房间事件流",
            adapter = "socketioxide",
            outcome = "dropped",
            room_id = room_id,
            session_id = session_id,
            from = from,
            phase = phase,
            error_code = "socket_closed",
            error = %err,
            "订阅单连接消息在连接关闭后被丢弃"
        ),
        实时发送失败级别::背压 => tracing::error!(
            application = "订阅房间事件流",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            from = from,
            phase = phase,
            error_code = "socket_backpressure",
            error = %err,
            "订阅单连接消息发送失败：socket 内部通道已满"
        ),
        实时发送失败级别::序列化 => tracing::error!(
            application = "订阅房间事件流",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            from = from,
            phase = phase,
            error_code = "serialize_failed",
            error = %err,
            "订阅单连接消息序列化失败"
        ),
        实时发送失败级别::适配器 => {
            unreachable!("单连接发送不应出现 adapter 级错误")
        }
    }
}

/// 创建消息的广播失败必须继续只记录 adapter 运行态事实，不能倒灌业务语义。
fn 记录创建消息广播失败(
    room_id: &str,
    session_id: &str,
    client_message_id: &str,
    err: &BroadcastError,
    observation: 房间广播运行观测,
) {
    match 分类广播发送失败(err) {
        实时发送失败级别::正常断开 => tracing::info!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "dropped",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            error_code = "socket_closed",
            broadcast_attempts = observation.broadcast_attempts,
            broadcast_closed_socket = observation.broadcast_closed_socket,
            room_runtime_continues = observation.room_runtime_continues,
            error = %err,
            "房间权威事件在连接关闭后被丢弃"
        ),
        实时发送失败级别::背压 => tracing::error!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            error_code = "socket_backpressure",
            broadcast_attempts = observation.broadcast_attempts,
            broadcast_channel_full = observation.broadcast_channel_full,
            broadcast_closed_socket = observation.broadcast_closed_socket,
            room_runtime_continues = observation.room_runtime_continues,
            error = %err,
            "房间权威事件广播失败：存在 socket 内部通道已满"
        ),
        实时发送失败级别::序列化 => tracing::error!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            error_code = "serialize_failed",
            broadcast_attempts = observation.broadcast_attempts,
            broadcast_serialize_errors = observation.broadcast_serialize_errors,
            room_runtime_continues = observation.room_runtime_continues,
            error = %err,
            "房间权威事件广播失败：事件序列化失败"
        ),
        实时发送失败级别::适配器 => tracing::error!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            error_code = "adapter_failed",
            broadcast_attempts = observation.broadcast_attempts,
            broadcast_adapter_errors = observation.broadcast_adapter_errors,
            room_runtime_continues = observation.room_runtime_continues,
            error = %err,
            "房间权威事件广播失败：adapter 层出错"
        ),
    }
}

fn 记录创建消息单连接发送失败(
    room_id: &str,
    session_id: &str,
    client_message_id: &str,
    phase: &str,
    err: &SendError,
) {
    match 分类单连接发送失败(err) {
        实时发送失败级别::正常断开 => tracing::info!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "dropped",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            phase = phase,
            error_code = "socket_closed",
            error = %err,
            "创建消息控制面在连接关闭后被丢弃"
        ),
        实时发送失败级别::背压 => tracing::error!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            phase = phase,
            error_code = "socket_backpressure",
            error = %err,
            "创建消息控制面发送失败：socket 内部通道已满"
        ),
        实时发送失败级别::序列化 => tracing::error!(
            application = "创建消息",
            adapter = "socketioxide",
            outcome = "failed",
            room_id = room_id,
            session_id = session_id,
            client_message_id = client_message_id,
            phase = phase,
            error_code = "serialize_failed",
            error = %err,
            "创建消息控制面序列化失败"
        ),
        实时发送失败级别::适配器 => {
            unreachable!("单连接发送不应出现 adapter 级错误")
        }
    }
}

/// 统一记录 realtime 连接断开，给后续排查断线/心跳超时留一条稳定主链。
///
/// 这里故意只记录“连接运行态事实”，不把房间成员资格或在线真相塞进 socket 层。
pub(crate) fn 记录realtime断开(socket: SocketRef, reason: DisconnectReason) {
    let session_id = socket
        .extensions
        .get::<已认证会话>()
        .map(|auth| auth.session_id)
        .unwrap_or_else(|| "unknown".to_string());
    match 分类断开原因(reason) {
        实时发送失败级别::正常断开 => tracing::info!(
            application = "实时连接断开",
            adapter = "socketioxide",
            outcome = "dropped",
            session_id = session_id,
            disconnect_reason = %reason,
            "realtime 连接已正常断开"
        ),
        实时发送失败级别::适配器 => tracing::warn!(
            application = "实时连接断开",
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

/// connect middleware：把会话认证 + PoW 门禁收口到连接握手。
///
/// 验证顺序：PoW token（微秒级 HMAC）→ IP 连接计数 → 会话 DB 校验。
/// 攻击流量在前两层就被拦截，永远不会撞到 DB。
pub(crate) async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    let auth = match auth {
        Ok(auth) => auth,
        Err(_) => {
            tracing::info!(
                application = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                error_code = "invalid_session",
                "realtime 连接认证载荷非法"
            );
            return Err("invalid_session".to_string());
        }
    };
    let session_id = auth.session_id;

    // ─── 第一层：PoW 门禁（微秒级 HMAC 验签，零 DB 开销）───
    if let Some(ref defense) = state.defense {
        match auth.pow_token.as_deref() {
            Some(token) if defense.engine.验证token(token) => {
                // token 合法，放行
            }
            Some(_) => {
                tracing::info!(
                    application = "实时连接认证",
                    adapter = "pow",
                    outcome = "rejected",
                    session_id = session_id,
                    error_code = "pow_invalid",
                    "PoW token 无效或已过期"
                );
                return Err("pow_invalid".to_string());
            }
            None => {
                tracing::info!(
                    application = "实时连接认证",
                    adapter = "pow",
                    outcome = "rejected",
                    session_id = session_id,
                    error_code = "pow_required",
                    "PoW token 缺失"
                );
                return Err("pow_required".to_string());
            }
        }
    }

    tracing::info!(
        application = "实时连接认证",
        adapter = "socketioxide",
        outcome = "accepted",
        session_id = session_id,
        "realtime 连接认证已受理"
    );
    let repo = 构建共享仓储(&state);
    let realtime_repo = repo.实时仓储();
    match 实时应用::校验实时连接会话_异步(&realtime_repo, &session_id).await {
        Ok(()) => {
            tracing::info!(
                application = "实时连接认证",
                adapter = "socketioxide",
                outcome = "succeeded",
                session_id = session_id,
                "realtime 连接认证成功"
            );
            socket.extensions.insert(已认证会话 { session_id });
            Ok(())
        }
        Err(contract::错误码::会话无效) => {
            tracing::info!(
                application = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                session_id = session_id,
                error_code = "invalid_session",
                "realtime 连接认证被拒绝"
            );
            Err("invalid_session".to_string())
        }
        Err(_) => {
            tracing::error!(
                application = "实时连接认证",
                adapter = "socketioxide",
                outcome = "failed",
                session_id = session_id,
                error_code = "system_error",
                "realtime 连接认证失败"
            );
            Err("system_error".to_string())
        }
    }
}

/// Realtime 控制面：取消订阅房间事件流。
///
/// 纯适配层操作，零 DB 开销。对应 socket.io 官方模式：
/// `s.on("leave_room", |s, Data(room)| { s.leave(room); })`
pub(crate) fn handle_realtime_unsubscribe(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeUnsubscribeBody,
) {
    let room_id = payload.room_id;
    socket.leave(room_id.clone());
    tracing::info!(
        application = "取消订阅房间事件流",
        adapter = "socketioxide",
        outcome = "succeeded",
        room_id = room_id,
        session_id = auth.session_id,
        "socket 已离开房间"
    );
}

/// Realtime 控制面：订阅房间事件流。
///
/// 语义分离约束：
/// 1. `control_result` 仅承载订阅结果/错误，不代表领域事实。
/// 2. `room_events` 仅承载已成立领域事件。
pub(crate) async fn handle_realtime_subscribe(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSubscribeBody,
    state: 应用状态,
) {
    tracing::info!(
        application = "订阅房间事件流",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        from = payload.from,
        "realtime 订阅请求已受理"
    );
    let room_id = payload.room_id.clone();
    // ── 兜底：join 新房间前先 leave 所有旧业务房间，防客户端未发 unsubscribe ──
    // socket.rooms() 返回 Vec<Room>（含 socket 自身 ID room），只 leave 非自身且非目标的房间。
    let self_room = socket.id.to_string();
    for old_room in socket.rooms() {
        if *old_room != *self_room && *old_room != *room_id {
            tracing::info!(
                application = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "auto_leave",
                old_room_id = %old_room,
                new_room_id = room_id,
                session_id = auth.session_id.as_str(),
                "兜底：加入新房间前自动离开旧房间"
            );
            socket.leave(old_room);
        }
    }
    let from = payload.from;
    let session_id = auth.session_id.clone();
    let repo = 构建共享仓储(&state);
    let realtime_repo = repo.实时仓储();
    match 实时应用::加载房间增量事件_异步(&realtime_repo, &room_id, &session_id, from)
        .await
        .map_err(map_domain_err_tuple)
    {
        Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        }) => {
            if from > 最新事件位置 {
                tracing::info!(
                    application = "订阅房间事件流",
                    adapter = "socketioxide",
                    outcome = "recovered",
                    room_id = 房间标识,
                    session_id = auth.session_id,
                    expected_position = from,
                    latest_event_position = 最新事件位置,
                    "订阅锚点超前，要求客户端回退到 HTTP 快照"
                );
                let control = 构造需要重拉快照控制面(&房间标识, from);
                if let Err(err) = socket.emit("control_result", &control) {
                    记录订阅单连接发送失败(
                        payload.room_id.as_str(),
                        auth.session_id.as_str(),
                        from,
                        "订阅恢复控制消息",
                        &err,
                    );
                }
                return;
            }
            socket.join(房间标识.clone());
            let control = 构造订阅已建立控制面(&房间标识, from, 最新事件位置);
            let events_json = 构造房间增量事件载荷(
                &房间标识,
                最新事件位置,
                events_to_json(事件, Some(auth.session_id.as_str()), None),
            );
            if let Err(err) = socket.emit("control_result", &control) {
                记录订阅单连接发送失败(
                    payload.room_id.as_str(),
                    auth.session_id.as_str(),
                    from,
                    "订阅控制消息",
                    &err,
                );
                return;
            }
            if let Err(err) = socket.emit("room_events", &events_json) {
                记录订阅单连接发送失败(
                    payload.room_id.as_str(),
                    auth.session_id.as_str(),
                    from,
                    "订阅增量事件",
                    &err,
                );
                return;
            }
            tracing::info!(
                application = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "succeeded",
                room_id = 房间标识,
                session_id = auth.session_id,
                from = from,
                event_position = 最新事件位置,
                "订阅房间事件流成功"
            );
        }
        Ok(_) => {
            tracing::error!(
                application = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = "system_error",
                "订阅返回了错误的快照类型"
            );
            let control_payload = 构造系统错误控制面("快照类型不匹配");
            if let Err(err) = socket.emit("control_result", &control_payload) {
                记录订阅单连接发送失败(
                    payload.room_id.as_str(),
                    auth.session_id.as_str(),
                    from,
                    "订阅异常控制消息",
                    &err,
                );
            }
        }
        Err((_, code, message)) => {
            tracing::info!(
                application = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = code,
                "订阅房间事件流被拒绝"
            );
            let control_payload = 构造拒绝控制面(code, message.as_str());
            if let Err(err) = socket.emit("control_result", &control_payload) {
                记录订阅单连接发送失败(
                    payload.room_id.as_str(),
                    auth.session_id.as_str(),
                    from,
                    "订阅拒绝控制消息",
                    &err,
                );
            }
        }
    }
}

/// Realtime 业务命令：创建统一消息。
///
/// 语义分离约束：
/// 1. `room_event` 仅在“消息已成立”后发出。
/// 2. 命令拒绝和系统错误走 `control_result`。
pub(crate) async fn handle_realtime_create_message(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeCreateMessageBody,
    state: 应用状态,
) {
    // ── 限流门禁：在任何 DB 查询之前拦截超限请求，保护连接池 ──
    {
        let bucket = socket
            .extensions
            .get::<std::sync::Arc<std::sync::Mutex<连接消息令牌桶>>>()
            .expect("令牌桶应在连接建立时注入");
        // Mutex::lock 只在持有者 panic 时中毒，此处用 into_inner 恢复而非传播 panic。
        let mut guard = bucket.lock().unwrap_or_else(|e| e.into_inner());
        if !guard.try_consume() {
            tracing::info!(
                application = "创建消息",
                adapter = "socketioxide",
                outcome = "rate_limited",
                session_id = auth.session_id.as_str(),
                "消息发送被限流"
            );
            let payload = 构造拒绝控制面("rate_limited", "消息发送过于频繁");
            let _ = socket.emit("control_result", &payload);
            return;
        }
    }

    tracing::info!(
        application = "创建消息",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        client_message_id = payload.client_message_id.as_str(),
        "realtime 创建消息请求已受理"
    );
    let session_id = auth.session_id.clone();
    let room_id_for_log = payload.room_id.clone();
    let client_message_id_for_log = payload.client_message_id.clone();
    let repo = 构建共享仓储(&state);
    let mut realtime_repo = repo.实时仓储();
    match 消息应用::创建消息_异步(
        &mut realtime_repo,
        &payload.room_id,
        &session_id,
        &payload.client_message_id,
        &payload.text,
        &payload.attachment_ids,
    )
    .await
    .map_err(map_domain_err_tuple)
    {
        Ok(event) => {
            let (room_id, message_id, client_message_id, event_position, 含分发线索附件) =
                match &event {
                    contract::领域事件::消息已创建 {
                        房间标识,
                        消息标识,
                        客户端消息标识,
                        事件位置,
                        附件,
                        ..
                    } => {
                        let hints: Vec<(String, String)> = 附件
                            .iter()
                            .filter_map(|a| {
                                let (id, hint) = match a {
                                    contract::附件快照::图片(img) => {
                                        (&img.附件标识, img.分发线索.as_ref())
                                    }
                                    contract::附件快照::视频(vid) => {
                                        (&vid.附件标识, vid.分发线索.as_ref())
                                    }
                                };
                                hint.map(|h| (id.clone(), h.torrent_info_hash.clone()))
                            })
                            .collect();
                        (
                            房间标识.clone(),
                            消息标识.clone(),
                            客户端消息标识.clone(),
                            *事件位置,
                            hints,
                        )
                    }
                };
            // 广播路径当前没有逐连接会话上下文，不能安全地把受控 preview URL 广播成同一份。
            // 这里显式传 `None`，保持 preview 真相仍由同一个投影函数 owner 控制。
            let payload = event_to_json(event, None, None);
            let broadcast_result = socket
                .within(room_id.clone())
                .emit("room_event", &payload)
                .await;
            let broadcast_observation = match &broadcast_result {
                Ok(()) => 归纳房间广播运行观测(Ok(())),
                Err(err) => 归纳房间广播运行观测(Err(err)),
            };
            if let Err(err) = broadcast_result {
                记录创建消息广播失败(
                    room_id.as_str(),
                    auth.session_id.as_str(),
                    client_message_id.as_str(),
                    &err,
                    broadcast_observation,
                );
            } else {
                tracing::info!(
                    application = "创建消息",
                    adapter = "socketioxide",
                    outcome = "succeeded",
                    room_id = room_id,
                    session_id = auth.session_id,
                    client_message_id = client_message_id,
                    event_position = event_position,
                    broadcast_attempts = broadcast_observation.broadcast_attempts,
                    broadcast_delivered = broadcast_observation.broadcast_delivered,
                    room_runtime_continues = broadcast_observation.room_runtime_continues,
                    "创建消息成功"
                );
                // 广播成功后幂等确认强种子：消除"接收者先到 swarm、强种子还没注册"的竞态窗口。
                // 这不是第二条做种主链，而是对 complete 阶段 fire-and-forget 的同链路兜底。
                if !含分发线索附件.is_empty() {
                    let spawn_state = state.clone();
                    let spawn_room_id = room_id.clone();
                    let spawn_message_id = message_id.clone();
                    tokio::spawn(async move {
                        确认消息附件强种子(
                            &spawn_state,
                            &spawn_room_id,
                            &spawn_message_id,
                            含分发线索附件,
                        )
                        .await;
                    });
                }
            }
        }
        Err((_, code, message)) => {
            tracing::info!(
                application = "创建消息",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = code,
                "创建消息被拒绝"
            );
            let payload = 构造拒绝控制面(code, message.as_str());
            if let Err(err) = socket.emit("control_result", &payload) {
                记录创建消息单连接发送失败(
                    room_id_for_log.as_str(),
                    auth.session_id.as_str(),
                    client_message_id_for_log.as_str(),
                    "创建消息拒绝控制消息",
                    &err,
                );
            }
        }
    }
}

/// 广播成功后幂等确认强种子：逐附件查询分发元数据 → 构造做种命令 → 调用 sidecar start。
/// 这是对 complete_media_upload 阶段 fire-and-forget 的同链路兜底，
/// 消除"接收者先到 swarm、强种子还没注册"的竞态窗口。
/// 失败只记结构化 warn，不影响消息投递。
async fn 确认消息附件强种子(
    state: &应用状态,
    room_id: &str,
    message_id: &str,
    含分发线索附件: Vec<(String, String)>, // (attachment_id, torrent_info_hash)
) {
    use crate::media::application::媒体仓储端口 as _;
    use crate::media_distribution;

    for (attachment_id, torrent_info_hash) in &含分发线索附件 {
        let state_for_query = state.clone();
        let aid = attachment_id.clone();
        let distribution_snapshot = match tokio::task::spawn_blocking(move || {
            let repo = 构建共享仓储(&state_for_query);
            let media_repo = repo.媒体仓储();
            media_repo.查询协作分发元数据(&aid)
        })
        .await
        {
            Ok(Ok(Some(snapshot))) => snapshot,
            other => {
                tracing::warn!(
                    application = "创建消息",
                    adapter = "强种子确认",
                    outcome = "skipped",
                    room_id = room_id,
                    message_id = message_id,
                    attachment_id = attachment_id.as_str(),
                    torrent_info_hash = torrent_info_hash.as_str(),
                    seed_confirm_stage = "query_distribution",
                    error = ?other.err().map(|e| e.to_string()),
                    "广播后强种子确认跳过：查不到分发元数据"
                );
                continue;
            }
        };
        let now_epoch秒 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        let runtime_distribution = media_distribution::协作分发快照转响应值(
            &distribution_snapshot,
            media_distribution::协作分发响应上下文 {
                attachment_id: attachment_id.as_str(),
                session_id: "__backend_strong_seed__",
                tracker_public_url: state.swarm_tracker_public_url.as_str(),
                web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                ticket_secret: state.swarm_ticket_secret.as_deref(),
                ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                冷源仍可用: now_epoch秒 <= distribution_snapshot.web_seed_until秒,
                附件已删除: false,
                now_epoch秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
                ice_servers: state.get_turn_ice_servers().await,
            },
        );
        let Some(启动命令) = crate::shell::协作分发做种::从协作分发响应构造做种启动命令(
            &runtime_distribution,
            state.swarm_seeder_tracker_url.as_str(),
        ) else {
            continue;
        };
        if let Err(err) = crate::shell::协作分发做种::尝试启动协作分发做种(state, &启动命令).await {
            tracing::warn!(
                application = "创建消息",
                adapter = "强种子确认",
                outcome = "failed",
                room_id = room_id,
                message_id = message_id,
                attachment_id = attachment_id.as_str(),
                torrent_info_hash = torrent_info_hash.as_str(),
                seed_confirm_stage = "seed_start",
                error = %err,
                "广播后强种子确认失败，等待后台对账重试"
            );
        }
    }
}

#[cfg(test)]
mod 实时外壳测试 {
    use super::{
        分类单连接发送失败, 分类广播发送失败, 分类断开原因, 实时发送失败级别, 归纳房间广播运行观测,
    };
    use crate::shared::contract;
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
    fn 房间广播成功会记录一次批次送达() {
        let observation = 归纳房间广播运行观测(Ok(()));

        assert_eq!(observation.broadcast_attempts, 1);
        assert_eq!(observation.broadcast_delivered, 1);
        assert_eq!(observation.broadcast_channel_full, 0);
        assert!(observation.room_runtime_continues);
    }

    #[test]
    fn 房间广播遇到慢连接和关闭连接只记录运行态并继续房间() {
        let error =
            BroadcastError::Socket(vec![SocketError::Closed, SocketError::InternalChannelFull]);

        let observation = 归纳房间广播运行观测(Err(&error));

        assert_eq!(observation.broadcast_attempts, 1);
        assert_eq!(observation.broadcast_delivered, 0);
        assert_eq!(observation.broadcast_closed_socket, 1);
        assert_eq!(observation.broadcast_channel_full, 1);
        assert_eq!(observation.broadcast_adapter_errors, 0);
        assert!(observation.room_runtime_continues);
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
        let payload = crate::shell::协议响应::event_to_json(
            contract::领域事件::消息已创建 {
                房间标识: "room-1".to_string(),
                消息标识: "msg-1".to_string(),
                客户端消息标识: "client-1".to_string(),
                发送者会话标识: "session-1".to_string(),
                发送者花名: "花名-1".to_string(),
                文本: "hello".to_string(),
                附件: Vec::new(),
                事件位置: 1,
            },
            None,
            None,
        );

        assert_eq!(payload["type"], "message_created");
        assert_eq!(payload["room_id"], "room-1");
        assert!(
            payload.get("kind").is_none(),
            "权威消息事件不应冒充 control_result"
        );
    }

    #[test]
    fn room_event在无会话上下文时仍会带出附件是否有静态封面的稳定事实() {
        let payload = crate::shell::协议响应::event_to_json(
            contract::领域事件::消息已创建 {
                房间标识: "room-1".to_string(),
                消息标识: "msg-1".to_string(),
                客户端消息标识: "client-1".to_string(),
                发送者会话标识: "session-1".to_string(),
                发送者花名: "花名-1".to_string(),
                文本: "".to_string(),
                附件: vec![contract::附件快照::视频(contract::视频附件快照 {
                    附件标识: "att-video-1".to_string(),
                    宽: 1280,
                    高: 720,
                    有预览图: true,
                    分发线索: None,
                })],
                事件位置: 1,
            },
            None,
            None,
        );

        assert_eq!(payload["attachments"][0]["kind"], "video");
        assert_eq!(payload["attachments"][0]["attachment_id"], "att-video-1");
        assert_eq!(payload["attachments"][0]["has_preview_asset"], true);
        assert!(
            payload["attachments"][0].get("preview_asset").is_none(),
            "没有逐连接会话上下文时，不应在 room_event 里伪造 still_url"
        );
    }

    #[test]
    fn room_event附件携带分发线索时输出distribution_hint() {
        let payload = crate::shell::协议响应::event_to_json(
            contract::领域事件::消息已创建 {
                房间标识: "room-1".to_string(),
                消息标识: "msg-1".to_string(),
                客户端消息标识: "client-1".to_string(),
                发送者会话标识: "s-1".to_string(),
                发送者花名: "测试".to_string(),
                文本: "".to_string(),
                附件: vec![contract::附件快照::视频(contract::视频附件快照 {
                    附件标识: "att-v1".to_string(),
                    宽: 1920,
                    高: 1080,
                    有预览图: false,
                    分发线索: Some(contract::附件分发线索 {
                        content_hash: "hash123".to_string(),
                        swarm_id: "swarm123".to_string(),
                        torrent_info_hash: "ih123".to_string(),
                        web_seed_until秒: 1715500000,
                    }),
                })],
                事件位置: 1,
            },
            None,
            None,
        );
        let hint = &payload["attachments"][0]["distribution_hint"];
        assert_eq!(hint["torrent_info_hash"], "ih123");
        assert_eq!(hint["swarm_id"], "swarm123");
        assert_eq!(hint["content_hash"], "hash123");
        assert_eq!(hint["web_seed_until"], 1715500000);
    }

    #[test]
    fn 广播附件json包含丰富后的distribution_hint() {
        use crate::shell::协议响应::{event_to_json, SwarmBroadcastContext};
        let payload = event_to_json(
            contract::领域事件::消息已创建 {
                房间标识: "room-1".into(),
                消息标识: "msg-1".into(),
                客户端消息标识: "cmsg-1".into(),
                发送者会话标识: "s-sender".into(),
                发送者花名: "sender".into(),
                文本: "hello".into(),
                附件: vec![contract::附件快照::视频(contract::视频附件快照 {
                    附件标识: "att-1".into(),
                    宽: 1920,
                    高: 1080,
                    有预览图: false,
                    分发线索: Some(contract::附件分发线索 {
                        content_hash: "sha256-abc".into(),
                        swarm_id: "swarm-1".into(),
                        torrent_info_hash: "ih-abc".into(),
                        web_seed_until秒: 9999999999,
                    }),
                })],
                事件位置: 1,
            },
            None,
            Some(&SwarmBroadcastContext {
                ticket_secret: Some("test-secret"),
                tracker_public_url: "wss://tracker.example.com/announce",
                ice_servers: serde_json::json!([]),
                ticket_ttl_seconds: 120,
                now_epoch_seconds: 1700000000,
            }),
        );
        let hint = &payload["attachments"][0]["distribution_hint"];
        // 广播路径必须包含运行态字段
        assert!(hint["join_ticket"].as_str().is_some(), "应包含 join_ticket");
        assert!(hint["ticket_expires_at"].as_str().is_some(), "应包含过期时间");
        assert_eq!(hint["announce_urls"][0].as_str().unwrap(), "wss://tracker.example.com/announce");
        assert!(hint["web_seed_url"].is_null(), "广播路径 web_seed_url 应为 null");
        let torrent_url = hint["torrent_url"].as_str().unwrap();
        assert!(torrent_url.starts_with("/api/media/att-1/torrent?ticket="), "应含 ticket 鉴权参数");
        // 稳定字段仍然存在
        assert_eq!(hint["torrent_info_hash"], "ih-abc");
        assert_eq!(hint["swarm_id"], "swarm-1");
    }

    // ── 令牌桶限流测试 ──────────────────────────────────────────────

    use super::连接消息令牌桶;
    use std::time::{Duration, Instant};

    #[test]
    fn 令牌桶_突发容量内全部通过() {
        let base = Instant::now();
        let mut bucket = 连接消息令牌桶::new_with_instant(base);
        for _ in 0..10 {
            assert!(bucket.try_consume_at(base));
        }
    }

    #[test]
    fn 令牌桶_突发容量耗尽后拒绝() {
        let base = Instant::now();
        let mut bucket = 连接消息令牌桶::new_with_instant(base);
        for _ in 0..10 {
            bucket.try_consume_at(base);
        }
        assert!(!bucket.try_consume_at(base));
    }

    #[test]
    fn 令牌桶_等待1秒后补充5个令牌() {
        let base = Instant::now();
        let mut bucket = 连接消息令牌桶::new_with_instant(base);
        // 耗尽全部 10 个
        for _ in 0..10 {
            bucket.try_consume_at(base);
        }
        // 1 秒后补充 5 个
        let after_1s = base + Duration::from_secs(1);
        for _ in 0..5 {
            assert!(bucket.try_consume_at(after_1s));
        }
        assert!(!bucket.try_consume_at(after_1s));
    }

    #[test]
    fn 令牌桶_补充不超过容量上限() {
        let base = Instant::now();
        let mut bucket = 连接消息令牌桶::new_with_instant(base);
        // 不消耗任何令牌，等 10 秒
        let after_10s = base + Duration::from_secs(10);
        // 最多也只有 10 个令牌（不会膨胀到 60 个）
        for _ in 0..10 {
            assert!(bucket.try_consume_at(after_10s));
        }
        assert!(!bucket.try_consume_at(after_10s));
    }
}
