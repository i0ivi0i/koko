# Web 群聊视频 P2P 优先自动播与多消费者 Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不回退现有 3 个视频 bug 修复成果的前提下，把消息流 `inline_autoplay` 从“止血版 anchor/original 优先”升级成“P2P/WebTorrent 优先”，并补齐 WebTorrent 多消费者 owner，避免自动播、时间线媒体会话、正式查看器互相误释放。

**Architecture:** 当前提交的自动播实现属于止血版：它先修掉双三角、缺缩略图、`0x0` 查看器，但为了避开 `swarm` 消费者粒度过粗的问题，把 `inline_autoplay` 临时收紧成 `anchor/original` 优先。Phase 2 的正确方向不是回滚这些修复，而是把 `WebTorrent` 会话从“按 attachmentId 粗粒度占用”升级成“同一 swarm 下多个命名消费者可安全共存”，然后让 `inline_autoplay` 回到和项目方向一致的 `P2P/WebTorrent` 优先链路。

**Tech Stack:** TypeScript, Lit, Vitest, WebTorrent, BrowserAppPlatform, Service Worker, Video.js v10, hls.js

**Execution Result (2026-04-15):**
- 已完成 `WebTorrent/swarm` 多消费者 owner 改造，`session:*` 与 `inline_autoplay:*` 可以安全共存并独立释放。
- 已完成 `consumerId` 贯穿：媒体会话、消息流自动播、后台/退房/开查看器释放路径都只操作自己的 consumer。
- 已完成 `inline_autoplay -> swarm/web seed 优先 -> anchor/original fallback` 收口；`viewer` 仍保持 `manifest` 正式主链。
- 已补图片秒开与 backfill 回归护栏：图片首开继续优先 `preview/full blob`，backfill 继续复用同一个协作分发 resolver。

---

## 范围裁决

这份计划只做前端媒体 runtime 的 Phase 2 收口，不动后端契约和已修好的 preview 真相主线：

1. 不回退 `preview_asset.still_url`、消息卡片单封面、正式查看器 `0x0` 修复。
2. 不新增第二套播放器壳，不把 `inline_autoplay` 改成 `manifest` 直播。
3. 不新增第二个 WebTorrent runtime，也不为了自动播再长一套独立 P2P 管线。
4. 不把图片首开主链从 `preview/full + cache` 强行改成 `WebTorrent`；图片只要求“不退化并继续享受同一套协作分发 owner 语义”。
5. 本期目标是把“唯一媒体真相 owner”补完整，而不是推翻当前分层。

## 根因复盘

当前 `inline_autoplay` 没有回到 `swarm` 主链，不是因为 `anchor/original` 更高级，而是因为现在的 `frontend/媒体/媒体协作分发.ts` 还把消费者近似建模成“这个附件有没有人在用”：

- `session.consumerListeners` 仍按 `attachmentId` 管理；
- `释放协作分发消费者(...)` 也按 `attachmentId` 释放；
- 对同一附件来说，时间线媒体会话、消息流自动播、正式查看器还没有真正独立的 consumer 身份。

这会导致一个结构性风险：

1. `媒体会话` 正在用同一个附件的 swarm；
2. `inline_autoplay` 也去用同一个附件的 swarm；
3. 自动播一停，释放动作可能把正式链路一起误伤。

所以旧实现才先用 `anchor/original` 避坑。  
这条路短期能止血，长期会偏离项目目标，因为你们的原始冷源本来只想做短期兜底，24 小时后主链必须更多依赖群友之间的 `WebTorrent/P2P`。

## 文件结构与职责锁定

- `frontend/媒体/媒体协作分发.ts`
  - 继续做唯一的 WebTorrent/swarm runtime owner。
  - 本期要把“附件级消费者”升级成“命名消费者”。
- `frontend/媒体/媒体播放.ts`
  - 继续做唯一 source resolver。
  - 本期只修改 `inline_autoplay` 的选源顺序，不让壳层自己挑源。
- `frontend/媒体/媒体会话.ts`
  - 继续做时间线附件媒体会话。
  - 本期要显式携带自己的 consumerId，避免和自动播混用一个 swarm 占用。
- `frontend/聊天媒体编排.ts`
  - 继续做浏览器侧媒体体验编排 owner。
  - 本期要给 `inline_autoplay` 发稳定 consumerId，并保证 owner 切换只释放自动播自己的占用。
- `frontend/聊天应用内核.ts`
  - 继续只做命令编排和生命周期分发。
  - 本期只补“后台/退房/开查看器”这些动作对多消费者释放的回归保护。
- `frontend/tests/媒体协作分发测试.spec.ts`
  - 锁住“同一 swarm 下多个消费者共存，互不误释放”。
- `frontend/tests/媒体播放测试.spec.ts`
  - 锁住 `inline_autoplay` 改成 `swarm/web seed` 优先，`viewer` 仍保持原语义。
- `frontend/tests/媒体会话测试.spec.ts`
  - 锁住时间线媒体会话的 consumerId 与恢复语义。
- `frontend/tests/聊天应用内核测试.spec.ts`
  - 锁住后台、退房、开查看器等行为不会误伤其他消费者。
- `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
  - 锁住消息流 UI 仍只有一个自动播 owner，不因改回 P2P 而重新长第二套播放入口。
- `docs/superpowers/specs/2026-04-15-Web群聊视频单一真相与视口自动播-design.md`
  - 代码落地后需要回写一条明确说明：`inline_autoplay` 的 `anchor/original` 优先只是止血版，不再作为长期裁决。

## 全局硬约束

1. `swarm` 会话的 canonical owner 仍然只能有一个：`frontend/媒体/媒体协作分发.ts`。
2. 消费者可以有多个，但只是多个“引用/观察者”，不是多套 runtime。
3. `媒体播放.ts` 仍然是唯一 source resolver；壳层和测试支架都不允许自己拼 `torrent/web_seed/original`。
4. `inline_autoplay` 回到 P2P 优先后，`viewer` 的 `manifest` 正式主链语义不能被污染。
5. 原始冷源仍然只做 fallback，不得再次升格成长期主链真相。
6. 所有行为变化都必须先补失败测试，再做实现。

### Task 1: 给 WebTorrent 协作分发补上“多消费者 owner”安全边界

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`

- [ ] **Step 1: 先写失败测试，锁住“同一 swarm 下多个消费者可以共存”**

```ts
it("同一附件的时间线会话和 inline_autoplay 会共享同一个 torrent 会话，但互不误释放", async () => {
  const locator = 准备好的定位结果("att-1");

  const sessionSource = await 解析协作分发源({
    attachmentId: "att-1",
    kind: "video",
    locator,
    consumerId: "session:att-1",
  });
  const autoplaySource = await 解析协作分发源({
    attachmentId: "att-1",
    kind: "video",
    locator,
    consumerId: "inline_autoplay:att-1",
  });

  expect(sessionSource).toEqual(autoplaySource);
  expect(读取协作分发会话状态("swarm-att-1")).toMatchObject({
    refs: 2,
    consumers: ["session:att-1", "inline_autoplay:att-1"],
  });

  释放协作分发消费者({
    attachmentId: "att-1",
    consumerId: "inline_autoplay:att-1",
  });

  expect(读取协作分发会话状态("swarm-att-1")).toMatchObject({
    refs: 1,
    consumers: ["session:att-1"],
  });
});
```

- [ ] **Step 2: 再补一个失败测试，锁住“释放最后一个消费者才真正销毁 swarm 会话”**

```ts
it("只释放其中一个消费者时，不会提前 destroy torrent/runtime", async () => {
  expect(remove).not.toHaveBeenCalled();

  释放协作分发消费者({
    attachmentId: "att-1",
    consumerId: "inline_autoplay:att-1",
  });
  expect(remove).not.toHaveBeenCalled();

  释放协作分发消费者({
    attachmentId: "att-1",
    consumerId: "session:att-1",
  });
  expect(remove).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: 运行失败测试，确认当前实现还是 attachment 级粗粒度释放**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体协作分发测试.spec.ts -t "同一附件的时间线会话和 inline_autoplay 会共享同一个 torrent 会话，但互不误释放"
pnpm --dir frontend exec vitest run tests/媒体协作分发测试.spec.ts -t "只释放其中一个消费者时，不会提前 destroy torrent/runtime"
```

Expected: FAIL，当前 `consumerListeners` 还按 `attachmentId` 管理，第二个消费者不会独立计数，释放也会一起掉。

- [ ] **Step 4: 做最小实现，把消费者从 attachment 级升级成命名 consumerId**

```ts
type 协作分发消费者 = {
  consumerId: string;
  attachmentId: string;
  onSessionEvent: ((event: 协作分发会话事件) => void) | null;
};

type 协作分发会话 = {
  attachmentId: string;
  consumerBindings: Map<string, 协作分发消费者>;
  // 其余字段保持原状
};
```

```ts
export async function 解析协作分发源(input: {
  attachmentId: string;
  kind: 媒体种类;
  locator: 媒体定位结果;
  consumerId: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
}): Promise<协作分发媒体源 | null>
```

```ts
export function 释放协作分发消费者(input: {
  attachmentId: string;
  consumerId: string;
}): void
```

实现约束：

1. session 仍按 `swarm_id/content_hash` 级别唯一存在，不允许每个 consumer 再开一个 torrent。
2. `读取协作分发会话状态()` 要把 `consumers` 暴露出来，专门给测试断言，不给 shell 层拿去承载业务真相。
3. `发布协作分发会话事件()` 要按 consumer 逐个回调，不能再假设一个 attachment 只有一个监听者。
4. `attachmentId` 仍是业务语义；`consumerId` 只是技术级资源占用身份，不能倒灌进共享 contract。

- [ ] **Step 5: 重新运行测试并确认转绿**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体协作分发测试.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交多消费者 owner 底座**

```bash
git add frontend/媒体/媒体协作分发.ts frontend/tests/媒体协作分发测试.spec.ts
git commit -m "前端: 为WebTorrent协作分发补齐多消费者owner"
```

### Task 2: 把 consumerId 贯穿到媒体会话、自动播编排和释放路径

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体会话.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/聊天应用内核.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/媒体会话测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 先写失败测试，锁住“时间线媒体会话”和“自动播”必须用不同 consumerId**

```ts
it("媒体会话启动与恢复时，会携带稳定的 session consumerId", async () => {
  expect(解析播放结果).toHaveBeenCalledWith(
    expect.objectContaining({
      attachmentId: "att-video-1",
      consumerId: "session:att-video-1",
    })
  );
});

it("inline_autoplay 解析与释放时，只操作自己的 autoplay consumerId", async () => {
  expect(解析播放结果).toHaveBeenCalledWith(
    expect.objectContaining({
      attachmentId: "att-video-inline-1",
      consumerId: "inline_autoplay:att-video-inline-1",
      surface: "inline_autoplay",
    })
  );
  expect(释放附件播放资源).toHaveBeenCalledWith({
    attachmentId: "att-video-inline-1",
    consumerId: "inline_autoplay:att-video-inline-1",
  });
});
```

- [ ] **Step 2: 再补一个失败测试，锁住“后台释放自动播 owner 时不能把时间线媒体会话一起干掉”**

```ts
it("平台切后台释放自动播时，不会释放同附件的 session consumer", async () => {
  expect(释放附件播放资源).toHaveBeenCalledWith({
    attachmentId: "att-video-inline-1",
    consumerId: "inline_autoplay:att-video-inline-1",
  });
  expect(释放附件播放资源).not.toHaveBeenCalledWith({
    attachmentId: "att-video-inline-1",
    consumerId: "session:att-video-inline-1",
  });
});
```

- [ ] **Step 3: 运行失败测试，确认当前释放路径仍缺少 consumerId**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体会话测试.spec.ts -t "session consumerId"
pnpm --dir frontend exec vitest run tests/聊天应用内核测试.spec.ts -t "不会释放同附件的 session consumer"
```

Expected: FAIL，当前 `释放附件播放资源` 仍只有 `attachmentId`，调用方无法区分不同消费者。

- [ ] **Step 4: 做最小实现，只补 caller identity，不改媒体真相 owner**

```ts
export type 媒体播放输入 = {
  attachmentId: string;
  kind: "image" | "video";
  surface?: "viewer" | "inline_autoplay";
  consumerId?: string;
  onSessionEvent?: (signal: 媒体会话信号) => void;
};
```

```ts
const 会话ConsumerId = `session:${deps.attachmentId}`;
const 自动播ConsumerId = `inline_autoplay:${attachmentId}`;
```

```ts
释放附件播放资源({
  attachmentId,
  consumerId,
});
```

实现约束：

1. `媒体播放.ts` 仍然是唯一 source resolver；这里只是给 resolver 和 release 增加 caller identity。
2. `聊天媒体编排.ts` 继续只拥有“当前自动播 owner 是谁”，不拥有 swarm runtime 真相。
3. `聊天应用内核.ts` 里的后台/退房/开查看器动作继续只调编排端口，不直接摸协作分发 runtime。
4. 不新增 `viewer consumer`，除非实际代码证明正式查看器确实需要独立 swarm 占用；本期先收口 `session + inline_autoplay` 两种真实消费者。

- [ ] **Step 5: 重新运行测试并确认转绿**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体会话测试.spec.ts tests/聊天应用内核测试.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交 consumerId 贯穿切片**

```bash
git add frontend/媒体/媒体播放.ts frontend/媒体/媒体会话.ts frontend/聊天媒体编排.ts frontend/聊天应用内核.ts frontend/tests/媒体播放测试.spec.ts frontend/tests/媒体会话测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts
git commit -m "前端: 贯穿媒体会话与自动播的consumerId"
```

### Task 3: 把 `inline_autoplay` 从止血版 `anchor/original` 优先切回 `P2P/WebTorrent` 优先

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`

- [ ] **Step 1: 先写失败测试，锁住 `inline_autoplay` 必须先尝试 swarm，而不是先探测冷源 anchor**

```ts
it("inline_autoplay surface 在 distribution 可用时，会先尝试 swarm/web seed，而不是先 probe anchor", async () => {
  const result = await 播放器.解析播放结果({
    attachmentId: "att-video-inline-swarm-1",
    kind: "video",
    surface: "inline_autoplay",
    consumerId: "inline_autoplay:att-video-inline-swarm-1",
  });

  expect(resolveSwarmSource).toHaveBeenCalledWith(
    expect.objectContaining({
      attachmentId: "att-video-inline-swarm-1",
      consumerId: "inline_autoplay:att-video-inline-swarm-1",
    })
  );
  expect(probeAnchor).not.toHaveBeenCalled();
  expect(result.mode).toBe("swarm");
});
```

- [ ] **Step 2: 再补两个失败测试，锁住 fallback 和 viewer 不被污染**

```ts
it("inline_autoplay 在 swarm 不可用时才回退 anchor/original", async () => {
  expect(result).toMatchObject({
    mode: "anchor",
    src: "http://media.local/cold-origin-inline-fallback",
  });
});

it("viewer surface 仍保持 manifest 优先，不会被 inline_autoplay 的 P2P 策略污染", async () => {
  expect(result).toMatchObject({
    mode: "manifest",
    src: "http://media.local/master.m3u8",
  });
});
```

- [ ] **Step 3: 运行失败测试，确认当前 `inline_autoplay` 仍是锚点优先**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体播放测试.spec.ts -t "inline_autoplay surface 在 distribution 可用时，会先尝试 swarm/web seed，而不是先 probe anchor"
pnpm --dir frontend exec vitest run tests/媒体播放测试.spec.ts -t "viewer surface 仍保持 manifest 优先"
```

Expected: 第一条 FAIL，当前实现会先走 `尝试锚点(...)`；第二条应该继续 PASS，作为防回归护栏。

- [ ] **Step 4: 做最小实现，把自动播切回 P2P 优先，但仍禁止消息流直接播 manifest**

```ts
if (surface === "inline_autoplay") {
  const distribution = 读取协作分发定位片段(locator);
  if (distribution?.availability === "available") {
    const swarmSource = await resolveSwarmSource({
      attachmentId: input.attachmentId,
      kind: input.kind,
      locator,
      consumerId: input.consumerId ?? `inline_autoplay:${input.attachmentId}`,
      ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
    });
    if (swarmSource) {
      return {
        mode: "swarm",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: swarmSource.src,
        thumbnailUrl: 读取预览缩略图地址(locator),
        hint: 过滤可播放媒体提示(swarmSource.hint),
      };
    }
  }
  return 尝试锚点(input, locator, true);
}
```

实现约束：

1. `inline_autoplay` 允许吃 `swarm/web seed`，但仍不允许在消息流里直接吃 `manifest`。
2. `swarm` 不可用时才回退 `anchor/original`；原始冷源仍然只是 fallback。
3. `viewer` 现有 `manifest` 正式主链裁决不能被改坏。
4. 不因为改回 P2P 优先而让消息流重新长出第二套按钮或第二套 `<video>` 默认态。

- [ ] **Step 5: 重新运行测试并确认转绿**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体播放测试.spec.ts tests/聊天应用内核测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交 P2P 优先自动播切片**

```bash
git add frontend/媒体/媒体播放.ts frontend/tests/媒体播放测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts
git commit -m "前端: 让消息流自动播回到P2P优先主链"
```

### Task 4: 锁住图片秒开与协作分发回归，避免“为了视频自动播把图片搞慢”

**Files:**
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 先写失败测试，锁住图片首开主链不退化**

```ts
it("图片首开仍优先 preview/full + cache，不会因为多消费者改造而被强行切到 WebTorrent", async () => {
  expect(result.mode).toBe("blob");
});
```

- [ ] **Step 2: 再补一个失败测试，锁住图片协作补齐仍复用同一套 runtime 和 release 语义**

```ts
it("图片 backfill 进入 swarm 后，release 仍按 consumerId 精确回收，不影响其他消费者", async () => {
  expect(读取协作分发会话状态("swarm-att-image-1")).toMatchObject({
    refs: 2,
  });
});
```

- [ ] **Step 3: 运行失败测试，确认图片路径没有被误带到 attachment 级释放**

Run:

```bash
pnpm --dir frontend exec vitest run tests/blob媒体资产测试.spec.ts tests/媒体协作分发测试.spec.ts -t "图片"
```

Expected: 如果 consumerId 改造不完整，这里要么 FAIL，要么暴露 refs/release 断言不对。

- [ ] **Step 4: 做最小实现，只修资源回收与测试支架，不改图片首开裁决**

实现约束：

1. 图片首开继续优先 `blob_asset.preview/full + cache`。
2. 图片进入协作补齐后，只共享同一个 `WebTorrent runtime`，不单独长图片版 runtime。
3. 不为了“证明 P2P 更猛”去牺牲图片首开秒开体验。

- [ ] **Step 5: 重新运行测试并确认转绿**

Run:

```bash
pnpm --dir frontend exec vitest run tests/blob媒体资产测试.spec.ts tests/媒体协作分发测试.spec.ts tests/聊天应用内核测试.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交图片与 release 防回归切片**

```bash
git add frontend/tests/blob媒体资产测试.spec.ts frontend/tests/媒体协作分发测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts
git commit -m "前端: 锁住图片秒开与协作分发回收不退化"
```

### Task 5: 文档回写、全量验证与浏览器验收

**Files:**
- Modify: `docs/superpowers/specs/2026-04-15-Web群聊视频单一真相与视口自动播-design.md`
- Modify: `docs/superpowers/plans/2026-04-15-Web群聊视频P2P优先自动播与多消费者Owner实施计划.md`

- [ ] **Step 1: 回写 spec，明确把“anchor/original 优先”标记成已退场的止血版策略**

```md
- 旧止血版：`inline_autoplay -> anchor/original 优先`
- 新正式版：`inline_autoplay -> swarm/web seed 优先 -> anchor/original fallback`
- 前提：`WebTorrent` 已支持多消费者 owner，自动播与时间线媒体会话互不误释放
```

- [ ] **Step 2: 跑前端全量回归和类型检查**

Run:

```bash
pnpm --dir frontend exec vitest run tests/媒体协作分发测试.spec.ts tests/媒体播放测试.spec.ts tests/媒体会话测试.spec.ts tests/blob媒体资产测试.spec.ts tests/聊天应用内核测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天壳测试.spec.ts tests/端到端测试.spec.ts
pnpm --dir frontend exec tsc --noEmit
```

Expected: PASS。

- [ ] **Step 3: 做本机浏览器验收，重点看“P2P 优势真的回来没有”**

验收步骤：

1. 两台设备或两个浏览器上下文进入同一房间；
2. 发送一个视频消息，确认默认态仍只有单封面 + 单入口；
3. 把视频滚进视口，确认自动播能在 swarm/web seed 可用时直接播放，而不是只靠原始冷源；
4. 点开正式查看器，确认画面继续正常，自动播释放不误伤正式链路；
5. 关闭查看器后重新滚动，确认自动播恢复正常；
6. 发图片消息，确认图片仍秒开，没有因为这次重构变慢。

- [ ] **Step 4: 重建图谱并检查工作树**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
git status --short
```

Expected: 图谱更新成功；工作树只有本次改动。

- [ ] **Step 5: 提交收尾**

```bash
git add docs/superpowers/specs/2026-04-15-Web群聊视频单一真相与视口自动播-design.md docs/superpowers/plans/2026-04-15-Web群聊视频P2P优先自动播与多消费者Owner实施计划.md graphify-out
git commit -m "文档: 回写群聊视频P2P优先自动播二阶段计划"
```

## 完成定义

做到下面这些，才算这份 Phase 2 真正落地：

1. `inline_autoplay` 不再长期依赖 `anchor/original` 先手，而是回到 `P2P/WebTorrent` 优先。
2. 同一附件的时间线媒体会话和自动播可以安全共享一个 swarm 会话，互不误释放。
3. `viewer` 的正式播放链、消息流单封面默认态、查看器 `0x0` 修复都没有被回退。
4. 图片秒开和图片 backfill/release 没有退化。
5. 浏览器真实联调时，能观察到“自动播也开始真正吃到 P2P 优势”，而不是只剩形式上的 P2P 接口。

---

Plan complete and saved to `docs/superpowers/plans/2026-04-15-Web群聊视频P2P优先自动播与多消费者Owner实施计划.md`. Two execution options:

1. `Subagent-Driven` (recommended) - 我按任务逐段派新子代理执行，再逐段 review
2. `Inline Execution` - 我在这个会话里按这份 plan 直接开干
