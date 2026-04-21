use super::*;
use axum::Router;
use serde_json::Value;

struct 媒体complete测试环境 {
    app: Router,
    tus_upload_dir: String,
    database_url: String,
    session_id: String,
}

struct 已登记上传回执 {
    attachment_id: String,
}

async fn 准备complete测试环境(token_prefix: &str) -> 媒体complete测试环境 {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("{token_prefix}-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();

    媒体complete测试环境 {
        app,
        tus_upload_dir: state.tus_upload_dir.clone(),
        database_url: cfg.database_url,
        session_id,
    }
}

async fn 准备并登记上传回执(
    env: &媒体complete测试环境,
    kind: &str,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> 已登记上传回执 {
    let (prepare_status, prepare_body) = send_json(
        env.app.clone(),
        Method::POST,
        &format!("/api/media/{kind}/prepare"),
        Some(serde_json::json!({
            "session_id": env.session_id,
            "file_name": file_name,
            "mime_type": mime_type,
            "byte_size": bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK, "{prepare_body:?}");
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-single-file-{attachment_id}");
    let temp_file = 写入tus测试文件(&env.tus_upload_dir, &attachment_id, file_name, bytes)
        .expect("应能写入 tus 临时文件");
    let (hook_status, hook_body) = send_json(
        env.app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            file_name,
            mime_type,
            bytes.len() as i64,
            bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    已登记上传回执 { attachment_id }
}

async fn 完成媒体上传(
    env: &媒体complete测试环境,
    attachment_id: &str,
) -> (StatusCode, Value) {
    send_json(
        env.app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": env.session_id
        })),
        &[],
    )
    .await
}

#[tokio::test]
#[serial]
async fn 图片complete后只保留一份canonical对象() {
    let env = 准备complete测试环境("single-file-image").await;
    let 已登记上传回执 { attachment_id } = 准备并登记上传回执(
        &env,
        "image",
        "canonical.webp",
        "image/webp",
        &最小webp字节(),
    )
    .await;

    let (complete_status, complete_body) = 完成媒体上传(&env, &attachment_id).await;

    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("图片 complete 后必须返回 media_asset");
    assert_eq!(media_asset["kind"].as_str(), Some("blob_image"));
    let variants = media_asset["variants"]
        .as_object()
        .expect("图片资产必须只暴露 variants.canonical");
    assert!(variants["canonical"].is_object(), "{media_asset:?}");
    assert!(variants.get("preview").is_none() || variants["preview"].is_null());
    assert!(variants.get("full").is_none() || variants["full"].is_null());
    assert!(variants.get("original").is_none() || variants["original"].is_null());
    assert!(media_asset.get("preview").is_none(), "旧 preview 变体必须退场");
    assert!(media_asset.get("full").is_none(), "旧 full 变体必须退场");
    assert!(media_asset.get("original").is_none(), "旧 original 变体必须退场");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&env.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT storage_key, thumbnail_storage_key, full_storage_key, asset_original_storage_key
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询图片附件记录");
    let storage_key: String = row.get("storage_key");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let full_storage_key: Option<String> = row.get("full_storage_key");
    let asset_original_storage_key: Option<String> = row.get("asset_original_storage_key");
    assert_eq!(
        storage_key,
        format!("images/{attachment_id}/canonical.webp")
    );
    assert!(
        thumbnail_storage_key.is_none(),
        "后端不再写图片 preview 派生"
    );
    assert!(full_storage_key.is_none(), "后端不再写图片 full 派生");
    assert!(
        asset_original_storage_key.is_none(),
        "后端不再写图片 asset-original 派生"
    );
}

#[tokio::test]
#[serial]
async fn 视频complete后不再返回hls_dash_manifest() {
    let env = 准备complete测试环境("single-file-video").await;
    let video_bytes = 最小mp4字节();
    let 已登记上传回执 { attachment_id } =
        准备并登记上传回执(&env, "video", "canonical.mp4", "video/mp4", &video_bytes).await;

    let (complete_status, complete_body) = 完成媒体上传(&env, &attachment_id).await;

    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("视频 complete 后必须返回 media_asset");
    assert_eq!(media_asset["kind"].as_str(), Some("file_video"));
    assert!(
        complete_body["preview_asset"].is_null(),
        "新单文件视频 complete 后不再长期承诺 preview_asset；首屏预览改由客户端运行时自己派生"
    );
    assert!(
        media_asset["manifest"].is_null(),
        "新视频附件不再返回 HLS/DASH manifest"
    );
    assert!(
        media_asset["lifecycle"].is_null(),
        "新视频附件不再返回 streaming lifecycle"
    );
    let variants = media_asset["variants"]
        .as_object()
        .expect("视频资产必须只暴露 variants.canonical");
    assert!(variants["canonical"].is_object(), "{media_asset:?}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&env.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT storage_key, thumbnail_storage_key, mezzanine_storage_key
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询视频附件记录");
    let storage_key: String = row.get("storage_key");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    let mezzanine_storage_key: Option<String> = row.get("mezzanine_storage_key");
    assert_eq!(storage_key, format!("videos/{attachment_id}/canonical.mp4"));
    assert!(thumbnail_storage_key.is_none(), "后端不再抽取视频静态封面");
    assert!(
        mezzanine_storage_key.is_none(),
        "后端不再生成视频 mezzanine 回退母本"
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
}
