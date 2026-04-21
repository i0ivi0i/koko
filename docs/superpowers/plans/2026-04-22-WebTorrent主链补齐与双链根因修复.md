# WebTorrent 主链补齐与双链根因修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前“声明已完成但仍存在双链并发与状态真相缺口”的实现偏差，让新附件严格满足 `spec` 的单一 WebTorrent 正式主链、删除终态与重试节奏契约。

**Architecture:** 先用失败测试把真实缺口钉死，再做最小修复。后端补齐 `MEDIA_DELETED` 的权威产出与状态转移；前端收口视频预览源仲裁，禁止新附件继续走 canonical/original 冷源直拉；运行时消费 `retry_after_ms` 统一重试节奏，并修正 404 抖动窗口。最后用 `chrome-devtools` 三会话实测做回归门禁。

**Tech Stack:** Rust、TypeScript、Vitest、cargo test、PowerShell、chrome-devtools CLI

---

## Root Cause Snapshot (2026-04-22)

1. `frontend/聊天媒体编排.ts` 的 `解析视频预览` 仍然先走 `读取视频canonical冷源地址`，导致同一附件出现 `webtorrent + /api/attachments/*?variant=original` 并发。
2. `src/媒体协作分发.rs` 中 `MEDIA_DELETED` 常量存在，但 `裁决协作分发媒体状态码` 未产出 `MEDIA_DELETED` 路径，删除终态没有闭环到 locator media_state。
3. `retry_after_ms` 只定义在契约与测试，前端生产逻辑未真正消费，重试窗口仍靠局部硬编码/隐式行为。
4. 三会话实测（房间 `1234b`）仍可见 webtorrent 404 抖动与请求风暴：
   - sender: `webtorrent=64`、`original=162`
   - viewerA: `webtorrent=1047`、`locator=990`、`presence=955`、`torrent=937`
   - viewerB: `webtorrent=4`、仍出现 404

## File Map

### Backend Truth
- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/用例.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`
- Test: `tests/协作分发测试/投影一致性.rs`

### Frontend Runtime
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`
- Test: `frontend/tests/聊天应用内核测试.spec.ts`
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`

### Verification / Smoke
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`（仅补“未完成项与二次验收”）
- Create: `tmp/smoke-2026-04-22-webtorrent-regression.txt`（可选，保存三会话统计结果）

---

### Task 1: 先把“双链并发”写成失败测试

**Files:**
- Test: `frontend/tests/聊天应用内核测试.spec.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 写失败测试，锁定“新附件视频预览不得触发 original 直拉”**

```ts
expect(fetchCalls.some((u) => u.includes("variant=original"))).toBe(false);
expect(fetchCalls.some((u) => u.includes("/webtorrent/"))).toBe(true);
```

- [ ] **Step 2: 运行前端测试确认先红**

Run: `pnpm --dir frontend test -- tests/聊天应用内核测试.spec.ts tests/媒体播放测试.spec.ts`
Expected: FAIL，出现 `variant=original` 命中或断言不满足

- [ ] **Step 3: 提交测试红灯快照**

```bash
git add frontend/tests/聊天应用内核测试.spec.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "补充新附件视频预览双链并发回归红灯测试"
```

### Task 2: 收口视频预览源仲裁，只保留 WebTorrent 正式主链

**Files:**
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Test: `frontend/tests/聊天应用内核测试.spec.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 在 `解析视频预览` 里改为优先（且默认仅）协作分发源**

```ts
if (locator.distribution) {
  const swarm = await 协作分发运行时.解析协作分发源(...);
  if (swarm?.src) previewSource = swarm.src;
}
```

- [ ] **Step 2: 仅为 legacy 代际保留冷源兼容，不允许新附件回落 original/canonical**

```ts
if (isLegacyAttachment(locator)) {
  previewSource = 读取视频canonical冷源地址(locator);
}
```

- [ ] **Step 3: 复跑前端测试转绿**

Run: `pnpm --dir frontend test -- tests/聊天应用内核测试.spec.ts tests/媒体播放测试.spec.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/聊天媒体编排.ts frontend/媒体/媒体播放.ts frontend/tests/聊天应用内核测试.spec.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "收口新附件视频预览到WebTorrent单主链"
```

### Task 3: 后端补齐 `MEDIA_DELETED` 权威产出与投影

**Files:**
- Modify: `src/用例.rs`
- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体资产外壳.rs`
- Test: `tests/协作分发测试/可用性裁决.rs`
- Test: `tests/协作分发测试/投影一致性.rs`

- [ ] **Step 1: 写失败测试，要求删除后 `distribution.media_state.code=MEDIA_DELETED`**

```rust
assert_eq!(
    body["distribution"]["media_state"]["code"].as_str(),
    Some("MEDIA_DELETED")
);
```

- [ ] **Step 2: 运行 Rust 测试确认先红**

Run: `cargo test --test 协作分发测试 可用性裁决 -- --nocapture`
Expected: FAIL，当前仍返回 READY/CONNECTING/NO_ONLINE_SEED 之一

- [ ] **Step 3: 在快照与裁决逻辑显式纳入删除终态，并禁止 deleted 继续签发 join_ticket**

```rust
if snapshot.已删除 {
    return 媒体状态已删除;
}
```

- [ ] **Step 4: 复跑测试转绿**

Run: `cargo test --test 协作分发测试 -- --nocapture`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/用例.rs src/媒体协作分发.rs src/媒体资产外壳.rs tests/协作分发测试/可用性裁决.rs tests/协作分发测试/投影一致性.rs
git commit -m "补齐协作分发MEDIA_DELETED权威终态与投影"
```

### Task 4: 前端消费 `retry_after_ms`，统一重试 owner 与节奏

**Files:**
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Test: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 写失败测试，验证连接群友态使用 contract 提供的 retry 间隔**

```ts
expect(scheduleRetry).toHaveBeenCalledWith(2000);
expect(scheduleRetry).toHaveBeenCalledWith(15000);
```

- [ ] **Step 2: 运行前端测试确认先红**

Run: `pnpm --dir frontend test -- tests/资产协作分发运行时测试.spec.ts tests/媒体播放测试.spec.ts`
Expected: FAIL，仍未消费 `media_state.retry_after_ms`

- [ ] **Step 3: 最小实现：优先读 `distribution.media_state.retry_after_ms`，缺省再回退默认值**

```ts
const retryMs = locator.distribution?.media_state?.retry_after_ms ?? DEFAULT_RETRY_MS;
scheduleRetry(retryMs);
```

- [ ] **Step 4: 复跑测试转绿**

Run: `pnpm --dir frontend test -- tests/资产协作分发运行时测试.spec.ts tests/媒体播放测试.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/媒体/资产协作分发运行时.ts frontend/媒体/媒体播放.ts frontend/tests/资产协作分发运行时测试.spec.ts frontend/tests/媒体播放测试.spec.ts
git commit -m "前端接管media_state.retry_after_ms重试节奏"
```

### Task 5: 修正 webtorrent 404 抖动窗口，避免误判与风暴放大

**Files:**
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `src/媒体协作分发.rs`
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Test: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写失败测试，模拟首个 streamURL 404 后应在同会话重试并恢复，不进入错误降级**

```ts
expect(resultAfterRetry?.src).toContain("/webtorrent/");
expect(failureReason).toBeNull();
```

- [ ] **Step 2: 运行相关测试确认先红**

Run: `pnpm --dir frontend test -- tests/资产协作分发运行时测试.spec.ts && cargo test --test 协作分发测试 可用性裁决 -- --nocapture`
Expected: FAIL，出现 404 后直接降级或状态抖动

- [ ] **Step 3: 最小实现：保持同 swarm session，按 retry budget 做短窗口恢复**

```ts
if (is404 && withinConnectingWindow) {
  await retryStreamProbe();
  return;
}
```

- [ ] **Step 4: 复跑测试转绿**

Run: `pnpm --dir frontend test -- tests/资产协作分发运行时测试.spec.ts && cargo test --test 协作分发测试 -- --nocapture`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/媒体/资产协作分发运行时.ts src/媒体协作分发.rs frontend/tests/资产协作分发运行时测试.spec.ts tests/协作分发测试/可用性裁决.rs
git commit -m "修复WebTorrent 404抖动窗口并保持同会话恢复"
```

### Task 6: 三会话 `chrome-devtools` 烟测复验并回填 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`
- (Optional) Create: `tmp/smoke-2026-04-22-webtorrent-regression.txt`

- [ ] **Step 1: 执行 sender/viewerA/viewerB 三会话采样（房间 `1234b`）**

Run:
```bash
chrome-devtools list_pages --output-format=json
chrome-devtools select_page 2 --output-format=json
chrome-devtools select_page 3 --output-format=json
chrome-devtools select_page 4 --output-format=json
```

- [ ] **Step 2: 统计每页 `webtorrent/original/locator/presence/torrent/404`**

Run: 使用 PowerShell 循环 `chrome-devtools list_network_requests --pageIdx ... --pageSize 200 --output-format=json` 并聚合
Expected: 新附件 `original` 请求应收敛到 0；404 仅允许短暂恢复且不引发持续风暴

- [ ] **Step 3: 验证 MP4 样本（来自 `D:\200-生活\230-照片备份\233-Telegram\色色`）在 sender->viewer 双向链路下不再触发双链并发**

Run: 上传 2 个样本（中体积 + 大体积），观察 network 切面
Expected: 正式字节只见 `/webtorrent/*/content-*`，不再持续 `variant=original`

- [ ] **Step 4: 全量回归**

Run:
```bash
cargo test
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
pwsh -File tests/启动器脚本检查.ps1
```
Expected: 全绿

- [ ] **Step 5: 更新 spec 验收段落，明确“二次验收完成”与残余风险（若有）**

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md
git commit -m "补齐WebTorrent单主链二次验收与根因修复证据"
```

---

## Final Verification Checklist

- [ ] `cargo test`
- [ ] `pnpm --dir frontend test`
- [ ] `pnpm --dir frontend typecheck`
- [ ] `pnpm --dir frontend build`
- [ ] `pwsh -File tests/启动器脚本检查.ps1`
- [ ] `chrome-devtools` 三会话烟测（房间 `1234b` + 两个 MP4 样本）
- [ ] `git status --short`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-WebTorrent主链补齐与双链根因修复.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
