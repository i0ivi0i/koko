# 后端 WebTorrent 零延迟强种子群友 Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-12-后端WebTorrent零延迟强种子群友-design.md`
**前置:** `docs/superpowers/plans/2026-05-12-后端WebTorrent强种子生产化闭环.md`（已落地）

**目标:** 本地对象存储模式下，Rust 下发权威 torrent bytes + 本地硬链接 staging hint，sidecar 用 `client.add(torrentBytes, { path })` 直接校验本机已有文件；消除 HTTP WebSeed 重下载延迟。`torrent.done` 仍为唯一 `backend_strong_seed` 门控。

---

## File Map

| 文件 | 改动 |
|------|------|
| `src/媒体/模型.rs` | `待做种协作分发项` 增加 `torrent_bytes` + `storage_key` |
| `src/媒体/协作分发/适配.rs` | SQL 增加 `a.storage_key`，构造时保留 `torrent_bytes` |
| `src/媒体/协作分发/应用.rs` | 无代码改动（trait 返回类型透明跟随 struct） |
| `src/外壳/mod.rs` | `应用状态` 增加 `media_storage_driver` |
| `src/外壳/协作分发做种.rs` | `协作分发做种启动命令` 扩展；payload 增加 `torrentBytesBase64` + `localSeed`；本地做种提示构造 |
| `src/媒体/协作分发/共享语义.rs` | 新增纯函数 `推导torrent内部文件名` |
| `frontend/dev-seeder.mjs` | `torrentBytesBase64` 优先 source；硬链接 staging；`readinessWaitMs`；staging 清理 |
| `tests/协作分发测试/可用性裁决_做种对账.rs` | 扩展 payload 断言 |
| `frontend/tests/` | WebTorrent ^2.8.5 characterization test |

---

## Task 0: WebTorrent ^2.8.5 Store Layout Characterization (Node/Vitest)

**风险门控：** hardlink 放什么路径完全取决于 WebTorrent 实测布局。spec 禁止无测试硬编码。

### 0a. RED — characterization 测试骨架

**File:** `frontend/tests/webtorrent-store-layout.spec.ts`（新建）

注意：此测试需要真实 Node.js `webtorrent` 运行时，不能 mock。vitest 在 Node 环境下运行，可以 import 真实 `webtorrent`。

测试逻辑：

1. 用 `koko-torrent-core`（或等效 JS 逻辑）从已知内容生成 torrent bytes。
2. 在临时目录 `stagingDir` 下按 **猜测布局** 放置同名文件。
3. `client.add(torrentBytes, { path: stagingDir })` — 不提供 urlList。
4. 断言 `torrent.done === true` 且 `torrent.downloaded === 0`（没有 HTTP 下载）。
5. 输出并锁定 `torrent.files[0].path`（相对于 stagingDir 的实际文件路径）。

初始猜测：`stagingDir/<torrentFileName>`（单文件 torrent，文件名由 metainfo 内部 `name` 字段决定）。

如果测试失败，说明猜测错误；调整放置路径后重试，直到找到正确布局。

验证：`pnpm vitest run frontend/tests/webtorrent-store-layout.spec.ts`

### 0b. 锁定布局 builder

从 characterization 测试中提取一个纯函数 `buildStagingPath(stagingRoot, infoHash, torrentFileName)`，sidecar 实现代码只能调用这个 builder。

### 0c. Commit

```
feat: WebTorrent ^2.8.5 store layout characterization test

锁定 client.add(torrentBytes, { path }) 的实际文件查找路径。
sidecar 硬链接只能复用该 builder，禁止无测试硬编码。
```

---

## Task 1: Rust 数据模型扩展

### 1a. RED — 编译失败

**File:** `src/媒体/模型.rs`

`待做种协作分发项` 新增两个字段：

```rust
pub struct 待做种协作分发项 {
    // ... existing fields ...
    pub torrent_info_hash: String,
    pub torrent_bytes: Vec<u8>,    // 新增：权威 .torrent 字节
    pub storage_key: String,       // 新增：canonical 对象存储键
}
```

编译会失败（adapter 构造不完整）。

### 1b. GREEN — adapter 补齐

**File:** `src/媒体/协作分发/适配.rs`

SQL 增加 `a.storage_key`：

```sql
SELECT a.attachment_id,
       s.session_id AS owner_session_id,
       dm.content_id,
       dm.content_hash,
       dm.swarm_id,
       EXTRACT(EPOCH FROM dm.web_seed_until)::BIGINT AS web_seed_until_epoch,
       dm.torrent_info_hash,
       dm.torrent_bytes,
       a.storage_key                      -- 新增
FROM attachments a
...
```

构造时保留 `torrent_bytes`（当前已 fetch 但丢弃）：

```rust
Some(crate::media::模型::待做种协作分发项 {
    // ... existing fields ...
    torrent_info_hash,
    torrent_bytes,                        // 保留，不再丢弃
    storage_key: row.get("storage_key"),  // 新增
})
```

### 1c. `应用状态` 增加 storage driver

**File:** `src/外壳/mod.rs`

```rust
pub struct 应用状态 {
    // ... existing fields ...
    pub media_storage_driver: crate::assembly::媒体存储驱动,
}
```

**File:** `src/外壳/mod.rs` `构建应用状态`：

```rust
Ok(应用状态 {
    // ... existing fields ...
    media_storage_driver: media_storage.驱动.clone(),
})
```

注意：`媒体存储驱动` 需要 `Clone`。当前已经是 `#[derive(Debug, Clone, PartialEq, Eq)]`，无需改动。

### 1d. 验证

```
cargo check
cargo test --lib
```

### 1e. Commit

```
feat: 待做种协作分发项 增加 torrent_bytes 和 storage_key

做种对账需要把权威 torrent bytes 直接下发 sidecar，避免 HTTP 重拉。
storage_key 用于 shell 构造本地 canonical 文件路径。
应用状态增加 media_storage_driver 以区分本地/S3 模式。
```

---

## Task 2: Rust 纯函数 — torrent 内部文件名推导

### 2a. RED — 纯函数测试

**File:** `src/媒体/协作分发/共享语义.rs` tests section

```rust
#[test]
fn 从content_hash和扩展名推导torrent内部文件名() {
    assert_eq!(
        推导torrent内部文件名("abcdef1234", ".mp4"),
        "content-abcdef1234.mp4"
    );
    assert_eq!(
        推导torrent内部文件名("abcdef1234", ".webp"),
        "content-abcdef1234.webp"
    );
}

#[test]
fn torrent内部文件名与生成附件torrent元信息一致() {
    let content = b"koko-consistency-check";
    let hash = 生成内容哈希(content);
    let ext = ".mp4";
    let metainfo = 生成附件torrent元信息(&hash, ext, content).unwrap();
    // 从 torrent_bytes 中解析实际文件名（用 bip_metainfo）
    // bip_metainfo 0.12 API 取文件名方式可能需要在实现时根据实际接口调整。
    // 核心断言：推导结果与 metainfo 内部文件名一致。
    let torrent = bip_metainfo::Metainfo::from_bytes(&metainfo.torrent_bytes).unwrap();
    let actual_name = /* 从 torrent.info() 提取单文件 torrent 的内部文件名 */;
    let derived = 推导torrent内部文件名(&hash, ext);
    assert_eq!(actual_name, derived, "推导结果必须与 metainfo 内部文件名一致");
}
```

验证测试按预期失败（函数不存在）。

### 2b. GREEN — 实现纯函数

**File:** `src/媒体/协作分发/共享语义.rs`

```rust
/// 从 content_hash 和稳定扩展名推导 torrent 内部文件名。
/// 必须与 `生成附件torrent元信息` 使用相同命名规则。
pub fn 推导torrent内部文件名(content_hash: &str, 稳定扩展名: &str) -> String {
    format!("content-{content_hash}{稳定扩展名}")
}
```

验证：`cargo test --lib 推导torrent内部文件名`

### 2c. 新增纯函数 — storage_key 扩展名提取

**File:** `src/外壳/协作分发做种.rs` 或 `共享语义.rs`

```rust
/// 从 canonical storage key 提取稳定扩展名。
/// 例：`media-assets/{hash}/canonical.mp4` → `.mp4`
fn 提取storage_key扩展名(storage_key: &str) -> Option<&str> {
    let dot_pos = storage_key.rfind('.')?;
    let ext = &storage_key[dot_pos..];
    if ext.len() > 1 && ext.chars().skip(1).all(|c| c.is_ascii_alphanumeric()) {
        Some(ext)
    } else {
        None
    }
}
```

测试：

```rust
#[test]
fn 提取canonical_storage_key扩展名() {
    assert_eq!(提取storage_key扩展名("media-assets/abc/canonical.mp4"), Some(".mp4"));
    assert_eq!(提取storage_key扩展名("media-assets/abc/canonical.webp"), Some(".webp"));
    assert_eq!(提取storage_key扩展名("no-extension"), None);
}
```

### 2d. Commit

```
feat: 纯函数推导 torrent 内部文件名和 storage_key 扩展名

推导规则必须与 生成附件torrent元信息 一致，测试锁定。
```

---

## Task 3: Rust Shell — Payload 扩展与本地做种提示

### 3a. RED — 单元测试先行

**File:** `src/外壳/协作分发做种.rs` tests section

新增测试：

```rust
#[test]
fn 本地存储模式下做种启动命令包含torrent_bytes_base64和local_seed() {
    // 构造已知 torrent_bytes 和 storage_key
    // 调用新的构造逻辑
    // 断言 payload 包含 torrentBytesBase64 (非空 base64)
    // 断言 payload 包含 localSeed.strategy == "hardlink"
    // 断言 localSeed.canonicalFilePath 以 attachment_storage_dir 开头
    // 断言 localSeed.torrentFileName == "content-{hash}{ext}"
}

#[test]
fn s3模式下做种启动命令不包含local_seed() {
    // media_storage_driver == S3对象存储
    // 断言 payload 不含 localSeed
    // 断言 payload 仍含 torrentBytesBase64
}
```

### 3b. GREEN — 扩展 struct 和 payload

**File:** `src/外壳/协作分发做种.rs`

扩展 `协作分发做种启动命令`：

```rust
pub(crate) struct 协作分发做种启动命令 {
    pub info_hash: String,
    pub announce_urls: Vec<String>,
    pub web_seed_url: Option<String>,
    pub torrent_url: Option<String>,
    pub join_ticket: Option<String>,
    pub torrent_bytes_base64: Option<String>,  // 新增
    pub local_seed: Option<serde_json::Value>, // 新增
}
```

新增 helper：

```rust
use base64::Engine as _;

/// 本地存储模式下构造 localSeed 控制面 hint。
/// S3 模式或参数不完整时返回 None。
fn 构造本地做种提示(
    media_storage_driver: &crate::assembly::媒体存储驱动,
    attachment_storage_dir: &str,
    storage_key: &str,
    content_hash: &str,
) -> Option<serde_json::Value> {
    if !matches!(media_storage_driver, crate::assembly::媒体存储驱动::本地目录) {
        return None;
    }
    let ext = 提取storage_key扩展名(storage_key)?;
    let torrent_file_name = crate::media_distribution::推导torrent内部文件名(content_hash, ext);
    let root_path = std::path::Path::new(attachment_storage_dir);
    let canonical_file_path = root_path.join(storage_key);
    let staging_root = std::env::var("SWARM_SEEDER_STAGING_DIR")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| root_path.join(".swarm-seeder-staging"));
    Some(serde_json::json!({
        "strategy": "hardlink",
        "rootPath": root_path.to_string_lossy(),
        "stagingRoot": staging_root.to_string_lossy(),
        "canonicalFilePath": canonical_file_path.to_string_lossy(),
        "torrentFileName": torrent_file_name,
    }))
}
```

更新 `尝试启动协作分发做种` payload：

```rust
let payload = serde_json::json!({
    "infoHash": 命令.info_hash,
    "announceUrls": 命令.announce_urls,
    "webSeedUrl": 命令.web_seed_url,
    "torrentUrl": 命令.torrent_url,
    "joinTicket": 命令.join_ticket,
    "torrentBytesBase64": 命令.torrent_bytes_base64,
    "localSeed": 命令.local_seed,
    "readinessWaitMs": 1500,
});
```

`从协作分发响应构造做种启动命令` 中新字段初始化为 None（保持向后兼容）：

```rust
Some(协作分发做种启动命令 {
    info_hash,
    announce_urls,
    web_seed_url,
    torrent_url,
    join_ticket: Some(join_ticket),
    torrent_bytes_base64: None,
    local_seed: None,
})
```

更新 `执行一次协作分发做种对账` 循环，在构造命令之后丰富新字段：

```rust
let Some(mut 启动命令) = 从协作分发响应构造做种启动命令(...) else { continue; };
启动命令.torrent_bytes_base64 = Some(
    base64::engine::general_purpose::STANDARD.encode(&待做种.torrent_bytes)
);
启动命令.local_seed = 构造本地做种提示(
    &state.media_storage_driver,
    &state.attachment_storage_dir,
    &待做种.storage_key,
    &待做种.content_hash,
);
```

### 3c. 验证

```
cargo test --lib 协作分发做种
cargo check
```

### 3d. Commit

```
feat: 做种对账下发 torrentBytesBase64 + localSeed 控制面 hint

本地存储模式下 sidecar 可用硬链接 staging 消除 HTTP 重下载。
S3 模式不伪造 localSeed，仍走 WebSeed fallback。
```

---

## Task 4: Node Sidecar — torrentBytesBase64 + 硬链接 Staging

### 4a. `torrentBytesBase64` 优先 source

**File:** `frontend/dev-seeder.mjs`

更新 `选择种子来源`：

```javascript
const 选择种子来源 = (payload, normalizedInfoHash) => {
  // torrentBytesBase64 优先：权威 bytes，不需要 HTTP 拉取
  if (typeof payload.torrentBytesBase64 === "string" && payload.torrentBytesBase64.length > 0) {
    return Buffer.from(payload.torrentBytesBase64, "base64");
  }
  // 注意：Buffer source 会导致 刷新已有做种会话 的 source 引用比较总为 true。
  // 这只影响 sourceChanged 诊断字段，不影响控制流。可接受。
  // 现有 fallback 保持不变
  if (typeof payload.magnetUri === "string" && payload.magnetUri.trim().length > 0) {
    return payload.magnetUri.trim();
  }
  if (typeof payload.torrentUrl === "string" && payload.torrentUrl.trim().length > 0) {
    return payload.torrentUrl.trim();
  }
  if (normalizedInfoHash) {
    return `magnet:?xt=urn:btih:${normalizedInfoHash}`;
  }
  return null;
};
```

### 4b. 硬链接 staging

**File:** `frontend/dev-seeder.mjs`

新增 helper：

```javascript
import { realpath, mkdir, link, unlink, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 准备本地硬链接 staging，让 WebTorrent 直接校验本机已有文件。
 * 返回 { mode, stagingDir, fallbackReason } 或 null。
 */
const 准备本地硬链接Staging = async (localSeed, normalizedInfoHash) => {
  if (!localSeed || localSeed.strategy !== "hardlink") {
    return { mode: "unavailable", fallbackReason: "missing_local_seed" };
  }
  const { rootPath, stagingRoot, canonicalFilePath, torrentFileName } = localSeed;
  // 路径安全校验
  if (!rootPath || !canonicalFilePath || !torrentFileName || !stagingRoot) {
    return { mode: "unavailable", fallbackReason: "incomplete_local_seed" };
  }
  if (torrentFileName.includes("/") || torrentFileName.includes("\\") || torrentFileName.includes(":")) {
    return { mode: "unavailable", fallbackReason: "unsafe_torrent_filename" };
  }
  try {
    const realRoot = await realpath(rootPath);
    const realFile = await realpath(canonicalFilePath);
    if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
      return { mode: "unavailable", fallbackReason: "path_outside_root" };
    }
    await mkdir(stagingRoot, { recursive: true });
    const realStaging = await realpath(stagingRoot);
    if (!realStaging.startsWith(realRoot + path.sep) && realStaging !== realRoot) {
      return { mode: "unavailable", fallbackReason: "staging_outside_root" };
    }
    // characterization test 锁定的布局 builder
    const stagingDir = path.join(realStaging, normalizedInfoHash);
    await mkdir(stagingDir, { recursive: true });
    const linkTarget = path.join(stagingDir, torrentFileName);
    // 确保 linkTarget 仍在 stagingDir 下
    const resolvedTarget = path.resolve(linkTarget);
    if (!resolvedTarget.startsWith(path.resolve(stagingDir) + path.sep)) {
      return { mode: "unavailable", fallbackReason: "link_target_escape" };
    }
    // 创建硬链接（已存在则先删再建）
    try { await unlink(linkTarget); } catch { /* ignore ENOENT */ }
    await link(realFile, linkTarget);
    return { mode: "hardlink", stagingDir, fallbackReason: null };
  } catch (err) {
    const code = err?.code;
    if (code === "EXDEV") {
      return { mode: "fallback_webseed", fallbackReason: "cross_device_link" };
    }
    if (code === "ENOENT") {
      return { mode: "unavailable", fallbackReason: "file_not_found" };
    }
    return { mode: "unavailable", fallbackReason: `hardlink_failed:${code ?? err?.message}` };
  }
};
```

### 4c. 更新 `启动做种会话` — 硬链接路径 + readinessWaitMs

在 `启动做种会话` 中，`client.add` 之前插入 staging 逻辑：

```javascript
// 在 existing check 之后、client.add 之前
const localSeedResult = payload.localSeed
  ? await 准备本地硬链接Staging(payload.localSeed, normalizedInfoHash)
  : { mode: "unavailable", fallbackReason: "missing_local_seed" };

const options = {
  announce,
  urlList,
  getAnnounceOpts: () => { ... },
};

// 硬链接成功时，添加 path 选项让 WebTorrent 查找本地文件
if (localSeedResult.mode === "hardlink" && localSeedResult.stagingDir) {
  options.path = localSeedResult.stagingDir;
}

const torrent = await new Promise((resolve, reject) => { ... client.add(source, options, cb) ... });
```

添加 `readinessWaitMs` 短等 `done`：

```javascript
// torrent ready 后，如果还没 done，短等 readinessWaitMs
const readinessWaitMs = Number(payload.readinessWaitMs) || 0;
if (!torrent.done && readinessWaitMs > 0) {
  await new Promise((resolve) => {
    const onDone = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { torrent.removeListener("done", onDone); resolve(); }, readinessWaitMs);
    torrent.once("done", onDone);
  });
}
```

session 增加 `localSeedMode` 和 `localSeedFallbackReason`：

```javascript
const session = {
  infoHash: actualInfoHash,
  source,
  joinTicket,
  announceTicketRef,
  torrent,
  addedAt: new Date().toISOString(),
  localSeedMode: localSeedResult.mode,
  localSeedFallbackReason: localSeedResult.fallbackReason,
  stagingDir: localSeedResult.stagingDir ?? null,
};
```

### 4d. `/seed/start` 响应增加 localSeed 字段

```javascript
发送JSON响应(response, 200, {
  ok: true,
  created,
  refreshedTicket,
  // ... existing fields ...
  done: Boolean(session.torrent?.done),
  progress: session.torrent?.progress ?? 0,
  capability,
  activeCount: activeSessions.size,
  localSeedMode: session.localSeedMode ?? "unavailable",
  localSeedReady: session.localSeedMode === "hardlink",
  localSeedFallbackReason: session.localSeedFallbackReason ?? null,
});
```

### 4e. staging 清理（reconcile 时）

在 `停止做种会话` 中添加 staging 目录清理：

```javascript
const 停止做种会话 = async (infoHashLike) => {
  // ... existing destroy logic ...
  // 清理 staging 目录
  if (session.stagingDir) {
    try { await rm(session.stagingDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  activeSessions.delete(normalizedInfoHash);
  return true;
};
```

### 4f. 验证

```
pnpm vitest run frontend/tests/webtorrent-store-layout.spec.ts
```

### 4g. Commit

```
feat: sidecar 支持 torrentBytesBase64 + 本地硬链接 staging

- torrentBytesBase64 优先于 torrentUrl 作为 client.add source
- localSeed.strategy=hardlink 时创建硬链接让 WebTorrent 校验本机文件
- 路径 containment 校验防止遍历攻击
- EXDEV 降级到 WebSeed fallback
- readinessWaitMs 短等 torrent.done
- reconcile/stop 清理 staging 目录
```

---

## Task 5: Rust 集成测试扩展

### 5a. 扩展假 seeder 以记录新字段

**File:** `tests/协作分发测试/可用性裁决_做种对账.rs`

假 seeder `/seed/start` handler 已记录 `start_payloads`。新增断言：

```rust
// 本地存储模式下（测试默认 local），payload 应包含 torrentBytesBase64
assert!(
    matched_start_payload["torrentBytesBase64"]
        .as_str()
        .map(|v| !v.is_empty())
        .unwrap_or(false),
    "做种对账必须下发非空 torrentBytesBase64，避免 sidecar 再走 HTTP 拉 .torrent"
);

// 本地存储模式下应包含 localSeed
assert_eq!(
    matched_start_payload["localSeed"]["strategy"].as_str(),
    Some("hardlink"),
    "本地存储模式下做种对账必须下发 localSeed hardlink 提示"
);
assert!(
    matched_start_payload["localSeed"]["canonicalFilePath"]
        .as_str()
        .map(|v| !v.is_empty())
        .unwrap_or(false),
    "localSeed 必须包含 canonicalFilePath"
);
assert!(
    matched_start_payload["localSeed"]["torrentFileName"]
        .as_str()
        .map(|v| v.starts_with("content-"))
        .unwrap_or(false),
    "localSeed.torrentFileName 必须以 content- 开头"
);
```

### 5b. 新增测试：sidecar done:false + localSeedReady:true 不写 presence

假 seeder 返回 `{ ok: true, done: false, localSeedReady: true }`，断言 `swarm_peer_presence` 中无 `backend_strong_seed` 记录。

这个测试锁住 **hardlink 成功不等于强种子** 的不变量。

### 5c. 验证

```
cargo test --test 可用性裁决_做种对账
```

### 5d. Commit

```
test: 做种对账集成测试覆盖 torrentBytesBase64 和 localSeed

新增 done:false+localSeedReady:true 不写 presence 的不变量断言。
```

---

## Task 6: 真实烟测

### 6a. 启动

```powershell
pwsh run.ps1
```

### 6b. 检查 sidecar

- `/health` → `capability=hybrid`
- 上传 MP4 → 观察 sidecar 日志
  - `/seed/start` 收到 `torrentBytesBase64` 和 `localSeed`
  - 硬链接创建成功
  - `done=true` 快速达成（不经过完整 HTTP 下载）

### 6c. 验证 presence

```sql
SELECT * FROM swarm_peer_presence
WHERE peer_kind = 'backend_strong_seed'
ORDER BY last_seen_at DESC LIMIT 5;
```

### 6d. 双浏览器播放

第二浏览器进入同房间，确认通过 WebTorrent swarm 播放视频。
不出现 HLS、DASH、原文件直链等第二正式播放路径。

### 6e. S3 模式验证（可选，需配置 S3 环境）

```
MEDIA_STORAGE_DRIVER=s3 ... pwsh run.ps1
```

确认 payload 不含 `localSeed`，但仍含 `torrentBytesBase64`。

---

## 设计决策说明

### 为什么 `torrent_bytes` 放在 `待做种协作分发项` 而不是再次查 DB？

查询已经 fetch 了 `dm.torrent_bytes`（用于 metainfo 校验），但构造 struct 时丢弃。保留它是零成本的，避免第二次 DB 查询。

### 为什么 `localSeed` 构造在 shell 而不是 adapter？

绝对文件路径是 shell 运行态配置（`attachment_storage_dir`）。adapter 只返回 storage key 相对路径。这符合 Onion 原则——adapter 不知道最终部署拓扑。

### 为什么不把 `构造本地做种提示` 放在 application 层？

它依赖 `SWARM_SEEDER_STAGING_DIR` 环境变量和 `media_storage_driver` 枚举——都是 shell/基础设施配置，不是业务语义。

### 为什么保留 `torrentUrl` fallback？

`torrentBytesBase64` 优先，但 `torrentUrl` 保留作为诊断入口。sidecar 可以用它对比验证。后续如果 `torrentBytesBase64` 被证明 100% 可靠，可以去掉 `torrentUrl`。

### `readinessWaitMs` 为什么不用 reconcile 循环代替？

硬链接 + piece verification 是本地磁盘顺序读，5MB MP4 约 50ms。1500ms 预算足够覆盖大多数场景。如果第一轮就 `done=true`，省掉一整个 reconcile 周期的延迟，后端强种子更快入群。

---

## 依赖顺序

```
Task 0 (characterization test)
  ↓
Task 1 (Rust model) → Task 2 (pure functions) → Task 3 (shell payload)
  ↓                                                     ↓
Task 4 (sidecar, 依赖 Task 0 + Task 3)
  ↓
Task 5 (integration tests)
  ↓
Task 6 (smoke test)
```

Task 0 可与 Task 1-3 并行（Node 和 Rust 独立）。

---

## 风险清单

| 风险 | 影响 | 缓解 |
|------|------|------|
| WebTorrent store layout 与猜测不一致 | 硬链接放错位置，sidecar 仍走 HTTP 下载 | Task 0 characterization 测试锁定 |
| NTFS 硬链接需同卷 | staging 跨卷时 `EXDEV` | 默认 staging 在 `attachment_storage_dir` 下，保证同卷 |
| `torrent_bytes` 增大内存占用 | .torrent 通常 <10KB，256 条 <3MB | 可接受 |
| `base64` crate 依赖 | 已确认 `base64 = "0.22"` 是直接依赖 | 无需额外添加 |
| sidecar 旧版本不认识新字段 | 透明忽略 JSON 未知字段 | sidecar JS 从 payload 取值用 optional chain |
