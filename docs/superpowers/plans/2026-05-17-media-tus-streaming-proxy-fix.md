# 媒体 Tus 上传流式代理修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/files` Tus 上传数据面从“Rust app 完整缓冲后再转发”改成“边接收边转发到 tusd”，先修复上传阶段吃不满用户上行带宽的根因。

**Architecture:** 本修复只改 adapter/shell 上传传输层，不改变媒体 domain/application/contract 真相。浏览器公开入口仍是同源 `/files`，业务鉴权仍由 tusd hook 回到 Rust app；Rust app 的 `/files` 代理只做协议转发、错误转码和 Location 改写，不能再持有完整媒体字节。

**Tech Stack:** Rust 2021, Axum 0.8, Reqwest 0.12, tusd 2.9.2, Uppy/Tus 5.x, Caddy reverse_proxy, Tokio, cargo 集成测试。

---

## Current Evidence

- `src/外壳/mod.rs:416-425` 把 `/files` 和 `/files/{*tus_upload_tail}` 都路由到 `媒体_tus代理外壳::proxy_tus_upload_transport`。
- `src/媒体/上传/外壳/tus代理.rs:61-75` 当前执行 `body.collect().await`，再用 `reqwest::Body::from(body_bytes)` 发给 tusd。
- `frontend/媒体/媒体发布.ts:198-199` 当前默认 `chunkSize = 32MiB` 且 `uploadDataDuringCreation = false`。
- `frontend/媒体/媒体发布.ts:204-212` 大视频才启用 `parallelUploads = 4`；小图、小视频、大图仍走 default 档位，但所有档位最终都进入 `/files`。
- `ops/Caddyfile:13-19` 已对 `/files*` 走 Caddy -> app，且仅设置响应侧 `flush_interval -1`；它不能修复 app 内部 `body.collect()`。
- `ops/compose.yaml:65-89` tusd 已独立 sidecar、开启 `-behind-proxy`、hook 回 app，说明控制面/数据面已具备分离基础。

## Root Cause

上传慢的核心根因是 `/files` 代理破坏了流式数据面：

```text
当前：浏览器 -> Caddy -> Rust app 收完整 chunk -> Rust app 再发给 tusd
目标：浏览器 -> Caddy -> Rust app 边收边转 -> tusd
```

这会导致：

- 每个 Tus PATCH/POST 请求体被完整驻留在 Rust app 内存中。
- 浏览器到 app、app 到 tusd 两段链路被人为串行化。
- 大视频 `parallelUploads=4` 时，多个 32MiB 请求体会并发挤进业务进程内存。
- 小图/小视频也必须等代理完成整段 body collect 后，sidecar 才开始收字节，体感不丝滑。

## Scope

### In Scope

- 为 `/files` 代理新增“客户端请求体未结束时，sidecar 已收到首块字节”的失败测试。
- 给 `reqwest` 开启官方 `stream` feature。
- 把 `proxy_tus_upload_transport` 请求体转发改为 `reqwest::Body::wrap_stream(body.into_data_stream())`。
- 保留现有请求头转发、sidecar 不可达 502、Location 改写行为。
- 做 targeted cargo 测试和 HTTPS 真实上传烟测。

### Out of Scope

- 不在本轮改 Uppy `chunkSize`、`parallelUploads`、`uploadDataDuringCreation` 策略。
- 不在本轮拆 `/complete` 的 hash/torrent/store 后处理。
- 不在本轮把 Caddy `/files` 直连 tusd；这是更大部署切线，需要单独 spec。
- 不在本轮引入自研上传协议、队列、缓存、限速器或私有分片器。

## Supxcode Gate

**Compliance Summary**

- Truth owner: 上传业务真相仍由 prepare/hook/complete/application 决定；本次只改 transport adapter。
- Boundary placement: `src/媒体/上传/外壳/tus代理.rs` 属 shell/adapter 边界，允许处理 HTTP body 和 reqwest 转发。
- Exchange contract: `/files` Tus contract、`Location`、`Tus-Resumable`、hook headers 不改。
- Mature capability reuse: 复用 Axum body stream + Reqwest `Body::wrap_stream`，不手搓 uploader。

**Verification Needed**

- 必须先看到 streaming regression 在当前实现下失败。
- 必须看到实现后 targeted regression、现有 Tus 地址/回调测试通过。
- 必须用 HTTPS 真实浏览器上传路径烟测，不只跑 cargo。

**Release**

- Conditional: 只有完成 RED/GREEN/REFACTOR、回归测试和 HTTPS 烟测后，才能提交修复代码。

## Files

- Modify: `Cargo.toml`
  - 给 `reqwest` 加 `stream` feature。
  - 删除不再直接使用的 `http-body-util` 依赖。
- Modify: `src/媒体/上传/外壳/tus代理.rs`
  - 删除上传请求体完整 collect。
  - 用 Axum body data stream 直接包成 reqwest streaming body。
  - 保留现有错误码、header 转发、Location 改写。
- Create: `tests/媒体上传测试/tus代理流式转发.rs`
  - 新增最小 fake tusd upstream，断言首块字节能在客户端 body 未结束前到达。
- Modify: `tests/媒体上传测试.rs`
  - 挂载新测试模块。

---

### Task 1: RED - Add Streaming Regression Test

**Files:**

- Create: `tests/媒体上传测试/tus代理流式转发.rs`
- Modify: `tests/媒体上传测试.rs:17-24`

- [ ] **Step 1: Mount the new test module**

Modify `tests/媒体上传测试.rs`:

```rust
#[path = "媒体上传测试/公网地址推导.rs"]
mod public_endpoint_tests;
#[path = "媒体上传测试/tus代理流式转发.rs"]
mod tus_streaming_proxy_tests;
#[path = "媒体上传测试/source_hash.rs"]
mod source_hash_tests;
```

- [ ] **Step 2: Create the failing streaming regression**

Create `tests/媒体上传测试/tus代理流式转发.rs`:

```rust
use super::*;
use axum::{
    body::{Body, Bytes},
    extract::Request as AxumRequest,
    response::Response,
    routing::any,
    Router,
};
use futures_util::StreamExt;
use tokio::{net::TcpListener, task::JoinHandle};
use tower::ServiceExt;

struct 流式假Tus上游 {
    内部上传入口: String,
    handle: JoinHandle<()>,
}

async fn 启动会记录首块的假Tus上游(
    first_chunk_tx: tokio::sync::oneshot::Sender<Vec<u8>>,
) -> 流式假Tus上游 {
    let first_chunk_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(first_chunk_tx)));
    let app = Router::new().route(
        "/files/upload-1",
        any(move |request: AxumRequest| {
            let first_chunk_tx = first_chunk_tx.clone();
            async move {
                let mut stream = request.into_body().into_data_stream();
                if let Some(Ok(chunk)) = stream.next().await {
                    if let Some(tx) = first_chunk_tx.lock().await.take() {
                        let _ = tx.send(chunk.to_vec());
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

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
        "MEDIA_TUS_INTERNAL_BASE_URL",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    env::set_var("MEDIA_TUS_BASE_PATH", "/files");
    let (first_chunk_tx, first_chunk_rx) = tokio::sync::oneshot::channel::<Vec<u8>>();
    let fake_upstream = 启动会记录首块的假Tus上游(first_chunk_tx).await;
    env::set_var(
        "MEDIA_TUS_INTERNAL_BASE_URL",
        fake_upstream.内部上传入口.as_str(),
    );
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (release_tail_tx, release_tail_rx) = tokio::sync::oneshot::channel::<()>();
    let body_stream = futures_util::stream::once(async {
        Ok::<Bytes, std::io::Error>(Bytes::from_static(b"first-chunk"))
    })
    .chain(futures_util::stream::once(async move {
        let _ = release_tail_rx.await;
        Ok::<Bytes, std::io::Error>(Bytes::from_static(b"second-chunk"))
    }));
    let request = axum::http::Request::builder()
        .method(Method::PATCH)
        .uri("/files/upload-1")
        .header("tus-resumable", "1.0.0")
        .header("upload-offset", "0")
        .header(header::CONTENT_TYPE, "application/offset+octet-stream")
        .body(Body::from_stream(body_stream))
        .expect("request");

    let request_task = tokio::spawn(async move { app.oneshot(request).await.expect("proxy response") });
    let first_chunk_result = tokio::time::timeout(Duration::from_millis(500), first_chunk_rx).await;
    let _ = release_tail_tx.send(());
    let response = tokio::time::timeout(Duration::from_secs(3), request_task)
        .await
        .expect("代理请求应能在释放客户端尾块后结束")
        .expect("代理任务不应 panic");
    fake_upstream.handle.abort();
    恢复环境变量(backup);

    let first_chunk = first_chunk_result
        .expect("Tus 代理必须在客户端 body 未结束前把首块流式送到 sidecar")
        .expect("fake sidecar 应收到首块");
    assert_eq!(first_chunk, b"first-chunk".to_vec());
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}
```

- [ ] **Step 3: Run RED and confirm expected failure**

Run from repo root:

```powershell
cargo test --test 集成测试 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar -- --nocapture
```

Expected before implementation:

```text
FAIL
Tus 代理必须在客户端 body 未结束前把首块流式送到 sidecar
```

If this test passes before code changes, stop: the test is not proving the current bug.

- [ ] **Step 4: Commit RED test only**

```powershell
git add tests/媒体上传测试.rs tests/媒体上传测试/tus代理流式转发.rs
git commit -m "test: 锁定媒体 Tus 代理必须流式转发请求体"
```

---

### Task 2: GREEN - Stream Request Body Through Reqwest

**Files:**

- Modify: `Cargo.toml:59-62`
- Modify: `src/媒体/上传/外壳/tus代理.rs:1-164`

- [ ] **Step 1: Enable reqwest streaming body support**

Modify `Cargo.toml`:

```toml
# 后端现在同时承担两类 tusd 官方 HTTP 调用：
# 1. `/files` 上传请求体必须流式转发给 sidecar；
# 2. abandon 主链需要向 sidecar 发官方 termination DELETE。
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls", "stream"] }
```

Delete the old direct dependency:

```toml
http-body-util = "0.1"
```

- [ ] **Step 2: Remove full request body buffering from the proxy**

Modify `src/媒体/上传/外壳/tus代理.rs`.

Remove this import:

```rust
use http_body_util::BodyExt;
```

Replace the `body.collect().await` block with streaming forwarding:

```rust
    let declared_content_length = parts
        .headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let forward_start = std::time::Instant::now();
    let upstream_response = match upstream_request
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
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
                    "Tus 请求体已流式转发"
                );
            } else {
                tracing::info!(
                    adapter = "tus_proxy",
                    outcome = "forwarded",
                    method = %parts.method,
                    path = %parts.uri.path(),
                    duration_ms = duration.as_millis() as u64,
                    "Tus 请求体已流式转发"
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
                "Tus sidecar 不可达"
            );
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_unreachable",
                format!("Tus sidecar 不可达: {err}"),
            );
        }
    };
```

Do not add a custom queue, memory cache, temp file, manual chunker, or retry layer.

- [ ] **Step 3: Run GREEN targeted test**

```powershell
cargo test --test 集成测试 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar -- --nocapture
```

Expected after implementation:

```text
test result: ok
```

- [ ] **Step 4: Prove the old buffering pattern is gone**

```powershell
Select-String -Path .\src\媒体\上传\外壳\tus代理.rs -Pattern 'body.collect\(\)\.await|Body::from\(body_bytes\)|body_bytes'
```

Expected:

```text
(no matches)
```

- [ ] **Step 5: Commit GREEN implementation**

```powershell
git add Cargo.toml Cargo.lock src/媒体/上传/外壳/tus代理.rs
git commit -m "fix: 将媒体 Tus 代理改为流式转发上传请求体"
```

---

### Task 3: REFACTOR and Regression Sweep

**Files:**

- Modify only if needed: `src/媒体/上传/外壳/tus代理.rs`
- Modify only if needed: `tests/媒体上传测试/tus代理流式转发.rs`

- [ ] **Step 1: Run existing Tus public endpoint tests**

```powershell
cargo test --test 集成测试 媒体上传测试::public_endpoint_tests -- --nocapture
```

Expected:

```text
test result: ok
```

This proves `/files` routing, `Location` rewrite, and sidecar unreachable `502` behavior were not broken.

- [ ] **Step 2: Run Tus hook tests**

```powershell
cargo test --test 集成测试 媒体上传测试::tus_hook_tests -- --nocapture
```

Expected:

```text
test result: ok
```

This proves control-plane hook semantics stayed in app and were not moved into the transport proxy.

- [ ] **Step 3: Run the full media upload test slice**

```powershell
cargo test --test 集成测试 媒体上传测试 -- --nocapture
```

Expected:

```text
test result: ok
```

- [ ] **Step 4: Build-check the full integrated test binary**

```powershell
cargo test --test 集成测试 --no-run
```

Expected:

```text
Finished `test` profile
```

- [ ] **Step 5: Commit refactor only if code changed after GREEN**

If Step 1-4 required cleanup changes:

```powershell
git add src/媒体/上传/外壳/tus代理.rs tests/媒体上传测试/tus代理流式转发.rs
git commit -m "refactor: 收口媒体 Tus 流式代理测试与日志"
```

If no code changed, do not create an empty commit.

---

### Task 4: HTTPS Real Upload Smoke

**Files:**

- No source changes expected.

- [ ] **Step 1: Start the real local HTTPS path**

Run from repo root:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\https.ps1 -LauncherMode
```

Expected:

```text
HTTPS 入口可访问 https://localhost
```

- [ ] **Step 2: Use browser smoke on the real app**

Before browser actions, prepare deterministic local upload files:

```powershell
$smokeDir = Join-Path $env:TEMP "koko-upload-smoke"
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
[IO.File]::WriteAllBytes((Join-Path $smokeDir "small.png"), [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="))
Copy-Item .\tests\fixtures\minimal.mp4 (Join-Path $smokeDir "small.mp4") -Force
$largeVideo = Get-ChildItem .\data\attachments\media-assets -Recurse -Filter canonical.mp4 -ErrorAction SilentlyContinue | Where-Object { $_.Length -ge 33554432 } | Sort-Object Length -Descending | Select-Object -First 1
if (-not $largeVideo) { throw "缺少 >=32MiB 的真实视频样本；请先提供一个真实 mp4，不要用随机字节伪造大视频烟测。" }
Copy-Item $largeVideo.FullName (Join-Path $smokeDir "large.mp4") -Force
Write-Host $smokeDir
```

Use the required browser verification skills against:

```text
https://localhost
```

Required browser evidence tools:

- `playwright-cli`
- `chrome-devtools-cli`
- `browser-trace`

Smoke steps:

1. Open or create a room.
2. Upload `%TEMP%\koko-upload-smoke\small.png`.
3. Upload `%TEMP%\koko-upload-smoke\small.mp4`.
4. Upload `%TEMP%\koko-upload-smoke\large.mp4` to exercise `large-video` / `parallelUploads`.
5. Watch browser network panel for `/files` PATCH/POST requests.
6. Confirm app logs contain `Tus 请求体已流式转发` and do not show request body read failures.

Expected:

- Upload progress begins immediately.
- `/files` requests complete successfully.
- Message draft reaches uploaded/ready state.
- No `media_tus_request_body_read_failed`.
- No app memory spike proportional to full Tus chunk size.

- [ ] **Step 3: Compare throughput qualitatively before/after**

Use the browser network transfer rate and app logs.

Expected:

- Upload data transfer no longer stalls until client body end.
- Throughput should be materially higher than the observed ~900KB/s bottleneck on the same network.
- If throughput remains low, stop and gather new evidence before touching frontend chunk/concurrency settings.

- [ ] **Step 4: Final impact check before shipping**

```powershell
git status --short
```

Expected:

```text
(no unintended files)
```

Then run GitNexus detect changes:

```text
gitnexus_detect_changes(scope="all", repo="koko")
```

Expected:

- Changed symbols limited to Tus proxy transport and its tests.
- No domain/application/contract truth moved.

- [ ] **Step 5: Final commit if smoke produced any committed evidence docs**

If no source/docs changed during smoke, no commit is needed.

If an evidence note is added:

```powershell
git add docs/superpowers/reports/2026-05-17-media-tus-streaming-proxy-smoke.md
git commit -m "test: 记录媒体 Tus 流式上传 HTTPS 烟测证据"
```

---

## Rollback Plan

If the streaming proxy breaks Tus upload behavior:

1. Revert the GREEN implementation commit.
2. Keep the RED test commit only if it remains useful and marked failing during diagnosis; otherwise revert both commits together.
3. Restore `reqwest` features to `["json", "rustls-tls"]`.
4. Restore `http-body-util = "0.1"` only if reverting to the old buffered proxy implementation.
5. Re-run `cargo test --test 集成测试 媒体上传测试::public_endpoint_tests -- --nocapture` to confirm old behavior restored.
6. Do not tune frontend chunk/concurrency as a workaround until the proxy streaming hypothesis is falsified with evidence.

## Done Criteria

- Streaming regression fails on old code and passes on new code.
- `src/媒体/上传/外壳/tus代理.rs` no longer contains `body.collect().await`, `Body::from(body_bytes)`, or `body_bytes`.
- Existing `/files` public endpoint and tus hook tests pass.
- Full `媒体上传测试` slice passes.
- HTTPS browser smoke confirms real small image, small video, and large video uploads work.
- No domain/application/contract boundary moved.
- No duplicate data path or second upload truth introduced.

## Later Spec Candidates

Only after this fix is verified:

1. Frontend small-file latency spec: evaluate `uploadDataDuringCreation=true` for default profile.
2. Frontend high-bandwidth tuning spec: measure and tune `chunkSize` and `parallelUploads` under Cloudflare/Caddy/tusd limits.
3. Complete-stage perceived latency spec: defer hash/torrent/store readiness work away from the upload progress path without weakening authoritative media truth.
