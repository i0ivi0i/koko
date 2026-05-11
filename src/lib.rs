/// crate 对外暴露的稳定模块表面。
///
/// 维护者约束：
/// 1. 这里是“目录总索引”，用于声明模块边界，不承载业务实现。
/// 2. 新增模块前先判断是否真的需要新文件，优先收口职责而不是碎片化。
/// 3. 模块名对应 DDD 分层语义：adapter/assembly/contract/domain/entry/shell/application。
/// 4. 旧根过渡文件已经删除；这里只允许保留当前仍有明确 owner 的业务模块与装配模块。
#[path = "适配/mod.rs"]
pub mod adapter;
#[path = "应用/mod.rs"]
pub mod application;
#[path = "组合根.rs"]
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
#[path = "外壳/mod.rs"]
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


