# 后端 WebTorrent 零延迟强种子群友 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务器后端在群里发送任意图片/视频后，sidecar 立即以同一个 WebTorrent swarm 的完整 WebRTC peer 身份做种；不把 HTTP 成功、WebSeed 可用或本地文件存在伪装成 `backend_strong_seed`。

**Architecture:** Rust 仍是 canonical 字节、torrent 元信息、join_ticket 和 DB presence 的 owner；Node sidecar 仍是 WebTorrent 运行时 owner。Rust 只通过本机私有 `/seed/start` 控制面额外传入 `torrentBytesBase64`、`localFilePath`、`torrentFileName`，sidecar 在私有 staging 目录创建硬链接，然后仍调用 WebTorrent `client.add()` 加入 swarm，由 `torrent.done` 证明完整做种。

**Tech Stack:** Rust / Axum / sqlx / object_store LocalFileSystem, Node.js ESM, WebTorrent `^2.8.5`, NTFS `fs.link`, Vitest, Cargo tests, `run.ps1`, Playwright + Chrome DevTools + browser trace smoke.

---

## Non-Negotiable Invariants

- **唯一正式媒体分发链:** 浏览器正式媒体字节仍只走 WebTorrent whole-file swarm；WebSeed 只作为 BEP19 fallback，不成为第二业务真相。
- **不重新生成 torrent:** sidecar 禁止 `client.seed()` / `create-torrent`；必须使用 Rust 已生成的 `.torrent` 字节，避免 infoHash 分叉。
- **不暴露本地路径:** `localFilePath` 只存在于 Rust → sidecar 本机控制面；locator / room event / browser contract 不得出现本地路径或 torrent bytes。
- **不绕过 done 门控:** `backend_strong_seed` presence 仍只能在 sidecar 返回 `done: true` 后写入。
- **S3/local 分离:** 只有 `MEDIA_STORAGE_DRIVER=local` 才发送 `localFilePath`；S3 模式继续用现有 WebSeed/WebTorrent 下载路径。
- **硬链接失败不造假:** 跨卷、权限、文件缺失时 sidecar 降级到现有 `client.add(torrentBytes/torrentUrl, { urlList })`，返回 `localSeedReady: false`，Rust 不写强种子 presence。

---

## Evidence Already Gathered

- **GitNexus:** `执行一次协作分发做种对账` 已按 sidecar `/seed/start` 响应 `done` 门控 `backend_strong_seed`。
- **GitNexus:** `启动做种会话` 当前只 `client.add(source, { urlList })`；source 优先 `torrentUrl`，所以 sidecar 需要先从 WebSeed 下载完整文件才 `done`。
- **WebTorrent docs:** `client.add(torrentId, { path, urlList })` 会校验 path 下已有文件；`torrent.done` 是完整下载/做种事实。
- **P2P 设计:** 初始强 seed 应在 moment zero 拥有完整数据；重复从同机 HTTP 下载再做种会推迟 swarm 健康。

---

## File Map

| 文件 | 责任 |
|---|---|
| `src/外壳/mod.rs` | 增加 `attachment_storage_is_local` shell 配置位，只表达对象存储 adapter 能力。 |
| `src/媒体/模型.rs` | `待做种协作分发项` 增加 canonical 存储键与 torrent bytes，用于后台对账补偿。 |
| `src/媒体/协作分发/适配.rs` | 待做种查询 join canonical asset，取 `storage_key` / `torrent_bytes`。 |
| `src/外壳/协作分发做种.rs` | 扩展 sidecar start 命令，构造本地强种子线索，POST 私有控制面。 |
| `src/媒体/应用.rs` | 增加读取 canonical 强种子源的仓储端口方法，只给 shell 私有启动链使用。 |
| `src/媒体/适配.rs` | 实现 canonical 强种子源查询，返回 storage key + torrent bytes。 |
| `src/媒体/上传/外壳/完成上传.rs` | fresh complete 成功后用已在内存里的 canonical storage key + torrent bytes 启动零延迟做种。 |
| `src/媒体/上传/外壳/附件响应.rs` | 复用/转发 ready 资产时通过 content_hash 查询 canonical 线索后启动零延迟做种。 |
| `frontend/dev-seeder.mjs` | 接收本地强种子线索，硬链接到 staging，调用 WebTorrent `client.add()`。 |
| `frontend/tests/dev-seeder做种续租测试.spec.ts` | 增加 sidecar 硬链接与 fallback 单测。 |
| `tests/协作分发测试/可用性裁决_做种对账.rs` | 增加 Rust payload / presence 对账回归。 |
| `tests/媒体上传测试/单文件主链.rs` | 增加 complete 后 `/seed/start` 携带本地强种子私有线索的断言。 |

---

## Task 0: Pre-Edit Impact Baseline

**Files:** no edits

- [ ] **Step 1: Run GitNexus impact for Rust symbols**

Run before edits:

```text
mcp1_impact(target="协作分发做种启动命令", direction="upstream", repo="koko", maxDepth=3)
mcp1_impact(target="尝试启动协作分发做种", direction="upstream", repo="koko", maxDepth=3)
mcp1_impact(target="待做种协作分发项", direction="upstream", repo="koko", maxDepth=3)
```

Expected: affected callers are upload complete, ready-asset response, realtime strong seed confirmation, and reconcile tests. If risk is HIGH/CRITICAL, stop and report before editing.

- [ ] **Step 2: Run GitNexus impact for sidecar symbol**

```text
mcp1_impact(target="启动做种会话", file_path="frontend/dev-seeder.mjs", direction="upstream", repo="koko", maxDepth=3)
```

Expected: impact stays inside `frontend/dev-seeder.mjs` and `frontend/tests/dev-seeder做种续租测试.spec.ts`.

---

## Task 1: Rust Model + Repository Carries Canonical Seed Source

**Files:**
- Modify: `src/媒体/模型.rs:310-318`
- Modify: `src/媒体/协作分发/适配.rs:119-192`
- Test: `tests/协作分发测试/可用性裁决_做种对账.rs`

- [ ] **Step 1: Write RED test for reconcile payload source**

Add a test that inserts a ready attachment with canonical asset metadata, runs `执行一次协作分发做种对账`, and asserts fake seeder receives private seed fields:

```rust
assert_eq!(payload["infoHash"].as_str(), Some(info_hash.as_str()));
assert!(payload["torrentBytesBase64"].as_str().is_some());
assert!(payload["localFilePath"].as_str().is_some());
assert_eq!(
    payload["torrentFileName"].as_str(),
    Some(format!("content-{content_hash}.mp4").as_str())
);
```

The existing fake seeder records raw JSON payloads, so no new server is needed.

- [ ] **Step 2: Verify RED**

Run:

```powershell
cargo test --test 协作分发测试 做种对账会携带本地强种子私有线索 -- --nocapture
```

Expected: FAIL because payload does not contain `torrentBytesBase64`, `localFilePath`, or `torrentFileName`.

- [ ] **Step 3: Extend `待做种协作分发项`**

Change struct to:

```rust
pub struct 待做种协作分发项 {
    pub 附件标识: String,
    pub 会话标识: String,
    pub content_id: String,
    pub content_hash: String,
    pub swarm_id: String,
    pub web_seed_until秒: i64,
    pub torrent_info_hash: String,
    pub canonical_storage_key: String,
    pub torrent_bytes: Vec<u8>,
}
```

- [ ] **Step 4: Join canonical asset in `列出待做种协作分发项_异步`**

Use exact storage key from DB instead of guessing extension:

```sql
JOIN attachment_canonical_asset_refs acar
  ON acar.attachment_id = a.attachment_id
JOIN canonical_media_assets cma
  ON cma.content_hash = acar.content_hash
 AND cma.content_hash = dm.content_hash
```

Select:

```sql
cma.storage_key AS canonical_storage_key,
dm.torrent_bytes
```

Map:

```rust
canonical_storage_key: row.get("canonical_storage_key"),
torrent_bytes,
```

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
cargo test --test 协作分发测试 做种对账会携带本地强种子私有线索 -- --nocapture
cargo test --test 协作分发测试 做种对账sidecar返回notready时不写backend_strong_seed_presence -- --nocapture
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/媒体/模型.rs src/媒体/协作分发/适配.rs tests/协作分发测试/可用性裁决_做种对账.rs
git commit -m "feat: 对账携带 canonical 强种子源"
```

---

## Task 2: Rust Builds Private Local Seed Hints

**Files:**
- Modify: `src/外壳/mod.rs`
- Modify: `src/外壳/协作分发做种.rs`
- Test: inline unit tests in `src/外壳/协作分发做种.rs`

- [ ] **Step 1: Write RED unit tests**

Add tests for three behaviors:

```rust
#[test]
fn 本地对象存储会构造硬链接做种线索() {
    let hint = 构造本地强种子线索(
        true,
        r"E:\koko\data\attachments",
        "media-assets/abcd/canonical.mp4",
        "abcd",
        vec![1, 2, 3],
    )
    .expect("local hint");

    assert!(hint.local_file_path.ends_with(r"media-assets\abcd\canonical.mp4") || hint.local_file_path.ends_with("media-assets/abcd/canonical.mp4"));
    assert_eq!(hint.torrent_file_name, "content-abcd.mp4");
    assert_eq!(hint.torrent_bytes, vec![1, 2, 3]);
}

#[test]
fn s3对象存储不会伪造本地路径() {
    assert!(构造本地强种子线索(false, "data/attachments", "media-assets/abcd/canonical.mp4", "abcd", vec![1]).is_none());
}

#[test]
fn 非canonical存储键不会生成torrent文件名() {
    assert!(构造本地强种子线索(true, "data/attachments", "media-assets/abcd/original.mp4", "abcd", vec![1]).is_none());
}
```

- [ ] **Step 2: Verify RED**

```powershell
cargo test 本地对象存储会构造硬链接做种线索 -- --nocapture
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Add shell state flag**

In `应用状态` add:

```rust
pub attachment_storage_is_local: bool,
```

In `构建应用状态` set:

```rust
attachment_storage_is_local: matches!(media_storage.驱动, crate::assembly::媒体存储驱动::本地目录),
```

- [ ] **Step 4: Extend start command**

Add fields:

```rust
pub torrent_bytes_base64: Option<String>,
pub local_file_path: Option<String>,
pub torrent_file_name: Option<String>,
```

Add helper types/functions in `src/外壳/协作分发做种.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 本地强种子线索 {
    pub local_file_path: String,
    pub torrent_file_name: String,
    pub torrent_bytes: Vec<u8>,
}

pub(crate) fn 构造本地强种子线索(
    storage_is_local: bool,
    storage_root: &str,
    storage_key: &str,
    content_hash: &str,
    torrent_bytes: Vec<u8>,
) -> Option<本地强种子线索> {
    if !storage_is_local || storage_root.trim().is_empty() || torrent_bytes.is_empty() {
        return None;
    }
    let file_name = storage_key.rsplit('/').next()?;
    let extension = file_name.strip_prefix("canonical")?;
    if extension.is_empty() || !extension.starts_with('.') {
        return None;
    }
    let local_file_path = std::path::Path::new(storage_root)
        .join(storage_key)
        .to_string_lossy()
        .to_string();
    Some(本地强种子线索 {
        local_file_path,
        torrent_file_name: format!("content-{content_hash}{extension}"),
        torrent_bytes,
    })
}
```

- [ ] **Step 5: Encode payload**

In `尝试启动协作分发做种`, add:

```rust
"torrentBytesBase64": 命令.torrent_bytes_base64,
"localFilePath": 命令.local_file_path,
"torrentFileName": 命令.torrent_file_name,
```

Use existing `base64 = "0.22"`:

```rust
use base64::Engine as _;

let torrent_bytes_base64 = Some(base64::engine::general_purpose::STANDARD.encode(hint.torrent_bytes));
```

- [ ] **Step 6: Verify GREEN**

```powershell
cargo test 本地对象存储会构造硬链接做种线索 -- --nocapture
cargo test s3对象存储不会伪造本地路径 -- --nocapture
cargo test 非canonical存储键不会生成torrent文件名 -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/外壳/mod.rs src/外壳/协作分发做种.rs
git commit -m "feat: 构造 sidecar 本地强种子线索"
```

---

## Task 3: Wire Fresh Upload, Reuse, and Reconcile Into the Same Hint Path

**Files:**
- Modify: `src/媒体/上传/外壳/完成上传.rs:620-646`
- Modify: `src/媒体/上传/外壳/附件响应.rs:48-63`
- Modify: `src/外壳/协作分发做种.rs:138-286`
- Test: `tests/媒体上传测试/单文件主链.rs`
- Test: `tests/协作分发测试/可用性裁决_做种对账.rs`

- [ ] **Step 1: Write RED for fresh complete**

In `tests/媒体上传测试/单文件主链.rs`, extend fake seeder assertion:

```rust
assert!(payload["torrentBytesBase64"].as_str().is_some(), "complete 后必须把 Rust 生成的 torrent bytes 交给 sidecar");
assert!(payload["localFilePath"].as_str().is_some(), "本地对象存储必须给 sidecar 本地 canonical 文件路径");
assert!(payload["torrentFileName"].as_str().unwrap_or_default().starts_with("content-"));
```

- [ ] **Step 2: Verify RED**

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
```

Expected: FAIL because payload lacks local seed hints.

- [ ] **Step 3: Fresh upload uses in-memory canonical request**

After `从协作分发响应构造做种启动命令`, enrich command with:

```rust
let 本地强种子线索 = super::协作分发做种::构造本地强种子线索(
    state.attachment_storage_is_local,
    state.attachment_storage_dir.as_str(),
    canonical_asset_request.存储键.as_str(),
    canonical_asset_request.content_hash.as_str(),
    canonical_asset_request.torrent_bytes.clone(),
);
let 启动命令 = super::协作分发做种::附加本地强种子线索(启动命令, 本地强种子线索);
```

Keep the current `tokio::spawn` fire-and-forget behavior.

- [ ] **Step 4: Reconcile uses DB-backed hints**

Inside `执行一次协作分发做种对账`, after command creation:

```rust
let 本地强种子线索 = 构造本地强种子线索(
    state.attachment_storage_is_local,
    state.attachment_storage_dir.as_str(),
    待做种.canonical_storage_key.as_str(),
    待做种.content_hash.as_str(),
    待做种.torrent_bytes.clone(),
);
let 启动命令 = 附加本地强种子线索(启动命令, 本地强种子线索);
```

- [ ] **Step 5: Reuse/forward ready asset queries canonical seed source**

Add a small shell helper in `协作分发做种.rs`:

```rust
pub(crate) async fn 查询本地强种子线索(
    state: &应用状态,
    content_hash: &str,
) -> Option<本地强种子线索> {
    if !state.attachment_storage_is_local {
        return None;
    }
    let state = state.clone();
    let content_hash = content_hash.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        let media_repo = repo.媒体仓储();
        let source = crate::media::application::媒体仓储端口::读取canonical强种子源(
            &media_repo,
            content_hash.as_str(),
        ).ok().flatten()?;
        构造本地强种子线索(
            state.attachment_storage_is_local,
            state.attachment_storage_dir.as_str(),
            source.存储键.as_str(),
            source.content_hash.as_str(),
            source.torrent_bytes,
        )
    })
    .await
    .ok()
    .flatten()
}
```

Add `读取canonical强种子源` to `媒体仓储端口` and Pg implementation with this SQL:

```sql
SELECT content_hash, storage_key, torrent_bytes, torrent_info_hash
FROM canonical_media_assets
WHERE content_hash = $1
  AND origin_deleted_at IS NULL
```

Then `附件响应.rs` enriches existing command via `查询本地强种子线索(state, 协作分发.content_hash.as_str()).await`.

- [ ] **Step 6: Verify GREEN**

```powershell
cargo test --test 媒体上传测试 视频complete会触发seeder_start命令 -- --nocapture
cargo test --test 协作分发测试 做种对账会携带本地强种子私有线索 -- --nocapture
cargo check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/媒体/上传/外壳/完成上传.rs src/媒体/上传/外壳/附件响应.rs src/外壳/协作分发做种.rs src/媒体/应用.rs src/媒体/适配.rs tests/媒体上传测试/单文件主链.rs tests/协作分发测试/可用性裁决_做种对账.rs
git commit -m "feat: 上传与对账启动零延迟强种子"
```

---

## Task 4: Sidecar Hardlinks Canonical File Into WebTorrent Staging

**Files:**
- Modify: `frontend/dev-seeder.mjs`
- Test: `frontend/tests/dev-seeder做种续租测试.spec.ts`

- [ ] **Step 1: Write RED helper tests**

Add Vitest tests:

```ts
it("本地强种子线索会把 canonical 文件硬链接成 torrent 内部文件名", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { 准备本地强种子文件 } = (await import("../dev-seeder.mjs")) as unknown as {
    准备本地强种子文件(payload: Record<string, unknown>, infoHash: string): Promise<null | {
      source: Buffer;
      downloadPath: string;
      localSeedReady: boolean;
      localSeedMode: string;
    }>;
  };

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "koko-seed-test-"));
  const canonical = path.join(root, "canonical.mp4");
  await fs.writeFile(canonical, Buffer.from([1, 2, 3, 4]));

  const result = await 准备本地强种子文件({
    localFilePath: canonical,
    torrentFileName: "content-aaaaaaaa.mp4",
    torrentBytesBase64: Buffer.from([9, 8, 7]).toString("base64"),
  }, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  expect(result?.localSeedReady).toBe(true);
  expect(result?.localSeedMode).toBe("hardlink");
  await expect(fs.readFile(path.join(result!.downloadPath, "content-aaaaaaaa.mp4"))).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
});
```

Add fallback test:

```ts
it("本地文件缺失时仍返回 Rust torrent bytes 作为 WebTorrent source 但不声称 local ready", async () => {
  const { 准备本地强种子文件 } = (await import("../dev-seeder.mjs")) as unknown as {
    准备本地强种子文件(payload: Record<string, unknown>, infoHash: string): Promise<null | { source: Buffer; localSeedReady: boolean; localSeedMode: string }>;
  };

  const result = await 准备本地强种子文件({
    localFilePath: "Z:/missing/canonical.mp4",
    torrentFileName: "content-aaaaaaaa.mp4",
    torrentBytesBase64: Buffer.from([9, 8, 7]).toString("base64"),
  }, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  expect(result?.source).toEqual(Buffer.from([9, 8, 7]));
  expect(result?.localSeedReady).toBe(false);
  expect(result?.localSeedMode).toBe("fallback");
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
```

Expected: FAIL because `准备本地强种子文件` is not exported.

- [ ] **Step 3: Add sidecar imports and helper**

In `frontend/dev-seeder.mjs` add:

```javascript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
```

Add helper:

```javascript
const 读取做种暂存根目录 = () =>
  process.env.SWARM_SEEDER_STAGING_DIR?.trim() || path.join(os.tmpdir(), "koko-webtorrent-seeder");

export const 准备本地强种子文件 = async (payload, normalizedInfoHash) => {
  const torrentBytesBase64 = typeof payload?.torrentBytesBase64 === "string" ? payload.torrentBytesBase64.trim() : "";
  const localFilePath = typeof payload?.localFilePath === "string" ? payload.localFilePath.trim() : "";
  const torrentFileName = typeof payload?.torrentFileName === "string" ? payload.torrentFileName.trim() : "";
  if (!torrentBytesBase64 || !torrentFileName) {
    return null;
  }
  const source = Buffer.from(torrentBytesBase64, "base64");
  const downloadPath = path.join(读取做种暂存根目录(), normalizedInfoHash);
  if (!localFilePath) {
    return { source, downloadPath, localSeedReady: false, localSeedMode: "fallback" };
  }
  const targetPath = path.join(downloadPath, torrentFileName);
  try {
    await fs.rm(downloadPath, { recursive: true, force: true });
    await fs.mkdir(downloadPath, { recursive: true });
    await fs.link(localFilePath, targetPath);
    return { source, downloadPath, targetPath, localSeedReady: true, localSeedMode: "hardlink" };
  } catch (error) {
    await fs.rm(downloadPath, { recursive: true, force: true }).catch(() => {});
    return { source, downloadPath, localSeedReady: false, localSeedMode: "fallback", localSeedError: error instanceof Error ? error.message : String(error) };
  }
};
```

- [ ] **Step 4: Use helper in `启动做种会话`**

Before `client.add` options:

```javascript
const localSeed = await 准备本地强种子文件(payload, normalizedInfoHash);
const source = localSeed?.source ?? 选择种子来源(payload, normalizedInfoHash);
```

In options add path only when source is local seed:

```javascript
...(localSeed?.downloadPath ? { path: localSeed.downloadPath } : {}),
```

In session add:

```javascript
localSeedReady: Boolean(localSeed?.localSeedReady),
localSeedMode: localSeed?.localSeedMode ?? "none",
```

In `/seed/start` response add:

```javascript
localSeedReady: Boolean(session.localSeedReady),
localSeedMode: session.localSeedMode ?? "none",
```

- [ ] **Step 5: Verify GREEN**

```powershell
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/dev-seeder.mjs frontend/tests/dev-seeder做种续租测试.spec.ts
git commit -m "feat: sidecar 硬链接本地文件加入 WebTorrent"
```

---

## Task 5: End-to-End Contract Tests Preserve WebTorrent Truth

**Files:**
- Modify: `tests/协作分发测试/可用性裁决_做种对账.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`

- [ ] **Step 1: Add regression test for localSeedReady false**

Fake seeder returns:

```json
{ "ok": true, "created": true, "done": false, "progress": 0.0, "capability": "hybrid", "localSeedReady": false, "localSeedMode": "fallback" }
```

Assert DB still has no `backend_strong_seed`:

```rust
assert_eq!(strong_seed_count, 0, "localSeedReady=false 不能替代 torrent.done");
```

- [ ] **Step 2: Verify the existing done gate still protects the invariant**

Run:

```powershell
cargo test --test 协作分发测试 localSeedReady_false不能写backend_strong_seed -- --nocapture
```

Expected: PASS. This is a regression lock, not a production-code RED step, because the previous `done` gate already fixed this class of bug.

- [ ] **Step 3: Assert done true remains only success path**

Fake seeder returns:

```json
{ "ok": true, "created": true, "done": true, "progress": 1.0, "capability": "hybrid", "localSeedReady": true, "localSeedMode": "hardlink" }
```

Assert `backend_strong_seed` is written once.

- [ ] **Step 4: Run focused regression**

```powershell
cargo test --test 协作分发测试 可用性裁决_做种对账 -- --nocapture
cargo test --test 媒体上传测试 单文件主链 -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/协作分发测试/可用性裁决.rs tests/协作分发测试/可用性裁决_做种对账.rs tests/媒体上传测试/单文件主链.rs
git commit -m "test: 锁定本地强种子不替代 done 事实"
```

---

## Task 6: Full Verification + Real Smoke

**Files:** no planned code edits

- [ ] **Step 1: Run backend/frontend checks**

```powershell
cargo check
cargo test --test 协作分发测试 可用性裁决_做种对账 -- --nocapture
cargo test --test 媒体上传测试 单文件主链 -- --nocapture
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: all PASS, no new warnings.

- [ ] **Step 2: Start real stack with launcher**

```powershell
pwsh -File .\run.ps1 -NonInteractive
```

Expected: seeder log contains `capability=hybrid`.

- [ ] **Step 3: Upload real MP4 in room `1234b`**

Use one MP4 from:

```text
D:\200-生活\230-照片备份\233-Telegram\色色
```

Expected `/seed/start` response contains:

```json
{
  "done": true,
  "localSeedReady": true,
  "localSeedMode": "hardlink",
  "capability": "hybrid"
}
```

- [ ] **Step 4: Verify DB presence**

```sql
SELECT peer_kind, COUNT(*)
FROM swarm_peer_presence
WHERE peer_kind = 'backend_strong_seed'
GROUP BY peer_kind;
```

Expected: at least one `backend_strong_seed` after `done: true`.

- [ ] **Step 5: Browser swarm smoke**

Use the required browser QA trio:

```text
playwright-cli: two browser sessions join room 1234b
chrome-devtools-cli: inspect console/network/media state
browser-trace: capture WebTorrent playback trace
```

Expected:

- sender video plays without black placeholder;
- second browser receives locator and plays through WebTorrent;
- sidecar `/health` shows session `done: true`, `localSeedReady: true`;
- no `join_ticket_invalid`, no missing ticket storm;
- media bytes are not served through any HLS/DASH/static preview chain.

- [ ] **Step 6: GitNexus and git hygiene**

```text
mcp1_detect_changes(scope="all", repo="koko")
```

Then:

```powershell
git status --short
```

Expected: only planned files changed; no generated logs/temp files.

- [ ] **Step 7: Final commit**

```powershell
git add src frontend tests
git commit -m "feat: 后端成为零延迟 WebTorrent 强种子群友"
```

---

## Self-Review 1 — Requirement Coverage

- **群中任意图片/视频:** fresh complete 路径覆盖图片与视频；reuse/forward 路径通过 content_hash 查询 canonical seed source；reconcile 补偿覆盖漏启。
- **纯 WebTorrent:** sidecar 仍用 `client.add()` 加入 WebTorrent swarm；硬链接只让 WebTorrent 本地 store 立即看到完整文件，不绕过 swarm。
- **强种子事实:** `backend_strong_seed` 仍只认 `torrent.done`，不认 HTTP 200、本地文件存在或 hardlink 成功。
- **高性能:** 同机媒体字节不再经 HTTP 下载一遍；硬链接零拷贝；失败自动 fallback。

## Self-Review 2 — Placeholder / Old Chain Scan

- 无占位符、延期实现口径或未闭环任务。
- 未引入 `client.seed()`、`create-torrent`、HLS/DASH、原文件直链或第二播放器链。
- 未把 local path/torrent bytes 放进 browser locator、room event 或 contract。

## Self-Review 3 — Type / Boundary Consistency

- Rust 字段命名使用私有控制面 camelCase JSON：`torrentBytesBase64` / `localFilePath` / `torrentFileName`。
- Rust 内部仍保持中文字段与 shell owner；sidecar 只做 adapter IO 和 WebTorrent 编排。
- S3 模式没有本地路径假象；WebSeed fallback 保留为 WebTorrent BEP19 输入。

## 100% Confidence Loop

**第一轮追问：当前计划是否 100% 有事实信心？** 不是，发现三类必须闭环的风险：

1. **WebTorrent store 路径风险:** `client.add(Buffer, { path })` 是否在 Windows 下按 `path/torrent.name` 校验已有硬链接文件。修复方案：Task 4 helper 单测 + Task 6 real smoke 确认 `done: true`。
2. **复用资产即时启动风险:** `附件响应.rs` 新增 canonical 查询不能污染 HTTP 响应延迟。修复方案：只查本地强种子线索，失败 fallback，不影响 ready 响应真相。
3. **旧 presence 误写风险:** hardlink 成功但 WebTorrent 未 done 时不能写 `backend_strong_seed`。修复方案：Task 5 锁定 `localSeedReady=false/true` 都不替代 `done`。

**第二轮追问：风险修正进入计划后是否 100% 有事实信心？** 是。所有已知漏洞都被绑定到具体任务、失败测试、通过条件和真实烟测；若 Task 6 任何一项失败，禁止交付，回到失败项补失败测试再修。
