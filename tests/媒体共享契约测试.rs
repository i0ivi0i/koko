use axum::http::{Method, StatusCode};
use serial_test::serial;
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{env_support::*, http::*, media::*};

// 共享契约测试要显式保留 prepare 与 hook 的协议输入，
// 否则很容易把“共享契约”和“测试装配细节”再混成新的万能 builder。
#[allow(clippy::too_many_arguments)]
async fn 完成共享媒体上传(
    app: axum::Router,
    tus_upload_dir: &str,
    session_id: &str,
    prepare_endpoint: &str,
    upload_id_prefix: &str,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> (String, serde_json::Value) {
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        prepare_endpoint,
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": file_name,
            "mime_type": mime_type,
            "byte_size": bytes.len()
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
    let temp_file = 写入tus测试文件(tus_upload_dir, &attachment_id, file_name, bytes)
        .expect("应能写入共享契约测试临时文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("{upload_id_prefix}{attachment_id}"),
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

    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({ "session_id": session_id })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    (attachment_id, complete_body)
}

fn 断言对象不包含壳层私货(
    object: &serde_json::Map<String, serde_json::Value>,
    上下文: &str,
) {
    for key in [
        "toast_text",
        "toastText",
        "drawer_open",
        "drawerOpen",
        "panelMode",
        "panel_mode",
        "viewmodel",
        "presenter",
    ] {
        assert!(
            !object.contains_key(key),
            "{上下文} 不能泄漏 Web 壳层字段 {key}"
        );
    }
}

#[tokio::test]
#[serial]
async fn 视频complete共享契约不包含_web_页面流程和展示文案字段() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let tus_upload_dir = state.tus_upload_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("shared-contract-video-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();

    let (_attachment_id, complete_body) = 完成共享媒体上传(
        app.clone(),
        &tus_upload_dir,
        session_id.as_str(),
        "/api/media/video/prepare",
        "upload-shared-contract-video-",
        "shared-contract-video.mp4",
        "video/mp4",
        &最小mp4字节(),
    )
    .await;

    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("complete 应返回共享 media_asset");
    let distribution = media_asset["distribution"]
        .as_object()
        .expect("单文件视频资产必须返回共享分发表面");
    let origin = media_asset["origin"]
        .as_object()
        .expect("单文件视频资产必须返回冷源描述");

    断言对象不包含壳层私货(media_asset, "video media_asset");
    断言对象不包含壳层私货(distribution, "video distribution");
    断言对象不包含壳层私货(origin, "video origin");
    assert_eq!(media_asset["kind"].as_str(), Some("file_video"));
    assert!(
        media_asset["variants"]["canonical"].is_null(),
        "纯 WebTorrent 主链下，单文件视频共享契约不再把 HTTP 内容地址包装成 canonical 正式变体"
    );
    assert!(
        media_asset
            .get("manifest")
            .map(serde_json::Value::is_null)
            .unwrap_or(true),
        "单文件视频不再暴露 HLS/DASH manifest"
    );
    assert!(
        media_asset
            .get("lifecycle")
            .map(serde_json::Value::is_null)
            .unwrap_or(true),
        "单文件视频不再暴露 streaming lifecycle"
    );
    assert!(
        distribution.get("presence_url").is_none(),
        "共享分发表面不能夹带 Web 页面 presence URL"
    );
}

#[tokio::test]
#[serial]
async fn 图片complete共享契约不包含_web_页面流程和展示文案字段() {
    let backup = 备份并清空环境变量(&["SWARM_TICKET_SECRET", "SWARM_TICKET_TTL_SECONDS"]);
    env::set_var("SWARM_TICKET_SECRET", "blob-shared-contract-ticket-secret");
    env::set_var("SWARM_TICKET_TTL_SECONDS", "180");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let tus_upload_dir = state.tus_upload_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("shared-contract-image-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let image_bytes = 最小webp字节();

    let (_attachment_id, complete_body) = 完成共享媒体上传(
        app,
        &tus_upload_dir,
        session_id.as_str(),
        "/api/media/image/prepare",
        "upload-shared-contract-image-",
        "canonical.webp",
        "image/webp",
        &image_bytes,
    )
    .await;
    恢复环境变量(backup);

    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("complete 应返回共享 media_asset");
    assert!(
        media_asset["variants"]["canonical"].is_null(),
        "新图片共享契约不应继续把 blob canonical 地址当正式主链暴露"
    );
    let distribution = media_asset["distribution"]
        .as_object()
        .expect("Blob 资产必须返回共享分发表面");
    let origin = media_asset["origin"]
        .as_object()
        .expect("Blob 资产必须返回冷源描述");

    // 共享 contract 既不能混入 Web presenter 私货，也不能继续把旧附件内容地址当正式 blob 主链。
    assert!(
        media_asset.get("preview").is_none(),
        "Blob 共享契约不再保留旧 preview 变体占位"
    );
    assert!(
        media_asset.get("full").is_none(),
        "Blob 共享契约不再保留旧 full 变体占位"
    );
    assert!(
        media_asset.get("original").is_none(),
        "Blob 共享契约不再保留旧 original 变体占位"
    );
    断言对象不包含壳层私货(media_asset, "blob media_asset");
    断言对象不包含壳层私货(distribution, "blob distribution");
    断言对象不包含壳层私货(origin, "blob origin");
    assert!(
        distribution.get("presence_url").is_none(),
        "共享分发表面不能夹带 Web 页面 presence URL"
    );
    assert!(
        distribution
            .get("join_ticket")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|ticket| !ticket.is_empty()),
        "图片 Blob 共享分发表面也必须能携带 join_ticket"
    );
    assert!(
        distribution
            .get("ticket_expires_at")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|expires_at| !expires_at.is_empty()),
        "图片 Blob 共享分发表面也必须携带 ticket_expires_at"
    );
}
