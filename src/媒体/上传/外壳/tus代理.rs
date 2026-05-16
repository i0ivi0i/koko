use super::{TUS协议版本_HEADER值, 应用状态, TUS_INTERNAL_TERMINATION_GUARD_HEADER};
use crate::shell::协议响应::err_resp;
use axum::{
    body::Body,
    extract::{Request, State},
    http::{
        header,
        uri::{Authority, Uri},
        HeaderMap, StatusCode,
    },
    response::Response,
};
use http_body_util::BodyExt;
/// 官方 termination 仍只是 transport 删除能力：
/// 1. 只有 business abandon 已经成功之后，shell 才会来协调它；
/// 2. 没配置内部 guard 时，继续退回本地残留清理兜底，不让取消主链直接失败；
/// 3. DELETE 失败只记日志，不回滚已经成立的 abandoned 真相。
///
/// 同源 Tus 上传透传入口：
/// 1. 只负责把 `/files...` 协议流量转发给 sidecar，不承载业务裁决；
/// 2. sidecar 不可达时显式返回 502 + 稳定错误码，避免前端停在“上传中”无诊断信号；
/// 3. 保持请求方法与关键头语义，避免再出现“prepare 给了地址但入口不存在”的双真相。
pub(super) async fn proxy_tus_upload_transport(
    State(state): State<应用状态>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let request_path = parts.uri.path();
    let tus_resource_tail = request_path
        .strip_prefix(normalized_tus_base_path.as_str())
        .unwrap_or(request_path);
    let internal_upload_endpoint = 读取媒体_tus内部上传入口(&state);
    let mut upstream_url = format!(
        "{}{}",
        internal_upload_endpoint.trim_end_matches('/'),
        tus_resource_tail
    );
    if let Some(query) = parts.uri.query() {
        upstream_url.push('?');
        upstream_url.push_str(query);
    }

    let upstream_method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                format!("不支持的 Tus 上传方法: {err}"),
            );
        }
    };
    let mut upstream_request = state.http_client.request(upstream_method, &upstream_url);
    for (name, value) in &parts.headers {
        if name.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        upstream_request = upstream_request.header(name, value);
    }
    let body_bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(err) => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "media_tus_request_body_read_failed",
                format!("读取上传请求体失败: {err}"),
            );
        }
    };
    let content_length = body_bytes.len();
    let forward_start = std::time::Instant::now();
    let upstream_response = match upstream_request
        .body(reqwest::Body::from(body_bytes))
        .send()
        .await
    {
        Ok(response) => {
            let duration = forward_start.elapsed();
            if content_length > 0 {
                let throughput_mib_s =
                    (content_length as f64 / 1_048_576.0) / duration.as_secs_f64().max(0.001);
                tracing::info!(
                    adapter = "tus_proxy",
                    outcome = "forwarded",
                    method = %parts.method,
                    path = %parts.uri.path(),
                    content_length_bytes = content_length,
                    duration_ms = duration.as_millis() as u64,
                    throughput_mib_s = format!("{throughput_mib_s:.2}"),
                    "Tus PATCH 转发完成"
                );
            }
            response
        }
        Err(err) => {
            let duration = forward_start.elapsed();
            tracing::warn!(
                adapter = "tus_proxy",
                outcome = "upstream_unreachable",
                method = %parts.method,
                path = %parts.uri.path(),
                content_length_bytes = content_length,
                duration_ms = duration.as_millis() as u64,
                error = %err,
                "Tus sidecar 不可达"
            );
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_unreachable",
                format!("Tus sidecar 不可达: {err}"),
            );
        }
    };

    let status = StatusCode::from_u16(upstream_response.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let mut response_builder = Response::builder().status(status);
    for (name, value) in upstream_response.headers() {
        if name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("keep-alive")
            || name.as_str().eq_ignore_ascii_case("proxy-authenticate")
            || name.as_str().eq_ignore_ascii_case("proxy-authorization")
            || name.as_str().eq_ignore_ascii_case("te")
            || name.as_str().eq_ignore_ascii_case("trailers")
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
            || name.as_str().eq_ignore_ascii_case("upgrade")
        {
            continue;
        }
        if name == header::LOCATION {
            let rewritten_location = value.to_str().ok().and_then(|raw_location| {
                改写媒体_tus_location到浏览器入口(
                    raw_location,
                    &parts.headers,
                    normalized_tus_base_path.as_str(),
                )
            });
            if let Some(rewritten_location) = rewritten_location {
                response_builder = response_builder.header(name, rewritten_location);
                continue;
            }
        }
        response_builder = response_builder.header(name, value);
    }
    let body = match upstream_response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_invalid_response",
                format!("读取 Tus sidecar 响应失败: {err}"),
            );
        }
    };
    match response_builder.body(Body::from(body)) {
        Ok(response) => response,
        Err(err) => err_resp(
            StatusCode::BAD_GATEWAY,
            "media_tus_proxy_response_build_failed",
            format!("组装 Tus 代理响应失败: {err}"),
        ),
    }
}

pub(super) async fn 尝试终止媒体_tus上传(
    state: &应用状态,
    upload_id: &str,
    request_id: Option<&str>,
) -> Result<(), String> {
    let Some(internal_termination_token) = state
        .tus_internal_termination_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let internal_delete_endpoint = 读取媒体_tus内部上传入口(state);
    let delete_url = format!(
        "{}/{}",
        internal_delete_endpoint.trim_end_matches('/'),
        upload_id.trim()
    );
    let mut request = state.http_client
        .delete(delete_url.as_str())
        .header("Tus-Resumable", TUS协议版本_HEADER值)
        .header(
            TUS_INTERNAL_TERMINATION_GUARD_HEADER,
            internal_termination_token,
        );
    if let Some(request_id) = request_id.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("X-Request-Id", request_id);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("调用 Tus termination DELETE 失败: {err}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Tus termination DELETE 返回 {status}，响应体: {body}"
        ));
    }
    Ok(())
}

pub(super) fn 标准化媒体_tus基础路径(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/files".to_string();
    }
    format!("/{}", trimmed.trim_matches('/'))
}

fn 读取媒体_tus内部上传入口(state: &应用状态) -> String {
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let raw_internal_base_url = state
        .tus_internal_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", state.tus_server_port));
    // `MEDIA_TUS_INTERNAL_BASE_URL` 同时支持“只给 sidecar origin”和“直接给到 /files endpoint”。
    // 这里统一归一成真正的上传资源前缀，避免测试、脚本和部署配置各猜各的。
    if raw_internal_base_url
        .trim_end_matches('/')
        .ends_with(normalized_tus_base_path.as_str())
    {
        raw_internal_base_url.trim_end_matches('/').to_string()
    } else {
        format!(
            "{}{}",
            raw_internal_base_url.trim_end_matches('/'),
            normalized_tus_base_path
        )
    }
}

pub(super) fn 读取首个非空请求头(
    headers: &HeaderMap,
    name: &'static str,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| !part.is_empty())
                .map(|part| part.to_string())
        })
}

fn 包装url主机(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn 是回环媒体_tus公开地址(url: &str) -> bool {
    let Ok(uri) = url.parse::<Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    matches!(authority.host(), "127.0.0.1" | "localhost" | "::1")
}

fn 裁决媒体_tus显式公开地址(
    raw_endpoint: &str,
    normalized_tus_base_path: &str,
) -> String {
    let trimmed = raw_endpoint.trim();
    if trimmed.is_empty() {
        return normalized_tus_base_path.to_string();
    }
    if trimmed.starts_with('/') {
        return 标准化媒体_tus基础路径(trimmed);
    }
    if 是回环媒体_tus公开地址(trimmed) {
        return normalized_tus_base_path.to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

/// 浏览器真正进入的是“当前请求这条 `/files` 公共入口”，而不是内部 tusd 监听端口。
/// 这里统一按当前请求头推导出浏览器可见的绝对 `/files` 入口，只给代理层改写 `Location` 使用。
fn 推导媒体tus浏览器公开入口(
    headers: &HeaderMap,
    tus_base_path: &str,
) -> Option<String> {
    let forwarded_host = 读取首个非空请求头(headers, "x-forwarded-host");
    let raw_host = forwarded_host
        .clone()
        .or_else(|| 读取首个非空请求头(headers, "host"))?;
    let authority = raw_host.parse::<Authority>().ok()?;
    let forwarded_proto = 读取首个非空请求头(headers, "x-forwarded-proto")
        .or_else(|| 读取首个非空请求头(headers, "x-forwarded-scheme"));
    let forwarded_port =
        读取首个非空请求头(headers, "x-forwarded-port").and_then(|value| value.parse::<u16>().ok());
    let scheme = forwarded_proto
        .clone()
        .unwrap_or_else(|| "http".to_string());
    let hostname = authority.host();
    let host_for_url = 包装url主机(hostname);

    let should_trust_authority_port =
        forwarded_host.is_some() || forwarded_proto.is_some() || forwarded_port.is_some();
    let inferred_proxy_default_port = if should_trust_authority_port {
        match scheme.as_str() {
            "https" => Some(443),
            "http" => Some(80),
            _ => None,
        }
    } else {
        None
    };
    let public_port = forwarded_port
        .or_else(|| authority.port_u16())
        .or(inferred_proxy_default_port);
    let should_omit_port = public_port.is_none()
        || (scheme == "http" && public_port == Some(80))
        || (scheme == "https" && public_port == Some(443));
    let authority_for_url = if should_omit_port {
        host_for_url
    } else {
        format!("{host_for_url}:{}", public_port.unwrap_or_default())
    };
    Some(format!("{scheme}://{authority_for_url}{tus_base_path}"))
}

fn 提取媒体_tus资源尾(location: &str, normalized_tus_base_path: &str) -> Option<String> {
    let trimmed = location.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(resource_tail) = trimmed.strip_prefix(normalized_tus_base_path) {
        return Some(resource_tail.to_string());
    }
    let path_and_query = trimmed
        .parse::<Uri>()
        .ok()
        .and_then(|uri| uri.path_and_query().map(|value| value.as_str().to_string()))
        .unwrap_or_else(|| trimmed.to_string());
    path_and_query
        .strip_prefix(normalized_tus_base_path)
        .map(|value| value.to_string())
}

fn 改写媒体_tus_location到浏览器入口(
    location: &str,
    headers: &HeaderMap,
    normalized_tus_base_path: &str,
) -> Option<String> {
    let browser_entry = 推导媒体tus浏览器公开入口(headers, normalized_tus_base_path)?
        .trim_end_matches('/')
        .to_string();
    let resource_tail = 提取媒体_tus资源尾(location, normalized_tus_base_path)?;
    Some(format!("{browser_entry}{resource_tail}"))
}

pub(super) fn 读取媒体_tus对外地址(state: &应用状态) -> String {
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    state
        .tus_public_endpoint
        .as_deref()
        .map(|value| 裁决媒体_tus显式公开地址(value, normalized_tus_base_path.as_str()))
        .unwrap_or(normalized_tus_base_path)
}
