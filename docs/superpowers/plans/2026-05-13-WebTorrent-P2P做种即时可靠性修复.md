# WebTorrent P2P 做种即时可靠性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复消息广播时分发线索静默丢失的 bug，并实现前端在收到事件后立刻以 `prefetch` 模式加入 WebTorrent swarm。

**Architecture:** 后端消息适配层改为重试并返回失败日志，测试强断言 `distribution_hint`，前端在 `预热权威消息媒体分发` 函数里调用底层会话发起的复用 API 加入 `prefetch` 模式。

**Tech Stack:** Rust (axum, sqlx), TypeScript (WebTorrent frontend runtime)

---

### Task 1: 强化后端测试，捕获 distribution_hint 静默丢失

**Files:**
- Modify: `e:/koko/tests/用例测试.rs:944-960`

- [ ] **Step 1: Write the failing test**

```rust
// In e:\koko\tests\用例测试.rs, inside function `异步ready视频附件也能进入统一消息主链`

// Replace lines checking event output with strict distribution_hint assertion:
// FROM:
// let room_id = match room { ... }
// TO:
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    
    // Add fake metadata for the video attachment to make sure it CAN be queried
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
         (attachment_id, content_hash, swarm_id, torrent_info_hash, web_seed_until) \
         VALUES ($1, 'fake-hash', 'fake-swarm', 'fake-info-hash', NOW() + INTERVAL '1 hour')"
    )
    .bind("att-ready-vid1")
    .execute(&repo.pool)
    .await
    .unwrap();

// LATER IN THE FUNCTION: Check event has distribution_hint
// Replace the assertion checking for event return:
// FROM:
// let event = koko::message::application::创建消息( ... ).expect("应成功");
// TO:
    let event = koko::message::application::创建消息(
        // ... (use existing args)
    ).await.expect("应成功");
    
    match &event {
        koko::shared::contract::领域事件::消息已创建 { 附件, .. } => {
            let mut found_video = false;
            for att in 附件 {
                if let koko::shared::contract::附件快照::视频(vid) = att {
                    found_video = true;
                    assert!(vid.分发线索.is_some(), "视频附件必须携带 distribution_hint");
                }
            }
            assert!(found_video, "事件必须包含视频附件");
        }
        _ => panic!("应返回消息已创建事件"),
    }
```

- [ ] **Step 2: Run test to verify it fails (or passes if fake data was enough, wait, it should pass after we fix the implementation, but let's see)**

Run: `cargo test 异步ready视频附件也能进入统一消息主链`
Expected: If the current implementation `unwrap_or_default()` works and finds the fake data, it might pass. If the test already has a video attachment but lacks metadata, it will fail the new assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/用例测试.rs
git commit -m "test: assert distribution_hint presence in message creation"
```

### Task 2: 修复后端 distribution_hint 静默丢失 bug

**Files:**
- Modify: `e:/koko/src/消息/适配.rs:392-404`

- [ ] **Step 1: Implement retry logic for distribution hint**

```rust
// In e:\koko\src\消息\适配.rs

// Replace:
//    let 分发线索映射 = 查询附件分发线索批量_异步(pool, &附件标识列表)
//        .await
//        .unwrap_or_default();
// With:
    let 分发线索映射 = match 查询附件分发线索批量_异步(pool, &附件标识列表).await {
        Ok(map) => map,
        Err(_) => {
            tracing::warn!(
                application = "创建消息",
                adapter = "消息适配",
                observation = "distribution_hint_query_retry",
                "分发线索批量查询首次失败，正在重试"
            );
            查询附件分发线索批量_异步(pool, &附件标识列表)
                .await
                .unwrap_or_else(|_| {
                    tracing::error!(
                        application = "创建消息",
                        adapter = "消息适配",
                        observation = "distribution_hint_query_failed_after_retry",
                        "分发线索批量查询重试仍失败，本次消息广播将不携带分发线索"
                    );
                    std::collections::HashMap::new()
                })
        }
    };
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cargo test 异步ready视频附件也能进入统一消息主链`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/消息/适配.rs
git commit -m "fix(backend): retry on distribution_hint query instead of silent drop"
```

### Task 3: 扩展前端测试，断言预热触发 swarm join

**Files:**
- Modify: `e:/koko/frontend/聊天媒体编排/权威事件预热测试.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// In e:\koko\frontend\聊天媒体编排\权威事件预热测试.spec.ts

// Add a mock check for 协作分发应用.解析协作分发源 to be called when prewarming

// Add at top with other mocks if not present:
import { 协作分发应用 } from "../媒体/协作分发全局入口";
vi.mock("../媒体/协作分发全局入口", () => ({
  协作分发应用: {
    解析协作分发源: vi.fn().mockResolvedValue(null),
  }
}));

// In an appropriate test case (e.g., "处理含 distribution_hint 的权威事件时"):
// Add assertion:
expect(协作分发应用.解析协作分发源).toHaveBeenCalledWith({
  attachmentId: "att-1",
  kind: "video",
  locator: expect.anything(),
  consumerId: "prefetch:att-1"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run 权威事件预热测试`
Expected: FAIL, because `解析协作分发源` is not called yet.

- [ ] **Step 3: Commit**

```bash
git add frontend/聊天媒体编排/权威事件预热测试.spec.ts
git commit -m "test(frontend): assert prefetch swarm join on authoritative event"
```

### Task 4: 修复前端预热只写 locator 不加 swarm 的 bug

**Files:**
- Modify: `e:/koko/frontend/媒体/播放会话/应用.ts`

- [ ] **Step 1: Implement the prefetch call**

```typescript
// In e:\koko\frontend\媒体\播放会话\应用.ts, inside 预热权威消息媒体分发 function

// Ensure 协作分发应用 is imported at the top of the file:
// import { 协作分发应用 } from "../协作分发全局入口";

// Replace lines 942-949:
//          if (hint.join_ticket && hint.announce_urls?.length) {
//            console.debug("[SWARM_DIRECT_PREFETCH]", aid);
//            performance.mark?.(`swarm_direct_prefetch:${aid}`);
//            const locator = 从丰富hint构造最小定位结果(attachment as 附件快照 & { distribution_hint: 附件分发线索 });
//            媒体定位器.写入定位缓存(aid, locator);
//            continue;
//          }

// With:
          if (hint.join_ticket && hint.announce_urls?.length) {
            console.debug("[SWARM_IMMEDIATE_JOIN]", aid);
            performance.mark?.(`swarm_immediate_join:${aid}`);
            const locator = 从丰富hint构造最小定位结果(attachment as 附件快照 & { distribution_hint: 附件分发线索 });
            媒体定位器.写入定位缓存(aid, locator);
            
            void 协作分发应用.解析协作分发源({
              attachmentId: aid,
              kind: attachment.kind === "video" ? "video" : "image",
              locator,
              consumerId: `prefetch:${aid}`,
            }).catch(() => {
              console.debug("[SWARM_IMMEDIATE_JOIN_FAILED]", aid);
            });
            continue;
          }
```

- [ ] **Step 2: Run tests to verify**

Run: `npx vitest run 权威事件预热测试`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/媒体/播放会话/应用.ts
git commit -m "fix(frontend): join swarm immediately on prewarm via prefetch"
```
