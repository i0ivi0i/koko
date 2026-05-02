/// 房间业务模块当前先复用旧总契约中的稳定快照与命令结果。
/// 第一阶段只先显式宣告 owner，不复制类型定义。
pub use crate::shared::contract::{命令结果, 快照};
