/// crate 对外暴露的稳定模块表面。
///
/// 维护者约束：
/// 1. 这里是“目录总索引”，用于声明模块边界，不承载业务实现。
/// 2. 新增模块前先判断是否真的需要新文件，优先收口职责而不是碎片化。
/// 3. 模块名对应 DDD 分层语义：adapter/assembly/contract/domain/entry/shell/usecase。
/// 4. 第一波真 DDD 收口先新增 identity/room/message 业务模块，让旧总文件退成门面。
#[path = "适配.rs"]
pub mod adapter;
#[path = "总装.rs"]
pub mod assembly;
#[path = "契约.rs"]
pub mod contract;
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
#[path = "媒体协作分发.rs"]
pub mod media_distribution;
#[path = "实时/mod.rs"]
pub mod realtime;
#[path = "恢复/mod.rs"]
pub mod recovery;
#[path = "房间/mod.rs"]
pub mod room;
#[path = "用例.rs"]
pub mod usecase;
#[path = "用户身份.rs"]
pub(crate) mod user_identity;
