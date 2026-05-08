# DDoS/CC 防御设计 — 应用层纵深防护

> 日期: 2026-05-09
> 状态: 待实现
> 目标: 公网万人实时群聊，源代码层面防 DDoS/CC，正常用户零感知

## 1. 核心原则

1. **正常用户零影响**：发消息、发图、发视频、看图、播放视频的热路径不增加任何延迟
2. **攻击流量快速卸载**：恶意请求在最外层被弹回，永远碰不到 DB 和业务逻辑
3. **自适应难度**：平时无感（~20ms），被攻时自动提升（~5s+），攻击者越打越贵
4. **不手搓轮子**：限流用 governor，密码学用 sha2/hmac（sqlx 传递依赖），新增仅 2 个 crate
5. **不降低性能**：所有防御检查 O(1) 内存操作，零堆分配，零新增 DB 查询

## 2. 部署架构

```
Cloudflare（可选，未来可加）→ Caddy（TLS 终止 + 反代）→ Rust app:8080
```

Caddy 不改动（避免自编译插件），全部防御在 Rust app 层实现。

## 3. 防御分层

### Layer 1: IP 级 HTTP 限流（tower-governor）

- 路径 `/api/*`（含 PoW 端点）: 30 req/s per IP, burst 60
- 路径 `/api/pow/challenge`: 单独 10 req/s per IP
- 豁免路径: `/dist/*`（静态资源）、`/`（首页 HTML）、WebSocket upgrade
- 超限响应: HTTP 429，零 DB 开销

### Layer 2: PoW 自适应门禁

#### 2.1 端点

- `GET /api/pow/challenge` → 返回 `{ algorithm: "SHA-256", salt, difficulty, expires_at, signature }`
- `POST /api/pow/verify` → 验证解题，返回 `{ pow_token }`（HMAC 签名，30s 有效）

#### 2.2 自适应难度

基于 30 秒滑动窗口内的握手请求数，自动调整 difficulty（SHA-256 前导零位数）：

| 30s 窗口请求数 | difficulty | 正常浏览器耗时 | 说明 |
|---------------|-----------|-------------|------|
| < 50 | 8 | ~20ms | 无感 |
| 50 - 500 | 16 | ~200ms | 轻微可感 |
| 500 - 5000 | 20 | ~1-2s | 机器人成本高 |
| > 5000 | 24 | ~5s+ | DDoS 经济不可持续 |

#### 2.3 无状态设计

Challenge 不存储在服务端。salt 和 expires_at 由 HMAC 签名保护：
- 生成: `signature = HMAC-SHA256(server_secret, salt + difficulty + expires_at)`
- 验证: 重新计算 HMAC，比对一致即可信
- 防重放: expires_at 过期即失效

PoW token 同理：`pow_token = HMAC-SHA256(server_secret, "pow" + session_hint + expires_at)`

服务端零状态存储，无内存增长，水平扩展友好。

#### 2.4 server_secret

- 从环境变量 `KOKO_POW_SECRET` 读取，启动时必须存在
- 至少 32 字节随机值，用于 HMAC 签名 challenge 和 pow_token
- 重启换 secret 只会导致在途 token 失效（用户自动重试，无感知）

#### 2.5 客户端真实 IP 获取

- Caddy 作为反代会设置 `X-Forwarded-For` 头
- Rust 层从 `X-Forwarded-For` 最左侧提取客户端 IP（Caddy 是可信代理）
- 环境变量 `KOKO_TRUSTED_PROXY=true` 时启用，默认 false（本地开发直接用 peer_addr）

### Layer 3: Socket.IO 连接层

- `max_socket_count = 10_000`（单节点全局硬顶）
- 单 IP 最大并发连接: 50（DashMap<IpAddr, AtomicU32>，连接时 +1，断开时 -1）
- connect middleware 验证顺序: PoW token HMAC → 未过期 → 单 IP 连接数 → 会话 DB 查询

### Layer 4: 已有业务限流（不改动）

- 每连接消息令牌桶: burst 10, refill 5/s
- 消息文本长度: 2000 Unicode 字符
- 新增: 房间订阅令牌桶 burst 5, refill 1/10s（防单连接狂刷房间查询）

### Layer 5: IP 自动冷却

- DashMap<IpAddr, FailureRecord>
- PoW 验证连续失败 5 次 → 该 IP 冷却 60s
- 冷却期间: 所有 /api/* 请求直接 403，不进入任何业务逻辑
- 条目 TTL 5 分钟，超过 100k 条目时淘汰最旧条目
- 成功请求重置失败计数

## 4. PoW 握手时间线（用户视角）

```
用户打开网页
  ① 浏览器加载页面（静态资源，无门禁）
  ② JS 后台自动请求 GET /api/pow/challenge          ← 与页面渲染并行
  ③ Web Worker 解题 ~20ms                           ← 用户无感
  ④ POST /api/pow/verify → 获得 pow_token
  ⑤ Socket.IO connect({ auth: { session_id, pow_token } })
  ⑥ connect middleware: HMAC 验签(1μs) → 验会话(已有)
  ⑦ 连接建立 → 正常聊天，全程零额外开销
```

断线重连: token 未过期直接复用；过期则后台静默重新解题。

## 5. 性能保证

| 指标 | 保证 |
|------|------|
| 正常消息发送延迟新增 | 0μs（链路不变） |
| 媒体上传/查看/播放延迟新增 | 0μs（链路不变） |
| PoW 服务端验证 | < 5μs（HMAC + SHA256，栈上运算） |
| governor 限流检查 | < 1μs（原子操作） |
| IP 追踪内存上限 | ≤ 10MB（TTL 淘汰） |
| 被攻击时 DB 连接消耗 | 0（攻击流量在 Layer 1-3 全部卸掉） |
| 单核拒绝吞吐 | > 300k req/s（每次拒绝 ~3μs） |

## 6. 依赖变更

### 后端新增 crate

| crate | 用途 | 协议 |
|-------|------|------|
| `governor` | 令牌桶/限流核心 | MIT/Apache-2.0 |
| `tower-governor` | governor 的 axum layer 适配 | MIT |

`sha2`、`hmac` 已是 sqlx 传递依赖，无需显式添加。
`dashmap` 已是 socketioxide 传递依赖，无需显式添加。

### 前端

零新 npm 包。PoW solver 使用浏览器原生 SubtleCrypto API + Web Worker。

## 7. 文件变更范围

### 后端

| 文件 | 变更类型 | 洋葱层 |
|------|---------|--------|
| `src/外壳/连接门禁.rs` | 新增 | adapter |
| `src/外壳/mod.rs` | 修改: 注册 layer + 路由 + max_socket_count | shell |
| `src/实时/外壳.rs` | 修改: connect middleware 加 PoW 验证 + 房间订阅令牌桶 | adapter |
| `Cargo.toml` | 修改: 加 governor, tower-governor | — |

### 前端

| 文件 | 变更类型 |
|------|---------|
| `frontend/src/pow-solver.worker.ts` | 新增: ~30 行 Web Worker |
| `frontend/src/pow-gate.ts` | 新增: ~50 行 challenge→solve→token 管理 |
| 现有 Socket.IO 连接模块 | 修改: 连接前获取 pow_token |

### 不改动

- 消息发送链路、附件批量查询、合并校验 SQL — 全部不动
- 媒体上传(tusd)、图片查看、视频播放(WebTorrent) — 全部不动
- 现有令牌桶、消息长度限制 — 保持原样
- Caddyfile — 不动
- 数据库 schema — 不动（零新表、零新列）

## 8. 攻击场景验证矩阵

| 攻击场景 | 防御层 | 效果 |
|---------|--------|------|
| HTTP CC 洪水打 /api/* | Layer 1 governor | 429 弹回，~1μs/请求 |
| WebSocket 连接洪水 | Layer 2 PoW + Layer 3 连接上限 | 每连接要 ~20ms-5s 算力成本 |
| 单 IP 开数千连接 | Layer 3 单 IP 50 上限 | 超限直接拒绝 |
| 绕过 PoW 伪造 token | Layer 3 HMAC 验签 | 签名不匹配，拒绝 |
| 暴力尝试 PoW | Layer 5 连续失败冷却 | 5 次失败 → 60s 封禁 |
| 消息轰炸（已建立连接） | Layer 4 现有令牌桶 | 超限拒绝 |
| 狂刷房间订阅 | Layer 4 房间订阅令牌桶 | 5次/30s 后拒绝 |
| Slowloris 慢连接 | PoW token 30s 过期 | 过期后握手被拒 |

## 9. 测试策略

- 单元测试: PoW 生成/验证、HMAC 签名/验签、自适应难度计算、IP 冷却逻辑
- 集成测试: governor 限流行为、connect middleware 拒绝无效 token
- 冒烟测试: Playwright 验证正常用户连接流程无感知
- 压力测试: 模拟高频连接验证自适应难度提升
