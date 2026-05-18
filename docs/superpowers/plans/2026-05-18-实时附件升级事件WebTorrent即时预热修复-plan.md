# 实时附件升级事件 WebTorrent 即时预热修复 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。

**目标：** 让 `attachment_status_changed` ready 升级事件携带丰富 `distribution_hint` 时，前端立即复用既有媒体预热入口加入 WebTorrent swarm，减少实时视频黑灰占位。
**架构：** 实时 adapter 只分发附件升级后的应用副作用；应用内核把附件升级事件包装成既有媒体编排能消费的单附件权威事件；媒体编排继续拥有 locator 缓存、prefetch 消费者和 WebTorrent runtime。
**技术栈：** TypeScript / XState / Socket.IO client / WebTorrent browser `createServer` + Service Worker / Video.js v10 autoplay Promise。
**设计文档：** `docs/superpowers/specs/2026-05-18-实时附件升级事件WebTorrent即时预热修复-design.md`

---

## 0. 资料依据

1. **WebTorrent 官方依据**：浏览器播放应通过 `client.createServer({ controller })` 让 Service Worker 服务 torrent 文件，再使用 `file.streamURL` 或 `file.streamTo(video)`。本计划只提前加入 swarm，不把原文件 URL 塞给 `<video>`。
2. **Video.js v10 依据**：自动播放必须处理 `player.play()` Promise；`autoplay: "muted"` / muted autoplay 成功率最高。预热只准备 source，不声明播放已成功。
3. **Chrome / MDN 依据**：muted autoplay 通常允许；非静音自动播放可能被拒；UI 状态应以 `play()` Promise / 首帧事实为准，而不是以“已经收到 ready 事件”为准。
4. **项目边界依据**：`frontend/媒体/播放会话/应用.ts` 已有 `预热权威消息媒体分发`，它会在丰富 hint 下写 locator 缓存并以 `prefetch:<aid>` 立即接入 swarm。实现必须复用它，禁止新造第二套 WebTorrent 预热逻辑。

---

## 1. 文件清单

| 文件 | 职责 | 操作 |
|---|---|---|
| `frontend/实时/应用.ts` | Socket.IO 事件转应用事实与副作用 | 修改：给 `attachment_status_changed` 增加可选副作用回调 |
| `frontend/应用根/聊天应用编排依赖工厂.ts` | 创建实时/恢复/阅读等编排依赖 | 修改：传入附件升级后副作用依赖 |
| `frontend/应用根/聊天应用内核.ts` | 应用副作用编排 owner | 修改：新增薄方法，把附件升级事件转给媒体编排预热 |
| `frontend/媒体/播放会话/应用.ts` | 媒体编排 owner | 修改：抽出附件级预热入口，权威事件和附件升级事件共用 |
| `frontend/聊天共享/契约.ts` | 共享事件/附件类型 | 只读：复用 `附件状态变更事件`、`消息事件` 类型 |
| `frontend/tests/聊天媒体编排/附件升级预热测试.spec.ts` | 新增 RED/GREEN 测试 | 创建：证明 ready 升级事件会触发即时预热 |

---

## 2. 成功标准

1. 收到 `attachment_status_changed` 且 `status === "ready"` 且附件携带 `distribution_hint.join_ticket + announce_urls` 时，立即触发现有媒体预热逻辑抽出的 `预热附件分发线索`。
2. 实时 adapter 不 import WebTorrent、不 import 媒体协作分发 runtime。
3. 无 hint、非 ready、failed/processing 升级事件只更新时间线，不触发预热。
4. 重复事件不新增第二套状态；继续依赖既有 media prefetch/inflight/session 去重。
5. 自动测试先红后绿，相关前端测试通过。

---

## 3. 任务 1：RED 测试 - 附件 ready 升级事件触发媒体预热

### 文件

- 创建：`frontend/tests/聊天媒体编排/附件升级预热测试.spec.ts`

### 步骤

**1.1 创建测试文件**

新增测试，直接覆盖应用内核与实时编排依赖之间的行为。测试不应真实启动 WebTorrent，只 spy 媒体编排的预热入口或观察 `console.debug("[SWARM_IMMEDIATE_JOIN]")`。

建议使用现有测试支撑方式；如果直接构造完整 `聊天应用内核` 成本过高，则先在较薄的依赖工厂层测试：模拟 `attachment_status_changed` 输入，断言注入的 `接收附件升级后副作用` 被调用，随后在内核单测验证该副作用会调用 `媒体编排.预热附件分发线索`。

测试核心形状：

```ts
import { describe, expect, it, vi } from "vitest";
import type { 附件状态变更事件 } from "../../聊天共享/契约";

const 构造附件升级事件 = (): 附件状态变更事件 => ({
  type: "attachment_status_changed",
  room_id: "room-1",
  message_id: "msg-1",
  attachment_id: "att-video-1",
  status: "ready",
  event_position: 12,
  attachment: {
    kind: "video",
    attachment_id: "att-video-1",
    width: 1920,
    height: 1080,
    status: "ready",
    has_preview_asset: false,
    distribution_hint: {
      content_hash: "hash-att-video-1",
      swarm_id: "swarm-att-video-1",
      torrent_info_hash: "ih-att-video-1",
      web_seed_until: 9999999999,
      join_ticket: "test-ticket",
      announce_urls: ["wss://tracker.example.test/announce"],
      torrent_url: "/api/media/att-video-1/torrent?ticket=test-ticket",
      web_seed_url: null,
      ice_servers: [],
    },
  },
});
```

断言目标：

```ts
expect(预热附件分发线索).toHaveBeenCalledTimes(1);
expect(预热附件分发线索).toHaveBeenCalledWith(
  [
    expect.objectContaining({
      attachment_id: "att-video-1",
      distribution_hint: expect.objectContaining({
        join_ticket: "test-ticket",
        announce_urls: ["wss://tracker.example.test/announce"],
      }),
    }),
  ],
  expect.any(String)
);
```

**1.2 增加负向用例**

同文件加入两个负向用例：

```ts
it("无 distribution_hint 的 ready 升级不触发预热", () => {
  const event = 构造附件升级事件();
  delete event.attachment!.distribution_hint;
  // 派发后 expect(预热附件分发线索).not.toHaveBeenCalled()
});

it("failed 升级不触发预热", () => {
  const event = 构造附件升级事件();
  event.status = "failed";
  event.attachment!.status = "failed";
  // 派发后 expect(预热附件分发线索).not.toHaveBeenCalled()
});
```

### 验证

```bash
pnpm test -- 附件升级预热
```

预期：测试失败，错误指向当前没有附件升级后媒体预热副作用。

### 提交

暂不提交；RED 测试和 GREEN 实现一起在任务 3 后提交，避免仓库停在失败测试状态。

---

## 4. 任务 2：实时层增加附件升级后副作用依赖

### 文件

- 修改：`frontend/实时/应用.ts`

### 步骤

**2.1 扩展实时应用依赖类型**

找到实时应用依赖接口中已有的 `接收时间线事实`、`接收实时会话事实` 等字段，新增可选回调：

```ts
接收附件升级后副作用?: (event: 附件状态变更事件) => void;
```

如当前文件没有直接 import `附件状态变更事件`，从 `frontend/聊天共享/契约.ts` 增加 type import。

**2.2 在 `attachment_status_changed` 分支调用副作用**

当前逻辑是更新 timeline 后 `return`。改成：

```ts
if (event.type === "attachment_status_changed") {
  deps.接收时间线事实({
    type: "ATTACHMENT_STATUS_UPGRADED",
    messageId: event.message_id,
    attachmentId: event.attachment_id,
    patch: {
      status: event.status,
      ...(event.attachment?.distribution_hint
        ? { distribution_hint: event.attachment.distribution_hint }
        : {}),
      ...(event.attachment?.has_preview_asset !== undefined
        ? { has_preview_asset: event.attachment.has_preview_asset }
        : {}),
      ...(event.attachment?.preview_asset !== undefined
        ? { preview_asset: event.attachment.preview_asset }
        : {}),
    },
  });
  deps.接收附件升级后副作用?.(event);
  return;
}
```

顺序必须是“先更新时间线，再触发副作用”。这样 UI 事实先成立，预热失败也不会阻塞 ready 状态投影。

### 验证

```bash
pnpm test -- 房间实时编排
```

预期：既有实时编排测试仍通过；新增 RED 测试仍可能失败，因为依赖尚未桥接到媒体编排。

### 提交

暂不提交；与任务 3 合并提交。

---

## 5. 任务 3：抽出附件级媒体预热入口

### 文件

- 修改：`frontend/媒体/播放会话/应用.ts`

### 步骤

**3.1 扩展媒体播放会话应用端口**

在 `媒体播放会话应用端口` 中新增附件级入口：

```ts
预热附件分发线索(attachments: 附件快照[], currentSessionId: string): void;
```

从 `frontend/聊天共享/契约.ts` type import `附件快照`。这个入口只表达“这些附件带有分发线索，请媒体 owner 预热”，不暴露 WebTorrent runtime。

**3.2 抽出原 `预热权威消息媒体分发` 的附件循环**

把当前 `预热权威消息媒体分发(events, _currentSessionId)` 中的双层循环拆成附件级入口：

```ts
预热附件分发线索(attachments, _currentSessionId): void {
  for (const attachment of attachments) {
    if (!attachment.distribution_hint) {
      continue;
    }
    const aid = attachment.attachment_id;
    const hint = attachment.distribution_hint;
    // 保留原有 MEDIA_HINT_INGESTED / SWARM_IMMEDIATE_JOIN / locator HTTP 预热逻辑
  }
},

预热权威消息媒体分发(events, currentSessionId): void {
  this.预热附件分发线索(
    events.flatMap((event) => event.attachments ?? []),
    currentSessionId
  );
},
```

注意：只是抽函数，不改变原预热逻辑、consumerId、日志、locator 缓存或错误吞吐语义。

### 验证

```bash
pnpm test -- 权威事件预热
```

预期：既有权威事件预热测试仍通过，证明抽取没有改变旧路径。

### 提交

暂不提交；与任务 4 一起提交。

---

## 6. 任务 4：应用内核桥接到附件级预热入口

### 文件

- 修改：`frontend/应用根/聊天应用内核.ts`
- 修改：`frontend/应用根/聊天应用编排依赖工厂.ts`（如依赖工厂集中声明实时 deps）

### 步骤

**4.1 在内核增加薄方法**

在 `聊天应用内核` 内新增私有方法：

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

字段说明：

- 只传附件快照，不伪造 `消息事件`；
- `message_id`、`room_id`、`event_position` 不参与 WebTorrent 预热，不应被强塞进媒体层；
- 不要用发送者过滤，发送者自身也应预热。

**4.2 桥接实时依赖**

在创建实时编排依赖的位置增加：

```ts
接收附件升级后副作用: (event) => {
  this.预热附件升级媒体分发(event);
},
```

如果依赖工厂中需要透传，则在工厂类型和返回对象中增加同名字段，保持命名为应用副作用，不出现 WebTorrent 细节。

**4.3 保持权威事件路径不变**

不要修改已有：

```ts
this.媒体编排.预热权威消息媒体分发(events, currentSessionId);
```

附件升级路径只是补漏，不替换原有权威事件预热。

### 验证

```bash
pnpm test -- 附件升级预热
pnpm test -- 权威事件预热
```

预期：任务 1 的 RED 测试转绿；既有权威事件预热测试仍通过。

### 提交

```bash
git add frontend/实时/应用.ts frontend/应用根/聊天应用内核.ts frontend/应用根/聊天应用编排依赖工厂.ts frontend/媒体/播放会话/应用.ts frontend/tests/聊天媒体编排/附件升级预热测试.spec.ts
git commit -m "$(cat <<'EOF'
前端: 附件ready升级事件即时预热WebTorrent

pending-first 链路里接收者常先看到 prepared/processing 附件，随后通过 attachment_status_changed 收到 ready + distribution_hint。
这次升级事件此前只更新时间线，没有触发既有媒体预热，导致实时视频卡片可能黑灰占位到渲染/自动播后才被动入群。

修复后实时层只发布附件升级后的应用副作用，应用内核复用媒体编排的附件级预热入口，把 ready 附件升级立即转成 prefetch 入群。
不引入第二套 WebTorrent 逻辑，不改变正式播放主链。

验证：pnpm test -- 附件升级预热；pnpm test -- 权威事件预热。
EOF
)"
```

---

## 7. 任务 5：回归验证与真实体验冒烟

### 文件

- 不修改代码

### 步骤

**5.1 前端测试回归**

运行聚焦测试：

```bash
pnpm test -- 附件升级预热
pnpm test -- 权威事件预热
pnpm test -- 房间实时编排
```

如果项目脚本不支持中文过滤，则改用对应测试文件路径：

```bash
pnpm vitest run frontend/tests/聊天媒体编排/附件升级预热测试.spec.ts
pnpm vitest run frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts
pnpm vitest run frontend/tests/房间实时编排测试.spec.ts
```

**5.2 类型检查**

```bash
pnpm typecheck
```

若项目没有 `typecheck` 脚本，运行仓库已有前端检查命令，以 `package.json` 为准。

**5.3 浏览器冒烟**

部署或本地跑起 HTTPS 环境后：

1. A/B 两个账号进入同一群；
2. A 发送视频；
3. B 不刷新页面；
4. 控制台应出现 `MEDIA_HINT_INGESTED` 和 `SWARM_IMMEDIATE_JOIN`；
5. 视频卡片黑灰占位时间应明显缩短；
6. 刷新后历史消息自动播仍正常。

### 验证

记录命令输出和浏览器观察结果。没有公网冒烟证据时，不得声称“已彻底修复生产体验”。

### 提交

不新增提交。若任务 5 暴露实现问题，回到任务 1 补 RED 测试，再修到绿。

---

## 8. 自检

### 7.1 规格覆盖度

- 设计文档要求“附件 ready 升级事件触发即时预热”：任务 1-4 覆盖。
- 设计文档要求“复用既有预热，不造第二套 WebTorrent”：任务 3 抽出附件级入口，任务 4 复用该入口。
- 设计文档要求“不阻塞实时事件处理”：任务 2 只调用同步副作用入口，实际预热仍由媒体编排异步处理。
- 设计文档要求“验证公网真实体验”：任务 5 覆盖。

### 7.2 占位符扫描

占位词扫描通过：没有未完成标记，没有模糊占位语，也没有空泛的错误处理要求。

### 7.3 类型一致性

使用现有 `附件状态变更事件`、`附件快照`、`消息事件`。新增媒体入口命名为 `预热附件分发线索`，新增实时依赖命名为 `接收附件升级后副作用`。

### 7.4 三遍自审

1. **需求意图**：plan 聚焦“事件已到但没有即时预热”的断点，匹配黑灰占位和刷新后秒出的症状。通过。
2. **架构边界**：实时层不碰 WebTorrent；应用内核只桥接；媒体编排继续 owning 预热。通过。
3. **验证闭环**：先写 RED 测试，再实现，最后跑前端聚焦测试、类型检查和浏览器冒烟。通过。

### 7.5 100% 自信循环

当前 plan 不新增播放主链、不改变后端强种子、不改 Video.js 播放裁决，只把已存在的预热能力抽成附件级入口并接到漏掉的实时升级入口。唯一主要风险是重复预热，但既有 prefetch/inflight/session 去重机制本就要承受重复触发，任务 5 会验证不产生无界会话。基于当前源码证据和官方资料依据，对这个 plan 作为实现路线有事实层面的充分信心。
