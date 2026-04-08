use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use socketioxide::{
    extract::{Data, Extension, SocketRef, TryData},
    handler::ConnectHandler,
    BroadcastError, SendError, SocketError, SocketIo,
};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tokio::task;
use tower_http::services::{ServeDir, ServeFile};

use crate::{adapter::Pg仓储, contract, usecase};

// 这三个私有子模块是 shell 内部的职责收口点。
// 当前阶段先只建立文件边界和接线路径，真实实现仍暂时留在总壳里，后续任务再逐步迁入。
#[path = "房间外壳.rs"]
mod 房间外壳;
#[path = "后台外壳.rs"]
mod 后台外壳;
#[path = "实时外壳.rs"]
mod 实时外壳;

/// 外壳层共享运行态，只存放“接线所需配置”，不承载业务事实。
#[derive(Clone)]
pub struct 应用状态 {
    pub pool: PgPool,
    pub runtime_handle: tokio::runtime::Handle,
    pub admin_password: String,
}

/// 组装 HTTP 冷路径 + Realtime 热路径路由。
///
/// 分层约束：
/// 1. 这里做协议接线，不做业务裁决。
/// 2. 命令是否成立必须交给 usecase + domain + repository 主链。
/// 3. 前端静态资源同源托管，减少开发期跨域噪音和双端口复杂度。
pub async fn 构建应用状态(
    database_url: String,
    admin_password: String,
) -> std::io::Result<应用状态> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .map_err(|err| std::io::Error::other(format!("连接数据库失败: {err}")))?;

    Ok(应用状态 {
        pool,
        runtime_handle: tokio::runtime::Handle::current(),
        admin_password,
    })
}

pub fn 构建路由(state: 应用状态) -> Router {
    let (socket_layer, io) = SocketIo::new_layer();
    注册realtime命名空间(&io, state.clone());

    Router::new()
        .route("/api/session/bootstrap", post(房间外壳::bootstrap_session))
        .route("/api/rooms/join-or-create", post(房间外壳::join_or_create_room))
        .route("/api/rooms/{room_id}/snapshot", get(房间外壳::load_room_snapshot))
        .route(
            "/api/rooms/{room_id}/read-anchor",
            post(房间外壳::update_room_read_anchor),
        )
        .route("/api/rooms/{room_id}/history", get(房间外壳::load_room_history))
        .route("/api/rooms/{room_id}/events", get(房间外壳::load_room_events))
        .route("/api/admin/login", post(后台外壳::admin_login))
        .route("/api/admin/overview", get(后台外壳::admin_overview))
        .route("/api/admin/rooms", get(后台外壳::admin_rooms))
        .route("/api/admin/rooms/{room_id}", get(后台外壳::admin_room_detail))
        // 前端静态资源由后端同源托管，避免开发态跨域和双端口联调噪音。
        .route_service("/", ServeFile::new("frontend/index.html"))
        .nest_service("/dist", ServeDir::new("frontend/dist"))
        .layer(socket_layer)
        .with_state(state)
}

/// 注册单节点 realtime 命名空间。
/// 约束：连接级认证在 connect middleware 完成，消息 handler 不再相信 payload 身份。
fn 注册realtime命名空间(io: &SocketIo, state: 应用状态) {
    let connect_state = state.clone();
    io.ns(
        "/",
        (move |socket: SocketRef| {
            let state_for_subscribe = state.clone();
            let state_for_send = state.clone();
            async move {
                // 控制面命令：建立订阅与补洞续接。
                socket.on(
                    "subscribe_room_stream",
                    move |s: SocketRef,
                          Extension(auth): Extension<已认证会话>,
                          Data::<RealtimeSubscribeBody>(payload)| {
                        let state = state_for_subscribe.clone();
                        async move {
                            实时外壳::handle_realtime_subscribe(s, auth, payload, state).await;
                        }
                    },
                );

                // 业务热命令：发送文本消息。
                socket.on(
                    "send_text_message",
                    move |s: SocketRef,
                          Extension(auth): Extension<已认证会话>,
                          Data::<RealtimeSendBody>(payload)| {
                        let state = state_for_send.clone();
                        async move {
                            实时外壳::handle_realtime_send(s, auth, payload, state).await;
                        }
                    },
                );
            }
        })
        .with(
            move |socket: SocketRef, TryData(auth): TryData<RealtimeConnectAuth>| {
                let state = connect_state.clone();
                async move { 实时外壳::认证realtime连接(socket, auth, state).await }
            },
        ),
    );
}

/// 共享状态 -> 仓储 的唯一构造入口。
/// 约束：热路径只复用共享连接池，不在 handler 里重复建池。
fn 构建共享仓储(state: &应用状态) -> Pg仓储 {
    Pg仓储::从连接池构建(state.pool.clone(), state.runtime_handle.clone())
}

/// 统一错误响应体（跨 HTTP 接口稳定结构）。
#[derive(Serialize)]
struct ApiError {
    /// 稳定错误码，供前端逻辑判断。
    code: &'static str,
    /// 可读错误信息，主要用于显示和排障。
    message: String,
}

/// 连接握手携带的最小认证数据。
#[derive(Deserialize, Clone)]
struct RealtimeConnectAuth {
    /// 当前连接声明的会话标识。
    session_id: String,
}

/// 存放在 socket extension 内的已认证会话。
#[derive(Clone)]
struct 已认证会话 {
    session_id: String,
}

/// Realtime 订阅命令负载。
#[derive(Deserialize, Clone)]
struct RealtimeSubscribeBody {
    /// 订阅目标房间。
    room_id: String,
    /// 客户端已持有的最新位置，用于增量续接。
    from: i64,
}

/// Realtime 发送消息命令负载。
#[derive(Deserialize, Clone)]
struct RealtimeSendBody {
    /// 目标房间标识。
    room_id: String,
    /// 客户端消息标识（幂等链路锚点）。
    client_message_id: String,
    /// 消息文本原文。
    text: String,
}

/// 领域事件 -> 传输 JSON 的稳定映射层。
/// 约束：只做字段翻译，不添加业务语义。
fn events_to_json(events: Vec<contract::领域事件>) -> Vec<serde_json::Value> {
    events.into_iter().map(event_to_json).collect()
}

/// 单条领域事件 -> JSON。
fn event_to_json(event: contract::领域事件) -> serde_json::Value {
    match event {
        contract::领域事件::消息已创建 {
            房间标识,
            消息标识,
            客户端消息标识,
            发送者会话标识,
            发送者花名,
            文本,
            事件位置,
        } => serde_json::json!({
            "type": "message_created",
            "room_id": 房间标识,
            "message_id": 消息标识,
            "client_message_id": 客户端消息标识,
            "sender_session_id": 发送者会话标识,
            "sender_display_alias": 发送者花名,
            "body": 文本,
            "event_position": 事件位置
        }),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum 实时发送失败级别 {
    正常断开,
    背压,
    序列化,
    适配器,
}

fn 分类单连接发送失败(err: &SendError) -> 实时发送失败级别 {
    match err {
        SendError::Socket(SocketError::Closed) => 实时发送失败级别::正常断开,
        SendError::Socket(SocketError::InternalChannelFull) => 实时发送失败级别::背压,
        SendError::Serialize(_) => 实时发送失败级别::序列化,
    }
}

fn 分类广播发送失败(err: &BroadcastError) -> 实时发送失败级别 {
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

/// connect middleware：把会话认证收口到连接握手。
/// 约束：这里只确认会话存在并写入 socket extension，不裁决房间权限。
async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    let session_id = match auth {
        Ok(auth) => auth.session_id,
        Err(_) => {
            // 握手载荷不合法属于可预期的接入拒绝，前端会收到 connect_error 再自愈。
            // 这里保留结构化记录，但降成 info，避免把正常拒绝刷成运维告警。
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
    // 连接认证成功只表示“连接身份成立”；它依然不等于成员资格成立，也不等于任何房间业务成立。
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
/// - control_result 仅承载订阅结果/错误，不代表领域事实。
/// - room_events 仅承载已成立领域事件。
async fn handle_realtime_subscribe(
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
            // 先发控制面结果，再发领域事件列表，便于前端分通道处理。
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
            let payload = serde_json::json!({"kind":"error","code":"system_error","message":"快照类型不匹配"});
            let _ = socket.emit("control_result", &payload);
        }
        Ok(Err((_, code, message))) => {
            // 订阅被拒绝是协议层的正常负反馈，真正异常应由 failed/backpressure 去承载。
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
            let payload = serde_json::json!({"kind":"error","code":"system_error","message": format!("任务执行失败: {err}")});
            let _ = socket.emit("control_result", &payload);
        }
    }
}

/// Realtime 业务命令：发送文本消息。
///
/// 语义分离约束：
/// - room_event 仅在“消息已成立”后发出。
/// - 命令拒绝和系统错误走 control_result。
async fn handle_realtime_send(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSendBody,
    state: 应用状态,
) {
    tracing::info!(
        usecase = "发送文本消息",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        client_message_id = payload.client_message_id.as_str(),
        "realtime 发送请求已受理"
    );
    let state = state.clone();
    let session_id = auth.session_id.clone();
    let room_id_for_log = payload.room_id.clone();
    let client_message_id_for_log = payload.client_message_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::发送文本消息(
            &mut repo,
            &payload.room_id,
            &session_id,
            &payload.client_message_id,
            &payload.text,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;

    match result {
        Ok(Ok(event)) => {
            // 只有用例链路返回领域事件，才表示消息真的成立。
            let (room_id, client_message_id, event_position) = match &event {
                contract::领域事件::消息已创建 {
                    房间标识,
                    客户端消息标识,
                    事件位置,
                    ..
                } => (房间标识.clone(), 客户端消息标识.clone(), *事件位置),
            };
            let payload = event_to_json(event);
            if let Err(err) = socket
                .within(room_id.clone())
                .emit("room_event", &payload)
                .await
            {
                match 分类广播发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "发送文本消息",
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
                        usecase = "发送文本消息",
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
                        usecase = "发送文本消息",
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
                        usecase = "发送文本消息",
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
                // succeeded 只能在“权威事件已成立且广播实际成功”之后记录，避免把本地 pending/ack 冒充消息成立。
                tracing::info!(
                    usecase = "发送文本消息",
                    adapter = "socketioxide",
                    outcome = "succeeded",
                    room_id = room_id,
                    session_id = auth.session_id,
                    client_message_id = client_message_id,
                    event_position = event_position,
                    "发送文本消息成功"
                );
            }
        }
        Ok(Err((_, code, message))) => {
            // 业务拒绝会通过 control_result 明确反馈给发送端，这不该冒充系统告警。
            tracing::info!(
                usecase = "发送文本消息",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = code,
                "发送文本消息被拒绝"
            );
            let payload = serde_json::json!({"kind":"rejected","code":code,"message":message});
            let _ = socket.emit("control_result", &payload);
        }
        Err(err) => {
            tracing::error!(
                usecase = "发送文本消息",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = "system_error",
                error = %err,
                "发送文本消息任务执行失败"
            );
            let payload = serde_json::json!({"kind":"error","code":"system_error","message": format!("任务执行失败: {err}")});
            let _ = socket.emit("control_result", &payload);
        }
    }
}

#[cfg(test)]
mod 外壳测试 {
    use super::{分类单连接发送失败, 分类广播发送失败, 实时发送失败级别};
    use socketioxide::{BroadcastError, SendError, SocketError};

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
}

/// 领域错误码 -> HTTP 状态码 + 稳定错误码的映射表。
/// 约束：这里不做领域判断，只做“已得到错误码”的协议转码。
fn map_domain_err_tuple(code: contract::错误码) -> (StatusCode, &'static str, String) {
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
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "系统错误".to_string(),
        ),
    }
}

/// 统一 API 错误响应构造器。
fn err_resp(
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
