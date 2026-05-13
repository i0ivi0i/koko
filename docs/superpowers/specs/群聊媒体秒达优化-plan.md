# 群聊媒体秒达优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将群聊媒体消息从发送到出现的延迟砍到 < 100ms（发送者）/ < 1s（接收者），自动播放启动 < 2s。

**Architecture:** 4 个 Phase 按依赖关系分批交付。Phase 1（乐观渲染）+ Phase 4（做种时序）互不依赖、先行交付；Phase 2（广播带分发线索）+ Phase 3（swarm 预热）联合设计后交付。所有改动服从洋葱边界：domain/application 不变，改动集中在 contract 可选扩展、adapter 序列化、shell 壳层编排。

**Tech Stack:** Rust (Tokio, Axum, socketioxide, sqlx) / TypeScript (Vitest, socket.io-client, WebTorrent)

**Spec:** `specs/群聊媒体秒达优化.md`

---

## File Map

### Phase 1: 乐观渲染（仅前端）

| 操作 | 文件 | 职责 |
|---|---|---|
| Modify | `frontend/媒体/媒体草稿.ts:46-58` | 新增 `提取可发送媒体附件元数据()` |
| Modify | `frontend/时间线/领域.ts:115-241` | `创建乐观房间消息输入` 增加 `attachments`；`创建乐观房间消息()` 填充附件 |
| Modify | `frontend/实时/应用.ts:259-271` | 移除 `attachmentIds.length === 0` 门禁，所有消息都创乐观消息 |
| Modify | `frontend/tests/房间时间线测试.spec.ts` | 新增带附件乐观消息测试 |

### Phase 4: 做种时序前移（仅后端）

| 操作 | 文件 | 职责 |
|---|---|---|
| Modify | `src/媒体/上传/外壳/完成上传.rs:620-641` | 做种启动改为 `tokio::spawn` fire-and-forget |

### Phase 2: 广播携带分发线索（前后端）

| 操作 | 文件 | 职责 |
|---|---|---|
| Modify | `src/共享/契约基础.rs:146-174` | `附件快照` 增加 `Option<附件分发线索>` |
| Modify | `src/消息/适配.rs` | 附件查询 JOIN 分发表，填充分发线索 |
| Modify | `src/外壳/协议响应.rs:33-67` | `attachments_to_json()` 序列化分发线索 |
| Modify | `frontend/聊天共享/契约.ts:91-113` | 附件快照类型增加可选 `distribution_hint` |

### Phase 3: Eager Locator Pre-fetch（仅前端）

| 操作 | 文件 | 职责 |
|---|---|---|
| Modify | `frontend/媒体/播放会话/应用.ts` | `接收消息附件同步` 时 eager pre-fetch locator |
| Modify | `frontend/媒体/壳层/窗口会话协作.ts` | 筛选含 `distribution_hint` 的视频附件传入 pre-fetch 列表 |

---

## Phase 1: 乐观渲染

### Task 1: 新增 `提取可发送媒体附件元数据`

**Files:**
- Modify: `frontend/媒体/媒体草稿.ts`
- Test: `frontend/tests/房间时间线测试.spec.ts`（Task 2 合并测试）

- [ ] **Step 1: 在 `媒体草稿.ts` 末尾新增纯函数**

在 `frontend/媒体/媒体草稿.ts` 末尾（`移除媒体草稿` 函数之后）追加：

```typescript
export function 提取可发送媒体附件元数据(
  草稿列表: 媒体附件草稿[]
): Array<{ kind: "image" | "video"; attachment_id: string; width: number; height: number }> {
  return 草稿列表
    .filter((draft): draft is 媒体附件草稿 & { status: "ready" } =>
      draft.status === "ready" && Boolean(draft.attachmentId)
    )
    .map((draft) => ({
      kind: draft.kind,
      attachment_id: draft.attachmentId,
      width: draft.width,
      height: draft.height,
    }));
}
```

这是一个纯函数，从 ready 草稿列表中提取附件元数据，供乐观消息渲染使用。

---

### Task 2: 扩展 `创建乐观房间消息` 支持附件

**Files:**
- Modify: `frontend/时间线/领域.ts:115-241`
- Modify: `frontend/tests/房间时间线测试.spec.ts`

- [ ] **Step 1: 写失败测试——带附件的乐观消息**

在 `frontend/tests/房间时间线测试.spec.ts` 的 `describe("房间时间线", ...)` 块末尾（最后一个 `it` 之后、`});` 之前）追加：

```typescript
  it("创建乐观媒体消息携带附件元数据，权威消息到达后附件不闪烁", () => {
    const optimistic = 创建乐观房间消息({
      roomId: "r-test",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      clientMessageId: "client-media-1",
      text: "",
      latestEventPosition: 20,
      attachments: [
        { kind: "video", attachment_id: "att-v1", width: 1920, height: 1080 },
      ],
    });

    expect(optimistic.attachments).toHaveLength(1);
    expect(optimistic.attachments![0]).toMatchObject({
      kind: "video",
      attachment_id: "att-v1",
      width: 1920,
      height: 1080,
    });
    expect(optimistic.message_id).toBe("local-client-media-1");

    // 权威消息用同一个 client_message_id 替换乐观消息
    const merged = 推进房间时间线(
      推进房间时间线([], { type: "OPTIMISTIC", message: optimistic }),
      {
        type: "REALTIME",
        events: [
          消息({
            message_id: "m-21",
            client_message_id: "client-media-1",
            sender_session_id: "s-test",
            event_position: 21,
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-v1",
                width: 1920,
                height: 1080,
              },
            ],
          }),
        ],
      }
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].message_id).toBe("m-21");
    expect(merged[0].attachments![0].attachment_id).toBe("att-v1");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd e:\koko\frontend && npx vitest run tests/房间时间线测试.spec.ts`
Expected: FAIL — `创建乐观房间消息` 不接受 `attachments` 参数（TypeScript 类型错误）。

- [ ] **Step 3: 扩展 `创建乐观房间消息输入` 类型**

在 `frontend/时间线/领域.ts` 中，将：

```typescript
export type 创建乐观房间消息输入 = {
  roomId: string;
  sessionId: string;
  displayAlias: string;
  clientMessageId: string;
  text: string;
  latestEventPosition: number;
};
```

改为：

```typescript
export type 创建乐观房间消息输入 = {
  roomId: string;
  sessionId: string;
  displayAlias: string;
  clientMessageId: string;
  text: string;
  latestEventPosition: number;
  attachments?: Array<{
    kind: "image" | "video";
    attachment_id: string;
    width: number;
    height: number;
  }>;
};
```

- [ ] **Step 4: 修改 `创建乐观房间消息` 函数体**

在 `frontend/时间线/领域.ts` 中，将：

```typescript
export function 创建乐观房间消息(input: 创建乐观房间消息输入): 消息事件 {
  return {
    type: "message_created",
    room_id: input.roomId,
    message_id: `local-${input.clientMessageId}`,
    client_message_id: input.clientMessageId,
    sender_session_id: input.sessionId,
    sender_display_alias: input.displayAlias,
    text: input.text,
    attachments: [],
    event_position: input.latestEventPosition + 1,
  };
}
```

改为：

```typescript
export function 创建乐观房间消息(input: 创建乐观房间消息输入): 消息事件 {
  return {
    type: "message_created",
    room_id: input.roomId,
    message_id: `local-${input.clientMessageId}`,
    client_message_id: input.clientMessageId,
    sender_session_id: input.sessionId,
    sender_display_alias: input.displayAlias,
    text: input.text,
    attachments: input.attachments?.map((a) => ({ ...a })) ?? [],
    event_position: input.latestEventPosition + 1,
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd e:\koko\frontend && npx vitest run tests/房间时间线测试.spec.ts`
Expected: ALL PASS，包括新增的带附件乐观消息测试和原有的纯文本乐观消息测试。

- [ ] **Step 6: Commit**

```
git add frontend/时间线/领域.ts frontend/tests/房间时间线测试.spec.ts
git commit -m "feat: 创建乐观房间消息支持附件元数据"
```

---

### Task 3: `sendMessage` 为媒体消息创建乐观消息

**Files:**
- Modify: `frontend/实时/应用.ts:259-271`
- Modify: `frontend/媒体/媒体草稿.ts`（Task 1 已完成）

- [ ] **Step 1: 在 `实时/应用.ts` 顶部增加新 import**

将：

```typescript
import { 提取可发送媒体附件标识 } from "../媒体/媒体草稿.js";
```

改为：

```typescript
import { 提取可发送媒体附件标识, 提取可发送媒体附件元数据 } from "../媒体/媒体草稿.js";
```

- [ ] **Step 2: 移除 `attachmentIds.length === 0` 门禁**

在 `frontend/实时/应用.ts` 中，将：

```typescript
    if (attachmentIds.length === 0) {
      deps.接收时间线事实({
        type: "OPTIMISTIC_MESSAGE_ADDED",
        message: 创建乐观房间消息({
          roomId: state.roomId,
          sessionId: state.sessionId,
          displayAlias: state.displayAlias,
          clientMessageId,
          text,
          latestEventPosition: state.latestEventPosition,
        }),
      });
    }
```

改为：

```typescript
    deps.接收时间线事实({
      type: "OPTIMISTIC_MESSAGE_ADDED",
      message: 创建乐观房间消息({
        roomId: state.roomId,
        sessionId: state.sessionId,
        displayAlias: state.displayAlias,
        clientMessageId,
        text,
        latestEventPosition: state.latestEventPosition,
        attachments: 提取可发送媒体附件元数据(state.composerMediaDrafts),
      }),
    });
```

- [ ] **Step 3: 运行全部前端测试确认无回归**

Run: `cd e:\koko\frontend && npx vitest run`
Expected: ALL PASS。原有架构守卫测试 `realtimeSource.toContain('type: "OPTIMISTIC_MESSAGE_ADDED"')` 仍然通过。

- [ ] **Step 4: Commit**

```
git add frontend/实时/应用.ts frontend/媒体/媒体草稿.ts
git commit -m "feat: 媒体消息也创建乐观消息实现发送秒见"
```

---

### Task 3.5: 发送者 complete 后预取 locator（消除发送者视频播放延迟）

**Files:**
- Modify: `frontend/媒体/媒体发布上传事件协作.ts:94-107`
- Modify: `frontend/媒体/播放会话/草稿发布.ts`（注入预取依赖）

**问题**: Phase 1 让乐观消息立即出现，但发送者的视频自动播放仍需 HTTP locator 请求（100-300ms），因为 `completeMediaUpload` 返回后 locator 未写入缓存。

**修复**: complete 成功后立即 fire-and-forget 调 `获取定位(attachmentId)`，预热缓存。用户点发送前 locator 已就绪。

- [ ] **Step 1: 在 `媒体发布上传事件协作.ts` 的依赖接口增加可选预取方法**

在 `frontend/媒体/媒体发布上传事件协作.ts` 的 `媒体上传事件接线依赖` 接口中追加：

```typescript
  预取媒体定位?(attachmentId: string): void;
```

- [ ] **Step 2: complete 成功后调用预取**

在 `处理媒体上传成功事件` 中，`deps.updateDraft(file.id, { ...status: "ready"... })` 之后追加：

```typescript
    deps.updateDraft(file.id, {
      kind: ready.kind,
      attachmentId: ready.attachment_id,
      width: ready.width,
      height: ready.height,
      status: "ready",
      errorCode: "",
    });
    // 预取 locator：用户还在看 composer，发送前缓存已热
    deps.预取媒体定位?.(ready.attachment_id);
```

- [ ] **Step 3: 在草稿发布接线中注入预取实现**

在 `frontend/媒体/播放会话/草稿发布.ts` 中创建上传事件接线依赖时，追加：

```typescript
    预取媒体定位: (attachmentId) => {
      // fire-and-forget: 调定位器获取定位，让 locator 进入缓存/inflight
      void deps.定位器?.获取定位(attachmentId).catch(() => {});
    },
```

`deps.定位器` 需要从依赖中传入。如果当前接线点无法直接访问定位器，则在合适的编排层注入。

- [ ] **Step 4: 运行测试**

Run: `cd e:\koko\frontend && npx vitest run`
Expected: ALL PASS。新增的可选方法不影响现有逻辑。

- [ ] **Step 5: Commit**

```
git add frontend/媒体/媒体发布上传事件协作.ts frontend/媒体/播放会话/草稿发布.ts
git commit -m "feat: complete后预取locator消除发送者视频播放延迟"
```

---

## Phase 4: 做种时序前移

### Task 4: sidecar 做种启动改为 fire-and-forget

**Files:**
- Modify: `src/媒体/上传/外壳/完成上传.rs:620-641`

- [ ] **Step 1: 将做种 `.await` 改为 `tokio::spawn`**

在 `src/媒体/上传/外壳/完成上传.rs` 中，将：

```rust
            if let Some(启动命令) =
                super::协作分发做种::从协作分发响应构造做种启动命令(
                    &runtime_distribution,
                    state.swarm_seeder_tracker_url.as_str(),
                )
            {
                if let Err(err) =
                    super::协作分发做种::尝试启动协作分发做种(&state, &启动命令).await
                {
                    tracing::warn!(
                        application = "完成媒体上传",
                        phase = "seed_start_failed",
                        attachment_id = attachment_id.as_str(),
                        info_hash = 启动命令.info_hash.as_str(),
                        error = %err,
                        "complete 成功后触发 sidecar 做种失败，等待后台对账重试"
                    );
                }
            }
```

改为：

```rust
            if let Some(启动命令) =
                super::协作分发做种::从协作分发响应构造做种启动命令(
                    &runtime_distribution,
                    state.swarm_seeder_tracker_url.as_str(),
                )
            {
                let spawn_state = state.clone();
                tokio::spawn(async move {
                    if let Err(err) =
                        super::协作分发做种::尝试启动协作分发做种(&spawn_state, &启动命令).await
                    {
                        tracing::warn!(
                            application = "完成媒体上传",
                            phase = "seed_start_failed",
                            info_hash = 启动命令.info_hash.as_str(),
                            error = %err,
                            "complete 成功后触发 sidecar 做种失败，等待后台对账重试"
                        );
                    }
                });
            }
```

注意：`state` 必须 `Clone`。检查 `应用状态` 是否实现了 `Clone`。如果没有，需要只克隆做种所需的最小字段（`swarm_seeder_control_base_url` 等）。

- [ ] **Step 2: 编译确认**

Run: `cd e:\koko && cargo check`
Expected: 无编译错误。如果 `应用状态` 未实现 `Clone`，需要调整 spawn 方式——提前提取 `swarm_seeder_control_base_url` 和 `swarm_seeder_tracker_url` 等所需字段为 owned String，在 spawn 闭包中使用这些值。

- [ ] **Step 3: 运行后端测试确认无回归**

Run: `cd e:\koko && cargo test`
Expected: ALL PASS。

- [ ] **Step 4: Commit**

```
git add src/媒体/上传/外壳/完成上传.rs
git commit -m "perf: sidecar做种改为fire-and-forget不再阻塞complete响应"
```

---

## Phase 2: 广播携带分发线索

### Task 5: 后端 contract 扩展 `附件分发线索`

**Files:**
- Modify: `src/共享/契约基础.rs`

- [ ] **Step 1: 在 `附件快照` 枚举之前增加分发线索结构体**

在 `src/共享/契约基础.rs` 中 `附件快照` 枚举定义之前追加：

```rust
/// 附件分发线索是可选投影字段，仅供广播时前端优化使用。
/// domain 层的消息成立校验不读取、不校验此字段。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 附件分发线索 {
    pub content_hash: String,
    pub swarm_id: String,
    pub torrent_info_hash: String,
    pub web_seed_until秒: i64,
}
```

- [ ] **Step 2: 为 `图片附件快照` 和 `视频附件快照` 增加可选分发线索字段**

在 `src/共享/契约基础.rs` 中，`图片附件快照` 增加：

```rust
pub struct 图片附件快照 {
    pub 附件标识: String,
    pub 宽: i32,
    pub 高: i32,
    pub 有预览图: bool,
    pub 分发线索: Option<附件分发线索>,
}
```

注意：当前 struct 没有 `mime_type` 字段，不要加。

`视频附件快照` 同理增加 `pub 分发线索: Option<附件分发线索>`。

- [ ] **Step 3: 更新所有构造 `附件快照` 的位置**

搜索 `图片附件快照 {` 和 `视频附件快照 {` 的所有构造点，补上 `分发线索: None`。这些点至少包括：
- `src/消息/适配.rs` — 从 DB 行构造附件快照
- `src/房间/适配.rs` — 从 DB 行构造附件快照
- 测试文件中的构造点

对于 `src/消息/适配.rs`，Phase 2 Task 6 会改成从 DB 读取真实值；此步先全部填 `None` 保证编译通过。

- [ ] **Step 4: 编译确认**

Run: `cd e:\koko && cargo check`
Expected: 无编译错误。

- [ ] **Step 5: Commit**

```
git add src/共享/契约基础.rs src/消息/适配.rs src/房间/适配.rs
git commit -m "feat: contract附件快照增加可选分发线索字段"
```

---

### Task 6: 后端附件查询 JOIN 分发表

**Files:**
- Modify: `src/消息/适配.rs` — `创建消息_异步` 路径的附件查询

- [ ] **Step 1: 在 `提交统一消息事件_异步` 的 `tx.commit()` 之后追加分发线索查询**

在 `src/消息/适配.rs` 中，`提交统一消息事件_异步` 函数的 `tx.commit().await` 和 `Ok(contract::领域事件::消息已创建 { ... })` 之间，插入一次额外查询：

```rust
    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;

    // Phase 2: 为 realtime 广播路径丰富分发线索（不改 domain 类型）
    let 附件标识列表: Vec<&str> = 附件.iter().map(|a| match a {
        domain::message::已校验附件引用::图片 { 附件标识, .. }
        | domain::message::已校验附件引用::视频 { 附件标识, .. } => 附件标识.as_str(),
    }).collect();
    let 分发线索映射 = 查询附件分发线索批量_异步(pool, &附件标识列表).await.unwrap_or_default();

    Ok(contract::领域事件::消息已创建 {
        // ...原有字段
        附件: 附件.iter().map(|a| {
            let mut snapshot = 已校验附件转契约快照(a);
            let aid = match a {
                domain::message::已校验附件引用::图片 { 附件标识, .. }
                | domain::message::已校验附件引用::视频 { 附件标识, .. } => 附件标识.as_str(),
            };
            if let Some(hint) = 分发线索映射.get(aid) {
                match &mut snapshot {
                    contract::附件快照::图片(img) => img.分发线索 = Some(hint.clone()),
                    contract::附件快照::视频(vid) => vid.分发线索 = Some(hint.clone()),
                }
            }
            snapshot
        }).collect(),
        事件位置: next_position,
    })
```

- [ ] **Step 2: 新增 `查询附件分发线索批量_异步` 函数**

在 `src/消息/适配.rs` 中新增：

```rust
async fn 查询附件分发线索批量_异步(
    pool: &PgPool,
    附件标识列表: &[&str],
) -> Result<HashMap<String, contract::附件分发线索>, contract::错误码> {
    if 附件标识列表.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query(
        "SELECT a.attachment_id, \
                d.content_hash, d.swarm_id, \
                t.info_hash AS torrent_info_hash, \
                d.web_seed_until_epoch_seconds \
         FROM attachments a \
         JOIN media_attachment_distributions d ON d.attachment_id = a.id \
         LEFT JOIN media_attachment_torrent_meta t ON t.attachment_id = a.id \
         WHERE a.attachment_id = ANY($1)"
    )
    .bind(
        附件标识列表.iter().map(|s| s.to_string()).collect::<Vec<_>>()
    )
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let mut map = HashMap::new();
    for row in rows {
        let attachment_id: String = row.get("attachment_id");
        let content_hash: Option<String> = row.get("content_hash");
        let swarm_id: Option<String> = row.get("swarm_id");
        let torrent_info_hash: Option<String> = row.get("torrent_info_hash");
        let web_seed_until: Option<i64> = row.get("web_seed_until_epoch_seconds");
        if let (Some(ch), Some(si), Some(ih), Some(ws)) =
            (content_hash, swarm_id, torrent_info_hash, web_seed_until)
        {
            if !ih.is_empty() {
                map.insert(attachment_id, contract::附件分发线索 {
                    content_hash: ch,
                    swarm_id: si,
                    torrent_info_hash: ih,
                    web_seed_until秒: ws,
                });
            }
        }
    }
    Ok(map)
}
```

注意：SQL 中的表名和列名需要根据实际 schema 确认。上述 SQL 假设：
- `media_attachment_distributions` 表有 `attachment_id`（FK to `attachments.id`）、`content_hash`、`swarm_id`、`web_seed_until_epoch_seconds`
- `media_attachment_torrent_meta` 表有 `attachment_id`（FK）、`info_hash`

- [ ] **Step 3: 编译 + 测试**

Run: `cd e:\koko && cargo check && cargo test`
Expected: ALL PASS。

- [ ] **Step 4: Commit**

```
git add src/消息/适配.rs
git commit -m "feat: realtime附件查询JOIN分发表填充分发线索"
```

---

### Task 7: 后端序列化分发线索到 `room_event`

**Files:**
- Modify: `src/外壳/协议响应.rs:33-67`

- [ ] **Step 1: 修改 `attachments_to_json()` 序列化逻辑**

在 `src/外壳/协议响应.rs` 中，为 `图片` 和 `视频` 分支增加分发线索序列化。

对于视频分支，将：

```rust
contract::附件快照::视频(video) => {
    let mut payload = serde_json::json!({
        "kind": "video",
        "attachment_id": video.附件标识,
        "width": video.宽,
        "height": video.高,
        "has_preview_asset": video.有预览图
    });
    // ... preview_asset 逻辑
    payload
}
```

改为：

```rust
contract::附件快照::视频(video) => {
    let mut payload = serde_json::json!({
        "kind": "video",
        "attachment_id": video.附件标识,
        "width": video.宽,
        "height": video.高,
        "has_preview_asset": video.有预览图
    });
    if let Some(ref hint) = video.分发线索 {
        payload["distribution_hint"] = serde_json::json!({
            "content_hash": hint.content_hash,
            "swarm_id": hint.swarm_id,
            "torrent_info_hash": hint.torrent_info_hash,
            "web_seed_until": hint.web_seed_until秒,
        });
    }
    // ... preview_asset 逻辑
    payload
}
```

图片分支同理（图片虽然当前不走 swarm，但预留字段保持一致性）。

- [ ] **Step 2: 更新现有测试**

找到 `协议响应.rs` 中的 `room_event在无会话上下文时仍会带出附件是否有静态封面的稳定事实()` 等测试，确保新字段在 `分发线索: None` 时不影响输出。

- [ ] **Step 3: 新增测试——分发线索存在时输出 `distribution_hint`**

```rust
#[test]
fn room_event附件携带分发线索时输出distribution_hint() {
    let payload = crate::shell::协议响应::event_to_json(
        contract::领域事件::消息已创建 {
            房间标识: "room-1".to_string(),
            消息标识: "msg-1".to_string(),
            客户端消息标识: "client-1".to_string(),
            发送者会话标识: "s-1".to_string(),
            发送者花名: "测试".to_string(),
            文本: "".to_string(),
            附件: vec![contract::附件快照::视频(contract::视频附件快照 {
                附件标识: "att-v1".to_string(),
                宽: 1920,
                高: 1080,
                mime_type: "video/mp4".to_string(),
                有预览图: false,
                分发线索: Some(contract::附件分发线索 {
                    content_hash: "hash123".to_string(),
                    swarm_id: "swarm123".to_string(),
                    torrent_info_hash: "ih123".to_string(),
                    web_seed_until秒: 1715500000,
                }),
            })],
            事件位置: 1,
        },
        None,
    );
    let hint = &payload["attachments"][0]["distribution_hint"];
    assert_eq!(hint["torrent_info_hash"], "ih123");
    assert_eq!(hint["swarm_id"], "swarm123");
}
```

- [ ] **Step 4: 运行测试**

Run: `cd e:\koko && cargo test`
Expected: ALL PASS。

- [ ] **Step 5: Commit**

```
git add src/外壳/协议响应.rs
git commit -m "feat: room_event附件序列化携带distribution_hint"
```

---

### Task 8: 前端契约类型增加 `distribution_hint`

**Files:**
- Modify: `frontend/聊天共享/契约.ts:91-113`

- [ ] **Step 1: 为附件快照类型增加可选 `distribution_hint`**

在 `frontend/聊天共享/契约.ts` 中，将：

```typescript
export interface 图片附件快照 {
  kind: "image";
  attachment_id: string;
  width: number;
  height: number;
  has_preview_asset?: boolean;
  preview_asset?: 预览资源描述 | null;
}
```

改为：

```typescript
export interface 附件分发线索 {
  content_hash: string;
  swarm_id: string;
  torrent_info_hash: string;
  web_seed_until: number;
}

export interface 图片附件快照 {
  kind: "image";
  attachment_id: string;
  width: number;
  height: number;
  has_preview_asset?: boolean;
  preview_asset?: 预览资源描述 | null;
  distribution_hint?: 附件分发线索 | null;
}
```

`视频附件快照` 同理增加 `distribution_hint?: 附件分发线索 | null`。

- [ ] **Step 2: 运行前端测试确认无回归**

Run: `cd e:\koko\frontend && npx vitest run`
Expected: ALL PASS。新增的可选字段不破坏现有类型。

- [ ] **Step 3: Commit**

```
git add frontend/聊天共享/契约.ts
git commit -m "feat: 前端附件快照契约增加distribution_hint类型"
```

---

## Phase 3: swarm 预热

### Task 9: 接收端 Eager Locator Pre-fetch

> **设计变更说明**：原方案"预写入 partial stale locator"已废弃。
> 原因：partial locator 缺少 `join_ticket` 和 `announce_urls`，无法实现 tracker 预热；
> 且 stale cache 在 `获取定位()` 中的行为与 cache miss 完全相同——都是直接发 HTTP 请求。
> 因此 partial locator 代码量不小但实际效果为零。
>
> 新方案：**直接调现有 `获取定位()`** 做后台 pre-fetch。
> 利用 `inflight` 去重机制（`媒体定位.ts:330-332`），自动播触发时 piggyback 已发出的请求。
> 不碰 `媒体定位器` 内部结构，不新增方法，只在壳层编排层追加一次 fire-and-forget 调用。

**Files:**
- Modify: `frontend/媒体/播放会话/应用.ts:600-605`

- [ ] **Step 1: 在 `接收消息附件同步` 中追加 eager pre-fetch**

在 `frontend/媒体/播放会话/应用.ts` 中，找到 `接收消息附件同步` 处理函数。当前实现：

```typescript
    接收消息附件同步: (input) => {
      接收媒体运行时事实({
        type: "MESSAGE_ATTACHMENTS_SYNCED",
        attachmentIds: input.attachmentIds,
        positionRetentionAttachmentIds: input.positionRetentionAttachmentIds,
      });
    },
```

改为：

```typescript
    接收消息附件同步: (input) => {
      接收媒体运行时事实({
        type: "MESSAGE_ATTACHMENTS_SYNCED",
        attachmentIds: input.attachmentIds,
        positionRetentionAttachmentIds: input.positionRetentionAttachmentIds,
      });
      // Phase 3: 含 distribution_hint 的视频附件 → eager pre-fetch locator
      // 利用 inflight 去重：自动播后续调 获取定位() 时 piggyback 此请求
      if (input.eagerPrefetchAttachmentIds) {
        for (const attachmentId of input.eagerPrefetchAttachmentIds) {
          void 定位器.获取定位(attachmentId).catch(() => {});
        }
      }
    },
```

注意：不传 `distributionHints` 对象（用不上），只传需要 pre-fetch 的 `attachmentId` 列表。

- [ ] **Step 2: 更新 `窗口会话协作.ts` 传入 `eagerPrefetchAttachmentIds`**

修改 `接收消息附件同步` 的接口类型（`frontend/媒体/壳层/窗口会话协作.ts:29-32`），将：

```typescript
  接收消息附件同步(input: {
    attachmentIds: string[];
    positionRetentionAttachmentIds: string[];
  }): void;
```

改为：

```typescript
  接收消息附件同步(input: {
    attachmentIds: string[];
    positionRetentionAttachmentIds: string[];
    eagerPrefetchAttachmentIds?: string[];
  }): void;
```

修改调用点（`窗口会话协作.ts:144-147`），从消息附件中筛选含 `distribution_hint` 的视频附件 ID：

```typescript
      const eagerPrefetchAttachmentIds: string[] = [];
      for (const item of activeWindowAttachments) {
        if (item.kind === "video" && item.distributionHint) {
          eagerPrefetchAttachmentIds.push(item.attachmentId);
        }
      }
      deps.接收消息附件同步({
        attachmentIds: Array.from(activeAttachmentIds),
        positionRetentionAttachmentIds: attachments.map((item) => item.attachmentId),
        eagerPrefetchAttachmentIds: eagerPrefetchAttachmentIds.length > 0
          ? eagerPrefetchAttachmentIds.slice(0, 2)  // 上限 2 条，复用现有预热候选上限
          : undefined,
      });
```

`item.distributionHint` 需要从时间线消息的 `attachments[].distribution_hint` 映射到 `媒体附件条目`。
具体实现：在 `读取当前活跃媒体窗口附件()` 返回的 `媒体附件条目` 中增加一个可选 `distributionHint` 布尔标志，
由上游从 `消息事件.attachments` 的 `distribution_hint` 字段推导。

- [ ] **Step 3: 运行测试确认无回归**

Run: `cd e:\koko\frontend && npx vitest run`
Expected: ALL PASS。

- [ ] **Step 4: Commit**

```
git add frontend/媒体/播放会话/应用.ts
git commit -m "feat: 消息到达时预写入分发线索到locator缓存实现swarm预热"
```

---

## 验收烟测

### Task 11: 端到端验收

- [ ] **Step 1: 启动后端和前端**
- [ ] **Step 2: 在群聊中发送一个视频**
- [ ] **Step 3: 验证发送者秒见**
  - 点发送后消息 **立即出现** 在时间线（不等 socket roundtrip）
  - 附件占位正确显示（有宽高，有预览/loading 状态）
- [ ] **Step 4: 验证接收者秒见**
  - 另一个浏览器标签页中，消息出现延迟 < 1s
- [ ] **Step 5: 验证自动播放**
  - 接收者看到视频消息后，自动播放在 2s 内开始
- [ ] **Step 6: 验证乐观消息替换无闪烁**
  - 发送者的乐观消息被权威消息替换时，视频附件不重新加载、不闪烁
- [ ] **Step 7: 验证 sidecar 做种**
  - 后端日志中 `complete_heavy_work_exit` 时间不再包含 sidecar 等待时间
  - `seed_start_failed` 如果出现，是在 spawn 任务中异步记录的

---

## 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| `应用状态` 未实现 `Clone`（Task 4） | 编译失败 | 改为提取所需字段为 owned 值再 spawn |
| 附件查询 JOIN 性能（Task 6） | realtime 消息创建变慢 | LEFT JOIN 只在 realtime 路径使用，附件通常 1-3 个 |
| Eager pre-fetch 浪费（Task 9） | 预取了用户不看的视频 | 上限 2 条 + 只预取含 distribution_hint 的视频 |
| 乐观消息 attachments 缺 preview（Task 3） | 乐观态无视频封面 | `has_preview_asset` 可选，权威消息到达后补上（~200ms） |
| 乐观消息 attachments 与权威消息不完全一致（Task 3） | 渲染抖动 | `attachment_id` 一致即可，`选择更可信消息` 保证权威替换 |
| 草稿发布接线中注入定位器依赖（Task 3.5） | 依赖链可能较深 | 如无法直接注入，退到在编排协调器层调用 |
| Phase 2 SQL 表名/列名假设（Task 6） | SQL 查询失败 | 实施前必须确认实际 schema |
