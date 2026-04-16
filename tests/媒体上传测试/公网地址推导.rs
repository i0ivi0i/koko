use super::*;

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
async fn prepare媒体上传在未显式配置public_endpoint时会按请求Host推导LAN可访问Tus地址() {
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
        Some("http://192.168.50.9:2081/files"),
        "未显式配置 public endpoint 时，prepare 至少应回到当前请求 Host 可达的 Tus 地址"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在反向代理HTTPS下会优先使用forwarded公网端口() {
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
        Some("https://im.example.com/files"),
        "反向代理已经声明公网协议与公网端口时，prepare 不应再把内部 Tus 监听端口泄漏给外部浏览器"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在forwarded_host自带公网端口时会保留该端口() {
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
            "file_name": "proxy-8443.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[
            ("x-forwarded-host", "im.example.com:8443"),
            ("x-forwarded-proto", "https"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("https://im.example.com:8443/files"),
        "forwarded host 已经给出公网 authority 时，prepare 应继续沿用它，而不是退回内部 Tus 端口"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在仅有forwarded_proto时会按协议默认端口构造公网地址() {
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
        Some("https://im.example.com/files"),
        "标准 HTTPS 反向代理即使没额外透传 forwarded-port，也不应把内部 Tus 监听端口暴露给公网客户端"
    );
    恢复环境变量(backup);
}
