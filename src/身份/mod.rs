/// 身份业务模块当前先承接“匿名身份引导”这一条真相入口。
/// 身份真实 owner 从这里开始收口；跨业务共享应用端口只暴露稳定共享语义，不再充当旧链路桥。
#[path = "匿名身份.rs"]
pub(crate) mod anonymous_identity;
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
