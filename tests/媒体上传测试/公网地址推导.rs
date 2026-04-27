use super::*;
use axum::{Router, body::Body, response::Response, routing::post};
use tokio::{net::TcpListener, task::JoinHandle};

struct 假Tus上游 {
    内部上传入口: String,
    handle: JoinHandle<()>,
}

async fn 启动假tus上游(location_header: String) -> 假Tus上游 {
    let app = Router::new().route(
        "/files",
        post(move || {
            let location_header = location_header.clone();
            async move {
                Response::builder()
                    .status(StatusCode::CREATED)
                    .header("tus-resumable", "1.0.0")
                    .header(header::LOCATION, location_header)
                    .body(Body::empty())
                    .expect("应能组装 fake tusd response")
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能启动 fake tus upstream");
    let port = listener
        .local_addr()
        .expect("应能读取 fake tus 端口")
        .port();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    假Tus上游 {
        内部上传入口: format!("http://127.0.0.1:{port}"),
        handle,
    }
}

/// 公网地址推导测试：
/// 1. 这里只守 prepare 对外返回的 tus endpoint 是否遵守代理与 Host 真相。
/// 2. 这层只验证地址裁决，不验证上传完成、分发可用性或房间消息行为。
#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传会尊重MEDIA_TUS显式公网配置() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
    ]);
    env::set_var(
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "https://upload.example.com/files",
    );
    env::set_var("MEDIA_TUS_SERVER_PORT", "3081");
    env::set_var("MEDIA_TUS_BASE_PATH", "/files");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-media-tus-public-endpoint-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "explicit-media-tus.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("https://upload.example.com/files"),
        "应用层应开始尊重 MEDIA_TUS_* 显式公网配置，而不是继续绑在旧 vendor 环境变量上"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在未显式配置public_endpoint时默认返回同源相对Tus路径() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "2081");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-lan-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "lan.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[("host", "192.168.50.9:8080")],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("/files"),
        "未显式配置 public endpoint 时，浏览器 contract 应优先收口到同源相对路径，而不是再暴露内部端口"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在反向代理HTTPS下仍优先返回同源相对Tus路径() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-port-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "proxy.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[
            ("x-forwarded-host", "im.example.com"),
            ("x-forwarded-proto", "https"),
            ("x-forwarded-port", "443"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("/files"),
        "即使当前请求已经带了公网 HTTPS 头，prepare 仍应先把浏览器 contract 收口成同源路径，避免多套地址并存"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在显式配置回环public_endpoint时会回退同源相对Tus路径() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
    ]);
    env::set_var("MEDIA_TUS_PUBLIC_ENDPOINT", "http://127.0.0.1:1081/files");
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-host-port-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "loopback-public-endpoint.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("/files"),
        "显式配置如果仍然指向回环地址，prepare 必须把它降级回同源路径，禁止把内部 sidecar 地址泄漏给浏览器"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在仅有forwarded_proto时仍返回同源相对Tus路径() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-proto-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "proxy-default-https.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[("host", "im.example.com"), ("x-forwarded-proto", "https")],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("/files"),
        "标准 HTTPS 反向代理即使没额外透传 forwarded-port，也应继续返回同源路径，而不是切回第二套绝对地址真相"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn 媒体上传同源Tus入口会把Location改写回当前浏览器入口() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
        "MEDIA_TUS_INTERNAL_BASE_URL",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    env::set_var("MEDIA_TUS_BASE_PATH", "/files");
    let fake_upstream = 启动假tus上游("http://127.0.0.1:1081/files/upload-1".to_string()).await;
    env::set_var(
        "MEDIA_TUS_INTERNAL_BASE_URL",
        fake_upstream.内部上传入口.as_str(),
    );
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, headers, _body) = send_bytes(
        app,
        Method::POST,
        "/files",
        &[
            ("tus-resumable", "1.0.0"),
            ("upload-length", "1"),
            ("x-forwarded-host", "im.example.com"),
            ("x-forwarded-proto", "https"),
            ("x-forwarded-port", "443"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        headers
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok()),
        Some("https://im.example.com/files/upload-1"),
        "浏览器通过同源 /files 上传时，代理层必须把 upstream Location 改写回当前浏览器入口"
    );

    fake_upstream.handle.abort();
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn 媒体上传同源Tus入口在未连通sidecar时应返回502而不是404() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
        "MEDIA_TUS_INTERNAL_BASE_URL",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    env::set_var("MEDIA_TUS_BASE_PATH", "/files");
    env::set_var("MEDIA_TUS_INTERNAL_BASE_URL", "http://127.0.0.1:65534");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::OPTIONS,
        "/files",
        None,
        &[("tus-resumable", "1.0.0")],
    )
    .await;

    assert_eq!(
        status,
        StatusCode::BAD_GATEWAY,
        "同源 Tus 入口必须先进入转发链路；即使 sidecar 暂时不可达也应返回 502，而不是路由缺失 404"
    );
    assert_eq!(
        body["code"].as_str(),
        Some("media_tus_upstream_unreachable"),
        "上传入口不可达时应返回可诊断错误码，避免前端只能看到永久上传中"
    );
    恢复环境变量(backup);
}
