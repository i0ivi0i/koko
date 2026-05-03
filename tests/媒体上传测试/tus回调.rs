use super::*;

/// Tus hook 测试：
/// 1. 这里只验证 hook 与上传运输真相之间的最小权威关系。
/// 2. pre-create / post-finish 的契约必须稳定，但不在这里验证消息成立或房间读取。
#[path = "tus回调_协议入口与pre_create.rs"]
mod tus_hook_protocol_and_pre_create_tests;
#[path = "tus回调_post_finish与terminate.rs"]
mod tus_hook_post_finish_and_terminate_tests;
