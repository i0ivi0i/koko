use axum::http::{header, Method, StatusCode};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};

#[path = "测试支撑/mod.rs"]
mod test_support;

#[path = "媒体上传测试/abandon.rs"]
mod abandon_tests;
#[path = "媒体上传测试/complete.rs"]
mod complete_tests;
#[path = "媒体上传测试/prepare.rs"]
mod prepare_tests;
#[path = "媒体上传测试/公网地址推导.rs"]
mod public_endpoint_tests;
#[path = "媒体上传测试/source_hash.rs"]
mod source_hash_tests;
#[path = "媒体上传测试/tus_hook.rs"]
mod tus_hook_tests;
#[path = "媒体上传测试/单文件主链.rs"]
mod 单文件主链;

// 顶层 manifest 只保留共享 imports 与子模块挂载：
// - prepare / complete / abandon 各自守自己的上传阶段 owner
// - tus_hook / 公网地址推导继续守协议与地址推导
// - 不允许再把具体测试 bodies 堆回顶层文件
use test_support::{env_support::*, http::*, media::*};
