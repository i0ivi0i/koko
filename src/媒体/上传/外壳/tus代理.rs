use super::{TUS协议版本_HEADER值, 应用状态, TUS_INTERNAL_TERMINATION_GUARD_HEADER};
use crate::shell::协议响应::err_resp;
use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{
        header,
        uri::{Authority, Uri},
        HeaderMap, StatusCode,
    },
    response::Response,
};
use futures_util::{Stream, StreamExt};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
/// ── Tus 代理有界合并流常量与辅助 ──────────────────────────────────
/// 目标输出块大小（字节）。初始值 1MiB，最终值通过 512KiB/1MiB/2MiB 实测选定。
/// 合并流会把 Axum 收到的约 27KiB 小块累积到此大小后再交给 reqwest 发送，
/// 减少 HTTP 请求体的 frame 数量，同时不整块缓冲完整 PATCH（保留流式和背压）。
const TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES: usize = 1024 * 1024;

/// Tus 代理合并流的运行统计快照，用于日志观测。
/// 只在内存中维护几个整数计数器，不记录每个 chunk，不产生日志风暴。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct 媒体Tus代理合并块统计 {
    /// 已输出的合并块数量
    chunk_count: u64,
    /// 已输出的总字节数
    total_bytes: u64,
    /// 输出块中的最小字节数
    min_chunk_bytes: u64,
    /// 输出块中的最大字节数
    max_chunk_bytes: u64,
}

impl 媒体Tus代理合并块统计 {
    /// 记录一个已输出的合并块，更新计数器和极值。
    fn 记录输出块(&mut self, len: usize) {
        if len == 0 {
            return;
        }
        let len = len as u64;
        self.chunk_count += 1;
        self.total_bytes += len;
        self.min_chunk_bytes = if self.min_chunk_bytes == 0 {
            len
        } else {
            self.min_chunk_bytes.min(len)
        };
        self.max_chunk_bytes = self.max_chunk_bytes.max(len);
    }

    /// 返回已输出块的平均字节数，用于日志。
    fn 平均块字节数(self) -> u64 {
        if self.chunk_count == 0 {
            0
        } else {
            self.total_bytes / self.chunk_count
        }
    }
}

/// 线程安全地记录一个输出块到共享统计。
fn 记录媒体_tus代理输出块(stats: &Arc<Mutex<媒体Tus代理合并块统计>>, len: usize) {
    if let Ok(mut s) = stats.lock() {
        s.记录输出块(len);
    }
}

/// 读取当前合并块统计快照（用于日志和测试断言）。
fn 读取媒体_tus代理合并块统计(
    stats: &Arc<Mutex<媒体Tus代理合并块统计>>,
) -> 媒体Tus代理合并块统计 {
    stats.lock().map(|s| *s).unwrap_or_default()
}

/// 有界合并流：把上游小 chunk 累积到 `target_bytes` 后再输出一个 `Bytes`。
///
/// 内存不变量：
/// - 额外复制内存只限当前合并 buffer（一个 `Vec<u8>`，容量 = target_bytes）。
/// - 遇到大于目标的输入块时直接透传，不复制。
/// - 最多短暂持有一个上游已交付 `Bytes` 引用作为 pending。
/// - 不缓冲完整 PATCH，不创建后台任务，不写临时文件。
///
/// 错误语义：
/// - 上游 body stream 出错时，立刻丢弃已缓存但未输出的 tail，
///   标记 `body_error_seen`，然后把错误包装为 `std::io::Error` 传给下游。
fn 合并媒体_tus代理请求体数据流<S, E>(
    stream: S,
    target_bytes: usize,
    stats: Arc<Mutex<媒体Tus代理合并块统计>>,
    body_error_seen: Arc<AtomicBool>,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send + 'static
where
    S: Stream<Item = Result<Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    let target_bytes = target_bytes.max(1);
    // unfold 状态元组：(上游流, 合并缓冲, 待处理块, 是否结束, 统计, 错误标记)
    futures_util::stream::unfold(
        (
            stream.boxed(),
            Vec::<u8>::with_capacity(target_bytes),
            None::<Bytes>,
            false,
            stats,
            body_error_seen,
        ),
        move |(mut stream, mut buffer, mut pending, mut finished, stats, body_error_seen)| async move {
            loop {
                // ── 优先处理上一轮遗留的 pending chunk ──
                if let Some(chunk) = pending.take() {
                    if chunk.is_empty() {
                        continue;
                    }
                    // 缓冲为空且输入块已够大 → 零拷贝直接输出
                    if buffer.is_empty() && chunk.len() >= target_bytes {
                        记录媒体_tus代理输出块(&stats, chunk.len());
                        return Some((
                            Ok(chunk),
                            (stream, buffer, pending, finished, stats, body_error_seen),
                        ));
                    }
                    // 缓冲非空且新块已够大 → 先 flush 缓冲，把大块留到下一轮
                    if !buffer.is_empty() && chunk.len() >= target_bytes {
                        pending = Some(chunk);
                        let bytes = Bytes::from(std::mem::replace(
                            &mut buffer,
                            Vec::with_capacity(target_bytes),
                        ));
                        记录媒体_tus代理输出块(&stats, bytes.len());
                        return Some((
                            Ok(bytes),
                            (stream, buffer, pending, finished, stats, body_error_seen),
                        ));
                    }
                    // 小块 → 追加到缓冲
                    buffer.extend_from_slice(&chunk);
                    // 缓冲达到目标 → 输出
                    if buffer.len() >= target_bytes {
                        let bytes = Bytes::from(std::mem::replace(
                            &mut buffer,
                            Vec::with_capacity(target_bytes),
                        ));
                        记录媒体_tus代理输出块(&stats, bytes.len());
                        return Some((
                            Ok(bytes),
                            (stream, buffer, pending, finished, stats, body_error_seen),
                        ));
                    }
                    continue;
                }

                // ── 上游已结束 → flush 剩余 tail ──
                if finished {
                    if buffer.is_empty() {
                        return None;
                    }
                    let bytes = Bytes::from(std::mem::replace(
                        &mut buffer,
                        Vec::with_capacity(target_bytes),
                    ));
                    记录媒体_tus代理输出块(&stats, bytes.len());
                    return Some((
                        Ok(bytes),
                        (stream, buffer, pending, finished, stats, body_error_seen),
                    ));
                }

                // ── 从上游拉取下一个 chunk ──
                match stream.next().await {
                    Some(Ok(chunk)) => pending = Some(chunk),
                    Some(Err(err)) => {
                        // 客户端 body stream 出错：丢弃已缓存 tail，不 flush 半个失败请求体
                        body_error_seen.store(true, Ordering::Relaxed);
                        buffer.clear();
                        pending = None;
                        let err = std::io::Error::new(
                            std::io::ErrorKind::ConnectionAborted,
                            format!("client_body_stream_error: {err}"),
                        );
                        return Some((
                            Err(err),
                            (stream, buffer, pending, true, stats, body_error_seen),
                        ));
                    }
                    None => finished = true,
                }
            }
        },
    )
}

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
    let declared_content_length = parts
        .headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    // ── 构造有界合并流，把 Axum 小 chunk 合并到 ~1MiB 后再交给 reqwest 发送 ──
    let coalesce_stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
    let body_error_seen = Arc::new(AtomicBool::new(false));
    let coalesced_body = 合并媒体_tus代理请求体数据流(
        body.into_data_stream(),
        TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES,
        Arc::clone(&coalesce_stats),
        Arc::clone(&body_error_seen),
    );
    let forward_start = std::time::Instant::now();
    let upstream_response = match upstream_request
        .body(reqwest::Body::wrap_stream(coalesced_body))
        .send()
        .await
    {
        Ok(response) => {
            let duration = forward_start.elapsed();
            if let Some(content_length) = declared_content_length.filter(|value| *value > 0) {
                let throughput_mib_s =
                    (content_length as f64 / 1_048_576.0) / duration.as_secs_f64().max(0.001);
                tracing::info!(
                    adapter = "tus_proxy",
                    outcome = "forwarded",
                    method = %parts.method,
                    path = %parts.uri.path(),
                    declared_content_length_bytes = content_length,
                    duration_ms = duration.as_millis() as u64,
                    throughput_mib_s = format!("{throughput_mib_s:.2}"),
                    coalesced_chunks = 读取媒体_tus代理合并块统计(&coalesce_stats).chunk_count,
                    avg_chunk_bytes = 读取媒体_tus代理合并块统计(&coalesce_stats).平均块字节数(),
                    max_chunk_bytes = 读取媒体_tus代理合并块统计(&coalesce_stats).max_chunk_bytes,
                    body_error = body_error_seen.load(Ordering::Relaxed),
                    "Tus 请求体已合并流式转发"
                );
            } else {
                tracing::info!(
                    adapter = "tus_proxy",
                    outcome = "forwarded",
                    method = %parts.method,
                    path = %parts.uri.path(),
                    duration_ms = duration.as_millis() as u64,
                    coalesced_chunks = 读取媒体_tus代理合并块统计(&coalesce_stats).chunk_count,
                    "Tus 请求体已合并流式转发"
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
                declared_content_length_bytes = declared_content_length.unwrap_or_default(),
                duration_ms = duration.as_millis() as u64,
                error = %err,
                body_error = body_error_seen.load(Ordering::Relaxed),
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

#[cfg(test)]
mod 合并流单元测试 {
    use super::*;

    /// 辅助：收集合并流全部输出块
    async fn 收集合并流输出(
        chunks: Vec<Result<Bytes, String>>,
        target: usize,
    ) -> (
        Vec<Result<Bytes, std::io::Error>>,
        Arc<Mutex<媒体Tus代理合并块统计>>,
        Arc<AtomicBool>,
    ) {
        let stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
        let body_error_seen = Arc::new(AtomicBool::new(false));
        let stream = futures_util::stream::iter(chunks);
        let coalesced = 合并媒体_tus代理请求体数据流(
            stream,
            target,
            Arc::clone(&stats),
            Arc::clone(&body_error_seen),
        );
        let results: Vec<_> = coalesced.collect().await;
        (results, stats, body_error_seen)
    }

    /// 验证字节顺序：多个小块合并后输出的字节必须和输入顺序完全一致，不丢失不重排。
    /// 同时验证输出块数量大幅减少，以及 max_chunk_bytes 不超过 2 * target。
    #[tokio::test]
    async fn 合并流保持字节顺序且减少输出块数() {
        // 构造 40 个 100 字节的小块，每个块填充其序号
        let target = 1000;
        let input_chunks: Vec<Result<Bytes, String>> = (0u8..40)
            .map(|i| Ok(Bytes::from(vec![i; 100])))
            .collect();

        let (results, stats, body_error_seen) = 收集合并流输出(input_chunks, target).await;

        // 不应有任何错误
        assert!(results.iter().all(|r| r.is_ok()), "合并流不应产生错误");
        assert!(!body_error_seen.load(Ordering::Relaxed));

        // 收集所有输出字节，验证与输入完全一致
        let mut output_bytes = Vec::new();
        for r in &results {
            output_bytes.extend_from_slice(r.as_ref().unwrap());
        }
        let mut expected_bytes = Vec::new();
        for i in 0u8..40 {
            expected_bytes.extend_from_slice(&vec![i; 100]);
        }
        assert_eq!(output_bytes, expected_bytes, "输出字节必须与输入顺序完全一致");

        // 输出块数应远少于 40（4000 / 1000 = 4 块）
        let snap = 读取媒体_tus代理合并块统计(&stats);
        assert!(
            snap.chunk_count <= 5,
            "40 个 100B 块、目标 1000B，应合并为 ≤5 块，实际 {}",
            snap.chunk_count
        );
        assert_eq!(snap.total_bytes, 4000);
        // 内存安全：最大输出块不应超过 2 * target
        assert!(
            snap.max_chunk_bytes <= 2 * target as u64,
            "max_chunk_bytes={} 不应超过 2*target={}",
            snap.max_chunk_bytes,
            2 * target
        );
    }

    /// 验证大块透传：当输入块已 >= target 时，应零拷贝直接输出，不额外复制。
    #[tokio::test]
    async fn 合并流大块直接透传() {
        let target = 100;
        // 输入：一个 200B 大块 + 一个 50B 小块
        let big = Bytes::from(vec![0xAA; 200]);
        let small = Bytes::from(vec![0xBB; 50]);
        let input_chunks: Vec<Result<Bytes, String>> =
            vec![Ok(big.clone()), Ok(small.clone())];

        let (results, stats, _) = 收集合并流输出(input_chunks, target).await;

        assert_eq!(results.len(), 2, "大块透传 + 小块 tail flush 应产生 2 个输出");
        // 第一个输出就是那个 200B 大块
        assert_eq!(results[0].as_ref().unwrap().len(), 200);
        assert!(results[0].as_ref().unwrap().iter().all(|b| *b == 0xAA));
        // 第二个是 50B tail
        assert_eq!(results[1].as_ref().unwrap().len(), 50);
        assert!(results[1].as_ref().unwrap().iter().all(|b| *b == 0xBB));

        let snap = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snap.chunk_count, 2);
        assert_eq!(snap.total_bytes, 250);
    }

    /// 验证 error 不 flush：上游 body stream 出错时，
    /// 已缓存但未输出的 tail 必须被丢弃，不能 flush 给下游。
    #[tokio::test]
    async fn 合并流上游出错时丢弃缓存不flush() {
        let target = 1000;
        // 输入：300B 正常小块 + 错误
        // 300B < 1000 target，所以在缓冲中还未输出
        let input_chunks: Vec<Result<Bytes, String>> = vec![
            Ok(Bytes::from(vec![0xCC; 300])),
            Err("client_disconnected".to_string()),
        ];

        let (results, stats, body_error_seen) = 收集合并流输出(input_chunks, target).await;

        // 应该只有一个输出：错误
        assert_eq!(results.len(), 1, "出错后只应有一个错误输出，不应有 tail flush");
        assert!(results[0].is_err(), "唯一输出应为错误");
        let err = results[0].as_ref().unwrap_err();
        assert!(
            err.to_string().contains("client_body_stream_error"),
            "错误消息应包含 client_body_stream_error: {}",
            err
        );
        assert!(body_error_seen.load(Ordering::Relaxed), "body_error_seen 应为 true");

        // 统计应为 0 —— 300B 缓存被丢弃，没有输出任何合并块
        let snap = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snap.chunk_count, 0, "出错时不应有成功输出块");
        assert_eq!(snap.total_bytes, 0, "出错时缓存字节应被丢弃");
    }
}
