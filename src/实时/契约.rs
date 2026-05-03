/// realtime 上下文对外承认的稳定 published surface。
/// 这里显式声明本上下文只共享“快照 + 错误码”两类稳定语义，
/// 其余 socket / JSON / 协议细节一律留在外壳与适配层。
pub type 快照 = crate::shared::contract::快照;
pub type 错误码 = crate::shared::contract::错误码;
