use super::*;

#[tokio::test]
#[serial]
async fn tus_post_finish会登记上传回执() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("tus-post-finish-{uniq}")})),
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
            "file_name": "hook.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let _attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");
    let upload = super::upload_slice_support::登记最终上传回执_使用声明字节数(
        app.clone(),
        &tus_upload_dir,
        &prepare_body,
        "upload-post-finish-",
        "hook.png",
        "image/png",
        &最小png字节(),
        68,
    )
    .await;
    let expected_upload_id = upload.upload_id;
    let temp_file = upload.temp_file;

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT transport_upload_id, storage_locator, byte_size, finished_at IS NOT NULL AS is_finished \
         FROM attachment_upload_transports WHERE upload_session_id = $1",
    )
    .bind(upload_session_id)
    .fetch_one(&pool)
    .await
    .expect("post-finish 后应存在运输回执");
    let upload_id: Option<String> = row.get("transport_upload_id");
    let storage_locator: Option<String> = row.get("storage_locator");
    let byte_size: Option<i64> = row.get("byte_size");
    let is_finished: bool = row.get("is_finished");
    assert_eq!(upload_id.as_deref(), Some(expected_upload_id.as_str()));
    assert_eq!(storage_locator.as_deref(), Some(temp_file.as_str()));
    assert_eq!(byte_size, Some(68));
    assert!(is_finished, "post-finish 必须把 finished 回执落库");
}
#[tokio::test]
#[serial]
async fn tus_post_finish_partial只登记partial_transport() {
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
        Some(serde_json::json!({ "device_anonymous_token": format!("tus-post-finish-partial-{uniq}") })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "partial-only.mp4",
            "mime_type": "video/mp4",
            "byte_size": 96
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        attachment_id,
        "partial-only.part",
        &[1, 2, 3, 4],
    )
    .expect("应能写入 partial 测试文件");

    let (status, body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("partial-upload-{attachment_id}-1"),
            attachment_id,
            upload_session_id,
            "partial-only.mp4",
            "video/mp4",
            48,
            48,
            Some(temp_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(status, &body);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let partial_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT
         FROM attachment_upload_transports
         WHERE upload_session_id = $1
           AND transport_role = 'partial'",
    )
    .bind(upload_session_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 partial transport 记录");
    let final_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT
         FROM attachment_upload_transports
         WHERE upload_session_id = $1
           AND transport_role = 'final'",
    )
    .bind(upload_session_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 final transport 记录");
    assert_eq!(partial_count, 1);
    assert_eq!(final_count, 0);
}
#[tokio::test]
#[serial]
async fn tus_post_finish不会复活已废弃的旧上传() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("tus-post-finish-abandoned-{uniq}")})),
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
            "file_name": "abandoned.png",
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
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let expected_upload_id = format!("upload-post-finish-abandoned-{attachment_id}");
    let temp_file = super::upload_slice_support::写入上传临时文件(
        &tus_upload_dir,
        attachment_id,
        "abandoned.png",
        &最小png字节(),
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    sqlx::query(
        "UPDATE attachment_upload_sessions SET abandoned_at = NOW() WHERE upload_session_id = $1",
    )
    .bind(upload_session_id)
    .execute(&pool)
    .await
    .expect("测试需要先把旧 upload session 标成 abandoned");
    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &expected_upload_id,
            attachment_id,
            "abandoned.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;

    断言TusHook已接受(status, &body);
    let transport_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT
         FROM attachment_upload_transports
         WHERE upload_session_id = $1
           AND transport_upload_id = $2",
    )
    .bind(upload_session_id)
    .bind(expected_upload_id.as_str())
    .fetch_one(&pool)
    .await
    .expect("已废弃 upload session 不应写入新的 finished transport");
    assert_eq!(transport_count, 0);
}
#[tokio::test]
#[serial]
async fn tus_pre_terminate缺少内部守卫头会被拒绝() {
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
        Method::POST,
        "/internal/tus/hooks",
        Some(serde_json::json!({
            "Type": "pre-terminate",
            "Event": {
                "Upload": {
                    "ID": "upload-pre-terminate-1",
                    "Size": 68,
                    "SizeIsDeferred": false,
                    "Offset": 68,
                    "MetaData": {
                        "attachment_id": "att-pre-terminate-1"
                    },
                    "IsPartial": false,
                    "IsFinal": false,
                    "PartialUploads": serde_json::Value::Null,
                    "Storage": serde_json::Value::Null
                },
                "HTTPRequest": {
                    "Method": "DELETE",
                    "URI": "/files/upload-pre-terminate-1",
                    "Header": {}
                }
            }
        })),
        &[],
    )
    .await;

    断言TusHook拒绝Termination(
        status,
        &body,
        StatusCode::UNAUTHORIZED,
        "attachment_upload_unauthorized",
    );
}
#[tokio::test]
#[serial]
async fn tus_post_terminate不会单独推进业务状态() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-post-terminate-{uniq}")
        })),
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
            "file_name": "post-terminate.png",
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

    let (status, body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(serde_json::json!({
            "Type": "post-terminate",
            "Event": {
                "Upload": {
                    "ID": format!("upload-post-terminate-{attachment_id}"),
                    "Size": 68,
                    "SizeIsDeferred": false,
                    "Offset": 68,
                    "MetaData": {
                        "attachment_id": attachment_id,
                        "upload_session_id": prepare_body["upload_session_id"].as_str().expect("upload_session_id"),
                        "file_name": "post-terminate.png",
                        "mime_type": "image/png",
                        "byte_size": "68"
                    },
                    "IsPartial": false,
                    "IsFinal": false,
                    "PartialUploads": serde_json::Value::Null,
                    "Storage": serde_json::Value::Null
                },
                "HTTPRequest": {
                    "Method": "DELETE",
                    "URI": "/files/upload-post-terminate",
                    "Header": {
                        "X-Koko-Internal-Termination": ["test-guard"]
                    }
                }
            }
        })),
        &[],
    )
    .await;
    断言TusHook已接受(status, &body);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let status_in_db = sqlx::query_scalar::<_, Option<String>>(
        "SELECT status FROM attachments WHERE attachment_id = $1",
    )
    .bind(
        prepare_body["attachment_id"]
            .as_str()
            .expect("attachment_id"),
    )
    .fetch_one(&pool)
    .await
    .expect("应能查询附件状态")
    .expect("prepare 后应存在附件记录");
    assert_eq!(status_in_db, "prepared");
}
