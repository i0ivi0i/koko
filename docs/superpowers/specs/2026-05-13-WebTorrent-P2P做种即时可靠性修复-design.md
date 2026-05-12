# WebTorrent P2P 做种即时可靠性修复设计

日期：2026-05-13
状态：Design / Ready for implementation plan
关联：

- `docs/superpowers/plans/2026-05-11-接收者媒体极限秒开修复.md`
- `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`
- `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- `src/消息/适配.rs`
- `frontend/媒体/播放会话/应用.ts`
- `frontend/媒体/资产协作分发运行时.ts`
- `tests/用例测试.rs`

---

## 1. 根因

视频发到群里后，群友无法"立即暴力高速 WebTorrent 互帮互助"的根因有三个：

### 1.1 后端 distribution_hint 静默丢失

`src/消息/适配.rs:402-404`：

```rust
let 分发线索映射 = 查询附件分发线索批量_异步(pool, &附件标识列表)
    .await
    .unwrap_or_default();
```

`tx.commit()` 之后查询 `attachment_distribution_metadata` 表，失败时 `unwrap_or_default()` 返回空 HashMap。消息事件的附件快照不携带 `distribution_hint`，广播到群友时 `build_distribution_hint` 不会被调用，前端收到的 room_event 里 `distribution_hint` 为 null。

**后果**：群友完全无法知道要加入哪个 swarm，P2P 互助从源头断裂。

### 1.2 前端预热只缓存 locator，不加入 swarm

`frontend/媒体/播放会话/应用.ts:942-949`：

```typescript
// WebTorrent 会话在 viewport sync 时自然创建，无需提前启动。
if (hint.join_ticket && hint.announce_urls?.length) {
    const locator = 从丰富hint构造最小定位结果(attachment);
    媒体定位器.写入定位缓存(aid, locator);
    continue;  // ← 到此为止，不创建 WebTorrent 会话
}
```

room_event 到达时只写入 locator 缓存，实际 WebTorrent swarm join 推迟到消息进入 viewport（滚动到可见区域）后才发生。对于屏幕外的消息，群友永远不会加入 swarm。

**后果**：即使 hint 完整到达，群友也不会"立即"开始 P2P 互助，必须等消息滚到可见区。

### 1.3 测试未守护 distribution_hint 不变量

`tests/用例测试.rs:944-960`：`异步ready视频附件也能进入统一消息主链` 只断言消息能进入主链，不检查返回的领域事件中视频附件是否携带 `distribution_hint`。

**后果**：后端 hint 丢失的 bug 不会被 CI 捕获。

---

## 2. 目标

1. **后端**：`distribution_hint` 查询失败时 retry 1 次；仍失败则 warn 并继续（消息投递不能因分发线索失败而失败），但日志可追踪。
2. **测试**：`异步ready视频附件也能进入统一消息主链` 必须断言视频附件的 `distribution_hint` 非 None。
3. **前端**：room_event 到达且 hint 包含 `join_ticket + announce_urls` 时，立即以 `prefetch:` 模式创建 WebTorrent 会话（`deselect=true`，只建立 peer 连接不下载 piece），后续 viewport sync / autoplay 触发时 piggyback 已有会话。

---

## 3. 分层边界

### 3.1 domain / application

无改动。消息成立校验和附件引用校验不涉及 distribution_hint（hint 是 adapter 层丰富的广播运行态信息）。

### 3.2 contract

无改动。`附件分发线索` struct 和 `附件快照` 已有 `分发线索: Option<附件分发线索>` 字段。

### 3.3 adapter — 后端 `src/消息/适配.rs`

**改动 1**：`查询附件分发线索批量_异步` 调用处，`unwrap_or_default()` → retry + warn。

```rust
// BEFORE:
let 分发线索映射 = 查询附件分发线索批量_异步(pool, &附件标识列表)
    .await
    .unwrap_or_default();

// AFTER:
let 分发线索映射 = match 查询附件分发线索批量_异步(pool, &附件标识列表).await {
    Ok(map) => map,
    Err(_) => {
        // retry 1 次
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
                    "分发线索批量查询重试仍失败，本次消息广播不携带分发线索"
                );
                HashMap::new()
            })
    }
};
```

**设计决策**：不把查询失败上升为消息创建失败。原因：
- distribution_hint 是广播路径的运行态丰富信息，不是消息成立的必要条件
- 消息已经 commit 到数据库，广播中缺少 hint 只影响接收者的即时 P2P 预热
- 接收者后续仍可通过 HTTP locator 获取完整分发信息
- 但 retry + error 日志确保运维可追踪并发现系统性问题

### 3.4 adapter — 测试 `tests/用例测试.rs`

在 `异步ready视频附件也能进入统一消息主链` 测试中增加断言：

```rust
// 领域事件中视频附件必须携带 distribution_hint
match &event {
    contract::领域事件::消息已创建 { 附件, .. } => {
        for att in 附件 {
            if let contract::附件快照::视频(vid) = att {
                assert!(vid.分发线索.is_some(), "视频附件必须携带 distribution_hint");
            }
        }
    }
    _ => panic!("应返回消息已创建事件"),
}
```

### 3.5 shell — 前端 `frontend/媒体/播放会话/应用.ts`

**改动**：`预热权威消息媒体分发` 中，当 hint 包含完整 `join_ticket + announce_urls` 时，除了写入 locator 缓存，还要立即发起 `prefetch:` 模式的 swarm join。

```typescript
// BEFORE:
if (hint.join_ticket && hint.announce_urls?.length) {
    const locator = 从丰富hint构造最小定位结果(attachment);
    媒体定位器.写入定位缓存(aid, locator);
    continue;
}

// AFTER:
if (hint.join_ticket && hint.announce_urls?.length) {
    console.debug("[SWARM_IMMEDIATE_JOIN]", aid);
    performance.mark?.(`swarm_immediate_join:${aid}`);
    const locator = 从丰富hint构造最小定位结果(attachment);
    媒体定位器.写入定位缓存(aid, locator);
    // 立即以 prefetch 模式加入 swarm：只建立 peer 连接，不下载 piece
    void 协作分发应用.解析协作分发源({
        attachmentId: aid,
        kind: attachment.kind === "video" ? "video" : "image",
        locator,
        consumerId: `prefetch:${aid}`,
    }).catch(() => {
        // prefetch 失败不阻塞任何链路，viewport sync 时仍会重试
        console.debug("[SWARM_IMMEDIATE_JOIN_FAILED]", aid);
    });
    continue;
}
```

**设计决策**：
- 使用 `prefetch:` consumerId 前缀，复用已有的 `推导消费者模式` 逻辑（`资产协作分发运行时.ts:307`），自动设置 `deselect=true`
- `确保协作分发会话` 会对同一 swarm_id 去重（`资产协作分发运行时.ts:580-631`），后续 viewport sync / autoplay 触发时直接 piggyback 已有会话
- fire-and-forget：catch 静默，不影响消息渲染
- 后续 viewer / inline_autoplay 消费者绑定时，会通过 `确保协作分发会话` 的复用路径升级帮助资格（`资产协作分发运行时.ts:592-629`）

### 3.6 生命周期衔接

prefetch 会话 → playback 消费者升级路径已存在：

1. `预热权威消息媒体分发` 创建 `prefetch:${aid}` 会话（`deselect=true`，不下载 piece）
2. 消息进入 viewport → autoplay / viewer 触发 `解析协作分发源`
3. `确保协作分发会话` 发现 `底层会话表` 已有同 swarm_id 会话，走复用路径
4. 新消费者绑定带来 `已获得帮助资格 = true`，激活 `整附件补齐`
5. prefetch 消费者后续被释放时，如果播放消费者仍持有，会话继续存活

**不需要改动** `资产协作分发运行时.ts`：prefetch 模式和消费者升级逻辑已完整。

---

## 4. 验证标准

### 4.1 后端

- `cargo test 异步ready视频附件也能进入统一消息主链` 在改测试前 RED（断言 distribution_hint 存在 → 如果测试环境没有写入 distribution_metadata 则 fail）
- 补全测试夹具（确保视频附件在 `attachment_distribution_metadata` 表有记录）后 GREEN
- `unwrap_or_default()` 被替换后，日志可追踪 retry 和 final fail

### 4.2 前端

- `pnpm vitest run prefetch消费者模式测试` 继续 GREEN
- 新增测试：`预热权威消息媒体分发` 收到含完整 hint 的 room_event 后，`解析协作分发源` 被调用且 consumerId 为 `prefetch:${aid}`
- 现有 `权威事件预热测试.spec.ts` 扩展：验证 prefetch swarm join 被触发

### 4.3 冒烟测试

双浏览器 playwright 测试：
1. 用户 A 发送视频消息
2. 用户 B 收到 room_event 后 < 500ms 内 console 出现 `[SWARM_IMMEDIATE_JOIN]`
3. 用户 B 的 WebTorrent 运行时有对应 swarm_id 的会话（`prefetch` 模式）

---

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| prefetch 会话过多消耗 WebRTC 资源 | prefetch 模式 `deselect=true` 不下载 piece，只建立 peer 连接；生命周期策略（`LIFECYCLE_POLICY_CHANGED`）已有降载清理 |
| 后台消息（用户不在此房间）触发大量 prefetch | `预热权威消息媒体分发` 只在当前房间的 room_event 触发，不会为后台房间创建会话 |
| 测试夹具需要 `attachment_distribution_metadata` 记录 | 在测试中插入对应的 distribution_metadata 行，或 mock 查询 |
| retry 增加消息创建延迟 | 单次 retry 的 DB 查询延迟 < 5ms，对万人群聊的消息投递延迟影响可忽略 |

---

## 6. 用户体验 (UX) 保障

此设计的核心价值在于**极限秒开与无感协同**的丝滑体验：

1. **静默预热，不抢带宽不卡顿**：`prefetch` 会话在消息到达的 50ms 内启动，由于强制了 `deselect: true`，它只在后台静默建立 WebRTC Peer 连接（打洞/握手），绝不抢占真实带宽，不引起聊天列表滚动掉帧。
2. **滚动即播放，告别 Loading**：当视频滑入视口（viewport sync）时，不再需要经历传统方案下 `拉取 locator -> 连接 tracker -> ICE 打洞 -> 握手` 的漫长 1~3 秒黑屏期。播放器通过消费者升权瞬间复用已建好的高速 Peer 链路，实现“划到即播”。
3. **退场/降级无感**：后端抛弃失败时的 panic，前端 catch 掉所有的 prefetch 异常。当极端网络情况导致 P2P 失败时，系统将无痕降回 CDN 播放，用户侧永远看不到报错弹窗或死链。

---

## 7. 不做什么

- 不把 `distribution_hint` 查询移入 `tx` 事务：延长锁持有时间，高并发下风险大于收益
- 不改变 `distribution_hint` 的 owner：它仍是 adapter 层广播运行态信息，不是 domain 消息成立条件
- 不改 `确保协作分发会话` 或 `资产协作分发运行时`：prefetch 模式和消费者升级逻辑已完整
- 不新增 `.rs` 文件：改动全在现有文件内
