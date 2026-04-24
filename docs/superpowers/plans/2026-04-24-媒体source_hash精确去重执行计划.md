# 媒体 source_hash 精确去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新上传图片/视频在 canonical 预处理和 TUS 上传前，用原始文件 `source_hash` 精确命中同一授权房间内已有 ready 媒体，命中时复用 canonical 资产、`content_hash`、`swarm_id` 与 `torrent_info_hash`，但仍创建新的附件事实和后续消息事实。

**Architecture:** 内容身份层拥有 `source_hash / content_hash / torrent_info_hash / swarm_id` 真相；HTTP/前端只做协议和体验适配。新上传 first path 仍走现有 canonical 预处理、TUS、complete 链，complete 后把 canonical 字节落到内容寻址资产；source hit path 由后端应用用例在权限裁决后创建新的 ready 附件投影，不能复用旧消息，也不能绕过房间发送事务。

**Tech Stack:** Rust + SQLx + PostgreSQL + `sha2` + `object_store` + `bip_metainfo`；TypeScript + `hash-wasm` + `Blob.stream()` + Web Worker + Uppy/TUS + Mediabunny + Vitest。

---

## 0. 执行边界

本计划只做精确原文件去重，不做感知哈希、AI 相似度、帧级指纹或音视频相似度。`source_hash` 只等于用户选择的原始 `File` 字节 SHA-256。

禁止实现捷径：

- 禁止把多个附件直接指向同一个旧 `attachments.storage_key` 后仍按附件级冷源清理，否则一个附件过期会误删其他附件依赖的字节。
- 禁止让前端、播放器、WebTorrent runtime 判断两个文件是否相同。
- 禁止全局查询 `source_hash`，必须先过当前会话、当前房间成员资格和消息可见范围。
- 禁止命中后复用旧消息，命中只创建新附件事实；新消息仍走现有 `创建消息` 主链。
- 禁止新增非测试 `.rs` 文件；Rust 代码收口在现有 `用例.rs / 媒体上传外壳.rs / 媒体附件适配.rs / 适配.rs / 外壳.rs / 契约.rs`。

## 1. 文件结构

### 后端

- Modify: `Cargo.toml`
  - 不新增后端 hash/torrent/storage 轮子；继续使用已有 `sha2`、`object_store`、`bip_metainfo`。

- Create: `migrations/0020_媒体source_hash精确去重资产索引.sql`
  - 新增 `canonical_media_assets`：内容寻址 canonical 资产表，`content_hash` 是主键。
  - 新增 `attachment_canonical_asset_refs`：附件到 canonical 资产的引用表。
  - 新增 `attachment_source_hashes`：附件级原始文件 hash 索引。
  - 新增必要索引，支持 `source_hash + source_byte_size + kind + room_id` 查询路径。

- Modify: `tests/启动与迁移测试.rs`
  - 锁住 0020 migration 的表、约束、索引和“不做全局唯一 source_hash”的边界。

- Create: `tests/媒体上传测试/source_hash.rs`
  - 只守 source_hash 预检/复用主链。

- Modify: `tests/媒体上传测试.rs`
  - 挂载 `source_hash` 子模块。

- Modify: `tests/媒体上传测试/complete.rs`
  - 更新 first upload complete 预期：新 canonical 存储键应是内容寻址路径，而非 `images/{attachment_id}/canonical.webp` 或 `videos/{attachment_id}/canonical.mp4`。
  - 增加 complete 记录 `source_hash` 和 `canonical_asset_ref` 的断言。

- Modify: `tests/媒体后台测试/冷源清理.rs`
  - 增加内容资产级冷源清理测试。
  - 保留 legacy 附件级冷源清理测试，证明旧数据仍能退场。

- Modify: `src/用例.rs`
  - 增加 source dedupe 请求/结果结构。
  - 增加 canonical asset 写入/读取/清理端口结构。
  - 增加 `复用source_hash媒体附件` 用例。
  - `准备媒体附件上传` 接收可选 source 元数据并记录附件级 source hash。
  - `完成媒体附件上传` 写入 canonical asset ref 和 source hash 绑定。

- Modify: `src/媒体附件适配.rs`
  - 实现 SQL 仓储方法。
  - source hit 查询必须 join 当前 room 的已成立消息附件引用，不允许全库 hash hit。
  - 内容资产清理只清理 `canonical_media_assets`，并同步标记所有引用该内容资产的附件 `origin_deleted_at`。

- Modify: `src/适配.rs`
  - 为 `Pg仓储` 接上新增仓储端口方法。

- Modify: `src/媒体上传外壳.rs`
  - `PrepareMediaUploadBody` 增加可选 `source_hash / source_byte_size / source_file_name`。
  - 新增 `SourceHashReuseBody` 和 handler `reuse_media_by_source_hash`。
  - handler 只做解析、错误转码、调用 usecase，不承载权限或去重真相。

- Modify: `src/外壳.rs`
  - 新增 `POST /api/media/{attachment_kind}/source-dedupe` 路由。

- Modify: `src/契约.rs`
  - 增加 shell-neutral 的 source dedupe 响应结构或共享 error code（如当前契约层已有媒体上传 DTO）。

### 前端

- Modify: `frontend/package.json`
  - 增加 `hash-wasm`，优先使用最新稳定 `4.12.0`。

- Modify: `frontend/pnpm-lock.yaml`
  - 由 `pnpm --dir frontend add hash-wasm@4.12.0` 生成。

- Create: `frontend/媒体/源文件哈希.worker.ts`
  - Worker 内使用 `hash-wasm` 的 `createSHA256()`，读取 `File.stream()` 分块 `update()`，返回 hex。
  - 不手搓 SHA-256。

- Create: `frontend/媒体/源文件哈希.ts`
  - 提供 `计算源文件SHA256(file, deps?)`。
  - 只负责 Worker 通信、取消、错误转码和测试 seam。
  - 若 Worker/wasm 初始化失败，先返回明确错误，不静默降级成不可靠 hash。

- Modify: `frontend/build.mjs`
  - 增加固定 Worker 构建产物 `dist/source-hash-worker.js`。
  - 清理旧构建产物时保留该 worker。

- Modify: `frontend/媒体/index.ts`
  - 导出 source hash helper。

- Modify: `frontend/媒体/媒体发布.ts`
  - `媒体发布器依赖` 增加 `calculateSourceHash`、`reuseMediaBySourceHash`、`readCurrentRoomId`。
  - `处理选择同类媒体文件` 在 canonical 预处理前计算 `source_hash` 并请求后端复用。
  - hit：写入 ready 草稿，不调用图片/视频预处理、不调用 `prepareMediaUpload`、不调用 Uppy。
  - miss：继续现有预处理和上传链，并把 `source_hash` 透传给 prepare。

- Modify: `frontend/聊天媒体编排.ts`
  - 把现有 `读取当前房间标识` 传给媒体发布器。

- Modify: `frontend/传输.ts`
  - `媒体传输端口` 增加 `reuseMediaBySourceHash`。
  - `prepareMediaUpload` 签名增加可选 source metadata。

- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
  - `prepareMediaUpload` body 增加 source metadata。
  - 新增 `reuseMediaBySourceHash` 调用 `/api/media/{kind}/source-dedupe`。

- Modify: `frontend/契约.ts`
  - 增加 source dedupe 请求/响应 TypeScript 类型。

- Modify: `frontend/tests/媒体发布测试.spec.ts`
  - source hit 跳过预处理/prepare/Uppy。
  - source miss 继续现有链路，并把 source hash 传给 prepare。
  - 大视频 source hash 计算期间保持让出主线程/不阻断批量选择。

- Modify: `frontend/tests/传输测试.spec.ts`
  - 锁定 prepare 和 source-dedupe HTTP body。

- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
  - 锁定当前房间 id 被传入 dedupe 请求。

- Create: `frontend/tests/源文件哈希测试.spec.ts`
  - 验证 chunked hash helper 调用成熟 hasher seam。
  - 验证取消/Worker 错误不会误报命中。

- Modify: `frontend/tests/应用壳测试.spec.ts`
  - 锁定 `source-hash-worker.js` 是固定构建产物并被清理逻辑保留。

## 2. 数据模型裁决

### `canonical_media_assets`

```sql
CREATE TABLE canonical_media_assets (
    content_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    mime_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    width INTEGER,
    height INTEGER,
    storage_key TEXT NOT NULL UNIQUE,
    torrent_bytes BYTEA NOT NULL,
    torrent_info_hash TEXT NOT NULL,
    piece_length_bytes INTEGER NOT NULL CHECK (piece_length_bytes > 0),
    web_seed_until TIMESTAMPTZ NOT NULL,
    origin_expires_at TIMESTAMPTZ NOT NULL,
    origin_deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`content_hash` 是 canonical 字节身份，`storage_key` 必须是内容寻址路径：

- 图片：`media-assets/{content_hash}/canonical.webp`
- 视频：`media-assets/{content_hash}/canonical.mp4`

新上传 complete 时，如果 `content_hash` 已存在且 `origin_deleted_at IS NULL`，不得重复写对象；只写新附件投影和分发元数据。

### `attachment_canonical_asset_refs`

```sql
CREATE TABLE attachment_canonical_asset_refs (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL REFERENCES canonical_media_assets(content_hash),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

附件继续是消息业务事实；canonical asset 才是媒体字节事实。读侧第一阶段仍可继续从 `attachments.storage_key` 读取，因为新附件的 `storage_key` 会投影为同一个内容寻址路径。

### `attachment_source_hashes`

```sql
CREATE TABLE attachment_source_hashes (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    source_hash TEXT NOT NULL,
    source_byte_size BIGINT NOT NULL CHECK (source_byte_size >= 0),
    source_file_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_attachment_source_hashes_lookup
    ON attachment_source_hashes (source_hash, source_byte_size);
```

不要给 `source_hash` 做全局唯一。相同源文件可以在多个房间、多条消息、多次发送中产生不同附件事实。

## 3. 后端任务

### Task 1: 迁移红测

**Files:**
- Modify: `tests/启动与迁移测试.rs`

- [ ] **Step 1: 写失败测试**

在 `tests/启动与迁移测试.rs` 增加断言：

```rust
#[test]
fn source_hash精确去重迁移会建立内容资产和受权限索引() {
    let sql = std::fs::read_to_string("migrations/0020_媒体source_hash精确去重资产索引.sql")
        .expect("应能读取 0020 migration");

    assert!(sql.contains("CREATE TABLE canonical_media_assets"));
    assert!(sql.contains("content_hash TEXT PRIMARY KEY"));
    assert!(sql.contains("storage_key TEXT NOT NULL UNIQUE"));
    assert!(sql.contains("CREATE TABLE attachment_canonical_asset_refs"));
    assert!(sql.contains("CREATE TABLE attachment_source_hashes"));
    assert!(sql.contains("idx_attachment_source_hashes_lookup"));
    assert!(
        !sql.contains("UNIQUE (source_hash"),
        "source_hash 不能全局唯一，否则会把媒体资产复用误建模成消息复用"
    );
}
```

- [ ] **Step 2: 跑红测**

Run: `cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -j 1`

Expected: FAIL，提示找不到 `0020_媒体source_hash精确去重资产索引.sql`。

### Task 2: 新增 migration

**Files:**
- Create: `migrations/0020_媒体source_hash精确去重资产索引.sql`

- [ ] **Step 1: 写最小 migration**

写入三张表和索引。注意：

- `canonical_media_assets.content_hash` 主键。
- `attachment_canonical_asset_refs.attachment_id` 主键。
- `attachment_source_hashes.source_hash` 只做普通索引，不做全局唯一。
- migration 不回填旧数据，第一阶段只保证新上传链路进入内容资产层；旧附件继续走 legacy 附件级冷源清理。

- [ ] **Step 2: 跑迁移测试**

Run: `cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -j 1`

Expected: PASS。

### Task 3: source hit 后端红测

**Files:**
- Create: `tests/媒体上传测试/source_hash.rs`
- Modify: `tests/媒体上传测试.rs`

- [ ] **Step 1: 挂载测试模块**

在 `tests/媒体上传测试.rs` 增加：

```rust
#[path = "媒体上传测试/source_hash.rs"]
mod source_hash_tests;
```

- [ ] **Step 2: 写同房间命中红测**

测试名：`同一房间同source_hash会复用canonical资产但创建新附件事实`

测试动作：

1. bootstrap session。
2. 建房/进房取得 `room_id`。
3. 第一张图片走 prepare + TUS hook + complete，prepare body 带 `source_hash`。
4. 用第一附件创建一条消息，让它在当前房间可见。
5. 调 `POST /api/media/image/source-dedupe`，传同 `session_id / room_id / source_hash / source_byte_size`。
6. 断言返回 `status = reused`，新 `attachment_id != old_attachment_id`。
7. 查 DB：两条 attachment ready；两条 `attachment_source_hashes`；两条 `attachment_canonical_asset_refs` 指向同一个 `content_hash`。
8. 查 DB：两条 `attachment_distribution_metadata.content_hash / swarm_id` 相同，`torrent_info_hash` 相同。
9. 用新附件再调用 `koko::usecase::创建消息`，应成功。

Expected: 当前代码 FAIL，路由不存在或 `source_hash` 字段未被记录。

- [ ] **Step 3: 写跨房间不泄漏红测**

测试名：`未授权房间不能通过source_hash探测已有媒体`

测试动作：

1. session A 在 room A 上传并发消息。
2. session B 在 room B 调 source-dedupe，使用相同 source hash。
3. 断言返回 `status = miss`，且不返回旧附件、旧房间、旧上传者。

Expected: FAIL。

- [ ] **Step 4: 写已删除资产不复活红测**

测试名：`canonical资产删除后source_hash不会复活ready附件`

测试动作：

1. session 上传并创建消息。
2. 手工把 `canonical_media_assets.origin_deleted_at` 和引用附件 `origin_deleted_at` 置为过去删除状态。
3. 调 source-dedupe。
4. 断言返回 miss，不创建 ready 附件。

Expected: FAIL。

### Task 4: application 端口与 usecase

**Files:**
- Modify: `src/用例.rs`

- [ ] **Step 1: 增加结构体**

新增结构体：

```rust
pub struct SourceHash媒体复用请求 {
    pub 会话标识: String,
    pub 房间标识: String,
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub source_hash: String,
    pub source_byte_size: i64,
    pub source_file_name: Option<String>,
}

pub enum SourceHash媒体复用结果 {
    Miss,
    Reused(媒体附件快照),
}

pub struct Canonical媒体资产写入请求 {
    pub content_hash: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 存储键: String,
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length字节: i32,
    pub web_seed_until秒: i64,
    pub origin_expires_at秒: i64,
}
```

- [ ] **Step 2: 扩展 `仓储端口`**

新增方法：

```rust
fn 记录附件source_hash(&mut self, 附件标识: &str, source_hash: &str, source_byte_size: i64, source_file_name: Option<&str>) -> Result<()>;
fn 查询房间可复用source_hash媒体资产(&mut self, 房间标识: &str, source_hash: &str, source_byte_size: i64, 种类: 媒体附件类型) -> Result<Option<可复用媒体资产>>;
fn 写入canonical媒体资产(&mut self, 请求: &Canonical媒体资产写入请求) -> Result<()>;
fn 绑定附件canonical媒体资产(&mut self, 附件标识: &str, content_hash: &str) -> Result<()>;
fn 列出待清理canonical媒体资产(&mut self, now秒: i64) -> Result<Vec<待清理Canonical媒体资产>>;
fn 标记canonical媒体资产已删除(&mut self, content_hash: &str, deleted_at秒: i64) -> Result<()>;
```

- [ ] **Step 3: 实现 `复用source_hash媒体附件`**

用例必须按顺序做：

1. 校验 `source_hash` 为 64 位小写 hex。
2. 校验 session 存在并读取当前匿名身份。
3. 调用 `校验房间订阅资格`。
4. 查询当前房间可见的 ready 附件和未删除 canonical asset。
5. miss 时只返回 `Miss`。
6. hit 时创建新的 ready 附件记录，owner 为当前 session 身份，`storage_key` 投影为 asset `storage_key`。
7. 为新附件写入 source hash、canonical asset ref、distribution metadata 和 torrent metadata。
8. 返回新附件快照。

- [ ] **Step 4: 跑后端 source tests**

Run: `cargo test source_hash --test 媒体上传测试 -j 1`

Expected: 仍 FAIL，因为适配层和 HTTP 路由还未接。

### Task 5: SQL 适配层

**Files:**
- Modify: `src/媒体附件适配.rs`
- Modify: `src/适配.rs`

- [ ] **Step 1: 实现 source hash 写入**

`记录附件source_hash_异步` 使用 `INSERT ... ON CONFLICT (attachment_id) DO UPDATE`，保持幂等。

- [ ] **Step 2: 实现权限受控 hit 查询**

查询必须从当前房间已成立消息出发：

```sql
SELECT ...
FROM room_events re
JOIN messages m ON m.room_event_id = re.room_event_id
JOIN message_attachment_refs mar ON mar.message_id = m.message_id
JOIN attachments a ON a.attachment_id = mar.attachment_id
JOIN attachment_source_hashes ash ON ash.attachment_id = a.attachment_id
JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
LEFT JOIN attachment_distribution_metadata adm ON adm.attachment_id = a.attachment_id
LEFT JOIN attachment_distribution_torrents adt ON adt.attachment_id = a.attachment_id
WHERE re.room_id = $1
  AND ash.source_hash = $2
  AND ash.source_byte_size = $3
  AND a.kind = $4
  AND a.status = 'ready'
  AND cma.origin_deleted_at IS NULL
ORDER BY re.event_position DESC
LIMIT 1
```

实际表/列名以现有 schema 为准，写代码前必须重新读 `migrations/0004` 和消息相关 migration。

- [ ] **Step 3: 实现 canonical asset upsert**

`content_hash` 冲突时只允许更新 `updated_at`，不得延长 `origin_expires_at / web_seed_until`，避免 source hit 变成 24 小时冷源续命漏洞。

- [ ] **Step 4: 实现 asset 级清理**

新增 asset 清理查询；旧 `列出待清理媒体冷源_异步` 排除已进入 `attachment_canonical_asset_refs` 的新链附件，避免同一内容资产被附件级清理误删。

- [ ] **Step 5: 跑后端 source tests**

Run: `cargo test source_hash --test 媒体上传测试 -j 1`

Expected: 仍 FAIL，HTTP route 未接或 complete 未写 asset。

### Task 6: complete 链写入内容资产

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/用例.rs`
- Modify: `tests/媒体上传测试/complete.rs`

- [ ] **Step 1: 写/更新 complete 断言**

断言 complete 后：

- `attachments.storage_key = media-assets/{content_hash}/canonical.webp|mp4`
- `canonical_media_assets.storage_key` 同上
- `attachment_canonical_asset_refs.attachment_id = attachment_id`
- prepare 传入 `source_hash` 时，`attachment_source_hashes` 有记录

- [ ] **Step 2: 修改 complete 对象存储写入**

complete 读取 canonical 字节后：

1. `生成内容哈希`。
2. 生成内容寻址 `storage_key`。
3. 先尝试 `head` 内容资产对象；不存在才 `put`。
4. 生成 distribution 和 torrent。
5. 写 `canonical_media_assets`。
6. 写附件 ready 投影和 per-attachment distribution/torrent。

- [ ] **Step 3: 跑 complete tests**

Run: `cargo test complete图片上传会把prepared附件升级成ready并写入canonical资产 complete视频上传会写入canonical并返回file_asset --test 媒体上传测试 -j 1`

Expected: PASS。

### Task 7: source-dedupe HTTP route

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/外壳.rs`
- Modify: `src/契约.rs`

- [ ] **Step 1: 增加请求/响应 DTO**

```rust
#[derive(Deserialize)]
struct SourceHashReuseBody {
    session_id: String,
    room_id: String,
    source_hash: String,
    source_byte_size: i64,
    source_file_name: Option<String>,
    mime_type: Option<String>,
}
```

响应：

```json
{ "status": "miss" }
```

或：

```json
{
  "status": "reused",
  "attachment": {
    "attachment_id": "...",
    "kind": "image",
    "mime_type": "image/webp",
    "byte_size": 123,
    "width": 1,
    "height": 1,
    "status": "ready",
    "media_asset": { "...": "沿用 complete 返回形状" }
  }
}
```

- [ ] **Step 2: 接 route**

`POST /api/media/{attachment_kind}/source-dedupe`

- [ ] **Step 3: 跑后端 source tests**

Run: `cargo test source_hash --test 媒体上传测试 -j 1`

Expected: PASS。

### Task 8: 冷源清理保护

**Files:**
- Modify: `tests/媒体后台测试/冷源清理.rs`
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/外壳.rs` 或当前冷源清理 owner 所在文件

- [ ] **Step 1: 写 asset 级清理红测**

测试名：`共享canonical资产超过24小时只删除一次并同步标记所有引用附件`

动作：

1. 建两个 ready attachment，绑定同一 `content_hash` 和同一 `storage_key`。
2. asset `origin_expires_at = now - 25h`。
3. 写入对象存储同一 key。
4. 执行一次媒体冷源清理。
5. 断言对象已删。
6. 断言 `canonical_media_assets.origin_deleted_at` 不为空。
7. 断言两个附件的 `origin_deleted_at` 都不为空。

- [ ] **Step 2: 修改清理用例**

清理顺序：

1. 先清理 legacy 附件级冷源，排除 `attachment_canonical_asset_refs`。
2. 再清理 `canonical_media_assets`。
3. 删除对象失败时不得先标记 DB 删除。
4. DB 标记失败时记录错误，不得报告成功。

- [ ] **Step 3: 跑冷源测试**

Run: `cargo test 共享canonical资产超过24小时只删除一次并同步标记所有引用附件 原始冷源超过24小时后会被后台清理并写入删除时间 --test 媒体后台测试 -j 1`

Expected: PASS。

## 4. 前端任务

### Task 9: 依赖和构建 spike

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `frontend/build.mjs`

- [ ] **Step 1: 加依赖**

Run: `pnpm --dir frontend add hash-wasm@4.12.0`

Expected: `package.json` 和 `pnpm-lock.yaml` 更新。

- [ ] **Step 2: 创建空 worker 构建入口红测**

在 `frontend/tests/应用壳测试.spec.ts` 增加测试，断言 `build.mjs` 包含 `source-hash-worker.js` 构建输出和清理保留项。

- [ ] **Step 3: 修改 build**

增加：

```js
const sourceHashWorkerOutputFiles = [
  path.join(distDir, 'source-hash-worker.js'),
  path.join(distDir, 'source-hash-worker.js.map'),
]
```

并新增 `sourceHashWorkerBuildOptions`，入口 `媒体/源文件哈希.worker.ts`，输出 `dist/source-hash-worker.js`。

- [ ] **Step 4: 跑构建 smoke**

Run: `pnpm --dir frontend build`

Expected: PASS，`frontend/dist/source-hash-worker.js` 存在。

如果 `hash-wasm` 的 wasm 资产无法被当前 esbuild 直接打包，停止实现并改用 `@noble/hashes@2.2.0` 的增量 API；不要手搓 wasm loader。

### Task 10: source hash helper

**Files:**
- Create: `frontend/媒体/源文件哈希.worker.ts`
- Create: `frontend/媒体/源文件哈希.ts`
- Create: `frontend/tests/源文件哈希测试.spec.ts`

- [ ] **Step 1: 写 helper 红测**

测试：

- 分块输入 `[1,2]`、`[3]` 时调用 injected hasher `update` 两次。
- 返回 hex digest。
- Worker error 时抛出 `source_hash_failed`，不能返回空字符串。

- [ ] **Step 2: 实现 helper**

Worker 内：

```ts
import { createSHA256 } from "hash-wasm";

self.onmessage = async (event) => {
  const { requestId, file } = event.data;
  const hasher = await createSHA256();
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
    self.postMessage({ requestId, ok: true, hash: hasher.digest("hex") });
  } catch (error) {
    self.postMessage({ requestId, ok: false, code: "source_hash_failed" });
  }
};
```

主线程 wrapper 负责 request id、timeout、`terminate()` 和错误转码。

- [ ] **Step 3: 跑测试**

Run: `pnpm --dir frontend test tests/源文件哈希测试.spec.ts`

Expected: PASS。

### Task 11: frontend transport contract

**Files:**
- Modify: `frontend/契约.ts`
- Modify: `frontend/传输.ts`
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `frontend/tests/传输测试.spec.ts`

- [ ] **Step 1: 写传输红测**

新增测试：

- `reuseMediaBySourceHash` POST 到 `/api/media/image/source-dedupe`。
- body 包含 `session_id / room_id / source_hash / source_byte_size / source_file_name / mime_type`。
- `prepareMediaUpload` miss path body 包含 source metadata。

- [ ] **Step 2: 实现 transport**

新增类型：

```ts
export type SourceHash复用结果 =
  | { status: "miss" }
  | { status: "reused"; attachment: 媒体附件上传结果 };
```

`媒体传输端口` 增加：

```ts
reuseMediaBySourceHash(
  kind: "image" | "video",
  input: SourceHash复用请求
): Promise<SourceHash复用结果>;
```

- [ ] **Step 3: 跑测试**

Run: `pnpm --dir frontend test tests/传输测试.spec.ts`

Expected: PASS。

### Task 12: media publisher hit/miss flow

**Files:**
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`

- [ ] **Step 1: 写 hit 红测**

测试名：`source_hash命中会直接写ready草稿并跳过预处理和上传`

断言：

- `calculateSourceHash` 被原始 `sourceFile` 调用。
- `reuseMediaBySourceHash` 在 `preprocessVideo` 或图片 WebP 预制前调用。
- hit 后 `prepareMediaUpload` 未调用。
- Uppy `addFile` 未调用。
- 草稿状态为 `ready`，`attachmentId` 为后端返回的新附件。

- [ ] **Step 2: 写 miss 红测**

断言：

- miss 后继续现有图片/视频 canonical 预处理。
- `prepareMediaUpload` 接收 canonical file，同时第四个参数或 options 内带原始 `source_hash`。

- [ ] **Step 3: 写缺 room id 红测**

断言：

- 无当前房间 id 时不发 source-dedupe。
- 继续正常上传，不把前端缺少 room id 当业务命中。

- [ ] **Step 4: 实现 media publisher**

关键顺序：

```text
sourceFile
  -> identify kind
  -> calculateSourceHash(sourceFile)
  -> if roomId: reuseMediaBySourceHash(...)
  -> hit: write ready draft, return
  -> miss: preprocess canonical
  -> prepareMediaUpload(..., source metadata)
  -> Uppy upload
```

- [ ] **Step 5: 跑测试**

Run:

```powershell
pnpm --dir frontend test tests/媒体发布测试.spec.ts tests/聊天媒体编排测试.spec.ts
```

Expected: PASS。

## 5. 联合验证

- [ ] **Step 1: 后端目标测试**

Run:

```powershell
cargo test source_hash --test 媒体上传测试 -j 1
cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -j 1
cargo test 共享canonical资产超过24小时只删除一次并同步标记所有引用附件 --test 媒体后台测试 -j 1
```

Expected: PASS。

- [ ] **Step 2: 前端目标测试**

Run:

```powershell
pnpm --dir frontend test tests/源文件哈希测试.spec.ts tests/传输测试.spec.ts tests/媒体发布测试.spec.ts tests/聊天媒体编排测试.spec.ts tests/应用壳测试.spec.ts
```

Expected: PASS。

- [ ] **Step 3: 全量基础验证**

Run:

```powershell
cargo test -j 1
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Expected: PASS。

- [ ] **Step 4: 架构守卫**

Run:

```powershell
pnpm --dir frontend check:browser-app-constitution
pnpm --dir frontend check:architecture-fitness
```

Expected: PASS。

- [ ] **Step 5: graphify 更新**

仅在修改代码文件后运行：

```powershell
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: PASS 或输出完成；如果本机只有 `python`，先用 `python` 验证同一命令。

- [ ] **Step 6: 工作树复核**

Run: `git status --short`

Expected: 只包含本计划范围内文件。

## 6. 回滚与失败策略

- 如果 `hash-wasm` 无法在当前 esbuild/browser 目标稳定构建，立即退回 `@noble/hashes@2.2.0` 增量 API；不要写私有 hash。
- 如果 source-dedupe 查询无法可靠通过当前 room message visibility 裁决，只允许返回 miss；不能临时放宽为 owner/global 查询。
- 如果 canonical asset 清理测试不稳，停止上线 source hit；不能让共享 `storage_key` 带着附件级误删风险进入主链。
- 如果 complete 后内容寻址路径影响旧 locator/content 读取，先修读侧投影测试；不能为了 dedupe 绕过现有受控内容路由。

## 7. 提交节奏

建议按下面粒度提交：

1. `新增媒体source_hash去重资产索引迁移`
2. `接入后端source_hash复用用例`
3. `收口canonical资产级冷源清理`
4. `接入前端源文件流式哈希`
5. `接入媒体发布source_hash命中路径`
6. `补齐source_hash去重联合验证`

每个提交前必须跑对应目标测试，最终提交前跑全量基础验证。
