/// crate 对外暴露的稳定模块表面。
///
/// 维护者约束：
/// 1. 这里是“目录总索引”，用于声明模块边界，不承载业务实现。
/// 2. 新增模块前先判断是否真的需要新文件，优先收口职责而不是碎片化。
/// 3. 模块名对应 DDD 分层语义：adapter/assembly/contract/domain/entry/shell/usecase。
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
#[path = "外壳.rs"]
pub mod shell;
#[path = "媒体协作分发.rs"]
pub mod media_distribution;
#[path = "用例.rs"]
pub mod usecase;
