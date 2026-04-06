use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
};
use serde_json::Value;
use serial_test::serial;
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
