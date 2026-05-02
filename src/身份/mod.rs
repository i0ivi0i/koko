/// 身份业务模块第一阶段只先承接“匿名身份引导”这一条真相入口。
/// 身份真实 owner 从这里开始收口；跨业务共享应用端口只作为下沉前的临时交汇点。
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
