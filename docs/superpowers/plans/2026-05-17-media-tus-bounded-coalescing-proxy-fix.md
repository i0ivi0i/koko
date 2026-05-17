# 媒体 Tus 有界合并流式代理修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/files` Tus 上传代理从 `body.into_data_stream()` 小块原样转发改成有界合并后流式转发，并用同一浏览器、同一文件、同一 HTTPS/Caddy 入口下的 direct tusd / raw sink 对照证明代理路径接近最大吞吐，同时不回到整块 buffering/OOM 风险。

**Architecture:** 只改 shell/adapter 层：`src/媒体/上传/外壳/tus代理.rs` 新增私有 coalescing stream 和统计，`tests/媒体上传测试/tus代理流式转发.rs` 只验证没有退化回完整 collect。浏览器公开 contract 仍是同源 `/files`，Rust app 仍负责 Location 改写和错误转码；direct tusd / raw sink 只用于测试对照，不新增队列、临时文件、自研协议或 Caddy 直连正式路径。

**Tech Stack:** Rust 2021, Axum 0.8, Reqwest 0.12 `Body::wrap_stream`, Futures 0.3, Tokio tests, tusd 2.9.2, HTTPS Chromium smoke, Caddy same-entry comparison.

---

## Source Spec

Implement from `docs/superpowers/specs/2026-05-17-Tus代理小chunk流式转发吞吐瓶颈修复-design.md`.

Do **not** execute `docs/superpowers/plans/2026-05-17-media-tus-streaming-proxy-fix.md`; that old plan keeps the small-chunk bottleneck.

---

## Confidence Review: Why This Revision Exists

Current plan `1969ac06` is not enough to claim “maximum upload throughput”. It only proves the proxy no longer forwards 27KiB chunks unchanged. It did not prove the chosen target size is throughput-optimal, and it did not compare the Rust proxy against the fastest same-entry control path.

Evidence used for this revision:

- Reqwest 0.12.28 source: `Body::wrap_stream` calls `Body::stream`, then maps each stream item to `Frame::data(Bytes::from(d))`; it does not coalesce chunks for us.
- Reqwest 0.12.28 also exposes `Body::wrap<B: HttpBody>`, but wrapping Axum `Body` directly would still forward the upstream body frame boundaries. It is a lower-abstraction alternative, not a throughput fix by itself.
- Axum docs: request body is a single-use async stream; `Bytes` extraction has a default 2MiB limit, but this proxy uses the whole `Request`, so the relevant risk is streaming/backpressure, not `Bytes` extractor size.
- Caddy docs: `request_buffers` is the request-side buffering footgun. `flush_interval` is response-side behavior and does not prove request upload throughput. `transport http { read_buffer/write_buffer/versions }` can affect proxy behavior and must be included in same-entry comparisons.
- Uppy/tus-js-client docs: `chunkSize` defaults to `Infinity`, and docs explicitly warn not to set it unless forced by a stream input or server/proxy request-body limits. Small chunks hurt performance. Current frontend `32MiB` stays out of this proxy patch, but it becomes the next A/B target if proxy throughput reaches direct tusd baseline and real devices still stay slow.

Plan corrections:

- The production constant starts at `1MiB`, not `512KiB`; the final target must be selected by benchmark from `512KiB`, `1MiB`, and `2MiB`.
- A 32MiB PATCH success target is no longer “chunk count near 64”; it is “Rust proxy throughput reaches at least 90% of same-entry direct tusd/raw sink baseline, or the next bottleneck is proven”.
- The early-arrival integration test must accumulate the first 512KiB prefix at fake tusd. It must not assert that Hyper preserves a single 512KiB frame.
- The body-error path must drop buffered partial data and terminate after yielding the error. It must not flush a tail after a client body stream error.
- Frontend Tus settings are not changed in this implementation. The smoke test must capture enough evidence to decide whether a follow-up should A/B `chunkSize=Infinity`, `chunkSize=32MiB`, and `parallelUploads`.

---

## Throughput Confidence Target

This plan defines “maximum upload throughput” as:

```text
proxy_path_mib_s >= 0.90 * min(raw_sink_mib_s, tusd_direct_mib_s)
```

for the same file, same browser, same device, same Caddy HTTPS entry, same network, and same Uppy/Tus settings.

The stronger target is preferred:

```text
proxy_path_mib_s >= 0.95 * min(raw_sink_mib_s, tusd_direct_mib_s)
```

If the proxy lands between 90% and 95%, it is acceptable only if repeated runs show the remaining gap is inside normal browser/network variance. If it is below 90%, do not call the fix complete; continue the layer comparison.

---

## Files

- Modify: `src/媒体/上传/外壳/tus代理.rs`
  - Add private constant, stats type, bounded coalescing helper, and unit tests.
  - Replace raw `wrap_stream(body.into_data_stream())` with `wrap_stream(coalesced_stream)`.
  - Keep request headers, Location rewriting, and response handling unchanged.
- Modify: `tests/媒体上传测试/tus代理流式转发.rs`
  - Change the early-arrival test from an 11-byte first chunk to a 1MiB first segment.
  - Fake tusd accumulates bytes until the first 512KiB prefix arrives, then signals early arrival.
- Do not modify unless a real gap appears: `tests/媒体上传测试.rs`
  - It already mounts `tus_streaming_proxy_tests`.
- Do not modify: `Cargo.toml`
  - `reqwest` already has `stream`; `futures-util` already exists.

---

### Task 0: Preflight Impact and Current State

**Files:** none

- [ ] **Step 1: Run GitNexus impact before editing**

Use the tool call:

```text
mcp1_impact({ repo: "koko", target: "proxy_tus_upload_transport", file_path: "src/媒体/上传/外壳/tus代理.rs", kind: "Function", direction: "upstream", maxDepth: 3, includeTests: true })
```

Expected:

```text
risk: LOW
direct callers: 0
affected processes: 0
```

If risk is HIGH or CRITICAL, stop and report before editing.

- [ ] **Step 2: Re-read target files**

Read:

```text
src/媒体/上传/外壳/tus代理.rs
tests/媒体上传测试/tus代理流式转发.rs
tests/媒体上传测试.rs
Cargo.toml
```

Expected facts:

```text
tus代理.rs contains reqwest::Body::wrap_stream(body.into_data_stream())
tus代理流式转发.rs still uses b"first-chunk"
tests/媒体上传测试.rs already mounts tus_streaming_proxy_tests
Cargo.toml already enables reqwest feature "stream"
```

---

### Task 1: RED - Unit Tests for Bounded Coalescing

**Files:**

- Modify: `src/媒体/上传/外壳/tus代理.rs`

- [ ] **Step 1: Append failing unit tests**

Append to the end of `src/媒体/上传/外壳/tus代理.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Bytes;
    use futures_util::TryStreamExt;
    use std::sync::{atomic::AtomicBool, Arc, Mutex};

    #[tokio::test]
    async fn 媒体_tus代理合并流会把小块合并成有界大块且保持字节总量() {
        let total_bytes = 32 * 1024 * 1024usize;
        let input_chunk_bytes = 27 * 1024usize;
        let input = (0..total_bytes).step_by(input_chunk_bytes).map(|offset| {
            let len = input_chunk_bytes.min(total_bytes - offset);
            let data = (offset..offset + len)
                .map(|index| (index % 251) as u8)
                .collect::<Vec<_>>();
            Ok::<Bytes, std::io::Error>(Bytes::from(data))
        });
        let stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
        let body_error_seen = Arc::new(AtomicBool::new(false));

        let output: Vec<Bytes> = 合并媒体_tus代理请求体数据流(
            futures_util::stream::iter(input),
            TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES,
            stats.clone(),
            body_error_seen.clone(),
        )
        .try_collect()
        .await
        .expect("合并流不应产生错误");

        let mut cursor = 0usize;
        for chunk in &output {
            for byte in chunk.iter() {
                assert_eq!(*byte, (cursor % 251) as u8);
                cursor += 1;
            }
        }
        assert_eq!(cursor, total_bytes);
        assert!(output.len() <= 80, "输出块不应接近 1200 个，实际 {}", output.len());
        for chunk in output.iter().take(output.len().saturating_sub(1)) {
            assert!(chunk.len() >= TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES);
            assert!(chunk.len() <= TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES + input_chunk_bytes);
        }
        let snapshot = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snapshot.chunk_count, output.len() as u64);
        assert_eq!(snapshot.total_bytes, total_bytes as u64);
        assert!(snapshot.max_chunk_bytes <= (TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES + input_chunk_bytes) as u64);
        assert!(!body_error_seen.load(std::sync::atomic::Ordering::Relaxed));
    }

    #[tokio::test]
    async fn 媒体_tus代理合并流会直接透传已经足够大的块() {
        let len = TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES + 13;
        let stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
        let body_error_seen = Arc::new(AtomicBool::new(false));
        let output: Vec<Bytes> = 合并媒体_tus代理请求体数据流(
            futures_util::stream::iter([Ok::<Bytes, std::io::Error>(Bytes::from(vec![9u8; len]))]),
            TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES,
            stats.clone(),
            body_error_seen,
        )
        .try_collect()
        .await
        .expect("合并流不应产生错误");

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].len(), len);
        let snapshot = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snapshot.chunk_count, 1);
        assert_eq!(snapshot.total_bytes, len as u64);
    }
}
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
cargo test --lib 媒体_tus代理合并流会把小块合并成有界大块且保持字节总量 -- --nocapture
```

Expected:

```text
cannot find value `TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES`
cannot find function `合并媒体_tus代理请求体数据流`
cannot find type `媒体Tus代理合并块统计`
```

Do not implement before seeing this failure.

- [ ] **Step 3: Add RED test for body stream error termination**

Add this third test inside the same `#[cfg(test)] mod tests`:

```rust
    #[tokio::test]
    async fn 媒体_tus代理合并流遇到客户端请求体错误后不会再flush缓存尾块() {
        let stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
        let body_error_seen = Arc::new(AtomicBool::new(false));
        let input = futures_util::stream::iter([
            Ok::<Bytes, std::io::Error>(Bytes::from(vec![1u8; 128 * 1024])),
            Err(std::io::Error::new(std::io::ErrorKind::ConnectionAborted, "client dropped")),
        ]);

        let output = 合并媒体_tus代理请求体数据流(
            input,
            TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES,
            stats.clone(),
            body_error_seen.clone(),
        )
        .collect::<Vec<_>>()
        .await;

        assert_eq!(output.len(), 1);
        assert!(output[0].as_ref().is_err());
        let snapshot = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snapshot.chunk_count, 0);
        assert_eq!(snapshot.total_bytes, 0);
        assert!(body_error_seen.load(std::sync::atomic::Ordering::Relaxed));
    }
```

Run:

```powershell
cargo test --lib 媒体_tus代理合并流遇到客户端请求体错误后不会再flush缓存尾块 -- --nocapture
```

Expected before implementation:

```text
cannot find function `合并媒体_tus代理请求体数据流`
```

---

### Task 2: GREEN - Implement Bounded Coalescing Helper

**Files:**

- Modify: `src/媒体/上传/外壳/tus代理.rs`

- [ ] **Step 1: Extend imports**

Change the imports at the top of `tus代理.rs` to include `Bytes`, `Stream`, `StreamExt`, `Arc`, `Mutex`, `AtomicBool`, and `Ordering`:

```rust
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
```

Keep the existing `super` and `err_resp` imports above these lines.

- [ ] **Step 2: Add constant, stats, and stream helper**

Insert after imports:

```rust
const TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct 媒体Tus代理合并块统计 {
    chunk_count: u64,
    total_bytes: u64,
    min_chunk_bytes: u64,
    max_chunk_bytes: u64,
}

impl 媒体Tus代理合并块统计 {
    fn 记录输出块(&mut self, len: usize) {
        if len == 0 { return; }
        let len = len as u64;
        self.chunk_count += 1;
        self.total_bytes += len;
        self.min_chunk_bytes = if self.min_chunk_bytes == 0 { len } else { self.min_chunk_bytes.min(len) };
        self.max_chunk_bytes = self.max_chunk_bytes.max(len);
    }

    fn 平均块字节数(self) -> u64 {
        if self.chunk_count == 0 { 0 } else { self.total_bytes / self.chunk_count }
    }
}

fn 记录媒体_tus代理输出块(stats: &Arc<Mutex<媒体Tus代理合并块统计>>, len: usize) {
    if let Ok(mut stats) = stats.lock() {
        stats.记录输出块(len);
    }
}

fn 读取媒体_tus代理合并块统计(stats: &Arc<Mutex<媒体Tus代理合并块统计>>) -> 媒体Tus代理合并块统计 {
    stats.lock().map(|stats| *stats).unwrap_or_default()
}

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
    futures_util::stream::unfold(
        (stream.boxed(), Vec::<u8>::with_capacity(target_bytes), None::<Bytes>, false, stats, body_error_seen),
        move |(mut stream, mut buffer, mut pending, mut finished, stats, body_error_seen)| async move {
            loop {
                if let Some(chunk) = pending.take() {
                    if chunk.is_empty() { continue; }
                    if buffer.is_empty() && chunk.len() >= target_bytes {
                        记录媒体_tus代理输出块(&stats, chunk.len());
                        return Some((Ok(chunk), (stream, buffer, pending, finished, stats, body_error_seen)));
                    }
                    if !buffer.is_empty() && chunk.len() >= target_bytes {
                        pending = Some(chunk);
                        let bytes = Bytes::from(std::mem::replace(&mut buffer, Vec::with_capacity(target_bytes)));
                        记录媒体_tus代理输出块(&stats, bytes.len());
                        return Some((Ok(bytes), (stream, buffer, pending, finished, stats, body_error_seen)));
                    }
                    buffer.extend_from_slice(&chunk);
                    if buffer.len() >= target_bytes {
                        let bytes = Bytes::from(std::mem::replace(&mut buffer, Vec::with_capacity(target_bytes)));
                        记录媒体_tus代理输出块(&stats, bytes.len());
                        return Some((Ok(bytes), (stream, buffer, pending, finished, stats, body_error_seen)));
                    }
                    continue;
                }

                if finished {
                    if buffer.is_empty() { return None; }
                    let bytes = Bytes::from(std::mem::replace(&mut buffer, Vec::with_capacity(target_bytes)));
                    记录媒体_tus代理输出块(&stats, bytes.len());
                    return Some((Ok(bytes), (stream, buffer, pending, finished, stats, body_error_seen)));
                }

                match stream.next().await {
                    Some(Ok(chunk)) => pending = Some(chunk),
                    Some(Err(err)) => {
                        body_error_seen.store(true, Ordering::Relaxed);
                        buffer.clear();
                        pending = None;
                        let err = std::io::Error::new(
                            std::io::ErrorKind::ConnectionAborted,
                            format!("client_body_stream_error: {err}"),
                        );
                        return Some((Err(err), (stream, buffer, pending, true, stats, body_error_seen)));
                    }
                    None => finished = true,
                }
            }
        },
    )
}
```

Memory invariant: this helper may copy at most the active coalescing `Vec<u8>` plus one incoming small chunk into the output `Bytes`. It may also temporarily hold one upstream-delivered `Bytes` as `pending` when flushing an existing buffer before a large chunk, but it does not copy that large chunk or buffer a full PATCH.

- [ ] **Step 3: Run unit tests and verify GREEN**

Run:

```powershell
cargo test --lib 媒体_tus代理合并流 -- --nocapture
```

Expected:

```text
test result: ok
```

---

### Task 3: GREEN - Wire Coalescing Stream into Tus Proxy

**Files:**

- Modify: `src/媒体/上传/外壳/tus代理.rs`

- [ ] **Step 1: Replace raw body stream setup**

Inside `proxy_tus_upload_transport`, after `declared_content_length` and before `forward_start`, add:

```rust
let coalesced_stats = Arc::new(Mutex::new(媒体Tus代理合并块统计::default()));
let body_error_seen = Arc::new(AtomicBool::new(false));
let coalesced_body = 合并媒体_tus代理请求体数据流(
    body.into_data_stream(),
    TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES,
    coalesced_stats.clone(),
    body_error_seen.clone(),
);
```

Then replace:

```rust
.body(reqwest::Body::wrap_stream(body.into_data_stream()))
```

with:

```rust
.body(reqwest::Body::wrap_stream(coalesced_body))
```

- [ ] **Step 2: Add chunk stats to success logs**

In the success branch, before `tracing::info!`, add:

```rust
let chunk_stats = 读取媒体_tus代理合并块统计(&coalesced_stats);
```

Add these fields to both success `tracing::info!` calls:

```rust
coalesced_chunk_count = chunk_stats.chunk_count,
coalesced_min_chunk_bytes = chunk_stats.min_chunk_bytes,
coalesced_max_chunk_bytes = chunk_stats.max_chunk_bytes,
coalesced_avg_chunk_bytes = chunk_stats.平均块字节数(),
```

- [ ] **Step 3: Classify body stream errors separately in failure log**

In the `Err(err)` branch, before `tracing::warn!`, add:

```rust
let chunk_stats = 读取媒体_tus代理合并块统计(&coalesced_stats);
let outcome = if body_error_seen.load(Ordering::Relaxed) {
    "client_body_stream_error"
} else {
    "upstream_unreachable"
};
```

Change the tracing field from:

```rust
outcome = "upstream_unreachable",
```

to:

```rust
outcome = outcome,
```

Add the same chunk stats fields to the warning log:

```rust
coalesced_chunk_count = chunk_stats.chunk_count,
coalesced_min_chunk_bytes = chunk_stats.min_chunk_bytes,
coalesced_max_chunk_bytes = chunk_stats.max_chunk_bytes,
coalesced_avg_chunk_bytes = chunk_stats.平均块字节数(),
```

Keep the HTTP response unchanged:

```rust
StatusCode::BAD_GATEWAY
"media_tus_upstream_unreachable"
```

- [ ] **Step 4: Run targeted tests**

Run:

```powershell
cargo test --lib 媒体_tus代理合并流 -- --nocapture
cargo test --test 集成测试 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar -- --nocapture
```

Expected:

```text
test result: ok
```

The integration test may still fail until Task 4 updates it to prefix-based early-arrival assertions.

---

### Task 4: GREEN - Upgrade Early Arrival Integration Test Without Assuming Frame Boundaries

**Files:**

- Modify: `tests/媒体上传测试/tus代理流式转发.rs`

- [ ] **Step 1: Replace fake tusd helper with prefix accumulation**

Replace `启动会记录首块的假_tus上游` with this helper. It accumulates bytes across however many Hyper frames arrive; it does not assume the first upstream frame is 512KiB or 1MiB.

```rust
async fn 启动会记录首个前缀的假_tus上游(
    first_prefix_tx: tokio::sync::oneshot::Sender<Vec<u8>>,
    prefix_bytes: usize,
) -> 流式假Tus上游 {
    let first_prefix_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(first_prefix_tx)));
    let app = Router::new().route(
        "/files/upload-1",
        any(move |request: AxumRequest| {
            let first_prefix_tx = first_prefix_tx.clone();
            async move {
                let mut stream = request.into_body().into_data_stream();
                let mut prefix = Vec::with_capacity(prefix_bytes);
                while prefix.len() < prefix_bytes {
                    let Some(Ok(chunk)) = stream.next().await else {
                        break;
                    };
                    let remaining = prefix_bytes - prefix.len();
                    prefix.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                }
                if prefix.len() == prefix_bytes {
                    if let Some(tx) = first_prefix_tx.lock().await.take() {
                        let _ = tx.send(prefix);
                    }
                }
                while stream.next().await.is_some() {}
                Response::builder()
                    .status(StatusCode::NO_CONTENT)
                    .header("tus-resumable", "1.0.0")
                    .body(Body::empty())
                    .expect("应能组装 fake tusd response")
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能启动 fake tus upstream");
    let port = listener
        .local_addr()
        .expect("应能读取 fake tus 端口")
        .port();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    流式假Tus上游 {
        内部上传入口: format!("http://127.0.0.1:{port}"),
        handle,
    }
}
```

- [ ] **Step 2: Use a 1MiB first client segment and block the tail**

Inside `媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar`, find the existing fake upstream startup that creates `first_chunk_rx` and calls the old first-chunk helper. Replace that startup with:

```rust
let first_prefix_bytes = 512 * 1024usize;
let (first_chunk_tx, first_chunk_rx) = tokio::sync::oneshot::channel::<Vec<u8>>();
let fake_upstream = 启动会记录首个前缀的假_tus上游(first_chunk_tx, first_prefix_bytes).await;
```

Replace the `body_stream` block with:

```rust
let first_segment = vec![7u8; 1024 * 1024];
let body_stream = futures_util::stream::once(async move {
    Ok::<Bytes, std::io::Error>(Bytes::from(first_segment))
})
.chain(futures_util::stream::once(async move {
    let _ = release_tail_rx.await;
    Ok::<Bytes, std::io::Error>(Bytes::from_static(b"second-chunk"))
}));
```

- [ ] **Step 3: Assert prefix arrival before releasing the tail**

Find the existing assertion that compares the received first chunk with the old 11-byte sentinel. Replace that assertion block with:

```rust
let first_chunk = first_chunk_result
    .expect("Tus 代理必须在客户端 body 未结束前把首个 512KiB 前缀流式送到 sidecar")
    .expect("fake sidecar 应收到首个前缀");
assert_eq!(first_chunk.len(), first_prefix_bytes);
assert!(first_chunk.iter().all(|byte| *byte == 7));
```

- [ ] **Step 4: Run integration test**

Run:

```powershell
cargo test --test 集成测试 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar -- --nocapture
```

Expected:

```text
test result: ok
```

---

### Task 5: Regression Sweep and Static Guards

**Files:** none expected

- [ ] **Step 1: Prove old bad patterns are gone from Tus proxy hot path**

Run:

```powershell
Select-String -Path .\src\媒体\上传\外壳\tus代理.rs -Pattern 'body\.collect\(\)\.await|Body::from\(body_bytes\)|wrap_stream\(body\.into_data_stream\(\)\)'
```

Expected:

```text
(no matches)
```

- [ ] **Step 2: Prove new coalescing path exists**

Run:

```powershell
Select-String -Path .\src\媒体\上传\外壳\tus代理.rs -Pattern 'TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES|合并媒体_tus代理请求体数据流|coalesced_chunk_count'
```

Expected includes:

```text
TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES
合并媒体_tus代理请求体数据流
coalesced_chunk_count
```

- [ ] **Step 3: Run Tus upload test slice**

Run:

```powershell
cargo test --test 集成测试 tus -- --nocapture
```

Expected:

```text
test result: ok
```

If this selector does not match tests on this repo, run these targeted tests instead:

```powershell
cargo test --test 集成测试 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar -- --nocapture
cargo test --test 集成测试 public_endpoint_tests -- --nocapture
cargo test --test 集成测试 tus_hook_tests -- --nocapture
```

Expected:

```text
test result: ok
```

---

### Task 6: Target Selection and Same-Entry HTTPS Throughput Proof

**Files:**

- Modify during target selection: `src/媒体/上传/外壳/tus代理.rs`
- Do not modify in this plan: `frontend/媒体/媒体发布.ts`
  - Tus `chunkSize`/`parallelUploads` A/B belongs to a follow-up only if proxy path reaches direct tusd baseline and real devices still stay slow.

- [ ] **Step 1: Start the normal HTTPS dev stack**

Use the existing project scripts, not a custom alternate server:

```powershell
.\run.ps1
.\https.ps1
```

Expected:

```text
Rust app is listening on 8080
Caddy HTTPS entry is available at https://localhost
```

- [ ] **Step 2: Benchmark proxy path for 512KiB, 1MiB, and 2MiB targets**

For each candidate, change only `TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES`, rebuild/restart the app, then upload the same 154,271,730 byte MP4 through real Chromium at `https://localhost`.

Candidates:

```text
512 * 1024
1024 * 1024
2 * 1024 * 1024
```

Capture for each candidate:

```text
target_bytes
POST /files request count and duration
PATCH /files request count and duration
browser protocol for /files requests
Tus Upload-Concat partial/final request pattern
frontend configured chunkSize and parallelUploads from runtime probe
backend throughput_mib_s per PATCH
backend coalesced_chunk_count per 32MiB PATCH
backend coalesced_avg_chunk_bytes
```

Expected chunk counts for 32MiB PATCH:

```text
512KiB target: about 64 chunks
1MiB target: about 32 chunks
2MiB target: about 16 chunks
```

Choose the smallest target whose median proxy throughput is within 5% of the best candidate. If 512KiB and 1MiB are tied, keep 512KiB for lower first-upstream-byte latency. If 1MiB or 2MiB is materially faster, keep the faster target and update `TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES` before final tests.

- [ ] **Step 3: Resolve local tusd control endpoint**

Check whether tusd is reachable from the host:

```powershell
Test-NetConnection 127.0.0.1 -Port 1081
```

Expected if reachable:

```text
TcpTestSucceeded : True
```

If it is not reachable, expose or forward tusd temporarily for this benchmark only. Do not edit `ops/compose.yaml` or commit any runtime Caddyfile. The control endpoint must be the same tusd sidecar used by the app, not a second fake upload server.

- [ ] **Step 4: Run same-entry direct tusd control**

Use a temporary local Caddyfile that keeps the same browser HTTPS origin but routes only `/files*` directly to tusd. Do not commit this Caddyfile and do not change `ops/Caddyfile`.

Temporary Caddyfile shape:

```caddyfile
{
    auto_https disable_redirects
}

https://localhost, https://127.0.0.1 {
    tls internal

    handle /files* {
        reverse_proxy 127.0.0.1:1081 {
            flush_interval -1
            transport http {
                versions 1.1
            }
        }
    }

    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

Run the same real Chromium upload with the same 154,271,730 byte MP4 and same Uppy/Tus settings. If local tusd is not reachable at `127.0.0.1:1081`, use the temporary host-reachable endpoint resolved in Step 3; do not change the browser URL.

Capture:

```text
direct_tusd_patch_median_mib_s
direct_tusd_total_upload_mib_s
PATCH request count and duration
browser protocol for /files requests
```

- [ ] **Step 5: Compare proxy path against direct tusd control**

Calculate:

```text
proxy_ratio = proxy_patch_median_mib_s / direct_tusd_patch_median_mib_s
```

Expected:

```text
proxy_ratio >= 0.90
```

Preferred:

```text
proxy_ratio >= 0.95
```

If `proxy_ratio < 0.90`, do not declare the fix complete. Continue with a raw receive sink or app/tusd forwarding profile to prove whether the remaining bottleneck is browser -> Caddy -> Rust receive, Rust -> tusd forwarding, tusd disk, or frontend chunk gaps.

- [ ] **Step 6: Verify backend coalescing logs**

Search backend stdout log for:

```powershell
Select-String -Path $env:TEMP\koko-runner\**\backend.stdout.log -Pattern 'coalesced_chunk_count|throughput_mib_s|Tus 请求体已流式转发'
```

Expected for 32MiB PATCH:

```text
coalesced_chunk_count close to 32MiB / selected_target_bytes
coalesced_avg_chunk_bytes close to the selected target
throughput_mib_s present
```

If real device throughput still stays near 900KB/s after the proxy path reaches the same-entry direct tusd baseline, do not declare fixed. Continue with real-device network capture and frontend Tus A/B as a separate plan:

```text
chunkSize=32MiB vs chunkSize=Infinity
parallelUploads=1 vs current large-video parallelUploads
uploadDataDuringCreation=false vs true if tusd advertises creation-with-upload
```

---

### Task 7: Final Review and Commit

**Files:**

- Modify: `src/媒体/上传/外壳/tus代理.rs`
- Modify: `tests/媒体上传测试/tus代理流式转发.rs`

- [ ] **Step 1: Run GitNexus detect changes**

Use:

```text
mcp1_detect_changes({ repo: "koko", scope: "all" })
```

Expected:

```text
changed symbols are limited to Tus proxy helper/proxy function and Tus proxy integration test
risk_level: low or expected medium
```

- [ ] **Step 2: Check worktree and stage only this task**

Run:

```powershell
git status --short
```

Expected allowed changes:

```text
M src/媒体/上传/外壳/tus代理.rs
M tests/媒体上传测试/tus代理流式转发.rs
```

Existing unrelated dirty files such as `AGENTS.md` and `CLAUDE.md` must not be staged.

- [ ] **Step 3: Commit implementation**

Run:

```powershell
git add -- src/媒体/上传/外壳/tus代理.rs tests/媒体上传测试/tus代理流式转发.rs
git commit -m "fix: 有界合并媒体Tus代理上传请求体" -m "干了什么：将 /files Tus 代理从 body.into_data_stream() 小块原样转发改为经实测选定目标块大小的有界合并后流式转发，并补充合并块统计日志、错误分类、字节顺序测试和早到前缀测试。" -m "为什么做：真实设备上传被当前小 chunk 代理路径压到约 900KB/s；直接 collect 会引入整块缓冲和 OOM 风险，因此用有界 coalescing 保留流式和背压，并用 same-entry direct tusd 对照证明代理路径接近最大吞吐。" -m "验证了什么：合并流单元测试、请求体错误不 flush 尾块测试、Tus 代理早到集成测试、Tus 相关回归、候选块大小 benchmark、HTTPS Chromium 上传冒烟和 direct tusd 对照比例。" -m "影响边界：只改 shell/adapter 数据面和对应测试；domain/application/contract、Caddy 正式入口、tusd hook 控制面不变。"
```

---

## Plan Self-Review Notes

- Pass 1 - Spec coverage: covers bounded coalescing, no full collect, no raw small chunk, byte order, max output size, early-arrival prefix, body stream error termination, logs, target-size selection, same-entry direct tusd comparison, HTTPS smoke, and fallback layer tests.
- Pass 2 - Completeness review: no incomplete implementation step; old `first-chunk` code is no longer presented as executable replacement code; direct tusd control now includes host endpoint resolution instead of assuming `127.0.0.1:1081`.
- Pass 3 - Type and API consistency: helper names, stat fields, `TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES`, `outcome = outcome`, `chunk.iter()`, and selected-target log expectations are consistent across RED/GREEN/VERIFY tasks.
- Confidence loop 1: not 100% because `512KiB` was hard-coded and chunk count was mistaken for maximum throughput proof; fixed by adding 512KiB/1MiB/2MiB target benchmark and direct tusd baseline.
- Confidence loop 2: not 100% because early-arrival test assumed one 512KiB frame; fixed by fake tusd prefix accumulation.
- Confidence loop 3: not 100% because client body stream errors could flush cached tail and because frontend Tus parameters could remain a hidden bottleneck; fixed by error termination test and follow-up frontend A/B boundary.
- Final confidence: 100% for this plan as an implementation and verification plan. The implementation may still reveal a different bottleneck, but the plan now has a factual stop condition and next diagnostic path instead of pretending the proxy fix alone proves maximum throughput.
