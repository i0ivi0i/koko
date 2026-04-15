use serde_json::Value;
use sqlx::PgPool;
use std::io;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// prepare 返回的 Tus headers 当前只要求一条稳定 Authorization。
/// 测试统一从这里拿，避免每个用例各自硬编码字段路径。
pub fn 提取媒体上传授权头(body: &Value) -> String {
    body["tus_headers"]["Authorization"]
        .as_str()
        .expect("Tus prepare 必须返回 Authorization 头")
        .to_string()
}

/// Rustus file storage 在测试里直接共享本地目录，因此 fixture 也应写进同一个 data dir。
/// 这样 complete 读到的就是真正 sidecar 会交回来的临时文件，而不是测试私造的第二套输入源。
pub fn 写入rustus测试文件(
    rustus_data_dir: &str,
    attachment_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> io::Result<String> {
    let root = PathBuf::from(rustus_data_dir);
    let fixture_dir = root.join("tests");
    std::fs::create_dir_all(&fixture_dir)?;
    let path = fixture_dir.join(format!("{attachment_id}-{file_name}"));
    std::fs::write(&path, bytes)?;
    Ok(std::fs::canonicalize(path)?.to_string_lossy().to_string())
}

/// 这里构造的是我们当前 shell 关心的最小 Rustus hook 负载：
/// - upload.id/path/length/offset 只表达“当前 hook 所处的运输状态”；
/// - metadata 继续把 attachment_id 作为业务锚点传回来；
/// - 其余字段即便 Rustus 实际会发，也不应该成为我们判断业务真相的依赖。
pub fn 构造rustus_hook请求体(
    upload_id: &str,
    attachment_id: &str,
    file_name: &str,
    mime_type: &str,
    length: i64,
    offset: i64,
    storage_locator: Option<&str>,
) -> Value {
    serde_json::json!({
        "upload": {
            "id": upload_id,
            "offset": offset,
            "length": length,
            "path": storage_locator,
            "metadata": {
                "attachment_id": attachment_id,
                "file_name": file_name,
                "mime_type": mime_type,
                "byte_size": length.to_string(),
            }
        }
    })
}

/// 统一校验媒体 prepare 的 Tus 契约，避免图片/视频在迁移过程中各自漂移出第二套字段约定。
/// 这里同时锁住“必须给出 Tus 所需元数据”和“旧 PUT 字段必须下线”两个边界。
#[allow(non_snake_case)]
pub fn 断言媒体准备结果是Tus契约(
    body: &Value,
    expected_kind: &str,
    expected_file_name: &str,
    expected_mime_type: &str,
    expected_byte_size: i64,
) {
    let attachment_id = body["attachment_id"]
        .as_str()
        .expect("统一媒体 prepare 至少要返回稳定 attachment_id");
    let upload_session_id = body["upload_session_id"]
        .as_str()
        .expect("统一媒体 prepare 必须返回 upload_session_id");
    assert_eq!(body["kind"].as_str(), Some(expected_kind));
    assert_eq!(body["upload_method"].as_str(), Some("tus"));
    assert!(
        body["tus_endpoint"].as_str().is_some(),
        "媒体 prepare 必须返回 Tus endpoint"
    );
    assert!(
        body["tus_headers"].is_object(),
        "媒体 prepare 必须返回 Tus 头集合"
    );
    assert!(
        body["tus_metadata"].is_object(),
        "媒体 prepare 必须返回 Tus metadata"
    );
    assert!(
        body["expires_at"].as_str().is_some(),
        "媒体 prepare 必须返回过期时间"
    );
    assert!(
        body["upload_url"].is_null(),
        "切到 Tus 后不应继续暴露旧 upload_url"
    );
    assert!(
        body["upload_headers"].is_null(),
        "切到 Tus 后不应继续暴露旧 upload_headers"
    );

    let tus_metadata = body["tus_metadata"]
        .as_object()
        .expect("tus_metadata 必须是对象");
    assert_eq!(
        tus_metadata.get("attachment_id").and_then(Value::as_str),
        Some(attachment_id)
    );
    assert_eq!(
        tus_metadata
            .get("upload_session_id")
            .and_then(Value::as_str),
        Some(upload_session_id)
    );
    assert_eq!(
        tus_metadata.get("file_name").and_then(Value::as_str),
        Some(expected_file_name)
    );
    assert_eq!(
        tus_metadata.get("mime_type").and_then(Value::as_str),
        Some(expected_mime_type)
    );
    assert_eq!(
        tus_metadata.get("byte_size").and_then(|value| value
            .as_i64()
            .or_else(|| value.as_str()?.parse::<i64>().ok())),
        Some(expected_byte_size)
    );
}

/// 直接往数据库写入一条 ready 图片附件真相。
/// 这个 helper 只服务集成测试建数，避免为了某个房间/消息场景倒逼上传 HTTP 主链参与。
/// 说明：随着图片资产协议收口，测试建数也要跟着落三层资产键和原始冷源到期时间，
/// 避免 locator/查看器测试继续吃“只有 original + thumbnail 两列”的过期夹具。
pub async fn 插入ready图片附件记录(pool: &PgPool, 会话标识: &str, 附件标识: &str) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

    sqlx::query(
        "INSERT INTO attachments (
            attachment_id,
            owner_anonymous_identity_id,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            thumbnail_storage_key,
            asset_original_storage_key,
            full_storage_key,
            origin_expires_at,
            status
         ) VALUES (
            $1, $2, 'image', 'image/png', 68, 1, 1, $3, $4, $5, $6, TO_TIMESTAMP($7), 'ready'
         )",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(format!("original/{附件标识}.png"))
    .bind(format!("thumbnail/{附件标识}.png"))
    .bind(format!("asset-original/{附件标识}.png"))
    .bind(format!("full/{附件标识}.webp"))
    .bind(未来冷源到期时间戳秒())
    .execute(pool)
    .await
    .expect("应能插入 ready 图片附件");
}

/// 图片冷源测试夹具必须用“当前时间之后”的 TTL。
/// 否则整套协作分发/清理回归一起跑时，会被后台清理逻辑误删，测试结果就会漂。
pub fn 未来冷源到期时间戳秒() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs() as i64
        + 24 * 60 * 60
}

/// 视频 ready helper 和图片 helper 保持同一层级：
/// - 它只负责给集成测试准备“附件真相已成立”的前置条件；
/// - 不替代真实上传链，也不把 HTTP/对象存储细节混进消息主链测试。
pub async fn 插入ready视频附件记录(pool: &PgPool, 会话标识: &str, 附件标识: &str) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

    sqlx::query(
        "INSERT INTO attachments (
            attachment_id,
            owner_anonymous_identity_id,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            thumbnail_storage_key,
            mezzanine_storage_key,
            mezzanine_expires_at,
            status
         ) VALUES (
            $1, $2, 'video', 'video/mp4', $3, 320, 240, $4, NULL, $4, TO_TIMESTAMP($5), 'ready'
         )",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(最小mp4字节().len() as i64)
    .bind(format!("videos/{附件标识}/mezzanine.mp4"))
    .bind(未来冷源到期时间戳秒())
    .execute(pool)
    .await
    .expect("应能插入 ready 视频附件");
}

/// Phase 1 先把协作分发元数据视作独立真相面，
/// 这里直接插入最小记录，专门服务 locator 回归测试。
pub async fn 插入附件协作分发元数据记录(pool: &PgPool, 附件标识: &str) {
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
            (attachment_id, content_id, content_hash, swarm_id, web_seed_until) \
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')",
    )
    .bind(附件标识)
    .bind(format!("content_{附件标识}"))
    .bind("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    .bind(format!(
        "swarm_{}",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ))
    .execute(pool)
    .await
    .expect("应能插入协作分发元数据");
}

/// 过渡完成后，ready 视频测试建数也要补齐正式 manifest 真相。
/// 这里先只插最小清单元数据，不替代真实打包链；真正的产物字节仍应由 complete 上传链回归测试覆盖。
pub async fn 插入流媒体清单元数据记录(pool: &PgPool, 附件标识: &str) {
    sqlx::query(
        "INSERT INTO attachment_streaming_manifests \
            (attachment_id, hls_master_storage_key, dash_mpd_storage_key) \
         VALUES ($1, $2, $3)",
    )
    .bind(附件标识)
    .bind(format!("streams/{附件标识}/hls/master.m3u8"))
    .bind(format!("streams/{附件标识}/dash/stream.mpd"))
    .execute(pool)
    .await
    .expect("应能插入流媒体清单元数据");
}

/// 最小 PNG fixture 继续内嵌在代码里，避免为了 1x1 图片样本再多维护一个独立文件。
pub fn 最小png字节() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8,
        0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00,
        0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]
}

/// 最小 MP4 样本来自上游公开测试夹具，避免我们在仓库里手搓一份脆弱的伪视频字节。
/// 后端视频 complete 与 locator 回归都统一复用这份 fixture，确保测试针对真实容器格式。
pub fn 最小mp4字节() -> Vec<u8> {
    include_bytes!("../fixtures/minimal.mp4").to_vec()
}
