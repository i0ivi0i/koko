# WebTorrent 公开 WSS 与 Sidecar 私有 Announce 分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 HTTPS 冒烟暴露的 `浏览器公开 WSS announce` 与 `服务端 sidecar 私有 tracker announce` 混用问题，让浏览器继续拿 `wss://.../api/swarm/announce`，同时让 dev seeder / 后端强 seed 走私有 tracker announce。

**Architecture:** `public announce` 属于浏览器 contract，由 locator 根据请求/反代头推导；`private seeder announce` 属于后端 shell / infrastructure 配置，只进入 `/seed/start` 控制面。修复必须保持同一 WebTorrent 分发平面和同一 `infoHash`，禁止新增第二套 swarm、第二个 tracker 真相或绕过 join ticket 的旁路。

**Tech Stack:** Rust 2024 + Axum + SQLx + PostgreSQL；PowerShell launcher；Node.js dev tracker / dev seeder；WebTorrent / bittorrent-tracker；Vitest；`chrome-devtools-cli` HTTPS 真实浏览器烟测。

---

## 0. 当前根因

真实 HTTPS 冒烟结果：

1. `https://localhost` 页面可上传新 MP4。
2. locator 返回 `wss://localhost/api/swarm/announce`，这对浏览器是正确的。
3. 浏览器 WebTorrent route 和 WebSeed route 都能返回 `206`。
4. DB presence 能看到 sender / viewer 的 `partial_peer / complete_peer`。
5. `webtorrent-seeder.stderr.log` 出现：

```text
[dev-seeder][11e06903...] warning: Error connecting to wss://localhost/api/swarm/announce
```

根因链路：

1. `src/媒体协作分发.rs::读取协作分发tracker对外地址` 按 HTTPS 反代头推导 public `wss://.../api/swarm/announce`。
2. `src/外壳.rs::从协作分发响应构造做种启动命令` 从 `runtime_distribution["announce_urls"]` 读取 public announce。
3. `frontend/dev-seeder.mjs` 把这个 public WSS URL 作为 Node sidecar 的 `announce`。
4. sidecar 本应走 `ws://127.0.0.1:${SWARM_TRACKER_PORT}` 或显式私有 tracker URL。

本 plan 的核心修复：**把 public announce 和 private seeder announce 拆成两个配置真相。**

---

## 1. 文件改动地图

**Rust 配置与应用状态：**

- Modify: `src/总装.rs`
  - 在 `协作分发配置` 增加 `seeder_tracker_url: String`。
  - 读取 `SWARM_SEEDER_TRACKER_URL`，默认 `ws://127.0.0.1:${SWARM_TRACKER_PORT}`。
  - 校验非空。
- Modify: `src/外壳.rs`
  - 在 `AppState` 增加 `swarm_seeder_tracker_url: String`。
  - `从协作分发响应构造做种启动命令` 改为接收 `seeder_tracker_url`。
  - sidecar `/seed/start` payload 的 `announceUrls` 使用私有 seeder URL，不再使用 locator public `announce_urls`。
  - 保留 `webSeedUrl / torrentUrl` 绝对地址归一化。
- Modify: `src/媒体上传外壳.rs`
  - complete / source_hash reuse 触发 seeder start 时传入 `state.swarm_seeder_tracker_url`。
- Modify: `src/媒体资产外壳.rs`
  - 如果本文件有触发 seeder start 或复用同一构造函数，必须同步传入私有 URL；如果只是 locator contract，不改 public announce。

**启动脚本：**

- Modify: `run.ps1`
  - 新增 `SWARM_SEEDER_TRACKER_URL` 默认值。
  - 保持 `SWARM_TRACKER_PUBLIC_URL` 继续描述浏览器 public announce。
  - 启动日志同时打印 public announce 与 seeder private announce。
- Modify: `tests/启动器脚本检查.ps1`
  - 增加脚本保护断言。

**后端测试：**

- Modify: `tests/媒体上传测试/单文件主链.rs`
  - `视频complete会触发seeder_start命令` 加强断言：HTTPS public locator 为 WSS 时，fake seeder 收到的 `announceUrls` 必须是私有 WS。
- Modify: `tests/协作分发测试.rs`
  - 保留/加强 public locator 推导测试，证明浏览器仍拿 WSS。
- Modify: `tests/协作分发测试/可用性裁决.rs`
  - 如果后台对账会触发 fake seeder start，增加同样私有 announce 断言。

**前端 / sidecar 测试：**

- Modify: `frontend/dev-seeder.mjs`
  - 不一定要改业务逻辑；重点是确认它继续消费 payload `announceUrls`，并在日志里能看出实际 announce。
- Modify: `frontend/tests/dev-seeder做种续租测试.spec.ts`
  - 如已有 payload 纯函数测试，补充不接受 public WSS 默认值的构造约束；否则保持到 HTTPS 烟测覆盖。

**文档：**

- Reference: `学习/整理笔记/WebTorrent-HTTPS-WSS公私announce与单机冒烟测试官方实践清单-2026-04-25.md`

---

## 2. Task 1: 红测 - 配置层区分 public announce 与 seeder private announce

**Files:**

- Modify: `src/总装.rs`

- [ ] **Step 1: 写失败测试**

在 `src/总装.rs` 现有 `协作分发配置` 测试附近新增：

```rust
#[test]
#[serial]
fn 协作分发配置会为sidecar生成私有tracker地址() {
    let old_tracker_port = env::var("SWARM_TRACKER_PORT").ok();
    let old_public_url = env::var("SWARM_TRACKER_PUBLIC_URL").ok();
    let old_seeder_tracker_url = env::var("SWARM_SEEDER_TRACKER_URL").ok();

    env::set_var("SWARM_TRACKER_PORT", "17072");
    env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://im.example.com/api/swarm/announce");
    env::remove_var("SWARM_SEEDER_TRACKER_URL");

    let cfg = 读取协作分发配置().expect("应能读取协作分发配置");

    assert_eq!(
        cfg.tracker_public_url,
        "wss://im.example.com/api/swarm/announce",
        "public announce 继续服务浏览器 contract"
    );
    assert_eq!(
        cfg.seeder_tracker_url,
        "ws://127.0.0.1:17072",
        "sidecar 默认必须走本机私有 tracker，不复用浏览器 public WSS"
    );

    恢复环境变量("SWARM_TRACKER_PORT", old_tracker_port);
    恢复环境变量("SWARM_TRACKER_PUBLIC_URL", old_public_url);
    恢复环境变量("SWARM_SEEDER_TRACKER_URL", old_seeder_tracker_url);
}
```

再新增显式覆盖测试：

```rust
#[test]
#[serial]
fn 协作分发配置允许显式覆盖sidecar私有tracker地址() {
    let old = env::var("SWARM_SEEDER_TRACKER_URL").ok();
    env::set_var("SWARM_SEEDER_TRACKER_URL", "ws://tracker.internal:7072");

    let cfg = 读取协作分发配置().expect("应能读取协作分发配置");

    assert_eq!(cfg.seeder_tracker_url, "ws://tracker.internal:7072");
    恢复环境变量("SWARM_SEEDER_TRACKER_URL", old);
}
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
cargo test --lib 协作分发配置 -- --nocapture
```

Expected: FAIL，`协作分发配置` 当前没有 `seeder_tracker_url` 字段。

- [ ] **Step 3: 最小实现**

在 `src/总装.rs`：

1. `协作分发配置` 增加 `pub seeder_tracker_url: String`。
2. `读取协作分发配置` 里读取：

```rust
let seeder_tracker_url = 读取可选环境变量("SWARM_SEEDER_TRACKER_URL")
    .unwrap_or_else(|| format!("ws://127.0.0.1:{tracker_port}"));
let seeder_tracker_url = seeder_tracker_url.trim().to_string();
if seeder_tracker_url.is_empty() {
    return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "环境变量 SWARM_SEEDER_TRACKER_URL 不能为空",
    ));
}
```

3. 注释必须说明：`tracker_public_url` 给浏览器，`seeder_tracker_url` 给 sidecar，禁止混用。

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
cargo test --lib 协作分发配置 -- --nocapture
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/总装.rs
git commit -m "修复：区分WebTorrent公开与私有announce配置"
```

---

## 3. Task 2: 红测 - seeder start payload 使用私有 announce

**Files:**

- Modify: `src/外壳.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/媒体资产外壳.rs`（只在实际调用构造函数时改）
- Modify: `tests/媒体上传测试/单文件主链.rs`

- [ ] **Step 1: 写失败测试**

在 `tests/媒体上传测试/单文件主链.rs::视频complete会触发seeder_start命令` 中备份环境变量扩展为：

```rust
let backup = 备份并清空环境变量(&[
    "SWARM_SEEDER_CONTROL_BASE_URL",
    "SWARM_TRACKER_PUBLIC_URL",
    "SWARM_SEEDER_TRACKER_URL",
]);
env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());
env::set_var(
    "SWARM_TRACKER_PUBLIC_URL",
    "wss://im.example.com/api/swarm/announce",
);
env::set_var("SWARM_SEEDER_TRACKER_URL", "ws://127.0.0.1:17072");
```

在现有 `announceUrls` 非空断言后新增：

```rust
assert_eq!(
    start_payload["announceUrls"].as_array().and_then(|values| values.first()).and_then(|value| value.as_str()),
    Some("ws://127.0.0.1:17072"),
    "sidecar start 必须使用私有 tracker announce，禁止复用浏览器 public WSS announce"
);
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
```

Expected: FAIL，fake seeder 当前收到 `wss://im.example.com/api/swarm/announce`。

- [ ] **Step 3: 最小实现**

在 `src/外壳.rs`：

1. `AppState` 增加 `pub swarm_seeder_tracker_url: String`。
2. `构建应用状态` 从 `swarm.seeder_tracker_url` 写入 state。
3. 修改函数签名：

```rust
pub(super) fn 从协作分发响应构造做种启动命令(
    runtime_distribution: &serde_json::Value,
    seeder_tracker_url: &str,
) -> Option<协作分发做种启动命令>
```

4. `announce_urls` 不再从 `runtime_distribution["announce_urls"]` 读取，而是：

```rust
let announce_urls = seeder_tracker_url
    .trim()
    .is_empty()
    .then(Vec::new)
    .unwrap_or_else(|| vec![seeder_tracker_url.trim().to_string()]);
```

更清晰的写法也可以：

```rust
let announce_urls = if seeder_tracker_url.trim().is_empty() {
    Vec::new()
} else {
    vec![seeder_tracker_url.trim().to_string()]
};
```

5. 中文注释写明：public announce 已在 locator 里给浏览器；这里是后端 owner 调 sidecar 的私有入口。
6. 更新所有调用点，至少包括 complete、source_hash reuse、后台做种对账：

```rust
super::从协作分发响应构造做种启动命令(
    &runtime_distribution,
    state.swarm_seeder_tracker_url.as_str(),
)
```

重点搜索：

```powershell
rg -n "从协作分发响应构造做种启动命令" src
```

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
```

Expected: PASS。

- [ ] **Step 5: 回归 public locator 仍是 WSS**

Run:

```powershell
cargo test --test 协作分发测试 未显式配置tracker公网地址时locator会按请求host推导可达announce地址 -- --nocapture
```

如果测试名不匹配，执行：

```powershell
cargo test --test 协作分发测试 tracker -- --nocapture
```

Expected: PASS，`distribution.announce_urls[0]` 仍为 `wss://im.example.com/api/swarm/announce`。

- [ ] **Step 6: 提交**

```powershell
git add src/外壳.rs src/媒体上传外壳.rs src/媒体资产外壳.rs tests/媒体上传测试/单文件主链.rs
git commit -m "修复：sidecar做种使用私有tracker announce"
```

---

## 4. Task 3: 启动脚本保护公私 announce

**Files:**

- Modify: `run.ps1`
- Modify: `tests/启动器脚本检查.ps1`

- [ ] **Step 1: 写失败测试**

在 `tests/启动器脚本检查.ps1` 的 WebTorrent tracker / seeder 断言附近新增：

```powershell
Assert-True ($runScript -match 'SWARM_SEEDER_TRACKER_URL') "run.ps1 应该允许显式覆写 seeder 私有 tracker announce。"
Assert-True ($runScript -match 'WebTorrent seeder 私有 announce') "run.ps1 应该把 public announce 与 seeder 私有 announce 分开打印，避免烟测误读。"
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
```

Expected: FAIL，当前脚本没有 `SWARM_SEEDER_TRACKER_URL`。

- [ ] **Step 3: 最小实现**

在 `run.ps1` tracker 配置区域：

```powershell
$seederTrackerUrl = [Environment]::GetEnvironmentVariable("SWARM_SEEDER_TRACKER_URL")
if ([string]::IsNullOrWhiteSpace($seederTrackerUrl)) {
    $seederTrackerUrl = "ws://127.0.0.1:$trackerPort"
}
[Environment]::SetEnvironmentVariable("SWARM_SEEDER_TRACKER_URL", $seederTrackerUrl)
```

日志改为同时打印：

```powershell
Write-Host "WebTorrent tracker 浏览器公开 announce: $trackerPublicUrl"
Write-Host "WebTorrent seeder 私有 announce: $seederTrackerUrl"
```

保留原 `SWARM_TRACKER_PUBLIC_URL` 行为，不要改成私有值。

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add run.ps1 tests/启动器脚本检查.ps1
git commit -m "修复：启动器分离WebTorrent公开与私有announce"
```

---

## 5. Task 4: fake seeder / 后台对账路径回归

**Files:**

- Modify: `tests/协作分发测试/可用性裁决.rs`
- Modify: `src/外壳.rs`（若后台对账调用仍漏传私有 URL）

- [ ] **Step 1: 搜索所有 start payload 来源**

Run:

```powershell
rg -n "seed/start|从协作分发响应构造做种启动命令|做种对账|reconcile" src tests -S
```

Expected: 找到 complete、source_hash reuse、后台对账三类触发点。

- [ ] **Step 2: 写失败测试**

在 `tests/协作分发测试/可用性裁决.rs` 中选取现有 fake seeder start / reconcile 用例，加入环境变量：

```rust
env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://im.example.com/api/swarm/announce");
env::set_var("SWARM_SEEDER_TRACKER_URL", "ws://127.0.0.1:17072");
```

并断言所有 `/seed/start` 请求：

```rust
let records = seeder_records
    .lock()
    .expect("seeder 控制面记录锁不应中毒")
    .clone();
for payload in records.start_payloads.iter() {
    assert_eq!(
        payload["announceUrls"][0].as_str(),
        Some("ws://127.0.0.1:17072"),
        "后台做种对账也必须使用 sidecar 私有 tracker announce"
    );
}
```

这里必须使用当前 helper 的真实结构：`records.start_payloads` 直接保存 `/seed/start` body，不能写成 `kind/body` 包装结构，也不能弱化断言为“非空”。

- [ ] **Step 3: 跑红测确认失败**

Run:

```powershell
cargo test --test 协作分发测试 seed -- --nocapture
```

Expected: 如果后台路径漏改，应 FAIL；如果 Task 2 已覆盖所有调用点，应 PASS。无论结果如何，保留断言作为回归门禁。

- [ ] **Step 4: 最小实现**

若失败，更新后台对账调用点，传入 `state.swarm_seeder_tracker_url.as_str()`。

- [ ] **Step 5: 跑测试转绿**

Run:

```powershell
cargo test --test 协作分发测试 seed -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/外壳.rs tests/协作分发测试/可用性裁决.rs
git commit -m "修复：后台做种对账使用私有announce"
```

---

## 6. Task 5: HTTPS chrome-devtools-cli 冒烟门禁

**Files:**

- No code file required if manual smoke.
- Optional Create: `scripts/smoke-webtorrent-https.ps1`（只有当前 repo 已有同类脚本时才新增；否则先手工执行并把命令写入验收记录）

- [ ] **Step 1: 启动 HTTPS 本地链路**

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File run.ps1 -DisableAutoOptimizeCleanup -DisableCloudflareTunnel
```

Expected:

1. Caddy / app / tusd / tracker / seeder 都启动。
2. 日志显示：
   - `WebTorrent tracker 浏览器公开 announce: ...`
   - `WebTorrent seeder 私有 announce: ws://127.0.0.1:7072`

- [ ] **Step 2: 上传新 MP4**

Run:

```powershell
chrome-devtools navigate_page --url "https://localhost" --timeout 30000
chrome-devtools take_snapshot
```

进入房间 `1234b`。选择 `D:\200-生活\230-照片备份\233-Telegram\色色` 下一个没发过的 MP4，上传并发送。

Expected:

1. `/files = 201`
2. `/api/media/<attachment_id>/complete = 200`
3. locator 返回 `wss://localhost/api/swarm/announce`

- [ ] **Step 3: 多上下文观看**

Run:

```powershell
chrome-devtools new_page "https://localhost" --isolatedContext "smoke-A"
chrome-devtools new_page "https://localhost" --isolatedContext "smoke-B"
```

两个上下文都进入 `1234b` 并点击新视频。

Expected:

1. viewer 都能获取 locator。
2. 不出现 mixed-content。
3. 不出现 WebSocket fatal error。

- [ ] **Step 4: 读取 sidecar 和 tracker 证据**

Run:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:7073/health" | ConvertTo-Json -Depth 6
Invoke-WebRequest -Uri "http://127.0.0.1:7072/stats" | Select-Object -ExpandProperty Content
```

Expected:

1. 新 `infoHash` 存在。
2. `numPeers > 0` 或 tracker stats 显示 peers 增长。
3. seeder 日志禁止出现：

```text
Error connecting to wss://localhost/api/swarm/announce
```

- [ ] **Step 5: 读取浏览器控制台**

Run:

```powershell
chrome-devtools list_console_messages --includePreservedMessages true --pageSize 200 --output-format=json
```

Expected:

1. 无 mixed-content。
2. 无 WebSocket tracker 连接失败。
3. 若仍有 `MaxListenersExceededWarning`，记录为独立问题，不把它混入本次 announce 修复。

- [ ] **Step 6: 清理本地进程**

Run:

```powershell
.\qingli.ps1
git status --short
```

Expected:

1. 本地 sidecar 停止。
2. 工作树只有本计划内改动。

- [ ] **Step 7: 提交烟测记录或最终修复提交**

```powershell
git status --short
```

如果 Task 5 没有新增脚本或验收记录文件，不需要提交。
如果新增了 `scripts/smoke-webtorrent-https.ps1` 或验收记录，只允许显式 add 对应文件：

```powershell
git add scripts/smoke-webtorrent-https.ps1
git commit -m "验证：补充WebTorrent HTTPS冒烟脚本"
```

---

## 7. 完成门禁

实现完成前禁止声称修复，除非同时满足：

1. `cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture` 通过。
2. `cargo test --test 协作分发测试 tracker -- --nocapture` 通过。
3. `cargo test --test 协作分发测试 seed -- --nocapture` 通过或说明没有 seed 过滤名并跑了等价全量用例。
4. `pwsh -NoProfile -ExecutionPolicy Bypass -File tests/启动器脚本检查.ps1` 通过。
5. HTTPS chrome-devtools-cli 烟测通过。
6. seeder stderr 不再出现 `Error connecting to wss://localhost/api/swarm/announce`。
7. locator 仍给浏览器返回 `wss://localhost/api/swarm/announce`。
8. sidecar `/seed/start` payload 使用 `ws://127.0.0.1:7072` 或 `SWARM_SEEDER_TRACKER_URL`。
9. `git status --short` 已复核。

---

## 8. 自审结果

1. 本 plan 没有把 public WSS 降级成 WS，符合 HTTPS 浏览器安全边界。
2. 本 plan 没有新增第二个 WebTorrent 分发平面，只是拆开 public/private announce 配置。
3. 本 plan 没有要求手搓 tracker 或替换成熟轮子，未来 tracker 高性能替换只作为后续评估。
4. 本 plan 覆盖了 complete、source_hash reuse、后台对账三类 seeder start 入口。
5. 本 plan 把烟测门禁从“能播放”提高到 locator、sidecar、tracker、日志、控制台多证据一致。
6. 风险点：WebRTC peer wire 的自动化断言当前计划仍偏手工/日志化；如果执行时发现 runtime 没有可读指标，应先补最小观测导出，再做最终完成声明。
