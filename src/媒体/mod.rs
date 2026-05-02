/// 媒体业务模块当前先拆成两条主线：
/// 1. 上传：prepared -> ready 的附件成立链；
/// 2. 协作分发：locator、内容读取、swarm 元数据与后台做种输入。
///
/// 第一阶段不复制契约，只先把 owner 从统一用例里迁出来。
#[path = "协作分发/mod.rs"]
pub mod distribution;
#[path = "模型.rs"]
pub mod 模型;
#[path = "上传/mod.rs"]
pub mod upload;
