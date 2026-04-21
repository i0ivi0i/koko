# WebTorrent 高速分发防止群友偷懒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 `koko` 新上传图片/视频的正式媒体字节主链彻底收口到 `WebTorrent`，前 `24 小时` 由后端以 `WebSeed + WebRTC seeder` 强力热启动，`24 小时` 后纯靠在线群友互帮互助，并把“无在线种子 / 已删除”真相稳定落到契约、运行时和 UI。

**Architecture:** 这不是“补几个 fallback 判断”的小修，而是媒体真相 owner 的重排。后端先把 `complete_at + 24h`、附件生存模式、peer 可用性和删除终态变成稳定契约；前端再把时间线、查看器、全屏、图片首屏和后台补齐统一收口到同一条 `WebTorrent` 会话，不再允许 `HLS / original_url / thumbnail / poster` 变成第二正式链。最后用受管 sidecar 承接 `WebRTC seeder`，让服务器前 `24 小时` 真正像 swarm 里的超强群友，而不是旁路 CDN。

**Tech Stack:** Rust、TypeScript、Lit、XState、WebTorrent、Video.js v10、WebRTC-capable seeder sidecar、Vitest、Cargo test、PowerShell、Chrome DevTools smoke

**Execution Status:** Completed（2026-04-22，Inline Execution）

---

## Why This Plan Exists

这份计划故意写得比普通实现清单更硬，因为本次需求最容易在三处漂移：

1. 口头上说“主链是 WebTorrent”，实现时却继续把前端正式播放绑在 `HLS / original_url`。
2. 口头上说“24 小时后纯 peer”，实现时却没有把“无在线完整 peer”做成稳定真相，只会无限转圈或模糊报错。
3. 口头上说“后端是强群友”，实现时却没有真正可被浏览器连接的 `WebRTC seeder`，最后只剩名义上的 swarm。

所以本计划默认坚持四个执行原则：

1. 先锁契约，再改运行时，再接基础设施；禁止 UI 自己发明第二套媒体真相。
2. 先写失败测试锁住新裁决，再做最小实现；禁止跳过红灯直接改大段逻辑。
3. 新上传附件先完全切到新主链；旧附件只做兼容，不阻塞新真相落地。
4. 每阶段都要证明“没有偷偷绕回服务器第二播放链”，否则视为失败。

## Scope And Boundaries

本计划只覆盖**新上传并 `complete` 的图片/视频附件**。默认不在本轮里做：

1. 全量历史 `HLS/poster/thumbnail/still` 资产回填或批量重种。
2. 为 iOS / Android / 桌面浏览器各写一套独立媒体状态机。
3. 自研 WebRTC torrent 协议栈。

## File Map

### Backend Contract / Truth

- Modify: `src/契约.rs`  
  收口新媒体状态 code、分发生存模式、locator 投影字段。
- Modify: `src/媒体上传外壳.rs`  
  以 `complete_at` 持久化 `24 小时` 起点，生成新附件正式 swarm 元信息。
- Modify: `src/媒体资产外壳.rs`  
  收口新附件 locator，只暴露新主链所需真相，移除新附件对第二链字段的正式依赖。
- Modify: `src/媒体协作分发.rs`  
  统一 “ready / connecting / no online seed / deleted” 的权威裁决、`24 小时` 退场判定，以及后端对 seeder sidecar 的 start/stop/reconcile intent。
- Test: `tests/媒体上传测试/complete.rs`
- Test: `tests/媒体共享契约测试.rs`
- Test: `tests/协作分发测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`
- Test: `tests/协作分发测试/投影一致性.rs`
- Test: `tests/协作分发测试/分发元数据.rs`

### Frontend Contract / Runtime

- Modify: `frontend/契约.ts`  
  与 Rust 契约对齐，新增稳定状态 code 与新生存模式。
- Modify: `frontend/媒体/资产协作分发运行时.ts`  
  统一 swarm session、补齐、做种和退场后重试 owner。
- Modify: `frontend/媒体/媒体播放.ts`  
  收口时间线媒体正式字节主链，不再把新附件回退到 `HLS / original_url / thumbnail`。
- Modify: `frontend/媒体/媒体查看器.ts`  
  收口查看器/全屏到同一 payload owner，落地 “正在尝试连接群友 / 当前没有在线种子 / 内容已删除”。
- Modify: `frontend/聊天媒体编排.ts`  
  保证时间线、查看器和后台补齐共用同一会话真相。
- Modify: `frontend/平台/存储运行时.ts`  
  明确本地完整 payload / 部分字节 / 预览缓存的保留与删除 purge 语义。
- Test: `frontend/tests/媒体共享契约测试.spec.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`
- Test: `frontend/tests/媒体查看器测试.spec.ts`
- Test: `frontend/tests/聊天应用内核测试.spec.ts`
- Test: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Test: `frontend/tests/存储运行时测试.spec.ts`
- Test: `frontend/tests/blob媒体资产测试.spec.ts`

### Seeder / Launcher / Smoke

- Create: `frontend/dev-seeder.mjs`  
  受管 `WebRTC seeder` sidecar，优先基于成熟现成实现做薄适配。
- Modify: `src/媒体协作分发.rs`  
  让 Rust 后端成为 seeding intent 的权威 owner，在 `complete / retire / delete / restart reconcile` 时驱动 sidecar。
- Modify: `src/媒体上传外壳.rs`  
  在 `complete` 成功后登记启动做种 intent。
- Modify: `run.ps1`  
  把 seeder sidecar 纳入受管启动、日志和清理。
- Modify: `tests/启动器脚本检查.ps1`
- Modify: `tests/协作分发测试/分发元数据.rs`
- Modify: `tests/媒体后台测试/冷源清理.rs`
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`  
  实现后补充实际验收证据与偏差记录。

---

### Task 1: 先锁契约红线，禁止前后端各讲一套媒体真相

**Files:**
- Modify: `src/契约.rs`
- Modify: `frontend/契约.ts`
- Test: `tests/媒体共享契约测试.rs`
- Test: `frontend/tests/媒体共享契约测试.spec.ts`

- [x] **Step 1: 写失败测试，要求后端契约暴露稳定媒体状态 code，而不是只给 `available/expired`**

```rust
assert_eq!(locator.media_state.code, "MEDIA_CONNECTING_TO_PEERS");
assert_eq!(locator.media_state.retry_after_ms, Some(15_000));
assert_eq!(locator.media_state.survival_mode, "peer_only_after_expiry");
```

- [x] **Step 2: 运行 Rust 契约测试确认先红**

Run: `cargo test --test 媒体共享契约测试 -- --nocapture`  
Expected: FAIL，出现缺少 `media_state` 或状态值仍是旧枚举的断言失败

- [x] **Step 3: 写失败测试，要求前端契约类型同步支持新状态 code**

```ts
const state: 媒体可用性状态 = {
  code: "MEDIA_NO_ONLINE_SEED",
  message: "当前没有在线种子，等待群友上线",
};
expect(state.code).toBe("MEDIA_NO_ONLINE_SEED");
```

- [x] **Step 4: 运行前端契约测试确认先红**

Run: `pnpm --dir frontend test -- tests/媒体共享契约测试.spec.ts`  
Expected: FAIL，类型或序列化断言仍停留在旧 `available/expired`

- [x] **Step 5: 在 Rust 契约中引入稳定状态结构，并禁止新附件继续依赖旧直链字段作为正式真相**

```rust
pub struct 媒体可用性状态 {
    pub code: &'static str,
    pub retry_after_ms: Option<u64>,
    pub survival_mode: 媒体分发生存模式,
}
```

- [x] **Step 6: 在前端契约中同步新增状态 code，并把旧 `availability` 降级为兼容字段而非主判断字段**

```ts
export type 媒体状态码 =
  | "MEDIA_READY"
  | "MEDIA_CONNECTING_TO_PEERS"
  | "MEDIA_NO_ONLINE_SEED"
  | "MEDIA_DELETED";
```

- [x] **Step 7: 重新运行契约测试并确认转绿**

Run: `cargo test --test 媒体共享契约测试 -- --nocapture && pnpm --dir frontend test -- tests/媒体共享契约测试.spec.ts`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add src/契约.rs frontend/契约.ts tests/媒体共享契约测试.rs frontend/tests/媒体共享契约测试.spec.ts
git commit -m "收口媒体状态契约并禁止新附件回到旧可用性真相"
```

### Task 2: 把 `complete_at + 24h` 做成后端唯一权威时间线

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `tests/媒体上传测试/complete.rs`
- Modify: `tests/媒体后台测试/冷源清理.rs`

- [x] **Step 1: 写失败测试，要求 `complete` 时写入权威 `complete_at`，而不是由前端或首播时刻决定**

```rust
assert!(attachment.complete_at.is_some());
assert_eq!(attachment.retire_at, attachment.complete_at.map(|at| at + Duration::hours(24)));
```

- [x] **Step 2: 运行上传完成测试确认先红**

Run: `cargo test --test 媒体上传测试 complete -- --nocapture`  
Expected: FAIL，附件记录里还没有完整的 `complete_at/retire_at`

- [x] **Step 3: 写失败测试，要求服务重启或清理流程不会重置退场基点**

```rust
assert_eq!(loaded.retire_at, Some(fixed_complete_at + Duration::hours(24)));
```

- [x] **Step 4: 运行冷源清理相关测试确认先红**

Run: `cargo test --test 媒体后台测试 冷源清理 -- --nocapture`  
Expected: FAIL，清理逻辑仍基于旧时间字段或重新推导

- [x] **Step 5: 在 `complete_media_upload` 中落权威 `complete_at` / `retire_at`，并显式区分未 complete / 已 abandon / 已 delete**

```rust
let complete_at = now;
let retire_at = complete_at + chrono::Duration::hours(24);
record.complete_at = Some(complete_at);
record.retire_at = Some(retire_at);
```

- [x] **Step 6: 在清理逻辑里只消费持久化退场时间，不再用前端访问行为重算**

```rust
if let Some(retire_at) = record.retire_at {
    if now >= retire_at {
        return 清理动作::仅保留控制面真相;
    }
}
```

- [x] **Step 7: 重新运行上传与清理测试并确认转绿**

Run: `cargo test --test 媒体上传测试 complete -- --nocapture && cargo test --test 媒体后台测试 冷源清理 -- --nocapture`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add src/媒体上传外壳.rs tests/媒体上传测试/complete.rs tests/媒体后台测试/冷源清理.rs
git commit -m "固定媒体24小时退场基点为后端complete_at"
```

### Task 3: 后端 locator 只说新主链真话，禁止给新附件发第二正式播放链

**Files:**
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/媒体协作分发.rs`
- Test: `tests/协作分发测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`
- Test: `tests/协作分发测试/投影一致性.rs`

- [x] **Step 1: 写失败测试，要求新附件 locator 在 `24 小时` 前后都只围绕 swarm 真相投影**

```rust
assert!(locator.distribution.is_some());
assert_eq!(locator.media_state.code, "MEDIA_READY");
assert!(locator.streaming_asset.is_none());
assert!(locator.thumbnail_url.is_none());
```

- [x] **Step 2: 运行协作分发投影测试确认先红**

Run: `cargo test --test 协作分发测试 投影一致性 -- --nocapture`  
Expected: FAIL，locator 仍会为新附件带出旧 `HLS/thumbnail/original` 正式链字段

- [x] **Step 3: 写失败测试，要求 `24 小时` 后无在线完整 peer 时返回 `MEDIA_CONNECTING_TO_PEERS -> MEDIA_NO_ONLINE_SEED` 的权威结果**

```rust
assert_eq!(state_after_probe.code, "MEDIA_NO_ONLINE_SEED");
assert_eq!(state_after_probe.retry_after_ms, Some(15_000));
```

- [x] **Step 4: 运行可用性裁决测试确认先红**

Run: `cargo test --test 协作分发测试 可用性裁决 -- --nocapture`  
Expected: FAIL，后端仍只会返回旧 `expired` 或笼统错误

- [x] **Step 5: 在 `裁决协作分发可用性` 中改成权威状态机，而不是 `available/expired` 二元判断**

```rust
match (is_deleted, has_available_source, is_within_server_window) {
    (true, _, _) => 媒体状态::deleted(),
    (_, true, _) => 媒体状态::ready(),
    (_, false, true) => 媒体状态::connecting(),
    (_, false, false) => 媒体状态::no_online_seed(),
}
```

- [x] **Step 6: 在 `load_media_locator` 中只为 legacy 附件保留旧兼容字段，新附件正式投影只围绕分发片段与状态 code**

```rust
if attachment.is_new_webtorrent_generation() {
    locator.thumbnail_url = None;
    locator.streaming_asset = None;
    locator.original_url = None;
}
```

- [x] **Step 7: 重新运行协作分发测试并确认转绿**

Run: `cargo test --test 协作分发测试 -- --nocapture`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add src/媒体资产外壳.rs src/媒体协作分发.rs tests/协作分发测试.rs tests/协作分发测试/可用性裁决.rs tests/协作分发测试/投影一致性.rs
git commit -m "收口新附件locator只暴露WebTorrent主链真相"
```

### Task 4: 前端统一媒体 owner，禁止时间线和查看器分裂成两条链

**Files:**
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`
- Test: `frontend/tests/媒体查看器测试.spec.ts`
- Test: `frontend/tests/聊天应用内核测试.spec.ts`
- Test: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`

- [x] **Step 1: 写失败测试，要求时间线和查看器共用同一 swarm session / file handle 真相**

```ts
expect(运行时.获取会话("att-new")?.ownerKinds).toEqual(["timeline", "viewer"]);
expect(locateCalls.forceRefresh).toBe(0);
```

- [x] **Step 2: 运行播放与查看器测试确认先红**

Run: `pnpm --dir frontend test -- tests/媒体播放测试.spec.ts tests/媒体查看器测试.spec.ts`  
Expected: FAIL，查看器仍会创建第二媒体链或重新请求旧 locator

- [x] **Step 3: 写失败测试，要求新附件不再把 `HLS/original_url/thumbnail` 当正式字节来源**

```ts
expect(result.kind).toBe("swarm");
expect(result.fallbackUrl).toBeUndefined();
```

- [x] **Step 4: 运行聊天应用内核与消息查看器测试确认先红**

Run: `pnpm --dir frontend test -- tests/聊天应用内核测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts`  
Expected: FAIL，旧 fallback 路径仍被命中

- [x] **Step 5: 在资产协作分发运行时中把“滑到即补齐、滑走不停、补齐后做种”写成默认 owner 规则**

```ts
if (consumer.kind === "timeline" || consumer.kind === "viewer") {
  session.ensurePrefetchToComplete();
  session.keepSeedingAfterComplete = true;
}
```

- [x] **Step 6: 在媒体播放与查看器中移除新附件的第二正式链选择，只允许 legacy 走旧兼容分支**

```ts
if (locator.distribution) {
  return 使用协作分发主链(locator);
}
return 使用旧兼容链(locator);
```

- [x] **Step 7: 重新运行四组前端测试并确认转绿**

Run: `pnpm --dir frontend test -- tests/媒体播放测试.spec.ts tests/媒体查看器测试.spec.ts tests/聊天应用内核测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add frontend/媒体/资产协作分发运行时.ts frontend/媒体/媒体播放.ts frontend/媒体/媒体查看器.ts frontend/聊天媒体编排.ts frontend/tests/媒体播放测试.spec.ts frontend/tests/媒体查看器测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts
git commit -m "统一时间线与查看器媒体owner并移除新附件第二主链"
```

### Task 5: 图片冷启动也必须守住单一主链，禁止用服务器缩略图偷渡

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/平台/存储运行时.ts`
- Test: `frontend/tests/blob媒体资产测试.spec.ts`
- Test: `frontend/tests/存储运行时测试.spec.ts`

- [x] **Step 1: 写失败测试，要求无本地缓存的新图片不会偷偷去拿服务器 thumbnail**

```ts
expect(fetchThumbnail).not.toHaveBeenCalled();
expect(result.kind).toBe("placeholder");
```

- [x] **Step 2: 运行 blob 媒体测试确认先红**

Run: `pnpm --dir frontend test -- tests/blob媒体资产测试.spec.ts`  
Expected: FAIL，图片首屏仍依赖旧 thumbnail 流程

- [x] **Step 3: 写失败测试，要求删除后 purge 本地图片/视频缓存并停止继续做种**

```ts
expect(storage.读取完整载荷("att-new")).toBeUndefined();
expect(runtime.是否仍在做种("att-new")).toBe(false);
```

- [x] **Step 4: 运行存储运行时测试确认先红**

Run: `pnpm --dir frontend test -- tests/存储运行时测试.spec.ts`  
Expected: FAIL，本地缓存与 seeding 状态仍未在删除后统一清空

- [x] **Step 5: 在媒体播放层为图片实现“同 payload 早期可解码字节优先，否则稳定占位”的逻辑**

```ts
if (payload.canDecodeProgressively) {
  return { kind: "swarm-image", progressive: true };
}
return { kind: "placeholder", ratio: locator.aspectRatio };
```

- [x] **Step 6: 在存储运行时中区分“24小时退场不清本地”与“删除必须 purge”**

```ts
if (event.type === "MEDIA_DELETED") {
  清除完整载荷(attachmentId);
  清除部分字节(attachmentId);
  清除预览缓存(attachmentId);
}
```

- [x] **Step 7: 重新运行图片与存储测试并确认转绿**

Run: `pnpm --dir frontend test -- tests/blob媒体资产测试.spec.ts tests/存储运行时测试.spec.ts`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add frontend/媒体/媒体播放.ts frontend/媒体/媒体查看器.ts frontend/平台/存储运行时.ts frontend/tests/blob媒体资产测试.spec.ts frontend/tests/存储运行时测试.spec.ts
git commit -m "收口图片冷启动与删除purge语义"
```

### Task 6: 让后端真成为强群友，新增受管 `WebRTC seeder` sidecar

**Files:**
- Create: `frontend/dev-seeder.mjs`
- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `run.ps1`
- Modify: `tests/启动器脚本检查.ps1`
- Modify: `tests/协作分发测试/分发元数据.rs`
- Modify: `tests/媒体后台测试/冷源清理.rs`

- [x] **Step 1: 写失败测试，要求启动脚本把 `WebRTC seeder` 当成正式受管进程，而不是人工附属脚本**

```powershell
$services = Get-RecognizedProjectServices
$services | Should -Contain "webtorrent-seeder"
```

- [x] **Step 2: 运行启动器脚本检查确认先红**

Run: `pwsh -File tests/启动器脚本检查.ps1`  
Expected: FAIL，当前识别服务列表还没有 `webtorrent-seeder`

- [x] **Step 3: 写失败测试，要求后端在 `complete` 后登记 sidecar 做种 intent，在退场或删除时发出 stop/reconcile**

```rust
assert_eq!(intent.action, "start");
assert_eq!(intent.info_hash, expected_info_hash);
assert!(intent.webseed_url.is_some());
```

- [x] **Step 4: 运行分发元数据与冷源清理测试确认先红**

Run: `cargo test --test 协作分发测试 分发元数据 -- --nocapture && cargo test --test 媒体后台测试 冷源清理 -- --nocapture`  
Expected: FAIL，当前后端还不会对 sidecar 发出 start/stop/reconcile intent

- [x] **Step 5: 写最小 sidecar，基于成熟 WebTorrent/WebRTC 能力暴露 `seed/start/stop/reconcile` 薄命令面**

```js
app.post("/seed/start", async (req, res) => {
  await ensureTorrent(req.body.infoHash, req.body.magnetUri);
  res.json({ ok: true });
});
```

- [x] **Step 6: 在 Rust 后端中登记 seeding intent，并在 `complete / retire / delete / startup reconcile` 驱动 sidecar**

```rust
match intent {
    SeederIntent::Start(seed) => seeder_client.start(seed).await?,
    SeederIntent::Stop { info_hash } => seeder_client.stop(info_hash).await?,
    SeederIntent::Reconcile(active) => seeder_client.reconcile(active).await?,
}
```

- [x] **Step 7: 在 `run.ps1` 中把 seeder 纳入受管启动、日志、清理与 HTTPS 联机链路**

```powershell
New-ManagedProcess -Name "webtorrent-seeder" -Command $SeederCommand -ReadyPattern "Seeder ready"
```

- [x] **Step 8: 重新运行启动器脚本检查与后端 seeding intent 测试并确认转绿**

Run: `pwsh -File tests/启动器脚本检查.ps1 && cargo test --test 协作分发测试 分发元数据 -- --nocapture && cargo test --test 媒体后台测试 冷源清理 -- --nocapture`  
Expected: PASS

- [x] **Step 9: 提交**

```bash
git add frontend/dev-seeder.mjs src/媒体协作分发.rs src/媒体上传外壳.rs run.ps1 tests/启动器脚本检查.ps1 tests/协作分发测试/分发元数据.rs tests/媒体后台测试/冷源清理.rs
git commit -m "把WebRTC seeder做成后端受管强种能力"
```

### Task 7: 把“正在尝试连接群友 / 当前没有在线种子 / 内容已删除”落成真正可测的 UI 真相

**Files:**
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Test: `frontend/tests/媒体查看器测试.spec.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`
- Test: `frontend/tests/聊天应用内核测试.spec.ts`

- [x] **Step 1: 写失败测试，要求 `MEDIA_CONNECTING_TO_PEERS` 先显示连接群友，而不是通用加载中**

```ts
expect(view.textContent).toContain("正在尝试连接群友");
```

- [x] **Step 2: 写失败测试，要求 8 秒预算耗尽后转成 `MEDIA_NO_ONLINE_SEED`**

```ts
advanceTimersByTime(8_000);
expect(view.textContent).toContain("当前没有在线种子，等待群友上线");
```

- [x] **Step 3: 写失败测试，要求删除态覆盖本地缓存与 peer 恢复尝试**

```ts
expect(view.textContent).toContain("内容已删除");
expect(retryLoop.isRunning()).toBe(false);
```

- [x] **Step 4: 运行相关前端测试确认先红**

Run: `pnpm --dir frontend test -- tests/媒体查看器测试.spec.ts tests/媒体播放测试.spec.ts tests/聊天应用内核测试.spec.ts`  
Expected: FAIL，现有 UI 仍是模糊失败态或继续依赖旧 fallback

- [x] **Step 5: 在运行时中落地 8s / 2s / 15s 的默认重试窗口，并禁止 deleted 再进入 peer 连接循环**

```ts
const CONNECT_WINDOW_MS = 8_000;
const PROBE_INTERVAL_MS = 2_000;
const NO_SEED_RETRY_MS = 15_000;
```

- [x] **Step 6: 在查看器与时间线中统一消费 contract code，而不是各自派生另一套状态机**

```ts
switch (locator.mediaState.code) {
  case "MEDIA_CONNECTING_TO_PEERS":
    return 渲染连接群友态();
  case "MEDIA_NO_ONLINE_SEED":
    return 渲染无种子态();
  case "MEDIA_DELETED":
    return 渲染删除态();
}
```

- [x] **Step 7: 重新运行相关前端测试并确认转绿**

Run: `pnpm --dir frontend test -- tests/媒体查看器测试.spec.ts tests/媒体播放测试.spec.ts tests/聊天应用内核测试.spec.ts`  
Expected: PASS

- [x] **Step 8: 提交**

```bash
git add frontend/媒体/媒体查看器.ts frontend/媒体/媒体播放.ts frontend/聊天媒体编排.ts frontend/tests/媒体查看器测试.spec.ts frontend/tests/媒体播放测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts
git commit -m "落地群友连接与无种子删除真相状态"
```

### Task 8: 做完总验证，再用真实双会话烟测压一次系统真相

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`
- Modify: `docs/superpowers/plans/2026-04-22-WebTorrent高速分发防止群友偷懒.md`（仅勾选执行结果与补充偏差记录）

- [x] **Step 1: 跑前端核心测试全集**

Run: `pnpm --dir frontend test`  
Expected: PASS

- [x] **Step 2: 跑前端类型与构建**

Run: `pnpm --dir frontend typecheck && pnpm --dir frontend build`  
Expected: PASS

- [x] **Step 3: 跑后端测试全集**

Run: `cargo test`  
Expected: PASS

- [x] **Step 4: 跑启动脚本与 HTTPS 环境**

Run: `& 'E:\koko\https.ps1'`  
Expected: 输出包含 `https://localhost`，并且 `run.ps1` 管理的 tracker / backend / tusd / webtorrent-seeder 都已就绪

- [x] **Step 5: 用 Chrome DevTools 双会话做真实烟测**

Smoke procedure:
1. 建两个隔离上下文：`sender_ctx` 与 `viewer_ctx`。  
2. 同时打开 `https://localhost` 并进入房间 `1234b`。  
3. sender 发送图片和 `D:\200-生活\230-照片备份\233-Telegram\色色` 中的代表性 MP4。  
4. 验证 `0-24 小时` 阶段：查看器/时间线都命中同一 swarm 主链，后端强 seed 参与，画质不下降。  
5. 注入测试时钟或后端时间推进，跨过 `complete_at + 24h`。  
6. 验证纯 peer 阶段：  
   - viewer 仍在线时可继续播放；  
   - 断开完整 peer 后，先见“正在尝试连接群友”，再见“当前没有在线种子，等待群友上线”；  
   - 删除附件后转为“内容已删除”。  

- [x] **Step 6: 更新 spec 的验收证据与偏差说明**

```md
- 写入真实 smoke 结果、图片/视频验证结果、24 小时退场结果
- 记录任何遗留兼容债务只限 legacy 附件，不得影响新附件主链结论
```

- [x] **Step 7: 代码有变更时重建 graphify**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`  
Expected: graphify 重建成功，无异常退出

- [x] **Step 8: 提交收尾**

```bash
git add docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md docs/superpowers/plans/2026-04-22-WebTorrent高速分发防止群友偷懒.md
git commit -m "补齐WebTorrent主链退场验证与验收证据"
```

---

## Final Verification Checklist

- [x] `cargo test`
- [x] `pnpm --dir frontend test`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend build`
- [x] `pwsh -File tests/启动器脚本检查.ps1`
- [x] `& 'E:\koko\https.ps1'`
- [x] Chrome DevTools 双会话烟测：房间 `1234b`、图片 + MP4、退场前后、无在线种子、删除终态
- [x] `git status --short`
- [x] `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`（代码有改动时）

## Execution Notes

1. 所有任务步骤已按计划执行并完成验收，复测结果已同步回 spec 文档。
2. Chrome DevTools 双会话烟测已覆盖房间 `1234b` 的 sender/viewer 真实链路，并捕获到 `/webtorrent/.../content` 正式字节请求。
3. seeder sidecar 当前可用能力已通过依赖修复提升为 `capability=webtorrent`（不再是 `mock`）。

