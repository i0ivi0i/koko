# WebTorrent 成熟 Tracker 替换与 Dev Tracker 退场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用成熟高性能 WebTorrent tracker 替换当前 `frontend/dev-tracker.mjs` 里的自写 tracker 胶水，让 `koko` 只保留业务授权、同源代理、启动编排和观测接线，不继续手搓 tracker 核心。

**Architecture:** 成熟 tracker 只负责 WebTorrent/WebRTC signaling、swarm peer 管理和 stats；Rust 后端 `/api/swarm/announce` 只做首帧 `join_ticket` 校验和 WebSocket 字节转发，禁止维护 peer 列表、offer 路由或第二套 swarm 状态。媒体身份、房间权限、附件可见性、`source_hash / content_hash / infoHash / swarm_id` 继续由领域/用例层拥有，tracker 永远只是基础设施。

**Tech Stack:** Rust 2024 + Axum WebSocket proxy + jsonwebtoken；PowerShell launcher；Node.js 25+；`wt-tracker` / `bittorrent-tracker` / `aquatic_ws` 候选评估；WebTorrent / WebRTC；Vitest；Cargo integration tests；`chrome-devtools-cli` HTTPS multi-context smoke.

---

## 0. 硬约束与结论

这次不是“把 `dev-tracker.mjs` 改好一点”。这次的目标是：

1. 成熟 tracker 负责 WebTorrent signaling。
2. Rust 后端负责业务授权和入场门禁。
3. `dev-tracker.mjs` 退场，禁止继续成为 tracker 核心。
4. 不牺牲现有满血业务功能。
5. 不新增冗余并行路径。

当前候选结论：

1. `wt-tracker` 是本计划第一候选：高性能 WebTorrent tracker，官方 README 明确写了 WSS/WS、uWebSockets.js、大连接数、`/stats.json`。
2. `aquatic_ws` 是 Linux 公网生产后续候选：Rust、高性能、Prometheus、allow/deny info hash，但本地 Win11 开发烟测不适合作为第一落地。
3. `bittorrent-tracker` 是当前已用成熟轮子：支持 WebSocket tracker CLI 和 `/stats`，可作为回退基线，但不应继续加厚 `dev-tracker.mjs`。

硬裁决：

**如果 `wt-tracker` 不能在当前开发环境跑通，或不能在不手搓 tracker 协议核心的前提下保住 `join_ticket` 门禁，本计划必须停止在候选验证阶段，不允许为了“换轮子”破坏权限和现有业务。**

执行修正记录：

1. `wt-tracker@0.0.1` 的 npm 包在本机验证时缺少 `dist/run-uws-tracker.js`，CLI 无法启动，触发第一候选停止条件。
2. 本轮不回退到自写 tracker，而是落地计划中已有成熟回退基线：官方 `bittorrent-tracker@11.2.2` CLI。
3. 由于 `bittorrent-tracker` 官方 CLI 暴露的是 `/stats`，本轮验收接受 `/stats` 作为成熟轮子的等价观测入口；`/stats.json` 作为 `wt-tracker` / 未来生产候选能力继续保留在后续评估项。
4. `join_ticket` 门禁已经迁到 Rust `/api/swarm/announce` 首帧验票代理，成熟 tracker 不接收业务密钥、不拥有业务权限真相。

---

## 1. 设计四问

### 1.1 权威真相在哪里决定

1. 媒体资产、附件、消息、房间权限、附件可见性：Rust domain/application/usecase。
2. `join_ticket` 签发和验证：Rust 后端。
3. `infoHash / swarm_id`：媒体身份层。
4. peer 发现和 WebRTC signaling：成熟 tracker 轮子。
5. sidecar 做种是否启动：Rust 后端 owner 通过 seeder control plane 裁决。

禁止：

1. 禁止 tracker 决定房间权限。
2. 禁止前端决定附件是否可见。
3. 禁止 `wt-tracker` 或 `aquatic_ws` 变成业务权限 owner。
4. 禁止 Rust 代理维护 peer 列表或转发 offer 逻辑。

### 1.2 稳定交换契约是什么

对浏览器：

1. `locator.distribution.announce_urls[0] = wss://<host>/api/swarm/announce`。
2. `locator.distribution.join_ticket` 继续跟随同一 `infoHash`。
3. WebTorrent runtime 继续用 `getAnnounceOpts()` 携带 `ticket`。

对 sidecar：

1. `/seed/start` payload 仍包含 `announceUrls`、`torrentUrl`、`webSeedUrl`、`joinTicket`。
2. `announceUrls` 改为后端同源私有入口，例如 `ws://127.0.0.1:<APP_PORT>/api/swarm/announce`，而不是裸 tracker 端口。
3. 裸 tracker upstream 只存在于后端配置 `SWARM_TRACKER_UPSTREAM_URL`，不进入浏览器 locator，也不进入业务响应。

对 tracker：

1. 只接收已通过 Rust 后端首帧校验的 WebSocket 连接。
2. 不理解业务房间、不理解附件、不理解用户。

### 1.3 同步锚点是什么

1. WebTorrent 分发锚点：`torrent_info_hash`。
2. 后端业务锚点：`attachment_id / canonical_asset_id / content_hash`。
3. tracker 入群授权锚点：`join_ticket.ih == infoHash`。
4. 做种续租锚点：同 `infoHash` 的 sidecar 会话只刷新 ticket，不创建第二个 torrent。

### 1.4 重试、重连、重入如何恢复和去重

1. WebSocket 断线后浏览器重新向 `/api/swarm/announce` 建连，第一帧必须带有效 `ticket`。
2. Rust 代理验证成功后转发给 tracker；验证失败直接关闭连接并记录稳定错误码。
3. sidecar `/seed/start` 重入时继续按 `infoHash` 去重，只刷新 `joinTicket`。
4. 做种对账继续按权威附件集合 reconcile，不因 tracker 替换丢掉 `seed/start / seed/reconcile`。

---

## 2. 文件改动地图

### 2.1 候选验证与文档

- Create: `docs/superpowers/plans/2026-04-25-WebTorrent成熟tracker替换与dev-tracker退场计划.md`
- Modify: `学习/整理笔记/WebTorrent-HTTPS-WSS公私announce与单机冒烟测试官方实践清单-2026-04-25.md`
  - 补充成熟 tracker 退场结论和 `wt-tracker` / `aquatic_ws` 取舍。

### 2.2 启动与依赖

- Modify: `frontend/package.json`
  - 增加 `wt-tracker` 依赖或脚本。只有候选验证通过后才允许落地。
  - 删除 `dev-tracker` 相关测试依赖时必须同步删测试。
- Modify: `frontend/pnpm-lock.yaml`
  - 由 `pnpm --dir frontend add wt-tracker` 生成，禁止手改。
- Modify: `run.ps1`
  - 从启动 `frontend/dev-tracker.mjs` 改为启动成熟 tracker 命令。
  - 增加 `SWARM_TRACKER_UPSTREAM_URL`。
  - 将 `SWARM_SEEDER_TRACKER_URL` 默认值改为后端同源私有入口：`ws://127.0.0.1:$appPort/api/swarm/announce`。
- Modify: `tests/启动器脚本检查.ps1`
  - 禁止 `run.ps1` 继续启动 `dev-tracker.mjs`。
  - 断言 tracker 启动命令来自成熟轮子。
- Modify: `https.ps1`
  - 禁止 Caddy 把 `/api/swarm/announce` 直反到 tracker 端口。
  - HTTPS 下所有 public announce 都必须先进入 Rust 后端认证代理。
- Modify: `tests/powershell/https-script.tests.ps1`
  - 断言 Caddyfile 不再用 `@tracker_ws -> 127.0.0.1:7072` 绕过 Rust 代理。

### 2.3 Rust 后端代理与配置

- Modify: `src/总装.rs`
  - 新增 `swarm_tracker_upstream_url` 配置，默认 `ws://127.0.0.1:${SWARM_TRACKER_PORT}`。
  - `seeder_tracker_url` 默认从裸 tracker 改成后端同源私有入口。
- Modify: `src/外壳.rs`
  - `/api/swarm/announce` 代理从纯字节转发升级为“首帧认证 + 后续透明转发”。
  - 添加首帧 `join_ticket` 校验，复用现有 JWT 语义。
  - 禁止在该代理中维护 peer 列表、offer 路由、swarm 状态。
- Modify: `src/媒体协作分发.rs`
  - 如当前签发函数不可复用，提取一个只读验证函数或稳定校验 helper。
  - 不改变 locator contract 字段。

### 2.4 前端与 sidecar

- Modify: `frontend/dev-seeder.mjs`
  - 保持消费 `/seed/start.announceUrls`，不直接知道裸 tracker。
  - 健康接口继续输出 `numPeers / downloaded / uploaded / capability`。
- Modify: `frontend/媒体/媒体协作分发.ts`
  - 如果 `getAnnounceOpts()` 已稳定携带 `ticket`，不改生产行为。
  - 若测试发现首帧未带 ticket，补测试后只修 `getAnnounceOpts` 接线。
- Delete: `frontend/dev-tracker.mjs`
  - 只有成熟 tracker + Rust 首帧认证 + 全量回归通过后删除。
- Delete/Modify: `frontend/tests/dev-tracker入群票据测试.spec.ts`
  - 迁移为 Rust 代理认证测试后删除原 JS tracker 门禁测试。

### 2.5 测试

- Modify: `tests/协作分发测试.rs`
  - 增加同源 WSS 代理首帧无票拒绝、有票放行测试。
- Modify: `tests/协作分发测试/可用性裁决.rs`
  - 保持后台做种对账私有 announce 断言，更新为后端同源私有入口。
- Modify: `tests/媒体上传测试/单文件主链.rs`
  - 保持 complete 触发 seeder start 的 `announceUrls` 断言，更新为后端同源私有入口。
- Modify: `frontend/tests/dev-seeder做种续租测试.spec.ts`
  - 继续锁定同 `infoHash` 续租刷新 ticket，不因 tracker 替换重启 torrent。

---

## 3. Task 1: 候选轮子可运行性红线验证

**Files:**

- Modify: `docs/superpowers/plans/2026-04-25-WebTorrent成熟tracker替换与dev-tracker退场计划.md`
- Optional Modify: `学习/整理笔记/WebTorrent-HTTPS-WSS公私announce与单机冒烟测试官方实践清单-2026-04-25.md`

- [ ] **Step 1: 记录候选事实**

Run:

```powershell
npm view wt-tracker version description repository.url license --json
npm view bittorrent-tracker version description repository.url license --json
cargo search aquatic_ws --limit 5
```

Expected:

1. `wt-tracker` 能从 npm 或 GitHub 解析到可安装版本。
2. `bittorrent-tracker` 仍作为当前成熟回退基线存在。
3. `aquatic_ws` 当前版本可查，但标注 Linux 5.8+ 运行边界。

- [ ] **Step 2: 拉取 `wt-tracker` 包做只读探针**

Run:

```powershell
$tmp = Join-Path $env:TEMP ("wt-tracker-probe-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Push-Location $tmp
npm pack wt-tracker
tar -xzf (Get-ChildItem -Filter "*.tgz" | Select-Object -First 1).FullName
rg -n "stats.json|websockets|allowOrigins|maxConnections|processMessage" package -S
Pop-Location
Remove-Item -LiteralPath $tmp -Recurse -Force
```

Expected:

1. 能看到 `/stats.json` 或 stats 相关入口。
2. 能看到 websocket path / maxConnections 配置。
3. 不要求看到业务 auth hook；业务 auth 不放进 tracker。

- [ ] **Step 3: 本机临时启动 `wt-tracker`**

Run:

```powershell
$tmp = Join-Path $env:TEMP ("wt-tracker-run-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Push-Location $tmp
npm init -y
npm install wt-tracker
@'
{
  "servers": {
    "websockets": {
      "port": 17072,
      "host": "127.0.0.1",
      "path": "/*",
      "maxConnections": 1000
    }
  },
  "tracker": {
    "maxOffers": 20,
    "announceInterval": 120
  }
}
'@ | Set-Content -LiteralPath "config.json" -Encoding UTF8
npx wt-tracker config.json
```

Expected:

1. 进程能监听 `127.0.0.1:17072`。
2. `http://127.0.0.1:17072/stats.json` 可读。

If FAIL:

1. Stop this plan before code mutation.
2. Record exact install/runtime failure.
3. Do not fall back to hand-written tracker.

- [ ] **Step 4: 清理临时探针**

Run:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*node*" } | Select-Object Id, ProcessName, Path
```

Expected:

1. 没有遗留 `wt-tracker` 临时进程。

- [ ] **Step 5: 提交候选事实文档**

Only if documentation was updated:

```powershell
git add 学习/整理笔记/WebTorrent-HTTPS-WSS公私announce与单机冒烟测试官方实践清单-2026-04-25.md
git commit -m "文档：记录成熟WebTorrent tracker候选验证"
```

---

## 4. Task 2: 红测 - Rust 同源代理必须接管 `join_ticket` 首帧门禁

**Files:**

- Modify: `tests/协作分发测试.rs`
- Modify: `src/外壳.rs`
- Modify: `src/媒体协作分发.rs`

- [ ] **Step 1: 写无票拒绝测试**

在 `tests/协作分发测试.rs` 增加测试，构造 WebSocket 到 `/api/swarm/announce`，第一帧发送不带 `ticket` 的 announce JSON。

Pseudo shape:

```rust
#[tokio::test]
async fn 同源tracker代理首帧缺少join_ticket会拒绝而不是放行到tracker() {
    // 启动测试后端，SWARM_TICKET_SECRET 固定。
    // 连接 ws://127.0.0.1:<app_port>/api/swarm/announce。
    // 第一帧发送 {"action":"announce","info_hash":"...","peer_id":"..."}。
    // 期望连接关闭，日志/响应错误码为 join_ticket_invalid。
}
```

Expected:

1. 当前实现是纯字节转发，会 FAIL。
2. 失败证明现在业务门禁仍在 `dev-tracker.mjs`，替换成熟 tracker 前必须迁回 Rust。

- [ ] **Step 2: 写有票放行测试**

在同文件增加有票首帧测试：

```rust
#[tokio::test]
async fn 同源tracker代理首帧join_ticket有效会放行到tracker_upstream() {
    // fake upstream tracker 只需要记录收到的第一帧，不需要实现 tracker。
    // 后端签发 ih 匹配的 join_ticket。
    // 连接 /api/swarm/announce 后发送带 ticket 的首帧。
    // 断言 fake upstream 收到了原始首帧。
}
```

Expected:

1. 当前实现没有首帧校验，也没有可配置 upstream URL，会 FAIL。

- [ ] **Step 3: 跑红测**

Run:

```powershell
cargo test --test 协作分发测试 同源tracker代理首帧 -- --nocapture
```

Expected: FAIL。

- [ ] **Step 4: 最小实现首帧认证**

Modify `src/总装.rs`:

```rust
pub swarm_tracker_upstream_url: String,
```

读取：

```rust
let tracker_upstream_url = 读取可选环境变量("SWARM_TRACKER_UPSTREAM_URL")
    .unwrap_or_else(|| format!("ws://127.0.0.1:{tracker_port}"));
```

Modify `src/外壳.rs`:

1. `应用状态` 增加 `swarm_tracker_upstream_url`。
2. `proxy_swarm_tracker_announce` 连接 `state.swarm_tracker_upstream_url`，不再硬编码 `ws://127.0.0.1:{port}`。
3. `relay_swarm_tracker_socket` 第一步先读客户端首帧。
4. 从首帧 JSON 中提取：
   - `info_hash`
   - `peer_id`
   - `ticket`
5. 验证 `ticket`：
   - JWT 签名有效；
   - `exp` 未过期；
   - `ih == info_hash`；
   - 可选 `aid` 存在但不在代理层做房间查询，房间权限已在 locator 签票前完成。
6. 验证成功后把首帧原样写给 upstream tracker，再进入透明双向 relay。

中文注释必须写明：

```rust
// 这里不是自研 tracker：只做业务入场门禁，验证首帧后不维护 peer、offer、swarm 状态。
// WebTorrent signaling 全部交给成熟 tracker upstream。
```

禁止：

1. 禁止在 Rust 代理里保存 peer map。
2. 禁止在 Rust 代理里处理 offer/answer。
3. 禁止 Rust 代理生成 tracker announce response。

- [ ] **Step 5: 跑测试转绿**

Run:

```powershell
cargo test --test 协作分发测试 同源tracker代理首帧 -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/总装.rs src/外壳.rs src/媒体协作分发.rs tests/协作分发测试.rs
git commit -m "修复：同源tracker代理接管join_ticket入场门禁"
```

---

## 5. Task 3: 启动器和 HTTPS 入口改用成熟 tracker，停止启动 `dev-tracker.mjs`

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `run.ps1`
- Modify: `tests/启动器脚本检查.ps1`
- Modify: `https.ps1`
- Modify: `tests/powershell/https-script.tests.ps1`

- [ ] **Step 1: 写启动器红测**

Modify `tests/启动器脚本检查.ps1`:

```powershell
Assert-False ($runScript -match 'dev-tracker\.mjs') "run.ps1 禁止继续启动自写 dev-tracker.mjs。"
Assert-True ($runScript -match 'wt-tracker') "run.ps1 应该启动成熟 WebTorrent tracker 轮子。"
Assert-True ($runScript -match 'SWARM_TRACKER_UPSTREAM_URL') "run.ps1 应该显式配置后端 tracker upstream。"
Assert-True ($runScript -match 'api/swarm/announce') "seeder 私有 announce 应默认走后端同源认证入口。"
```

- [ ] **Step 2: 写 HTTPS 入口红测**

Modify `tests/powershell/https-script.tests.ps1`:

```powershell
Assert-False -Condition $caddyfile.Contains("reverse_proxy @tracker_ws 127.0.0.1:7072") -Message "Caddyfile 禁止把 /api/swarm/announce 直反到裸 tracker，必须先进入 Rust 认证代理。"
Assert-False -Condition ($caddyfile -match '@tracker_ws[\s\S]*header Connection \*Upgrade[\s\S]*reverse_proxy @tracker_ws 127\.0\.0\.1:7072') -Message "HTTPS WebSocket 分流不能绕过后端 /api/swarm/announce 首帧验票。"
Assert-True -Condition $caddyfile.Contains("reverse_proxy 127.0.0.1:28080") -Message "Caddyfile 应继续把业务流量反代到后端端口，由后端代理 tracker。"
```

Expected:

1. 当前 `https.ps1` 会 FAIL，因为它还把非 socket.io 的 websocket 直分流到 `7072`。
2. 这个失败是必须保留的红灯：成熟 tracker upstream 只能被 Rust 后端访问，不能被 Caddy public 入口绕过。

- [ ] **Step 3: 跑红测**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/powershell/https-script.tests.ps1
```

Expected: FAIL。

- [ ] **Step 4: 添加成熟 tracker 依赖**

Run:

```powershell
pnpm --dir frontend add wt-tracker
```

Expected:

1. `frontend/package.json` 增加 `wt-tracker`。
2. `frontend/pnpm-lock.yaml` 更新。
3. 不手改 lockfile。

If install FAIL:

1. Stop.
2. Do not patch around uWebSockets.js by copying vendor code.
3. Record failure and reassess `aquatic_ws` Linux path.

- [ ] **Step 5: 修改 `run.ps1`**

Required behavior:

1. 生成 `wt-tracker` config 到运行时日志目录，不落长期仓库状态。
2. 启动命令类似：

```powershell
Write-Host "启动 WebTorrent tracker: pnpm --dir frontend exec wt-tracker <config>"
```

3. 设置：

```powershell
$trackerUpstreamUrl = "ws://127.0.0.1:$trackerPort"
$seederTrackerUrl = "ws://127.0.0.1:$appPort/api/swarm/announce"
[Environment]::SetEnvironmentVariable("SWARM_TRACKER_UPSTREAM_URL", $trackerUpstreamUrl)
[Environment]::SetEnvironmentVariable("SWARM_SEEDER_TRACKER_URL", $seederTrackerUrl)
```

4. 日志必须同时打印：

```powershell
WebTorrent tracker upstream: ws://127.0.0.1:$trackerPort
WebTorrent tracker 浏览器公开 announce: $trackerPublicUrl
WebTorrent seeder 私有认证 announce: $seederTrackerUrl
```

5. 不再传 `--ticket-secret` 给 tracker。

- [ ] **Step 6: 修改 `https.ps1`**

Required behavior:

1. 删除或收窄 `@tracker_ws` 直连裸 tracker 的 Caddy matcher。
2. `/api/swarm/announce` 在 HTTPS 下必须走默认 app 反代：

```caddyfile
reverse_proxy 127.0.0.1:<APP_PORT>
```

3. 裸 tracker upstream 只允许 Rust 后端通过 `SWARM_TRACKER_UPSTREAM_URL` 使用。
4. 中文注释写明：

```powershell
# WebTorrent public announce 必须先进入 Rust 后端验票代理；Caddy 不能把 /api/swarm/announce 直反到裸 tracker。
```

禁止：

1. 禁止保留 `reverse_proxy @tracker_ws 127.0.0.1:7072`。
2. 禁止新增第二个 public tracker 路径。
3. 禁止让浏览器或 sidecar 通过 HTTPS Caddy 旁路 Rust 后端。

- [ ] **Step 7: 测试转绿**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/powershell/https-script.tests.ps1
```

Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml run.ps1 https.ps1 tests/启动器脚本检查.ps1 tests/powershell/https-script.tests.ps1
git commit -m "修复：启动器和HTTPS入口改用成熟WebTorrent tracker"
```

---

## 6. Task 4: 调整 seeder 私有 announce，禁止裸 tracker 绕过门禁

**Files:**

- Modify: `src/总装.rs`
- Modify: `src/外壳.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写红测 - complete 触发 seeder start 时走同源私有认证入口**

Modify `tests/媒体上传测试/单文件主链.rs::视频complete会触发seeder_start命令`:

```rust
env::set_var("APP_PORT", "18080");
env::set_var("SWARM_TRACKER_PORT", "17072");
env::remove_var("SWARM_SEEDER_TRACKER_URL");
```

Assert:

```rust
assert_eq!(
    start_payload["announceUrls"][0].as_str(),
    Some("ws://127.0.0.1:18080/api/swarm/announce"),
    "sidecar 默认必须走后端同源认证入口，禁止直连裸 tracker 绕过 join_ticket 门禁"
);
```

- [ ] **Step 2: 写红测 - 后台做种对账也走同源私有认证入口**

Modify `tests/协作分发测试/可用性裁决.rs`:

```rust
assert_eq!(
    payload["announceUrls"][0].as_str(),
    Some("ws://127.0.0.1:18080/api/swarm/announce"),
    "后台做种对账必须走同源私有认证入口"
);
```

- [ ] **Step 3: 跑红测**

Run:

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
cargo test --test 协作分发测试 做种对账会按权威附件集合触发start并下发reconcile清单 -- --nocapture
```

Expected: FAIL。

- [ ] **Step 4: 最小实现**

Modify `src/总装.rs`:

1. `SWARM_SEEDER_TRACKER_URL` 默认值从 `ws://127.0.0.1:{tracker_port}` 改为：

```rust
format!("ws://127.0.0.1:{app_port}/api/swarm/announce")
```

2. 显式设置 `SWARM_SEEDER_TRACKER_URL` 仍允许覆盖。
3. 中文注释说明：

```rust
// sidecar 虽然是本机进程，也必须走后端认证入口；裸 tracker upstream 只给后端代理使用。
```

- [ ] **Step 5: 测试转绿**

Run:

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
cargo test --test 协作分发测试 做种对账会按权威附件集合触发start并下发reconcile清单 -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: 回归 public locator**

Run:

```powershell
cargo test --test 协作分发测试 未显式配置tracker公网地址时locator会按请求host推导可达announce地址 -- --nocapture
```

Expected:

1. 浏览器仍拿 `wss://.../api/swarm/announce`。
2. 不暴露裸 `7072`。

- [ ] **Step 7: 提交**

```powershell
git add src/总装.rs src/外壳.rs src/媒体上传外壳.rs tests/媒体上传测试/单文件主链.rs tests/协作分发测试/可用性裁决.rs
git commit -m "修复：sidecar做种走同源认证tracker入口"
```

---

## 7. Task 5: 删除 `dev-tracker.mjs` 和旧 JS 门禁测试

**Files:**

- Delete: `frontend/dev-tracker.mjs`
- Delete/Modify: `frontend/tests/dev-tracker入群票据测试.spec.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `tests/启动器脚本检查.ps1`

- [ ] **Step 1: 搜索旧入口**

Run:

```powershell
rg -n "dev-tracker|createJoinTicketFilter|join_ticket_invalid|bittorrent-tracker/server" frontend src tests run.ps1 docs 学习 -S
```

Expected:

1. 只剩文档历史记录允许出现。
2. 生产代码和启动脚本不应再引用 `dev-tracker.mjs`。

- [ ] **Step 2: 删除文件**

Delete:

```powershell
git rm frontend/dev-tracker.mjs
git rm frontend/tests/dev-tracker入群票据测试.spec.ts
```

- [ ] **Step 3: 删除不再需要的依赖**

If `bittorrent-tracker` only served `dev-tracker.mjs`:

```powershell
pnpm --dir frontend remove bittorrent-tracker
```

Do not remove `jsonwebtoken` if another frontend test or dev tool still uses it. Verify:

```powershell
rg -n "jsonwebtoken|bittorrent-tracker" frontend -S
```

- [ ] **Step 4: 跑前端测试**

Run:

```powershell
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml tests/启动器脚本检查.ps1
git commit -m "清理：移除自写WebTorrent dev tracker"
```

---

## 8. Task 6: 结构化 stats / health 观测接线

**Files:**

- Modify: `run.ps1`
- Modify: `tests/启动器脚本检查.ps1`
- Optional Modify: `src/外壳.rs`

- [ ] **Step 1: 写脚本守卫**

Modify `tests/启动器脚本检查.ps1`:

```powershell
Assert-True ($runScript -match 'stats') "成熟 tracker 必须暴露 stats 观测入口，不能只靠人眼读日志。"
Assert-True ($runScript -match 'SWARM_TRACKER_UPSTREAM_URL') "后端必须知道 tracker upstream，方便 health/smoke 读取。"
```

- [ ] **Step 2: 启动器打印 stats URL**

Modify `run.ps1`:

```powershell
Write-Host "WebTorrent tracker stats: http://127.0.0.1:$trackerPort/stats"
```

- [ ] **Step 3: 可选后端 health 透出**

Only if smoke scripts need same-origin JSON:

1. Add `/api/swarm/tracker-stats` handler that reverse-proxies JSON from `SWARM_TRACKER_UPSTREAM_URL` stats endpoint.
2. This endpoint must be admin/dev-only or disabled by default in production.

Prefer not adding this unless smoke automation cannot read `127.0.0.1:$trackerPort/stats` directly.

- [ ] **Step 4: 跑脚本测试**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add run.ps1 tests/启动器脚本检查.ps1
git commit -m "验证：补充成熟tracker结构化观测入口"
```

---

## 9. Task 7: 回归现有业务功能，禁止满血业务退化

**Files:**

- No production code unless failures reveal real bug.

- [ ] **Step 1: 后端 targeted tests**

Run:

```powershell
cargo test --test 协作分发测试 -- --nocapture
cargo test --test 媒体上传测试 source_hash -- --nocapture
cargo test --test 流媒体资产契约测试 -- --nocapture
cargo test --test 媒体测试边界守卫 -- --nocapture
```

Expected: PASS。

- [ ] **Step 2: 后端 full tests**

Run:

```powershell
cargo test -j 1
```

Expected: PASS。

- [ ] **Step 3: 前端 full tests**

Run:

```powershell
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
node scripts/check-frontend-architecture-fitness.mjs
node scripts/check-frontend-browser-app-constitution.mjs
```

Expected: PASS。

- [ ] **Step 4: 启动器脚本**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/powershell/https-script.tests.ps1
```

Expected: PASS。

- [ ] **Step 5: 提交**

If only tests pass and no files changed, no commit.

If regression fixes were needed:

```powershell
git add <changed-files>
git commit -m "修复：保持成熟tracker替换后的媒体主链回归"
```

---

## 10. Task 8: HTTPS chrome-devtools-cli 多上下文冒烟

**Files:**

- No code file required unless adding smoke script.

- [ ] **Step 1: 启动 HTTPS 本地链路**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File run.ps1 -DisableAutoOptimizeCleanup
```

Expected log:

```text
WebTorrent tracker upstream: ws://127.0.0.1:7072
WebTorrent tracker 浏览器公开 announce: wss://localhost/api/swarm/announce
WebTorrent seeder 私有认证 announce: ws://127.0.0.1:8080/api/swarm/announce
WebTorrent tracker stats: http://127.0.0.1:7072/stats
```

Expected Caddy behavior:

1. `wss://localhost/api/swarm/announce` 进入 Rust 后端。
2. Rust 后端再连 `SWARM_TRACKER_UPSTREAM_URL`。
3. Caddy 不再直接把 `/api/swarm/announce` 反代到 `127.0.0.1:7072`。

- [ ] **Step 2: 浏览器上传新 MP4**

Use `chrome-devtools-cli`:

```powershell
chrome-devtools new_page "https://localhost" --isolatedContext "tracker-wheel-smoke-sender" --timeout 30000
```

Manual/browser automation:

1. 进入房间 `1234b`。
2. 上传 `D:\200-生活\230-照片备份\233-Telegram\色色` 下没发过的新 MP4。
3. 发送消息。

Expected network:

1. `/files = 201`
2. `/api/media/<attachment_id>/complete = 200`
3. `/api/media/<attachment_id>/locator = 200`
4. locator announce is `wss://localhost/api/swarm/announce`。

- [ ] **Step 3: 两个隔离 viewer 进入同一房间**

Run:

```powershell
chrome-devtools new_page "https://localhost" --isolatedContext "tracker-wheel-smoke-A" --timeout 30000
chrome-devtools new_page "https://localhost" --isolatedContext "tracker-wheel-smoke-B" --timeout 30000
```

Expected:

1. 两个 viewer 都能加载同一视频。
2. 控制台无 mixed content。
3. 控制台无 WebSocket tracker fatal error。

- [ ] **Step 4: 读取 tracker stats**

Run:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:7072/stats" | Select-Object -ExpandProperty Content
```

Expected:

1. 能看到新 `infoHash`。
2. peers 数增加。
3. 不是只靠 HTTP 206。

- [ ] **Step 5: 读取 seeder health**

Run:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:7073/health" | ConvertTo-Json -Depth 8
```

Expected:

1. 新 `infoHash` 在 active sessions 中。
2. `numPeers > 0` 或 uploaded/downloaded 指标有增长。

- [ ] **Step 6: 检查日志**

Run:

```powershell
Select-String -LiteralPath "<log-dir>\\*.log" -Pattern "join_ticket_invalid|Error connecting|dev-tracker|bittorrent-tracker/server|swarm_tracker_proxy_failed"
```

Expected:

1. 禁止出现 `dev-tracker` 启动。
2. 禁止出现 `Error connecting to wss://localhost/api/swarm/announce`。
3. 禁止出现持续 `join_ticket_invalid` 风暴。

- [ ] **Step 7: 清理进程**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles
git status --short
```

Expected:

1. 开发 sidecar 停止。
2. 工作树只剩计划内文件。

---

## 11. 完成门禁

禁止声称完成，除非同时满足：

1. `wt-tracker` 或被选成熟 tracker 在本机启动成功。
2. `run.ps1` 不再启动 `frontend/dev-tracker.mjs`。
3. `frontend/dev-tracker.mjs` 被删除，且生产/测试不再引用它。
4. Rust `/api/swarm/announce` 首帧无票拒绝、有票放行测试通过。
5. 浏览器 public announce 仍是 `wss://.../api/swarm/announce`。
6. sidecar private announce 默认是 `ws://127.0.0.1:<APP_PORT>/api/swarm/announce`，不裸连 tracker 绕过门禁。
7. `https.ps1` 生成的 Caddyfile 不再把 `/api/swarm/announce` 直反到 `127.0.0.1:7072`。
8. tracker stats 使用成熟轮子的 `/stats.json` 或等价结构化观测。
9. `source_hash` 精确去重测试通过。
10. WebTorrent 群聊协作分发测试通过。
11. 24 小时 WebSeed / 删除 / 无在线种子语义不退化。
12. 前端 tests/typecheck/build 全通过。
13. `chrome-devtools-cli` HTTPS 多上下文烟测通过。
14. 日志无 `dev-tracker`、无 public WSS 被 sidecar 误连、无持续 `join_ticket_invalid`。
15. `git status --short` 已复核。

---

## 12. 回滚与停止条件

必须停止执行并回报，而不是继续硬改：

1. `wt-tracker` 无法在 Win11 + Node 25 本地稳定安装或启动。
2. `wt-tracker` 不兼容 WebTorrent 客户端第一帧格式，导致首帧认证无法保持透明转发。
3. 首帧认证必须解析/重写 offer/answer 才能工作。
4. 替换后无法证明 P2P peer 数增长，只能证明 HTTP 206。
5. 任何现有 `source_hash`、WebSeed、删除态、无在线种子、消息附件事实测试失败且根因不是测试陈旧。
6. 需要长期保留 `dev-tracker.mjs` 与成熟 tracker 双活。

回滚方式：

1. 逐提交回退本计划提交。
2. 恢复 `dev-tracker.mjs` 只允许作为临时回滚，不允许继续开发新功能。
3. 回滚后必须保留候选失败记录，防止下次重复踩坑。

---

## 13. 自审清单

按 `supxcode` 和本项目 AGENTS 规则，本计划自审结论：

1. 权威真相明确：业务权限在 Rust 后端，tracker 只做 signaling。
2. 边界明确：Rust 代理只做首帧认证和透明转发，不做 tracker 核心。
3. 交换契约明确：浏览器 public WSS、sidecar private auth announce、tracker upstream 三者分离。
4. 同步锚点明确：`infoHash` 和 `join_ticket.ih`。
5. 重试/重入明确：每条 WebSocket 新连接首帧验票；同 `infoHash` sidecar start 只续租。
6. 没有引入第二套业务真相；成熟 tracker 替换的是基础设施核心。
7. 没有为了换轮子牺牲 `source_hash`、WebSeed、删除态、无在线种子、消息附件事实。
8. 明确删除旧 `dev-tracker.mjs`，禁止新旧双活。
9. HTTPS Caddy 入口已纳入计划，禁止 public WSS 绕过 Rust 首帧门禁。
10. 验证矩阵覆盖 Rust、前端、启动器、HTTPS 浏览器真实烟测。
11. 风险最大点是 `wt-tracker` 本机安装/兼容性；计划已设置停止条件，禁止手搓补洞。

---

## 14. 官方与生态依据

1. `wt-tracker`：<https://github.com/Novage/wt-tracker>
2. `bittorrent-tracker`：<https://github.com/webtorrent/bittorrent-tracker>
3. `aquatic_ws`：<https://lib.rs/crates/aquatic_ws>
4. WebTorrent Docs：<https://webtorrent.io/docs>
5. WebTorrent FAQ：<https://webtorrent.io/faq>
