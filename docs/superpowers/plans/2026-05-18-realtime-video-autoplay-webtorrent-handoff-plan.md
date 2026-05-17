# 实时视频自动播 WebTorrent 接力修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让实时新发视频在接收端无需刷新、无需点击，也能沿唯一 WebTorrent 主链完成 `prefetch -> foreground -> streamURL 首字节 -> playback -> canonical 首帧揭帘`。

**Architecture:** 本轮只收紧前端媒体 application/adapter/shell 交接，不改后端 contract，不新增媒体协议，不把原文件直链塞给 `<video>`。权威播放源仍由 `媒体播放.ts` 和 `资产协作分发运行时.ts` 裁决，`Video.js` 与时间线 DOM 只消费已经证明可读的 `webtorrent_official_stream`。

**Tech Stack:** TypeScript 6, Vitest 4, WebTorrent 2.8 browser runtime, Service Worker `file.streamURL`, Lit timeline shell, PowerShell `pwsh`, HTTPS local smoke through `https.ps1`.

---

## Source Design

- Spec: `docs/superpowers/specs/2026-05-17-realtime-video-autoplay-webtorrent-handoff-design.md`
- Spec commit: `3fb72a7d docs: 写实时视频自动播 WebTorrent 接力修复设计`
- Chosen protocol:

```text
prefetch_ready
  -> foreground_locator_refreshing
  -> web_seed_attached
  -> stream_first_chunk_ready
  -> playback_resolved
  -> canonical_frame_committed
```

## Current Evidence

- `frontend/媒体/媒体协作分发.ts:267-303` 已读取一个 body chunk，但目前把 `response.body === null` 当成成功，并且只在 timeout 时取消 reader。
- `frontend/媒体/资产协作分发运行时.ts:401-411` 已通过 `torrent.addWebSeed` 把当前 locator 的 `web_seed_url` 注入同一 torrent。
- `frontend/媒体/资产协作分发运行时.ts:863-877` 已支持 `prefetch` 会话升级成前台 reader 并复用 `session.file.streamURL`。
- `frontend/媒体/媒体播放.ts:310-349` 已在前台视频首开时强刷 locator。
- `frontend/媒体/媒体播放.ts:573-589` 已在 `MEDIA_CONNECTING_TO_PEERS` 轮询里 await force-refresh 后再重试 `resolveSwarmSource`。
- `frontend/房间消息窗/视频附件渲染.ts:196-201` 已在当前可见 canonical host 真出帧前保持揭帘门禁。
- `frontend/tests/媒体播放定位刷新测试.spec.ts` 已覆盖 locator force-refresh 和 await-refresh retry。
- `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts` 已覆盖 prefetch-to-foreground 复用和同 torrent `addWebSeed`。
- `frontend/tests/媒体协作分发源探测测试.spec.ts` 已覆盖 body chunk timeout，但未覆盖 missing body 和成功后 reader cancel。
- `frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts` 已覆盖 room_event rich distribution hint 立即触发 `prefetch` swarm join。
- `frontend/tests/聊天应用内核/消息流自动播测试.spec.ts` 已覆盖 inline autoplay 首轮 `connecting_to_peers` 后继续低频重试直到真实 `swarm`。
- `frontend/tests/媒体协作分发/定位与运行时引导测试.spec.ts` 与 `frontend/tests/媒体协作分发/接入与票据门禁测试.spec.ts` 已覆盖 Service Worker / WebTorrent stream server 引导、可用 media_state、受控 announce 和 join ticket 门禁。

## Root Gap This Plan Fixes

当前仍存在一个会把“HTTP 头成功”误判为“正式字节可读”的路径：

```text
HTTP 206 / ok response
  -> response.body is null
  -> helper returns success
  -> foreground may publish a source whose bytes were never proven readable
```

这和 design spec 的 `stream_first_chunk_ready` 不一致，也是实时自动播黑灰占位最危险的假成功边界。本计划先用 RED 测试钉住这个缺口，再做最小实现。

## Confidence Loop Findings Added on 2026-05-18

第一次追问“是否 100% 有信心”时，答案是：**不是**。原 plan 只完整覆盖了 streamURL 首字节和 timeline reveal，但“群内媒体收发丝滑自动播放”还必须证明三条入口不会断：

1. **群内实时接收入口**：`room_event -> rich distribution_hint -> prefetch swarm join` 必须进入 targeted suite，否则可能只修了查看器/历史路径，没修在线群聊实时路径。
2. **自动播重试入口**：`inline_autoplay -> connecting_to_peers -> 2s retry -> swarm` 必须进入 targeted suite，否则可能把黑灰占位换成“owner 还在但永远没有 playback”。
3. **假 ready 的临时不可读入口**：`MEDIA_READY -> streamURL 暂无 body chunk -> source_unreadable -> forceRefresh + retry -> swarm` 必须有 characterization test，否则严格探测可能把一次 Service Worker/WebTorrent 接管抖动升级成永久 `anchor_unavailable`。

这些不是新架构，也不是扩 scope；它们是同一条用户链路上的缺失证明。本 plan 已把这三条补成 Task 1.5 和 Task 4 的必跑门禁。

## Scope

### In Scope

- 收紧 `探测协作分发媒体源可读性`：`response.body === null` 必须失败。
- 首字节探测读到 chunk 后也要取消 reader，不能让探测继续拉流。
- 增加运行时级测试：前台 reader 已 `addWebSeed` 但 `streamURL` 没有 body chunk 时，不交付坏播放源。
- 更新测试 stub，让应当“可读”的 streamURL 分支返回真实 `Response` body。
- 增加/运行 group realtime ingress 与 autoplay retry coverage，确保修复对象是真正的群内实时新视频。
- 跑 targeted frontend tests、typecheck、build、GitNexus `detect_changes` 和 HTTPS 双客户端真实烟测。

### Out of Scope

- 不改后端 contract。
- 不引入 HLS、DASH、CDN、原文件直链或 range 旁路。
- 不新增第二播放器 owner。
- 不新增 cache、queue、retry manager、event bus、feature flag 或 plugin seam。
- 除非失败测试证明当前路径无法满足本计划，否则不改上传、torrent 生成、tracker 或 Service Worker 注册协议。

## Supxcode Gate

### Compliance Summary

- Truth owner: media source truth stays in media playback/application and collaborative distribution runtime; shell only projects surfaces.
- Boundary placement: `媒体协作分发.ts` owns WebTorrent/browser stream adapter probing; `资产协作分发运行时.ts` owns session and torrent handoff; timeline rendering owns reveal projection only.
- Exchange contract: shared `聊天共享/契约.ts` shapes are unchanged; no UI state enters contract.
- Mature capability reuse: WebTorrent `file.streamURL`, `torrent.addWebSeed`, `ReadableStream.getReader`, and browser autoplay promise handling remain the only primitives.

### Verification Needed

- RED must show missing body and uncancelled reader are observable failures before production edits.
- GREEN must show stricter probe does not break prefetch-to-foreground handoff when a real body chunk exists.
- HTTPS smoke must prove real browser dual-client behavior, not just Vitest.

### Release

- Conditional: implementation is releasable only after targeted tests, typecheck, build, GitNexus `detect_changes`, and HTTPS dual-client autoplay smoke all pass on fresh output.

## GitNexus Impact Snapshot

- `探测协作分发媒体源可读性`: LOW risk. Direct callers: `确认协作分发会话播放源仍可读`, `确保协作分发会话`, `解析协作分发源`, `媒体协作分发源探测测试.spec.ts`。
- `创建媒体播放器`: MEDIUM risk. Avoid editing unless locator tests fail.
- `创建资产协作分发运行时`: LOW risk. Direct consumers are runtime test support and media collaborative distribution tests.
- `渲染视频附件`: LOW risk. Avoid editing unless reveal tests fail.

Execution requirement: before editing any production symbol, rerun `mcp1_impact` for that exact symbol in the current workspace state. If HIGH or CRITICAL, stop and report the blast radius before editing.

## File Structure

- Modify: `frontend/tests/媒体协作分发源探测测试.spec.ts`
  - Adds RED unit tests for missing body and successful-reader cancellation.
- Modify: `frontend/媒体/媒体协作分发.ts:267-303`
  - Tightens first-byte probe semantics.
- Modify: `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`
  - Adds runtime-level no-body handoff regression.
  - Converts readable streamURL stubs from header-only objects to actual `Response` bodies.
- Modify: `frontend/tests/资产协作分发运行时/测试支撑.ts:83-97`
  - Makes the shared activated-Service-Worker fetch stub return a real body.
- Modify: `frontend/tests/媒体播放/media_state与终态提示测试.spec.ts`
  - Adds characterization that a temporary `source_unreadable` under `MEDIA_READY` uses force-refresh retry and recovers to `swarm` instead of dead-ending autoplay.
- Verify only: `frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts`
  - Confirms group room_event rich hint immediately enters the prefetch swarm path.
- Verify only: `frontend/tests/聊天应用内核/消息流自动播测试.spec.ts`
  - Confirms inline autoplay keeps retrying from `connecting_to_peers` to `swarm`.
- Verify only: `frontend/tests/媒体运行时自动播稳定表面测试.spec.ts`
  - Confirms runtime still gates owner promotion on stable surface readiness.
- Verify only: `frontend/tests/媒体协作分发/定位与运行时引导测试.spec.ts`
  - Confirms media_state and WebTorrent runtime bootstrap assumptions.
- Verify only: `frontend/tests/媒体协作分发/接入与票据门禁测试.spec.ts`
  - Confirms Service Worker stream server path, controlled announce, and join ticket gate still hold.
- Verify only: `frontend/tests/媒体播放定位刷新测试.spec.ts`
  - Confirms foreground locator force-refresh and await-refresh retry still hold.
- Verify only: `frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts`
  - Confirms canonical host is not revealed before visible frame commit.
- Verify only: `frontend/tests/视频附件渲染决策测试.spec.ts`
  - Confirms preview missing-source does not block canonical mount.
- Verify only: `frontend/tests/信息流视频预算测试.spec.ts`
  - Confirms only WebTorrent official stream can enter heavy canonical budget.

---

### Task 0: Execution Preflight

**Files:**

- Read: `docs/superpowers/specs/2026-05-17-realtime-video-autoplay-webtorrent-handoff-design.md`
- Read: `UIUX禁令.md`
- Read: `学习/浏览器中的应用-前端应用化方案.md`
- Read: `frontend/媒体/媒体协作分发.ts`
- Read: `frontend/媒体/资产协作分发运行时.ts`
- Read: `frontend/媒体/媒体播放.ts`
- Read: `frontend/房间消息窗/视频附件渲染.ts`
- Read: touched test files listed above

- [ ] **Step 1: Confirm clean workspace**

Run:

```powershell
git status --short
```

Expected: no output before implementation starts.

- [ ] **Step 2: Run GitNexus impact for the production symbols that may be edited**

Use GitNexus MCP:

```text
mcp1_impact(repo="koko", target="探测协作分发媒体源可读性", file_path="frontend/媒体/媒体协作分发.ts", direction="upstream", maxDepth=2, includeTests=true)
mcp1_impact(repo="koko", target="创建资产协作分发运行时", file_path="frontend/媒体/资产协作分发运行时.ts", direction="upstream", maxDepth=2, includeTests=true)
```

Expected:

- `探测协作分发媒体源可读性` remains LOW or a reviewed higher-risk result.
- `创建资产协作分发运行时` remains LOW or a reviewed higher-risk result.
- If either returns HIGH or CRITICAL, stop and report the blast radius before editing.

- [ ] **Step 3: Run current targeted baseline**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体协作分发源探测测试.spec.ts tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts tests/媒体播放定位刷新测试.spec.ts tests/聊天媒体编排/权威事件预热测试.spec.ts tests/聊天应用内核/消息流自动播测试.spec.ts tests/媒体协作分发/定位与运行时引导测试.spec.ts tests/媒体协作分发/接入与票据门禁测试.spec.ts
```

Expected: PASS. If this baseline fails, stop and investigate the existing failure before writing new tests.

---

### Task 1: RED/GREEN - Strict streamURL First-Chunk Probe

**Files:**

- Modify: `frontend/tests/媒体协作分发源探测测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`
- Modify: `frontend/媒体/媒体协作分发.ts:267-303`

- [ ] **Step 1: Replace the source-probe test file with stricter RED coverage**

Replace `frontend/tests/媒体协作分发源探测测试.spec.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { 探测协作分发媒体源可读性 } from "../媒体/媒体协作分发.js";

const 创建Range响应 = (body: BodyInit | null) =>
  new Response(body, {
    status: 206,
    headers: {
      "content-range": "bytes 0-1/1024",
    },
  });

describe("协作分发媒体源探测", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("响应已建立但首字节迟迟不到时，不应把 streamURL 判定为可读", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const hangingBody = new ReadableStream<Uint8Array>({
          start() {},
        });
        return 创建Range响应(hangingBody);
      })
    );

    await expect(
      探测协作分发媒体源可读性("https://media.local/webtorrent/file.mp4", {
        首字节超时毫秒: 1,
      })
    ).rejects.toThrow("探测协作分发媒体源首字节超时");
  });

  it("响应没有 body 时，不应把 streamURL 判定为可读", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 创建Range响应(null)));

    await expect(
      探测协作分发媒体源可读性("https://media.local/webtorrent/no-body.mp4", {
        首字节超时毫秒: 1,
      })
    ).rejects.toThrow("探测协作分发媒体源缺少响应 body");
  });

  it("读到首字节后会取消探测 reader，避免探测继续拉流", async () => {
    let cancelCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([7]));
          },
          cancel() {
            cancelCalled = true;
          },
        });
        return 创建Range响应(body);
      })
    );

    await 探测协作分发媒体源可读性("https://media.local/webtorrent/readable.mp4", {
      首字节超时毫秒: 50,
    });

    expect(cancelCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Add the runtime handoff RED regression**

In `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`, add this helper after the imports:

```ts
const 创建可读Range响应 = () =>
  new Response(new Uint8Array([1]), {
    status: 206,
    headers: {
      "content-range": "bytes 0-1/1024",
    },
  });
```

Add this test before `prefetch 无 web seed 会话升级为前台 reader 时，会把当前会话 web seed 补进同一 torrent`:

```ts
  it("前台 reader 接入 web seed 后，如果 streamURL 没有 body 首字节，不交付坏播放源", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-prefetch-webseed-body-missing-1")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        if (url.includes("/webtorrent/prefetch-webseed-body-missing-1.mp4")) {
          return new Response(null, {
            status: 206,
            headers: {
              "content-range": "bytes 0-1/1024",
            },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      })
    );
    const { torrent } = 创建可观测假Torrent(
      "/webtorrent/prefetch-webseed-body-missing-1.mp4"
    );
    const addWebSeed = vi.fn();
    (torrent as unknown as { addWebSeed: (url: string) => void }).addWebSeed = addWebSeed;
    const add = vi.fn(
      ((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
        onTorrent(torrent);
        return torrent;
      }) as WebTorrent浏览器客户端["add"]
    );
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);
    const prefetchLocator = 准备好的定位结果("att-prefetch-webseed-body-missing-1");
    prefetchLocator.distribution!.web_seed_url = null;
    const foregroundLocator = 准备好的定位结果("att-prefetch-webseed-body-missing-1");

    await 解析协作分发源({
      attachmentId: "att-prefetch-webseed-body-missing-1",
      kind: "video",
      locator: prefetchLocator,
      consumerId: "prefetch:att-prefetch-webseed-body-missing-1",
    });

    await expect(
      解析协作分发源({
        attachmentId: "att-prefetch-webseed-body-missing-1",
        kind: "video",
        locator: foregroundLocator,
        consumerId: "inline_autoplay:att-prefetch-webseed-body-missing-1",
      })
    ).rejects.toThrow("探测协作分发媒体源缺少响应 body");
    expect(add).toHaveBeenCalledTimes(1);
    expect(addWebSeed).toHaveBeenCalledWith(
      "http://media.local/web-seed-att-prefetch-webseed-body-missing-1"
    );
  });
```

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体协作分发源探测测试.spec.ts tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts -t "响应没有 body|读到首字节|前台 reader 接入 web seed"
```

Expected: FAIL before production edit.

Required failure evidence:

- Missing-body test resolves instead of rejecting, or fails to throw `探测协作分发媒体源缺少响应 body`.
- Reader-cancel test reports `cancelCalled` as `false`.
- Runtime handoff test resolves a source instead of rejecting on missing body.

- [ ] **Step 4: Implement strict first-chunk semantics**

In `frontend/媒体/媒体协作分发.ts`, replace `读取协作分发媒体源探测首字节` with:

```ts
const 读取协作分发媒体源探测首字节 = async (
  response: Response,
  timeoutMs: number
): Promise<void> => {
  const body = response.body;
  if (!body) {
    throw new Error("探测协作分发媒体源缺少响应 body");
  }
  const reader = body.getReader();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("探测协作分发媒体源首字节超时"));
        }, timeoutMs);
      }),
    ]);
    if (result.done || result.value.byteLength === 0) {
      throw new Error("探测协作分发媒体源首字节为空");
    }
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
    }
  }
};
```

- [ ] **Step 5: Convert readable streamURL test stubs to real bodies**

In `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`, replace the `status: 206` header-only returns for readable streamURL branches with `创建可读Range响应()`.

Replace:

```ts
        if (url.includes("/webtorrent/prefetch-upgrade-readable-1.mp4")) {
          return {
            ok: true,
            status: 206,
          };
        }
```

With:

```ts
        if (url.includes("/webtorrent/prefetch-upgrade-readable-1.mp4")) {
          return 创建可读Range响应();
        }
```

Replace:

```ts
        if (url.includes("/webtorrent/prefetch-webseed-upgrade-1.mp4")) {
          return {
            ok: true,
            status: 206,
          };
        }
```

With:

```ts
        if (url.includes("/webtorrent/prefetch-webseed-upgrade-1.mp4")) {
          return 创建可读Range响应();
        }
```

- [ ] **Step 6: Make the shared activated-Service-Worker fetch stub body-aware**

In `frontend/tests/资产协作分发运行时/测试支撑.ts`, replace `准备已激活媒体ServiceWorker注册` with:

```ts
export function 准备已激活媒体ServiceWorker注册() {
  const registration = {
    active: {
      state: "activated",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  );
  return registration;
}
```

- [ ] **Step 7: Run Task 1 GREEN tests**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体协作分发源探测测试.spec.ts tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts tests/资产协作分发运行时/释放与预算边界测试.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
git add frontend/媒体/媒体协作分发.ts frontend/tests/媒体协作分发源探测测试.spec.ts frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts frontend/tests/资产协作分发运行时/测试支撑.ts
git commit -m "fix: 收紧 WebTorrent streamURL 首字节探测" -m "让协作分发媒体源探测必须读到真实 body chunk 才算可读，并在首字节探测结束后取消 reader，避免探测继续拉流。" -m "补充 missing body、reader cancel、prefetch 到前台 web seed 接力的回归测试；更新测试支撑让可读 streamURL stub 提供真实 Response body。"
```

---

### Task 1.5: Characterize Temporary `source_unreadable` Recovery

**Files:**

- Modify: `frontend/tests/媒体播放/media_state与终态提示测试.spec.ts`
- Modify only if test fails: `frontend/媒体/媒体播放.ts`

- [ ] **Step 1: Add characterization for `MEDIA_READY` but temporarily unreadable streamURL**

Append this test inside `describe("媒体播放器 / media_state 与终态提示", ...)` in `frontend/tests/媒体播放/media_state与终态提示测试.spec.ts`:

```ts
  it("MEDIA_READY 下 streamURL 临时不可读时，会强刷 locator 后重试 swarm，而不是让自动播永久失败", async () => {
    const attachmentId = "att-video-source-unreadable-retry";
    const locator = {
      attachment_id: attachmentId,
      kind: "video" as const,
      status: "ready" as const,
      original_url: null,
      thumbnail_url: null,
      distribution: {
        content_id: `content_${attachmentId}`,
        content_hash: "hash-source-unreadable-retry",
        swarm_id: "swarm-source-unreadable-retry",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-source-unreadable-retry",
        torrent_info_hash: "torrent-info-hash-source-unreadable-retry",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-source-unreadable-retry",
        join_ticket: "ticket-source-unreadable-retry",
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    };
    const locate = vi.fn(async () => locator);
    const resolveSwarmSource = vi
      .fn()
      .mockRejectedValueOnce(new Error("探测协作分发媒体源缺少响应 body"))
      .mockResolvedValueOnce({
        src: "/webtorrent/source-unreadable-retry/content.mp4",
        hint: null,
        locallyComplete: false,
        formalByteSource: "webtorrent_official_stream" as const,
      });
    const releaseSwarmSource = vi.fn();
    const probeAnchor = vi.fn(async () => {
      throw new Error("不应回退锚点");
    });
    const 播放器 = 创建媒体播放器({
      degradedRetryDelays: [0],
      locate,
      resolveSwarmSource,
      releaseSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId,
      kind: "video",
      surface: "inline_autoplay",
      consumerId: `inline_autoplay:${attachmentId}`,
    });

    expect(result).toMatchObject({
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "/webtorrent/source-unreadable-retry/content.mp4",
      formalByteSource: "webtorrent_official_stream",
    });
    expect(resolveSwarmSource).toHaveBeenCalledTimes(2);
    expect(locate).toHaveBeenCalledWith(attachmentId, { forceRefresh: true });
    expect(releaseSwarmSource).toHaveBeenCalledWith({
      attachmentId,
      consumerId: `inline_autoplay:${attachmentId}`,
    });
    expect(probeAnchor).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the characterization test**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体播放/media_state与终态提示测试.spec.ts -t "MEDIA_READY 下 streamURL 临时不可读"
```

Expected: PASS on current code. If it fails, do not weaken the assertion. Fix `frontend/媒体/媒体播放.ts` so `source_unreadable` from the WebTorrent stream probe remains inside the existing协作分发 retry budget and force-refresh path, instead of resolving a permanent autoplay failure or falling back to anchor.

- [ ] **Step 3: Run the surrounding autoplay ingress suite**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体播放/media_state与终态提示测试.spec.ts tests/聊天媒体编排/权威事件预热测试.spec.ts tests/聊天应用内核/消息流自动播测试.spec.ts tests/媒体运行时自动播稳定表面测试.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 1.5**

Run:

```powershell
git add frontend/tests/媒体播放/media_state与终态提示测试.spec.ts frontend/媒体/媒体播放.ts
git commit -m "test: 钉住自动播临时不可读后的恢复路径" -m "补充 MEDIA_READY 但 streamURL 首字节临时不可读时的 characterization，要求媒体播放器强刷 locator 并在协作分发 retry budget 内恢复到 swarm，不把实时自动播打成永久失败。"
```

If `frontend/媒体/媒体播放.ts` did not change, the `git add` command is still safe; only the new test will be staged.

---

### Task 2: Verify Foreground Locator Relay and No Second Source Path

**Files:**

- Verify: `frontend/tests/媒体播放定位刷新测试.spec.ts`
- Verify: `frontend/tests/媒体播放/viewer与inline_autoplay复用测试.spec.ts`
- Verify: `frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts`
- Verify: `frontend/媒体/媒体播放.ts`

- [ ] **Step 1: Run locator relay tests**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体播放定位刷新测试.spec.ts tests/媒体播放/viewer与inline_autoplay复用测试.spec.ts tests/媒体播放/主链与swarm裁决测试.spec.ts
```

Expected: PASS.

The pass must prove:

- `inline_autoplay` force-refreshes broadcast hint cache before resolving swarm source.
- `MEDIA_CONNECTING_TO_PEERS` retry awaits `locate(..., { forceRefresh: true })` before retrying.
- `viewer` and `inline_autoplay` use the same swarm source truth.
- No direct canonical/original video URL becomes the new official playback path.

- [ ] **Step 2: If this task fails, edit only the failed owner**

If failure points at locator order in `frontend/媒体/媒体播放.ts`, rerun GitNexus first:

```text
mcp1_impact(repo="koko", target="创建媒体播放器", file_path="frontend/媒体/媒体播放.ts", direction="upstream", maxDepth=2, includeTests=true)
```

Then reread `frontend/媒体/媒体播放.ts` and patch only the smallest failing branch:

- `刷新查看器视频定位` must remain the only first-open foreground force-refresh owner.
- `尝试协作分发主链` must continue to await refresh during connecting-poll retry.
- `resolveSwarmSource` must receive the refreshed locator, not the stale broadcast hint.
- `probeAnchor` must not become a fallback for new WebTorrent video.

- [ ] **Step 3: Commit only if Step 2 required code changes**

Run this only when Task 2 changed files:

```powershell
git add frontend/媒体/媒体播放.ts frontend/tests/媒体播放定位刷新测试.spec.ts frontend/tests/媒体播放/viewer与inline_autoplay复用测试.spec.ts frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts
git commit -m "fix: 保持前台播放 locator 接力顺序" -m "确保 inline_autoplay/viewer 在正式 WebTorrent 主链上先取得当前会话 locator，再解析 swarm source，不引入第二播放来源。"
```

Expected if no code changes: no commit for this task.

---

### Task 3: Verify Timeline Reveal Gate

**Files:**

- Verify: `frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts`
- Verify: `frontend/tests/视频附件渲染决策测试.spec.ts`
- Verify: `frontend/tests/信息流视频预算测试.spec.ts`
- Verify: `frontend/房间消息窗/视频附件渲染.ts`
- Verify: `frontend/房间消息窗/视频附件表面渲染.ts`
- Verify: `frontend/媒体/信息流视频预算.ts`

- [ ] **Step 1: Run reveal and budget tests**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/房间消息窗/自动播露出门禁测试.spec.ts tests/视频附件渲染决策测试.spec.ts tests/信息流视频预算测试.spec.ts
```

Expected: PASS.

The pass must prove:

- `message-video-canonical-host` may mount while covered.
- `data-covered` cannot flip visible before `读取时间线唯一播放器可见宿主是否已出帧(...)` is true.
- Poster/preview/frozen frame remains the visible bridge while canonical is still covered.
- `allowInlineCanonical` is true only when formal bytes are `webtorrent_official_stream`.

- [ ] **Step 2: If this task fails, edit only the failed reveal owner**

If failure points at `渲染视频附件`, rerun GitNexus first:

```text
mcp1_impact(repo="koko", target="渲染视频附件", target_uid="Function:frontend/房间消息窗/视频附件渲染.ts:渲染视频附件", direction="upstream", maxDepth=2, includeTests=true)
```

Allowed minimal corrections:

- Keep `shouldRevealCanonicalHost = shouldRenderInlineVideo && hasVisibleCanonicalCommittedFrame`.
- Do not let historical ready caches replace current visible DOM frame evidence.
- Do not make `视频附件表面渲染.ts` decide owner or source truth; it must stay projection-only.

- [ ] **Step 3: Commit only if Step 2 required code changes**

Run this only when Task 3 changed files:

```powershell
git add frontend/房间消息窗/视频附件渲染.ts frontend/房间消息窗/视频附件表面渲染.ts frontend/媒体/信息流视频预算.ts frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts frontend/tests/视频附件渲染决策测试.spec.ts frontend/tests/信息流视频预算测试.spec.ts
git commit -m "fix: 保持自动播 canonical 首帧揭帘门禁" -m "确保时间线只在当前可见 canonical host 真出帧后揭帘，poster/preview/frozen bridge 在此前继续遮住黑壳。"
```

Expected if no code changes: no commit for this task.

---

### Task 4: Full Frontend Verification

**Files:**

- Verify: frontend project

- [ ] **Step 1: Run targeted media suite**

Run:

```powershell
pnpm --dir frontend vitest run --exclude dist/** tests/媒体协作分发源探测测试.spec.ts tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts tests/资产协作分发运行时/释放与预算边界测试.spec.ts tests/媒体播放定位刷新测试.spec.ts tests/媒体播放/media_state与终态提示测试.spec.ts tests/媒体播放/viewer与inline_autoplay复用测试.spec.ts tests/媒体播放/主链与swarm裁决测试.spec.ts tests/聊天媒体编排/权威事件预热测试.spec.ts tests/聊天应用内核/消息流自动播测试.spec.ts tests/媒体运行时自动播稳定表面测试.spec.ts tests/媒体协作分发/定位与运行时引导测试.spec.ts tests/媒体协作分发/接入与票据门禁测试.spec.ts tests/房间消息窗/自动播露出门禁测试.spec.ts tests/视频附件渲染决策测试.spec.ts tests/信息流视频预算测试.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```powershell
pnpm --dir frontend typecheck
```

Expected: PASS with exit code 0.

- [ ] **Step 3: Run frontend build gates**

Run:

```powershell
pnpm --dir frontend build
```

Expected: PASS with exit code 0. This includes browser-app constitution, architecture fitness, test architecture fitness, typecheck, and bundle build.

- [ ] **Step 4: Run GitNexus changed-scope check**

Use GitNexus MCP:

```text
mcp1_detect_changes(repo="koko", scope="all")
```

Expected:

- Changed symbols are limited to the source probe, media playback recovery characterization, and tests unless Task 2 or Task 3 found real failures.
- No unexpected process appears outside media/collaborative-distribution/timeline playback.
- If unexpected affected processes appear, stop and inspect with `mcp1_context` before continuing.

- [ ] **Step 5: Commit verification-only fallout only if files changed**

If Task 4 required test fixture cleanups or formatting after build, commit only those files:

```powershell
git add frontend/tests/媒体协作分发源探测测试.spec.ts frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts frontend/tests/资产协作分发运行时/释放与预算边界测试.spec.ts frontend/tests/资产协作分发运行时/测试支撑.ts frontend/tests/媒体播放/media_state与终态提示测试.spec.ts frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts frontend/tests/聊天应用内核/消息流自动播测试.spec.ts frontend/tests/媒体运行时自动播稳定表面测试.spec.ts frontend/tests/媒体协作分发/定位与运行时引导测试.spec.ts frontend/tests/媒体协作分发/接入与票据门禁测试.spec.ts
git commit -m "test: 收口实时视频自动播验证夹具" -m "清理 WebTorrent 自动播接力相关测试夹具，使 targeted media suite、typecheck 和 build 在严格 streamURL body 探测后保持一致。"
```

Expected if no files changed: no commit for this task. If `git status --short` shows any file outside the exact `git add` list above, stop and investigate before staging.

---

### Task 5: HTTPS Dual-Client Smoke

**Files:**

- Verify runtime through HTTPS only
- Use: `playwright-cli`, `chrome-devtools-cli`, `browser-trace`

- [ ] **Step 1: Start or refresh the local HTTPS entry**

Run from repo root:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\https.ps1 -LauncherMode
```

Expected output includes:

```text
HTTPS 地址：
  - https://localhost
  - https://127.0.0.1
Caddy 已started。
```

or:

```text
Caddy 已reloaded。
```

- [ ] **Step 2: Open two browser clients over HTTPS**

Use `playwright-cli` skill against `https://localhost`.

Manual smoke script behavior:

```text
Client A:
  open https://localhost
  bootstrap anonymous session
  join room code WTPLAY

Client B:
  open https://localhost in a second isolated context
  bootstrap anonymous session
  join the same room code WTPLAY
```

Expected:

- Both clients show the same room.
- No mixed-content error.
- Service Worker is active.
- WebTorrent runtime is supported because origin is HTTPS.

- [ ] **Step 3: Send a small MP4 from Client A**

Use the existing fixture:

```text
tests/fixtures/minimal.mp4
```

Expected after Client A sends:

- Client B receives the message via realtime room event without refresh.
- Client B creates/keeps `prefetch:<attachmentId>` before foreground owner resolution.
- Foreground `inline_autoplay:<attachmentId>` resolves to `mode: "swarm"`.
- No direct original/canonical HTTP URL is assigned to visible `<video>` as official source.

- [ ] **Step 4: Capture browser evidence with all required browser tools**

Use `browser-trace` to capture:

```text
page load
room join
video send
Client B realtime receive
Client B autoplay handoff
```

Use `chrome-devtools-cli` or equivalent CDP inspection to confirm:

```text
document.querySelectorAll('video.message-video-preview[data-canonical-player="true"]').length >= 1
document.querySelector('[data-formal-byte-source="webtorrent_official_stream"]') !== null
document.querySelector('.message-video-poster--canonical-cover') === null
  OR canonical host has data-covered="false"
```

Use `playwright-cli` assertion to confirm:

```text
Client B video card does not remain black/gray placeholder for more than 8 seconds after receive.
Client B can autoplay muted/playsinline without manual click.
Client B keeps playback after a short wait; no page refresh is used.
```

Expected:

- No console error from autoplay promise rejection that leaves UI stuck.
- No `/webtorrent/...` 404 after playback source is committed.
- No `MEDIA_NO_ONLINE_SEED` terminal state while sender is online.
- No second source path such as HLS/DASH/direct original URL.

- [ ] **Step 5: If HTTPS smoke fails, preserve trace and return to root cause**

If smoke fails:

```text
Do not add timeout/sleep/guard-band patches.
Do not bypass WebTorrent.
Use browser trace network + console + DOM bucket to identify the exact failed state transition:
  foreground_locator_refreshing
  web_seed_attached
  stream_first_chunk_ready
  playback_resolved
  canonical_frame_committed
```

Then rerun the matching task from this plan after adding a RED test for the failed transition.

---

### Task 6: Final Cleanliness and Release Commit

**Files:**

- Verify: all changed files

- [ ] **Step 1: Run final status**

Run:

```powershell
git status --short
```

Expected: either clean or only intentional files from the current task.

- [ ] **Step 2: Run GitNexus final detect changes**

Use GitNexus MCP:

```text
mcp1_detect_changes(repo="koko", scope="all")
```

Expected:

- Risk remains LOW or reviewed MEDIUM.
- Changed symbols match this plan.
- No unrelated backend/domain/contract symbol is changed.

- [ ] **Step 3: Commit final uncommitted implementation files**

If `git status --short` still shows intended implementation changes after Task 1-5 commits, commit them:

```powershell
git add frontend/媒体/媒体协作分发.ts frontend/媒体/资产协作分发运行时.ts frontend/媒体/媒体播放.ts frontend/房间消息窗/视频附件渲染.ts frontend/房间消息窗/视频附件表面渲染.ts frontend/媒体/信息流视频预算.ts frontend/tests/媒体协作分发源探测测试.spec.ts frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts frontend/tests/资产协作分发运行时/释放与预算边界测试.spec.ts frontend/tests/资产协作分发运行时/测试支撑.ts frontend/tests/媒体播放定位刷新测试.spec.ts frontend/tests/媒体播放/media_state与终态提示测试.spec.ts frontend/tests/媒体播放/viewer与inline_autoplay复用测试.spec.ts frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/聊天媒体编排/权威事件预热测试.spec.ts frontend/tests/聊天应用内核/消息流自动播测试.spec.ts frontend/tests/媒体运行时自动播稳定表面测试.spec.ts frontend/tests/媒体协作分发/定位与运行时引导测试.spec.ts frontend/tests/媒体协作分发/接入与票据门禁测试.spec.ts frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts frontend/tests/视频附件渲染决策测试.spec.ts frontend/tests/信息流视频预算测试.spec.ts
git commit -m "fix: 完成实时视频自动播 WebTorrent 接力" -m "按前台播放接力协议收紧 streamURL 首字节、locator forceRefresh、web seed 注入和 canonical 首帧揭帘验证，保证实时新视频不靠刷新或点击恢复播放。" -m "验证：targeted Vitest、pnpm typecheck、pnpm build、GitNexus detect_changes、HTTPS 双客户端自动播烟测。"
```

If `git status --short` shows any file outside this exact list, do not run the commit. First explain why that file changed and either remove it from the working tree or update this plan with a new reviewed task.

- [ ] **Step 4: Final release summary**

Report:

```text
Implemented:
- strict streamURL first-body-chunk probe
- same-torrent web seed handoff guard
- group room_event prefetch ingress remains active
- temporary source_unreadable recovers through forceRefresh retry
- no second source path
- canonical reveal remains frame-gated

Verification:
- exact test commands and exit codes
- typecheck/build result
- GitNexus changed scope
- HTTPS smoke trace summary

Commits:
- list commit hashes created during execution
```

## Anti-Drift Rules for Implementers

- Do not add a second player owner.
- Do not set video `src` from direct original/canonical HTTP URL for this path.
- Do not treat `fetch()` headers as media readability.
- Do not read the whole media file for probing.
- Do not add unbounded queues, caches, or retries.
- Do not hide autoplay promise rejection behind a loading spinner.
- Do not put shell/UI flow fields into `聊天共享/契约.ts`.
- Do not edit backend contract unless a fresh RED test proves the frontend handoff cannot be satisfied by current contract.
- If a test already passes, keep it as characterization and do not invent production changes for it.

## Self-Review

### Pass 1: Spec Coverage

Checked against the design spec sections:

- `foreground_locator_refreshing`: Task 2 verifies existing force-refresh and retry ordering.
- `web_seed_attached`: Task 1 runtime regression verifies same-torrent `addWebSeed` happens before foreground probe.
- `stream_first_chunk_ready`: Task 1 adds missing-body and reader-cancel RED tests, then tightens the probe.
- `playback_resolved`: Task 1/1.5/2 targeted suites verify `mode: "swarm"` is only published after official WebTorrent stream readiness and temporary source unreadability recovers through force-refresh retry.
- group realtime ingress: Task 1.5/4 verify room_event rich hints still enter immediate prefetch and inline autoplay retries from `connecting_to_peers` to `swarm`.
- `canonical_frame_committed`: Task 3 verifies timeline reveal remains current-frame gated.
- HTTPS real experience: Task 5 requires dual-client HTTPS smoke with `playwright-cli`, `chrome-devtools-cli`, and `browser-trace`.

No uncovered spec requirement remains in the plan.

### Pass 2: Architecture Boundary

Checked owner placement:

- `媒体协作分发.ts` remains adapter/browser stream probe owner.
- `资产协作分发运行时.ts` remains WebTorrent session and same-torrent handoff owner.
- `媒体播放.ts` remains foreground locator and source selection owner.
- `视频附件渲染.ts` remains timeline reveal decision owner.
- `视频附件表面渲染.ts` remains projection-only.
- `聊天共享/契约.ts` is intentionally untouched.

The plan does not introduce a second media source, second player owner, or shell-owned source truth.

### Pass 3: Execution Path and Verification

Checked execution discipline:

- Task 1 starts with RED tests and expects specific failures before production edits.
- Task 1.5 adds characterization for the exact user-visible risk introduced by stricter probing: temporary source unreadability must recover, not kill autoplay.
- Task 2 and Task 3 are verification-first; they only allow code edits if existing guarantees fail.
- Every command has a concrete expected result.
- Commit commands use exact file paths, not glob staging.
- Final release requires GitNexus `detect_changes`, typecheck, build, and HTTPS smoke.

The only `placeholder` word in this plan refers to UI placeholder surfaces, not missing plan content.

## 100% Confidence Loop

Question: am I 100% confident this plan can implement the intended bug fix without plan-level blind spots?

Answer after the second confidence loop: yes for the plan layer.

Why:

- The plan fixes the only uncovered causal gap found during reread: `response.body === null` being treated as stream readiness.
- The plan now also covers the true group media receive path: room_event rich hint, immediate prefetch, inline autoplay retry, stable surface gate, and canonical reveal.
- The plan now guards the main risk of the stricter probe itself: temporary WebTorrent/Service Worker unreadability must remain recoverable through existing force-refresh retry.
- It does not over-expand into backend, protocol, or player rewrites.
- It preserves the existing working owner graph instead of replacing it.
- It turns every remaining uncertainty into a verification gate or an explicit stop condition.
- If HTTPS smoke exposes a new failed state transition, the plan requires a new RED test before any patch.

Implementation confidence still depends on fresh RED/GREEN output and HTTPS smoke during execution; this plan intentionally does not claim code is fixed before those proofs exist.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-realtime-video-autoplay-webtorrent-handoff-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Use `subagent-driven-development`; dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Use `executing-plans`; execute tasks in this session with checkpoints after each task.
