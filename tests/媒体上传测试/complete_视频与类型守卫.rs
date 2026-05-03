use super::*;

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
    assert!(
        media_asset
            .get("manifest")
            .map(|value| value.is_null())
            .unwrap_or(true),
        "新视频附件不再返回 HLS/DASH manifest；字段缺失和 null 都表示旧第二链路已退场"
    );
    assert!(
        media_asset
            .get("lifecycle")
            .map(|value| value.is_null())
            .unwrap_or(true),
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
                EXTRACT(EPOCH FROM a.origin_expires_at)::BIGINT AS origin_expires_at_epoch,
                EXTRACT(EPOCH FROM a.origin_deleted_at)::BIGINT AS origin_deleted_at_epoch,
                EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch
         FROM attachments a
         LEFT JOIN attachment_distribution_metadata dm
           ON dm.attachment_id = a.attachment_id
         WHERE a.attachment_id = $1",
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
    let web_seed_until_epoch: Option<i64> = row.get("web_seed_until_epoch");
    assert_eq!(kind_in_db, "video");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1080));
    assert_eq!(height_in_db, Some(1920));
    assert!(
        thumbnail_storage_key.is_none(),
        "后端不再为视频抽取静态封面，避免把上传热路径重新压回服务器"
    );
    assert!(
        storage_key.starts_with("media-assets/") && storage_key.ends_with("/canonical.mp4"),
        "视频 canonical 必须改为内容寻址资产键，当前为 {storage_key}"
    );
    assert!(
        mezzanine_storage_key.is_none(),
        "后端不再生成 mezzanine 回退母本"
    );
    assert!(
        origin_expires_at_epoch.is_some(),
        "视频 complete 后必须写入 24 小时 canonical 冷备窗口，供清理任务按权威时间退场"
    );
    assert_eq!(
        web_seed_until_epoch,
        origin_expires_at_epoch,
        "视频 complete 写入的协作分发表窗口和 canonical 冷备窗口必须先天一致，避免 locator 与原图端点以后再分裂"
    );
    assert!(
        origin_deleted_at_epoch.is_none(),
        "刚 complete 完的 canonical 冷备还在 24 小时窗口内，不能提前伪造已删除事实"
    );
    let asset_storage_key: String = sqlx::query_scalar(
        "SELECT cma.storage_key
         FROM attachment_canonical_asset_refs acar
         JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
         WHERE acar.attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("视频 complete 后必须写入 canonical 资产引用");
    assert_eq!(
        asset_storage_key, storage_key,
        "视频附件投影和 canonical 资产表必须指向同一内容寻址对象"
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
