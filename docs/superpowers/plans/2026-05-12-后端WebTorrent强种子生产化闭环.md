# 后端 WebTorrent 强种子生产化闭环 Implementation Plan

**Goal:** `backend_strong_seed` presence 只在 sidecar 证明 `torrent.done === true` 时才写入。

**核心洞察:**
1. WebTorrent `torrent.done` 是"我是完整 seed"的唯一事实。当前 Rust 把 HTTP 200 当强种子——错了。
2. **`webtorrent-hybrid` 已废弃。** WebTorrent >= 2.3.0 原生支持 WebRTC（via `node-datachannel`）。项目用 `^2.8.5`，已内置 hybrid 能力。sidecar 的 `capability` 检测逻辑需要修正：`webtorrent ^2.8.5` 就是 hybrid。
3. `client.seed(filePath)` 零延迟做种是社区大神标准做法，但本项目的 torrent 文件名 (`content-{hash}.mp4`) 与本地存储文件名 (`canonical.mp4`) 不匹配，会导致 infoHash 不一致。此优化需要重构存储命名，超出本次范围。保留 `client.add()` + `done` 门控。

**Spec:** `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`

---

## File Map

| 文件 | 改动 |
|------|------|
| `frontend/dev-seeder.mjs` | 修正 `capability` 检测逻辑 + `/seed/start` 响应加 `done`/`progress` |
| `src/外壳/协作分发做种.rs` | `尝试启动协作分发做种` 返回 `serde_json::Value`；reconcile 按 `done` 门控 presence |
| `tests/协作分发测试/可用性裁决.rs` | 假 seeder 响应加 `done: true` |
| `tests/协作分发测试/可用性裁决_做种对账.rs` | 新增 not-ready 集成测试 |
| `tests/媒体上传测试/单文件主链.rs` | 假 seeder 响应加 `done: true` |

---

## Task 1: Sidecar — 修正 capability 检测 + 响应透传 done

**Files:** `frontend/dev-seeder.mjs`

### 1a. 修正 `读取WebTorrent构造器` — WebTorrent >= 2.3.0 就是 hybrid

`webtorrent-hybrid` 已废弃。`webtorrent ^2.8.5` 带 `node-datachannel` 原生 WebRTC。当前代码尝试 import `webtorrent-hybrid` 失败后把 `webtorrent` 标记为 `"webtorrent"` — 但实际它有完整 WebRTC 能力。

- [ ] **Step 1:** 修改 `读取WebTorrent构造器`：

```javascript
const 读取WebTorrent构造器 = async () => {
  if (process.env.SWARM_SEEDER_FORCE_MOCK?.trim() === "1") {
    return { Ctor: null, capability: "mock", error: new Error("forced by SWARM_SEEDER_FORCE_MOCK") };
  }
  // webtorrent >= 2.3.0 原生支持 WebRTC (node-datachannel)，webtorrent-hybrid 已废弃。
  try {
    const mod = await import("webtorrent");
    const Ctor = mod.default ?? mod.WebTorrent ?? mod;
    return { Ctor, capability: "hybrid" };
  } catch (err) {
    return { Ctor: null, capability: "mock", error: err };
  }
};
```

**关键变化：** 删除 `webtorrent-hybrid` import 尝试。`webtorrent ^2.8.5` 直接标记为 `"hybrid"`。

### 1b. `/seed/start` 响应加 `done` + `progress`

- [ ] **Step 2:** 修改 `dev-seeder.mjs:367-375` 响应对象，加三个字段：

```javascript
done: Boolean(session.torrent?.done),
progress: session.torrent?.progress ?? 0,
capability,
```

- [ ] **Step 3:** Commit

```
git add frontend/dev-seeder.mjs
git commit -m "feat: sidecar 修正 capability 检测 + 透传 done

webtorrent-hybrid 已废弃，webtorrent ^2.8.5 原生 WebRTC。
/seed/start 响应透传 torrent.done/progress/capability。"
```

---

## Task 2: Rust — `尝试启动协作分发做种` 返回响应体

**Files:** `src/外壳/协作分发做种.rs:98-129`

- [ ] **Step 1:** 改签名 `-> io::Result<serde_json::Value>`，解析响应 JSON。调用方 `if let Err` 透明。
- [ ] **Step 2:** `cargo check` 确认编译通过
- [ ] **Step 3:** Commit

---

## Task 3: 假 seeder + not-ready 集成测试（TDD RED）

同原 plan：假 seeder 响应加 `done: true` + `capability: "hybrid"`；新增 not-ready 假 seeder（`done: false`）；新增集成测试断言 not-ready 不写 presence。

---

## Task 4: Reconcile 按 `done` 门控 presence（TDD GREEN）

核心修复：

```rust
let resp = match 尝试启动协作分发做种(&state, &启动命令).await {
    Ok(v) => v,
    Err(err) => { tracing::warn!(...); continue; }
};
let done = resp["done"].as_bool().unwrap_or(false);
if !done {
    tracing::info!(..., "sidecar 未 done，不写 backend strong seed presence");
    continue;
}
// 写 presence...
```

**注意：不再检查 `capability == "hybrid"`。** `webtorrent ^2.8.5` 本身就是 hybrid。`done` 是唯一门控。mock 模式下 `done` 永远 `false`（mock torrent 无 `done` 属性），自然不写 presence。

---

## Task 5: 真实烟测

- [ ] **Step 1:** `pwsh run.ps1` 启动，确认 seeder 日志 `capability=hybrid`
- [ ] **Step 2:** 上传小视频，查 sidecar 日志确认 `/seed/start` 响应包含 `done: true`
- [ ] **Step 3:** 双浏览器验证 WebTorrent swarm 播放正常
- [ ] **Step 4:** 查 DB `swarm_peer_presence` 确认 `backend_strong_seed` 记录存在

---

## 设计决策说明

**为什么删掉 `capability == "hybrid"` 检查？**

`webtorrent-hybrid` 包已于 WebTorrent 2.3.0 废弃。项目用 `webtorrent ^2.8.5`，通过 `node-datachannel` 原生内置 WebRTC。sidecar import `webtorrent` 就是 hybrid。检查 `capability` 是检查一个永远为真的条件——没有信息量。`done` 是唯一有意义的门控。

**为什么不做 `client.seed(filePath)` 零延迟做种？**

社区大神标准做法是 `client.seed(file)`。但本项目有 infoHash 一致性问题：
- 后端 torrent 文件名：`content-{hash}.mp4`（`koko-torrent-core` / `bip_metainfo`）
- 本地存储文件名：`canonical.mp4`（`media-assets/{hash}/canonical.mp4`）
- `client.seed()` 用 `create-torrent` 重新生成 .torrent → pieceLength 和文件名都不同 → infoHash 不匹配
- `client.add(torrentUrl, { path: dir })` 也不行 → 文件名不匹配找不到文件

要实现零延迟做种，需要先统一存储文件名与 torrent 文件名。这是后续迭代的事。

**当前 `client.add()` + webSeedUrl 路径的延迟有多大？**

webSeedUrl 是 localhost HTTP。5MB 视频 ~50ms，足以满足群聊典型媒体。大视频首次延迟更高，但 reconcile 天然重试，首轮 `done: false` → 下轮 `done: true`。用户体验上，web seed URL 对浏览器始终可用，不依赖 strong seed presence。
