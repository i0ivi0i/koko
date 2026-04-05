/// 领域层模块入口。
///
/// 约束：
/// - 这里只做领域子模块装配与错误重导出。
/// - 不引入任何框架、IO、协议类型。
/// - 领域层必须保持“可在无框架环境下单测”。
#[path = "错误.rs"]
pub mod error;
#[path = "成员.rs"]
pub mod member;
#[path = "消息.rs"]
pub mod message;
#[path = "房间.rs"]
pub mod room;
#[path = "会话.rs"]
pub mod session;

pub use error::领域错误;
