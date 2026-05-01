/// 消息业务模块先承接文本消息与统一消息创建主链。
/// 这样 realtime 和冷路径都会通过同一条消息 owner 进入权威事件提交。
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
