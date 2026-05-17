# 媒体 Tus 有界合并流式代理修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/files` Tus 上传代理从 `body.into_data_stream()` 小块原样转发改成 512KiB 级有界合并后流式转发，消除真实客户端 900KB/s 级吞吐瓶颈，同时不回到整块 buffering/OOM 风险。

**Architecture:** 只改 shell/adapter 层：`src/媒体/上传/外壳/tus代理.rs` 新增私有 coalescing stream 和统计，`tests/媒体上传测试/tus代理流式转发.rs` 只验证没有退化回完整 collect。浏览器公开 contract 仍是同源 `/files`，Rust app 仍负责 Location 改写和错误转码；不新增队列、临时文件、自研协议或 Caddy 直连正式路径。

**Tech Stack:** Rust 2021, Axum 0.8, Reqwest 0.12 `Body::wrap_stream`, Futures 0.3, Tokio tests, tusd 2.9.2, HTTPS Chromium smoke.

---

## Source Spec

Implement from `docs/superpowers/specs/2026-05-17-Tus代理小chunk流式转发吞吐瓶颈修复-design.md`.

Do **not** execute `docs/superpowers/plans/2026-05-17-media-tus-streaming-proxy-fix.md`; that old plan keeps the small-chunk bottleneck.

---

## Files

- Modify: `src/媒体/上传/外壳/tus代理.rs`
  - Add private constant, stats type, bounded coalescing helper, and unit tests.
  - Replace raw `wrap_stream(body.into_data_stream())` with `wrap_stream(coalesced_stream)`.
  - Keep request headers, Location rewriting, and response handling unchanged.
- Modify: `tests/媒体上传测试/tus代理流式转发.rs`
  - Change the early-arrival test from an 11-byte first chunk to a 512KiB first segment.
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
        }
        let snapshot = 读取媒体_tus代理合并块统计(&stats);
        assert_eq!(snapshot.chunk_count, output.len() as u64);
        assert_eq!(snapshot.total_bytes, total_bytes as u64);
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
const TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES: usize = 512 * 1024;

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

The integration test may still fail until Task 4 updates its first chunk size.

---

### Task 4: GREEN - Upgrade Early Arrival Integration Test

**Files:**

- Modify: `tests/媒体上传测试/tus代理流式转发.rs`

- [ ] **Step 1: Change first client body segment to 512KiB**

Replace the current `body_stream` block:

```rust
let body_stream = futures_util::stream::once(async {
    Ok::<Bytes, std::io::Error>(Bytes::from_static(b"first-chunk"))
})
.chain(futures_util::stream::once(async move {
    let _ = release_tail_rx.await;
    Ok::<Bytes, std::io::Error>(Bytes::from_static(b"second-chunk"))
}));
```

with:

```rust
let first_segment = vec![7u8; 512 * 1024];
let body_stream = futures_util::stream::once(async move {
    Ok::<Bytes, std::io::Error>(Bytes::from(first_segment))
})
.chain(futures_util::stream::once(async move {
    let _ = release_tail_rx.await;
    Ok::<Bytes, std::io::Error>(Bytes::from_static(b"second-chunk"))
}));
```

- [ ] **Step 2: Change assertion to length and sentinel bytes**

Replace:

```rust
assert_eq!(first_chunk, b"first-chunk".to_vec());
```

with:

```rust
assert_eq!(first_chunk.len(), 512 * 1024);
assert!(first_chunk.iter().all(|byte| *byte == 7));
```

- [ ] **Step 3: Run integration test**

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

### Task 6: Real HTTPS Browser Smoke

**Files:** none expected

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

- [ ] **Step 2: Upload the 154,271,730 byte MP4 through real Chromium**

Use the existing browser probe path from the investigation or an equivalent Playwright/Chromium run against `https://localhost`.

Capture:

```text
POST /files request count and duration
PATCH /files request count and duration
protocol for /files requests
Tus headers: Upload-Offset, Upload-Concat, Tus-Resumable
```

Expected:

```text
large video uses 4 partial uploads
PATCH requests complete successfully
```

- [ ] **Step 3: Verify backend coalescing logs**

Search backend stdout log for:

```powershell
Select-String -Path $env:TEMP\koko-runner\**\backend.stdout.log -Pattern 'coalesced_chunk_count|throughput_mib_s|Tus 请求体已流式转发'
```

Expected for 32MiB PATCH:

```text
coalesced_chunk_count close to 64
coalesced_avg_chunk_bytes close to 524288
throughput_mib_s present
```

If real device throughput still stays near 900KB/s, do not declare fixed. Continue with the raw sink / tusd direct comparison described in the design spec.

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
git commit -m "fix: 有界合并媒体Tus代理上传请求体" -m "干了什么：将 /files Tus 代理从 body.into_data_stream() 小块原样转发改为 512KiB 级有界合并后流式转发，并补充合并块统计日志与早到/合并测试。" -m "为什么做：真实设备上传被当前小 chunk 代理路径压到约 900KB/s；直接 collect 会引入整块缓冲和 OOM 风险，因此用有界 coalescing 保留流式和背压。" -m "验证了什么：合并流单元测试、Tus 代理早到集成测试、Tus 相关回归和 HTTPS Chromium 上传冒烟。" -m "影响边界：只改 shell/adapter 数据面和对应测试；domain/application/contract、Caddy 正式入口、tusd hook 控制面不变。"
```

---

## Plan Self-Review Notes

- Spec coverage: covers bounded coalescing, no full collect, no raw small chunk, early arrival, logs, HTTPS smoke, and fallback layer tests.
- Completeness review: no incomplete sections or deferred implementation steps.
- Type consistency: helper names are consistent across tests and implementation snippets.
- 100% confidence loop: this plan is sufficient to implement the intended fix; final confidence still depends on executing RED/GREEN tests and real HTTPS browser smoke.
