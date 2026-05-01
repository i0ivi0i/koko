/// 身份业务模块第一阶段只先承接“匿名身份引导”这一条真相入口。
/// 旧 `crate::usecase` 继续作为兼容门面，但真实 owner 从这里开始收口。
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
