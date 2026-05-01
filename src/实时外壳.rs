/// 过渡期门面：真正的 realtime shell owner 已搬到 `crate::realtime::shell`。
/// 这里继续保留旧文件名，只为让外层总壳的挂线不需要一次性推倒重接。
/// 新逻辑禁止继续回流到这份文件；所有热路径实现都必须进入 `src/实时/外壳.rs`。
pub(super) use crate::realtime::shell::{
    RealtimeConnectAuth, RealtimeCreateMessageBody, RealtimeSubscribeBody, 已认证会话,
    handle_realtime_create_message, handle_realtime_subscribe, 记录realtime断开, 认证realtime连接,
};
