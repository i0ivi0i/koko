use axum::http::{Method, StatusCode, header};
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serial_test::serial;
use sqlx::{Row, postgres::PgPoolOptions};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

#[path = "协作分发测试/可用性裁决.rs"]
mod availability_ruling_tests;
#[path = "协作分发测试/内容读取.rs"]
mod content_read_tests;
#[path = "协作分发测试/分发元数据.rs"]
mod distribution_metadata_tests;
#[path = "协作分发测试/投影一致性.rs"]
mod projection_consistency_tests;
#[path = "协作分发测试/locator与torrent合同.rs"]
mod locator_and_torrent_contract_tests;
#[path = "协作分发测试/tracker代理.rs"]
mod tracker_proxy_tests;
#[path = "协作分发测试/切片支撑.rs"]
mod distribution_slice_support;
#[path = "协作分发测试/上传场景支撑.rs"]
mod upload_scene_support;

// 顶层 manifest 只保留共享 imports 与子模块挂载：
// - 可用性裁决 / 内容读取 / 分发元数据 / 投影一致性各守自己的协作分发切片
// - locator / torrent / tracker 读侧合同拆到独立子模块
// - 顶层不再夹带任何 inline 测试 bodies 与测试启动支撑
use crate::test_support::{env_support::*, http::*, media::*};
