use axum::http::{Method, StatusCode};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};


// 媒体后台测试只守后台维护 owner：
// - 上传残留清理
// - 冷源 / mezzanine 清理
// - 清理后对外共享的事实
//
// 这里故意先保持最小 manifest，红测阶段不提前把共享 imports 都补齐，
// 这样可以证明后续接线修复确实是围绕新 crate 的上下文缺口展开，
// 而不是一上来顺手改断言或改业务语义。
#[path = "媒体后台测试/冷源清理.rs"]
mod cold_source_cleanup_tests;
#[path = "媒体后台测试/上传残留清理.rs"]
mod upload_cleanup_tests;

use crate::test_support::{http::*, media::*};
