use super::*;

/// complete 测试只守上传主链后半段：
/// 1. prepared 附件何时能升级成 ready；
/// 2. post-finish / final / single 回执竞争时谁是真正权威；
/// 3. 图片与视频 complete 后投影给壳层的资产面是否稳定。
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
    assert!(media_asset["preview"].is_null());
    assert!(media_asset["full"].is_null());
    assert!(media_asset["original"].is_null());
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
    let storage_key: String = row.get("storage_key");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let full_storage_key: Option<String> = row.get("full_storage_key");
    let asset_original_storage_key: Option<String> = row.get("asset_original_storage_key");
    let origin_expires_at_epoch: Option<i64> = row.get("origin_expires_at_epoch");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1));
    assert_eq!(height_in_db, Some(1));
    assert_eq!(
        storage_key,
        format!("images/{attachment_id}/canonical.webp")
    );
    assert!(thumbnail_storage_key.is_none());
    assert!(full_storage_key.is_none());
    assert!(asset_original_storage_key.is_none());
    assert!(
        origin_expires_at_epoch.is_some(),
        "原始冷源必须在 complete 时写入明确到期时间，后续 24 小时清理才能有权威锚点"
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

#[tokio::test]
#[serial]
async fn complete视频上传会写入canonical并返回file_asset() {
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
    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("视频 complete 后必须返回单文件 media_asset");
    assert_eq!(
        media_asset["kind"].as_str(),
        Some("file_video"),
        "客户端已经预制 canonical.mp4 后，后端不再生成 HLS/DASH 流媒体资产"
    );
    assert_eq!(
        media_asset["asset_id"].as_str(),
        Some(attachment_id.as_str()),
        "单文件视频仍以 attachment_id 作为稳定资产锚点，避免再造第二个临时主键"
    );
    let canonical_url = media_asset["variants"]["canonical"]["url"]
        .as_str()
        .expect("视频 complete 后必须返回 canonical 单文件读取入口");
    assert_eq!(
        canonical_url,
        format!(
            "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=original"
        ),
        "canonical 视频读取入口必须收口到既有受控附件内容路由，不能再下发裸对象地址"
    );
    assert!(complete_body["preview_asset"].is_null());
    assert!(media_asset["manifest"].is_null());
    assert!(
        media_asset["lifecycle"].is_null(),
        "新视频主链没有服务端流媒体窗口，生命周期只能由 origin 冷备窗口表达"
    );
    assert_eq!(
        media_asset["origin"]["role"].as_str(),
        Some("cold_backup_only"),
        "canonical 单文件在协议面仍只作为冷备和 web seed 引导，不回到服务端重加工主链"
    );
    assert_eq!(
        media_asset["origin"]["available"].as_bool(),
        Some(true),
        "视频 complete 后应保留 24 小时受控 canonical 冷备窗口，给弱网和冷启动兜底"
    );
    let original_url = media_asset["origin"]["original_url"]
        .as_str()
        .expect("单文件视频必须保留稳定冷备 original 描述，供 web seed 和 Range 读取复用");
    assert_eq!(original_url, canonical_url);
    assert!(media_asset["distribution"]["swarm_id"].is_string());
    assert!(
        media_asset["distribution"]["announce_urls"].is_array(),
        "单文件主链仍必须暴露稳定 swarm 线索，后端只做轻量引导"
    );
    assert_eq!(
        media_asset["distribution"]["survival_mode"].as_str(),
        Some("peer_only_after_expiry"),
        "视频分发表面必须明确表达：24 小时窗口结束后，只剩 peer 平面继续承担长期存活"
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

    let (canonical_status, canonical_headers, canonical_bytes) =
        send_bytes(app.clone(), Method::GET, canonical_url, &[]).await;
    assert_eq!(canonical_status, StatusCode::OK);
    assert_eq!(
        canonical_headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("video/mp4"),
        "canonical 单文件读取应继续暴露稳定 MP4 内容类型"
    );
    assert_eq!(
        canonical_headers
            .get(header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    assert_eq!(canonical_bytes, video_bytes);

    let (range_status, range_headers, range_bytes) = send_bytes(
        app.clone(),
        Method::GET,
        canonical_url,
        &[("range", "bytes=0-15")],
    )
    .await;
    assert_eq!(range_status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        range_headers
            .get(header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    assert_eq!(
        range_headers
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok()),
        Some(format!("bytes 0-15/{}", video_bytes.len()).as_str())
    );
    assert_eq!(range_bytes, video_bytes[..16]);

    let row = sqlx::query(
        "SELECT kind,
                status,
                width,
                height,
                thumbnail_storage_key,
                storage_key,
                mezzanine_storage_key,
                EXTRACT(EPOCH FROM origin_expires_at)::BIGINT AS origin_expires_at_epoch,
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
    let origin_expires_at_epoch: Option<i64> = row.get("origin_expires_at_epoch");
    let origin_deleted_at_epoch: Option<i64> = row.get("origin_deleted_at_epoch");
    assert_eq!(kind_in_db, "video");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1080));
    assert_eq!(height_in_db, Some(1920));
    assert!(
        thumbnail_storage_key.is_none(),
        "后端不再为视频抽取静态封面，避免把上传热路径重新压回服务器"
    );
    assert_eq!(
        storage_key,
        format!("videos/{attachment_id}/canonical.mp4"),
        "视频附件只保留客户端预制后的 canonical 单文件"
    );
    assert!(
        mezzanine_storage_key.is_none(),
        "后端不再生成 mezzanine 回退母本"
    );
    assert!(
        origin_expires_at_epoch.is_some(),
        "视频 complete 后必须写入 24 小时 canonical 冷备窗口，供清理任务按权威时间退场"
    );
    assert!(
        origin_deleted_at_epoch.is_none(),
        "刚 complete 完的 canonical 冷备还在 24 小时窗口内，不能提前伪造已删除事实"
    );
    let manifest_exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1::BIGINT
         FROM attachment_streaming_manifests
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_optional(&pool)
    .await
    .expect("应能查询视频流媒体清单记录");
    assert!(
        manifest_exists.is_none(),
        "新视频附件不再写 HLS/DASH 清单记录"
    );
    assert!(
        !std::path::Path::new(temp_file.as_str()).exists(),
        "视频 complete 成功后应立即删掉 Tus 临时 canonical，避免临时目录继续滞留同一份文件"
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
