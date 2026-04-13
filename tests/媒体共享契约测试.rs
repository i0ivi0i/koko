use axum::http::{Method, StatusCode};
use serial_test::serial;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{http::*, media::*};

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
async fn 视频locator共享契约不包含_web_页面流程和展示文案字段() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let rustus_data_dir = state.rustus_data_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("shared-contract-video-{uniq}")})),
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
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "shared-contract-video.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "shared-contract-video.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 rustus 临时视频文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &format!("upload-shared-contract-video-{attachment_id}"),
            &attachment_id,
            "shared-contract-video.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id")
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("complete 应返回共享 media_asset");
    let streaming_asset = media_asset;
    let distribution = streaming_asset["distribution"]
        .as_object()
        .expect("流媒体资产必须返回共享分发表面");
    let origin = streaming_asset["origin"]
        .as_object()
        .expect("流媒体资产必须返回冷源描述");
    let manifest = streaming_asset["manifest"]
        .as_object()
        .expect("流媒体资产必须返回 manifest 描述");

    断言对象不包含壳层私货(media_asset, "video media_asset");
    断言对象不包含壳层私货(distribution, "video distribution");
    断言对象不包含壳层私货(origin, "video origin");
    断言对象不包含壳层私货(manifest, "video manifest");
    assert!(
        distribution.get("presence_url").is_none(),
        "共享分发表面不能夹带 Web 页面 presence URL"
    );
}

#[tokio::test]
#[serial]
async fn 图片complete共享契约不包含_web_页面流程和展示文案字段() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let rustus_data_dir = state.rustus_data_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("shared-contract-image-{uniq}")})),
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
            "file_name": "shared-contract-image.png",
            "mime_type": "image/png",
            "byte_size": 最小png字节().len()
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "shared-contract-image.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 临时图片文件");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &format!("upload-shared-contract-image-{attachment_id}"),
            &attachment_id,
            "shared-contract-image.png",
            "image/png",
            最小png字节().len() as i64,
            最小png字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id")
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let media_asset = complete_body["media_asset"]
        .as_object()
        .expect("complete 应返回共享 media_asset");
    let preview = media_asset["preview"]
        .as_object()
        .expect("Blob 资产必须返回 preview");
    let full = media_asset["full"]
        .as_object()
        .expect("Blob 资产必须返回 full");
    let origin = media_asset["origin"]
        .as_object()
        .expect("Blob 资产必须返回冷源描述");

    断言对象不包含壳层私货(media_asset, "blob media_asset");
    断言对象不包含壳层私货(preview, "blob preview");
    断言对象不包含壳层私货(full, "blob full");
    断言对象不包含壳层私货(origin, "blob origin");
}
