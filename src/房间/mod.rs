/// 房间业务模块先承接“进房、快照、增量、历史、已读”这组主链能力。
/// 第一阶段不追求文件数量好看，只追求房间 owner 不再继续堆回统一用例。
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
