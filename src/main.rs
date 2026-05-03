/// 二进制入口只做一件事：把控制权交给 `entry::启动`。
///
/// 约束：
/// - 不在 main 里写业务逻辑。
/// - 不在 main 里写框架装配细节。
/// - 出现启动问题时，从 `src/入口.rs` 和 `src/组合根.rs` 继续追踪。
fn main() -> std::io::Result<()> {
    // 官方推荐的本地时间格式化器要在线程 runtime 完成初始化前获取本地 offset；
    // 因此 main 先装日志，再创建 Tokio runtime，避免开发态终端继续看到 UTC `...Z`。
    koko::assembly::初始化日志()?;

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(koko::entry::启动())
}
