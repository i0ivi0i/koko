#![allow(dead_code)]

/// 集成测试支撑模块总出口。
///
/// 这里故意只收口“小而专”的测试工具：
/// - HTTP / 二进制 / multipart 请求助手
/// - 环境变量与端口等待
/// - 媒体 fixture 与运输层辅助
/// - 日志采集
///
/// 它不是业务编排层，禁止在这里偷放“谁应成功、谁应失败”的业务裁决。
/// 另外这里会被多个 integration test crate 选择性复用；
/// 对单个 crate 来说未使用的 helper 不代表多余，因此在模块边界统一压掉 dead_code 噪音。
pub mod http;

// Rust 的默认模块查找对非 ASCII 标识符不友好，这里显式把稳定文件路径
// 映射到 ASCII 模块名，既保留中文文件名，也避免后续每个测试 crate 都踩同一个坑。
#[path = "媒体.rs"]
pub mod media;

#[path = "日志.rs"]
pub mod logging;

#[path = "环境.rs"]
pub mod env_support;
