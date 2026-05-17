# Tus 代理小 chunk 流式转发吞吐瓶颈修复设计

日期：2026-05-17
状态：Design / 等待主人审查

关联：

- `src/媒体/上传/外壳/tus代理.rs`：当前 `/files` 数据面代理入口。
- `tests/媒体上传测试/tus代理流式转发.rs`：现有流式回归测试，只证明首块早到，不证明高吞吐。
- `frontend/媒体/媒体发布.ts`：Uppy/Tus 上传配置，当前大视频 `chunkSize=32MiB`、`parallelUploads=4`。
- `ops/Caddyfile`：正式公网 `/files` 入口，Caddy 仍先反代到 Rust app。
- `ops/compose.yaml`：tusd sidecar 内网部署与 hook 控制面。
- `docs/superpowers/specs/2026-05-16-Tus代理层吞吐瓶颈修复-design.md`：历史 spec，曾正确定位小 chunk，但选了整块 collect。
- `docs/superpowers/plans/2026-05-17-media-tus-streaming-proxy-fix.md`：历史 plan，证明“流式早到”，但没有证明“高吞吐”。

---

## 1. 目标

把媒体 Tus `/files` 上传数据面从“27KiB 级小块原样转发”修成“有界合并后流式转发”，让真实浏览器客户端在公网/局域网条件下能吃满可用上行，而不是被 Rust proxy 的小 chunk poll/write 成本压到约 900KB/s。

本 spec 只设计修复，不直接实施代码。

---

## 2. 已确认事实

### 2.1 用户实测事实

主人用多台设备、多个网络项目、相同环境测试：

- 设备、浏览器、网络、外部条件可以跑到 50Mb/s 以上。
- 只有本项目附件上传稳定约 900KB/s 到 960KB/s。
- 这是设备层真实网络吞吐，不是 UI 等待、complete 后处理或本地显示延迟。

因此根因必须落在本项目真实上传数据面：

```text
浏览器 Uppy/Tus
  -> HTTPS /files
  -> Caddy
  -> Rust app /files proxy
  -> reqwest
  -> tusd sidecar
```

### 2.2 当前源码事实

`src/媒体/上传/外壳/tus代理.rs` 当前核心转发代码：

```rust
let upstream_response = match upstream_request
    .body(reqwest::Body::wrap_stream(body.into_data_stream()))
    .send()
    .await
```

这条路径的语义是：

- Axum/Hyper 把请求体暴露成 `into_data_stream()`。
- `reqwest::Body::wrap_stream()` 把 stream item 映射成 HTTP body frame。
- reqwest 源码中 `wrap_stream` 只是调用 `Body::stream(stream)`，再 `map_ok(|d| Frame::data(Bytes::from(d)))`。
- 没有自动把多个小 `Bytes` 合成大块。

### 2.3 历史回归事实

Git 历史显示同一问题已经发生过一次：

- `fea9c8f4`：`修复: Tus代理层吞吐瓶颈——消除小chunk流式转发+强制HTTP/1.1`
  - 提交说明明确写出 900KB/s、约 27KiB 小 chunk、每个 32MiB PATCH 约 1200 次 async poll/write。
  - 当时用 `body.collect().await -> reqwest::Body::from(Bytes)` 消除了小 chunk。
- `7309e356`：`fix: 将媒体 Tus 代理改为流式转发上传请求体`
  - 为避免完整 buffering，又改回 `wrap_stream(body.into_data_stream())`。
  - 现有测试只证明“sidecar 在客户端 body 结束前收到首块”，没有证明 chunk 合并或吞吐。

结论：当前 main 回到了历史上导致 900KB/s 的小 chunk 流式代理路径。

### 2.4 本地快速测试不能否定用户实测

本地 Chromium HTTPS 探针上传 154,271,730 byte MP4 时：

- 浏览器发了 4 个 partial 并行。
- 首轮 4 个 32MiB PATCH 约 2.77s 到 2.88s。
- 聚合约 44.38MiB/s。
- browser -> Caddy 协议为 h2。
- 后端日志单流约 11MiB/s，4 路聚合约 44MiB/s。

这只能证明同机低 RTT 场景可以跑快。它不能否定真实设备/公网路径下，小 chunk + HTTP/2 flow control + backpressure 被放大成 900KB/s。

---

## 3. 非目标

本轮不做这些事：

- 不修改 media domain/application/contract 真相。
- 不改变 `/files` 浏览器公开 contract。
- 不让 Caddy 正式直连 tusd 绕过 Rust app。
- 不新增自研上传协议。
- 不新增队列、磁盘临时缓存、重试层或私有断点续传状态。
- 不回到整文件或无界内存读取。
- 不把 complete 的 hash/torrent/store 后处理混进本问题。
- 不用本机 synthetic client 结果替代真实浏览器/真实设备证据。

---

## 4. 架构边界

| 层 | 本 spec 是否改变 | 说明 |
|---|---:|---|
| domain | 否 | 附件、消息、媒体状态不变。 |
| application | 否 | prepare / hook / complete 用例不变。 |
| contract | 否 | `/files`、Tus header、Location 改写后的浏览器入口不变。 |
| adapter/shell | 是 | 只改 Rust Tus proxy 的 HTTP body 转发实现与观测。 |
| deployment shell | 只验证 | Caddy/tusd 配置作为对照验证对象，不先改正式架构。 |

核心原则：业务真相仍由 Rust app 和 tusd hook 控制面裁决；上传字节的数据面必须高吞吐、可背压、可观测、不会 OOM。

---

## 5. 文件结构与职责

后续实施应优先在现有文件内收口，避免新增无 owner 的碎片文件：

- `src/媒体/上传/外壳/tus代理.rs`
  - 保留 `/files` proxy owner。
  - 新增有界合并流 helper。
  - 新增合并块统计字段。
  - helper 默认保持私有；测试若需要直接覆盖 helper，优先放在同文件 `#[cfg(test)]` 单元测试里，不把它提升成 contract。
- `tests/媒体上传测试/tus代理流式转发.rs`
  - 保留集成层“客户端 body 未结束时 sidecar 已收到数据”的回归测试。
  - 不承担 chunk size 断言，因为 TCP/Hyper 可能改变 frame 边界。
- `tests/媒体上传测试.rs`
  - 只在测试模块挂载缺失时修改。
- `Cargo.toml`
  - 只在实施发现当前依赖能力不够时修改；当前 `reqwest` 已启用 `stream` feature。

---

## 6. 方案比较

### 6.1 方案 A：保持当前 `wrap_stream(body.into_data_stream())`

优点：

- 代码最少。
- 完全流式，不完整驻留单个 PATCH。

失败点：

- 已被历史 commit 和当前调查证明会把 32MiB PATCH 拆成大量小块。
- 真实网络中小块 poll/write 成本会被 RTT、HTTP/2 flow control、反代背压放大。
- 现有测试只证明“早到”，无法证明“快”。

裁决：拒绝。

### 6.2 方案 B：回到 `body.collect().await -> Body::from(Bytes)`

优点：

- 消除小 chunk，历史上能改善吞吐。
- 实现简单。

失败点：

- 每个 32MiB PATCH 完整驻留 Rust app 内存。
- 大视频 4 partial 并行至少 128MiB 请求体常驻；多文件并发时更高。
- 与项目性能/OOM 红线冲突：不能用整块缓冲换吞吐。
- 浏览器 -> app 和 app -> tusd 两段被串行化。

裁决：拒绝作为最终方案。只能作为历史对照，不再落地。

### 6.3 方案 C：Caddy `/files` 直连 tusd

优点：

- 直接绕过 Rust proxy 数据面。
- 去掉 Rust proxy 后会显著降低代理层 CPU/poll/write 开销。

失败点：

- 会把 `/files` 入口 owner 从 Rust app 切到 Caddy/tusd 组合。
- Location 改写、错误转码、未来审计/鉴权/配额边界会分裂。
- 当前项目要求浏览器公开 contract 继续由后端同源代理收口。

裁决：暂不作为本轮修复。可作为只读对照测试，用来证明 Rust proxy 是否是瓶颈。

### 6.4 方案 D：有界合并后流式转发

做法：

```text
当前：27KiB, 27KiB, 27KiB, ... -> reqwest 原样发送
目标：27KiB 小块进入 Rust -> 合并到约 512KiB -> reqwest 流式发送
```

优点：

- 保留流式，不等待完整 32MiB PATCH。
- 每个请求只持有一个有界合并缓冲，不会整块 OOM。
- 把约 1200 次小块发送降到约 64 次 512KiB 级发送。
- 仍走 Rust app `/files`，不破坏统一入口和 Location 改写。
- 可用纯 stream 单元测试证明输出 chunk size，不依赖网络栈是否保留帧边界。

成本：

- 需要一个很小的 body coalescing adapter。
- 必须用测试锁死：有界内存、早到、错误传播、内容字节不变。

裁决：选中。

---

## 7. 详细设计

### 7.1 合并策略

新增一个仅供 Tus proxy 使用的有界合并流：

```text
输入：Stream<Item = Result<Bytes, E>>
输出：Stream<Item = Result<Bytes, E>>
目标输出块：512KiB
内存上限：单请求只持有当前合并 buffer；遇到大于目标的输入块时直接透传。
```

规则：

1. 如果当前 buffer 为空，且输入 chunk 大于等于 512KiB，直接输出该 chunk，不复制。
2. 如果输入 chunk 小于 512KiB，追加到当前 buffer。
3. 当前 buffer 达到或超过 512KiB 后输出一个 `Bytes`。
4. 上游结束时，输出剩余 tail。
5. 上游读 body 出错时，立刻把错误传给 reqwest body stream。
6. 不创建后台任务、不建队列、不写临时文件、不缓存完整 PATCH。

建议常量名：

```rust
const TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES: usize = 512 * 1024;
```

512KiB 的取舍：

- 比 27KiB 小块大约 19 倍，能把 32MiB PATCH 的转发次数压到约 64 次。
- 比 1MiB 更早把首个合并块送到 tusd，慢网下首块等待时间更短。
- 单请求额外内存上限足够低，8 个并发请求也只增加约 4MiB 合并缓冲。

命名可在实施时按现有中文风格调整，但语义必须保持：这是 adapter/shell 的传输块合并目标，不是业务分片大小。

### 7.2 Proxy 转发路径

`proxy_tus_upload_transport` 保持现有职责：

- 归一化 `/files` path。
- 转发 method/header。
- 保留 `Content-Length`、`Tus-Resumable`、`Upload-Offset`、`Upload-Concat` 等 Tus 头。
- reqwest client 继续 `.http1_only()`。
- 继续改写 upstream `Location` 到浏览器同源入口。
- sidecar 不可达继续返回 `502 + media_tus_upstream_unreachable`。

唯一核心变化：

```text
body.into_data_stream()
  -> bounded coalescing stream
  -> reqwest::Body::wrap_stream(...)
```

禁止变化：

```text
body.collect().await
Body::from(完整 PATCH)
临时文件中转
Caddy 直连作为正式路径
```

### 7.3 观测设计

现有日志只记录整个 PATCH 的 declared content length、duration、throughput。需要补上能定位小 chunk 的观测，但不能在热路径每个 chunk 打日志。

每个 PATCH 结束时记录一条摘要：

- `declared_content_length_bytes`
- `duration_ms`
- `throughput_mib_s`
- `coalesced_chunk_count`
- `coalesced_min_chunk_bytes`
- `coalesced_max_chunk_bytes`
- `coalesced_avg_chunk_bytes`

这些统计只在内存里维护几个整数，不记录每个 chunk，不产生日志风暴。

成功目标：32MiB PATCH 的 `coalesced_chunk_count` 应接近 64，而不是约 1200。

### 7.4 错误语义

请求体读取失败属于客户端请求体/连接问题，不能伪装成 tusd 业务失败。

要求：

- 如果 body stream 在发送过程中出错，日志里必须能看出是 `client_body_stream_error` 或等价字段。
- 对前端响应可以沿用当前 `502` 的稳定失败路径，但日志分类不能再只写 `upstream_unreachable`。
- 不新增前端错误码 contract，除非实施时发现现有错误码完全无法表达。

---

## 8. TDD 验收设计

### 8.1 RED：小块合并单元测试

新增或调整测试，直接测试合并流，不依赖 TCP/Hyper 是否保留 frame 边界。

输入：

```text
32MiB body, 每个输入 chunk = 27KiB
```

期望：

```text
输出总字节数仍为 32MiB
输出 chunk 数 <= 80
除最后一个 tail 外，每个输出 chunk >= 512KiB
内存不需要完整收集 32MiB
```

当前实现没有合并流，这个测试应先 RED。

### 8.2 RED：仍然保持首块早到

保留并升级现有 `媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar`。

要求：

- 测试输入的第一段必须达到 `TUS_PROXY_FORWARD_CHUNK_TARGET_BYTES`，然后人为阻塞第二段。
- fake tusd 必须在第二段释放前收到第一段合并输出。
- 这证明方案没有退化回 `body.collect().await`。
- 不能继续用 11 字节首块做早到断言；小于合并阈值的小文件允许在 body 结束时 flush tail。

### 8.3 GREEN：proxy 行为不变

已有行为必须继续通过：

- `/files` 和 `/files/{tail}` 都进入 `proxy_tus_upload_transport`。
- `Location` header 继续改写到浏览器入口。
- `Tus-Resumable` 等协议头继续透传。
- sidecar 不可达仍返回稳定错误响应。

### 8.4 性能冒烟

必须做真实浏览器 HTTPS 冒烟，不接受只跑 cargo。

最小闭环：

1. 用真实 Chromium 上传同一个 154,271,730 byte MP4。
2. 捕获 `/files` POST/PATCH 请求数、duration、protocol、Tus headers。
3. 查看 Rust backend 日志里每个 PATCH 的：
   - `throughput_mib_s`
   - `coalesced_chunk_count`
   - `coalesced_avg_chunk_bytes`
4. 对比旧数据：
   - 旧：单流约 11MiB/s，本机 4 路聚合约 44MiB/s，但真实设备约 900KB/s。
   - 新：真实设备链路不应再稳定卡在 900KB/s；如果仍卡住，进入 Caddy/tusd 直连对照测试。

---

## 9. 分层对照测试设计

如果修复后真实设备仍慢，按顺序做只读对照：

### 9.1 Rust raw sink

临时测试入口只读取请求体并丢弃，不转发 tusd。

判断：

- raw sink 快，`/files` 慢：瓶颈在 Rust -> tusd forwarding 或 Tus sidecar。
- raw sink 也慢：瓶颈在浏览器 -> Caddy -> Rust 接收段。

### 9.2 tusd direct

临时内网/测试环境让浏览器直连 tusd，不作为正式架构。

判断：

- tusd direct 快，full `/files` 慢：Rust proxy 是瓶颈。
- tusd direct 也慢：tusd、磁盘或前端 Tus 配置继续调查。

### 9.3 Caddy runtime 配置对照

正式 `ops/Caddyfile` 对 `/files` 有专项 route；本地 `https.ps1` 生成的 runtime Caddyfile 是泛化反代。

判断：

- 本地和正式 Caddy 行为不一致时，不能用本机 HTTPS 结果替代公网结论。
- 如果需要改 `https.ps1`，应单独提交为本地冒烟环境一致性修复。

---

## 10. 完成标准

本 spec 对后续实现的完成标准是：

1. 代码中不再出现 `body.collect().await` 或 `Body::from(body_bytes)` 作为 Tus PATCH 主路径。
2. 代码中不再把 `body.into_data_stream()` 原样直接传给 `reqwest::Body::wrap_stream()`。
3. 存在有界合并流，目标输出块约 512KiB，单请求不完整持有 32MiB PATCH。
4. 单元测试证明 27KiB 输入被合并成大块输出，且字节总量不变。
5. 集成测试证明 sidecar 在客户端请求体结束前收到数据，未退化为完整 buffering。
6. 现有 Tus proxy 路由、Location 改写、header 透传、sidecar 错误转码测试通过。
7. HTTPS 真实浏览器上传冒烟完成，并拿到 PATCH 日志中的合并块统计。
8. 如果真实设备仍卡 900KB/s，必须按第 9 节继续分层对照，而不是直接宣称修复完成。

---

## 11. 风险与防线

| 风险 | 防线 |
|---|---|
| 合并 buffer 变成完整 PATCH 缓冲 | 常量固定 512KiB，测试断言输出 chunk 数和早到行为。 |
| 为吞吐牺牲内存安全 | 禁止 `collect()`，禁止无界 Vec，禁止后台队列。 |
| 网络栈重新切小块导致测试不稳定 | chunk size 测试放在合并流单元层，不依赖 TCP frame。 |
| 错误都被报成 tusd 不可达 | 日志分类区分 client body stream error 和 upstream unreachable。 |
| Caddy/tusd 才是真瓶颈 | 保留 raw sink 和 tusd direct 对照测试。 |
| 计划再次把“流式”误判为“高吞吐” | 完成标准同时要求早到、chunk 合并统计、真实浏览器 HTTPS 冒烟。 |

---

## 12. 后续实施入口

本 spec 通过审查后，下一步写新的 implementation plan，旧 plan `2026-05-17-media-tus-streaming-proxy-fix.md` 不应继续执行。

新的 plan 应按 TDD 顺序组织：

1. RED：新增合并流单元测试。
2. RED：保留/升级首块早到集成测试。
3. GREEN：实现有界合并流并接入 `proxy_tus_upload_transport`。
4. REFACTOR：收敛日志统计和错误分类。
5. VERIFY：cargo targeted tests、Tus 相关回归、HTTPS 真实浏览器上传冒烟、日志证据。
6. COMMIT：只提交本次 spec/plan/代码改动，不带入已有 `AGENTS.md`、`CLAUDE.md` 脏改。
