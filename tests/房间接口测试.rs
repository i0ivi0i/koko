use axum::http::{Method, StatusCode};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

#[path = "房间接口测试/历史分页.rs"]
mod history_tests;
#[path = "房间接口测试/增量事件.rs"]
mod incremental_events_tests;
#[path = "房间接口测试/阅读推进.rs"]
mod read_anchor_tests;
#[path = "房间接口测试/快照.rs"]
mod snapshot_tests;

use test_support::http::*;

/// 房间接口测试：
/// 1. 这里只守 bootstrap / snapshot / events / history / 阅读推进 这些房间 HTTP 契约。
/// 2. 消息成立、媒体上传、协作分发、后台冷路径不允许继续回灌到这里。
#[tokio::test]
#[serial]
async fn bootstrap接口会返回稳定花名快照() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平匿名身份迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (first_status, first) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token":"device-token-stable"})),
        &[],
    )
    .await;
    assert_eq!(first_status, StatusCode::OK);

    let (second_status, second) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token":"device-token-stable"})),
        &[],
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);

    assert_eq!(
        first["anonymous_identity_id"].as_str(),
        second["anonymous_identity_id"].as_str(),
        "同一设备 token 应恢复同一个匿名内部身份"
    );
    assert_eq!(
        first["display_alias"].as_str(),
        second["display_alias"].as_str(),
        "同一设备 token 应恢复同一个展示花名"
    );
    assert_eq!(
        first["session_id"].as_str(),
        second["session_id"].as_str(),
        "当前 MVP 下同一设备 token 应恢复同一个稳定会话"
    );
}
