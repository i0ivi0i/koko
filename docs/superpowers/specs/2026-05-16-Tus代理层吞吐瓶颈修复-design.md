# Tus 代理层吞吐瓶颈修复设计

日期：2026-05-16
状态：Design / 等待用户审查

关联：

- `docs/superpowers/specs/2026-05-16-纯WebTorrent媒体高速发送源码热路径-design.md`（广义媒体发送热路径，本 spec 是其中 P0 子问题的专项修复）
- `学习/整理笔记/Tus上传代理链路吞吐瓶颈-Caddy-Hyper-axum官方资料与高性能设计-2026-05.md`（本 spec 的官方资料依据）
- `src/媒体/上传/外壳/tus代理.rs`（核心修改文件）
- `ops/Caddyfile`（防退化配置）
- `src/外壳/mod.rs`（reqwest Client 构建）

---

## 1. 前因后果

### 1.1 用户实测证据

主人用多台设备、多个网络项目、相同环境测试：
- 其他上传项目能跑到 **50Mb/s**
- 本项目群聊附件上传只有 **900KB/s**（约 7.2Mbps）
- 小图片、小视频、大图片、大视频全都慢
- **关键证据：开始 Tus PATCH 上传后就稳定在 900KB/s，整个上传过程不超过，直到传完**

这条证据排除了上传前预处理（WebP/MP4 预制、source hash）和上传后处理（complete、强种子）是第一嫌疑，把根因锁定在 **Tus PATCH 传输管道本身**。

### 1.2 当前上传链路

```
浏览器 Uppy/Tus → PATCH 32MiB
  → Caddy（HTTPS 对外，HTTP/1.1 反代到内网）
  → app:8080（axum / Hyper，HTTP/1.1 接收）
  → tus代理.rs：body.into_data_stream() + Body::wrap_stream()
  → reqwest HTTP/1.1 POST/PATCH
  → tusd:1081（Docker 内网）
  → tusd 写盘 /data/tus
```

### 1.3 根因定位过程

经过 Serena 源码审查 + 官方资料交叉比对，锁定第一嫌疑：

**`tus代理.rs` 第 61 行：**

```rust
.body(reqwest::Body::wrap_stream(body.into_data_stream()))
```

`axum::Body::into_data_stream()` 是 axum/Hyper 已知问题（axum#2107、StackOverflow#79837924）：

- 底层 Hyper body polling 每次只产出约 **27KiB** 的 chunk
- 一个 32MiB 的 Tus PATCH 被切成约 **1200 个小 chunk**
- 每个小 chunk 都经历一次 async poll → Bytes 产出 → wrap_stream 包装 → reqwest 发送 → 系统调用
- 1200 次 async poll + 系统调用的固定开销叠加，严重压低吞吐

**通俗说：高速公路上的一整车货被拆成 1200 辆自行车，每辆都要单独过闸机。**

### 1.4 排除项

| 嫌疑 | 排除原因 |
|---|---|
| Caddy 请求缓冲 | Caddy 对 HTTP 反代默认不缓冲请求体（只有 FastCGI 默认缓冲） |
| Caddy → app HTTP/2 流控 | Caddy 到 `http://app:8080` 默认 HTTP/1.1（无 TLS 无 ALPN） |
| reqwest → tusd HTTP/2 流控 | reqwest 到 `http://tusd:1081` 默认 HTTP/1.1 |
| 前端 Tus 配置限速 | chunkSize=32MiB、limit=8、parallelUploads=4（大视频），无显式限速常量 |
| axum body limit | DefaultBodyLimit::max(200MiB)，容量门禁不是吞吐限速 |
| 请求限流 | governor per_second(10) burst_size(30) 限请求数不限单请求吞吐 |
| 外部网络/设备/浏览器 | 主人多台设备多个项目对照实测排除 |

### 1.5 为什么现在必须先修这个

广义媒体发送热路径 spec 覆盖了预处理并行化、complete 解耦、强种子首发等多个方向。但用户实测证据明确指向 **Tus PATCH 传输管道本身** 是当前最大瓶颈——如果管道本身只有 900KB/s，优化预处理和 complete 只能缩短"上传前等待"和"上传后等待"，无法解决"上传中就只有 900KB/s"这个核心体感。

所以本 spec 从广义热路径中剥离出来，专门解决 P0：**Tus 代理层转发吞吐**。

---

## 2. 领域语言与边界

### 2.1 统一语言

- **Tus 代理**：Rust app 中把浏览器 `/files` 请求转发给内部 tusd sidecar 的 transport 适配层。
- **PATCH 吞吐**：单个 Tus PATCH 请求从浏览器到 tusd 写盘的字节传输速率（MB/s）。
- **体吞吐日志**：代理层记录每个 PATCH 的 bytes、duration、throughput，用于分段定位。

### 2.2 DDD / 六边形边界

| 层 | 本 spec 改动 | 不碰 |
|---|---|---|
| domain | 无 | 附件状态、消息成立、媒体种类 |
| application | 无 | prepare / complete / reuse 用例 |
| contract | 无 | 附件快照、错误码、分发 locator |
| adapter | 无 | Tus 协议语义、对象存储 |
| **shell** | **tus代理.rs 转发实现、Caddyfile 防退化、reqwest Client 配置、吞吐日志** | 不发明新协议、不绕开 app 统一入口 |

**改动面严格限定在 shell 层的 transport 执行细节，不碰业务语义和协议契约。**

---

## 3. 方案比较

### 3.1 方案 A：Caddy 直连 tusd，绕过 Rust app

```
Caddy /files → tusd:1081（直连）
```

优势：零代码改动，消除 Rust 代理层所有开销。

失败点：
- **违反项目架构边界**：app 是统一入口 owner，负责认证、限流、hook 回调路由。Caddy 直连 tusd 会让 tusd 暴露在未认证状态。
- 丢失 Location 改写能力（tusd 返回内部地址，浏览器拿到错误 URL）。
- 丢失未来扩展点（如上传限额、审计日志）。

裁决：**拒绝**。

### 3.2 方案 B：保持 `into_data_stream()` + `wrap_stream()` 但加 buffered adapter

手写一个 buffered stream adapter，把多个 27KiB 小 chunk 合并成更大的 chunk 再 wrap_stream。

优势：理论上保留流式。

失败点：
- **手搓轮子**——需要自己写 buffer 逻辑、处理 chunk 合并边界、错误传播。
- 32MiB 内完全没必要流式——tusd 在 Docker 内网，本机网络延迟微秒级。
- 增加代码复杂度和维护负担。

裁决：**拒绝**。

### 3.3 方案 C：`body.collect().await?.to_bytes()` + `reqwest::Body::from(bytes)` ✅

```rust
// 修改前
.body(reqwest::Body::wrap_stream(body.into_data_stream()))

// 修改后
let collected = body.collect().await.map_err(...)?.to_bytes();
.body(reqwest::Body::from(collected))
```

优势：
- **全用官方 API，零手搓**：
  - `body.collect()` 是 `http-body-util` 标准方法
  - `.to_bytes()` 是 `Collected<Bytes>` 标准方法
  - `reqwest::Body::from(Bytes)` 是 reqwest 官方 `From` 实现
- 从 1200 次 async poll + 系统调用 → 1 次收集 + 1 次整体发送
- tusd 在 Docker 内网，32MiB 收集到内存后转发耗时微秒级
- 前端最大并发 8 个文件 × 32MiB = 256MiB 峰值内存，完全可接受

成本：
- 代理层不再是严格流式（先收集再转发），但对 Docker 内网 tusd 场景这不是问题
- 理论上增加了一次内存拷贝，但消除了 1200 次 async poll 开销，净收益显著

裁决：**选中**。

### 3.4 方案 D：使用 `axum-reverse-proxy` crate

优势：成熟第三方轮子。

失败点：
- 不具备 Tus 协议感知（不能改写 Location header）。
- 37 GitHub stars、3 个依赖项目，成熟度不足以替代简单的两行代码改动。
- 引入额外依赖解决两行代码能解决的问题，违反简洁约束。

裁决：**拒绝**。

---

## 4. 详细设计

### 4.1 核心改动：`tus代理.rs` 转发实现

**当前代码**（第 26、60-62 行）：

```rust
let (parts, body) = request.into_parts();
// ...
let upstream_response = match upstream_request
    .body(reqwest::Body::wrap_stream(body.into_data_stream()))
    .send()
    .await
```

**修改后**：

```rust
let (parts, body) = request.into_parts();
// ...

use http_body_util::BodyExt;
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

let upstream_response = match upstream_request
    .body(reqwest::Body::from(body_bytes))
    .send()
    .await
```

### 4.2 吞吐日志

在 `proxy_tus_upload_transport` 中加入 PATCH 级吞吐观测（仅对 PATCH/POST 有 body 的请求记录）：

```rust
let content_length = body_bytes.len();
let start = std::time::Instant::now();
let upstream_response = match upstream_request
    .body(reqwest::Body::from(body_bytes))
    .send()
    .await
{
    Ok(response) => response,
    // ... error handling
};
let duration = start.elapsed();
if content_length > 0 {
    let throughput_mib_s = (content_length as f64 / 1024.0 / 1024.0)
        / duration.as_secs_f64().max(0.001);
    tracing::info!(
        application = "媒体上传代理",
        adapter = "tus_proxy",
        outcome = "forwarded",
        method = %parts.method,
        path = %parts.uri.path(),
        content_length_bytes = content_length,
        duration_ms = duration.as_millis() as u64,
        throughput_mib_s = format!("{throughput_mib_s:.2}"),
        "Tus 代理转发完成"
    );
}
```

### 4.3 Caddyfile 防退化

当前 Caddyfile `/files` 路由没有显式锁定 HTTP 版本和 flush 策略。虽然当前默认行为已是 HTTP/1.1 + 不缓冲，但显式配置可以防止未来 Caddy 升级或配置变化导致退化。

**修改后**：

```
handle /files* {
  reverse_proxy app:8080 {
    flush_interval -1
    transport http {
      versions 1.1
    }
  }
}
```

- `flush_interval -1`：响应立即刷回浏览器，Tus 的 offset/status 头不延迟。
- `versions 1.1`：显式锁定 HTTP/1.1 到 app，防止未来 Caddy 自动协商 HTTP/2 触发 Hyper 流控瓶颈。

### 4.4 reqwest Client 显式 HTTP/1.1

当前 `src/外壳/mod.rs` 构建 `reqwest::Client` 没有指定 HTTP 版本。虽然到 `http://tusd:1081` 默认是 HTTP/1.1，但显式声明可以防退化。

**修改后**（仅加一行）：

```rust
let http_client = reqwest::Client::builder()
    .http1_only()  // 防止未来 tusd 配置变化触发 HTTP/2 流控瓶颈
    .pool_max_idle_per_host(20)
    .pool_idle_timeout(std::time::Duration::from_secs(90))
    .connect_timeout(std::time::Duration::from_secs(5))
    .timeout(std::time::Duration::from_secs(300))
    .build()
```

**为什么这不会限制其他用途**：当前 `http_client` 的使用场景都是调用 Docker 内网服务（tusd、seeder），全部是 `http://`。如果未来某些用途需要 HTTP/2（如调用外部 HTTPS API），应为该场景构建独立 Client。

---

## 5. 不变量声明

以下条目本 spec **不改变**：

1. app 是 `/files` 的唯一入口 owner，Caddy 不直连 tusd。
2. Tus 协议语义不变——POST/PATCH/HEAD/DELETE 透传，Location 改写保留。
3. 前端 Uppy/Tus 配置不变——chunkSize 32MiB、limit 8、parallelUploads 4（大视频）。
4. tusd 配置不变——`-behind-proxy`、`-max-size 200MiB`、hook 回调到 app。
5. domain/application/contract 零改动。
6. 终止上传 `尝试终止媒体_tus上传` 函数不改——它发 DELETE 没有 body，不受 `into_data_stream` 影响。
7. 其他使用 `http_client` 的场景（协作分发做种、状态查询）不受影响——它们发送的是小 JSON，不是大 body。

---

## 6. 风险与防护

| 风险 | 防护 |
|---|---|
| `collect()` 对超大请求体 OOM | 前端 chunkSize 32MiB + axum DefaultBodyLimit 200MiB 双重限制；最大单次 collect 200MiB，可接受 |
| `collect()` 失败（连接中断、客户端取消） | 显式 `Err` 分支返回 400，不让代理挂起 |
| `http1_only()` 影响其他 HTTP 请求 | 当前所有 `http_client` 用途都是 Docker 内网 `http://`，不需要 HTTP/2 |
| Caddyfile `versions 1.1` 与未来 gRPC 冲突 | `/files` 路由独立配置，不影响其他路由；gRPC 需要时为对应路由单独配置 |
| 修改后 tusd 收到的是完整 body 而非流式 | tusd 默认就是先收完 PATCH body 再写盘，不依赖流式传输 |

---

## 7. TDD 验证规格

### 7.1 Rust 测试

**RED 阶段**：

1. 写 characterization 测试：发送已知大小 body 的 PATCH 到 mock tusd，断言 mock 收到的 body 大小与发送一致。
2. 写吞吐日志测试：发送 PATCH 后日志包含 `content_length_bytes`、`duration_ms`、`throughput_mib_s` 字段。

**GREEN 阶段**：

3. 改 `proxy_tus_upload_transport` 为 `collect + from(Bytes)` 实现。
4. 加吞吐日志。

**REFACTOR 阶段**：

5. 确认 error 分支正确：body 读取失败返回 400 而非 502。
6. 确认 HEAD/OPTIONS 等无 body 方法不触发无谓 collect。

### 7.2 Caddyfile 验证

7. `ops/Caddyfile` 的 `/files` 路由包含 `flush_interval -1` 和 `transport http { versions 1.1 }`。

### 7.3 reqwest Client 验证

8. `src/外壳/mod.rs` 的 `http_client` 构建包含 `.http1_only()`。

### 7.4 真实烟测

9. 本地启动完整栈（`run.ps1` 或 Docker Compose）。
10. 上传一个 10MB 文件，日志中 `throughput_mib_s` 字段值应远大于 0.9（900KB/s 对应约 0.86 MiB/s）。
11. 对比修复前后同一文件的上传吞吐，确认提升。
12. 上传小图片（< 100KB），确认不报错、不退化。
13. 上传大视频（> 32MB，触发 Tus 分片），确认每个 PATCH 都有吞吐日志。
14. 浏览器 Network 面板确认 PATCH 请求速度不再固定在 900KB/s。

---

## 8. 文件改动清单

| 文件 | 改动 | 层 |
|---|---|---|
| `src/媒体/上传/外壳/tus代理.rs` | `into_data_stream + wrap_stream` → `collect + from(Bytes)` + 吞吐日志 | shell |
| `src/外壳/mod.rs` | reqwest Client 加 `.http1_only()` | shell |
| `ops/Caddyfile` | `/files` 路由加 `flush_interval -1` + `transport http { versions 1.1 }` | 基础设施 |

**总改动量**：约 20 行代码 + 5 行 Caddyfile，零新依赖（`http-body-util::BodyExt` 已在依赖树中）。

---

## 9. 成功标准

实现完成后，以下句子必须为真：

**Tus 代理层不再把 32MiB PATCH 拆成 1200 个 27KiB 小 chunk 逐个异步转发；改为一次收集、一次整体发送；吞吐日志能证明代理层转发速率远高于 900KB/s；Caddy 和 reqwest Client 显式锁定 HTTP/1.1 防止未来退化。**

可验收指标：

1. 吞吐日志字段 `throughput_mib_s` 在正常网络下远大于 0.86（900KB/s 等价值）。
2. 同设备同文件对比修复前后，浏览器 Network 面板上传速率有显著提升。
3. 小图小视频上传不报错、不退化。
4. domain/application/contract 零改动。
5. `尝试终止媒体_tus上传` 和其他 `http_client` 用途行为不变。

---

## 10. 自审记录

### 第一遍：需求意图

检查：用户实测证据指向"上传管道本身 900KB/s"，本 spec 是否聚焦在传输管道而非预处理/complete？

修正点：整个 spec 只改 `tus代理.rs` 转发实现 + Caddyfile + reqwest Client，不涉及预处理、hash、complete、强种子。

结论：通过。

### 第二遍：架构边界

检查：是否只改 shell 层 transport 细节，不碰 domain/application/contract？

修正点：第 2、5 节明确边界限定和不变量声明。改动清单只有 shell 层文件。

结论：通过。

### 第三遍：手搓轮子风险

检查：修复方案是否全用成熟生态官方 API，不自己发明 buffer/stream/adapter？

修正点：方案 C 只用 `http-body-util::BodyExt::collect()`、`Collected::to_bytes()`、`reqwest::Body::from(Bytes)`——全是 axum/reqwest 生态标准 API。Caddyfile 用 Caddy 官方 `transport http { versions }` 和 `flush_interval` 配置项。

结论：通过。

---

## 11. 100% 信心循环

问题：我对当前 spec 是否事实 100% 有信心？

第一轮：不是。风险是 `collect()` 对超大请求 OOM。

检查：前端 chunkSize 32MiB + axum DefaultBodyLimit 200MiB 双限，单次 collect 最大 200MiB。前端最大并发 8 个文件，峰值 8 × 32MiB = 256MiB。服务器内存远大于此。第 6 节已写入防护。

第二轮：不是。风险是 HEAD/OPTIONS 等无 body 方法被误收集。

检查：`body.collect()` 对空 body 返回空 `Bytes`，`reqwest::Body::from(Bytes::new())` 是合法空 body。所以无 body 方法不会报错。吞吐日志只在 `content_length > 0` 时记录。不需要方法判断分支。

第三轮：不是。风险是 `http1_only()` 影响做种对账 `http_client.post(seeder_url)` 等其他用途。

检查：当前 `http_client` 所有用途：tus 代理（http://tusd:1081）、做种对账（http://seeder:7073）、tracker 代理（ws://app:8080）。全部是 Docker 内网 HTTP/1.1 场景，不需要 HTTP/2。

第四轮：不是。风险是 Caddy `versions 1.1` 影响 `/api/*` 等其他路由。

检查：配置只在 `handle /files*` 块内，不影响其他路由。

第五轮：现在有事实信心。改动量小、用官方 API、边界清晰、风险已防护、验证可闭环。
