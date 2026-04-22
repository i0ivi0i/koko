# WebTorrent高速分发防止群友偷懒彻底收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `2026-04-22-WebTorrent高速分发防止群友偷懒` 这份 spec 真正成立：`MEDIA_READY / MEDIA_CONNECTING_TO_PEERS / MEDIA_NO_ONLINE_SEED / MEDIA_DELETED` 只反映真实的 swarm 可用来源，不再被假 `presence`、旧 payload 误判、或浏览器壳层时序污染。

**Architecture:** 把“稳定附件分发事实”和“易变 swarm peer 存活事实”彻底分层。`attachment_distribution_metadata` 只继续保存 attachment 级稳定真相；新的 swarm presence 真相改为按 `swarm_id` 聚合，且只把“backend strong seed”或“verified complete peer”计入可用来源。前端运行时只在会话真正具备上传能力后上报 complete-peer 存活，并在零 UI 引用但仍保留做种时继续维持 heartbeat。

**Tech Stack:** Rust (`axum`, `sqlx`, Postgres), TypeScript (`WebTorrent`, Lit/XState runtime), Node `webtorrent-hybrid` seeder sidecar, Rust integration tests, Vitest, Chrome DevTools CLI smoke tests.

---

## File Structure

- `migrations/0015_协作分发swarm_peer_presence.sql`
  新建 swarm 级运行态表，承接 volatile peer/source 真相，不再把这类事实塞进 `attachment_distribution_metadata`。
- `migrations/0016_移除附件协作分发过时peer字段.sql`
  在所有读写切换完成后，删除误导性的 `last_peer_seen_at` 旧字段，防止未来又把 attachment 行当成 swarm 存活真相。
- `src/用例.rs`
  新增 swarm peer presence 的写入、查询、聚合 usecase；把“参与 swarm”和“可计入 available source 的 complete peer/backend seed”拆开。
- `src/媒体附件适配.rs`
  新增 `swarm_peer_presence` 的 SQL adapter；移除 `attachment_distribution_metadata.last_peer_seen_at` 的主读写职责。
- `src/媒体协作分发.rs`
  只基于“当前 attachment 的 strong seed 窗口 + 同 swarm 的 verified complete peer/backend strong seed”裁决 `availability` 与 `media_state`。
- `src/媒体资产外壳.rs`
  `presence` 接口改为接收明确的 peer/source 状态；locator 响应继续稳定，但不再被空心 heartbeat 抬成 `MEDIA_READY`。
- `src/外壳.rs`
  sidecar reconcile/stop/start 时同步 swarm-level backend seed presence，确保后端强 seed 也是正式 swarm 成员真相。
- `frontend/媒体/媒体协作分发.ts`
  heartbeat payload、启动时机、停止时机改为围绕“verified complete peer”而不是“任何 acquire 了会话的页面”。
- `frontend/媒体/资产协作分发运行时.ts`
  只在会话已可上传时上报 complete-peer；零 consumer 但仍保留本地完整做种时继续维持 heartbeat。
- `frontend/媒体/媒体播放.ts`
  保留 `MEDIA_NO_ONLINE_SEED -> CONNECTING 窗口 -> NO_ONLINE_SEED` 的 UI 契约；补 shared swarm 的预期说明测试。
- `tests/协作分发测试/可用性裁决.rs`
  重写错误语义测试：不再允许“空 body presence = available”；新增同 swarm 完整 peer 合法续命测试。
- `tests/协作分发测试/分发元数据.rs`
  保留“相同内容附件可共享 swarm”的裁决，并把它明确写成测试前提，而不是再让人工烟测误判。
- `tests/启动与迁移测试.rs`
  校验新 migration 存在且旧字段退场正确。
- `tests/测试支撑/媒体/seed.rs`
  新增 swarm peer presence 建数辅助，支持 unique-content 与 shared-content 两类验收。
- `frontend/tests/媒体协作分发测试.spec.ts`
  校验 heartbeat 不会在 acquire 即启动，也不会由未补齐会话冒充 complete peer。
- `frontend/tests/媒体播放测试.spec.ts`
  校验 `MEDIA_NO_ONLINE_SEED`、shared swarm 合法存活、删除终态、和 zero-ref retained seeding 的 UI 行为。
- `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`
  代码与烟测全绿后再更新状态与验收记录；补清 shared swarm 的合法语义，避免再把“还能播”误读成违反 `24 小时` 退场。

## Non-Negotiable Decisions

- 相同内容的不同附件共享 `swarm_id/infohash` 是**合法行为**，不是 bug。验证 `MEDIA_NO_ONLINE_SEED` 必须使用 unique-content 样本。
- `24 小时` 后仍可继续通过 `WebTorrent` 播放/传播，只要存在 `online complete peer` 或仍存在同 swarm 的 backend strong seed。
- `presence` 不再等于“available source”；它只能是“参与 swarm”或“verified complete peer/backend seed”的受控上报。
- `original_url` 仍可作为 cold backup surface 暂存于 locator，但视频正式播放成功路径不得回退到它；网络验收必须继续抓 `/webtorrent/{infohash}/content-*`。

### Task 1: 先把错误语义钉死成失败测试

**Files:**
- Modify: `tests/协作分发测试/可用性裁决.rs`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Test: `tests/协作分发测试/分发元数据.rs`

- [ ] **Step 1: 写后端失败测试，证明空心 presence 会误抬 `MEDIA_READY`**

```rust
#[tokio::test]
async fn 空body_presence不会把无种子附件抬成media_ready() {
    // arrange: web_seed 过期、无 backend seed、无 complete peer
    // act: POST /api/media/{attachment_id}/presence?session_id=...
    // assert: locator 仍返回 MEDIA_NO_ONLINE_SEED
}
```

- [ ] **Step 2: 写 shared swarm 失败测试，证明“同内容别的 complete peer 合法续命”应被显式承认**

```rust
#[tokio::test]
async fn 同swarm的另一条完整peer能让旧附件保持ready() {
    // arrange: attachment A 过期，attachment B 同 content_hash 且 complete peer 在线
    // assert: A 的 locator 返回 MEDIA_READY，而不是 NO_ONLINE_SEED
}
```

- [ ] **Step 3: 写前端失败测试，证明 acquire 时不能立刻开始 complete-peer heartbeat**

```ts
it("未补齐会话不会在 acquire 时上报 complete peer heartbeat", async () => {
  await runtime.解析协作分发源(...);
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining("/presence"),
    expect.objectContaining({ method: "POST", body: expect.stringContaining("complete_peer") })
  );
});
```

- [ ] **Step 4: 运行失败测试，确认当前实现确实红**

Run:
```powershell
cargo test --test 协作分发测试 可用性裁决 -- --nocapture
pnpm --dir frontend test -- frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体播放测试.spec.ts
```

Expected:
- Rust 至少有 1 个用例因为 `MEDIA_READY` 误判而失败
- 前端至少有 1 个用例因为 heartbeat 启动过早而失败

- [ ] **Step 5: Commit**

```bash
git add tests/协作分发测试/可用性裁决.rs frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "测试: 锁定协作分发假presence与shared swarm语义"
```

### Task 2: 新建 swarm 级运行态真相表，切走 attachment 行里的易变 presence

**Files:**
- Create: `migrations/0015_协作分发swarm_peer_presence.sql`
- Modify: `tests/启动与迁移测试.rs`
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `tests/测试支撑/媒体/seed.rs`

- [ ] **Step 1: 写 migration 失败测试与 adapter 失败测试**

```rust
assert!(sql.contains("CREATE TABLE IF NOT EXISTS swarm_peer_presence"));
assert!(sql.contains("UNIQUE (swarm_id, session_id, peer_kind)"));
```

- [ ] **Step 2: 运行测试，确认新表不存在时失败**

Run:
```powershell
cargo test --test 启动与迁移测试 -- --nocapture
```

Expected: FAIL，提示缺少 `swarm_peer_presence` 表或断言缺少 SQL 片段。

- [ ] **Step 3: 实现 migration 与 repository 最小读写**

```sql
CREATE TABLE IF NOT EXISTS swarm_peer_presence (
    swarm_id TEXT NOT NULL,
    session_id BIGINT NOT NULL,
    attachment_id TEXT NOT NULL,
    peer_kind TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (swarm_id, session_id, peer_kind)
);
CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_last_seen
    ON swarm_peer_presence (swarm_id, last_seen_at DESC);
```

```rust
pub struct SwarmPeerPresenceSnapshot {
    pub swarm_id: String,
    pub session_id: i64,
    pub attachment_id: String,
    pub peer_kind: String,
    pub last_seen_epoch_seconds: i64,
}
```

- [ ] **Step 4: 跑测试转绿**

Run:
```powershell
cargo test --test 启动与迁移测试 -- --nocapture
cargo test --test 协作分发测试 分发元数据 -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/0015_协作分发swarm_peer_presence.sql tests/启动与迁移测试.rs src/用例.rs src/媒体附件适配.rs tests/测试支撑/媒体/seed.rs
git commit -m "重构: 新增swarm级peer presence运行态真相表"
```

### Task 3: 后端只按 verified complete peer/backend seed 裁决 availability

**Files:**
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写失败测试，要求 locator 不再读取 attachment 行上的旧 `last_peer_seen_at`**

```rust
#[tokio::test]
async fn attachment行旧presence字段不会再决定available() {
    // arrange: attachment_distribution_metadata.last_peer_seen_at 有值
    // arrange: swarm_peer_presence 无 complete_peer/backend_seed
    // assert: MEDIA_NO_ONLINE_SEED
}
```

- [ ] **Step 2: 运行测试，确认旧逻辑仍会失败**

Run:
```powershell
cargo test --test 协作分发测试 可用性裁决 -- --nocapture
```

Expected: FAIL，当前代码仍会把旧 attachment 行 presence 算成 available。

- [ ] **Step 3: 实现最小后端切换**

```rust
let swarm_has_complete_peer = repo.查询swarm最近complete_peer(
    &snapshot.swarm_id,
    now_epoch秒,
    stale_seconds,
)?;

let availability = if web_seed仍可用 || swarm_has_complete_peer {
    "available"
} else {
    "expired"
};
```

要求：
- `peer_kind` 至少区分 `complete_peer` 与 `backend_strong_seed`
- locator 的 `MEDIA_READY` 只认这两类来源
- `presence_url` 仍可继续返回，但不再等于“可用来源”

- [ ] **Step 4: 跑后端测试转绿**

Run:
```powershell
cargo test --test 协作分发测试 可用性裁决 -- --nocapture
cargo test --test 协作分发测试 -- --nocapture
```

Expected: PASS，`MEDIA_NO_ONLINE_SEED` 与 shared swarm 的 `MEDIA_READY` 都稳定。

- [ ] **Step 5: Commit**

```bash
git add src/用例.rs src/媒体附件适配.rs src/媒体协作分发.rs src/媒体资产外壳.rs tests/协作分发测试/可用性裁决.rs
git commit -m "修复: availability仅认verified complete peer与backend seed"
```

### Task 4: 重写前端 heartbeat 时机，保留零引用完整做种

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 写失败测试，锁定三件事**

```ts
it("未补齐会话不会上报 complete_peer heartbeat", async () => {});
it("locallyComplete 且零consumer保留的会话会继续 heartbeat", async () => {});
it("释放未完成补齐会话后会停止 heartbeat", async () => {});
```

- [ ] **Step 2: 运行测试，确认当前行为不满足**

Run:
```powershell
pnpm --dir frontend test -- frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体播放测试.spec.ts
```

Expected: FAIL，当前 acquire 即启动 heartbeat，且 zero-ref retained session 会停 heartbeat。

- [ ] **Step 3: 实现最小前端切换**

```ts
if (session.locallyComplete) {
  启动协作分发存活上报(session, {
    ...distribution,
    heartbeat_kind: "complete_peer",
  });
}
```

```ts
if (session.consumerBindings.size === 0 && session.locallyComplete) {
  // 会话仍在本地做种，不能停 complete-peer heartbeat
  return;
}
```

要求：
- 不再在 `确保协作分发会话()` 刚创建时就 heartbeat
- complete-peer heartbeat 只在 `locallyComplete` 后启动
- retained seeding session 没有 UI consumer 时仍继续 heartbeat

- [ ] **Step 4: 跑前端测试转绿**

Run:
```powershell
pnpm --dir frontend test -- frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体播放测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/媒体/媒体协作分发.ts frontend/媒体/资产协作分发运行时.ts frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "修复: complete peer heartbeat仅由真实可上传会话上报"
```

### Task 5: 把 backend strong seed 也接入 swarm 级 source truth

**Files:**
- Modify: `src/外壳.rs`
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `tests/协作分发测试.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写失败测试，证明 sidecar 活着时旧附件也应被视为有正式 swarm 来源**

```rust
#[tokio::test]
async fn active_backend_strong_seed会让同swarm附件保持ready() {
    // arrange: attachment A 过期
    // arrange: sidecar 正在为同 swarm attachment B 做种
    // assert: A locator == MEDIA_READY
}
```

- [ ] **Step 2: 运行测试，确认当前实现还没把 sidecar presence 进 swarm 真相**

Run:
```powershell
cargo test --test 协作分发测试 active_backend_strong_seed -- --nocapture
```

Expected: FAIL

- [ ] **Step 3: 在 reconcile/start/stop 路径里同步 backend strong seed presence**

```rust
repo.upsert_swarm_peer_presence(SwarmPeerPresenceWrite {
    swarm_id,
    session_id: system_session_id,
    attachment_id,
    peer_kind: "backend_strong_seed".into(),
    last_seen_epoch_seconds: now_epoch秒,
});
```

要求：
- `/seed/start` 成功后写入或刷新
- `/seed/stop` 与 reconcile 清理失活记录
- 不能要求浏览器页面在场，backend seed 必须是独立 owner

- [ ] **Step 4: 跑后端测试转绿**

Run:
```powershell
cargo test --test 协作分发测试 -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/外壳.rs src/用例.rs src/媒体附件适配.rs tests/协作分发测试.rs tests/协作分发测试/可用性裁决.rs
git commit -m "修复: backend strong seed纳入swarm级available source真相"
```

### Task 6: 清理过时字段、补齐全链路验收、回写 spec

**Files:**
- Create: `migrations/0016_移除附件协作分发过时peer字段.sql`
- Modify: `tests/启动与迁移测试.rs`
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`

- [ ] **Step 1: 写 migration 失败测试，要求旧 `last_peer_seen_at` 彻底退场**

```rust
assert!(!sql.contains("last_peer_seen_at"));
```

- [ ] **Step 2: 实现 migration 与文档修正**

```sql
ALTER TABLE attachment_distribution_metadata
    DROP COLUMN IF EXISTS last_peer_seen_at;
```

文档必须补三点：
- shared swarm 让旧附件继续可播是合法行为
- `MEDIA_NO_ONLINE_SEED` 验收必须用 unique-content 样本
- `presence` 只代表 verified complete peer/backend seed，不再代表任意 viewer intent

- [ ] **Step 3: 跑全量自动化验证**

Run:
```powershell
cargo test
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
pwsh -File tests/启动器脚本检查.ps1
```

Expected:
- 全绿
- 没有新的 `MEDIA_READY` 假阳性
- 没有视频回退到 `original_url` 的自动化回归

- [ ] **Step 4: 跑真实烟测并记录证据**

Run:
```powershell
$file = 'D:\200-生活\230-照片备份\233-Telegram\色色\VID_20230818_004214_506.mp4'
$hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
$env:PGPASSWORD='postgres'
psql -h 127.0.0.1 -U postgres -d koko_ddd_dev -P pager=off -c "SELECT COUNT(*) FROM attachment_distribution_metadata WHERE content_hash = '$hash';"
```

Expected:
- `COUNT(*) = 0` 时，用它做 unique-content `MEDIA_NO_ONLINE_SEED` 烟测
- 再用同一文件上传第二次，验证 shared swarm 合法续命

Chrome DevTools CLI 必须覆盖：
- sender / viewer / observer / noseed 四会话
- 房间 `1234b`
- fresh unique-content 样本的 `MEDIA_NO_ONLINE_SEED`
- shared-content 第二次上传后的合法 `MEDIA_READY`
- 播放成功路径的网络里必须能看到 `/api/media/*/torrent` 与 `/webtorrent/{infohash}/content-*`

- [ ] **Step 5: Commit**

```bash
git add migrations/0016_移除附件协作分发过时peer字段.sql tests/启动与迁移测试.rs docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md
git commit -m "文档: 回写WebTorrent主链真实边界与最终验收记录"
```

## Done Criteria

- `POST /api/media/{attachment}/presence` 不再把无种子附件抬成 `MEDIA_READY`
- `MEDIA_READY` 只在 attachment strong seed 或同 swarm verified complete peer/backend seed 存在时成立
- unique-content 样本在无种子时稳定落到 `MEDIA_NO_ONLINE_SEED`
- 同内容第二次上传后，shared swarm 让旧附件继续可播被明确视为合法行为，并有自动化测试覆盖
- zero-ref retained locallyComplete session 会继续做种并继续对外可见
- 视频正式播放网络链仍然是 `/webtorrent/{infohash}/content-*`，不是 `original_url`
- spec 文档状态与验收记录和真实代码一致

## Risks To Watch During Execution

- 不要把“修假 READY”做成“complete seeding session 零引用后也停 heartbeat”，否则会制造新的假阴性
- 不要为了 shared swarm 的合法续命去恢复第二播放链；这两件事完全不是一回事
- 不要让 sidecar presence 反向污染 domain；它是基础设施 adapter 真相，必须通过 `usecase -> repo` 薄适配写入
- 不要在修 availability 时把 `MEDIA_CONNECTING_TO_PEERS` 的 8 秒窗口和 15 秒重试节奏弄丢

