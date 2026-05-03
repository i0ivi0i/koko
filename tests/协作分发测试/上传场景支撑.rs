use super::*;

/// 协作分发 slice 只关心“ready 附件 + 房间消息”后的读侧合同。
/// 因此这里把 prepare -> post-finish -> complete 这段重复装配收进 helper，
/// 测试本体继续专注在 locator / torrent / snapshot 的断言。
pub(crate) struct 已完成媒体上传场景 {
    pub(crate) attachment_id: String,
    pub(crate) complete_body: serde_json::Value,
}

// 这条 helper 负责把协作分发读侧依赖的上传主链一次走完；
// 显式参数表能直接映射 prepare/hook/complete 的真实字段，不再制造额外测试 DSL。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn 完成媒体上传到ready(
    app: axum::Router,
    tus_upload_dir: &str,
    session_id: &str,
    prepare_endpoint: &str,
    upload_id_prefix: &str,
    stored_file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> 已完成媒体上传场景 {
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        prepare_endpoint,
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": stored_file_name,
            "mime_type": mime_type,
            "byte_size": bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK, "{prepare_body:?}");

    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("prepare 响应必须返回 attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file =
        写入tus测试文件(tus_upload_dir, &attachment_id, stored_file_name, bytes)
            .expect("应能写入协作分发上传临时文件");
    let upload_id = format!("{upload_id_prefix}{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            stored_file_name,
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

    已完成媒体上传场景 {
        attachment_id,
        complete_body,
    }
}
