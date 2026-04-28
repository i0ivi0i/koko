# 唯一 WebTorrent 万人群聊零崩溃零闪烁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended when the host explicitly allows subagents) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `2026-04-26-万人群聊浏览器零崩溃零闪烁.md` 的裁决落成可执行代码：正式图片/视频内容字节只走唯一 `WebTorrent` whole-file swarm，消息流像应用一样长期高帧率、不闪、不抽、不崩，自动播放、查看器、全屏和后台帮助链都不被削弱。

**Architecture:** 不新增第二播放器、不新增第二分发链、不手搓第二套拉块/缓存/range/播放器字节管线。实现只沿现有 owner 链收口：`媒体协作分发.ts` 负责 WebTorrent 官方 stream 路径，`资产协作分发运行时.ts` 负责 swarm/帮助态预算，`媒体运行时.ts` 负责 viewer/autoplay/runtime 预算，`聊天媒体编排.ts` 聚合唯一信息流媒体预算，`房间消息窗.ts` 只消费预算投影，`全局唯一播放器.ts` 继续持有唯一 `Video.js v10` player/container。

**Tech Stack:** TypeScript 6.0.2、Lit 3、`@tanstack/lit-virtual`、XState、WebTorrent 2.8、Video.js v10、Vitest、`chrome-devtools-cli`、`playwright-cli`。

---

## 0. 执行前硬门禁

本计划不是“先修一部分再说”。执行时按下面依赖顺序一口气推进到可烟测收口：测试先红、实现转绿、局部测试、全量前端验证、真实浏览器烟测、再根据烟测结果修复到闭环。

执行前必须重新读取：

- `docs/superpowers/specs/2026-04-26-万人群聊浏览器零崩溃零闪烁.md`
- `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- `docs/superpowers/specs/2026-04-25-项目视频播放要求.md`
- `UIUX禁令.md`
- `graphify-out/GRAPH_REPORT.md`

执行前必须用 Serena 重新扫下面代码锚点，不允许凭本计划的旧印象直接改：

- `frontend/媒体/媒体协作分发.ts`
- `frontend/媒体/资产协作分发运行时.ts`
- `frontend/媒体/信息流视频预算.ts`
- `frontend/媒体运行时.ts`
- `frontend/聊天媒体编排.ts`
- `frontend/房间消息窗.ts`
- `frontend/媒体/全局唯一播放器.ts`
- `frontend/媒体/媒体查看器.ts`
- `frontend/media-sw.ts`

---

## 1. 文件职责图

### 1.1 只允许修改的生产代码

- Modify: `frontend/媒体/信息流视频预算.ts`
  - 唯一附件级 `重播放 / 轻预热 / 轻帮助 / 冷表达` 投影原语。
  - 增加“正式内容字节来源证明”字段，只表达是否落在 `WebTorrent` 官方链路，不发起 IO。

- Modify: `frontend/媒体运行时.ts`
  - 继续只拥有 viewer/autoplay/runtime budget，不接管 WebTorrent runtime。
  - 补齐 `budgetSnapshot` 所需的 owner generation、长任务、inflight 预算投影。

- Modify: `frontend/媒体/资产协作分发运行时.ts`
  - 继续负责 swarm session、zero-ref、light help、whole-file backfill 预算。
  - 补齐“零引用重 reader 退成轻帮助态”的可观测证据，不停止补齐/做种资格。

- Modify: `frontend/媒体/媒体协作分发.ts`
  - 继续只通过 WebTorrent 官方 `createServer` / `streamTo` / `streamURL` 交付正式内容字节。
  - 明确拒绝或标记任何非 WebTorrent 内容字节入口：原文件直链、CDN、HLS/DASH segment、临时 range、service worker 私有 cache、本地文件 URL。

- Modify: `frontend/聊天媒体编排.ts`
  - 聚合 `媒体运行时`、`资产协作分发运行时`、媒体会话和附件级预算，输出唯一 `budgetSnapshot`。
  - 统一裁决窗口附件、自动播候选、viewer owner、help window，避免房间组件局部重算。

- Modify: `frontend/房间消息窗.ts`
  - 只消费 `聊天媒体编排.ts` 给出的预算投影。
  - 继续使用 Lit + `@tanstack/lit-virtual`，只上报滚动、可见性、点击、宿主槽位事实。

- Modify: `frontend/媒体/全局唯一播放器.ts`
  - 继续保证同一颗 `Video.js v10` player/container 在 autoplay、viewer、fullscreen、退出归位之间迁移。
  - 补齐 rVFC/currentTime/dropped frame/fullscreen 状态上报到预算快照的入口。

- Modify: `frontend/media-sw.ts`
  - 继续只允许图片 canonical blob 缓存等非正式播放链缓存。
  - 不接管 HLS/DASH segment、manifest、临时 range 或新主链正式播放字节。

### 1.2 只允许修改或新增的测试

- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Create or Modify: `frontend/tests/信息流视频预算测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `frontend/tests/媒体共享契约测试.spec.ts`

### 1.3 禁止修改方向

- 禁止新增第二播放器模块。
- 禁止新增 `hls.js`、`p2p-media-loader-hlsjs`、Shaka、XGPlayer 或私有 streaming engine。
- 禁止新增浏览器临时脚本作为烟测替代品。
- 禁止把 `media-sw.ts` 变成新主链字节缓存。
- 禁止让 `房间消息窗.ts` 重新拥有业务预算真相。

---

## Task 1: 主链字节入口门禁

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `frontend/tests/媒体共享契约测试.spec.ts`

- [ ] **步骤 1：写失败测试，钉死新主链只认 WebTorrent 官方 stream**

在 `frontend/tests/媒体协作分发测试.spec.ts` 增加或合并测试：

```ts
it("新主链正式内容字节只能来自 WebTorrent createServer/streamURL 路径", async () => {
  const streamUrl = "http://127.0.0.1:9000/webtorrent/stream/att-only-channel";
  const add = vi.fn((_, callback) => {
    callback(创建假种子({
      streamURL: streamUrl,
      files: [{ name: "video.mp4", streamURL: streamUrl }],
    }));
  }) as WebTorrent浏览器客户端["add"];
  const { ctor } = 创建假WebTorrent构造器(add);

  const source = await 解析测试协作分发源({ ctor, attachmentId: "att-only-channel" });

  expect(source.src).toBe(streamUrl);
  expect(source.hint).not.toContain("HLS");
  expect(source.hint).not.toContain("CDN");
});
```

补一条负例：

```ts
it("原文件直链和临时 range 不能冒充 WebTorrent 秒开成功", async () => {
  await expect(
    解析测试协作分发源({
      fallbackSrc: "https://cdn.local/original.mp4",
      attachmentId: "att-bypass",
    })
  ).rejects.toThrow(/WebTorrent|主链|正式内容字节/);
});
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体协作分发测试.spec.ts" "tests/媒体服务工作线程测试.spec.ts" "tests/媒体共享契约测试.spec.ts"
```

Expected: 新增 WebTorrent-only 断言失败，证明当前测试确实覆盖了绕开主链风险。

- [ ] **步骤 3：最小实现主链来源证明**

在 `frontend/媒体/媒体协作分发.ts` 里新增小而专的内部判断，不创建新 runtime：

```ts
type 协作分发内容字节入口 = "webtorrent_official_stream" | "non_webtorrent_bypass";

const 判定协作分发内容字节入口 = (src: string | null): 协作分发内容字节入口 =>
  src && /\/webtorrent\//.test(src) ? "webtorrent_official_stream" : "non_webtorrent_bypass";
```

实现要求：

- `streamURL` / `createServer` / `streamTo` 产出的受控 URL 才能返回正式播放源。
- 原文件 URL、CDN URL、HLS/DASH manifest/segment、临时 range URL、service worker 私有 cache、本地文件 URL 都不能进入新主链成功态。
- WebSeed 只能作为 swarm 内成员参与，不能作为前端直链返回。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体协作分发测试.spec.ts" "tests/媒体服务工作线程测试.spec.ts" "tests/媒体共享契约测试.spec.ts"
```

Expected: all tests pass.

Commit:

```powershell
git add frontend/媒体/媒体协作分发.ts frontend/tests/媒体协作分发测试.spec.ts frontend/tests/媒体服务工作线程测试.spec.ts frontend/tests/媒体共享契约测试.spec.ts
git commit -m "前端: 钉死WebTorrent唯一正式媒体字节入口"
```

---

## Task 2: 信息流媒体预算投影扩展

**Files:**
- Modify: `frontend/媒体/信息流视频预算.ts`
- Create or Modify: `frontend/tests/信息流视频预算测试.spec.ts`

- [ ] **步骤 1：写失败测试，覆盖四层预算和字节来源证明**

```ts
import { describe, expect, it } from "vitest";
import { 投影信息流视频预算 } from "../媒体/信息流视频预算.js";

describe("信息流视频预算", () => {
  it("heavy owner 只有在正式内容字节来自 WebTorrent 时才允许 canonical 接管", () => {
    expect(
      投影信息流视频预算({
        attachmentId: "att-1",
        playback: { mode: "swarm", kind: "video", attachmentId: "att-1", src: "blob:http://app/webtorrent/att-1", thumbnailUrl: null, hint: null },
        inlineAutoplayPlayback: null,
        viewerCanonicalVideoSrc: null,
        previewVideoSrc: "blob:http://app/webtorrent/att-1-preview",
        inMediaWindow: true,
        isAutoplayCandidate: false,
        isInlineAutoplayOwner: true,
        isViewerOwner: false,
        sessionStatus: "backfilling",
        locallyComplete: false,
        formalByteSource: "webtorrent_official_stream",
      }).allowInlineCanonical
    ).toBe(true);
  });

  it("非 WebTorrent 内容字节入口只能成为失败证据，不能变成 warm 或 heavy 成功", () => {
    const budget = 投影信息流视频预算({
      attachmentId: "att-2",
      playback: null,
      inlineAutoplayPlayback: null,
      viewerCanonicalVideoSrc: "https://cdn.local/att-2.mp4",
      previewVideoSrc: null,
      inMediaWindow: true,
      isAutoplayCandidate: true,
      isInlineAutoplayOwner: true,
      isViewerOwner: false,
      sessionStatus: null,
      locallyComplete: false,
      formalByteSource: "non_webtorrent_bypass",
    });

    expect(budget.tier).toBe("cold_expression");
    expect(budget.reason).toBe("non_webtorrent_bypass");
    expect(budget.allowInlineCanonical).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/信息流视频预算测试.spec.ts"
```

Expected: `formalByteSource` 类型或投影逻辑尚未实现而失败。

- [ ] **步骤 3：最小实现预算字段**

在 `frontend/媒体/信息流视频预算.ts` 扩展事实与投影：

```ts
export type 正式媒体字节来源 = "webtorrent_official_stream" | "non_webtorrent_bypass" | "none";

export type 信息流视频预算投影 = {
  attachmentId: string;
  tier: 信息流视频预算层级;
  reason: 信息流视频预算原因 | "non_webtorrent_bypass";
  canonicalVideoSrc: string | null;
  previewVideoSrc: string | null;
  allowInlineCanonical: boolean;
  allowPreviewVideo: boolean;
  formalByteSource: 正式媒体字节来源;
};
```

实现规则：

- `formalByteSource !== "webtorrent_official_stream"` 时，不能返回 `heavy_playback` 或允许 canonical inline 接管。
- `warm_preview` 只能表示 WebTorrent 官方 stream/range 内的轻预热，不表示 HTTP 直链预热成功。
- `light_help` 不持有前台内容字节 reader。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/信息流视频预算测试.spec.ts"
```

Expected: all tests pass.

Commit:

```powershell
git add frontend/媒体/信息流视频预算.ts frontend/tests/信息流视频预算测试.spec.ts
git commit -m "前端: 扩展信息流媒体预算字节来源证明"
```

---

## Task 3: 聚合唯一 budgetSnapshot owner

**Files:**
- Modify: `frontend/媒体运行时.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`

- [ ] **步骤 1：写失败测试，预算快照必须能解释每个重对象**

在 `frontend/tests/聊天媒体编排测试.spec.ts` 增加：

```ts
it("budgetSnapshot 会同时解释正式播放器、轻预热、轻帮助和 WebTorrent 来源", async () => {
  const 编排 = 创建测试聊天媒体编排WithVideo("att-budget-snapshot");

  编排.同步媒体窗口附件(["att-budget-snapshot"]);
  编排.处理自动播候选([{ attachmentId: "att-budget-snapshot", visibilityRatio: 0.96, distanceToViewportCenter: 0 }]);
  await 刷新异步队列();

  expect(编排.读取预算()).toMatchObject({
    activeFormalPlayerCount: 1,
    autoplayOwnerCount: 1,
    focusedVideoBudget: expect.arrayContaining([
      expect.objectContaining({
        attachmentId: "att-budget-snapshot",
        tier: "heavy_playback",
        formalByteSource: "webtorrent_official_stream",
      }),
    ]),
  });
});
```

在 `frontend/tests/资产协作分发运行时测试.spec.ts` 增加：

```ts
it("零引用会话保留轻帮助态时不再占 whole-file heavy reader 预算", async () => {
  await 激活并释放协作分发消费者("att-light-help");

  expect(资产协作分发运行时.读取预算()).toMatchObject({
    zeroRefHeavySessionCount: 0,
    zeroRefLightHelpSessionCount: 1,
    zeroRefWholeFileReaderCount: 0,
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体运行时测试.spec.ts" "tests/资产协作分发运行时测试.spec.ts" "tests/聊天媒体编排测试.spec.ts"
```

Expected: 新增字段或聚合逻辑失败。

- [ ] **步骤 3：实现唯一聚合入口**

实现要求：

- `媒体运行时.ts` 继续只投影 `activeFormalPlayerCount`、`autoplayOwnerCount`、`inflightLocatorCount`、`inflightManifestOrRangeCount`、`longTaskCount`。
- `资产协作分发运行时.ts` 继续只投影 `activeSwarmCount`、`wholeFileHeavySessionCount`、`zeroRefHeavySessionCount`、`zeroRefLightHelpSessionCount`、`zeroRefWholeFileReaderCount`。
- `聊天媒体编排.ts` 的 `读取预算()` 是唯一对外预算聚合点，输出字段至少包括：

```ts
{
  activeMediaSessionCount,
  activeVideoSessionCount,
  activeFormalPlayerCount,
  activeSwarmCount,
  wholeFileHeavySessionCount,
  zeroRefHeavySessionCount,
  zeroRefLightHelpSessionCount,
  focusedVideoBudget,
}
```

禁止：

- `房间消息窗.ts` 局部重算 owner 级预算。
- `媒体运行时.ts` 初始化或拥有 WebTorrent client。
- `资产协作分发运行时.ts` 操作 Video.js player。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体运行时测试.spec.ts" "tests/资产协作分发运行时测试.spec.ts" "tests/聊天媒体编排测试.spec.ts"
```

Expected: all tests pass.

Commit:

```powershell
git add frontend/媒体运行时.ts frontend/媒体/资产协作分发运行时.ts frontend/聊天媒体编排.ts frontend/tests/媒体运行时测试.spec.ts frontend/tests/资产协作分发运行时测试.spec.ts frontend/tests/聊天媒体编排测试.spec.ts
git commit -m "前端: 收口信息流媒体预算快照owner"
```

---

## Task 4: 房间消息窗只消费预算投影

**Files:**
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`

- [ ] **步骤 1：写失败测试，防止组件局部绕过预算**

```ts
it("预算投影标记为 cold_expression 时不会因为本地 playback 露出真实视频表面", async () => {
  const pane = 创建媒体消息窗();
  pane.inlineAutoplayOwnerAttachmentId = "att-cold";
  pane.mediaPlaybackByAttachmentId = {
    "att-cold": {
      mode: "swarm",
      attachmentId: "att-cold",
      kind: "video",
      src: "blob:http://media.local/webtorrent/att-cold",
      thumbnailUrl: null,
      hint: null,
    },
  };
  pane.mediaVideoBudgetByAttachmentId = {
    "att-cold": {
      attachmentId: "att-cold",
      tier: "cold_expression",
      reason: "inactive",
      canonicalVideoSrc: null,
      previewVideoSrc: null,
      allowInlineCanonical: false,
      allowPreviewVideo: false,
      formalByteSource: "webtorrent_official_stream",
    },
  };

  document.body.appendChild(pane);
  await pane.updateComplete;

  expect(pane.querySelector('.message-video-canonical-host[data-attachment-id="att-cold"]')).toBeNull();
  expect(pane.querySelector('video.message-video-preview[data-attachment-id="att-cold"]')).toBeNull();
});
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/房间消息窗媒体查看器测试.spec.ts"
```

Expected: 如果组件仍靠本地 playback 自行露出表面，应失败。

- [ ] **步骤 3：最小修改渲染路径**

实现要求：

- `renderMessageAttachments` / `renderVirtualMessageItem` 只按 `mediaVideoBudgetByAttachmentId` 决定 canonical host、preview video、冷表达。
- DOM 上保留烟测可读属性：

```html
data-budget-tier="heavy_playback|warm_preview|light_help|cold_expression"
data-budget-reason="..."
data-formal-byte-source="webtorrent_official_stream|non_webtorrent_bypass|none"
```

- Lit `render()` 内禁止创建 source、启动 probe、订阅 observer 或解释 WebTorrent ready。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/房间消息窗媒体查看器测试.spec.ts"
```

Expected: all tests pass.

Commit:

```powershell
git add frontend/房间消息窗.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts
git commit -m "前端: 让房间消息窗只消费媒体预算投影"
```

---

## Task 5: 唯一播放器连续性和帧指标上报

**Files:**
- Modify: `frontend/媒体/全局唯一播放器.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`

- [ ] **步骤 1：写失败测试，viewer/fullscreen 不能重建第二播放器**

```ts
it("自动播 owner 进入 viewer/fullscreen 后仍复用同一颗全局播放器并保留 currentTime", async () => {
  const globalVideoPlayer = 创建全局唯一播放器({ createVideoJsPlayerShell: 创建播放器壳Spy });

  await globalVideoPlayer.同步时间线自动播({ attachmentId: "att-player", src: "blob:http://app/webtorrent/att-player", currentTime: 12 });
  await globalVideoPlayer.接管查看器({ attachmentId: "att-player", src: "blob:http://app/webtorrent/att-player", currentTime: 12 });
  await globalVideoPlayer.同步时间线自动播({ attachmentId: "att-player", src: "blob:http://app/webtorrent/att-player", currentTime: 12 });

  expect(创建播放器壳Spy).toHaveBeenCalledTimes(1);
  expect(读取上报currentTime()).toBeGreaterThanOrEqual(12);
});
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体查看器测试.spec.ts" "tests/房间消息窗媒体查看器测试.spec.ts"
```

Expected: 缺失 rVFC/currentTime/fullscreen 上报或重建路径会失败。

- [ ] **步骤 3：实现帧指标和归位连续性**

实现要求：

- `全局唯一播放器.ts` 继续只有一颗 player/container。
- viewer 接管前冲刷 inline currentTime。
- viewer/fullscreen 关闭后按同一 attachment、source generation、host slot 尝试归位。
- rVFC/dropped frame/fullscreen/currentTime 只上报给预算快照，不反过来改变 WebTorrent 主链。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体查看器测试.spec.ts" "tests/房间消息窗媒体查看器测试.spec.ts"
```

Expected: all tests pass.

Commit:

```powershell
git add frontend/媒体/全局唯一播放器.ts frontend/媒体/媒体查看器.ts frontend/tests/媒体查看器测试.spec.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts
git commit -m "前端: 巩固唯一播放器查看器全屏连续性"
```

---

## Task 6: Lit、主线程和 DOM 预算门禁

**Files:**
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Modify: `scripts/check-frontend-browser-app-constitution.mjs`
- Modify: `scripts/check-frontend-architecture-fitness.mjs`

- [ ] **步骤 1：写失败测试，长列表 key、listener、DOM 预算必须可观测**

增加测试断言：

```ts
it("虚拟列表视频宿主使用稳定 attachment key，owner 交接不会重建同一附件宿主", async () => {
  const pane = 创建含多个视频的消息窗(30);
  document.body.appendChild(pane);
  await pane.updateComplete;

  const before = pane.querySelector('[data-attachment-id="att-video-10"]');
  pane.inlineAutoplayOwnerAttachmentId = "att-video-10";
  await pane.updateComplete;
  const after = pane.querySelector('[data-attachment-id="att-video-10"]');

  expect(after).toBe(before);
});
```

架构检查增加静态规则：

```js
{
  file: "frontend/房间消息窗.ts",
  forbidden: ["new WebTorrent", "createServer(", "streamURL"],
  label: "房间消息窗不得创建或解释 WebTorrent 内容字节入口"
}
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```powershell
pnpm --dir frontend test -- "tests/房间消息窗媒体查看器测试.spec.ts" "tests/聊天媒体编排测试.spec.ts"
pnpm --dir frontend run check:browser-app-constitution
pnpm --dir frontend run check:architecture-fitness
```

Expected: 新门禁未实现时失败。

- [ ] **步骤 3：实现稳定投影和架构门禁**

实现要求：

- `房间消息窗.ts` 的 Lit render 只做纯投影。
- IntersectionObserver、timer、rVFC、observer 清理必须在 disconnect/generation 失效时完成。
- `聊天媒体编排.ts` 把批量窗口重算做成可取消、可让路的 owner 动作；必要时使用 `scheduler.yield()` 或等价机制，但不能改变业务真相。
- 架构检查钉死：shell 不创建 WebTorrent，不创建 Video.js 第二实例，不解释正式媒体字节入口。

- [ ] **步骤 4：转绿并提交**

Run:

```powershell
pnpm --dir frontend test -- "tests/房间消息窗媒体查看器测试.spec.ts" "tests/聊天媒体编排测试.spec.ts"
pnpm --dir frontend run check:browser-app-constitution
pnpm --dir frontend run check:architecture-fitness
```

Expected: all commands exit 0.

Commit:

```powershell
git add frontend/房间消息窗.ts frontend/聊天媒体编排.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts frontend/tests/聊天媒体编排测试.spec.ts scripts/check-frontend-browser-app-constitution.mjs scripts/check-frontend-architecture-fitness.mjs
git commit -m "前端: 增加浏览器应用媒体预算门禁"
```

---

## Task 7: 全量前端验证

**Files:**
- No production changes unless failures expose real root cause.

- [ ] **步骤 1：运行目标测试组**

Run:

```powershell
pnpm --dir frontend test -- "tests/媒体协作分发测试.spec.ts" "tests/资产协作分发运行时测试.spec.ts" "tests/媒体运行时测试.spec.ts" "tests/信息流视频预算测试.spec.ts" "tests/聊天媒体编排测试.spec.ts" "tests/房间消息窗媒体查看器测试.spec.ts" "tests/媒体查看器测试.spec.ts" "tests/媒体服务工作线程测试.spec.ts" "tests/媒体共享契约测试.spec.ts"
```

Expected: all selected tests pass.

- [ ] **步骤 2：运行全量前端测试**

Run:

```powershell
pnpm --dir frontend test
```

Expected: all frontend test files pass.

- [ ] **步骤 3：运行类型和构建**

Run:

```powershell
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

Expected: both commands exit 0; browser-app constitution and architecture-fitness checks pass inside build.

- [ ] **步骤 4：如果失败，用根因流程修复**

如果出现失败：

- 用 `superpowers:systematic-debugging`、`supxcode`、`investigate`、`qa`。
- 先复现、读调用链、找 owner 和破坏的不变量。
- 禁止 guard/timeout/mock 绿化。
- 修复后回到本 Task 第 1 步重跑。

---

## Task 8: 真实浏览器烟测

**Files:**
- No temporary scripts.
- Smoke evidence should be recorded in the task notes or final commit message, not by adding runtime-scanned helper scripts.

- [ ] **步骤 1：启动本地应用**

Run:

```powershell
.\run.ps1
```

Expected:

- frontend/backend/tracker/dev seeder 启动成功。
- `https://127.0.0.1/` 或本机 HTTPS 入口可访问。

- [ ] **步骤 2：用 chrome-devtools-cli 做桌面端链路**

必须直接使用 CLI 命令，不能新建临时 Playwright/Node 脚本。

Run:

```powershell
chrome-devtools new_page "https://127.0.0.1/" --timeout 30000
chrome-devtools resize_page 1440 900
chrome-devtools take_snapshot
chrome-devtools performance_start_trace --reload false --autoStop false --filePath "tmp\\唯一WebTorrent桌面.trace.json"
```

人工按真实流程或用 CLI uid 操作完成：

- 进入房间 `1234b` 或当轮测试房间。
- 上传图片和视频。
- 等新消息进入时间线。
- 连续滚动历史。
- 自动播放视频。
- 打开 viewer。
- 进入 fullscreen。
- 退出 viewer/fullscreen。
- 回到时间线再次点击同一视频。

收尾：

```powershell
chrome-devtools performance_stop_trace --filePath "tmp\\唯一WebTorrent桌面.trace.json"
chrome-devtools list_console_messages --includePreservedMessages true
chrome-devtools list_network_requests --includePreservedRequests true --pageSize 300
chrome-devtools evaluate_script "() => JSON.stringify(window.__kokoBudgetSnapshot?.() ?? null)"
```

Expected:

- console error 0。
- request failure 0 或仅有已解释的非产品失败。
- 新主链附件未命中 HLS、原文件直链、CDN、临时 range、service worker 私有 cache、本地文件 URL。
- `budgetSnapshot` 包含 DOM/video/image/activeMediaSession/warmCandidate/reader/listener/WebTorrent peer/download/upload/JS heap/renderer memory/LoAF/rVFC/CWV/owner generation。

- [ ] **步骤 3：用 playwright-cli 做移动端/长流程链路**

Run:

```powershell
playwright-cli open --browser=chrome "https://127.0.0.1/"
playwright-cli resize 390 844
playwright-cli snapshot
playwright-cli console
playwright-cli network
```

继续用 CLI 真实操作：

- 进入同一房间。
- 上滑/下滑长消息流。
- 触摸等价滚动。
- 自动播放。
- viewer/fullscreen。
- 后台/前台切换。
- 返回后再次点击同一视频。

采样：

```powershell
playwright-cli --raw eval "JSON.stringify(window.__kokoBudgetSnapshot?.() ?? null)"
playwright-cli --raw eval "JSON.stringify(performance.getEntriesByType('long-animation-frame').slice(-20))"
playwright-cli console warning
playwright-cli console error
playwright-cli network
```

Expected:

- 移动预算更紧，但不白屏、不假失败、不恢复第二主链。
- viewer/fullscreen 归位后同一视频不出现“附件当前不可获取”。
- `budgetSnapshot` 证明滑走后补齐/做种/帮助任务仍在轻态或冷帮助索引中保留。

- [ ] **步骤 4：如果烟测失败，按根因闭环修复**

失败分类：

- 非 WebTorrent 内容字节入口出现：回 Task 1。
- 重对象不回落：回 Task 3 或 Task 4。
- viewer/fullscreen 闪烁或归位失败：回 Task 5。
- LoAF/INP/layout 长尾超标：回 Task 6。
- WebTorrent 404 tailwave：回 `媒体协作分发.ts` route drain / ref-count / generation。

每次修复后重跑 Task 7 和 Task 8，不允许只跑局部通过就收工。

---

## Task 9: graphify、状态和最终提交

**Files:**
- Code changes only if previous tasks required them.

- [ ] **步骤 1：代码改动后更新图谱**

Run:

```powershell
graphify update .
```

Expected: graphify exits 0 and updates `graphify-out/`.

- [ ] **步骤 2：最终状态检查**

Run:

```powershell
git diff --check
git status --short
```

Expected:

- `git diff --check` exit 0。
- 只剩本轮有意修改。

- [ ] **步骤 3：最终提交**

Commit:

```powershell
git add frontend scripts graphify-out
git commit -m "前端: 完成唯一WebTorrent零崩溃零闪烁收口"
```

提交说明必须写清：

- 正式媒体内容字节只走 WebTorrent 的证据。
- 预算 owner 收口文件。
- 唯一播放器连续性证据。
- 单元测试、构建、chrome-devtools-cli、playwright-cli 烟测结果。

---

## 自审清单

- [ ] 是否保留唯一 `WebTorrent` whole-file swarm 正式媒体内容字节主链？
- [ ] 是否没有新增第二播放器、第二分发链、第二媒体字节入口？
- [ ] 是否仍允许控制面走 `HTTPS/WSS`，但不让控制面承载正式媒体字节？
- [ ] 是否保留自动播放进入帮助链、滑走不停补齐、做种资格和后 `24 小时` peer 接力？
- [ ] 是否保留同一颗 `Video.js v10` player/container 在时间线、viewer、fullscreen 之间迁移？
- [ ] 是否把 Lit 限定为投影层，没有让组件局部解释业务 ready、swarm ready 或 media ready？
- [ ] 是否所有重对象都有预算解释，解释不出来就默认按泄漏处理？
- [ ] 是否用 `chrome-devtools-cli` 和 `playwright-cli` 两条 CLI 链完成真实烟测？
- [ ] 是否没有临时脚本、隐藏测试胶水、截图式假证据？
- [ ] 是否在代码改动后运行 `graphify update .`？

---

## 执行方式

本计划适合按任务顺序执行，不适合跳着修：

1. 先收口 WebTorrent 字节入口。
2. 再收口附件级预算投影。
3. 再收口聚合预算 owner。
4. 再让 Lit 壳只消费投影。
5. 再巩固唯一播放器连续性。
6. 再加架构门禁。
7. 最后跑全量测试、真实浏览器烟测和 graphify。

如果执行过程中遇到 bug、测试失败或烟测异常，立即转入 `superpowers:systematic-debugging` + `supxcode` + `investigate` + `qa` 根因流程；禁止对表面打补丁。
