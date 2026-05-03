use super::*;

/// complete 测试只守上传主链后半段：
/// 1. prepared 附件何时能升级成 ready；
/// 2. post-finish / final / single 回执竞争时谁是真正权威；
/// 3. 图片与视频 complete 后投影给壳层的资产面是否稳定。
#[path = "complete_图片与回执竞争.rs"]
mod complete_image_receipt_tests;
#[path = "complete_视频与类型守卫.rs"]
mod complete_video_and_type_guard_tests;
