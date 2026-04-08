use super::*;

/// Realtime 热路径外壳。
///
/// 当前阶段先只把接线入口移入独立文件，保留父模块中的真实实现。
/// 这样可以先验证：
/// 1. 命名空间注册是否能稳定引用子模块入口；
/// 2. 不改业务语义的前提下，文件边界是否已经成立；
/// 3. 后续再迁移真正实现时，不会同时改“接线”和“逻辑”两件事。
pub(super) async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    super::认证realtime连接(socket, auth, state).await
}

/// 订阅房间事件流的临时桥接入口。
pub(super) async fn handle_realtime_subscribe(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSubscribeBody,
    state: 应用状态,
) {
    super::handle_realtime_subscribe(socket, auth, payload, state).await;
}

/// 发送文本消息的临时桥接入口。
pub(super) async fn handle_realtime_send(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSendBody,
    state: 应用状态,
) {
    super::handle_realtime_send(socket, auth, payload, state).await;
}
