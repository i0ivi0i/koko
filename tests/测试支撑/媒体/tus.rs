use axum::http::StatusCode;
use serde_json::Value;

/// prepare 返回的 Tus headers 当前只要求一条稳定 Authorization。
/// 测试统一从这里拿，避免每个用例各自硬编码字段路径。
pub fn 提取媒体上传授权头(body: &Value) -> String {
    body["tus_headers"]["Authorization"]
        .as_str()
        .expect("Tus prepare 必须返回 Authorization 头")
        .to_string()
}

/// tusd HTTP hooks 只认 `2XX + application/json + HookResponse`。
/// 测试统一从这里断言成功，避免每个用例继续把旧的 204 vendor 语义写回仓库。
#[allow(non_snake_case)]
pub fn 断言TusHook已接受(status: StatusCode, body: &Value) {
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body, &serde_json::json!({}), "{body:?}");
}

fn 解析_tus_hook回传_http响应体(body: &Value) -> Value {
    let raw_body = body["HTTPResponse"]["Body"]
        .as_str()
        .expect("Tus hook 拒绝响应必须带 HTTPResponse.Body");
    serde_json::from_str(raw_body).expect("Tus hook HTTPResponse.Body 必须是 JSON 字符串")
}

#[allow(non_snake_case)]
pub fn 断言TusHook拒绝上传(
    status: StatusCode,
    body: &Value,
    expected_status: StatusCode,
    expected_code: &str,
) {
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["RejectUpload"].as_bool(), Some(true), "{body:?}");
    assert_eq!(
        body["HTTPResponse"]["StatusCode"].as_u64(),
        Some(expected_status.as_u16() as u64),
        "{body:?}"
    );
    assert_eq!(
        body["HTTPResponse"]["Header"]["Content-Type"].as_str(),
        Some("application/json"),
        "{body:?}"
    );
    let inner = 解析_tus_hook回传_http响应体(body);
    assert_eq!(inner["code"].as_str(), Some(expected_code), "{inner:?}");
}

#[allow(non_snake_case)]
pub fn 断言TusHook拒绝Termination(
    status: StatusCode,
    body: &Value,
    expected_status: StatusCode,
    expected_code: &str,
) {
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["RejectTermination"].as_bool(), Some(true), "{body:?}");
    assert_eq!(
        body["HTTPResponse"]["StatusCode"].as_u64(),
        Some(expected_status.as_u16() as u64),
        "{body:?}"
    );
    assert_eq!(
        body["HTTPResponse"]["Header"]["Content-Type"].as_str(),
        Some("application/json"),
        "{body:?}"
    );
    let inner = 解析_tus_hook回传_http响应体(body);
    assert_eq!(inner["code"].as_str(), Some(expected_code), "{inner:?}");
}

/// 这里构造的是我们当前 shell 关心的最小 tusd HTTP hook 负载：
/// - 顶层走官方 `Type / Event / Upload / HTTPRequest` 结构；
/// - `Upload.MetaData` 继续把 attachment_id 作为业务锚点传回来；
/// - `HTTPRequest.Header.Authorization` 代表客户端最初打给 sidecar 的上传令牌；
/// - 其余字段即便 tusd 还会发，也不应该成为我们判断业务真相的依赖。
#[allow(clippy::too_many_arguments)]
pub fn 构造tus_hook请求体(
    hook_type: &str,
    authorization: Option<&str>,
    upload_id: &str,
    attachment_id: &str,
    file_name: &str,
    mime_type: &str,
    size: i64,
    offset: i64,
    storage_locator: Option<&str>,
) -> Value {
    let request_method = match hook_type {
        "pre-create" => "POST",
        "pre-terminate" | "post-terminate" => "DELETE",
        _ => "PATCH",
    };
    let request_uri = if hook_type == "pre-create" {
        "/files".to_string()
    } else {
        format!("/files/{upload_id}")
    };
    let upload_id_value = if hook_type == "pre-create" {
        Value::Null
    } else {
        Value::String(upload_id.to_string())
    };
    let storage_value = storage_locator
        .map(|path| {
            serde_json::json!({
                "Type": "filestore",
                "Path": path,
            })
        })
        .unwrap_or(Value::Null);
    let mut request_headers = serde_json::Map::new();
    if let Some(value) = authorization
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request_headers.insert(
            "Authorization".to_string(),
            Value::Array(vec![Value::String(value.to_string())]),
        );
    }
    serde_json::json!({
        "Type": hook_type,
        "Event": {
            "Upload": {
                "ID": upload_id_value,
                "Size": size,
                "SizeIsDeferred": false,
                "Offset": offset,
                "MetaData": {
                    "attachment_id": attachment_id,
                    "file_name": file_name,
                    "mime_type": mime_type,
                    "byte_size": size.to_string(),
                },
                "IsPartial": false,
                "IsFinal": false,
                "PartialUploads": Value::Null,
                "Storage": storage_value,
            },
            "HTTPRequest": {
                "Method": request_method,
                "URI": request_uri,
                "Header": request_headers,
            }
        }
    })
}

/// Concatenation 场景下，测试需要显式表达 partial / final 与 upload_session_id。
/// 这里继续保持“最小 fixture”原则：
/// 1. 默认仍沿用基础 hook 负载，避免和真实 shell 判断脱节；
/// 2. 只有角色布尔位、parts 和 upload_session_id 这些 Concatenation 必需字段才额外注入；
/// 3. fixture 负责表达协议事实，不替业务层做任何裁决。
#[allow(clippy::too_many_arguments)]
pub fn 构造tus_concatenation_hook请求体(
    hook_type: &str,
    authorization: Option<&str>,
    upload_id: &str,
    attachment_id: &str,
    upload_session_id: &str,
    file_name: &str,
    mime_type: &str,
    size: i64,
    offset: i64,
    storage_locator: Option<&str>,
    is_partial: bool,
    is_final: bool,
    parts: Option<Vec<&str>>,
) -> Value {
    let mut body = 构造tus_hook请求体(
        hook_type,
        authorization,
        upload_id,
        attachment_id,
        file_name,
        mime_type,
        size,
        offset,
        storage_locator,
    );
    body["Event"]["Upload"]["IsPartial"] = Value::Bool(is_partial);
    body["Event"]["Upload"]["IsFinal"] = Value::Bool(is_final);
    body["Event"]["Upload"]["PartialUploads"] = parts
        .map(|items| {
            Value::Array(
                items
                    .into_iter()
                    .map(|value| Value::String(value.to_string()))
                    .collect(),
            )
        })
        .unwrap_or(Value::Null);
    body["Event"]["Upload"]["MetaData"]["upload_session_id"] =
        Value::String(upload_session_id.to_string());
    body
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
