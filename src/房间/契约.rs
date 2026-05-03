/// 房间上下文对外承认的稳定 published surface。
/// 房间主链只共享“快照 + 命令结果”这两类契约语义，
/// 不让历史 shared 契约继续伪装成房间上下文自己的入口。
pub type 命令结果 = crate::shared::contract::命令结果;
pub type 快照 = crate::shared::contract::快照;
