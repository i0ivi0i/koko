use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
};
use serde_json::Value;
use serial_test::serial;
use std::time::{SystemTime, UNIX_EPOCH};
use tower::ServiceExt;

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{http::*, logging::*, media::*};

/// 后台与静态壳测试：
/// 1. 这里只守后台接口 contract、静态壳缓存策略、service worker 暴露和 HTTP 冷路径日志。
/// 2. 不负责房间阅读、实时并发、媒体上传运输态本身。
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
async fn 后台缺少令牌时仍返回稳定错误码() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(app, Method::GET, "/api/admin/overview", None, &[]).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"].as_str(), Some("admin_session_required"));
}

#[tokio::test]
#[serial]
async fn 后台房间详情仍返回最新事件位置和消息总数() {
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
    let code = format!("AD{:010}", uniq % 10_000_000_000);
    let owner_token = format!("admin-detail-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &owner_token)
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
                &format!("admin-detail-c-{index}"),
                &format!("admin-detail-{index}"),
            )
            .expect("应能连续发送消息");
        }
        room_id
    })
    .await
    .expect("阻塞建数任务应完成");

    let (login_status, login_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"admin"})),
        &[],
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    let token = login_body["token"].as_str().expect("应返回 admin token");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/admin/rooms/{room_id}"),
        None,
        &[("x-admin-token", token)],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["room_id"].as_str(), Some(room_id.as_str()));
    assert_eq!(body["latest_event_position"].as_i64(), Some(3));
    assert_eq!(body["message_count"].as_i64(), Some(3));
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
async fn 静态壳入口会no_cache且hashed静态资源会长缓存() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let root_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(root_response.status(), StatusCode::OK, "/ 应可读取");
    let root_cache_control = root_response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .expect("入口 HTML 必须显式返回 Cache-Control");
    assert_eq!(
        root_cache_control, "no-cache",
        "入口 HTML 必须总是回源确认新版本"
    );
    let root_html = String::from_utf8(
        to_bytes(root_response.into_body(), usize::MAX)
            .await
            .expect("应能读取入口 HTML")
            .to_vec(),
    )
    .expect("入口 HTML 应是 UTF-8");

    let css_path =
        提取静态资源路径(&root_html, "<link rel=\"stylesheet\" href=\"", "\"").expect("应引用 CSS");
    let js_path =
        提取静态资源路径(&root_html, "<script type=\"module\" src=\"", "\"").expect("应引用 JS");
    assert!(
        css_path.starts_with("/dist/app-") && css_path.ends_with(".css"),
        "CSS 应使用 hashed 文件名，实际为 {css_path}"
    );
    assert!(
        js_path.starts_with("/dist/app-") && js_path.ends_with(".js"),
        "JS 应使用 hashed 文件名，实际为 {js_path}"
    );

    for uri in [css_path, js_path] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "{uri} 应可读取");
        let cache_control = response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .expect("静态资源必须显式返回 Cache-Control");
        assert_eq!(
            cache_control, "public, max-age=31536000, immutable",
            "{uri} 应走长期强缓存"
        );
    }
}

#[tokio::test]
#[serial]
async fn media_service_worker会同源暴露且显式声明根scope() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/media-sw.js")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK, "/media-sw.js 应可读取");
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-cache"),
        "service worker 脚本必须始终回源确认最新版本"
    );
    assert_eq!(
        response
            .headers()
            .get("service-worker-allowed")
            .and_then(|value| value.to_str().ok()),
        Some("/"),
        "service worker 必须显式声明根 scope，后续 WebTorrent stream server 才能共用同源 worker"
    );
}

#[tokio::test]
#[serial]
async fn 非成员不能读取房间消息里的图片内容() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RC{:010}", uniq % 10_000_000_000);

    let (_, owner_bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("owner-image-read-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner_bootstrap["session_id"]
        .as_str()
        .expect("owner session");

    let (_, stranger_bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("stranger-image-read-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger_bootstrap["session_id"]
        .as_str()
        .expect("stranger session");

    let (_, room_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": room_code})),
        &[],
    )
    .await;
    let room_id = room_body["room_id"].as_str().expect("room_id").to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": owner_session_id,
            "file_name": "owner.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-owner-image-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &state.tus_upload_dir,
        &attachment_id,
        "owner.png",
        &最小png字节(),
    )
    .expect("应能写入 tus 原图文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "owner.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);
    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": owner_session_id
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK);
    assert_eq!(complete_body["status"].as_str(), Some("ready"));

    let database_url = cfg.database_url.clone();
    let owner_session_id_owned = owner_session_id.to_string();
    let attachment_id_for_message = attachment_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &owner_session_id_owned,
            &format!("read-content-client-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带图片附件的消息");
    })
    .await
    .expect("阻塞发送任务应完成");

    let request = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "/api/attachments/{}/content?session_id={}&variant=original",
            attachment_id, stranger_session_id
        ))
        .body(Body::empty())
        .expect("request");
    let response = app.oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let body = serde_json::from_slice::<Value>(&bytes).expect("json body");

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}
