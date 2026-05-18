# 实时附件升级事件 WebTorrent 即时预热修复设计

日期：2026-05-18
状态：Design / Ready for owner review

关联：

- `docs/superpowers/specs/2026-05-18-实时视频秒发秒出-做种竞态与火力全开修复-design.md`
- `docs/superpowers/specs/2026-05-17-realtime-video-autoplay-webtorrent-handoff-design.md`
- `frontend/实时/应用.ts`
- `frontend/应用根/聊天应用内核.ts`
- `frontend/媒体/播放会话/应用.ts`
- `frontend/时间线/运行时.ts`
- `frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts`

---

## 1. 一句话结论

后端强种子竞态和服务端 WebTorrent 火力问题已经在当前源码里有修复痕迹，但实时附件 `ready` 升级事件仍缺少即时 WebTorrent 预热副作用。

正确修复不是引入直链、HLS、CDN 或第二播放链，而是让 `attachment_status_changed` 携带丰富 `distribution_hint` 时复用既有 `预热权威消息媒体分发` 能力，立即写入 locator 缓存并以 prefetch 消费者加入 swarm。

---

## 2. 前因后果

### 2.1 用户现象

万人群聊里，用户 A 发送视频后：

1. B/C/D 能马上看到一个视频卡片；
2. 卡片长时间黑灰占位；
3. 自动播放迟迟不启动；
4. 点全屏后仍一卡一卡；
5. 刷新页面后视频反而能秒出、秒播。

这说明问题不在“文件不存在”或“magnet 永久失效”。刷新后可播意味着 canonical 文件、torrent 元信息、tracker 和基础播放链大概率是通的。断点更可能发生在**实时消息到达后的热路径**。

### 2.2 已完成的上一层修复

`2026-05-18-实时视频秒发秒出-做种竞态与火力全开修复-design.md` 已覆盖后端两类根因：

1. `complete_media_upload` 原来可能让做种和广播并行赛跑，导致广播快于 dev-seeder 入群；
2. `frontend/dev-seeder.mjs` 原来使用 WebTorrent 默认小客户端参数，不适合作为万人群第一颗强种子。

当前源码已经能看到对应修复：

- `complete_media_upload` 中先带 5 秒兜底调用 `尝试启动协作分发做种`，再广播 `attachment_status_changed`；
- `frontend/dev-seeder.mjs` 已设置 `maxConns: 512`、`seedOutgoingConnections: true`、不限速、`skipVerify`、`uploads: 64`、`storeCacheSlots: 500`。

这层修复解决的是“服务器有没有先点火”。本 spec 处理的是下一层：**接收端收到火种后有没有立刻加入 swarm**。

---

## 3. 当前源码事实

### 3.1 实时升级事件路径只更新时间线

`frontend/实时/应用.ts` 收到 `room_event` 后，如果事件类型是 `attachment_status_changed`，当前逻辑会：

1. 发送 `ATTACHMENT_STATUS_UPGRADED` 到时间线；
2. 把 `status`、`distribution_hint`、`has_preview_asset`、`preview_asset` 合入附件槽位；
3. 直接 `return`。

也就是说，这条路径只更新“消息卡片现在 ready 了”的投影事实，没有触发媒体预热。

### 3.2 权威消息事件路径已经有即时预热

`frontend/应用根/聊天应用内核.ts` 的 `接收权威事件后副作用` 会在权威消息事件追加后调用：

```text
this.媒体编排.预热权威消息媒体分发(events, currentSessionId)
```

`frontend/媒体/播放会话/应用.ts` 的 `预热权威消息媒体分发` 已经做了正确的事情：

1. 遍历事件附件；
2. 找到 `distribution_hint`；
3. 如果 hint 里有 `join_ticket` 和 `announce_urls`，写入 locator 缓存；
4. 立即调用协作分发应用，以 `prefetch:<attachmentId>` 消费者接入 swarm；
5. prefetch 失败不阻塞 UI，后续 viewport sync / autoplay 仍会重试。

这正是实时视频秒出的关键“提前入群”能力。

### 3.3 断裂点

新消息权威事件会触发预热，附件 ready 升级事件不会触发预热。

而 pending-first 上传链路下，接收者经常先看到 prepared / processing 附件槽位，随后通过 `attachment_status_changed` 收到 ready + `distribution_hint`。如果这次升级事件不触发 prefetch，前端就只能等渲染、可见性、自动播候选或用户点击后再被动接入 WebTorrent。

这会造成产品体感：

```text
后端已经强种子点火
  -> 房间广播已经带了 join_ticket / announce_urls
  -> 前端只把 hint 写进时间线
  -> 没有立即加入 swarm
  -> 卡片黑灰占位
  -> 刷新后走快照/权威事件路径，反而更快
```

---

## 4. 产品目标

用户不应该知道附件从 `prepared` 升级到 `ready`，也不应该感知 WebTorrent 入群时机。

目标体验：

```text
A 发视频
  -> B/C/D 看到卡片时，客户端已经开始加入 swarm
  -> 自动播候选接管时复用已建立的 WebTorrent 会话
  -> 画面自然揭开，不出现长时间黑灰占位
```

这个修复的产品标准不是“最终能播”，而是“实时 ready 信号抵达时立即为播放做准备”。

---

## 5. 设计原则

1. **纯 WebTorrent 主链**：正式媒体字节仍来自 WebTorrent `file.streamURL` / swarm 机制，不引入原文件直链、HLS、DASH、CDN 或 range 旁路。
2. **复用现有 owner**：不在实时层实现媒体逻辑。实时层只把“附件 ready 且有 hint”的事实交给媒体编排 owner。
3. **升级事件等价于可预热事件**：只要 `attachment_status_changed` 携带 ready 附件和 `distribution_hint`，它就应像权威消息事件一样触发预热。
4. **不阻塞实时事件处理**：预热是异步副作用，失败只记录调试信号，不影响时间线状态更新。
5. **去重靠既有 inflight/session 机制**：不要新增第二套去重状态。既有 `预热权威消息媒体分发` 和协作分发运行时已经承担去重与复用。

---

## 6. 修复方案

### 6.1 抽出媒体编排入口：按附件列表预热

在媒体编排 owner 内抽出一个更窄的入口，例如 `预热附件分发线索(attachments, currentSessionId)`。既有 `预热权威消息媒体分发(events, currentSessionId)` 只负责从权威消息事件里取出附件，然后调用这个新入口。

这样附件 ready 升级事件可以直接把自己的附件快照交给媒体编排，不需要伪造完整 `消息事件`，也不会让空的 `sender_session_id`、`client_message_id` 等字段制造假业务语义。

伪代码：

```ts
预热附件分发线索(attachments: 附件快照[], currentSessionId: string): void {
  for (const attachment of attachments) {
    // 复用原 预热权威消息媒体分发 内部逻辑：
    // 有丰富 hint 时写 locator 缓存并以 prefetch 消费者加入 swarm；
    // 无运行态字段时走 locator HTTP 预热。
  }
}

预热权威消息媒体分发(events: 消息事件[], currentSessionId: string): void {
  this.预热附件分发线索(events.flatMap((event) => event.attachments ?? []), currentSessionId);
}
```

### 6.2 新增应用内核入口：预热单个附件升级

在应用根层增加一个很薄的适配方法，过滤 ready + hint 后直接调用媒体编排的附件级预热入口。

伪代码：

```ts
private 预热附件升级媒体分发(event: 附件状态变更事件): void {
  const attachment = event.attachment;
  if (event.status !== "ready" || !attachment?.distribution_hint) {
    return;
  }
  const currentSessionId = this.回填房间壳补丁().sessionId;
  this.媒体编排.预热附件分发线索([attachment], currentSessionId);
}
```

这不是制造新业务入口，而是把“附件 ready 升级”投影成媒体编排已经理解的附件输入格式。

### 6.3 实时层依赖增加副作用回调

`frontend/实时/应用.ts` 当前收到 `attachment_status_changed` 后只调用 `deps.接收时间线事实`。修复后应在时间线事实写入之后、`return` 之前调用一个应用层副作用：

```ts
deps.接收附件升级后副作用?.(event);
```

命名不应带 WebTorrent 细节。实时层不关心媒体如何预热，只知道“附件升级后有应用副作用需要执行”。

### 6.4 依赖工厂桥接到应用内核

`聊天应用内核` 创建实时编排依赖时，把 `接收附件升级后副作用` 连接到 `预热附件升级媒体分发`。

边界保持：

```text
实时 adapter
  -> 时间线事实 owner
  -> 应用内核副作用编排
  -> 媒体编排 owner
  -> 协作分发应用 / WebTorrent runtime
```

不允许：

```text
实时 adapter 直接 import WebTorrent / 媒体协作分发 runtime
```

---

## 7. TDD 设计

### 7.1 RED：附件升级事件携带丰富 hint 时必须即时预热

新增或扩展测试，模拟：

1. 当前房间已有一条 prepared 视频附件；
2. socket 收到 `attachment_status_changed`；
3. `event.attachment.distribution_hint` 包含 `join_ticket`、`announce_urls`、`torrent_url`；
4. 断言媒体编排出现 `[SWARM_IMMEDIATE_JOIN]` 或对应协作分发 prefetch 调用。

推荐测试位置：

- `frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts`：扩展媒体编排层用例；
- 或新增 `frontend/tests/聊天媒体编排/附件升级预热测试.spec.ts`：更聚焦，不污染既有权威事件测试。

### 7.2 GREEN：只接通既有预热，不新增第二套逻辑

实现时只做桥接：

1. 增加依赖字段；
2. 实时事件命中 `attachment_status_changed` 后调用依赖；
3. 应用内核把附件升级事件转成单附件 `消息事件`；
4. 复用 `预热权威消息媒体分发`。

### 7.3 REFACTOR：收口命名与测试夹具

如果测试需要构造丰富 hint，抽一个测试内 helper：

```ts
const 构造丰富分发线索 = (attachmentId: string) => ({
  content_hash: `hash-${attachmentId}`,
  swarm_id: `swarm-${attachmentId}`,
  torrent_info_hash: `ih-${attachmentId}`,
  web_seed_until: 9999999999,
  join_ticket: "test-ticket",
  announce_urls: ["wss://tracker.example.test/announce"],
  torrent_url: `/api/media/${attachmentId}/torrent?ticket=test-ticket`,
  web_seed_url: null,
  ice_servers: [],
});
```

不要在生产代码里新增测试专用分支。

---

## 8. 验证计划

1. `pnpm test -- 聊天媒体编排` 或项目等价前端测试命令：证明 `attachment_status_changed` 会触发即时预热。
2. 相关实时编排测试：证明普通非附件事件不受影响。
3. 媒体协作分发测试：证明 prefetch 消费者仍复用既有去重机制，不重复创建无界 torrent。
4. 浏览器冒烟：两个账号在 `https://kokoqun.com` 同房间，A 发视频，B 不刷新，观察控制台出现 `MEDIA_HINT_INGESTED` / `SWARM_IMMEDIATE_JOIN`，视频卡片黑灰时间应明显缩短。
5. 回归验证：刷新页面后历史消息仍能自动播，说明快照路径未被破坏。

---

## 9. 不做的事

1. 不改 WebTorrent 正式播放主链。
2. 不新增 HTTP 原文件直链作为播放源。
3. 不把媒体预热逻辑塞进实时 adapter。
4. 不新增第二套 WebTorrent client。
5. 不改 dev-seeder 参数，服务端强种子火力已由上一份 spec 覆盖。
6. 不为失败 prefetch 弹 UI 错误；它只是性能预热，正式播放链仍负责可见失败表达。

---

## 10. 风险与约束

### 10.1 重复预热风险

同一附件可能同时通过权威消息事件和附件升级事件触发预热。接受这个事实，不新增复杂状态。既有协作分发运行时应按 `attachmentId` / `consumerId` / torrent 会话复用收口。

### 10.2 无 hint 或非 ready 事件

`failed`、`processing`、无 `distribution_hint` 的升级事件只更新时间线，不触发预热。

### 10.3 发送者自身

发送者和接收者都应走同一预热路径。不要用 `sender_session_id !== currentSessionId` 跳过发送者，因为当前项目目标是“发送者不慢于接收者”。

### 10.4 Cloudflare / WebSocket 断线

如果实时事件没到，刷新/恢复路径仍应兜底。这个 spec 只修复“事件已到但没有即时预热”的断点。

---

## 11. 成功标准

1. `attachment_status_changed` 携带 ready + 丰富 `distribution_hint` 时，前端立即触发媒体预热。
2. 预热复用 `预热权威消息媒体分发`，没有第二套 WebTorrent 逻辑。
3. 生产代码没有引入 HLS/CDN/range/原文件 URL 播放旁路。
4. 自动测试能证明升级事件路径和权威消息事件路径都能预热。
5. 公网冒烟中，不刷新页面也能观察到接收者实时加入 swarm，黑灰占位时间明显下降。

---

## 12. 自审记录

### 第一遍：需求意图

本 spec 聚焦用户描述的“实时看到黑灰占位，刷新后秒出”。上一份后端 spec 已解决服务器点火，本 spec 补齐接收端实时 ready 升级事件没有即时入群的问题。通过。

### 第二遍：架构边界

实时层只发布附件升级后的应用副作用，不直接依赖媒体/WebTorrent；应用内核负责桥接；媒体编排继续拥有预热和协作分发逻辑。没有破坏 Onion / adapter 边界。通过。

### 第三遍：执行路径与验证闭环

RED 测试能先证明当前缺口；GREEN 只桥接现有预热入口；验证包含前端单测、实时编排回归、浏览器公网冒烟。没有占位符、没有“后续再说”。通过。

### 100% 自信循环

当前设计不新增播放主链、不改变后端强种子、不制造第二套 WebTorrent 状态，只把已存在且已测试的预热能力接到漏掉的实时升级入口。主要风险是重复预热，但既有 prefetch/inflight/session 机制就是为重复触发设计的，测试应覆盖“不重复创建无界会话”。基于现有证据，对这个 spec 作为下一步实现依据有事实层面的充分信心。
