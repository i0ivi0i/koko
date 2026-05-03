use super::*;

use axum::{
    extract::{Path as AxumPath, State as AxumState},
    http::HeaderMap,
    routing::delete,
    Router,
};
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, task::JoinHandle};

type 假TusTermination请求记录 = Arc<Mutex<Vec<(String, String, String)>>>;

/// abandon 测试只守“显式放弃上传”这条业务真相：
/// 1. attachment / transport 都要一起进入 abandoned；
/// 2. 当前上传会话遗留的 partial/final 临时文件都要清掉；
/// 3. 只有这一组测试需要观察是否协调了官方 termination。
async fn 启动假tus_termination侧车() -> (String, 假TusTermination请求记录, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 tus termination 端口");
    let address = listener
        .local_addr()
        .expect("应能读取假的 tus termination 地址");
    let requests: 假TusTermination请求记录 = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/files/{upload_id}", delete(记录假tus_termination请求))
        .with_state(requests.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 tus termination 侧车应能启动");
    });
    (format!("http://{address}"), requests, server)
}

async fn 记录假tus_termination请求(
    AxumState(requests): AxumState<假TusTermination请求记录>,
    AxumPath(upload_id): AxumPath<String>,
    headers: HeaderMap,
) -> StatusCode {
    let guard = headers
        .get("X-Koko-Internal-Termination")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let tus_resumable = headers
        .get("Tus-Resumable")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    requests
        .lock()
        .expect("termination 请求记录锁不应中毒")
        .push((upload_id, guard, tus_resumable));
    StatusCode::NO_CONTENT
}

#[tokio::test]
#[serial]
async fn 放弃媒体上传会同时标记附件与transport为abandoned并清掉已登记的临时文件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let tus_upload_dir = state.tus_upload_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("abandon-upload-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();

    let source_bytes = 最小png字节();
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "abandon.png",
            "mime_type": "image/png",
            "byte_size": source_bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let upload = super::upload_slice_support::登记最终上传回执(
        app.clone(),
        &tus_upload_dir,
        &prepare_body,
        "upload-abandon-",
        "abandon.png",
        "image/png",
        &source_bytes,
    )
    .await;
    let temp_file = upload.temp_file;

    let (abandon_status, abandon_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/abandon"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(
        abandon_status,
        StatusCode::OK,
        "abandon_body={abandon_body}"
    );
    assert_eq!(
        abandon_body["attachment_id"].as_str(),
        Some(attachment_id.as_str())
    );
    assert_eq!(abandon_body["status"].as_str(), Some("abandoned"));

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT status,
                EXTRACT(EPOCH FROM abandoned_at)::BIGINT AS attachment_abandoned_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询附件废弃状态");
    let status: String = row.get("status");
    let attachment_abandoned_at_epoch: Option<i64> = row.get("attachment_abandoned_at_epoch");
    assert_eq!(status, "abandoned");
    assert!(
        attachment_abandoned_at_epoch.is_some(),
        "旧附件一旦被 restart 显式放弃，业务真相里必须留下 abandoned_at"
    );
    let transport_row = sqlx::query(
        "SELECT EXTRACT(EPOCH FROM abandoned_at)::BIGINT AS transport_abandoned_at_epoch
         FROM attachment_upload_transports
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 transport 废弃状态");
    let transport_abandoned_at_epoch: Option<i64> =
        transport_row.get("transport_abandoned_at_epoch");
    assert!(
        transport_abandoned_at_epoch.is_some(),
        "旧 upload 对应的 transport 也必须一起废弃，post-finish/complete 才不会复活它"
    );
    pool.close().await;

    assert!(
        !std::path::Path::new(temp_file.as_str()).exists(),
        "后端明确 abandon 且已知道 storage_locator 时，必须顺手清掉临时文件，避免服务器越积越多废弃上传"
    );
}

#[tokio::test]
#[serial]
async fn abandon会先写业务abandoned再协调官方termination() {
    let (fake_tus_base_url, termination_requests, fake_tus_server) =
        启动假tus_termination侧车().await;
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_INTERNAL_BASE_URL",
        "MEDIA_TUS_INTERNAL_TERMINATION_TOKEN",
    ]);
    env::set_var("MEDIA_TUS_INTERNAL_BASE_URL", fake_tus_base_url.as_str());
    env::set_var(
        "MEDIA_TUS_INTERNAL_TERMINATION_TOKEN",
        "test-internal-termination-token",
    );

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let tus_upload_dir = state.tus_upload_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("abandon-termination-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let source_bytes = 最小png字节();
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "abandon-termination.png",
            "mime_type": "image/png",
            "byte_size": source_bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let upload = super::upload_slice_support::登记最终上传回执(
        app.clone(),
        &tus_upload_dir,
        &prepare_body,
        "upload-abandon-termination-",
        "abandon-termination.png",
        "image/png",
        &source_bytes,
    )
    .await;
    let upload_id = upload.upload_id;

    let (abandon_status, abandon_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/abandon"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(abandon_status, StatusCode::OK, "{abandon_body:?}");

    let requests = termination_requests
        .lock()
        .expect("termination 请求记录锁不应中毒")
        .clone();
    assert_eq!(requests.len(), 1, "abandon 应至少协调一次官方 DELETE");
    assert_eq!(requests[0].0, upload_id);
    assert_eq!(requests[0].1, "test-internal-termination-token");
    assert_eq!(requests[0].2, "1.0.0");

    fake_tus_server.abort();
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
async fn 放弃媒体上传会清掉当前会话下所有partial临时文件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let tus_upload_dir = state.tus_upload_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("abandon-partials-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let source_bytes = 最小mp4字节();
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "abandon-partials.mp4",
            "mime_type": "video/mp4",
            "byte_size": source_bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);

    let partial_one = super::upload_slice_support::写入上传临时文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon-partials-1.part",
        &source_bytes[..(source_bytes.len() / 2)],
    );
    let partial_two = super::upload_slice_support::写入上传临时文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon-partials-2.part",
        &source_bytes[(source_bytes.len() / 2)..],
    );

    for (upload_id, path) in [
        (
            format!("partial-abandon-{attachment_id}-1"),
            partial_one.as_str(),
        ),
        (
            format!("partial-abandon-{attachment_id}-2"),
            partial_two.as_str(),
        ),
    ] {
        let (hook_status, hook_body) = send_json(
            app.clone(),
            Method::POST,
            "/internal/tus/hooks",
            Some(构造tus_concatenation_hook请求体(
                "post-finish",
                Some(authorization.as_str()),
                &upload_id,
                &attachment_id,
                &upload_session_id,
                "abandon-partials.mp4",
                "video/mp4",
                (source_bytes.len() / 2) as i64,
                (source_bytes.len() / 2) as i64,
                Some(path),
                true,
                false,
                None,
            )),
            &[],
        )
        .await;
        断言TusHook已接受(hook_status, &hook_body);
    }

    let (abandon_status, abandon_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/abandon"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(abandon_status, StatusCode::OK, "{abandon_body:?}");
    assert!(
        !std::path::Path::new(partial_one.as_str()).exists(),
        "显式 abandon 当前上传会话时，partial-1 临时文件也必须一起清掉"
    );
    assert!(
        !std::path::Path::new(partial_two.as_str()).exists(),
        "显式 abandon 当前上传会话时，partial-2 临时文件也必须一起清掉"
    );
}
