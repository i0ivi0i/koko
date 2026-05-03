use super::*;

#[tokio::test]
#[serial]
async fn complete图片上传会把prepared附件升级成ready并写入canonical资产() {
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
    let image_bytes = 最小webp字节();
    let image_byte_size = image_bytes.len() as i64;
    let source_hash = "3333333333333333333333333333333333333333333333333333333333333333";
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
            "file_name": "canonical.webp",
            "mime_type": "image/webp",
            "byte_size": image_byte_size,
            "source_hash": source_hash,
            "source_byte_size": image_byte_size,
            "source_file_name": "canonical.webp"
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
        "canonical.webp",
        &image_bytes,
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
            "canonical.webp",
            "image/webp",
            image_byte_size,
            image_byte_size,
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
        "图片 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["width"].as_i64(), Some(1));
    assert_eq!(complete_body["height"].as_i64(), Some(1));
    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("图片 complete 后必须返回共享 blob media_asset");
    let canonical_url = media_asset["variants"]["canonical"]["url"]
        .as_str()
        .expect("图片 complete 后必须返回 canonical 主链");
    let legacy_original_url = format!(
        "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=original"
    );
    assert_eq!(media_asset["kind"].as_str(), Some("blob_image"));
    assert_eq!(
        canonical_url,
        format!("/api/media/{attachment_id}/blob/canonical?session_id={session_id}")
    );
    assert!(media_asset.get("preview").is_none());
    assert!(media_asset.get("full").is_none());
    assert!(media_asset.get("original").is_none());
    assert_eq!(
        media_asset["origin"]["original_url"].as_str(),
        Some(legacy_original_url.as_str()),
        "旧附件内容地址只能退到冷备 origin 描述里，不能继续当正式图片主链"
    );

    let row = sqlx::query(
        "SELECT status,
                width,
                height,
                storage_key,
                thumbnail_storage_key,
                full_storage_key,
                asset_original_storage_key,
                EXTRACT(EPOCH FROM a.origin_expires_at)::BIGINT AS origin_expires_at_epoch,
                EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch
         FROM attachments a
         LEFT JOIN attachment_distribution_metadata dm
           ON dm.attachment_id = a.attachment_id
         WHERE a.attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的附件记录");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let storage_key: String = row.get("storage_key");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let full_storage_key: Option<String> = row.get("full_storage_key");
    let asset_original_storage_key: Option<String> = row.get("asset_original_storage_key");
    let origin_expires_at_epoch: Option<i64> = row.get("origin_expires_at_epoch");
    let web_seed_until_epoch: Option<i64> = row.get("web_seed_until_epoch");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1));
    assert_eq!(height_in_db, Some(1));
    assert!(
        storage_key.starts_with("media-assets/") && storage_key.ends_with("/canonical.webp"),
        "图片 canonical 必须改为内容寻址资产键，当前为 {storage_key}"
    );
    assert!(thumbnail_storage_key.is_none());
    assert!(full_storage_key.is_none());
    assert!(asset_original_storage_key.is_none());
    assert!(
        origin_expires_at_epoch.is_some(),
        "原始冷源必须在 complete 时写入明确到期时间，后续 24 小时清理才能有权威锚点"
    );
    assert_eq!(
        web_seed_until_epoch,
        origin_expires_at_epoch,
        "图片 complete 写入的协作分发表窗口和原图冷备窗口必须先天一致，避免后续又长出两套服务器退场时间"
    );

    let asset_row = sqlx::query(
        "SELECT
            cma.content_hash,
            cma.storage_key,
            cma.torrent_info_hash,
            acar.content_hash AS ref_content_hash,
            ash.source_hash,
            ash.source_byte_size
         FROM attachment_canonical_asset_refs acar
         JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
         LEFT JOIN attachment_source_hashes ash ON ash.attachment_id = acar.attachment_id
         WHERE acar.attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("complete 后必须写入 canonical 资产与附件引用");
    let asset_hash: String = asset_row.get("content_hash");
    let ref_hash: String = asset_row.get("ref_content_hash");
    let asset_storage_key: String = asset_row.get("storage_key");
    let asset_torrent_info_hash: String = asset_row.get("torrent_info_hash");
    let recorded_source_hash: Option<String> = asset_row.get("source_hash");
    let recorded_source_byte_size: Option<i64> = asset_row.get("source_byte_size");
    assert_eq!(asset_hash, ref_hash);
    assert_eq!(asset_storage_key, storage_key);
    assert_eq!(recorded_source_hash.as_deref(), Some(source_hash));
    assert_eq!(recorded_source_byte_size, Some(image_byte_size));
    assert!(
        !asset_torrent_info_hash.trim().is_empty(),
        "canonical 资产必须持有可复用 torrent info hash"
    );

    let (canonical_status, canonical_headers, canonical_body) =
        send_bytes(app, Method::GET, canonical_url, &[]).await;
    assert_eq!(canonical_status, StatusCode::OK);
    assert_eq!(
        canonical_headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("image/webp")
    );
    assert_eq!(canonical_body, image_bytes);
    assert!(
        !std::path::Path::new(temp_file.as_str()).exists(),
        "图片 complete 成功后必须同步删掉 Tus 临时原图，不能把 happy path 残留丢给后台慢慢积灰"
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
    let image_bytes = 最小webp字节();
    let image_byte_size = image_bytes.len() as i64;
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
            "file_name": "canonical.webp",
            "mime_type": "image/webp",
            "byte_size": image_byte_size
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
    let final_webp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "final-preferred-final.webp",
        &image_bytes,
    )
    .expect("应能写入 final webp 文件");

    let (single_hook_status, single_hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("single-{attachment_id}"),
            &attachment_id,
            "canonical.webp",
            "image/webp",
            image_byte_size,
            image_byte_size,
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
            "canonical.webp",
            "image/webp",
            image_byte_size,
            image_byte_size,
            Some(final_webp_file.as_str()),
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
    let image_bytes = 最小webp字节();
    let image_byte_size = image_bytes.len() as i64;
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
            "file_name": "canonical.webp",
            "mime_type": "image/webp",
            "byte_size": image_byte_size
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
        "complete-race.webp",
        &image_bytes,
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
                "canonical.webp",
                "image/webp",
                image_byte_size,
                image_byte_size,
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
