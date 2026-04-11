use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
    response::Response,
    Router,
};
use serde_json::Value;
use tower::ServiceExt;

/// HTTP 测试助手：
/// - 统一构造请求
/// - 统一解析 JSON 响应
/// - 让每个测试聚焦业务断言，而不是重复样板代码
pub async fn send_json(
    app: Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let body = if let Some(v) = body {
        req = req.header("content-type", "application/json");
        Body::from(v.to_string())
    } else {
        Body::empty()
    };

    let response = app
        .oneshot(req.body(body).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    if bytes.is_empty() {
        (status, serde_json::json!({}))
    } else {
        let json = serde_json::from_slice::<Value>(&bytes).expect("json body");
        (status, json)
    }
}

/// 二进制响应测试助手：
/// - 用来覆盖 torrent、图片原图、后续 Range 读取等二进制出口；
/// - 把状态码、响应头和原始字节一起带回测试，避免每个用例重复写样板。
pub async fn send_bytes(
    app: Router,
    method: Method,
    uri: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }

    let response = app
        .oneshot(req.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body")
        .to_vec();
    (status, headers, bytes)
}

/// multipart 助手只负责按当前接口契约拼出最小请求体。
/// 它不理解业务语义，只负责把字节和字段送进 handler。
pub async fn send_multipart_response(
    app: Router,
    uri: &str,
    session_id: &str,
    filename: &str,
    content_type: &str,
    file_bytes: &[u8],
) -> Response {
    let boundary = "----koko-test-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"session_id\"\r\n\r\n{session_id}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    app.oneshot(
        Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .expect("request"),
    )
    .await
    .expect("response")
}

/// 从 HTML 里抠出静态资源路径，只服务缓存策略断言。
/// 这里保持字符串级最小处理，避免为测试再引入一套 DOM 解析依赖。
pub fn 提取静态资源路径<'a>(html: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let start = html.find(prefix)? + prefix.len();
    let rest = &html[start..];
    let end = rest.find(suffix)?;
    Some(&rest[..end])
}
