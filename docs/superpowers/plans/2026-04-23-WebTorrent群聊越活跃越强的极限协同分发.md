# WebTorrent 群聊越活跃越强的极限协同分发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把新上传视频/图片的协作分发从“主链已收口但仍偏保守”推进到“看过的人尽量都变成帮助者、后来者默认多来源并行猛拉、`24 小时` 后群友仍尽量能接住后人”的运行现实，同时保持唯一正式主链与失败态说真话。

**Architecture:** 后端继续做唯一的媒体状态真相 owner，只扩展 `swarm_peer_presence` 的来源语义与 `media_state` 裁决，不新增第二张真相表。前端继续沿 `聊天媒体编排 -> 媒体播放器 -> 资产协作分发运行时 -> WebTorrent runtime` 这条 owner 链推进，但去掉“视频补齐只复用已热会话”“只上报 complete_peer”“页面重开不恢复帮助任务”这些保守行为。

**Tech Stack:** Rust (`axum` / `sqlx` / PostgreSQL), TypeScript (`vitest` / WebTorrent browser runtime / XState actor runtime), Chrome DevTools CLI smoke tests, PowerShell launcher checks

**Execution Status:** Completed on `2026-04-23`

**Execution Record:**

- Task 1 commit: `aa2418b` `扩展协作分发来源裁决并引入 partial peer`
- Task 2 commit: `9a74b3d` `让协作分发会话默认 eager 补齐并上报 partial peer`
- Task 3 commit: `c11242d` `去掉视频协作补齐的 reuseOnly 保守门槛`
- Task 4 commit: `850cf19` `让本地完整附件在重开后恢复当前房间的帮助任务`
- Task 5 commit: final completion commit in git history; includes transport regression, full verification, browser smoke, spec backfill, and final graph rebuild.

---

## File Map

### Backend truth / persistence

- `migrations/0017_协作分发partial_peer与来源裁决.sql`
  - 给 `swarm_peer_presence.peer_kind` 增加 `partial_peer`
  - 保持原表与主键不变，禁止新开第二张 presence/availability 表
- `src/用例.rs`
  - `协作分发存活类型*` 常量、有效值校验、`写入协作分发存活` 输入校验
  - 若需要 richer summary，就在这里定义最小快照字段，禁止把 UI 语义塞进 contract
- `src/媒体附件适配.rs`
  - `查询协作分发元数据_异步` 对 `swarm_peer_presence` 的聚合查询
  - 这里负责把 `partial_peer / complete_peer / backend_strong_seed` 各自的最近活跃事实取出来
- `src/媒体协作分发.rs`
  - `裁决协作分发可用性`
  - `裁决协作分发媒体状态码`
  - `协作分发快照转响应值`
  - 这里是后端对 locator/runtime surface 的唯一裁决点
- `src/媒体资产外壳.rs`
  - `parse_distribution_presence_payload`
  - `update_media_distribution_presence`
  - 这里只做协议翻译，禁止在这里自己发明业务状态

### Frontend swarm/runtime owner chain

- `frontend/媒体/媒体协作分发.ts`
  - WebTorrent 接入、presence 上报、torrent 缓存、streamURL 探测
  - 这里负责“我当前是什么帮助者类型”，不负责最终业务 ready 真相
- `frontend/媒体/资产协作分发运行时.ts`
  - swarm session 的唯一前端 owner：consumer 绑定、eagerCompleting、零引用保留、生命周期降载
  - 当前 conservative 热点主要在这里
- `frontend/媒体/媒体播放.ts`
  - 播放器 owner，决定何时激活协作补齐
  - 当前保守点是视频 backfill 只允许 `reuseOnly`
- `frontend/聊天媒体编排.ts`
  - 把媒体会话信号、媒体缓存、查看器/自动播 owner 收口到一个编排 owner
  - 这里是“页面回来后，如果缓存仍在，如何恢复帮助任务”的最小正确切面
- `frontend/媒体/媒体缓存.ts`
  - 只保存“本地已完整”的最小事实
  - 默认不新增第二套 swarm 真相；如果要恢复帮助任务，只允许复用这里的事实，不允许再造一份全局后台任务账本

### Tests / verification

- `tests/启动与迁移测试.rs`
- `tests/协作分发测试/可用性裁决.rs`
- `frontend/tests/媒体协作分发测试.spec.ts`
- `frontend/tests/资产协作分发运行时测试.spec.ts`
- `frontend/tests/媒体播放测试.spec.ts`
- `frontend/tests/聊天媒体编排测试.spec.ts`
- `frontend/tests/聊天应用内核测试.spec.ts`
- `frontend/tests/传输测试.spec.ts`
- `tests/启动器脚本检查.ps1`

### Docs / meta

- `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
  - 实现完成后把状态与验收记录回填

---

## Task 1: 扩展后端来源真相，承认 `partial_peer` 但不把它偷换成 `MEDIA_READY`

**Files:**
- Create: `migrations/0017_协作分发partial_peer与来源裁决.sql`
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体资产外壳.rs`
- Test: `tests/启动与迁移测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写失败测试，先把“partial peer 不等于 complete peer，但也不是无价值”钉死**

在 `tests/协作分发测试/可用性裁决.rs` 新增至少三条测试：

```rust
#[tokio::test]
#[serial]
async fn recent_partial_peer会让过期附件保持connecting而不是直接no_seed() {
    // web_seed 已退场；只有 partial_peer 活跃
    // 期望：locator.distribution.media_state.code == "MEDIA_CONNECTING_TO_PEERS"
}

#[tokio::test]
#[serial]
async fn stale_partial_peer不会把附件永久抬在connecting() {
    // partial_peer 已经过了 stale window
    // 期望：最终进入 MEDIA_NO_ONLINE_SEED
}

#[tokio::test]
#[serial]
async fn partial_peer不能冒充available_ready来源() {
    // 只有 partial_peer，没有 complete/backend strong seed
    // 期望：availability 不被抬成 available-ready 等价真相
}
```

同时在 `tests/启动与迁移测试.rs` 增加迁移断言，确保新 migration 允许 `partial_peer`：

```rust
assert!(sql.contains("partial_peer"));
```

- [ ] **Step 2: 运行失败测试，确认当前实现还停留在 `complete_peer/backend_strong_seed` 语义**

Run:

```bash
cargo test -j 1 tests::启动与迁移测试 -- --nocapture
cargo test -j 1 partial_peer -- --nocapture
```

Expected:
- 新测试失败
- 失败点应体现当前后端只认 `viewer_intent / complete_peer / backend_strong_seed`

- [ ] **Step 3: 写最小实现，只扩展来源裁决，不新增第二张真相表**

实现要求：

1. 在 `migrations/0017_协作分发partial_peer与来源裁决.sql` 中只修改 `peer_kind` 约束，不新建 parallel 表。
2. 在 `src/用例.rs` 增加新的来源类型常量，并更新 `是有效协作分发存活类型`。
3. 在 `src/媒体资产外壳.rs` 的 `parse_distribution_presence_payload` 允许解析 `partial_peer`。
4. 在 `src/媒体附件适配.rs` 的聚合查询里，分别拿到：
   - 最近 `partial_peer`
   - 最近 `complete_peer`
   - 最近 `backend_strong_seed`
5. 在 `src/媒体协作分发.rs` 中明确新裁决：
   - `MEDIA_READY` 只认 `web_seed仍可用`、`complete_peer`、`backend_strong_seed`
   - `MEDIA_CONNECTING_TO_PEERS` 认“连接窗口内”或“recent partial_peer 仍活跃”
   - `MEDIA_NO_ONLINE_SEED` 只在以上来源都不存在时成立

目标代码形状参考：

```rust
pub const 协作分发存活类型片段peer: &str = "partial_peer";

fn 裁决协作分发媒体状态码(...) -> &'static str {
    if 附件已删除 {
        return 媒体状态已删除;
    }
    if web_seed仍可用 || 有新鲜完整peer || 有新鲜后端强种子 {
        return 媒体状态已就绪;
    }
    if 有新鲜片段peer || 仍在连接窗口内 {
        return 媒体状态连接群友中;
    }
    媒体状态无在线种子
}
```

禁止：

1. 禁止把 `partial_peer` 直接算进 `MEDIA_READY`
2. 禁止为了支持 `partial_peer` 新开第二张 availability 表
3. 禁止把这层裁决挪到前端

- [ ] **Step 4: 重新运行后端测试，确认新语义只扩展“连接群友窗口”，没有篡改删除/complete 真相**

Run:

```bash
cargo test -j 1 tests::协作分发测试::可用性裁决 -- --nocapture
cargo test -j 1 tests::启动与迁移测试 -- --nocapture
```

Expected:
- 新增 partial-peer 测试通过
- 原有 `MEDIA_DELETED / backend_strong_seed / complete_peer` 测试继续通过

- [ ] **Step 5: 提交**

```bash
git add migrations/0017_协作分发partial_peer与来源裁决.sql src/用例.rs src/媒体附件适配.rs src/媒体协作分发.rs src/媒体资产外壳.rs tests/启动与迁移测试.rs tests/协作分发测试/可用性裁决.rs
git commit -m "扩展协作分发来源裁决并引入 partial peer"
```

---

## Task 2: 让前端真正上报 `partial_peer`，并把 eager backfill 做成默认行为而不是热会话特权

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Test: `frontend/tests/媒体协作分发测试.spec.ts`
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`

- [ ] **Step 1: 先写失败测试，把当前保守行为显式翻红**

在 `frontend/tests/媒体协作分发测试.spec.ts` 把现有“默认不 eager 补齐”的断言翻成目标行为，并新增 `partial_peer` 心跳测试：

```ts
it("首次接入协作分发时会立刻进入 whole-file eager completing，而不是只保当前可播", async () => {
  const source = await 解析协作分发源({...});
  expect(读取协作分发会话状态("swarm-att-lazy-backfill-1")).toMatchObject({
    eagerCompleting: true,
    hint: "正在补块",
  });
});

it("会话首次连上群友后会先上报 partial_peer，而不是等到 done 才有来源心跳", async () => {
  // wire 之后期待 presence body 包含 partial_peer
});

it("torrent done 后会把 presence 从 partial_peer 升级为 complete_peer", async () => {
  // 先 partial，再 done，再 complete_peer
});
```

在 `frontend/tests/资产协作分发运行时测试.spec.ts` 新增零引用保留与生命周期测试：

```ts
it("零消费者的 eagerCompleting 会话在后台策略变化时仍保留，不会被当成冷会话清掉", async () => {
  // heavyWorkPolicy = reduced / suspended 下仍保留 eagerCompleting
});
```

- [ ] **Step 2: 跑前端失败测试，确认当前实现还停留在“只上报 complete_peer + 首次不 eager”**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/媒体协作分发测试.spec.ts
pnpm --dir frontend exec vitest run frontend/tests/资产协作分发运行时测试.spec.ts
```

Expected:
- lazy-backfill 测试失败
- `partial_peer` 心跳测试失败

- [ ] **Step 3: 写最小实现，保持 owner 链不变，只去掉保守门槛**

实现要求：

1. 在 `frontend/媒体/媒体协作分发.ts` 把本地 `协作分发存活类型` 扩成：

```ts
type 协作分发存活类型 =
  | "viewer_intent"
  | "partial_peer"
  | "complete_peer"
  | "backend_strong_seed";
```

2. 把 `启动协作分发存活上报` 改成支持切换当前 peer_kind，例如：

```ts
启动或切换协作分发存活上报(session, distribution, "partial_peer");
启动或切换协作分发存活上报(session, distribution, "complete_peer");
```

3. `partial_peer` 的开始时机以“会话已真实进入 swarm 并拿到可用 file/source”为准，不以 UI 是否继续盯着它为准。
4. `done` 后必须把同一会话升级到 `complete_peer`，不能双心跳并存。
5. 在 `frontend/媒体/资产协作分发运行时.ts` 中保持当前 canonical owner，不要把 eager/backfill 判断分散回播放器或聊天壳。
6. `激活整附件补齐` 继续只抬高 preview/whole-file select，不得重新发明第二套 whole-file 下载实现。

禁止：

1. 禁止把 `partial_peer` 心跳挪到聊天壳或播放器层
2. 禁止把 `done` 前的任何 viewer 意图直接冒充 `complete_peer`
3. 禁止为了 eager backfill 再造第二个 swarm runtime

- [ ] **Step 4: 重跑前端协作分发测试，确认会话真正更激进了，但删除/no-seed 语义没坏**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/媒体协作分发测试.spec.ts
pnpm --dir frontend exec vitest run frontend/tests/资产协作分发运行时测试.spec.ts
```

Expected:
- eager backfill / partial_peer / complete_peer 升级测试通过
- 原有 join_ticket_invalid / noPeers / remove/destroy 幂等测试仍绿

- [ ] **Step 5: 提交**

```bash
git add frontend/媒体/媒体协作分发.ts frontend/媒体/资产协作分发运行时.ts frontend/tests/媒体协作分发测试.spec.ts frontend/tests/资产协作分发运行时测试.spec.ts
git commit -m "让协作分发会话默认 eager 补齐并上报 partial peer"
```

---

## Task 3: 去掉视频 backfill 的 `reuseOnly` 保守门槛，让自动播放/查看器都能把自己养成帮助者

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 先写失败测试，把“视频只允许复用已热 swarm”翻成目标行为**

把现有保守断言改成目标断言：

```ts
it("视频进入 backfill 时会允许冷启动协作分发，而不是强制 reuseOnly", async () => {
  await 播放器.激活协作补齐({
    attachmentId: "att-video-hls-backfill",
    kind: "video",
    consumerId: "session:att-video-hls-backfill",
    onSessionEvent: vi.fn(),
  });

  expect(resolveSwarmSource).toHaveBeenCalledWith(
    expect.objectContaining({
      eagerCompleting: true,
      reuseOnly: undefined,
    })
  );
});
```

再补一条“viewer / inline_autoplay 都继续走同一 swarm owner”的回归测试，避免冷启动 backfill 时重新长出第二主链。

- [ ] **Step 2: 跑失败测试，确认当前 `媒体播放.ts` 还在强制 `reuseOnly: true`**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/媒体播放测试.spec.ts
```

Expected:
- 新 backfill 测试失败
- 失败点指向 `reuseOnly: true`

- [ ] **Step 3: 写最小实现，只去掉保守门槛，不改变主链归属**

在 `frontend/媒体/媒体播放.ts` 的 `激活协作补齐` 中修改视频分支：

```ts
await resolveSwarmSource({
  attachmentId: input.attachmentId,
  kind: input.kind,
  locator,
  eagerCompleting: true,
  ...(input.consumerId ? { consumerId: input.consumerId } : {}),
  ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
});
```

同时保留以下底线：

1. 仍然只走 swarm 主链，不回退 `HLS/origin` 正式播放链
2. `MEDIA_DELETED / MEDIA_NO_ONLINE_SEED` 仍由 locator 真相拦住
3. 图片与视频继续走同一条 `resolveSwarmSource` owner 链

禁止：

1. 禁止因为去掉 `reuseOnly` 就重新回退到锚点冷源
2. 禁止为了“更稳”把视频 backfill 偷做成另一条后台 whole-file 直链

- [ ] **Step 4: 重跑播放器测试**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/媒体播放测试.spec.ts
```

Expected:
- 新 backfill 冷启动测试通过
- 原有 `MEDIA_DELETED / MEDIA_NO_ONLINE_SEED / peer_only_after_expiry / HLS 不回退` 测试保持通过

- [ ] **Step 5: 提交**

```bash
git add frontend/媒体/媒体播放.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "去掉视频协作补齐的 reuseOnly 保守门槛"
```

---

## Task 4: 页面重开后，如果本地完整缓存仍在，就恢复当前房间里的帮助任务

**Files:**
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 先写失败测试，把“缓存还在就恢复帮助任务”固定下来**

在 `frontend/tests/聊天应用内核测试.spec.ts` 和/或 `frontend/tests/聊天媒体编排测试.spec.ts` 增加两类测试：

```ts
it("媒体缓存启动后，会为当前房间里已缓存完整的视频重新激活协作补齐", async () => {
  // storage 里已有 complete=true + contentHash 的视频记录
  // 期望：聊天媒体编排在 room join 后调用 激活协作补齐
});

it("如果缓存被清空，则不会凭空恢复旧帮助任务", async () => {
  // storage 中无记录
  // 期望：不会自动触发协作补齐
});
```

再补一条范围边界测试，防止恢复逻辑越权：

```ts
it("只恢复当前房间附件的帮助任务，不扫描别的房间或全局历史附件", async () => {
  // 当前 room snapshot 不含某 attachmentId，即便缓存里有 complete 记录，也不恢复
});
```

- [ ] **Step 2: 跑失败测试，确认当前编排只会应用 locally_complete，不会恢复帮助任务**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/聊天媒体编排测试.spec.ts
pnpm --dir frontend exec vitest run frontend/tests/聊天应用内核测试.spec.ts
```

Expected:
- 新恢复帮助任务测试失败
- 当前实现只会在 `媒体缓存.启动()` 后把 `ASSET_COMPLETE` 打回已有会话

- [ ] **Step 3: 写最小实现，把恢复边界收在 `聊天媒体编排.ts`**

实现要求：

1. 继续把 `媒体缓存` 当作“本地完整资产”唯一真相。
2. 在 `媒体缓存.启动()` 完成后、且当前房间附件集合可用时，只对**当前房间里出现的附件**做恢复扫描。
3. 对满足以下条件的附件触发 `激活附件协作补齐`：
   - `媒体缓存` 中 `complete === true`
   - 当前房间附件条目存在
   - 能推导出 `kind`
   - 不处于已删除终态
4. 恢复动作仍然走现有 `媒体播放器.激活协作补齐`，禁止新造“后台恢复守护进程”。

目标代码形状参考：

```ts
void 媒体缓存.启动().then(() => {
  for (const attachment of 读取当前房间媒体附件()) {
    if (!媒体缓存.snapshot()[attachment.attachmentId]?.complete) {
      continue;
    }
    应用缓存完整度到会话(attachment.attachmentId);
    激活附件协作补齐(attachment.attachmentId);
  }
  deps.请求重渲染();
});
```

禁止：

1. 禁止全局扫描所有缓存附件并在后台偷偷全部重挂
2. 禁止把恢复逻辑塞进 `媒体缓存.ts` 或 `媒体播放器.ts`
3. 禁止清缓存后仍强行恢复旧帮助任务

- [ ] **Step 4: 重跑编排/内核测试**

Run:

```bash
pnpm --dir frontend exec vitest run frontend/tests/聊天媒体编排测试.spec.ts
pnpm --dir frontend exec vitest run frontend/tests/聊天应用内核测试.spec.ts
```

Expected:
- 缓存仍在时会恢复当前房间帮助任务
- 清缓存或不在当前房间时不会越权恢复
- 原有“刷新后 locally_complete 恢复”“查看器删除终态”“查看器重裁决”测试继续通过

- [ ] **Step 5: 提交**

```bash
git add frontend/聊天媒体编排.ts frontend/tests/聊天媒体编排测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts
git commit -m "让本地完整附件在重开后恢复当前房间的帮助任务"
```

---

## Task 5: 补齐传输/共享回归面并做全链路验证

**Files:**
- Modify: `frontend/tests/传输测试.spec.ts`
- Modify: `tests/启动器脚本检查.ps1`（仅当控制面字段/日志契约变化时）
- Modify: `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`

- [ ] **Step 1: 补共享回归测试，确保我们没有偷偷改坏 locator/transport 表面**

如果后端响应 JSON 新增了最小来源汇总字段，就在 `frontend/tests/传输测试.spec.ts` 增加断言；  
如果没有新增字段，也要补一条 regression，确保 `media_state` 的新 partial-peer 语义仍然通过 locator 传到前端。

示例：

```ts
it("loadMediaLocator 会把 partial-peer 导致的 connecting 语义稳定透传给前端", async () => {
  expect(locator.distribution?.media_state?.code).toBe("MEDIA_CONNECTING_TO_PEERS");
});
```

- [ ] **Step 2: 跑前端全量测试、类型检查、构建**

Run:

```bash
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Expected:
- 全绿

- [ ] **Step 3: 跑后端全量测试与启动器脚本检查**

Run:

```bash
cargo test -j 1
pwsh -File tests/启动器脚本检查.ps1
```

Expected:
- 全绿

- [ ] **Step 4: 做真实多会话烟测，证明“群越活跃越强”不是纸上谈兵**

使用 `chrome-devtools-cli` / DevTools 多隔离上下文，在 `https://localhost`、房间 `1234b` 做至少一轮真实烟测：

1. sender 上传一段 MP4
2. A、B、C 依次进入并自动播放/查看
3. D 再进入，抓网络与会话日志，确认并非只靠单来源
4. 让 A/B/C 至少一人保持在线，再让 E/F 几乎同时进入
5. 模拟超过 `24 小时` 后再用 G/H 进入，确认：
   - 有群友在线时仍能接住
   - 无可恢复来源时进入“当前没有在线种子”
6. 再做删除终态验证，确认 `MEDIA_DELETED` 抢赢旧缓存/旧会话

建议观察点：

```text
GET /webtorrent/{infohash}/content-*.mp4 [206]
POST /api/media/{attachment}/presence?session_id=...
peer_kind=partial_peer / complete_peer
locator.distribution.media_state.code
```

- [ ] **Step 5: 更新 spec 状态与验收记录**

实现全部通过后，把 `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md` 的：

1. `状态` 改成 `Implemented`
2. 补上实际通过的测试/烟测/根因记录
3. 明确写出本次没有落地的 deferred 项（若有）

- [ ] **Step 6: 重建 graphify 并做最终提交**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git status --short
```

确认只有本次相关改动后再提交：

```bash
git add docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md docs/superpowers/plans/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md frontend/tests/传输测试.spec.ts tests/启动器脚本检查.ps1
git commit -m "完成 WebTorrent 群聊越活跃越强的极限协同分发"
```

---

## Implementation Notes

### 1. 本次计划明确不做的事

- 不新开第二张 swarm 可用性表
- 不把 `partial_peer` 直接上抬成 `MEDIA_READY`
- 不为了恢复帮助任务而造全局后台守护进程
- 不为移动端/弱网长出第二套业务状态机
- 不把 `HLS/origin` 重新拉回正式播放主链

### 2. 本次计划允许的最小演进

- 扩展 `swarm_peer_presence.peer_kind`
- 扩展后端 locator 裁决逻辑
- 扩展前端协作分发 runtime 的 heartbeat 类型
- 去掉视频 backfill 的 `reuseOnly` 保守门槛
- 在当前房间边界内恢复本地完整附件的帮助任务

### 3. 关键风险点

1. **partial_peer 误判成 ready**
   - 风险：前端会过早宣称“可播已稳”
   - 防线：后端仍只把它抬到 `MEDIA_CONNECTING_TO_PEERS`

2. **恢复帮助任务越权**
   - 风险：页面一开就扫描所有历史缓存、浏览器被拖爆
   - 防线：只恢复当前房间附件，且继续走现有播放器 owner 链

3. **去掉 `reuseOnly` 后偷回冷源**
   - 风险：为了“更稳”重新让后台补齐走第二主链
   - 防线：所有 backfill 仍只能走 `resolveSwarmSource`

4. **生命周期策略误杀 eager 会话**
   - 风险：后台一降载就把真正的帮助任务删光
   - 防线：继续只清零消费者冷会话，不清 `eagerCompleting / locallyComplete`

### 4. 完成定义

只有下面同时成立，才能算这份计划完成：

1. A/B/C 自动播放后会尽量变成 D/E/F 的帮助者
2. D/E/F 进入时，不再被保守地压成“只复用热会话”
3. 后端承认 `partial_peer` 的连接价值，但不把它吹成 ready
4. 页面重开后，如果本地完整缓存还在，当前房间附件会恢复帮助任务
5. 删除/no-seed/connecting/deleted 四类真相都没被重新搞乱
6. 测试、类型检查、构建、真实烟测都通过
