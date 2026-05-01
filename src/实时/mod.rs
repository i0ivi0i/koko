/// realtime 业务模块只承接“连接认证 + 订阅补洞”这类热路径业务裁决。
/// socketioxide handler 仍留在外壳层，但不应继续直接摸统一用例内部实现。
#[path = "应用.rs"]
pub mod application;
#[path = "契约.rs"]
pub mod contract;
#[path = "外壳.rs"]
pub mod shell;
