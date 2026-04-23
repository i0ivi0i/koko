# WebTorrent 群聊越活跃越强的极限协同分发收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把剩余的前端帮助任务生命周期缺口彻底收口，让“已进入帮助链的附件”不会因为当前时间线消息集合退场而被错误释放，直到显式清空、删除或真实销毁才结束。

**Architecture:** 后端 `partial_peer / complete_peer / MEDIA_CONNECTING_TO_PEERS` 真相已经成立，剩下的根因只在前端壳层 `聊天媒体编排`。这次不改传输协议、不改后端 locator，只把帮助任务 owner 从“当前时间线附件集合”提升为“当前房间内已进入帮助链的附件集合”，并保留删除态、显式清空、真实销毁时的正确退场语义。

**Tech Stack:** TypeScript、Vitest、现有 `聊天媒体编排` / `媒体会话` / `资产协作分发运行时`、PowerShell 验证命令

---

## 执行记录（2026-04-23）

1. Serena 复查确认残余根因不在后端 `partial_peer / MEDIA_READY` 裁决，而在 `frontend/聊天媒体编排.ts` 仍把帮助任务生命周期绑死在当前时间线附件集合上。
2. 新增 `frontend/tests/聊天媒体编排测试.spec.ts` 回归测试，先证明“进入帮助链后仍被当前时间线退场误杀”会真实失败，再补保护测试锁住 `销毁()` 的正确释放出口。
3. `frontend/聊天媒体编排.ts` 现已引入“已进入帮助链附件集合”作为最小生命周期 owner；当前时间线退场不再直接释放这些附件，但删除态、显式清空、真实销毁仍会结束帮助任务。
4. 新鲜验证已通过：`pnpm --dir frontend test`、`pnpm --dir frontend typecheck`、`pnpm --dir frontend build`、`cargo test -j 1`、`pwsh -File tests/启动器脚本检查.ps1`。

---

### Task 1: 先把退场误杀写成失败测试

**Files:**
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Reference: `frontend/聊天媒体编排.ts`

- [x] **Step 1: 写失败测试，证明旧帮助任务不该因时间线退场被释放**

```ts
it("附件进入帮助链后，即使暂时不在当前时间线集合里，也不会立刻释放帮助任务", async () => {
  // 先让 att-video-1 进入帮助链，再把 读取消息() 改成只返回另一个附件
  // 断言：不会调用 释放协作分发消费者(...att-video-1...)
  // 断言：帮助任务仍可继续存在，直到显式销毁/清空
});
```

- [x] **Step 2: 跑单测确认它先红**

Run: `pnpm --dir frontend test -- --run tests/聊天媒体编排测试.spec.ts`

Expected: 新增用例 FAIL，失败点指向“旧帮助任务被提前释放 / release 被调用”。

- [x] **Step 3: 补一个保护测试，证明真正退场语义没有被误放宽**

```ts
it("显式清空或销毁编排时，帮助任务仍会被正确释放", async () => {
  // 断言：清空()/销毁() 仍会释放相关 swarm consumer 和会话资源
});
```

- [x] **Step 4: 再跑一次目标测试文件，确认红因只剩实现缺口**

Run: `pnpm --dir frontend test -- --run tests/聊天媒体编排测试.spec.ts`

Expected: 新增生命周期测试红，既有测试不被无关打坏。

### Task 2: 最小实现帮助任务生命周期真相

**Files:**
- Modify: `frontend/聊天媒体编排.ts`
- Test: `frontend/tests/聊天媒体编排测试.spec.ts`

- [x] **Step 1: 在编排层引入“已进入帮助链附件集合”的最小 owner 状态**

实现要求：

1. 不新增第二套并行 swarm 真相，不碰 `资产协作分发运行时` 的 canonical owner。
2. 只在编排层记录“哪些附件已经被显式 viewer / 自动播放 / 缓存恢复带进帮助链”。
3. 该集合只服务于生命周期裁决，不能反过来伪造播放结果、ready 状态或 locator 真相。

- [x] **Step 2: 改 `同步消息附件播放结果()` 的释放条件**

实现要求：

1. 仍然为新进入当前时间线的附件创建会话、解析预览。
2. 当前时间线里消失的附件，若已经进入帮助链，则不得立刻 `释放协作分发消费者 + session.销毁()`。
3. 尚未进入帮助链、也不在当前时间线里的附件，允许继续按现有逻辑清理。

- [x] **Step 3: 明确保留真正应该结束帮助任务的出口**

实现要求：

1. `清空()` / `销毁()` 必须继续释放所有帮助任务。
2. 删除态附件不能借这次改动继续残留成伪帮助任务。
3. 如果后续房间切换或显式离房已有稳定出口，也要继续走该出口，而不是把帮助任务泄漏成僵尸状态。

- [x] **Step 4: 跑目标测试文件，确认转绿**

Run: `pnpm --dir frontend test -- --run tests/聊天媒体编排测试.spec.ts`

Expected: 新增生命周期测试 PASS，已有 `聊天媒体编排` 测试继续 PASS。

### Task 3: 回归验证、文档回填、最终收口

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
- Modify: `docs/superpowers/plans/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
- Modify: `frontend/聊天媒体编排.ts`（如测试后需要小重构）
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`（如断言需收口）

- [x] **Step 1: 跑前端回归验证**

Run:

```bash
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Expected: 全部 PASS，无新增类型错误或构建错误。

- [x] **Step 2: 更新 spec 与 plan 的实现记录**

回填内容：

1. 说明原残余根因是“帮助任务生命周期被当前时间线附件集合误绑死”。
2. 说明现已收口为“进入帮助链后不因时间线退场而被立即释放”。
3. 明确保留的结束条件：删除、显式清空、真实销毁。

- [x] **Step 3: 重建 graphify**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: `graphify-out/GRAPH_REPORT.md` 更新成功，无报错。

- [ ] **Step 4: 跑工作树复核并提交**

Run:

```bash
git status --short
git add frontend/聊天媒体编排.ts frontend/tests/聊天媒体编排测试.spec.ts docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md docs/superpowers/plans/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md
git commit -m "收口群聊协作分发帮助任务生命周期"
```

Expected: 只包含本次收尾相关改动，提交信息为中文且准确。
