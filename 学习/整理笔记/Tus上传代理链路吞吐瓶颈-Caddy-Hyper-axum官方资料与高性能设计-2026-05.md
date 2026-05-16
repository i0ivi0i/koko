# Tus 上传代理链路吞吐瓶颈——Caddy / Hyper / axum 官方资料与高性能设计（2026-05）

## 这份笔记只记什么

**当前 koko 上传附件只有 900KB/s，同设备同网络其他项目能跑 50MB/s。开始 Tus PATCH 上传后就稳定 900KB/s，整个上传过程不超过。** 这份笔记只围绕"上传管道本身为什么慢"，聚焦 Caddy 反代、Hyper/h2 HTTP/2 流控、axum body stream、reqwest 转发这条链路的官方资料和成熟设计。

不涉及：WebP/MP4 预处理、source hash、complete 后处理、WebTorrent 分发（这些已有其他笔记覆盖）。

## 1. 结论先行

当前 koko 上传链路是：

```
浏览器 Uppy/Tus PATCH 32MiB
  → Caddy（HTTPS/HTTP2 对外）
  → app:8080（axum/Hyper）
  → Rust tus代理.rs（reqwest Body::wrap_stream → tusd:1081）
  → tusd 写盘
```

基于官方资料，最可疑的三层瓶颈：

| 层 | 嫌疑 | 官方证据 |
|---|---|---|
| **Caddy → app** | Caddy 对 HTTP 反代默认不缓冲请求体，但未显式配置 `flush_interval -1` 和 `transport http { versions 1.1 }`，可能协商到 HTTP/2 | Caddy 官方文档、tusd#444 |
| **app 接收层** | axum 默认用 Hyper，HTTP/2 下 `initial_window_size` 默认极小（stream 1MB / connection 2MB），大 PATCH 被流控压死 | hyper#1813（HTTP/2 比 HTTP/1 慢 170 倍）、h2#797（窗口大小严重影响吞吐） |
| **app → tusd 转发** | `body.into_data_stream()` 已知产出 27KiB 小 chunk，reqwest 默认可能协商 HTTP/2 到 tusd | axum#2107、SO#79837924、reqwest 默认行为 |

**三层叠加，50MB/s 设备跑出 900KB/s 完全说得通。**

## 2. Caddy 反代层

### 2.1 Caddy 默认不缓冲 HTTP 请求体（排除主因）

Caddy 对普通 HTTP `reverse_proxy` **默认不缓冲请求体**（只有 FastCGI 默认缓冲）。所以 Caddy 不是"先把 32MiB 吃完再转"——但它也不代表完全无问题。

来源：Caddy PR#6639、PR#6759、官方文档 `buffer_requests` 说明

### 2.2 但 Caddy → app 可能协商 HTTP/2

当前 Caddyfile：

```
handle /files* {
  reverse_proxy app:8080
}
```

没有显式 `transport http { versions 1.1 }`。Caddy 对 `http://` 后端默认走 HTTP/1.1（因为无 TLS 无 ALPN），所以这层实际上**应该是 HTTP/1.1**。但如果未来架构变化或配置变化，这里值得显式锁定。

### 2.3 `flush_interval` 对上传的影响

`flush_interval` 主要控制 **响应体** 的刷新频率，不是请求体。对上传吞吐影响有限，但设置 `-1` 可以确保响应（包括 Tus 返回头）立即刷回浏览器，减少浏览器等待下一个 PATCH 的延迟。

来源：Caddy 官方文档 `reverse_proxy` → Streaming → `flush_interval`

### 2.4 Caddy 层当前结论

**Caddy 大概率不是 900KB/s 的第一嫌疑**（因为默认流式、默认 HTTP/1.1 到内网后端），但值得加上显式配置确保不退化。

## 3. Hyper/h2 HTTP/2 流控层（最高嫌疑）

### 3.1 HTTP/2 上传比 HTTP/1 慢 170 倍

`hyperium/hyper#1813` 明确记录：

> HTTP/2 下 request body 上传，10MB body 只有 0.2 req/s（vs HTTP/1 的 35 req/s）。并行请求甚至直接挂起。

这是 Hyper 底层行为，axum 直接继承。

来源：https://github.com/hyperium/hyper/issues/1813

### 3.2 h2 窗口大小默认值极小

Hyper 服务端默认值：
- **stream window**: 1 MB（`SETTINGS_INITIAL_WINDOW_SIZE`）
- **connection window**: 2 MB
- **max frame size**: 16 KB

这意味着：一个 32MiB 的 Tus PATCH，在 HTTP/2 下需要几十次窗口扩张往返才能传完。每次窗口更新都有 RTT 延迟。

来源：hyper 源码默认值、https://github.com/hyperium/h2/issues/797

### 3.3 TLS + HTTP/2 窗口交互更糟

`h2#797` 的基准测试显示：TLS 环境下，不同窗口配置吞吐差异可达 **2x-15x**。小窗口 + TLS 可以把吞吐从 15Gbps 压到 2Gbps。

### 3.4 推荐调优参数

成熟项目（如 pbs-cloud 备份工作负载）推荐：

```
initial_stream_window_size = 32 MB
initial_connection_window_size = 64 MB
max_concurrent_streams = 100
max_frame_size = 16 MB
```

来源：https://github.com/haasonsaas/pbs-cloud/commit/5f0d776

### 3.5 koko 当前情况

koko 用 `axum::serve(listener, app)` 启动，**没有任何 HTTP/2 窗口调优**。但关键问题是：

**Caddy 到 app:8080 是 `http://`（无 TLS），所以不会 ALPN 协商 HTTP/2。axum::serve 对明文 HTTP 默认只服务 HTTP/1.1。**

这意味着 Caddy → app 这跳实际上是 HTTP/1.1，Hyper HTTP/2 流控**不影响这跳**。

### 3.6 但 app → tusd 可能有 HTTP/2 问题

`reqwest::Client` 默认行为：
- 对 `http://` 目标：默认 HTTP/1.1（不会自动升级到 h2c）
- 对 `https://` 目标：会通过 ALPN 尝试 HTTP/2

当前 `tus_internal_base_url = "http://tusd:1081"`，所以 **reqwest 到 tusd 也是 HTTP/1.1**。

### 3.7 HTTP/2 层当前结论

**在当前架构下（全链路 http://），HTTP/2 流控大概率不是 900KB/s 的直接原因。** 但这条链路如果任何环节改成 HTTPS，就会立即触发 HTTP/2 流控瓶颈，必须提前防范。

## 4. axum `body.into_data_stream()` + reqwest 转发层（最高嫌疑）

### 4.1 已知小 chunk 问题

StackOverflow#79837924 和 axum#2107 记录：

> `body.into_data_stream()` 从 HTTP body 中读取数据时，平均 chunk 大小只有 **27KiB**。8MiB 数据要 80ms 才能读完。

根因在 Hyper 底层的 body polling 行为，不是 axum bug。

来源：
- https://stackoverflow.com/questions/79837924
- https://github.com/tokio-rs/axum/issues/2107

### 4.2 koko 当前代码

```rust
// tus代理.rs 第 60-62 行
upstream_request
    .body(reqwest::Body::wrap_stream(body.into_data_stream()))
    .send()
```

这正好命中了上述问题：
1. `body.into_data_stream()` 产出大量 27KiB 小 chunk
2. `Body::wrap_stream()` 把这些小 chunk 逐个包装成 reqwest body
3. reqwest 逐个小 chunk 发给 tusd
4. 每个小 chunk 都有 async poll + 系统调用开销

**32MiB PATCH 被切成约 1200 个 27KiB 小 chunk 转发，每次 poll + write 的固定开销叠加起来就是严重限速。**

### 4.3 更优的转发方式

Adam Chalmers 的 benchmark（https://blog.adamchalmers.com/streaming-proxy/）证明：

| 方式 | 耗时 | 内存 |
|---|---|---|
| 缓冲整个 body 再转发 | 0.32s | 128MB |
| 流式 stream 转发 | 0.10s | 16MB |

但即使是流式，如果底层 chunk 太小，吞吐仍然上不去。

### 4.4 可能的优化方向

1. **直接透传 axum Body 给 reqwest**：不经过 `into_data_stream()`，而是直接把 axum 的 `Body` 转成 reqwest 可接受的 body 类型。
2. **增大内部缓冲**：在 stream 外层加一层 buffer，把多个 27KiB chunk 合并成更大的 write。
3. **用 `Bytes` 收集后批量发**：对单个 PATCH 来说，32MiB 全读入内存再一次性发给 tusd 是可接受的（tusd 在本机 Docker 网络内）。
4. **跳过 Rust 代理层**：直接让 Caddy 把 `/files` 转给 tusd:1081（但这违反当前架构边界）。

### 4.5 转发层当前结论

**`body.into_data_stream()` 的小 chunk 问题是当前 900KB/s 的第一嫌疑。** 32MiB body 被切成上千个 27KiB 小 chunk 逐个异步 poll + 转发，叠加系统调用和 tokio 调度开销，吞吐被严重压低。

## 5. tusd 官方反代配置要求

tusd 官方文档和 FAQ 明确要求反代层：

1. **禁用请求缓冲**（Nginx: `proxy_request_buffering off`）
2. **启用 `-behind-proxy` 标志**（已配置 ✓）
3. **调大请求体上限**（已配置 200MiB ✓）
4. **转发 X-Forwarded-Host/Proto**（Caddy 默认做 ✓）
5. **HTTP/2 可能导致 20 倍减速**（Nginx 场景，当前 Caddy 到 app 是 HTTP/1.1 不受影响）

来源：
- https://tus.github.io/tusd/getting-started/configuration/
- https://github.com/tus/tusd/issues/1106
- https://github.com/tus/tusd/issues/444

## 6. Telegram 高速上传设计参考

Telegram 的文件上传设计：

1. **文件分片 + 并发多线程**：4-24 个线程动态分配，小文件少线程避免开销，大文件多线程吃满带宽
2. **chunk 大小有严格对齐**：必须 1KB 整除、512KB 必须被 chunk 大小整除
3. **全球多数据中心就近接入**：负载均衡路由到最近节点
4. **MTProto 自研协议**：二进制编码 + 多传输协议自动降级（TCP/UDP/HTTP/WebSocket）
5. **异步 I/O**：同时处理上百个并发文件传输不阻塞

来源：
- https://blogfork.telegram.org/api/files
- https://github.com/telegramdesktop/tdesktop/pull/6442

**对 koko 的启发**：不是说要手搓 MTProto，而是说顶级 IM 的上传核心是"分片 + 并发 + 就近 + 异步不阻塞"。koko 当前的 Tus 代理层正好在"异步不阻塞"这条上有问题。

## 7. reqwest Client 强制 HTTP/1.1 方法

如果需要禁用 HTTP/2：

```rust
let client = reqwest::Client::builder()
    .http1_only()
    .build()?;
```

注意：`.version(reqwest::Version::HTTP_11)` 对单个请求设置**不可靠**，因为 ALPN 在 TLS 层先于请求版本协商。必须在 ClientBuilder 层用 `http1_only()`。

来源：
- https://github.com/seanmonstar/reqwest/issues/2116
- https://github.com/seanmonstar/reqwest/issues/2343

## 8. Caddy 强制 HTTP/1.1 到后端的方法

```
handle /files* {
  reverse_proxy app:8080 {
    transport http {
      versions 1.1
    }
  }
}
```

来源：Caddy 官方文档 `reverse_proxy` → `transport` → `versions`

## 9. 综合根因排序

| 优先级 | 嫌疑点 | 置信度 | 修复方向 |
|---|---|---|---|
| **P0** | `into_data_stream()` 27KiB 小 chunk 逐个转发 | 最高 | 绕过 data_stream，直接透传或批量缓冲 |
| **P1** | 全链路无吞吐日志，无法分段定位 | 高 | 加 PATCH bytes/duration/MB/s 日志 |
| **P1** | Caddy/reqwest 未来如果切 HTTPS 会触发 HTTP/2 流控 | 中 | 显式锁 HTTP/1.1 + 调窗口 |
| **P2** | tusd 写盘可能是瓶颈之一 | 待验证 | 先加日志再判断 |

## 10. 对 koko 下一步的直接建议

### 必须先做

1. **给 `tus代理.rs` 加 PATCH 吞吐日志**：`method/upload_offset/content_length/duration_ms/throughput_mib_s`
2. **评估绕过 `into_data_stream()`**：要么直接透传 axum Body，要么 PATCH 级别先收集到 Bytes 再一次性发（32MiB 内存可接受）
3. **Caddyfile 显式锁 HTTP/1.1 + flush_interval -1**：防退化

### 暂时不该做

1. 没有日志数据前就改 Tus 配置参数
2. 为了"像高性能"就跳过 Rust 代理层直连 tusd（违反架构边界）
3. 在没有证据前就做全局 HTTP/2 窗口调优（当前链路是 HTTP/1.1）

## 10.5 补充：Cloudflare HTTP/2 上传减速（2026-05-16 追加）

Cloudflare 官方 2020 年博客 `Delivering HTTP/2 upload speed improvements` 记录了一个关键事实：

> HTTP/2 上传速度在快网络上可能只有 HTTP/1.1 的一半，因为 HTTP/2 接收端流控窗口（INITIAL_WINDOW_SIZE）太小。

NGINX 默认 64KB 窗口 + 128KB 缓冲，在高 BDP（带宽延迟积）链路上严重限速。Cloudflare 通过 HTTP/2 接收缓冲自动调优解决了此问题（已全网部署）。

**对 koko 的影响**：

如果用户的上传流量经过 Cloudflare 橙云代理（orange cloud），Cloudflare 已经部署了 HTTP/2 上传自动调优，不应是瓶颈。但如果用户直连 Caddy（灰云 / DNS-only），则 Caddy 的 Go HTTP/2 实现的流控窗口行为成为一个嫌疑。

Go 的 `net/http2` 默认 stream window = 1MB、connection window = 1MB，比 NGINX 的 64KB 大很多。在 RTT < 200ms 的链路上，1MB 窗口理论吞吐 > 5 MB/s，不应是 900KB/s 的原因。但需要实测确认。

**关键判断**：Cloudflare/Caddy HTTP/2 流控是否是 900KB/s 的原因，目前无法仅靠源码分析确定，必须依赖吞吐日志分段定位。这也是为什么 plan 第一步必须加日志。

来源：https://blog.cloudflare.com/delivering-http-2-upload-speed-improvements/

## 11. 官方来源汇总

### Caddy
- Caddy reverse_proxy 官方文档：https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy PR#6639（FastCGI 缓冲）：https://github.com/caddyserver/caddy/pull/6639
- tusd behind Caddy #444：https://github.com/tus/tusd/issues/444
- Caddy transport versions：https://github.com/caddyserver/caddy/issues/7111

### Hyper / h2
- hyper#1813（HTTP/2 request body 慢 170 倍）：https://github.com/hyperium/hyper/issues/1813
- h2#797（窗口大小严重影响 TLS 上传吞吐）：https://github.com/hyperium/h2/issues/797
- h2#879（receive loop 垄断 task）：https://github.com/hyperium/h2/issues/879
- hyper HTTP/2 builder 文档：https://docs.rs/hyper/latest/hyper/server/conn/http2/struct.Builder.html
- pbs-cloud 大窗口配置：https://github.com/haasonsaas/pbs-cloud/commit/5f0d776

### axum
- axum#2107（streaming chunked response 性能）：https://github.com/tokio-rs/axum/issues/2107
- axum Discussion#1821（代理大文件最佳实践）：https://github.com/tokio-rs/axum/discussions/1821
- SO#79837924（into_data_stream 27KiB chunk）：https://stackoverflow.com/questions/79837924
- Adam Chalmers streaming proxy benchmark：https://blog.adamchalmers.com/streaming-proxy/
- axum-reverse-proxy crate：https://crates.io/crates/axum-reverse-proxy

### reqwest
- reqwest#1290（禁用 HTTP/2 升级）：https://github.com/seanmonstar/reqwest/issues/1290
- reqwest#2116（ALPN 覆盖版本设置）：https://github.com/seanmonstar/reqwest/issues/2116
- reqwest#1199（POST 慢传输速率）：https://github.com/seanmonstar/reqwest/issues/1199

### tusd
- tusd 配置文档：https://tus.github.io/tusd/getting-started/configuration/
- tusd#1106（Nginx HTTP/2 导致 20 倍减速）：https://github.com/tus/tusd/issues/1106
- tus-js-client#759（为什么上传速度低于 3Mbps）：https://github.com/tus/tus-js-client/issues/759

### Telegram
- Telegram 文件上传 API：https://blogfork.telegram.org/api/files
- tdesktop 并发上传 PR#6442：https://github.com/telegramdesktop/tdesktop/pull/6442
- MTProto 架构分析：https://chyshkala.com/blog/inside-telegram-s-mtproto-why-building-custom-media-downloaders-reveals-better-system-architectu

### tus-js-client / Uppy
- tus-js-client API（chunkSize/parallelUploads）：https://github.com/tus/tus-js-client/blob/main/docs/api.md
- Uppy Tus 文档：https://uppy.io/docs/tus/
- tus 协议 1.0.0：https://tus.io/protocols/resumable-upload
