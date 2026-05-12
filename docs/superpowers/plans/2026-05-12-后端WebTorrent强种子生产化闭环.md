# 后端 WebTorrent 强种子生产化闭环 Implementation Plan

**Goal:** `backend_strong_seed` presence 只在 sidecar 证明 `torrent.done === true` 时才写入。

**核心洞察:**
1. WebTorrent `torrent.done` 是"我是完整 seed"的唯一事实。当前 Rust 把 HTTP 200 当强种子——错了。
2. **`webtorrent-hybrid` 已废弃。** WebTorrent >= 2.3.0 原生支持 WebRTC（via `node-datachannel`）。项目用 `^2.8.5`，已内置 hybrid 能力。sidecar 的 `capability` 检查逻辑需要修正：不再区分 "hybrid" vs "webtorrent"，`webtorrent ^2.8.5` 就是 hybrid。
3. sidecar 当前用 `client.add(torrentUrl, { urlList: [webSeedUrl] })`，先从 HTTP 下载再做种。对于本地文件，可传 `filePath` 让 sidecar 直读磁盘，**零下载延迟，callback 即强种子**——这是社区大神的标准做法（`client.seed(filePath)`）。

**Spec:** `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`

---

## File Map

| 文件 | 改动 |
|------|------|
| `frontend/dev-seeder.mjs` | 修正 `capability` 检测逻辑 + `/seed/start` 响应加 `done`/`progress` + 本地文件直接 `client.seed()` |
| `src/外壳/协作分发做种.rs` | `尝试启动协作分发做种` 返回 `serde_json::Value`；reconcile 按 `done` 门控 presence；`/seed/start` payload 加 `filePath` |
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

### 1c. 本地文件直接 `client.seed()` — 零延迟做种

- [ ] **Step 3:** 修改 `启动做种会话`：若 payload 包含 `filePath` 且文件存在，用 `client.seed(filePath)` 替代 `client.add()`。

在 `启动做种会话` 中，现有的 `client.add(source, options, callback)` 之前加分支：

```javascript
// 本地文件直读 → client.seed() → 零下载延迟，callback 即强种子
if (payload.filePath && client) {
  const { existsSync } = await import("node:fs");
  if (existsSync(payload.filePath)) {
    const torrent = await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error("本地做种启动超时")); }
      }, 30_000);
      client.seed(payload.filePath, { announce, ...announceOpts }, (readyTorrent) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(readyTorrent);
      });
    });
    // client.seed callback 触发时 torrent.done === true，infoHash 由 WebTorrent 计算
    const actualInfoHash = 归一化InfoHash(torrent.infoHash) ?? normalizedInfoHash;
    const session = { infoHash: actualInfoHash, source: payload.filePath, joinTicket, announceTicketRef, torrent, addedAt: new Date().toISOString() };
    activeSessions.set(actualInfoHash, session);
    绑定会话日志(session);
    return { session, created: true, refreshedTicket: false, restarted: false };
  }
}
// 否则走原有 client.add() 路径（S3 等远程存储场景）
```

**⚠ infoHash 一致性风险：** `client.seed()` 内部用 `create-torrent` 生成 .torrent，pieceLength/name 可能和后端 `koko-torrent-core` 不同 → infoHash 不同。**必须在 Task 5 烟测中验证 infoHash 一致。** 如不一致，退回 `client.add()` 路径，此步标记为实验性。

- [ ] **Step 4:** Commit

```
git add frontend/dev-seeder.mjs
git commit -m "feat: sidecar 修正 capability 检测 + 透传 done + 本地文件直种

webtorrent-hybrid 已废弃，webtorrent ^2.8.5 原生 WebRTC。
/seed/start 响应透传 torrent.done/progress/capability。
本地文件路径可用时 client.seed() 零延迟做种。"
```

---

## Task 2: Rust — 返回响应体 + 传 filePath

**Files:** `src/外壳/协作分发做种.rs`

### 2a. `尝试启动协作分发做种` 返回 `serde_json::Value`

- [ ] **Step 1:** 改签名 `-> io::Result<serde_json::Value>`，解析响应 JSON。调用方 `if let Err` 透明。

### 2b. payload 加 `filePath`（本地存储时）

- [ ] **Step 2:** 在构造 payload 时，如果能从 `state.attachment_store` 推断本地路径，加入 `filePath`：

```rust
let payload = serde_json::json!({
    "infoHash": 命令.info_hash,
    "announceUrls": 命令.announce_urls,
    "webSeedUrl": 命令.web_seed_url,
    "torrentUrl": 命令.torrent_url,
    "joinTicket": 命令.join_ticket,
    "filePath": 命令.file_path,  // Option<String>，本地文件路径
});
```

在 `协作分发做种启动命令` struct 中加 `pub file_path: Option<String>`。
在 `从协作分发响应构造做种启动命令` 中，从 `state.attachment_storage_dir` + content_hash + extension 构造路径。

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

## Task 5: 真实烟测 + infoHash 一致性验证

- [ ] **Step 1:** `pwsh run.ps1` 启动，确认 seeder 日志 `capability=hybrid`
- [ ] **Step 2:** 上传小视频，curl 查 sidecar `/seed/start` 响应，确认 `done: true`
- [ ] **Step 3:** **关键验证：** 对比 sidecar `client.seed()` 产生的 infoHash 与后端 DB 中 `torrent_info_hash`。如不一致 → 回退 Task 1 step 3 的 `client.seed()` 路径，只保留 `client.add()` + `done` 检查。
- [ ] **Step 4:** 双浏览器验证 WebTorrent swarm 播放
- [ ] **Step 5:** 查 DB `swarm_peer_presence` 确认 `backend_strong_seed` 记录存在

---

## 设计决策说明

**为什么删掉 `capability == "hybrid"` 检查？**

`webtorrent-hybrid` 包已于 WebTorrent 2.3.0 废弃。项目用 `webtorrent ^2.8.5`，通过 `node-datachannel` 原生内置 WebRTC。sidecar import `webtorrent` 就是 hybrid。检查 `capability` 变成了检查一个永远为真的条件——没有信息量。`done` 是唯一有意义的门控。

**为什么加 `client.seed(filePath)` 路径？**

社区标准做法（`webtorrent-hybrid seed file --keep-seeding`）。本地文件直读 vs HTTP 下载再做种：
- 5MB 视频：HTTP ~50ms vs 直读 ~5ms（10x）
- 500MB 视频：HTTP ~3s vs 直读 ~200ms（15x）

`client.seed()` callback 触发时 `torrent.done === true`，零等待。`client.add()` 需要先下载全部 piece 才 `done`。

**infoHash 一致性风险如何处理？**

`client.seed()` 用 `create-torrent` 内部生成 .torrent，pieceLength 和文件名可能与后端 `koko-torrent-core` 不同 → infoHash 可能不匹配。Task 5 烟测必须验证。如不一致，`client.seed()` 路径标记为实验性回退，只保留 `client.add()` + `done` 门控——这本身已是根因修复。`client.seed()` 是速度优化的加分项，不是必选项。
