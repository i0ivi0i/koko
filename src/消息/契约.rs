/// 消息上下文对外承认的稳定事件面。
/// 消息成立后的权威事件仍复用共享语义，但必须以消息上下文自己的名字对外暴露，
/// 避免维护者继续把 shared 契约误认成消息 published language。
pub type 领域事件 = crate::shared::contract::领域事件;
