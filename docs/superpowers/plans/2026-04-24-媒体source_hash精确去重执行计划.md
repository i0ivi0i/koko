# 多媒体附件精确去重收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `source_hash / content_hash / canonical asset / WebTorrent` 主链已经基本落地的基础上，修掉真实冒烟暴露的 `join_ticket` 续租缺口，让 `docs/superpowers/specs/2026-04-24-多媒体附件精确去重.md` 的验证门禁可长期稳定通过。

**Architecture:** 媒体身份层继续以 `source_hash`、`content_hash`、`canonical_asset_id`、`torrent_info_hash`、`swarm_id` 收口真相；分发层只维护 WebTorrent 会话、tracker ticket 和做种续租。前端运行态、dev seeder 和后端做种对账都必须把同一 `swarm_id / infohash` 视为同一分发会话，禁止因为新附件引用、旧 locator 或过期 ticket 重新制造第二套分发真相。

**Tech Stack:** Rust 2024 + Axum + SQLx + PostgreSQL；TypeScript + Vitest；WebTorrent + bittorrent-tracker；`chrome-devtools-cli` 真实浏览器冒烟测试。

---

## 0. 当前事实

**已经通过真实冒烟验证：**

- 同一 MP4 第一次上传：`source-dedupe miss -> prepare -> TUS -> complete`。
- 同一 MP4 第二次选择：只走 `source-dedupe reused`，没有再次 `prepare / TUS / complete`。
- 两个附件拥有不同 `attachment_id`，但共享同一 `content_hash / swarm_id / torrent_info_hash`。
- `cargo test --test 媒体上传测试 source_hash -- --nocapture` 已覆盖 source_hash、跨房间、不可见探测、删除、转发边界。
- `pnpm vitest run tests/传输测试.spec.ts tests/媒体发布测试.spec.ts --exclude dist/**` 已覆盖前端上传前复用链路。

**真实缺口：**

- tracker / seeder 日志出现 `jwt expired` 和 `join_ticket_invalid`。
- 根因不是 source_hash 去重，而是同一 WebTorrent 会话复用时，旧会话仍可能持有旧 `join_ticket`。
- `frontend/媒体/资产协作分发运行时.ts` 命中已有 `swarm_id` 会话后直接返回，没有把新 locator 的 `join_ticket` 刷进底层会话。
- `frontend/媒体/媒体协作分发.ts` 的 `getAnnounceOpts` 当前闭包读取创建会话时的 `distribution.join_ticket`，不是可续租引用。
- `frontend/dev-seeder.mjs` 对同 infohash 的 `/seed/start` 已有续租意图，但同 infohash 不同 `torrentUrl` 的场景仍要被测试锁死为“续租而不是重建第二真相”。
- 后端做种对账复用 `MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS`，职责混在一个后台循环里；ticket 续租应该有独立 cadence，并且必须小于 ticket TTL。

**本 plan 不重做：**

- 不重新设计 source_hash 算法。
- 不新增感知哈希、AI 相似度、帧级指纹。
- 不新增媒体资产表。
- 不把 `source_hash` 做成全站存在性探针。
- 不把转发分享做成重新上传。

## 1. 文件改动地图

**前端 WebTorrent 运行态：**

- Modify: `frontend/媒体/媒体协作分发.ts`
  - 新增可变 `joinTicketRef`，让 `getAnnounceOpts` 读取最新票据。
- Modify: `frontend/媒体/资产协作分发运行时.ts`
  - 底层 session 持有 `joinTicketRef`。
  - 命中已有 `swarm_id` session 时刷新 `joinTicketRef.value`。
- Test: `frontend/tests/媒体协作分发测试.spec.ts`
  - 低层 `接入协作分发种子` 支持 ticket ref 原地续租。
- Test: `frontend/tests/资产协作分发运行时测试.spec.ts`
  - 同一 swarm 第二次 locator 到达后不重建 WebTorrent torrent，但 announce ticket 变成新值。

**开发态 seeder sidecar：**

- Modify: `frontend/dev-seeder.mjs`
  - 同 infohash 的 `/seed/start` 一律先视为续租。
  - 即使 `torrentUrl` 因新附件引用变化，也只刷新 ticket 和记录 source，不因附件 URL 变化重建做种会话。
- Test: `frontend/tests/dev-seeder做种续租测试.spec.ts`
  - 抽出纯函数测试同 infohash、不同 source、新 ticket 的续租行为。

**后端做种对账：**

- Modify: `src/总装.rs`
  - 新增 `SWARM_SEED_RECONCILE_INTERVAL_SECONDS` 配置。
  - 默认值必须小于 `SWARM_TICKET_TTL_SECONDS`。
- Modify: `src/入口.rs`
  - 媒体冷源清理和协作分发做种对账拆成两个后台循环。
- Test: `src/总装.rs` 内配置单测。

**验收：**

- Verify: `tests/媒体上传测试/source_hash.rs`
- Verify: `frontend/tests/传输测试.spec.ts`
- Verify: `frontend/tests/媒体发布测试.spec.ts`
- Verify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Verify: `frontend/tests/媒体协作分发测试.spec.ts`
- Verify: `chrome-devtools-cli` 真实房间 `1234b` 冒烟。

## 2. Task 1: 红测 - WebTorrent 底层接入支持可变 ticket ref

**Files:**

- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/媒体/媒体协作分发.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/tests/媒体协作分发测试.spec.ts` 的 `join_ticket` 相关用例附近新增：

```ts
it("join_ticket 续租引用更新后 getAnnounceOpts 会读取新票据", async () => {
  const registration = 准备已激活媒体ServiceWorker注册();
  const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-ticket-ref");
  let getAnnounceOpts!: () => Record<string, string | undefined>;
  const add = vi.fn(((_torrentId, options, onTorrent) => {
    getAnnounceOpts = options.getAnnounceOpts!;
    onTorrent(torrent);
    return torrent;
  }) as WebTorrent浏览器客户端["add"]);
  const { ctor } = 创建假WebTorrent构造器(add);
  await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

  const ticketRef = { value: "ticket-old" };
  await 接入协作分发种子(
    {
      client: new ctor(),
      server: { close: vi.fn() } as never,
      streamBaseUrl: "blob:http://media.local",
    },
    {
      ...准备好的协作分发定位片段("att-ticket-ref"),
      join_ticket: "ticket-old",
    },
    { joinTicketRef: ticketRef }
  );

  expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });
  ticketRef.value = "ticket-new";
  expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
});
```

如果本文件没有 `准备好的协作分发定位片段` helper，就按现有 locator helper 改成最小合法 distribution 对象。

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
pnpm --dir frontend vitest run tests/媒体协作分发测试.spec.ts --exclude dist/**
```

Expected: FAIL，`接入协作分发种子` 当前没有第三个 options 参数，`getAnnounceOpts` 仍捕获旧 `distribution.join_ticket`。

- [ ] **Step 3: 实现最小代码**

在 `frontend/媒体/媒体协作分发.ts` 新增类型：

```ts
export interface 协作分发JoinTicketRef {
  value: string | null;
}
```

把 `接入协作分发种子` 签名改成：

```ts
export async function 接入协作分发种子(
  runtime: 协作分发浏览器运行时,
  distribution: 媒体协作分发定位片段,
  options: { joinTicketRef?: 协作分发JoinTicketRef } = {}
): Promise<WebTorrent种子> {
```

在 `client.add` 之前创建 ref：

```ts
const joinTicketRef = options.joinTicketRef ?? { value: distribution.join_ticket };
```

把 `getAnnounceOpts` 改成：

```ts
getAnnounceOpts: () => {
  if (!joinTicketRef.value) {
    return {};
  }
  return { ticket: joinTicketRef.value };
},
```

注释要求：说明 ticket 是 swarm 门禁续租引用，不是播放 UI 状态。

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
pnpm --dir frontend vitest run tests/媒体协作分发测试.spec.ts --exclude dist/**
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontend/媒体/媒体协作分发.ts frontend/tests/媒体协作分发测试.spec.ts
git commit -m "修复：WebTorrent announce 使用可续租入群票据"
```

## 3. Task 2: 红测 - 已有 swarm session 收到新 locator 时刷新 ticket

**Files:**

- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/tests/资产协作分发运行时测试.spec.ts` 增加：

```ts
it("同一 swarm 复用已有会话时会刷新 join_ticket 而不是继续拿旧票 announce", async () => {
  const registration = 准备已激活媒体ServiceWorker注册();
  const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-ticket-renew");
  let getAnnounceOpts!: () => Record<string, string | undefined>;
  const add = vi.fn(((_torrentId, options, onTorrent) => {
    getAnnounceOpts = options.getAnnounceOpts!;
    onTorrent(torrent);
    return torrent;
  }) as WebTorrent浏览器客户端["add"]);
  const { ctor } = 创建假WebTorrent构造器(add);
  await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

  const firstLocator = 准备好的定位结果("att-ticket-a", "swarm-ticket-renew");
  firstLocator.distribution!.join_ticket = "ticket-old";
  firstLocator.distribution!.torrent_info_hash = "torrent-info-same";

  const secondLocator = 准备好的定位结果("att-ticket-b", "swarm-ticket-renew");
  secondLocator.distribution!.join_ticket = "ticket-new";
  secondLocator.distribution!.torrent_info_hash = "torrent-info-same";

  await 解析协作分发源({
    attachmentId: "att-ticket-a",
    kind: "video",
    locator: firstLocator,
    consumerId: "session:att-ticket-a",
  });
  expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });

  await 解析协作分发源({
    attachmentId: "att-ticket-b",
    kind: "video",
    locator: secondLocator,
    consumerId: "session:att-ticket-b",
  });

  expect(add).toHaveBeenCalledTimes(1);
  expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
  expect(读取协作分发会话状态("swarm-ticket-renew")).toMatchObject({
    refs: 2,
    consumers: ["session:att-ticket-a", "session:att-ticket-b"],
  });
});
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
pnpm --dir frontend vitest run tests/资产协作分发运行时测试.spec.ts --exclude dist/**
```

Expected: FAIL，第二次解析复用旧 session 后 `getAnnounceOpts()` 仍返回 `ticket-old`。

- [ ] **Step 3: 实现最小代码**

在 `frontend/媒体/资产协作分发运行时.ts` 导入 `协作分发JoinTicketRef`。

扩展 `底层协作分发会话`：

```ts
type 底层协作分发会话 = Omit<协作分发底层会话, "consumerBindings"> & {
  consumerBindings: Map<string, 协作分发消费者绑定>;
  previewPriorityApplied: boolean;
  joinTicketRef: 协作分发JoinTicketRef;
};
```

新增小函数：

```ts
function 刷新协作分发会话票据(
  session: 底层协作分发会话,
  distribution: NonNullable<ReturnType<typeof 读取协作分发定位片段>>
): void {
  // join_ticket 是 tracker 入群门禁，跟随最新 locator 续租；这里不改变媒体身份和业务附件事实。
  session.joinTicketRef.value = distribution.join_ticket ?? null;
}
```

在命中已有 session 分支靠前位置调用：

```ts
刷新协作分发会话票据(session, input.distribution);
```

新建 session 时：

```ts
joinTicketRef: { value: input.distribution.join_ticket ?? null },
```

调用 `接入协作分发种子` 时传入：

```ts
const torrent = await 接入协作分发种子(browserRuntime, input.distribution, {
  joinTicketRef: session.joinTicketRef,
});
```

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
pnpm --dir frontend vitest run tests/资产协作分发运行时测试.spec.ts tests/媒体协作分发测试.spec.ts --exclude dist/**
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontend/媒体/资产协作分发运行时.ts frontend/tests/资产协作分发运行时测试.spec.ts
git commit -m "修复：复用swarm会话时刷新入群票据"
```

## 4. Task 3: 红测 - dev seeder 同 infohash 不因新附件 URL 重建会话

**Files:**

- Modify: `frontend/dev-seeder.mjs`
- Create: `frontend/tests/dev-seeder做种续租测试.spec.ts`

- [ ] **Step 1: 把 dev-seeder 先改成可测试结构的红测目标**

新增测试文件 `frontend/tests/dev-seeder做种续租测试.spec.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { 刷新已有做种会话 } from "../dev-seeder.mjs";

describe("dev-seeder 做种续租", () => {
  it("同 infohash 的 start 即使 source URL 变化也只刷新 ticket 不重建会话", async () => {
    const existing = {
      infoHash: "same-infohash",
      source: "http://127.0.0.1:8080/api/media/att-old/torrent?session_id=s-1",
      joinTicket: "ticket-old",
      announceTicketRef: { value: "ticket-old" },
      torrent: { destroy: vi.fn() },
      addedAt: new Date().toISOString(),
    };

    const result = 刷新已有做种会话(existing as never, {
      source: "http://127.0.0.1:8080/api/media/att-new/torrent?session_id=s-1",
      joinTicket: "ticket-new",
    });

    expect(result).toEqual({
      created: false,
      refreshedTicket: true,
      restarted: false,
      sourceChanged: true,
    });
    expect(existing.joinTicket).toBe("ticket-new");
    expect(existing.announceTicketRef.value).toBe("ticket-new");
    expect(existing.source).toContain("att-new");
  });
});
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
pnpm --dir frontend vitest run tests/dev-seeder做种续租测试.spec.ts --exclude dist/**
```

Expected: FAIL，`dev-seeder.mjs` 当前没有导出纯函数，且同 infohash 不同 source 的续租语义没有测试保护。

- [ ] **Step 3: 最小重构 dev-seeder**

在 `frontend/dev-seeder.mjs` 中导出纯函数：

```js
export const 刷新已有做种会话 = (existing, input) => {
  const nextTicket = input.joinTicket ?? null;
  const refreshedTicket = existing.joinTicket !== nextTicket;
  const sourceChanged = existing.source !== input.source;
  if (refreshedTicket) {
    existing.joinTicket = nextTicket;
    if (existing.announceTicketRef) {
      existing.announceTicketRef.value = nextTicket;
    }
  }
  if (sourceChanged) {
    // source 只是同 infohash 的取种入口；同一 infohash 不应因新附件 URL 变化重建做种会话。
    existing.source = input.source;
  }
  return { created: false, refreshedTicket, restarted: false, sourceChanged };
};
```

把 `启动做种会话` 的 existing 分支改成：

```js
if (existing) {
  const refreshed = 刷新已有做种会话(existing, { source, joinTicket });
  return { session: existing, ...refreshed };
}
```

如果 `dev-seeder.mjs` 被 Vitest import 时会直接监听端口，必须把 `server.listen(...)` 包进 `main()`，并加：

```js
if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main();
}
```

Windows 路径判断要在测试中验证不启动服务器；必要时用 `pathToFileURL`，不要手搓不可靠路径拼接。

- [ ] **Step 4: 跑测试转绿**

Run:

```powershell
pnpm --dir frontend vitest run tests/dev-seeder做种续租测试.spec.ts --exclude dist/**
```

Expected: PASS。

- [ ] **Step 5: 回归 sidecar 不破坏启动**

Run:

```powershell
node frontend/dev-seeder.mjs --port 17073
```

Expected: 能正常监听；手动 Ctrl+C 退出。若命令会挂住，看到监听日志后停止即可。

- [ ] **Step 6: 提交**

```powershell
git add frontend/dev-seeder.mjs frontend/tests/dev-seeder做种续租测试.spec.ts
git commit -m "修复：dev seeder按infohash续租做种会话"
```

## 5. Task 4: 后端做种对账独立续租周期

**Files:**

- Modify: `src/总装.rs`
- Modify: `src/入口.rs`

- [ ] **Step 1: 写配置红测**

在 `src/总装.rs` 现有协作分发配置测试附近新增：

```rust
#[test]
fn 做种对账间隔默认小于join_ticket_ttl() {
    备份并清空环境变量(|_| {
        std::env::set_var("SWARM_TICKET_TTL_SECONDS", "120");
        let config = 读取协作分发配置().expect("默认做种对账间隔应可读");
        assert!(config.swarm_seed_reconcile_interval_seconds > 0);
        assert!(config.swarm_seed_reconcile_interval_seconds < config.ticket_ttl_seconds);
    });
}

#[test]
fn 做种对账间隔不能大于等于join_ticket_ttl() {
    备份并清空环境变量(|_| {
        std::env::set_var("SWARM_TICKET_TTL_SECONDS", "30");
        std::env::set_var("SWARM_SEED_RECONCILE_INTERVAL_SECONDS", "30");
        let err = 读取协作分发配置().expect_err("做种对账间隔不能覆盖 ticket 全生命周期");
        assert!(err.to_string().contains("SWARM_SEED_RECONCILE_INTERVAL_SECONDS"));
    });
}
```

- [ ] **Step 2: 跑红测**

Run:

```powershell
cargo test 做种对账间隔 --lib -- --nocapture
```

Expected: FAIL，配置字段不存在。

- [ ] **Step 3: 实现配置**

在 `协作分发配置` 增加：

```rust
pub swarm_seed_reconcile_interval_seconds: i64,
```

读取逻辑：

```rust
let default_seed_reconcile_interval_seconds = (ticket_ttl_seconds / 2).clamp(5, 60);
let swarm_seed_reconcile_interval_seconds = 读取可选整数(
    "SWARM_SEED_RECONCILE_INTERVAL_SECONDS",
    default_seed_reconcile_interval_seconds,
)?;
if swarm_seed_reconcile_interval_seconds <= 0
    || swarm_seed_reconcile_interval_seconds >= ticket_ttl_seconds
{
    return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "环境变量 SWARM_SEED_RECONCILE_INTERVAL_SECONDS 必须大于 0 且小于 SWARM_TICKET_TTL_SECONDS",
    ));
}
```

- [ ] **Step 4: 拆分后台循环**

在 `src/入口.rs` 中保留媒体冷源/上传残留清理循环，再新增独立做种对账循环：

```rust
let seed_reconcile_state = state.clone();
let seed_reconcile_interval_seconds = config.协作分发.swarm_seed_reconcile_interval_seconds;
let seed_reconcile_handle = tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(
        seed_reconcile_interval_seconds as u64,
    ));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        if let Err(err) =
            crate::shell::执行一次协作分发做种对账(seed_reconcile_state.clone()).await
        {
            tracing::error!(
                usecase = "协作分发做种对账",
                adapter = "entry",
                outcome = "failed",
                error = %err,
                "后台协作分发做种对账失败"
            );
        }
    }
});
```

停机时同时 `abort()` 两个 handle。注释必须说明：做种续租不再挂在冷源清理周期上。

- [ ] **Step 5: 跑后端测试**

Run:

```powershell
cargo test 做种对账间隔 --lib -- --nocapture
cargo test source_hash --test 媒体上传测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/总装.rs src/入口.rs
git commit -m "修复：协作分发做种对账使用独立续租周期"
```

## 6. Task 5: 内容身份命名风险守卫

**Files:**

- Modify: `tests/媒体上传测试/source_hash.rs`
- Modify only if needed: `src/用例.rs`
- Modify only if needed: `src/媒体协作分发.rs`

- [ ] **Step 1: 写守卫测试**

在 `tests/媒体上传测试/source_hash.rs` 增加或补强现有断言：

```rust
#[tokio::test]
#[serial]
async fn source_hash复用附件允许业务content_id不同但分发身份必须完全一致() {
    // 复用已有 helper 上传同一 source_hash 两次。
    // 断言 attachment_id 不同。
    // 断言 content_hash / swarm_id / torrent_info_hash 完全一致。
    // 断言测试名明确 content_id 不是分发身份 owner。
}
```

如果现有测试已经覆盖同等断言，只改测试名和注释，不新增重复测试。

- [ ] **Step 2: 跑测试**

Run:

```powershell
cargo test source_hash复用附件允许业务content_id不同但分发身份必须完全一致 --test 媒体上传测试 -- --nocapture
```

Expected: PASS 或通过最小补充断言后 PASS。

- [ ] **Step 3: 必要时补注释**

如果 `src/用例.rs` 或 `src/媒体协作分发.rs` 中 `content_id` 容易被误读为 canonical 身份，补中文注释：

```rust
// content_id 保留附件级业务内容引用；真正的分发身份只认 content_hash / torrent_info_hash / swarm_id。
```

禁止顺手做 schema rename；那是单独迁移，不属于本收尾计划。

- [ ] **Step 4: 提交**

```powershell
git add tests/媒体上传测试/source_hash.rs src/用例.rs src/媒体协作分发.rs
git commit -m "测试：锁定媒体分发身份不依赖附件content_id"
```

## 7. Task 6: 真实浏览器冒烟验收

**Files:**

- Verify only.

- [ ] **Step 1: 启动本地应用**

Run:

```powershell
$env:SWARM_TICKET_TTL_SECONDS="30"
$env:SWARM_SEED_RECONCILE_INTERVAL_SECONDS="10"
powershell -NoProfile -ExecutionPolicy Bypass -File E:\koko\run.ps1 -DisableLocalHttpsBootstrap -DisableAutoOptimizeCleanup -ForceInitialFrontendBuild
```

Expected:

- 后端 8080 监听。
- tusd 1081 监听。
- tracker 7072 监听。
- seeder 7073 监听。

- [ ] **Step 2: 用 chrome-devtools-cli 进入房间**

Run:

```powershell
chrome-devtools navigate_page --url "http://127.0.0.1:8080/" --timeout 30000
chrome-devtools take_snapshot --verbose false
```

Expected: 页面打开，进入或可进入房间 `1234b`。
如果当前快照没有直接进入房间，先用快照里可见的输入框和按钮 uid 进入房间，再重新执行 `chrome-devtools take_snapshot --verbose false`。

- [ ] **Step 3: 上传同一个 MP4 两次**

使用文件：

```text
D:\200-生活\230-照片备份\233-Telegram\色色\VID_20230706_205015_863.mp4
```

流程：

```powershell
$snapshotBeforeUpload = chrome-devtools take_snapshot --verbose false
$snapshotBeforeUpload | Set-Content -LiteralPath ".\target\媒体去重-上传前快照.txt" -Encoding UTF8
Select-String -LiteralPath ".\target\媒体去重-上传前快照.txt" -Pattern "file|upload|上传|附件|视频" -Context 1,1

# 从上一条 Select-String 输出中取文件输入控件 uid；该 uid 由浏览器运行时动态生成，禁止在计划里写死。
$fileInputUid = Read-Host "粘贴上传前快照中的文件输入 uid"

chrome-devtools upload_file $fileInputUid "D:\200-生活\230-照片备份\233-Telegram\色色\VID_20230706_205015_863.mp4" --includeSnapshot true
Start-Sleep -Seconds 8
chrome-devtools upload_file $fileInputUid "D:\200-生活\230-照片备份\233-Telegram\色色\VID_20230706_205015_863.mp4" --includeSnapshot true
Start-Sleep -Seconds 8
chrome-devtools list_network_requests --includePreservedRequests true --pageSize 300
```

Expected:

- 第一次有 `POST /api/media/video/source-dedupe` -> `miss`。
- 第一次有 `/prepare`、`1081/files`、`/complete`。
- 第二次只有 `POST /api/media/video/source-dedupe` -> `reused`。
- 第二次没有新的 `/prepare`、`1081/files`、`/complete`。

- [ ] **Step 4: 发送并读取 locator**

Run:

```powershell
$snapshotBeforeSend = chrome-devtools take_snapshot --verbose false
$snapshotBeforeSend | Set-Content -LiteralPath ".\target\媒体去重-发送前快照.txt" -Encoding UTF8
Select-String -LiteralPath ".\target\媒体去重-发送前快照.txt" -Pattern "send|发送|发布|提交" -Context 1,1

# 从上一条 Select-String 输出中取发送按钮 uid；该 uid 由浏览器运行时动态生成，禁止在计划里写死。
$sendButtonUid = Read-Host "粘贴发送前快照中的发送按钮 uid"

chrome-devtools click $sendButtonUid --includeSnapshot true
chrome-devtools list_network_requests --includePreservedRequests true --pageSize 300

# 从网络列表中过滤 locator 请求，记录本轮两个附件对应的 reqid 后分别读取响应体。
chrome-devtools list_network_requests --includePreservedRequests true --pageSize 300 |
  Select-String -Pattern "locator|attachment|media"
$locatorReqidA = Read-Host "粘贴第一个 locator 请求 reqid"
$locatorReqidB = Read-Host "粘贴第二个 locator 请求 reqid"
chrome-devtools get_network_request $locatorReqidA
chrome-devtools get_network_request $locatorReqidB
```

Expected:

- 两个附件 `attachment_id` 不同。
- 两个 locator 的 `content_hash` 相同。
- 两个 locator 的 `swarm_id` 相同。
- 两个 locator 的 `torrent_info_hash` 相同。
- `join_ticket` 非空，`ticket_expires_at` 晚于当前时间。

- [ ] **Step 5: 等待超过旧 ticket 半生命周期并验证没有过期风暴**

Run:

```powershell
Start-Sleep -Seconds 45
$logDir = Get-ChildItem -LiteralPath "$env:TEMP\koko-runner" -Directory -ErrorAction Stop |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
Select-String -LiteralPath (Join-Path $logDir "tracker.stderr.log") -Pattern "jwt expired|join_ticket_invalid" | Select-Object -Last 20
Select-String -LiteralPath (Join-Path $logDir "webtorrent-seeder.stderr.log") -Pattern "jwt expired|join_ticket_invalid" | Select-Object -Last 20
```

Expected:

- 本轮测试产生的 `torrent_info_hash` 不再出现 `jwt expired`。
- 不再持续追加 `join_ticket_invalid` 风暴。
- 如果其他历史 infohash 仍有旧噪音，必须按时间和 infohash 区分，不能误判当前修复失败。

- [ ] **Step 6: 清理测试进程**

Run:

```powershell
Get-NetTCPConnection -LocalPort 8080,1081,7072,7073 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

停止本轮 `run.ps1` 启动的进程，避免遗留后台服务。

## 8. Task 7: 全量回归与收尾

**Files:**

- Verify only.

- [ ] **Step 1: 后端回归**

Run:

```powershell
cargo test source_hash --test 媒体上传测试 -- --nocapture
cargo test complete --test 媒体上传测试 -- --nocapture
cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -- --nocapture
cargo test 共享canonical资产超过24小时只删除一次并同步标记所有引用附件 --test 媒体后台测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 2: 前端回归**

Run:

```powershell
pnpm --dir frontend vitest run tests/媒体协作分发测试.spec.ts tests/资产协作分发运行时测试.spec.ts tests/传输测试.spec.ts tests/媒体发布测试.spec.ts tests/源文件哈希测试.spec.ts --exclude dist/**
pnpm --dir frontend typecheck
```

Expected: PASS。

- [ ] **Step 3: 格式和脏尾巴检查**

Run:

```powershell
cargo fmt --check
git diff --check
git status --short
```

Expected:

- `cargo fmt --check` PASS。
- `git diff --check` 无输出。
- `git status --short` 只包含本计划改动。

- [ ] **Step 4: 刷新 graphify**

Run:

```powershell
python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graphify 刷新完成。若本机 Python 环境缺依赖，只记录失败原因，不改业务代码绕过。

- [ ] **Step 5: 最终提交**

```powershell
git add frontend src tests graphify-out
git commit -m "完成：多媒体附件精确去重收尾"
```

## 9. 自审清单

**按 writing-plans 审查：**

- [x] 计划已保存到 `docs/superpowers/plans/2026-04-24-媒体source_hash精确去重执行计划.md`。
- [x] 每个任务都有明确文件、红测、运行命令、期望结果、提交点。
- [x] 计划没有让执行者凭记忆修改；关键任务要求重新跑测试和真实浏览器验证。
- [x] 计划没有新增 `.rs` 文件。
- [x] 计划没有重复重做已经验证通过的 source_hash / canonical asset / forward 主链。

**按 spec 红线审查：**

- [x] 没有把 `source_hash` 做成感知哈希或全站探针。
- [x] 没有把业务附件复用偷换成消息复用。
- [x] 没有把播放器或 WebTorrent 反向抬成媒体身份 owner。
- [x] 同 canonical 字节仍只认 `content_hash / swarm_id / torrent_info_hash`。
- [x] 转发分享仍不要求客户端持有原文件。

**按本次根因审查：**

- [x] 明确区分“source_hash 去重已通过”和“WebTorrent ticket 生命周期未闭合”。
- [x] 前端已有 swarm 会话必须刷新 `join_ticket`。
- [x] dev seeder 同 infohash 必须续租而不是因附件 URL 变化重启。
- [x] 后端做种对账周期必须小于 ticket TTL。
- [x] 验收必须用 `chrome-devtools-cli` 复现同一 MP4 二次上传并观察网络/locator/log。

## 10. 执行建议

建议选择 **Inline Execution**。

原因：

1. 改动集中在前端运行态、dev sidecar 和后端启动配置，文件之间有顺序依赖。
2. 真实根因需要 TDD + 浏览器冒烟串起来验证，平行 worker 容易各修一半。
3. 每个 task 都有提交点，可以一口气执行但保留回滚边界。

执行时先做 Task 1 和 Task 2；如果这两步已经消除浏览器侧 stale ticket，再做 Task 3 和 Task 4 强化 seeder 与后台续租。
