use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
};
use serial_test::serial;
use serde_json::Value;
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tower::ServiceExt;

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

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS sessions"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS rooms"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_members"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_events"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS messages"));
    assert!(sql.contains("UNIQUE (room_id, event_position)"));
    assert!(sql.contains("FOREIGN KEY (room_id, event_position)"));
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
    let user_name = format!("tx-user-{uniq}");

    let session = koko::usecase::引导匿名会话(&mut repo, &user_name).expect("应能创建会话");
    let session_id = match session {
        koko::contract::快照::会话 { 会话标识, .. } => 会话标识,
        _ => panic!("引导会话应返回会话快照"),
    };
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

#[tokio::test]
#[serial]
async fn http冷路径闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let app = koko::shell::构建路由(cfg.database_url.clone(), cfg.admin_password.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("H{:011}", uniq % 100_000_000_000);
    let display_name = format!("http-user-{uniq}");

    let (status, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"display_name": display_name})),
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
    let room_id = join["room_id"].as_str().expect("应返回 room_id").to_string();

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
        &format!("/api/rooms/{room_id}/events?from=0"),
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

    let (status, rooms) = send_json(app.clone(), Method::GET, "/api/admin/rooms", None, &headers).await;
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

fn 备份并清空环境变量(keys: &[&str]) -> Vec<(String, Option<String>)> {
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        out.push(((*key).to_string(), env::var(key).ok()));
        env::remove_var(key);
    }
    out
}

fn 恢复环境变量(backup: Vec<(String, Option<String>)>) {
    for (key, value) in backup {
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }
}

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

    let response = app.oneshot(req.body(body).expect("request")).await.expect("response");
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
