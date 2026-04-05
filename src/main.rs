/// 二进制入口只做一件事：把控制权交给 `entry::启动`。
///
/// 约束：
/// - 不在 main 里写业务逻辑。
/// - 不在 main 里写框架装配细节。
/// - 出现启动问题时，从 `src/入口.rs` 和 `src/总装.rs` 继续追踪。
#[tokio::main]
async fn main() -> std::io::Result<()> {
    koko::entry::启动().await
}
