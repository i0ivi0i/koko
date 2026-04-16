use super::*;

/// 上传残留清理 owner：
/// 这里只验证后台维护逻辑如何处理已结束 / 已过期 / 历史异常 locator 的上传残留。
/// 它不负责上传 prepare/complete 主链，也不负责协作分发读侧契约。
#[tokio::test]
#[serial]
async fn 后台会清理final完成后遗留的partial临时文件() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("cleanup-finalized-partials-{uniq}")})),
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
            "file_name": "cleanup-finalized.png",
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

    let partial_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-finalized.part",
        &[1, 2, 3, 4],
    )
    .expect("应能写入 partial 文件");
    let final_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-finalized.png",
        &最小png字节(),
    )
    .expect("应能写入 final 文件");

    let (partial_status, partial_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("cleanup-partial-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-finalized.png",
            "image/png",
            34,
            34,
            Some(partial_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(partial_status, &partial_body);

    let (final_status, final_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("cleanup-final-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-finalized.png",
            "image/png",
            68,
            68,
            Some(final_file.as_str()),
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
    断言TusHook已接受(final_status, &final_body);

    koko::shell::执行一次媒体上传残留清理(state.clone())
        .await
        .expect("应能执行一次上传残留清理");

    assert!(
        !std::path::Path::new(partial_file.as_str()).exists(),
        "final 已经落成后，后台应清掉 partial 临时文件，避免分片残留越积越多"
    );
    assert!(
        std::path::Path::new(final_file.as_str()).exists(),
        "final 临时文件仍然要留给 complete 主链消费，不能被后台残留清理误删"
    );
}

#[tokio::test]
#[serial]
async fn 后台会清理过期unfinished上传并把附件标成expired() {
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
            serde_json::json!({"device_anonymous_token": format!("cleanup-expired-upload-{uniq}")}),
        ),
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
            "file_name": "cleanup-expired.mp4",
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
    let partial_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-expired.part",
        &source_bytes[..(source_bytes.len() / 2)],
    )
    .expect("应能写入 expired partial 文件");

    let (partial_status, partial_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("expired-partial-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-expired.mp4",
            "video/mp4",
            (source_bytes.len() / 2) as i64,
            (source_bytes.len() / 2) as i64,
            Some(partial_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(partial_status, &partial_body);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    sqlx::query(
        "UPDATE attachment_upload_sessions
         SET token_expires_at = NOW() - INTERVAL '1 second'
         WHERE upload_session_id = $1",
    )
    .bind(&upload_session_id)
    .execute(&pool)
    .await
    .expect("测试需要先把 upload token 标成过期");

    koko::shell::执行一次媒体上传残留清理(state.clone())
        .await
        .expect("应能执行一次上传残留清理");

    let row = sqlx::query(
        "SELECT status, current_upload_session_id
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询过期清理后的附件状态");
    let status: String = row.get("status");
    let current_upload_session_id: Option<String> = row.get("current_upload_session_id");
    assert_eq!(status, "expired");
    assert!(
        current_upload_session_id.is_none(),
        "后台认定 unfinished upload 已过期后，attachment 不应继续挂着旧 upload_session 真相"
    );
    assert!(
        !std::path::Path::new(partial_file.as_str()).exists(),
        "过期 unfinished upload 的临时文件必须被后台删除，不能永远卡在 tus upload dir 里"
    );
}

#[tokio::test]
#[serial]
async fn 后台会收口历史rustus残留locator而不再让清理卡住() {
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
            serde_json::json!({"device_anonymous_token": format!("cleanup-legacy-rustus-{uniq}")}),
        ),
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
            "file_name": "cleanup-legacy-rustus.mp4",
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
    let partial_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-legacy-rustus.part",
        &source_bytes[..(source_bytes.len() / 2)],
    )
    .expect("应能写入当前 tus upload dir 内的 partial 文件");

    let (partial_status, partial_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("legacy-rustus-partial-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-legacy-rustus.mp4",
            "video/mp4",
            (source_bytes.len() / 2) as i64,
            (source_bytes.len() / 2) as i64,
            Some(partial_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(partial_status, &partial_body);

    let legacy_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("rustus")
        .join("tests");
    std::fs::create_dir_all(&legacy_dir).expect("应能创建历史 rustus 测试目录");
    let legacy_file = legacy_dir.join(format!("{attachment_id}-legacy-rustus.part"));
    std::fs::write(&legacy_file, &source_bytes[..32]).expect("应能写入历史 rustus 残留文件");
    let legacy_locator = std::fs::canonicalize(&legacy_file)
        .expect("应能 canonicalize 历史 rustus 残留文件")
        .to_string_lossy()
        .to_string();

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    sqlx::query(
        "UPDATE attachment_upload_transports
         SET storage_locator = $2
         WHERE upload_session_id = $1",
    )
    .bind(&upload_session_id)
    .bind(&legacy_locator)
    .execute(&pool)
    .await
    .expect("测试需要把 transport locator 改成历史 rustus 路径");
    sqlx::query(
        "UPDATE attachment_upload_sessions
         SET token_expires_at = NOW() - INTERVAL '1 second'
         WHERE upload_session_id = $1",
    )
    .bind(&upload_session_id)
    .execute(&pool)
    .await
    .expect("测试需要先把 upload token 标成过期");

    koko::shell::执行一次媒体上传残留清理(state.clone())
        .await
        .expect("历史 rustus locator 不应让上传残留清理整体失败");

    let transport_locator_after = sqlx::query_scalar::<_, Option<String>>(
        "SELECT storage_locator
         FROM attachment_upload_transports
         WHERE upload_session_id = $1",
    )
    .bind(&upload_session_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询历史 rustus locator 清理后的 transport");
    assert!(
        transport_locator_after.is_none(),
        "历史 rustus locator 已经不再属于当前 tus upload dir 时，也应被收口成 NULL，避免每次启动都重复报错"
    );
    assert!(
        legacy_file.exists(),
        "清理器不应越权删除当前 tus upload dir 之外的历史文件；这里只需要收口数据库真相并停止噪音"
    );

    let row = sqlx::query(
        "SELECT status, current_upload_session_id
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询历史 rustus locator 清理后的附件状态");
    let status: String = row.get("status");
    let current_upload_session_id: Option<String> = row.get("current_upload_session_id");
    assert_eq!(status, "expired");
    assert!(current_upload_session_id.is_none());

    std::fs::remove_file(&legacy_file).expect("测试结束后应能清掉临时制造的历史 rustus 残留文件");
}
