# WebTorrent 强种子闭环与恢复抖动根因修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `2026-04-22-WebTorrent高速分发防止群友偷懒` 的关键硬裁决在真实运行里闭环：`0-24h` 后端强 seed 真正生效、前端恢复链不抖动、失败态语义稳定且可验证。

**Architecture:** 先用失败测试钉死三个已确认缺口，再做最小改动修复。核心策略是：Rust 后端补齐“seeding intent -> sidecar 命令面”闭环，sidecar 透传 join ticket，前端抑制非 owner 错误信号导致的恢复风暴。最后用 `chrome-devtools-cli` 三会话（房间 `1234b`）做可复现实测和日志门禁。

**Tech Stack:** Rust (`axum`/`tokio`/`reqwest`)、TypeScript (`lit`/`xstate`/`vitest`)、PowerShell、chrome-devtools CLI

---

## Root Cause Snapshot (2026-04-22)

1. `webtorrent-seeder` 控制面已启动但未被业务调用：`/health` 显示 `activeCount=0`，说明“后端 WebRTC seeder 强种子”闭环尚未落地。
2. `frontend/dev-seeder.mjs` 在 `client.add` 选项里未传 `getAnnounceOpts.ticket`，tracker 开启 join ticket 门禁后会产生大量 `join_ticket_invalid` 噪音。
3. `frontend/房间消息窗.ts` 时间线 `<video>` 的 `@error` 未做 owner 守卫，非 owner 预览错误也会广播 `PLAYER_ERROR`，放大恢复重试。
4. 三会话烟测中已确认新附件走 `/webtorrent/{infohash}/...` 主链；同时出现少量 `variant=original` 请求，这些命中与 `web_seed_url` 一致，属于 swarm 内 WebSeed，不等于“前端第二直链”。

## Required Skills

- `@superpowers:systematic-debugging`
- `@superpowers:test-driven-development`
- `@chrome-devtools-cli`
- `@supxcode`

## File Map

### Backend 强种子闭环
- Modify: `src/用例.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/外壳.rs`
- Test: `tests/协作分发测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`

### Seeder Sidecar 门禁透传
- Modify: `frontend/dev-seeder.mjs`
- Test: `tests/启动器脚本检查.ps1`

### Frontend 恢复抖动收敛
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/媒体/媒体会话.ts`
- Test: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Test: `frontend/tests/媒体会话测试.spec.ts`

### Smoke & Evidence
- Create: `tests/协作分发测试/1234b三会话冒烟.ps1`
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`

---

### Task 1: 先把“强 seed 闭环缺失”写成失败测试

**Files:**
- Test: `tests/协作分发测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写失败测试，要求 complete 后会产生可执行 seeding intent 并触发 sidecar start**

```rust
assert!(seed_calls.iter().any(|call| call.attachment_id == attachment_id));
assert_eq!(seed_calls[0].join_ticket.is_some(), true);
```

- [ ] **Step 2: 写失败测试，要求删除/过期后会触发 stop 或 reconcile**

```rust
assert!(seed_calls.iter().any(|call| call.kind == "stop"));
```

- [ ] **Step 3: 跑 Rust 测试确认先红**

Run: `cargo test --test 协作分发测试 -- --nocapture`  
Expected: FAIL，提示未触发 seeding intent 或 sidecar 调用计数为 0

- [ ] **Step 4: Commit（红灯快照）**

```bash
git add tests/协作分发测试.rs tests/协作分发测试/可用性裁决.rs
git commit -m "补充强种子控制面闭环红灯测试"
```

### Task 2: Rust 后端补齐 seeding intent -> sidecar 命令面

**Files:**
- Modify: `src/用例.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/外壳.rs`
- Test: `tests/协作分发测试.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 在应用层定义强种子端口，不把 sidecar 细节泄漏到 domain**

```rust
pub trait 协作分发做种端口 {
    async fn start_seed(&self, cmd: StartSeedCmd) -> anyhow::Result<()>;
    async fn stop_seed(&self, cmd: StopSeedCmd) -> anyhow::Result<()>;
    async fn reconcile(&self, cmd: ReconcileSeedCmd) -> anyhow::Result<()>;
}
```

- [ ] **Step 2: 在外壳层接入 HTTP sidecar adapter，命令面固定到 `/seed/start|stop|reconcile`**

```rust
client.post(format!("{base}/seed/start")).json(&payload).send().await?;
```

- [ ] **Step 3: complete/delete/24h 退场路径接入端口调用（最小侵入）**

```rust
if attachment_ready {
    seeder.start_seed(cmd).await?;
}
```

- [ ] **Step 4: 回跑 Task 1 测试转绿**

Run: `cargo test --test 协作分发测试 -- --nocapture`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/用例.rs src/媒体上传外壳.rs src/媒体资产外壳.rs src/外壳.rs tests/协作分发测试.rs tests/协作分发测试/可用性裁决.rs
git commit -m "补齐后端强种子意图与sidecar控制面闭环"
```

### Task 3: 修复 dev-seeder join ticket 透传，消除无票 announce 噪音

**Files:**
- Modify: `frontend/dev-seeder.mjs`
- Test: `tests/启动器脚本检查.ps1`

- [ ] **Step 1: 先加失败检查，要求 dev-seeder 使用 `getAnnounceOpts.ticket`**

```powershell
Assert-True ($seederScript -match 'getAnnounceOpts') "dev-seeder 必须向 tracker 透传 announce ticket。"
Assert-True ($seederScript -match 'joinTicket|ticket') "dev-seeder start payload 必须消费 join ticket 字段。"
```

- [ ] **Step 2: 运行脚本确认先红**

Run: `pwsh -File tests/启动器脚本检查.ps1`  
Expected: FAIL，提示缺少 `getAnnounceOpts` 或 ticket 透传

- [ ] **Step 3: 最小实现：`/seed/start` payload 支持 `joinTicket`，并在 `client.add` 选项透传**

```js
getAnnounceOpts: () => (payload.joinTicket ? { ticket: payload.joinTicket } : {})
```

- [ ] **Step 4: 复跑检查转绿**

Run: `pwsh -File tests/启动器脚本检查.ps1`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/dev-seeder.mjs tests/启动器脚本检查.ps1
git commit -m "修复dev-seeder announce join ticket 透传"
```

### Task 4: 收敛前端非 owner 恢复抖动

**Files:**
- Test: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Test: `frontend/tests/媒体会话测试.spec.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/媒体/媒体会话.ts`

- [ ] **Step 1: 写失败测试，非 owner 时间线视频触发 `error` 不应广播 `PLAYER_ERROR`**

```ts
expect(onSessionSignal).not.toHaveBeenCalledWith(
  expect.objectContaining({ signal: { type: "PLAYER_ERROR" } })
);
```

- [ ] **Step 2: 写失败测试，恢复期重复 `SWARM_TICKET_INVALID` 不应反复触发恢复解析**

```ts
expect(resolvePlayback).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: 跑前端测试确认先红**

Run: `pnpm --dir frontend test -- tests/房间消息窗媒体查看器测试.spec.ts tests/媒体会话测试.spec.ts`  
Expected: FAIL

- [ ] **Step 4: 最小实现**

```ts
if (!shouldRenderInlineVideo) return; // @error 与 waiting/stalled 对齐 owner 守卫
```

```ts
if (current.status === "recovering" && signal.type === "SWARM_TICKET_INVALID") return;
```

- [ ] **Step 5: 复跑前端测试转绿**

Run: `pnpm --dir frontend test -- tests/房间消息窗媒体查看器测试.spec.ts tests/媒体会话测试.spec.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/房间消息窗.ts frontend/媒体/媒体会话.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts frontend/tests/媒体会话测试.spec.ts
git commit -m "收敛非owner错误信号与票据失效恢复抖动"
```

### Task 5: 三会话实测脚本化（房间 `1234b`）

**Files:**
- Create: `tests/协作分发测试/1234b三会话冒烟.ps1`

- [ ] **Step 1: 写脚本化 smoke（sender/viewerA/viewerB）并固定样本目录**

```powershell
$SampleDir = 'D:\200-生活\230-照片备份\233-Telegram\色色'
```

- [ ] **Step 2: 脚本输出三类统计**
`/webtorrent/{infohash}/` 命中、`variant=original` 命中（按 attachment 区分）、`join_ticket_invalid` 增量

- [ ] **Step 3: 运行脚本并校验门禁**

Run: `pwsh -File tests/协作分发测试/1234b三会话冒烟.ps1`  
Expected:
- 新附件命中 `/webtorrent/{infohash}/...`
- `webtorrent-seeder /health` 的 `activeCount > 0`（0-24h）
- `join_ticket_invalid` 增量显著收敛（不再无票持续增长）

- [ ] **Step 4: Commit**

```bash
git add tests/协作分发测试/1234b三会话冒烟.ps1
git commit -m "新增1234b三会话协作分发冒烟脚本与门禁统计"
```

### Task 6: 全量回归与 spec 验收回写

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`

- [ ] **Step 1: 全量验证**

Run:
```bash
cargo test
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
pwsh -File tests/启动器脚本检查.ps1
pwsh -File tests/协作分发测试/1234b三会话冒烟.ps1
```

- [ ] **Step 2: 更新 spec 验收记录（明确修复点、证据与残余风险）**

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md
git commit -m "补录强种子闭环与恢复抖动修复验收证据"
```

---

## Final Verification Checklist

- [ ] `cargo test`
- [ ] `pnpm --dir frontend test`
- [ ] `pnpm --dir frontend typecheck`
- [ ] `pnpm --dir frontend build`
- [ ] `pwsh -File tests/启动器脚本检查.ps1`
- [ ] `pwsh -File tests/协作分发测试/1234b三会话冒烟.ps1`
- [ ] `Invoke-RestMethod http://127.0.0.1:7073/health` 显示 `activeCount > 0`（0-24h 场景）
- [ ] `git status --short`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-WebTorrent强种子闭环与恢复抖动根因修复.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
