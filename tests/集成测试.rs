//! 统一集成测试入口：所有集成测试合并为单二进制。
//!
//! 动机：Rust 的 `tests/` 目录下每个顶层 `.rs` 文件各自编译+链接一个独立二进制。
//! 本项目曾有 17 个顶层文件 → 17 次 MSVC link.exe 链接（每次 ~35MB exe），
//! 改一行 lib.rs 后 `cargo test --no-run` 需要 24 秒。
//!
//! 合并后只链接 1 个二进制，增量链接时间降到 ~2-5 秒。
//! 参考：https://corrode.dev/blog/tips-for-faster-rust-compile-times/
//!       https://matklad.github.io/2021/02/27/delete-cargo-integration-tests.html

// ── 共享测试支撑（只声明一次）──────────────────────────────────
#[path = "测试支撑/mod.rs"]
mod test_support;

// ── 纯独立测试（无 test_support 依赖）─────────────────────────
#[path = "领域测试.rs"]
mod 领域测试;

#[path = "架构边界守卫.rs"]
mod 架构边界守卫;

#[path = "连接门禁测试.rs"]
mod 连接门禁测试;

#[path = "流媒体资产契约测试.rs"]
mod 流媒体资产契约测试;

#[path = "blob媒体资产契约测试.rs"]
mod blob媒体资产契约测试;

#[path = "torrent_core_一致性验证.rs"]
mod torrent_core_一致性验证;

#[path = "媒体测试边界守卫.rs"]
mod 媒体测试边界守卫;

#[path = "用例测试.rs"]
mod 用例测试;

// ── 需要 test_support 的重量级测试 ─────────────────────────────
#[path = "消息主链测试.rs"]
mod 消息主链测试;

#[path = "启动与迁移测试.rs"]
mod 启动与迁移测试;

#[path = "后台与静态壳测试.rs"]
mod 后台与静态壳测试;

#[path = "实时链路测试.rs"]
mod 实时链路测试;

#[path = "媒体共享契约测试.rs"]
mod 媒体共享契约测试;

#[path = "媒体后台测试.rs"]
mod 媒体后台测试;

#[path = "房间接口测试.rs"]
mod 房间接口测试;

#[path = "媒体上传测试.rs"]
mod 媒体上传测试;

#[path = "协作分发测试.rs"]
mod 协作分发测试;
