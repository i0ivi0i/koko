#[path = "媒体/fixture.rs"]
mod fixture;
#[path = "媒体/seed.rs"]
mod seed;
#[path = "媒体/tus.rs"]
mod tus;

// 媒体测试支撑顶层只保留稳定出口：
// - `tus` 负责协议负载与断言
// - `seed` 负责数据库建数
// - `fixture` 负责本地样本与临时文件
#[allow(unused_imports)]
pub use fixture::{iso5品牌mp4字节, 写入tus测试文件, 最小mp4字节, 最小png字节, 最小webp字节};
#[allow(unused_imports)]
pub use seed::{
    插入ready图片附件记录, 插入ready视频附件记录, 插入流媒体清单元数据记录,
    插入附件协作分发元数据记录, 写入完整peer存活记录, 未来冷源到期时间戳秒,
};
#[allow(unused_imports)]
pub use tus::{
    提取媒体上传授权头, 断言TusHook已接受, 断言TusHook拒绝Termination, 断言TusHook拒绝上传,
    断言媒体准备结果是Tus契约, 构造tus_concatenation_hook请求体, 构造tus_hook请求体,
};
