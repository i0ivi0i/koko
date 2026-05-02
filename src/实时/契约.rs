/// realtime 业务模块当前只复用共享契约中的快照与错误码。
/// 第一阶段先把热路径 owner 收清楚，不复制控制面 JSON 或 socket 层协议细节。
pub use crate::shared::contract::{快照, 错误码};
