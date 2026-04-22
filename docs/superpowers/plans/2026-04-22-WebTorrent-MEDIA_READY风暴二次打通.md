# WebTorrent MEDIA_READY 风暴二次打通 Plan（2026-04-22）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底打通 `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md` 在“已 READY 但仍高频重连风暴”上的最后缺口，确保前端不再把可播放会话误判为需要持续重建。

**Architecture:** 先用真实网络证据确认风暴，再用 TDD 把两个根因钉死：
1. 媒体会话在稳定态收到 `SWARM_ACTIVE` 误重置恢复门禁，放大 `PLAYER_ERROR`；
2. 协作分发运行时把 `warning(join_ticket_invalid)` 一律当硬失败，导致会话 teardown 与 locator/torrent 循环重建。

**Tech Stack:** TypeScript、Vitest、chrome-devtools-cli、WebTorrent runtime

---

## Root Cause Snapshot

1. `frontend/媒体/媒体会话.ts`
   - `SWARM_ACTIVE` 分支对所有状态都执行 `播放器恢复窗口已触发 = false`。
   - 在稳定播放期会收到大量运行时活跃信号，这会把恢复门禁反复打开。
2. `frontend/媒体/资产协作分发运行时.ts`
   - `warning(join_ticket_invalid)` 与 `error` 走同一条硬失败路径：发布 `SWARM_TICKET_INVALID` + 删除会话。
   - 会话被反复删建，触发 `locator -> presence -> torrent -> webtorrent` 高频循环。

---

## File Map

### Runtime Fix
- Modify: `frontend/媒体/媒体会话.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/媒体/媒体协作分发.ts`

### Regression Tests
- Modify: `frontend/tests/媒体会话测试.spec.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`

### Verification
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend test -- tests/媒体协作分发测试.spec.ts tests/媒体会话测试.spec.ts tests/媒体播放测试.spec.ts tests/聊天媒体编排测试.spec.ts`
- `pnpm --dir frontend build`
- `chrome-devtools-cli` 双会话烟测（房间 `1234b`）

---

## Tasks

### Task 1: 用失败测试钉死门禁重置缺陷

- [x] 新增 `媒体会话` 回归用例：
  - 场景：稳定 swarm 播放 -> `PLAYER_ERROR` 触发一次恢复 -> `SWARM_ACTIVE + PLAYER_ERROR` 不应再次触发恢复。
  - 文件：`frontend/tests/媒体会话测试.spec.ts`
- [x] 验证红灯：断言 `解析播放结果` 由 1 次错误放大到 2 次（复现成功）。

### Task 2: 修复会话门禁

- [x] 仅在 `waiting_for_peer_or_network` 阶段允许 `SWARM_ACTIVE` 重置恢复门禁并触发恢复。
- [x] 稳定播放期 `SWARM_ACTIVE` 不再清空门禁，阻断无意义恢复放大。
- [x] 相关测试回绿。

### Task 3: 用失败测试钉死 warning 误杀会话

- [x] 新增 `媒体协作分发` 回归用例：
  - 场景：会话已连上群友后收到 `warning(join_ticket_invalid)`，不应立刻发 `SWARM_TICKET_INVALID` 并删会话。
  - 文件：`frontend/tests/媒体协作分发测试.spec.ts`
- [x] 验证红灯：确认当前实现会错误产出 `SWARM_TICKET_INVALID`（复现成功）。

### Task 4: 修复 warning 处理策略

- [x] `warning(join_ticket_invalid)` 改为软处理：
  - 已连上群友：忽略 warning，不 teardown。
  - 未连上群友：仅写 `terminalError`，交给探测链自然收敛，不同步广播 `SWARM_TICKET_INVALID`。
- [x] `error(join_ticket_invalid)` 保持硬失败语义（保证真故障可收敛）。
- [x] 全部相关测试回绿。

### Task 5: 真实烟测复验

- [x] 使用 `chrome-devtools-cli` 双会话（sender/viewer）在 `https://localhost`、房间 `1234b` 复验。
- [x] 目标附件 `att-959fdf62986b` 对比：
  - 修复前（20s 采样）：`locator=33, presence=30, torrent=30`。
  - 修复后（20s 采样）：`locator=2`（风暴显著收敛）。
- [x] 构建版本确认：页面已加载 `https://localhost/dist/app-27VWPFZ3.js`。

---

## Acceptance Gate

- [x] 新增回归测试先红后绿（2 处根因）。
- [x] 前端类型检查通过。
- [x] 关键前端测试集合通过。
- [x] 真实浏览器链路确认风暴收敛，不再持续高频重建。

---

## Notes

1. 本次修复只收敛“READY 态重建风暴”与“warning 误杀会话”，未放松 spec 对单主链和失败真相的硬约束。
2. 若后续要继续压低背景噪声，可在 `SWARM_ACTIVE` 事件发布层追加幂等去重（非本次阻塞项）。
