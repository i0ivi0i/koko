use axum::{
    extract::{Path as AxumPath, State as AxumState},
    http::{header, HeaderMap, Method, StatusCode},
    routing::delete,
    Router,
};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    env,
    sync::{Arc, Mutex},
};
use tokio::time::{sleep, Duration};
use tokio::{net::TcpListener, task::JoinHandle};

#[path = "测试支撑/mod.rs"]
mod test_support;

#[path = "媒体上传测试/公网地址推导.rs"]
mod public_endpoint_tests;
#[path = "媒体上传测试/tus_hook.rs"]
mod tus_hook_tests;

use test_support::{env_support::*, http::*, media::*};

type 假TusTermination请求记录 = Arc<Mutex<Vec<(String, String, String)>>>;

/// 这里只起一个最小 fake tus sidecar termination 端点：
/// 1. 只记录后端到底有没有发官方 DELETE；
/// 2. 不替业务层做任何判断；
/// 3. 这样 abandon 测试就能直接看见“协调了什么 transport 事实”。
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

/// 媒体上传测试：
/// 1. 顶层只守 prepare / complete 的上传主链与旧入口回归。
/// 2. Tus hook 和公网地址推导拆到子模块，避免热点再次堆在单文件。
/// 3. 不负责消息成立、房间历史恢复、协作分发 locator/torrent 等后续业务语义。
#[tokio::test]
#[serial]
async fn 旧图片上传路由已移除() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("legacy-upload-route-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    // 这条回归测试专门锁住“旧 multipart 入口必须彻底消失”。
    // 只要旧链还活着，这里就不会返回 404，后续删除 route 时才有安全网。
    let response = send_multipart_response(
        app,
        "/api/attachments/image",
        session_id,
        "a.png",
        "image/png",
        &最小png字节(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传会返回Tus契约() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-image-{uniq}")})),
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
            "file_name": "prepared.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    断言媒体准备结果是Tus契约(&body, "image", "prepared.png", "image/png", 68);
    let attachment_id = body["attachment_id"].as_str().expect("attachment_id");
    let upload_session_id = body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let status_in_db = sqlx::query_scalar::<_, Option<String>>(
        "SELECT status FROM attachments WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询附件状态")
    .expect("prepare 后应存在 prepared 附件记录");
    assert_eq!(status_in_db, "prepared");

    let current_upload_session_in_db = sqlx::query_scalar::<_, Option<String>>(
        "SELECT current_upload_session_id FROM attachments WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("prepare 后应能读出当前上传会话");
    assert_eq!(
        current_upload_session_in_db.as_deref(),
        Some(upload_session_id),
        "prepare 必须把当前 attachment 锚到同一条 upload_session 真相上"
    );

    let session_row = sqlx::query(
        "SELECT transport_kind, upload_token \
         FROM attachment_upload_sessions WHERE upload_session_id = $1",
    )
    .bind(upload_session_id)
    .fetch_one(&pool)
    .await
    .expect("prepare 后应同时写入上传会话授权记录");
    let transport_kind: String = session_row.get("transport_kind");
    let upload_token: String = session_row.get("upload_token");
    assert_eq!(transport_kind, "tus");
    assert!(
        !upload_token.trim().is_empty(),
        "上传会话授权记录必须保存非空 upload_token"
    );
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare视频上传会拒绝超过200mb的请求并允许200mb边界值() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-video-200mb-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (ok_status, _) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "edge.mp4",
            "mime_type": "video/mp4",
            "byte_size": 200 * 1024 * 1024
        })),
        &[],
    )
    .await;
    assert_eq!(ok_status, StatusCode::OK);

    let (too_large_status, too_large_body) = send_json(
        app,
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "too-large.mp4",
            "mime_type": "video/mp4",
            "byte_size": 200 * 1024 * 1024 + 1
        })),
        &[],
    )
    .await;
    assert_eq!(too_large_status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        too_large_body["code"].as_str(),
        Some("attachment_too_large")
    );
}

#[tokio::test]
#[serial]
async fn complete图片上传会把prepared附件升级成ready并写入缩略图() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-image-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "complete.png",
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

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-complete-image-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "complete.png",
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
            "complete.png",
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
            "session_id": session_id
        })),
        &[],
    )
    .await;

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["width"].as_i64(), Some(1));
    assert_eq!(complete_body["height"].as_i64(), Some(1));
    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("图片 complete 后必须返回共享 blob media_asset");
    let preview_url = media_asset["preview"]["url"]
        .as_str()
        .expect("图片 complete 后必须返回 preview 主链");
    let full_url = media_asset["full"]["url"]
        .as_str()
        .expect("图片 complete 后必须返回 full 主链");
    let original_url = media_asset["original"]["url"]
        .as_str()
        .expect("图片 complete 后必须返回 original 主链");
    let legacy_original_url = format!(
        "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=original"
    );
    // 图片资产面一旦成立，preview/full/original 都必须切到稳定的 media asset 路由，
    // 这样前端才能改吃 asset-first 主链，而不是继续把旧附件内容地址当正式真相。
    assert_eq!(media_asset["kind"].as_str(), Some("blob_image"));
    assert_eq!(
        preview_url,
        format!("/api/media/{attachment_id}/blob/preview?session_id={session_id}")
    );
    assert_eq!(
        full_url,
        format!("/api/media/{attachment_id}/blob/full?session_id={session_id}")
    );
    assert_eq!(
        original_url,
        format!("/api/media/{attachment_id}/blob/original?session_id={session_id}")
    );
    assert_ne!(
        full_url, original_url,
        "full 和 original 至少要有稳定可区分的资产地址，不能继续共用一条旧 original_url"
    );
    assert!(
        !full_url.contains("/api/attachments/") && !original_url.contains("/api/attachments/"),
        "图片正式资产主链不能继续暴露旧附件内容直链"
    );
    assert_eq!(
        media_asset["origin"]["original_url"].as_str(),
        Some(legacy_original_url.as_str()),
        "旧附件内容地址只能退到冷备 origin 描述里，不能继续当 full/original 主链"
    );

    let row = sqlx::query(
        "SELECT status,
                width,
                height,
                thumbnail_storage_key,
                full_storage_key,
                asset_original_storage_key,
                EXTRACT(EPOCH FROM origin_expires_at)::BIGINT AS origin_expires_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的附件记录");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let full_storage_key: Option<String> = row.get("full_storage_key");
    let asset_original_storage_key: Option<String> = row.get("asset_original_storage_key");
    let origin_expires_at_epoch: Option<i64> = row.get("origin_expires_at_epoch");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1));
    assert_eq!(height_in_db, Some(1));
    assert!(thumbnail_storage_key.is_some());
    assert_eq!(
        full_storage_key.as_deref(),
        Some(format!("images/{attachment_id}/full.webp").as_str()),
        "图片 ready 真相必须把 full 资产键落库，不能继续只剩 thumbnail/original 两层"
    );
    assert_eq!(
        asset_original_storage_key.as_deref(),
        Some(format!("images/{attachment_id}/asset-original.png").as_str()),
        "图片 ready 真相必须把长期保留的资产原图键落库，不能继续只拿原始冷源凑数"
    );
    assert!(
        origin_expires_at_epoch.is_some(),
        "原始冷源必须在 complete 时写入明确到期时间，后续 24 小时清理才能有权威锚点"
    );

    let (full_status, full_headers, full_body) =
        send_bytes(app.clone(), Method::GET, full_url, &[]).await;
    let (original_status, original_headers, original_body) =
        send_bytes(app, Method::GET, original_url, &[]).await;
    assert_eq!(full_status, StatusCode::OK);
    assert_eq!(original_status, StatusCode::OK);
    assert_eq!(
        full_headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("image/webp"),
        "full 资产现在应返回真实完整图 MIME，而不是继续冒充原图类型"
    );
    assert_eq!(
        original_headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("image/png")
    );
    assert_ne!(
        full_body, original_body,
        "blob/full 和 blob/original 必须读取不同对象，不能继续都走同一份原始冷源字节"
    );
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare图片和视频都会返回统一Tus契约() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (image_status, image_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "prepare.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(image_status, StatusCode::OK);

    let (video_status, video_body) = send_json(
        app,
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "prepare.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
        })),
        &[],
    )
    .await;
    assert_eq!(video_status, StatusCode::OK);

    断言媒体准备结果是Tus契约(&image_body, "image", "prepare.png", "image/png", 68);
    断言媒体准备结果是Tus契约(
        &video_body,
        "video",
        "prepare.mp4",
        "video/mp4",
        最小mp4字节().len() as i64,
    );
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-abandon-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon.png",
        &source_bytes,
    )
    .expect("应能写入 tus 临时图片文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "abandon.png",
            "image/png",
            source_bytes.len() as i64,
            source_bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-abandon-termination-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon-termination.png",
        &source_bytes,
    )
    .expect("应能写入 tus 临时图片文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "abandon-termination.png",
            "image/png",
            source_bytes.len() as i64,
            source_bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

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

    let partial_one = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon-partials-1.part",
        &source_bytes[..(source_bytes.len() / 2)],
    )
    .expect("应能写入 partial-1 测试文件");
    let partial_two = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "abandon-partials-2.part",
        &source_bytes[(source_bytes.len() / 2)..],
    )
    .expect("应能写入 partial-2 测试文件");

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

#[tokio::test]
#[serial]
async fn 没有上传回执时complete媒体上传会返回attachment_not_ready() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-without-receipt-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "missing-receipt.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");

    // complete 不允许把“prepare 成功”误读成“上传完成”；
    // 没有运输层回执时，prepared 附件必须继续被拒绝。
    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;

    assert_eq!(complete_status, StatusCode::CONFLICT);
    assert_eq!(complete_body["code"].as_str(), Some("attachment_not_ready"));
}

#[tokio::test]
#[serial]
async fn complete在只有partial没有final时会返回attachment_not_ready() {
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
        Some(
            serde_json::json!({"device_anonymous_token": format!("complete-partial-only-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let video_bytes = 最小mp4字节();
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "partial-only.mp4",
            "mime_type": "video/mp4",
            "byte_size": video_bytes.len()
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
    let partial_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "partial-only.part",
        &video_bytes[..(video_bytes.len() / 2)],
    )
    .expect("应能写入 partial 视频文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("partial-only-{attachment_id}-1"),
            &attachment_id,
            &upload_session_id,
            "partial-only.mp4",
            "video/mp4",
            (video_bytes.len() / 2) as i64,
            (video_bytes.len() / 2) as i64,
            Some(partial_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::CONFLICT, "{complete_body:?}");
    assert_eq!(complete_body["code"].as_str(), Some("attachment_not_ready"));
}

#[tokio::test]
#[serial]
async fn complete会优先消费当前会话的final回执而不是single回执() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-final-preferred-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "final-preferred.png",
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
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let wrong_single_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "final-preferred-single.bin",
        b"not-an-image",
    )
    .expect("应能写入 single 假文件");
    let final_png_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "final-preferred-final.png",
        &最小png字节(),
    )
    .expect("应能写入 final png 文件");

    let (single_hook_status, single_hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("single-{attachment_id}"),
            &attachment_id,
            "final-preferred.png",
            "image/png",
            68,
            68,
            Some(wrong_single_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(single_hook_status, &single_hook_body);

    let (final_hook_status, final_hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("final-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "final-preferred.png",
            "image/png",
            68,
            68,
            Some(final_png_file.as_str()),
            false,
            true,
            Some(vec![
                "http://127.0.0.1:7070/files/part-1",
                "http://127.0.0.1:7070/files/part-2",
            ]),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(final_hook_status, &final_hook_body);

    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;

    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
}

#[tokio::test]
#[serial]
async fn post_finish稍后到达时complete媒体上传会等待回执并成功() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-race-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "complete-race.png",
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
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "complete-race.png",
        &最小png字节(),
    )
    .expect("应能写入 tus 临时图片文件");
    let upload_id = format!("upload-complete-race-{attachment_id}");

    // 真实浏览器里，Uppy 会在最终 PATCH 204 后立刻触发 upload-success，
    // 但 Tus sidecar 的 post-finish 回执可能稍后才打到主服务。
    // 这里故意让 complete 先发起，再延迟 50ms 才送 post-finish，锁住这条竞态。
    let app_for_hook = app.clone();
    let attachment_id_for_hook = attachment_id.clone();
    let authorization_for_hook = authorization.clone();
    let upload_id_for_hook = upload_id.clone();
    let temp_file_for_hook = temp_file.clone();
    let hook_task = tokio::spawn(async move {
        sleep(Duration::from_millis(50)).await;
        send_json(
            app_for_hook,
            Method::POST,
            "/internal/tus/hooks",
            Some(构造tus_hook请求体(
                "post-finish",
                Some(authorization_for_hook.as_str()),
                &upload_id_for_hook,
                &attachment_id_for_hook,
                "complete-race.png",
                "image/png",
                68,
                68,
                Some(temp_file_for_hook.as_str()),
            )),
            &[],
        )
        .await
    });

    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    let (hook_status, hook_body) = hook_task.await.expect("hook task 应该完成");

    断言TusHook已接受(hook_status, &hook_body);
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "post-finish 晚到时 complete 不该把内部竞态暴露成 attachment_not_ready: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
}

#[tokio::test]
#[serial]
async fn complete视频上传会写入静态封面并返回preview_asset() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-video-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let video_bytes = 最小mp4字节();
    let video_byte_size = video_bytes.len() as i64;
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "complete.mp4",
            "mime_type": "video/mp4",
            "byte_size": video_bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-complete-video-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "complete.mp4",
        &video_bytes,
    )
    .expect("应能写入 tus 临时视频文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "complete.mp4",
            "video/mp4",
            video_byte_size,
            video_byte_size,
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
            "session_id": session_id
        })),
        &[],
    )
    .await;

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["kind"].as_str(), Some("video"));
    assert_eq!(
        complete_body["media_asset"]["kind"].as_str(),
        Some("streaming_video"),
        "视频 complete 后应返回流媒体资产过渡面，而不是只剩原始附件字段"
    );
    assert_eq!(
        complete_body["media_asset"]["asset_id"].as_str(),
        Some(attachment_id.as_str()),
        "当前过渡阶段先以 attachment_id 作为稳定资产锚点，避免再造第二个临时主键"
    );
    assert_eq!(
        complete_body["preview_asset"]["still_url"].as_str(),
        Some(
            format!(
                "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=thumbnail"
            )
            .as_str()
        ),
        "视频 complete 后必须直接把静态封面真相投影出来，不能再让消息流自己脑补首帧"
    );
    let hls_master_url = complete_body["media_asset"]["manifest"]["hls_master_url"]
        .as_str()
        .expect("视频 complete 后必须返回 HLS 主清单入口");
    let dash_mpd_url = complete_body["media_asset"]["manifest"]["dash_mpd_url"]
        .as_str()
        .expect("视频 complete 后必须返回 DASH 主清单入口");
    assert!(
        hls_master_url.contains("/api/media/") && hls_master_url.contains("session_id="),
        "HLS 主清单必须走受控媒体路由，而不是裸对象地址"
    );
    assert!(
        dash_mpd_url.contains("/api/media/") && dash_mpd_url.contains("session_id="),
        "DASH 主清单也必须走受控媒体路由"
    );
    assert_eq!(
        complete_body["media_asset"]["origin"]["role"].as_str(),
        Some("cold_backup_only"),
        "原始附件在协议里只能退到冷备引导角色"
    );
    assert_eq!(
        complete_body["media_asset"]["origin"]["available"].as_bool(),
        Some(true),
        "视频 complete 后应切到 24 小时 mezzanine 回退层，协议面仍要把 original 描述成可用冷备入口"
    );
    let original_url = complete_body["media_asset"]["origin"]["original_url"]
        .as_str()
        .expect("即使视频主链已经切到流媒体分发，仍必须保留稳定的冷备 original 描述");
    assert!(complete_body["media_asset"]["distribution"]["swarm_id"].is_string());
    assert!(
        complete_body["media_asset"]["distribution"]["announce_urls"].is_array(),
        "即使真正的流媒体主链还没切完，过渡资产面也必须提前暴露稳定 swarm 线索"
    );
    assert_eq!(
        complete_body["width"].as_i64(),
        Some(1080),
        "竖拍 MP4 complete 后必须写入展示宽度，而不是编码宽度"
    );
    assert_eq!(
        complete_body["height"].as_i64(),
        Some(1920),
        "竖拍 MP4 complete 后必须写入展示高度，而不是编码高度"
    );

    let (master_status, master_headers, master_bytes) =
        send_bytes(app.clone(), Method::GET, hls_master_url, &[]).await;
    assert_eq!(master_status, StatusCode::OK);
    assert_eq!(
        master_headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/vnd.apple.mpegurl")
    );
    let master_text = String::from_utf8(master_bytes).expect("HLS master 应是 UTF-8 文本");
    assert!(
        master_text.contains("/api/media/")
            && master_text.contains("session_id=")
            && master_text.contains("video/main.m3u8"),
        "master playlist 必须把子播放列表重写成受控 URL"
    );
    // master playlist 里可能同时出现 `#EXT-X-MEDIA:...URI="..."` 和真正的子播放列表 URL。
    // 这里必须只抓非注释行，否则会把整条标签行误当成请求地址，掩盖真正的清单重写问题。
    let child_url = master_text
        .lines()
        .find(|line| !line.trim_start().starts_with('#') && line.contains("/api/media/"))
        .expect("master playlist 应包含受控子播放列表 URL")
        .trim()
        .to_string();

    let (child_status, _, child_bytes) =
        send_bytes(app.clone(), Method::GET, child_url.as_str(), &[]).await;
    assert_eq!(child_status, StatusCode::OK);
    let child_text = String::from_utf8(child_bytes).expect("HLS media playlist 应是 UTF-8 文本");
    assert!(
        child_text.contains("init.mp4?session_id=") && child_text.contains(".m4s?session_id="),
        "媒体子清单必须把 init 段和 media 段都重写成带 session_id 的受控 URL"
    );
    let segment_url = child_text
        .lines()
        .find(|line| line.contains(".m4s?session_id="))
        .expect("子清单应至少包含一条受控 media segment URL")
        .trim()
        .to_string();

    let (original_status, original_headers, original_bytes) =
        send_bytes(app.clone(), Method::GET, original_url, &[]).await;
    assert_eq!(
        original_status,
        StatusCode::OK,
        "视频 complete 后，original_url 应该回退到 mezzanine，而不是继续 404"
    );
    assert_eq!(
        original_headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("video/mp4"),
        "mezzanine 回退层应继续暴露稳定的 MP4 内容类型"
    );
    assert!(
        !original_bytes.is_empty(),
        "mezzanine 回退层必须真的能读到字节，不能只回一个空壳 200"
    );
    let (segment_status, segment_headers, segment_bytes) =
        send_bytes(app.clone(), Method::GET, segment_url.as_str(), &[]).await;
    assert_eq!(segment_status, StatusCode::OK);
    assert_eq!(
        segment_headers
            .get("accept-ranges")
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    assert!(
        !segment_bytes.is_empty(),
        "媒体 segment 必须能通过受控流媒体路由读取到真实字节"
    );
    let (dash_status, dash_headers, dash_bytes) =
        send_bytes(app.clone(), Method::GET, dash_mpd_url, &[]).await;
    assert_eq!(dash_status, StatusCode::OK);
    assert_eq!(
        dash_headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/dash+xml")
    );
    let dash_text = String::from_utf8(dash_bytes).expect("MPD 应是 UTF-8 文本");
    assert!(
        dash_text.contains("/api/media/") && dash_text.contains("session_id="),
        "MPD 里的 initialization/media 模板也必须被重写成受控 URL"
    );

    let row = sqlx::query(
        "SELECT kind,
                status,
                width,
                height,
                thumbnail_storage_key,
                storage_key,
                mezzanine_storage_key,
                EXTRACT(EPOCH FROM mezzanine_expires_at)::BIGINT AS mezzanine_expires_at_epoch,
                EXTRACT(EPOCH FROM origin_deleted_at)::BIGINT AS origin_deleted_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的视频附件记录");
    let kind_in_db: String = row.get("kind");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let storage_key: String = row.get("storage_key");
    let mezzanine_storage_key: Option<String> = row.get("mezzanine_storage_key");
    let mezzanine_expires_at_epoch: Option<i64> = row.get("mezzanine_expires_at_epoch");
    let origin_deleted_at_epoch: Option<i64> = row.get("origin_deleted_at_epoch");
    assert_eq!(kind_in_db, "video");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1080));
    assert_eq!(height_in_db, Some(1920));
    assert!(
        thumbnail_storage_key.is_some(),
        "视频 complete 后必须把静态封面落到既有 thumbnail_storage_key，而不是继续留空"
    );
    assert_eq!(
        mezzanine_storage_key.as_deref(),
        Some(storage_key.as_str()),
        "视频附件的 storage_key 应直接收口到 mezzanine，避免 original 读取链再认已经秒删的原片"
    );
    assert!(
        storage_key.contains("/mezzanine.")
            || storage_key.contains("\\mezzanine.")
            || storage_key.ends_with("mezzanine.mp4"),
        "视频 mezzanine 应落到明确可读的稳定对象键，而不是继续复用语义含混的 original 键"
    );
    assert!(
        mezzanine_expires_at_epoch.is_some(),
        "视频 complete 后必须写入 24 小时 mezzanine 回退窗口"
    );
    assert!(
        origin_deleted_at_epoch.is_some(),
        "用户原片上传成功后应立即从临时冷源退场，并回写 origin_deleted_at 事实"
    );
    assert!(
        !std::path::Path::new(temp_file.as_str()).exists(),
        "视频 complete 成功后应立即删掉 Tus 临时原片，避免源文件在服务器上继续滞留"
    );
}

#[tokio::test]
#[serial]
async fn complete图片上传遇到非图片原图会返回attachment_type_not_allowed() {
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

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("complete-invalid-image-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let invalid_bytes = b"not an image";

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "broken.png",
            "mime_type": "image/png",
            "byte_size": invalid_bytes.len()
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
    let upload_id = format!("upload-invalid-image-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &state.tus_upload_dir,
        &attachment_id,
        "broken.png",
        invalid_bytes,
    )
    .expect("应能写入 tus 非法图片文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "broken.png",
            "image/png",
            invalid_bytes.len() as i64,
            invalid_bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    // complete 必须以真实字节内容为准，不能信 prepare 阶段宣称的图片 MIME。
    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;

    assert_eq!(complete_status, StatusCode::BAD_REQUEST);
    assert_eq!(
        complete_body["code"].as_str(),
        Some("attachment_type_not_allowed")
    );
}
