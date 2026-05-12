# 后端 WebTorrent 强种子生产化闭环 Implementation Plan

**Goal:** `backend_strong_seed` presence 只在 sidecar 证明 `torrent.done === true && capability === "hybrid"` 时才写入。

**核心洞察:** WebTorrent 的 `torrent.done` 是"我是完整 seed"的唯一事实。`client.add()` callback 只表示 metadata ready，不表示 download done。当前 Rust 把 HTTP 200 当强种子——错了。正确做法：sidecar 在响应里透传 `done` + `capability`，Rust 看到 `done && hybrid` 才写 presence。reconcile 循环天然重试，首次 `done: false` → 下轮 `done: true`。

**Spec:** `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`

---

## File Map

| 文件 | 改动 |
|------|------|
| `frontend/dev-seeder.mjs` | `/seed/start` 响应加 `done`, `progress`, `capability` 三个字段（3 行） |
| `src/外壳/协作分发做种.rs` | `尝试启动协作分发做种` 返回 `serde_json::Value`；reconcile 按 `done && hybrid` 门控 presence |
| `tests/协作分发测试/可用性裁决.rs` | 假 seeder 响应加 `done: true`, `capability: "hybrid"` |
| `tests/协作分发测试/可用性裁决_做种对账.rs` | 新增 not-ready 集成测试 |
| `tests/媒体上传测试/单文件主链.rs` | 假 seeder 响应加 `done: true`, `capability: "hybrid"` |

---

## Task 1: Sidecar — `/seed/start` 响应透传 WebTorrent runtime 事实

**Files:** `frontend/dev-seeder.mjs:363-377`

sidecar 已有 `session.torrent`（WebTorrent torrent 对象）和模块级 `capability` 变量。只需在 `/seed/start` 响应里加三个字段。

- [ ] **Step 1:** 修改 `/seed/start` handler 的 `发送JSON响应` 调用

把 `dev-seeder.mjs:367-375` 的响应对象从：

```javascript
发送JSON响应(response, 200, {
  ok: true,
  created,
  refreshedTicket,
  restarted,
  sourceChanged,
  infoHash: session.infoHash,
  activeCount: activeSessions.size,
});
```

改为：

```javascript
发送JSON响应(response, 200, {
  ok: true,
  created,
  refreshedTicket,
  restarted,
  sourceChanged,
  infoHash: session.infoHash,
  done: Boolean(session.torrent?.done),
  progress: session.torrent?.progress ?? 0,
  capability,
  activeCount: activeSessions.size,
});
```

三个字段：`done`（WebTorrent 的 "complete seed" 布尔）、`progress`（下载进度 0-1）、`capability`（"hybrid"/"webtorrent"/"mock"）。

- [ ] **Step 2:** Commit

```
git add frontend/dev-seeder.mjs
git commit -m "feat: sidecar /seed/start 透传 done/progress/capability

torrent.done 是 WebTorrent 原生的 complete-seed 事实。
Rust 用 done && capability==hybrid 裁决 backend strong seed。"
```

---

## Task 2: Rust — `尝试启动协作分发做种` 返回响应体

**Files:** `src/外壳/协作分发做种.rs:98-129`

返回 `serde_json::Value` 而非 `()`，让 reconcile 能读取 sidecar 事实。同时顺手复用共享 HTTP client 消除每次 `reqwest::Client::new()`。

- [ ] **Step 1:** 修改函数签名和实现

```rust
pub(crate) async fn 尝试启动协作分发做种(
    state: &应用状态,
    命令: &协作分发做种启动命令,
) -> io::Result<serde_json::Value> {
    let url = format!("{}/seed/start", state.swarm_seeder_control_base_url);
    let payload = serde_json::json!({
        "infoHash": 命令.info_hash,
        "announceUrls": 命令.announce_urls,
        "webSeedUrl": 命令.web_seed_url,
        "torrentUrl": 命令.torrent_url,
        "joinTicket": 命令.join_ticket,
    });
    let response = reqwest::Client::new()
        .post(url.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|err| io::Error::other(format!("调用 seeder start 失败: {err}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("<empty>"));
        return Err(io::Error::other(format!(
            "调用 seeder start 返回非成功状态: status={status}, detail={detail}"
        )));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| io::Error::other(format!("解析 seeder start 响应失败: {err}")))
}
```

调用方 `src/实时/外壳.rs:993` 和 `src/媒体/上传/外壳/完成上传.rs:633` 都是 `if let Err(err) = ...` 模式，对返回类型变化透明，无需改动。

- [ ] **Step 2:** `cargo check` 确认编译通过

- [ ] **Step 3:** Commit

```
git add src/外壳/协作分发做种.rs
git commit -m "refactor: 尝试启动协作分发做种返回 serde_json::Value

解析 sidecar 响应体供 reconcile 读取 done/capability。
调用方 if-let-Err 模式透明，无需改动。"
```

---

## Task 3: 假 seeder 返回完整响应 + not-ready 集成测试（TDD RED）

**Files:**
- `tests/协作分发测试/可用性裁决.rs` — 假 seeder 响应加字段 + 新增 not-ready 假 seeder
- `tests/协作分发测试/可用性裁决_做种对账.rs` — 新增 not-ready 不写 presence 测试
- `tests/媒体上传测试/单文件主链.rs` — 假 seeder 响应加字段

- [ ] **Step 1:** 修改两处假 seeder 的 `记录假seeder_start请求`，在响应 JSON 中加入：

```json
"done": true,
"progress": 1.0,
"capability": "hybrid"
```

具体：回声请求中的 `infoHash`，加上 `done: true` 和 `capability: "hybrid"`。

- [ ] **Step 2:** 在 `tests/协作分发测试/可用性裁决.rs` 新增 not-ready 假 seeder

返回 `done: false, progress: 0.5, capability: "webtorrent"` 的 handler，搭配独立的 `启动假notready_seeder控制面()`。

- [ ] **Step 3:** 在 `tests/协作分发测试/可用性裁决_做种对账.rs` 新增测试

```rust
#[tokio::test]
#[serial]
async fn 做种对账sidecar返回notready时不写backend_strong_seed_presence()
```

测试逻辑：用 not-ready 假 seeder，跑 `执行一次协作分发做种对账`，断言 sidecar 收到了 start 命令但 `swarm_peer_presence` 中 `backend_strong_seed` 记录数为 0。

- [ ] **Step 4:** 运行新测试确认 FAIL

```
cargo test --test 协作分发测试 做种对账sidecar返回notready时不写backend_strong_seed_presence -- --nocapture
```

Expected: FAIL — 当前 reconcile 在 HTTP 200 后直接写 presence。

---

## Task 4: Reconcile 按 `done && hybrid` 门控 presence（TDD GREEN）

**Files:** `src/外壳/协作分发做种.rs:131-263`

核心修复：`尝试启动协作分发做种` 成功后，读 `done` 和 `capability`，只有 `done == true && capability == "hybrid"` 才写 presence。

- [ ] **Step 1:** 修改 `执行一次协作分发做种对账` 中 start 成功后的逻辑

把当前的：

```rust
if let Err(err) = 尝试启动协作分发做种(&state, &启动命令).await {
    // warn + continue
}
// 直接写 presence...
```

改为：

```rust
let resp = match 尝试启动协作分发做种(&state, &启动命令).await {
    Ok(v) => v,
    Err(err) => {
        tracing::warn!(..., "周期做种 start 失败，等待下一轮重试");
        continue;
    }
};
let done = resp["done"].as_bool().unwrap_or(false);
let cap = resp["capability"].as_str().unwrap_or("");
if !done || cap != "hybrid" {
    tracing::info!(
        application = "协作分发做种对账",
        adapter = "shell",
        outcome = "not_ready",
        attachment_id = 待做种.附件标识.as_str(),
        info_hash = 启动命令.info_hash.as_str(),
        done = done,
        capability = cap,
        progress = resp["progress"].as_f64().unwrap_or(0.0),
        "sidecar 未 done 或非 hybrid，不写 backend strong seed presence"
    );
    continue;
}
// 写 presence（原有逻辑不变）...
```

同时把 reconcile 尾部的 `reqwest::Client::new()` 也复用：目前暂保持不动（此函数只在尾部调一次 reconcile，不是热路径）。

- [ ] **Step 2:** 运行 Task 3 新测试确认 PASS

```
cargo test --test 协作分发测试 做种对账sidecar返回notready时不写backend_strong_seed_presence -- --nocapture
```

- [ ] **Step 3:** 运行全部对账测试确认无退化

```
cargo test --test 协作分发测试 做种对账 -- --nocapture
```

- [ ] **Step 4:** 运行全量测试

```
cargo test 2>&1 | tail -20
```

- [ ] **Step 5:** Commit

```
git add src/外壳/协作分发做种.rs tests/协作分发测试/ tests/媒体上传测试/
git commit -m "fix: reconcile 只在 sidecar done && hybrid 时写 backend strong seed presence

根因修复：不再把 HTTP 200 当强种子成立。
WebTorrent torrent.done 是 complete-seed 的唯一事实。
新增集成测试：sidecar 返回 not-ready 时不写 presence。"
```

---

## Task 5: 真实烟测

- [ ] **Step 1:** `pwsh run.ps1` 启动完整开发环境，确认 seeder 日志显示 `capability=hybrid`
- [ ] **Step 2:** 浏览器上传小视频，确认 `/seed/start` 响应包含 `done`/`capability` 字段
- [ ] **Step 3:** 双浏览器验证 WebTorrent swarm 播放正常
- [ ] **Step 4:** 查数据库 `swarm_peer_presence` 确认存在 `backend_strong_seed` 记录

---

## 设计决策说明

**为什么不造 struct / enum / 纯函数？**

WebTorrent 的 `torrent.done` 本身就是一个布尔值。裁决逻辑是 `done && capability == "hybrid"` — 两个字段的 AND。为此造一个 `SidecarSessionSnapshot` struct（7 字段）+ `后端强种子裁决` enum + `裁决后端强种子` 纯函数 + 5 个单元测试，属于"为 4 行逻辑造 80 行脚手架"。`serde_json::Value` 读两个字段足矣，集成测试覆盖真实行为。

**为什么没动 `src/外壳/mod.rs` 加共享 client？**

`reqwest::Client::new()` 复用是性能优化，不是根因修复。reconcile 一轮最多 256 项 × 串行，现有 client 足够。优化可后续迭代，不在此次 owner 纠偏中阻塞。

**为什么调用方（realtime/complete）不改？**

它们用 `if let Err(err) = ...` 只匹配错误。返回类型从 `Result<()>` 变成 `Result<Value>` 后，`Ok(Value)` 被静默丢弃。Rust 类型系统保证这一点。
