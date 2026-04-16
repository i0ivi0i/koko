use super::*;

/// prepare 测试只守上传主链最前半段：
/// 1. 旧入口必须真正退场，避免历史 multipart 路由继续偷活；
/// 2. image/video prepare 必须都收口到统一 Tus 契约；
/// 3. prepare 阶段写下的 upload_session / prepared 附件事实必须可追踪。
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
