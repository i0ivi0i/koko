use super::*;

/// 这组 helper 只服务媒体上传 slice 的 arrange：
/// - 从 prepare 响应提取 attachment_id / 授权头；
/// - 写入 tus 临时文件；
/// - 发送 post-finish hook 并断言协议接受。
///
/// 业务断言仍留在各测试本体，避免这里长成第二层业务真相。
pub(crate) struct 已登记Tus最终上传 {
    pub(crate) attachment_id: String,
    pub(crate) upload_id: String,
    pub(crate) temp_file: String,
}

pub(crate) fn 写入上传临时文件(
    tus_upload_dir: &str,
    attachment_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> String {
    写入tus测试文件(tus_upload_dir, attachment_id, file_name, bytes)
        .expect("应能写入 tus 测试临时文件")
}

pub(crate) async fn 登记最终上传回执(
    app: axum::Router,
    tus_upload_dir: &str,
    prepare_body: &serde_json::Value,
    upload_id_prefix: &str,
    stored_file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> 已登记Tus最终上传 {
    登记最终上传回执_使用声明字节数(
        app,
        tus_upload_dir,
        prepare_body,
        upload_id_prefix,
        stored_file_name,
        mime_type,
        bytes,
        bytes.len() as i64,
    )
    .await
}

pub(crate) async fn 登记最终上传回执_使用声明字节数(
    app: axum::Router,
    tus_upload_dir: &str,
    prepare_body: &serde_json::Value,
    upload_id_prefix: &str,
    stored_file_name: &str,
    mime_type: &str,
    bytes: &[u8],
    declared_byte_size: i64,
) -> 已登记Tus最终上传 {
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("prepare 响应必须返回 attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(prepare_body);
    let temp_file = 写入上传临时文件(tus_upload_dir, &attachment_id, stored_file_name, bytes);
    let upload_id = format!("{upload_id_prefix}{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            stored_file_name,
            mime_type,
            declared_byte_size,
            declared_byte_size,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    已登记Tus最终上传 {
        attachment_id,
        upload_id,
        temp_file,
    }
}
