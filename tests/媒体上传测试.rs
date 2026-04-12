use axum::http::{Method, StatusCode};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};

#[path = "测试支撑/mod.rs"]
mod test_support;

#[path = "媒体上传测试/公网地址推导.rs"]
mod public_endpoint_tests;
#[path = "媒体上传测试/rustus_hook.rs"]
mod rustus_hook_tests;

use test_support::{env_support::*, http::*, media::*};

/// 媒体上传测试：
/// 1. 顶层只守 prepare / complete 的上传主链与旧入口回归。
/// 2. Rustus hook 和公网地址推导拆到子模块，避免热点再次堆在单文件。
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

    let transport_row = sqlx::query(
        "SELECT transport_kind, upload_token, byte_size \
         FROM attachment_upload_transports WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("prepare 后应同时写入运输授权记录");
    let transport_kind: String = transport_row.get("transport_kind");
    let upload_token: String = transport_row.get("upload_token");
    let transport_byte_size: Option<i64> = transport_row.get("byte_size");
    assert_eq!(transport_kind, "tus");
    assert!(
        !upload_token.trim().is_empty(),
        "运输授权记录必须保存非空 upload_token"
    );
    assert_eq!(transport_byte_size, Some(68));
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
    let rustus_data_dir = state.rustus_data_dir.clone();
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "complete.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 原图文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "complete.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["width"].as_i64(), Some(1));
    assert_eq!(complete_body["height"].as_i64(), Some(1));

    let row = sqlx::query(
        "SELECT status, width, height, thumbnail_storage_key FROM attachments WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的附件记录");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1));
    assert_eq!(height_in_db, Some(1));
    assert!(thumbnail_storage_key.is_some());
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
        app,
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
    let rustus_data_dir = state.rustus_data_dir.clone();
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "complete-race.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 临时图片文件");
    let upload_id = format!("upload-complete-race-{attachment_id}");

    // 真实浏览器里，Uppy 会在最终 PATCH 204 后立刻触发 upload-success，
    // 但 Rustus 的 post-finish 回执可能稍后才打到主服务。
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
            "/internal/rustus/hooks",
            Some(构造rustus_hook请求体(
                &upload_id_for_hook,
                &attachment_id_for_hook,
                "complete-race.png",
                "image/png",
                68,
                68,
                Some(temp_file_for_hook.as_str()),
            )),
            &[
                ("Hook-Name", "post-finish"),
                ("Authorization", authorization_for_hook.as_str()),
            ],
        )
        .await
    });

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
    let (hook_status, hook_body) = hook_task.await.expect("hook task 应该完成");

    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "post-finish 晚到时 complete 不该把内部竞态暴露成 attachment_not_ready: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
}

#[tokio::test]
#[serial]
async fn complete视频上传会把prepared附件升级成ready并写入视频元数据() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let rustus_data_dir = state.rustus_data_dir.clone();
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "complete.mp4",
        &video_bytes,
    )
    .expect("应能写入 rustus 临时视频文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "complete.mp4",
            "video/mp4",
            video_byte_size,
            video_byte_size,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["kind"].as_str(), Some("video"));
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

    let row = sqlx::query(
        "SELECT kind, status, width, height, thumbnail_storage_key FROM attachments WHERE attachment_id = $1",
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
    assert_eq!(kind_in_db, "video");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1080));
    assert_eq!(height_in_db, Some(1920));
    assert!(
        thumbnail_storage_key.is_none(),
        "当前视频主链不应伪造图片缩略图存储键"
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
    let temp_file = 写入rustus测试文件(
        &state.rustus_data_dir,
        &attachment_id,
        "broken.png",
        invalid_bytes,
    )
    .expect("应能写入 rustus 非法图片文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "broken.png",
            "image/png",
            invalid_bytes.len() as i64,
            invalid_bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
