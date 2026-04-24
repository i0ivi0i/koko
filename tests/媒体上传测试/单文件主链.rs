use super::*;
use axum::{extract::State as AxumState, routing::post, Json as AxumJson, Router};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, task::JoinHandle};

struct 媒体complete测试环境 {
    app: Router,
    tus_upload_dir: String,
    database_url: String,
    session_id: String,
}

struct 已登记上传回执 {
    attachment_id: String,
}

type 假SeederStart请求记录 = Arc<Mutex<Vec<serde_json::Value>>>;

async fn 启动假seeder侧车() -> (String, 假SeederStart请求记录, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 seeder 端口");
    let address = listener.local_addr().expect("应能读取假的 seeder 地址");
    let requests: 假SeederStart请求记录 = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/seed/start", post(记录假seeder_start请求))
        .route("/seed/reconcile", post(返回假seeder_reconcile成功))
        .with_state(requests.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 seeder 侧车应能启动");
    });
    (format!("http://{address}"), requests, server)
}

async fn 记录假seeder_start请求(
    AxumState(requests): AxumState<假SeederStart请求记录>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    requests
        .lock()
        .expect("seeder 请求记录锁不应中毒")
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true
        })),
    )
}

async fn 返回假seeder_reconcile成功(
    AxumJson(_payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "activeCount": 0
        })),
    )
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
    assert!(
        media_asset.get("preview").is_none(),
        "旧 preview 变体必须退场"
    );
    assert!(media_asset.get("full").is_none(), "旧 full 变体必须退场");
    assert!(
        media_asset.get("original").is_none(),
        "旧 original 变体必须退场"
    );

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
    assert!(
        storage_key.starts_with("media-assets/") && storage_key.ends_with("/canonical.webp"),
        "图片 canonical 应落到内容寻址资产键，当前为 {storage_key}"
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
    assert!(
        storage_key.starts_with("media-assets/") && storage_key.ends_with("/canonical.mp4"),
        "视频 canonical 应落到内容寻址资产键，当前为 {storage_key}"
    );
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

#[tokio::test]
#[serial]
async fn 视频complete在iso5_brand_mp4输入下不应返回500() {
    let env = 准备complete测试环境("single-file-video-iso5-brand").await;
    let video_bytes = iso5品牌mp4字节();
    let 已登记上传回执 { attachment_id } =
        准备并登记上传回执(&env, "video", "canonical.mp4", "video/mp4", &video_bytes).await;

    let (complete_status, complete_body) = 完成媒体上传(&env, &attachment_id).await;
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "iso5 品牌 mp4 是线上真实输入，complete 不应误报 500: {complete_body:?}"
    );
}

#[tokio::test]
#[serial]
async fn 视频complete会触发seeder_start命令() {
    let (fake_seeder_base_url, seeder_requests, fake_seeder_server) = 启动假seeder侧车().await;
    let backup = 备份并清空环境变量(&[
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_SEEDER_TRACKER_URL",
    ]);
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://im.example.com/api/swarm/announce",
    );
    env::set_var("SWARM_SEEDER_TRACKER_URL", "ws://127.0.0.1:17072");

    let env = 准备complete测试环境("single-file-video-seeder-start").await;
    let video_bytes = 最小mp4字节();
    let 已登记上传回执 { attachment_id } =
        准备并登记上传回执(&env, "video", "canonical.mp4", "video/mp4", &video_bytes).await;
    let (complete_status, complete_body) = 完成媒体上传(&env, &attachment_id).await;

    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    let requests = seeder_requests
        .lock()
        .expect("seeder 请求记录锁不应中毒")
        .clone();
    assert_eq!(
        requests.len(),
        1,
        "complete 成功后应至少触发一次 seeder start"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&env.database_url)
        .await
        .expect("应能连接数据库读取分发元信息");
    let persisted_info_hash: Option<String> = sqlx::query_scalar(
        "SELECT torrent_info_hash
         FROM attachment_distribution_metadata
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能读取权威 torrent_info_hash");
    pool.close().await;

    let start_payload = &requests[0];
    assert_eq!(
        start_payload["infoHash"].as_str(),
        persisted_info_hash.as_deref(),
        "sidecar start 的 infoHash 必须与权威库里的 torrent_info_hash 一致"
    );
    assert!(
        start_payload["announceUrls"]
            .as_array()
            .map(|values| !values.is_empty())
            .unwrap_or(false),
        "sidecar start 必须携带 announceUrls，避免 tracker 入群线索丢失"
    );
    assert_eq!(
        start_payload["announceUrls"]
            .as_array()
            .and_then(|values| values.first())
            .and_then(|value| value.as_str()),
        Some("ws://127.0.0.1:17072"),
        "sidecar start 必须使用私有 tracker announce，禁止复用浏览器 public WSS announce"
    );
    assert!(
        start_payload["torrentUrl"]
            .as_str()
            .map(|value| value.starts_with("http://") || value.starts_with("https://"))
            .unwrap_or(false),
        "sidecar start 的 torrentUrl 必须是绝对 URL，不能继续给相对路径触发 Invalid torrent identifier"
    );
    assert!(
        start_payload["webSeedUrl"]
            .as_str()
            .map(|value| value.starts_with("http://") || value.starts_with("https://"))
            .unwrap_or(false),
        "sidecar start 的 webSeedUrl 必须是绝对 URL，避免 sidecar 解析相对路径时漂移"
    );
    assert!(
        start_payload.get("joinTicket").is_some(),
        "start payload 至少应保留 joinTicket 字段（可为空），避免控制面命名漂移"
    );

    fake_seeder_server.abort();
    恢复环境变量(backup);
}
