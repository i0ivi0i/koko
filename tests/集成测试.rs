use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
};
use serde_json::Value;
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::io;
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;
use tokio::time::{sleep, timeout, Duration};
use tower::ServiceExt;

/// 集成测试总则：
/// 1. 这里测试“模块接线后”的真实行为，而不是单点纯函数。
/// 2. 重点覆盖：配置失败、迁移结构、事务顺序、HTTP 冷路径、Realtime 主链。
#[test]
#[serial]
fn 启动缺配置即失败() {
    let keys = [
        "DATABASE_URL",
        "ADMIN_PASSWORD",
        "APP_PORT",
        "RUST_LOG",
        "KOKO_SKIP_DOTENV",
    ];
    let backup = 备份并清空环境变量(&keys);
    env::set_var("KOKO_SKIP_DOTENV", "1");

    let result = koko::assembly::读取配置();
    assert!(result.is_err(), "缺关键配置时必须失败");

    恢复环境变量(backup);
}

#[test]
fn 数据库真相模型可迁移() {
    let sql = std::fs::read_to_string("migrations/0001_初始化真相模型.sql")
        .expect("应存在初始化迁移文件");
    let sql_v2 = std::fs::read_to_string("migrations/0002_设备级匿名身份.sql")
        .expect("应存在匿名身份迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS sessions"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS rooms"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_members"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_events"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS messages"));
    assert!(sql.contains("UNIQUE (room_id, event_position)"));
    assert!(sql.contains("FOREIGN KEY (room_id, event_position)"));
    assert!(sql_v2.contains("CREATE TABLE IF NOT EXISTS anonymous_identities"));
    assert!(sql_v2.contains("device_anonymous_token"));
    assert!(sql_v2.contains("anonymous_identity_id"));
}

#[test]
fn 数据库真相模型包含房间阅读锚点表() {
    let sql = std::fs::read_to_string("migrations/0003_房间阅读锚点.sql")
        .expect("应存在房间阅读锚点迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_read_anchors"));
    assert!(sql.contains("anonymous_identity_id"));
    assert!(sql.contains("last_read_event_position"));
    assert!(sql.contains("UNIQUE (anonymous_identity_id, room_id)"));
}

#[test]
fn 共享契约已为房间阅读推进预留稳定命令() {
    let command = koko::contract::命令::推进房间阅读位置 {
        房间标识: "r-test".to_string(),
        已读到事件位置: 3,
    };

    assert!(matches!(
        command,
        koko::contract::命令::推进房间阅读位置 {
            已读到事件位置: 3,
            ..
        }
    ));
}

#[tokio::test]
#[serial]
async fn 阅读锚点会写入当前匿名身份与房间的唯一记录() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RA{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let (identity_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 0)
            .expect("应能写入初始阅读锚点");
        (identity.匿名身份标识, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let row = sqlx::query(
        "SELECT ai.anonymous_identity_id, rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN anonymous_identities ai ON ai.id = rra.anonymous_identity_id \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应存在阅读锚点记录");

    let stored_identity: String = row.get("anonymous_identity_id");
    let stored_position: i64 = row.get("last_read_event_position");
    assert_eq!(stored_identity, identity_id);
    assert_eq!(stored_position, 0);

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 阅读锚点只会单调前进不会被回退覆盖() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RB{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-advance-{uniq}");
    let database_url = cfg.database_url.clone();

    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        for index in 0..5 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &identity.会话标识,
                &format!("read-anchor-c-{index}"),
                &format!("read-anchor-{index}"),
            )
            .expect("应能先制造已成立消息");
        }

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 5)
            .expect("应能先写入更靠后的位置");
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 2)
            .expect("较早位置不应破坏已有锚点");
        room_id
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let stored_position: i64 = sqlx::query_scalar(
        "SELECT rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询到阅读位置");

    assert_eq!(stored_position, 5, "较早写入不应把阅读锚点回退");
    pool.close().await;
}

#[test]
#[serial]
fn 发送消息事务性顺序成立() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("T{:011}", uniq % 100_000_000_000);
    let device_token = format!("tx-device-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let event = koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-1", "hello")
        .expect("应能发送消息");
    match event {
        koko::contract::领域事件::消息已创建 {
            房间标识,
            事件位置,
            文本,
            ..
        } => {
            assert_eq!(房间标识, room_id, "事件房间标识应匹配");
            assert_eq!(事件位置, 1, "第一条消息事件位置应为 1");
            assert_eq!(文本, "hello", "事件文本应保持一致");
        }
    }

    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 1, "房间锚点应推进到 1");
    assert_eq!(events, 1, "房间事件应写入 1 条");
    assert_eq!(messages, 1, "消息表应写入 1 条");
}

#[test]
#[serial]
fn realtime主链闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("R{:011}", uniq % 100_000_000_000);
    let device_token = format!("rt-device-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let control = koko::contract::控制面结果::订阅已建立 {
        房间标识: room_id.clone(),
        起始位置: 0,
    };
    assert!(matches!(
        control,
        koko::contract::控制面结果::订阅已建立 {
            起始位置: 0, ..
        }
    ));

    let event =
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "rt-c-1", "hello rt")
            .expect("发送消息应成功");
    assert!(matches!(
        event,
        koko::contract::领域事件::消息已创建 {
            事件位置: 1, ..
        }
    ));

    let delta = repo
        .拉取房间增量事件(&room_id, 0)
        .expect("应能拉取增量事件");
    match delta {
        koko::contract::快照::房间增量事件 {
            房间标识,
            最新事件位置,
            事件,
        } => {
            assert_eq!(房间标识, room_id);
            assert_eq!(最新事件位置, 1);
            assert_eq!(事件.len(), 1);
        }
        _ => panic!("应返回房间增量事件快照"),
    }
}

#[tokio::test]
#[serial]
async fn 构建应用状态时持有共享数据库连接池() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let snapshot = tokio::task::spawn_blocking(move || {
        let repo = koko::adapter::Pg仓储::从连接池构建(
            state.pool.clone(),
            state.runtime_handle.clone(),
        );
        repo.后台概览()
    })
    .await
    .expect("阻塞任务应完成")
    .expect("共享连接池上的仓储应可用");
    assert!(matches!(snapshot, koko::contract::快照::后台概览 { .. }));
}

#[tokio::test]
#[serial]
async fn http冷路径闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("H{:011}", uniq % 100_000_000_000);
    let device_token = format!("http-device-{uniq}");

    let (status, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("应返回 session_id")
        .to_string();

    let (status, join) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": session_id, "room_code": code})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let room_id = join["room_id"]
        .as_str()
        .expect("应返回 room_id")
        .to_string();

    let (status, snapshot) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(snapshot["room_id"].as_str(), Some(room_id.as_str()));

    let (status, events) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(events["events"].is_array());

    let (status, admin_login) = send_json(
        app.clone(),
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"admin"})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = admin_login["token"].as_str().expect("应返回 admin token");
    let headers = [("x-admin-token", token)];

    let (status, overview) = send_json(
        app.clone(),
        Method::GET,
        "/api/admin/overview",
        None,
        &headers,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(overview["room_count"].as_u64().unwrap_or(0) >= 1);

    let (status, rooms) =
        send_json(app.clone(), Method::GET, "/api/admin/rooms", None, &headers).await;
    assert_eq!(status, StatusCode::OK);
    assert!(rooms["rooms"].as_array().is_some());

    let (status, room_detail) = send_json(
        app,
        Method::GET,
        &format!("/api/admin/rooms/{room_id}"),
        None,
        &headers,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(room_detail["room_id"].as_str(), Some(room_id.as_str()));
}

#[tokio::test]
#[serial]
async fn 房间增量事件查询缺少session_id会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::GET,
        "/api/rooms/r-missing/events?from=0",
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 非成员不能通过events接口拉取房间增量() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("E{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("owner-device-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("stranger-device-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={stranger_session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 成员通过events接口只会拿到from之后的事件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("F{:011}", uniq % 100_000_000_000);
    let device_token = format!("events-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-1", "first")
            .expect("应能发送第一条消息");
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-2", "second")
            .expect("应能发送第二条消息");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={session_id}&from=1"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let events = body["events"].as_array().expect("events 应为数组");
    assert_eq!(events.len(), 1, "只应返回 event_position > from 的事件");
    assert_eq!(events[0]["event_position"].as_i64(), Some(2));
    assert_eq!(body["latest_event_position"].as_i64(), Some(2));
}

#[tokio::test]
#[serial]
async fn 不存在的房间通过events接口会返回room_not_found() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": "missing-room-device"})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/r-nope/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"].as_str(), Some("room_not_found"));
}

#[tokio::test]
#[serial]
async fn 有阅读锚点时房间快照围绕第一条未读返回首屏() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("S{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-c-{index}"),
                &format!("snapshot-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 80)
            .expect("应能先建立阅读锚点");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(80));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(81));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|msg| msg["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();

    assert!(positions.iter().any(|position| *position < 81), "首屏必须带已读上下文");
    assert!(positions.contains(&81), "首屏必须覆盖第一条未读");
    assert!(positions.first().copied().unwrap_or_default() > 1, "围绕未读恢复时不应回到整房最老消息");
    assert_eq!(positions.last().copied(), Some(100), "首屏应覆盖当前房间最新位置附近");
}

#[tokio::test]
#[serial]
async fn 房间快照会返回首条未读事件位置和是否仍有更早历史() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("Q{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-order-c-{index}"),
                &format!("order-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 90)
            .expect("应能先推进阅读位置");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(90));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(91));
    assert_eq!(body["has_more_before"].as_bool(), Some(true));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert!(
        positions.windows(2).all(|window| window[0] < window[1]),
        "房间快照里的首屏消息必须按升序返回"
    );
}

#[tokio::test]
#[serial]
async fn 无阅读锚点时房间快照回退到最近一屏消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("P{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-short-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..60 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-short-c-{index}"),
                &format!("latest-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), None);
    assert_eq!(body["first_unread_event_position"].as_i64(), None);
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    assert!(!messages.is_empty(), "无阅读锚点时也应返回最近一屏消息");
    assert_eq!(messages.last().and_then(|msg| msg["body"].as_str()), Some("latest-59"));
    assert_ne!(
        messages.first().and_then(|msg| msg["body"].as_str()),
        Some("latest-0"),
        "无阅读锚点时不应回到整房最老消息"
    );
}

#[tokio::test]
#[serial]
async fn 阅读推进成功后下一次进房会按新锚点恢复() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("U{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-http-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-http-c-{index}"),
                &format!("read-http-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 3
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(3));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(4));
}

#[tokio::test]
#[serial]
async fn 阅读推进不能回退到更早位置() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("V{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-regress-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-regress-c-{index}"),
                &format!("regress-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (first_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 5
        })),
        &[],
    )
    .await;
    assert_eq!(first_status, StatusCode::OK);

    let (second_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 2
        })),
        &[],
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(5));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(6));
}

#[tokio::test]
#[serial]
async fn 非成员阅读推进会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("W{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-stranger-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": stranger_session_id,
            "last_read_event_position": 0
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 阅读推进失败不会影响房间快照和历史查询可用性() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("X{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-failure-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..3 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-failure-c-{index}"),
                &format!("read-anchor-failure-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 99
        })),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));

    let (snapshot_status, snapshot_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(snapshot_status, StatusCode::OK);
    assert_eq!(snapshot_body["room_id"].as_str(), Some(room_id.as_str()));

    let (history_status, history_body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=3&limit=2"
        ),
        None,
        &[],
    )
    .await;
    assert_eq!(history_status, StatusCode::OK);
    assert!(history_body["messages"].as_array().is_some());
}

#[tokio::test]
#[serial]
async fn 房间历史分页会返回before_event_position之前的消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("H{:011}", (uniq + 1) % 100_000_000_000);
    let device_token = format!("history-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-c-{index}"),
                &format!("history-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=2"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["body"].as_str(), Some("history-2"));
    assert_eq!(messages[1]["body"].as_str(), Some("history-3"));
}

#[tokio::test]
#[serial]
async fn 房间历史分页仍按事件位置升序返回() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("I{:011}", (uniq + 2) % 100_000_000_000);
    let device_token = format!("history-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..4 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-order-c-{index}"),
                &format!("history-order-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=4"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let positions = body["messages"]
        .as_array()
        .expect("messages 应为数组")
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert_eq!(positions, vec![1, 2, 3, 4]);
}

#[tokio::test]
#[serial]
async fn 房间历史分页无更早消息时返回空数组() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("J{:011}", (uniq + 3) % 100_000_000_000);
    let device_token = format!("history-empty-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "history-empty-c-1", "first")
            .expect("应能发送消息");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=1&limit=55"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert!(messages.is_empty(), "没有更早历史时必须返回空数组");
}

#[tokio::test]
#[serial]
async fn 非成员不能通过history接口读取更早消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("K{:011}", (uniq + 4) % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-stranger-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={stranger_session_id}&before_event_position=1&limit=55"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

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

#[tokio::test]
#[serial]
async fn http冷路径成功会输出accepted与succeeded日志() {
    let (buffer, _guard) = 创建集成测试日志采集上下文();

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let device_token = format!("http-log-device-{uniq}");

    let (status, _) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let output = 读取日志缓冲(&buffer);
    assert!(
        output.contains("usecase") && output.contains("引导匿名身份"),
        "成功主链日志缺少 usecase: {output}"
    );
    assert!(
        output.contains("adapter") && output.contains("http"),
        "成功主链日志缺少 adapter=http: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("accepted"),
        "成功主链日志缺少 accepted: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("succeeded"),
        "成功主链日志缺少 succeeded: {output}"
    );
}

#[tokio::test]
#[serial]
async fn http冷路径拒绝会输出rejected日志与error_code() {
    let (buffer, _guard) = 创建集成测试日志采集上下文();

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, _) = send_json(
        app,
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"wrong-password"})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let output = 读取日志缓冲(&buffer);
    assert!(
        output.contains("usecase") && output.contains("管理员登录"),
        "拒绝日志缺少 usecase: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("rejected"),
        "拒绝日志缺少 rejected: {output}"
    );
    assert!(
        output.contains("error_code") && output.contains("admin_auth_failed"),
        "拒绝日志缺少稳定 error_code: {output}"
    );
}

#[tokio::test]
#[serial]
async fn 启动收到关闭信号后会优雅停机() {
    let backup = 备份并清空环境变量(&["APP_PORT"]);
    let port = 分配测试端口();
    env::set_var("APP_PORT", port.to_string());

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        koko::entry::启动并等待关闭信号(async move {
            let _ = shutdown_rx.await;
        })
        .await
    });

    等待端口开始监听(port).await;
    shutdown_tx.send(()).expect("测试应能发出关闭信号");

    let result = timeout(Duration::from_secs(10), server)
        .await
        .expect("服务收到关闭信号后应在超时前完成收尾")
        .expect("启动任务不应 panic");
    assert!(result.is_ok(), "优雅停机不应把正常退出当成失败");

    等待端口停止监听(port).await;
    恢复环境变量(backup);
}

fn 备份并清空环境变量(keys: &[&str]) -> Vec<(String, Option<String>)> {
    // 先备份再清空，确保测试结束后能完整恢复本机环境，避免污染开发机。
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        out.push(((*key).to_string(), env::var(key).ok()));
        env::remove_var(key);
    }
    out
}

fn 恢复环境变量(backup: Vec<(String, Option<String>)>) {
    // 按备份回放：有值就恢复、无值就移除，保持测试前后的环境一致性。
    for (key, value) in backup {
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }
}

fn 分配测试端口() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("应能申请临时端口");
    let port = listener
        .local_addr()
        .expect("应能读取本地地址")
        .port();
    drop(listener);
    port
}

async fn 等待端口开始监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务未在预期时间内开始监听端口: {port}");
}

async fn 等待端口停止监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务收到关闭信号后仍未释放端口: {port}");
}

/// HTTP 测试助手：
/// - 统一构造请求
/// - 统一解析 JSON 响应
/// - 让每个测试聚焦业务断言，而不是重复样板代码
async fn send_json(
    app: axum::Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let body = if let Some(v) = body {
        req = req.header("content-type", "application/json");
        Body::from(v.to_string())
    } else {
        Body::empty()
    };

    let response = app
        .oneshot(req.body(body).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    if bytes.is_empty() {
        (status, serde_json::json!({}))
    } else {
        let json = serde_json::from_slice::<Value>(&bytes).expect("json body");
        (status, json)
    }
}

fn 创建集成测试日志采集上下文() -> (Arc<Mutex<Vec<u8>>>, tracing::dispatcher::DefaultGuard) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);
    (buffer, guard)
}

fn 读取日志缓冲(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8")
}

#[derive(Clone)]
struct 共享写入器(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for 共享写入器 {
    type Writer = 缓冲写入器;

    fn make_writer(&'a self) -> Self::Writer {
        缓冲写入器(self.0.clone())
    }
}

struct 缓冲写入器(Arc<Mutex<Vec<u8>>>);

impl io::Write for 缓冲写入器 {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().expect("lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
