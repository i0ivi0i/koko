# WebTorrent 生命周期 Owner 执行计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when the host explicitly allows subagents, otherwise use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `2026-04-23-WebTorrent满血协同分发要求.md` 里的 WebTorrent 生命周期 owner 模型落成代码：前端只有一个协作分发运行时 owner，后端用 Rust 强类型裁决可用性和做种决策，正式媒体字节仍只走唯一 `WebTorrent` whole-file swarm。

**Architecture:** 不新增并列的 `全局唯一WebTorrent.ts` 大状态机，不给后端硬上 XState，不把状态机做成第二业务主链。前端在现有 `frontend/媒体/资产协作分发运行时.ts` 内收口 runtime/session 生命周期，`frontend/媒体/媒体协作分发.ts` 继续只做 WebTorrent 官方 adapter；后端在 `src/媒体协作分发.rs` 内把 string 状态收成 `PeerKind / Availability / SeederDecision` 这类 Rust enum 和纯函数 reducer，再由 shell/contract 投影成既有响应。

**Tech Stack:** TypeScript 6.0.2、XState 5、WebTorrent 2.8、Vitest、Rust 1.92+、Tokio、Axum、`cargo test`、`chrome-devtools-cli`、`playwright-cli`。

---

## 0. 执行前硬门禁

本计划只处理 WebTorrent 生命周期 owner 与后端可用性裁决，不重写播放器连续性、不重做万人群聊整体预算、不迁移图片缓存策略。执行前必须重新读取当前文件内容，不能凭本计划的旧快照直接编辑。

执行前必须重新读：

- `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- `docs/superpowers/specs/2026-04-26-万人群聊浏览器零崩溃零闪烁.md`
- `docs/superpowers/plans/2026-04-28-唯一WebTorrent万人群聊零崩溃零闪烁执行计划.md`
- `docs/superpowers/plans/2026-04-29-播放连续性状态链执行计划.md`
- `graphify-out/GRAPH_REPORT.md`

执行前必须用 Serena 重新扫：

- `frontend/媒体/资产协作分发运行时.ts`
- `frontend/媒体/媒体协作分发.ts`
- `frontend/媒体/信息流视频预算.ts`
- `frontend/聊天媒体编排.ts`
- `frontend/媒体/全局唯一播放器.ts`
- `scripts/check-frontend-architecture-fitness.mjs`
- `src/媒体协作分发.rs`
- `src/媒体资产外壳.rs`
- `src/外壳.rs`
- `tests/协作分发测试/可用性裁决.rs`
- `frontend/tests/资产协作分发运行时测试.spec.ts`

硬禁令：

- 禁止新增与 `frontend/媒体/资产协作分发运行时.ts` 并列的前端 WebTorrent owner。
- 禁止让 `房间消息窗.ts`、查看器、播放器壳、媒体定位层直接创建 WebTorrent client、stream server、source reader 或 presence heartbeat。
- 禁止让前端内部状态机裁决 `MEDIA_READY / MEDIA_NO_ONLINE_SEED / MEDIA_DELETED` 业务真相。
- 禁止恢复或新增 `HLS / DASH / CDN / original_url / 临时 range` 为新主链正式播放入口。
- 禁止把后端可用性裁决藏进框架黑箱；后端只能用强类型 enum、纯函数和表驱动测试表达业务事实。
- 禁止只加 guard、timeout、日志降噪或 warning ignore；本次修复必须减少多处共写、隐式保活、reader/listener 泄漏和退场竞态。

### 0.1 官方资料与成熟实践校准

执行代码前先按下面资料校准，不允许跳过后手搓替代品：

- WebTorrent 官方路径：浏览器端正式播放必须依赖 `navigator.serviceWorker.ready`、`client.createServer({ controller })`、`file.streamTo(element)` 或 `file.streamURL`；`createServer` 支持 `/webtorrent/<infoHash>/<filepath>` 和 range 请求，`streamTo` 支持浏览器 codec/container 能力，`file.createReadStream()` 和 `file.stream()` 会优先下载流所需 pieces。来源：[WebTorrent API Documentation](https://webtorrent.io/docs)。
- WebTorrent cleanup：`client.remove()` / `torrent.destroy()` / `client.destroy()` 是成熟退出路径；`torrent.on("error")` 和 `client.on("error")` 都要监听，`torrent.on("done" / "download" / "upload" / "wire" / "noPeers")` 是观测面，不是业务真相 owner。计划里只能薄适配这些 API，禁止自研第二套 stream server、piece scheduler 或播放器字节管线。来源：[WebTorrent API Documentation](https://webtorrent.io/docs)。
- XState v5：actor 可以同步 `getSnapshot()` 或 subscribe 快照；callback actor 可以返回 cleanup；invoked actor 在进入状态时启动、退出状态时停止；promise actor 退出状态后结果会被丢弃；同一 `src` 多次 invoke 会创建多个实例。因此本项目只允许在唯一协作分发 owner 内使用 XState 管生命周期和 cleanup，不能给每个 UI 壳层各 spawn 一颗 WebTorrent actor。来源：[XState Actors](https://stately.ai/docs/actors)、[XState Invoke](https://stately.ai/docs/invoke)。
- Chrome Page Lifecycle：hidden 通常是移动端最后可靠可观测状态；frozen 会暂停可冻结任务，官方建议在 freeze 前关闭 WebRTC、WebSocket、网络轮询和会影响 bfcache 的连接；`unload` 不可靠且会伤害性能。因此本计划必须把 hidden/freeze/pagehide 作为 owner 输入，释放前台重 reader/listener/heartbeat，而不是等浏览器或组件自行清理。来源：[Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)。
- AbortSignal：一个 signal 只能用一次；abort 后未完成 promise 应拒绝，支持 abort 的 API 应在 signal 已 abort 时立即失败，并用 `{ once: true }` 或等价机制避免 abort listener 残留。因此 locator/source/probe/join ticket refresh 必须绑定 generation + AbortSignal。来源：[MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)。
- 主线程高性能：长任务要切片让路，`scheduler.yield()` 的设计目标是把长任务拆开并让浏览器响应输入；旧浏览器要 feature detect。执行时如果增加批量 session 扫描、预算汇总或 smoke probe，必须切片或延后到低优先级，禁止把 WebTorrent owner 做成滚动热路径阻塞点。来源：[Chrome scheduler.yield](https://developer.chrome.com/blog/use-scheduler-yield)。
- Rust 建模：Rust enum 用来枚举可能变体，`match` 让不同变体走不同逻辑；后端 availability / seeder decision 应用 enum 表达业务状态，再用 `match` 投影为 contract code，避免 stringly-typed 布尔组合继续扩散。来源：[The Rust Programming Language: Enums and Pattern Matching](https://doc.rust-lang.org/book/ch06-00-enums.html)。
- Event listener 泄漏：Node 官方提供 `events.addAbortListener()` 这类可释放 listener 工具，并明确 abort listener 容易忘记移除。虽然浏览器 WebTorrent 不是 Node 服务端，但本项目的 `MaxListenersExceededWarning` 要按生命周期泄漏证据处理，禁止用提高上限替代解绑。来源：[Node.js Events API](https://nodejs.org/api/events.html)。

---

## 1. 文件职责图

### 1.1 生产代码

- Modify: `frontend/媒体/资产协作分发运行时.ts`
  - 唯一前端 WebTorrent runtime/session owner。
  - 在现有 XState actor 内显式表达 runtime 生命周期和 session 生命周期。
  - 管理 consumer refs、source generation、join ticket refresh、presence heartbeat、reader 释放、route drain 和 light help。
  - 输出可测试快照，不输出第二套 UI 文案。

- Modify: `frontend/媒体/媒体协作分发.ts`
  - 继续作为 WebTorrent 官方 API 薄 adapter。
  - 只负责 `client/createServer`、`streamURL / streamTo`、底层 torrent/client/listener 清理、route drain。
  - 不拥有附件是否成立、是否删除、是否 ready 的业务真相。

- Modify: `frontend/媒体/信息流视频预算.ts`
  - 消费 `资产协作分发运行时.ts` 的生命周期快照。
  - 只把 `heavy_playback / light_help / cold` 等投影进媒体预算，不直接触碰 WebTorrent runtime。

- Modify: `frontend/聊天媒体编排.ts`
  - 把自动播放、查看器、全屏、预览、补齐消费者统一映射成同一 session 的消费模式。
  - 确保退出当前消息窗口不会误删仍有帮助价值的 session。

- Modify: `scripts/check-frontend-architecture-fitness.mjs`
  - 加强 owner 注册表和违规扫描。
  - 明确允许的 XState owner 是既有 `资产协作分发运行时.ts` 和已登记播放状态链。
  - 拦截并列 WebTorrent owner、UI 层 WebTorrent import、未登记 `createMachine/createActor`。

- Modify: `src/媒体协作分发.rs`
  - 把 `裁决协作分发可用性()` 和 `裁决协作分发媒体状态码()` 的 string/布尔组合下沉到强类型输入和 reducer。
  - 保留现有 contract code 输出，避免破坏前端和测试的稳定表面。

- Modify: `src/媒体资产外壳.rs`
  - 只做 contract 投影和重试窗口补充，不重新计算可用性真相。
  - 如需补字段，只从 `media_distribution` 的强类型裁决结果转换。

- Modify: `src/外壳.rs`
  - 保持 tracker 同源代理只是门禁和透明转发。
  - 不把 tracker 代理做成后端状态机，也不在缺票/畸形首帧时污染 upstream 故障语义。

### 1.2 测试和门禁

- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
  - 主测前端 runtime/session 生命周期。
  - 覆盖 `cold -> locating -> joining -> swarm_active -> source_ready -> heavy_playback -> light_help -> locally_complete -> draining -> dropped` 主路径。
  - 覆盖 `ticket_invalid / no_peers / source_unreadable / unsupported_runtime / deleted` 降级路径。

- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
  - 主测 adapter 只交付 WebTorrent 官方 source，route drain 按 generation/ref-count 收尾。

- Modify: `frontend/tests/信息流视频预算测试.spec.ts`
  - 主测生命周期快照如何投影成 `heavy_playback / light_help / cold`，并证明 light help 没有前台 reader。

- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
  - 主测自动播放、查看器、全屏、预览、补齐消费者不会生成第二 session。

- Modify: `tests/协作分发测试/可用性裁决.rs`
  - 后端 availability / seeder decision 表驱动测试。

- Modify: `tests/协作分发测试.rs`
  - 保留 tracker 门禁测试；必要时补“缺票/畸形首帧不是 upstream 故障”的断言。

- Modify: `tests/启动器脚本检查.ps1`
  - 只在 run/qingli 启动链新增检查时修改；不把业务状态塞进启动器。

---

## Task 1: 写前端生命周期 characterization 测试

**Files:**

- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`

- [ ] **Step 1: 追加 session 主路径红测**

在现有 fake WebTorrent 支架上追加测试，先只断言公开快照，不要求实现已存在：

```ts
it("协作分发 session 会按唯一 owner 流转并在退出重播放后降为轻帮助", async () => {
  const runtime = 创建资产协作分发运行时({
    loadLocator: async () => 构造ReadyLocator("att-owner-flow"),
    createWebTorrentRuntime: () => fakeWebTorrentRuntime(),
  });

  const source = await runtime.解析协作分发源({
    attachmentId: "att-owner-flow",
    consumerId: "timeline-autoplay",
    mode: "heavy_playback",
  });

  expect(source.formalByteSource).toBe("webtorrent_official_stream");
  expect(runtime.读取会话状态("att-owner-flow")?.lifecycle.state).toBe("heavy_playback");

  runtime.释放协作分发消费者("att-owner-flow", "timeline-autoplay");

  expect(runtime.读取会话状态("att-owner-flow")?.lifecycle.state).toBe("light_help");
  expect(runtime.读取预算().zeroRefHeavySessionCount).toBe(0);
  expect(runtime.读取预算().zeroRefWholeFileReaderCount).toBe(0);
});
```

- [ ] **Step 2: 追加 stale generation 红测**

```ts
it("旧 generation 的 source 完成后不能写回新 session", async () => {
  const deferred = 创建可控SourcePromise();
  const runtime = 创建资产协作分发运行时({
    loadLocator: async () => 构造ReadyLocator("att-generation"),
    createWebTorrentRuntime: () => fakeRuntimeWithDeferredSource(deferred),
  });

  const first = runtime.解析协作分发源({
    attachmentId: "att-generation",
    consumerId: "preview-a",
    mode: "preview",
  });

  runtime.重置();
  deferred.resolve(构造WebTorrentOfficialSource());
  await expect(first).rejects.toThrow(/generation|stale|aborted/);

  expect(runtime.读取会话状态("att-generation")).toBeUndefined();
});
```

- [ ] **Step 3: 追加 failure reason 红测**

```ts
it("ticket_invalid 会丢弃会话并记录终止原因，不回退第二播放链", async () => {
  const runtime = 创建资产协作分发运行时({
    loadLocator: async () => 构造ReadyLocator("att-ticket-invalid"),
    createWebTorrentRuntime: () => fakeRuntimeEmittingError("join_ticket_invalid"),
  });

  await expect(runtime.解析协作分发源({
    attachmentId: "att-ticket-invalid",
    consumerId: "viewer",
    mode: "heavy_playback",
  })).rejects.toThrow(/join_ticket_invalid/);

  const snapshot = runtime.snapshot();
  expect(snapshot.lastDroppedReason).toBe("ticket_invalid");
  expect(snapshot.fallbackByteSource).toBeUndefined();
});
```

- [ ] **Step 4: 运行红测**

Run:

```powershell
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts"
```

Expected: 新增断言失败，失败点指向缺少 `lifecycle` 快照、generation 失效或 failure reason。

---

## Task 2: 在既有前端 owner 内建立显式生命周期模型

**Files:**

- Modify: `frontend/媒体/资产协作分发运行时.ts`

- [ ] **Step 1: 增加类型，不新建 owner 文件**

在现有类型区附近加入。中文注释只解释职责和边界，避免解释语法：

```ts
export type WebTorrentRuntimeLifecycleState =
  | "unavailable"
  | "booting"
  | "ready"
  | "draining"
  | "destroyed";

export type WebTorrentSessionLifecycleState =
  | "cold"
  | "locating"
  | "joining"
  | "swarm_active"
  | "source_ready"
  | "heavy_playback"
  | "light_help"
  | "locally_complete"
  | "draining"
  | "dropped";

export type WebTorrentSessionTerminalReason =
  | "ticket_invalid"
  | "no_peers"
  | "source_unreadable"
  | "unsupported_runtime"
  | "deleted"
  | "destroyed"
  | "stale_generation";

export interface WebTorrentSessionLifecycleSnapshot {
  state: WebTorrentSessionLifecycleState;
  generation: number;
  reason?: WebTorrentSessionTerminalReason;
  activeReaderCount: number;
  hasPresenceHeartbeat: boolean;
  hasJoinTicketRefresh: boolean;
}
```

- [ ] **Step 2: 扩展底层 session 结构**

在既有 `底层协作分发会话` 类型里增加字段：

```ts
// 生命周期字段是唯一 owner 的内部账本，用来阻止旧任务写回和零引用重保活。
lifecycleState: WebTorrentSessionLifecycleState;
generation: number;
activeReaderCount: number;
terminalReason?: WebTorrentSessionTerminalReason;
```

- [ ] **Step 3: 增加小 reducer，不把业务真相搬进状态机**

```ts
function 转移协作分发会话生命周期(
  session: 底层协作分发会话,
  next: WebTorrentSessionLifecycleState,
  reason?: WebTorrentSessionTerminalReason,
): void {
  session.lifecycleState = next;
  session.terminalReason = reason;
  if (next === "dropped" || next === "destroyed") {
    session.generation += 1;
  }
}
```

实现时如果现有命名不同，保持本地风格，但必须满足：状态转换集中、generation 单调、终止原因可读。

- [ ] **Step 4: 在创建/定位/加入/source ready/heavy/light/drain/drop 处写入状态**

最小映射：

- 新 session：`cold`
- 开始 `loadLocator`：`locating`
- 已获得 locator/torrent 并进入 `WebTorrent`：`joining`
- torrent 进入 swarm 或绑定事件完成：`swarm_active`
- source promise 成功且来源可读：`source_ready`
- consumer mode 是正式播放/查看器/全屏：`heavy_playback`
- consumer refs 归零但仍有补齐/做种价值：`light_help`
- torrent done：`locally_complete`
- source 释放但 route tailwave 未结束：`draining`
- terminal / reset / destroy：`dropped`

- [ ] **Step 5: 转绿**

Run:

```powershell
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts"
```

Expected: Task 1 的新增测试通过，旧测试继续通过。

- [ ] **Step 6: 提交**

```powershell
git add frontend/媒体/资产协作分发运行时.ts frontend/tests/资产协作分发运行时测试.spec.ts
git commit -m "收口 WebTorrent 前端会话生命周期 owner"
```

---

## Task 3: 修正 reader、listener、join ticket 与 route drain 的退场语义

**Files:**

- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`

- [ ] **Step 1: 写 light help 无 reader 红测**

```ts
it("light_help 只保留协作价值，不持有前台播放级 reader", async () => {
  const runtime = 创建资产协作分发运行时({ createWebTorrentRuntime: fakeWebTorrentRuntime });
  await runtime.解析协作分发源({
    attachmentId: "att-reader-budget",
    consumerId: "timeline",
    mode: "heavy_playback",
  });

  runtime.释放协作分发消费者("att-reader-budget", "timeline");

  const session = runtime.读取会话状态("att-reader-budget");
  expect(session?.lifecycle.state).toBe("light_help");
  expect(session?.lifecycle.activeReaderCount).toBe(0);
  expect(runtime.读取预算().zeroRefWholeFileReaderCount).toBe(0);
});
```

- [ ] **Step 2: 写 route drain 红测**

```ts
it("最后一个消费者释放后 route drain 只按 generation 与 ref-count 收尾", async () => {
  const runtime = 创建资产协作分发运行时({ createWebTorrentRuntime: fakeRuntimeWithRouteDrainSpy });
  await runtime.解析协作分发源({ attachmentId: "att-drain", consumerId: "viewer", mode: "heavy_playback" });

  runtime.释放协作分发消费者("att-drain", "viewer");

  expect(runtime.读取会话状态("att-drain")?.lifecycle.state).toMatch(/draining|light_help|locally_complete/);
  expect(fakeRuntimeWithRouteDrainSpy.removeCalledBeforeDrainMs).toBe(false);
});
```

- [ ] **Step 3: 实现集中释放**

集中释放顺序：

1. consumer 归零后先撤前台 reader 和 preview/source consumer。
2. 如果 session 仍在补齐或已本地完整，转 `light_help` 或 `locally_complete`。
3. 如果没有协作价值，转 `draining`，等 adapter 的 route drain 尾波结束。
4. drain 完成且 generation 未变，才转 `dropped` 并解绑 listener/timer。
5. 任何 terminal reason 都必须清 join ticket refresh、presence heartbeat、torrent event listener。

- [ ] **Step 4: adapter 保持薄**

`frontend/媒体/媒体协作分发.ts` 只需要暴露必要的 dispose/drain 信号。禁止在 adapter 内判断 `MEDIA_READY`、删除态、帮助态。

- [ ] **Step 5: 转绿**

Run:

```powershell
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts" "tests/媒体协作分发测试.spec.ts"
```

Expected: 无 `MaxListenersExceededWarning`，reader/listener 预算断言通过。

- [ ] **Step 6: 提交**

```powershell
git add frontend/媒体/资产协作分发运行时.ts frontend/媒体/媒体协作分发.ts frontend/tests/资产协作分发运行时测试.spec.ts frontend/tests/媒体协作分发测试.spec.ts
git commit -m "修正 WebTorrent reader listener 与 route drain 生命周期"
```

---

## Task 4: 把运行时生命周期投影到媒体预算，不让 UI 层自判重量

**Files:**

- Modify: `frontend/媒体/信息流视频预算.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/信息流视频预算测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`

- [ ] **Step 1: 写预算投影红测**

```ts
it("WebTorrent session 生命周期只投影重量，不改写 media_state 业务真相", () => {
  const budget = 计算信息流视频预算({
    mediaStateCode: "MEDIA_CONNECTING_TO_PEERS",
    webTorrentLifecycle: { state: "light_help", activeReaderCount: 0 },
    isAutoplayOwner: false,
    isViewerOwner: false,
  });

  expect(budget.weightTier).toBe("light_help");
  expect(budget.mediaStateCode).toBe("MEDIA_CONNECTING_TO_PEERS");
  expect(budget.activeStreamReaderCount).toBe(0);
});
```

- [ ] **Step 2: 写编排层单 session 红测**

```ts
it("自动播放和查看器消费者复用同一协作分发 session", async () => {
  const orchestration = 创建聊天媒体编排(构造测试依赖());
  await orchestration.进入自动播放帮助链("att-one-session");
  await orchestration.打开查看器("att-one-session");

  const snapshot = orchestration.读取预算快照();
  expect(snapshot.webTorrent.sessions.filter((s) => s.attachmentId === "att-one-session")).toHaveLength(1);
  expect(snapshot.webTorrent.sessions[0].consumers.sort()).toEqual(["autoplay", "viewer"]);
});
```

- [ ] **Step 3: 实现只读投影**

实现要求：

- `信息流视频预算.ts` 只能读生命周期快照。
- `聊天媒体编排.ts` 只把不同消费者映射成同一 session 的不同 `consumerId/mode`。
- UI 壳层只消费 `budgetSnapshot`，禁止重新推导 WebTorrent ready 或 source reader。

- [ ] **Step 4: 转绿**

Run:

```powershell
pnpm --dir frontend test -- "tests/信息流视频预算测试.spec.ts" "tests/聊天媒体编排测试.spec.ts"
```

- [ ] **Step 5: 提交**

```powershell
git add frontend/媒体/信息流视频预算.ts frontend/聊天媒体编排.ts frontend/tests/信息流视频预算测试.spec.ts frontend/tests/聊天媒体编排测试.spec.ts
git commit -m "把 WebTorrent 生命周期接入信息流预算投影"
```

---

## Task 5: 后端强类型 availability 与 seeder decision

**Files:**

- Modify: `src/媒体协作分发.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 写表驱动红测**

在 `tests/协作分发测试/可用性裁决.rs` 增加场景表：

```rust
#[test]
fn 可用性裁决表覆盖强种子完整peer片段peer删除态() {
    struct Case {
        name: &'static str,
        web_seed_available: bool,
        complete_peer_fresh: bool,
        partial_peer_fresh: bool,
        backend_seed_fresh: bool,
        deleted: bool,
        expected_code: &'static str,
    }

    let cases = [
        Case { name: "web seed 可用", web_seed_available: true, complete_peer_fresh: false, partial_peer_fresh: false, backend_seed_fresh: false, deleted: false, expected_code: "MEDIA_READY" },
        Case { name: "完整 peer 可用", web_seed_available: false, complete_peer_fresh: true, partial_peer_fresh: false, backend_seed_fresh: false, deleted: false, expected_code: "MEDIA_READY" },
        Case { name: "后端强种子可用", web_seed_available: false, complete_peer_fresh: false, partial_peer_fresh: false, backend_seed_fresh: true, deleted: false, expected_code: "MEDIA_READY" },
        Case { name: "只有片段 peer 只能 connecting", web_seed_available: false, complete_peer_fresh: false, partial_peer_fresh: true, backend_seed_fresh: false, deleted: false, expected_code: "MEDIA_CONNECTING_TO_PEERS" },
        Case { name: "删除态最高优先级", web_seed_available: true, complete_peer_fresh: true, partial_peer_fresh: true, backend_seed_fresh: true, deleted: true, expected_code: "MEDIA_DELETED" },
    ];

    for case in cases {
        let result = 裁决测试用协作分发媒体状态(case);
        assert_eq!(result.code, case.expected_code, "{}", case.name);
    }
}
```

如果当前测试模块不能直接访问私有函数，先在生产代码里暴露 `pub(crate)` 纯 reducer，再由现有外壳函数调用它。

- [ ] **Step 2: 增加 Rust enum**

在 `src/媒体协作分发.rs` 中增加内部类型：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PeerKind {
    ViewerIntent,
    PartialPeer,
    CompletePeer,
    BackendStrongSeed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Availability {
    Ready,
    ConnectingToPeers,
    NoOnlineSeed,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SeederDecision {
    StartOrRefresh,
    ReconcileOnly,
    SkipMissingTorrent,
    SkipExpired,
    StopDeleted,
}
```

实际命名可本地化为中文，但必须是强类型，不再让 string/布尔散落承担业务判断。

- [ ] **Step 3: 增加纯 reducer**

```rust
pub(crate) fn 裁决协作分发媒体可用性(输入: 协作分发可用性输入) -> Availability {
    if 输入.附件已删除 {
        return Availability::Deleted;
    }
    if 输入.web_seed仍可用 || 输入.完整peer新鲜 || 输入.后端强种子新鲜 {
        return Availability::Ready;
    }
    if 输入.片段peer新鲜 || 输入.仍在连接群友窗口内 {
        return Availability::ConnectingToPeers;
    }
    Availability::NoOnlineSeed
}
```

- [ ] **Step 4: 旧 contract 函数只做转换**

保留 `MEDIA_READY / MEDIA_CONNECTING_TO_PEERS / MEDIA_NO_ONLINE_SEED / MEDIA_DELETED` 输出不变：

```rust
fn availability_to_contract_code(availability: Availability) -> &'static str {
    match availability {
        Availability::Ready => 媒体状态已就绪,
        Availability::ConnectingToPeers => 媒体状态连接群友中,
        Availability::NoOnlineSeed => 媒体状态无在线种子,
        Availability::Deleted => 媒体状态已删除,
    }
}
```

- [ ] **Step 5: 转绿**

Run:

```powershell
cargo test --test 协作分发测试 可用性 -- --nocapture
cargo test --test 协作分发测试 -- --nocapture
```

- [ ] **Step 6: 提交**

```powershell
git add src/媒体协作分发.rs src/媒体资产外壳.rs tests/协作分发测试/可用性裁决.rs
git commit -m "用强类型收口 WebTorrent 后端可用性裁决"
```

---

## Task 6: 架构门禁防止第二 owner 和第二字节链回流

**Files:**

- Modify: `scripts/check-frontend-architecture-fitness.mjs`
- Modify: `frontend/tests/架构适应度测试.spec.ts` if present, otherwise keep script-level check only.

- [ ] **Step 1: 写门禁红测或脚本断言**

新增扫描规则：

- 未登记文件出现 `createMachine(` 或 `createActor(` 直接失败。
- `房间消息窗.ts`、`媒体查看器.ts`、`全局唯一播放器.ts` 禁止 import `webtorrent`、`媒体协作分发.ts` 低层构造器或 `createServer`。
- 禁止新增 `frontend/媒体/全局唯一WebTorrent.ts`、`frontend/媒体/WebTorrent状态机.ts` 等并列 owner 文件。
- 禁止 `original_url`、`hls`、`dash`、`cdn` 被新主链视频正式播放路径引用。

- [ ] **Step 2: 注册唯一 owner**

确认 `前端运行时Owner注册表` 中只有既有 owner：

```js
{
  path: "frontend/媒体/资产协作分发运行时.ts",
  symbol: "资产协作分发机",
}
```

如果 `全局丝滑自动播.ts` 已存在，保持它作为播放连续性 owner 登记；不要把它和 WebTorrent owner 混成一颗。

- [ ] **Step 3: 跑门禁**

Run:

```powershell
node scripts/check-frontend-architecture-fitness.mjs
```

Expected: 当前仓库通过；手工临时加入违规片段时能失败。临时片段不得提交。

- [ ] **Step 4: 提交**

```powershell
git add scripts/check-frontend-architecture-fitness.mjs
git commit -m "加固 WebTorrent owner 架构门禁"
```

---

## Task 7: 真实启动链 join ticket 和 tracker warning 回归

**Files:**

- Modify only if needed: `frontend/dev-seeder.mjs`
- Modify only if needed: `run.ps1`
- Modify only if needed: `qingli.ps1`
- Modify only if needed: `tests/启动器脚本检查.ps1`
- Modify only if needed: `src/外壳.rs`

本任务不是“日志降噪”。目标是证明受保护 tracker 的首帧一定由 locator/join ticket 路径进入，缺票只能出现在恶意或陈旧连接，不应由正常 `run.ps1`/`qingli.ps1` 开发启动链稳定产生。

- [ ] **Step 1: 先复现并抓证据**

Run:

```powershell
.\qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles -OptimizeStartupArtifacts
.\run.ps1
```

记录：

- backend 日志里是否仍出现 `swarm_tracker_join_ticket_invalid`。
- `frontend/dev-seeder.mjs` 是否对已有会话刷新 `announceTicketRef`。
- `/api/media/{attachment}/locator` 是否返回 `join_ticket`。
- tracker 首帧是否带 `join_ticket`。

- [ ] **Step 2: 如果正常链路缺票，先写测试**

优先使用已有 `tests/启动器脚本检查.ps1` 和 `frontend/tests/资产协作分发运行时测试.spec.ts`，覆盖：

```powershell
pwsh -File tests/启动器脚本检查.ps1
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts"
```

新增断言必须证明“已有 session 刷新 join ticket 后，下一次 announce 使用新票”，不要只断言日志字符串消失。

- [ ] **Step 3: 修根因**

允许修的根因只有：

- locator 缺 `join_ticket`。
- 前端 runtime 没有把新 ticket 写入活 session。
- dev seeder 对账没有把新 ticket 写回 `announceTicketRef`。
- run/qingli 留下旧进程导致旧无票会话继续 announce。
- tracker proxy 错把门禁拒绝记录成 upstream proxy failure。

禁止修法：

- 放宽 tracker 验票。
- 缺票时自动补一个假票。
- 把 warn 改 debug 伪装成功。
- 让浏览器或 seeder 直连裸 tracker upstream。

- [ ] **Step 4: 验证**

Run:

```powershell
pwsh -File tests/启动器脚本检查.ps1
cargo test --test 协作分发测试 同源tracker代理 -- --nocapture
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts"
```

Expected: 正常启动链不再稳定产生 missing ticket；恶意/缺票首帧仍被拒绝。

---

## Task 8: 全量验证与浏览器烟测

**Files:**

- No production edits unless smoke exposes real bug.
- Update test/docs only if verification command or smoke evidence changes.

- [ ] **Step 1: 前端全量验证**

```powershell
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
node scripts/check-frontend-architecture-fitness.mjs
node scripts/check-frontend-browser-app-constitution.mjs
```

- [ ] **Step 2: 后端全量验证**

```powershell
cargo test -j 1
pwsh -File tests/启动器脚本检查.ps1
pwsh -File tests/powershell/https-script.tests.ps1
```

- [ ] **Step 3: graphify 更新**

代码修改后必须运行：

```powershell
graphify update .
```

纯文档计划不需要执行本步；真正实施代码时必须执行。

- [ ] **Step 4: 真实浏览器烟测**

必须用 `chrome-devtools-cli` 与 `playwright-cli` 两条 CLI 链路，不允许临时 Node/Playwright 脚本替代。

最小烟测矩阵：

- `https://127.0.0.1` 或 `https://localhost`
- 房间 `1234b`
- sender / A / B / C / D 多隔离上下文
- 连续发送视频和图片
- 自动播放进入帮助链
- 查看器打开/关闭/再次打开同一视频
- 前 `24 小时` 后端强 seed
- 后 `24 小时` peer-only
- 无在线种子
- 内容已删除

必须采样：

- WebTorrent runtime lifecycle state
- session lifecycle state
- consumer refs
- active reader count
- listener count 或 `MaxListenersExceededWarning`
- route drain 状态
- peer/download/upload
- `budgetSnapshot`
- console error/warn
- network `/webtorrent/... [206]`
- tracker announce 首帧是否携带 `join_ticket`

- [ ] **Step 5: 收尾提交**

```powershell
git status --short
git add <changed files>
git commit -m "完成 WebTorrent 生命周期 owner 收口"
```

---

## 9. 完成判定

本计划完成后必须同时满足：

- 前端 WebTorrent runtime 只有 `frontend/媒体/资产协作分发运行时.ts` 一个 owner。
- `frontend/媒体/媒体协作分发.ts` 仍是薄 adapter，不拥有业务可用性真相。
- session 主路径和失败路径都有测试。
- `light_help` 不持有前台播放级 reader。
- 旧 generation、旧 source、旧 ticket refresh、旧 listener 不能写回新 session。
- 后端 availability 用 Rust 强类型 reducer 和表驱动测试表达，不靠散落 string/布尔组合。
- tracker 正常开发启动链不再稳定出现 missing ticket；缺票攻击/陈旧连接仍被拒绝。
- 架构门禁能拦住第二 WebTorrent owner、UI 层 WebTorrent 入口和第二正式字节链。
- 浏览器烟测证明自动播放、查看器、全屏、补齐、做种、peer-only、无种子、删除态都没有被削弱。

## 10. 自审清单

执行者完成每个 task 后自查：

- 是否从 owner、状态、generation、reader/listener、contract reducer 这些根因层修，而不是只改日志、guard、timeout？
- 是否减少了旧重复判断路径，而不是让新状态模型和旧逻辑双活？
- 是否保留唯一 WebTorrent 正式字节主链？
- 是否没有削弱自动播放即帮助、滑走不停补齐、补齐后做种？
- 是否没有把 `MEDIA_READY / MEDIA_NO_ONLINE_SEED / MEDIA_DELETED` 交给前端内部状态机裁决？
- 是否每个新增中文注释都在解释职责、数据流或复杂边界，而不是解释语法？
- 是否所有完成声明都有新鲜命令输出和真实烟测证据？

## 11. 编写阶段双重自审记录

### 11.1 第一遍：spec 与官方资料边界审核

结论：通过，已修订。

本轮发现原计划虽然有 WebTorrent / XState / Rust owner 边界，但缺少执行前的官方资料校准，容易让实施者凭经验手搓 stream server、actor 编排或 listener 管理。已补 `0.1 官方资料与成熟实践校准`，把 WebTorrent 官方 stream 路径、XState actor 生命周期、Chrome Page Lifecycle、AbortSignal、`scheduler.yield()`、Rust enum/match 和 listener cleanup 写成执行门槛。

核对结果：

- 没有新增并列 `全局唯一WebTorrent.ts`。
- 没有把后端改成 XState 或通用状态机框架。
- 没有允许 `HLS / DASH / CDN / original_url / 临时 range` 回流为正式播放链。
- WebTorrent 只通过官方 `createServer / streamTo / streamURL` 薄适配。
- XState 只在现有 `资产协作分发运行时.ts` owner 内管理生命周期。
- Chrome hidden/frozen 只作为 owner 输入，不让组件局部各自清理。
- Rust 后端继续是强类型 reducer + contract 投影。

### 11.2 第二遍：执行性、TDD 与反屎山审核

结论：通过，保留为可执行 plan。

核对结果：

- 每个代码任务都有先红测、再实现、再转绿、再提交的顺序。
- 每个任务列出了精确文件和命令，没有要求“到处看看再说”的空泛动作。
- 前端任务先钉生命周期快照和 generation，再改实现，避免先写 guard。
- 后端任务先钉 availability 表驱动测试，再把 string/布尔组合收成 enum/reducer。
- 架构门禁任务明确拦截第二 owner、UI 层 WebTorrent import 和第二字节链。
- `run.ps1 / qingli.ps1` 的 tracker warning 被放在真实启动链回归里，只允许修缺票根因，不允许改日志级别或放宽验票。
- 真实浏览器烟测要求同时走 `chrome-devtools-cli` 和 `playwright-cli`，不允许临时脚本替代。
- 计划没有诱导大重构：只在现有 owner 与既有 Rust 裁决模块内收口。
