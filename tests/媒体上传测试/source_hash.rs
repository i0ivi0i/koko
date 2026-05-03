use super::*;

const SOURCE_HASH_一号: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const SOURCE_HASH_二号: &str = "2222222222222222222222222222222222222222222222222222222222222222";

async fn 启动会话并进房(
    app: axum::Router,
    device_token: String,
    room_code: String,
) -> (String, String) {
    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (join_status, join) = send_json(
        app,
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_code": room_code,
        })),
        &[],
    )
    .await;
    assert_eq!(join_status, StatusCode::OK, "进房失败: {join:?}");
    (
        session_id.to_string(),
        join["room_id"].as_str().expect("room_id").to_string(),
    )
}

async fn 既有会话进房(app: axum::Router, session_id: &str, room_code: String) -> String {
    let (join_status, join) = send_json(
        app,
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_code": room_code,
        })),
        &[],
    )
    .await;
    assert_eq!(join_status, StatusCode::OK, "既有会话进房失败: {join:?}");
    join["room_id"].as_str().expect("room_id").to_string()
}

async fn 上传带source_hash的最小图片(
    app: axum::Router,
    tus_upload_dir: String,
    session_id: &str,
    source_hash: &str,
    source_file_name: &str,
    uniq: u128,
) -> String {
    let image_bytes = 最小webp字节();
    let image_byte_size = image_bytes.len() as i64;
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
            "source_file_name": source_file_name,
        })),
        &[],
    )
    .await;
    assert_eq!(
        prepare_status,
        StatusCode::OK,
        "prepare 失败: {prepare_body:?}"
    );
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();

    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-source-hash-{uniq}-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "canonical.webp",
        &image_bytes,
    )
    .expect("应能写入 source_hash 图片上传临时文件");
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
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({ "session_id": session_id })),
        &[],
    )
    .await;
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "complete 失败: {complete_body:?}"
    );
    attachment_id
}

async fn 用附件创建房间消息(
    database_url: String,
    room_id: String,
    session_id: String,
    attachment_id: String,
    client_message_id: String,
) {
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &session_id,
            &client_message_id,
            "",
            &[attachment_id],
        )
        .expect("source_hash 测试前置消息应能成立");
    })
    .await
    .expect("创建附件消息任务应完成");
}

async fn 构建source_hash测试应用() -> (String, koko::shell::应用状态, axum::Router) {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平 source_hash 迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    (cfg.database_url, state, app)
}

#[path = "source_hash_跨房复用与一致性.rs"]
mod source_hash_reuse_consistency_tests;
#[path = "source_hash_转发与删除守卫.rs"]
mod source_hash_forward_and_deletion_guard_tests;
