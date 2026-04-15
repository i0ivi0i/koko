use super::*;

/// Rustus hook 测试：
/// 1. 这里只验证 hook 与上传运输真相之间的最小权威关系。
/// 2. pre-create / post-finish 的契约必须稳定，但不在这里验证消息成立或房间读取。
#[tokio::test]
#[serial]
async fn rustus_pre_create非法token会被拒绝() {
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
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            "upload-invalid-token",
            "att-invalid-token",
            "invalid.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", "Bearer not-a-real-token"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body["code"].as_str(),
        Some("attachment_upload_unauthorized")
    );
}

#[tokio::test]
#[serial]
async fn rustus_pre_create允许offset为0且length等于metadata_byte_size() {
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
            "device_anonymous_token": format!("rustus-pre-create-{uniq}")
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
            "file_name": "pre-create.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &format!("upload-pre-create-{attachment_id}"),
            attachment_id,
            "pre-create.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "{body:?}");
}

#[tokio::test]
#[serial]
async fn rustus_pre_create缺少byte_size元数据时仍按prepare权威长度放行() {
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
            "device_anonymous_token": format!("rustus-pre-create-metadata-{uniq}")
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
            "file_name": "pre-create-metadata.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let mut hook_body = 构造rustus_hook请求体(
        &format!("upload-pre-create-metadata-{attachment_id}"),
        attachment_id,
        "pre-create-metadata.png",
        "image/png",
        68,
        0,
        None,
    );
    /*
     * 真实 Rustus create-upload 场景里，hook 不保证把每个 metadata 键都稳定回显给主服务。
     * 这里故意只保留 attachment_id，锁住“pre-create 应依赖 prepare 权威长度，而不是重复 metadata.byte_size”。
     */
    hook_body["upload"]["metadata"] = serde_json::json!({
        "attachment_id": attachment_id
    });

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/rustus/hooks",
        Some(hook_body),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "{body:?}");
}

#[tokio::test]
#[serial]
async fn rustus_pre_create长度小于prepare整文件大小时会拒绝当前partial_upload语义() {
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
            "device_anonymous_token": format!("rustus-pre-create-partial-{uniq}")
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
            "file_name": "pre-create-partial.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);

    /*
     * 当前主链仍以“单附件 = 一条最终运输回执”为真相：
     * - pre-create 里的 length 必须就是 prepare 时登记的整文件大小；
     * - 这条测试专门防止前端再次偷偷打开 partial upload / concatenation，
     *   却忘了同时升级 Rustus hook 与 complete 契约。
     */
    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &format!("upload-pre-create-partial-{attachment_id}"),
            attachment_id,
            "pre-create-partial.png",
            "image/png",
            34,
            0,
            None,
        )),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?}");
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
    assert_eq!(
        body["message"].as_str(),
        Some("上传文件大小与 prepare 不一致")
    );
}

#[tokio::test]
#[serial]
async fn rustus_post_finish会登记上传回执() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("rustus-post-finish-{uniq}")})),
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
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let expected_upload_id = format!("upload-post-finish-{attachment_id}");
    let temp_file =
        写入rustus测试文件(&rustus_data_dir, attachment_id, "hook.png", &最小png字节())
            .expect("应能写入 rustus 测试文件");

    let (status, _) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &expected_upload_id,
            attachment_id,
            "hook.png",
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
    assert_eq!(status, StatusCode::NO_CONTENT);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT transport_upload_id, storage_locator, byte_size, finished_at IS NOT NULL AS is_finished \
         FROM attachment_upload_transports WHERE attachment_id = $1",
    )
    .bind(attachment_id)
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
async fn rustus_post_finish不会复活已废弃的旧上传() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("rustus-post-finish-abandoned-{uniq}")})),
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let expected_upload_id = format!("upload-post-finish-abandoned-{attachment_id}");
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        attachment_id,
        "abandoned.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 测试文件");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    sqlx::query(
        "UPDATE attachment_upload_transports SET abandoned_at = NOW() WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .execute(&pool)
    .await
    .expect("测试需要先把旧 transport 标成 abandoned");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &expected_upload_id,
            attachment_id,
            "abandoned.png",
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

    assert_eq!(status, StatusCode::CONFLICT, "{body:?}");
    assert_eq!(body["code"].as_str(), Some("attachment_not_ready"));
}
