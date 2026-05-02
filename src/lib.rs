/// crate 对外暴露的稳定模块表面。
///
/// 维护者约束：
/// 1. 这里是“目录总索引”，用于声明模块边界，不承载业务实现。
/// 2. 新增模块前先判断是否真的需要新文件，优先收口职责而不是碎片化。
/// 3. 模块名对应 DDD 分层语义：adapter/assembly/contract/domain/entry/shell/application。
/// 4. 第一波真 DDD 收口先新增 application/identity/room/message/shared 业务模块，旧总文件只作为待删除债务存在。
#[path = "适配/mod.rs"]
pub mod adapter;
#[path = "应用/mod.rs"]
pub mod application;
#[path = "总装.rs"]
pub mod assembly;
#[path = "领域/mod.rs"]
pub mod domain;
#[path = "入口.rs"]
pub mod entry;
#[path = "身份/mod.rs"]
pub mod identity;
#[path = "消息/mod.rs"]
pub mod message;
#[path = "媒体/mod.rs"]
pub mod media;
#[path = "外壳.rs"]
pub mod shell;
#[path = "媒体/协作分发/共享语义.rs"]
pub mod media_distribution;
#[path = "实时/mod.rs"]
pub mod realtime;
#[path = "恢复/mod.rs"]
pub mod recovery;
#[path = "房间/mod.rs"]
pub mod room;
#[path = "共享/mod.rs"]
pub mod shared;
#[path = "身份/资料投影.rs"]
pub(crate) mod user_identity;
