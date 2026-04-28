# 唯一 WebTorrent 万人群聊零崩溃零闪烁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 [2026-04-26-万人群聊浏览器零崩溃零闪烁 spec](../specs/2026-04-26-万人群聊浏览器零崩溃零闪烁.md) 的新版裁决：整个项目正式媒体字节尽量只走唯一 `WebTorrent` whole-file swarm，在不削弱协作主链的前提下让桌面端和移动端长时间群聊不闪、不抽、不崩。

**Architecture:** 正式媒体字节 owner 只分三层：`媒体播放.ts` 裁决“这次正式读取是不是 WebTorrent”、`资产协作分发运行时.ts` 管 WebTorrent swarm 生命周期和轻/重预算、`全局唯一播放器.ts` 只迁移唯一 Video.js player/container。`HLS/DASH`、原文件直链、CDN、`p2p-media-loader`、临时 range、静态 preview 和浏览器缓存不得成为新主链成功路径；如因历史数据暂存，必须隔离成 `legacy/benchmark`，并且不参与新附件正式验收。

**Tech Stack:** TypeScript, Lit, XState, Video.js v10 shell, WebTorrent 2.x, Service Worker, Vitest, Rust/Axum/SQLx, Chrome DevTools CLI, Playwright CLI, graphify.

---

## 0. 当前代码事实

### 0.1 已经成立的好事实

1. 新上传视频 complete 路径已经倾向单文件 canonical：`src/媒体上传外壳.rs` 里新视频不再默认生成 HLS/DASH manifest，`tests/媒体上传测试/单文件主链.rs` 已有守卫。
2. 后端 locator 已暴露 WebTorrent 运行态线索：`torrent_url`、`torrent_info_hash`、`announce_urls`、`web_seed_url`、`join_ticket`、`media_state`、`survival_mode`。
3. 前端正式视频播放解析在 `frontend/媒体/媒体播放.ts`，视频 swarm 不可用时已经倾向降级为不可获取，而不是回退 original。
4. WebTorrent 浏览器 runtime 在 `frontend/媒体/媒体协作分发.ts`，已经使用官方 `webtorrent`、service worker 和 `client.createServer({ controller })`。
5. swarm 会话生命周期和预算在 `frontend/媒体/资产协作分发运行时.ts`，已有 `zeroRefHeavySessionCount`、`zeroRefWholeFileReaderCount`、轻帮助态等投影。
6. 唯一播放器 owner 已在 `frontend/媒体/全局唯一播放器.ts`，消息流、viewer、fullscreen 都应该迁移同一颗 player/container。
7. hidden preview probe 已在 `frontend/媒体/视频预览.ts` 接入 `AbortSignal`，并用 `pause + removeAttribute("src") + load` 做 teardown。

### 0.2 仍会阻挡唯一 WebTorrent 的风险

1. `frontend/媒体/媒体播放.ts` 的 `媒体播放结果` 类型仍保留 `mode: "manifest"`；`frontend/房间消息窗.ts`、`frontend/媒体/壳层/查看器会话协作.ts`、`frontend/聊天应用内核.ts` 仍有 manifest 投影测试或兼容分支。
2. `frontend/媒体/videojs播放器壳.ts` 仍能加载 `hls.js`，并有 HLS fatal fallback；`frontend/媒体/媒体查看器.ts` 仍动态 import `p2p-media-loader-hlsjs`。
3. `frontend/media-sw.ts` 仍缓存 HLS/DASH manifest/segments；如果不隔离，会让烟测误把缓存命中当作正式播放成功。
4. `src/媒体资产外壳.rs` 仍有 `streaming_asset` 和 `load_streaming_asset_content`；`tests/协作分发测试.rs` 仍有把 HLS/DASH 叫成“正式主链”的旧断言。
5. `contentUrlByAttachmentId`、图片大图、thumbnail/poster、preview_asset 仍可能把原文件或静态图带到壳层；它们可以表达冷 UI 或 legacy 证据，但不能冒充正式可播真相。
6. 当前预算快照还缺 `liveVideoElementWithSrcCount`、`hiddenProbeCount`、`previewVideoWithSrcCount`、正式 source mode 等浏览器验收指标。

### 0.3 不允许的做法

1. 不允许为了首帧快保留新附件 HLS/DASH 正式播放路径。
2. 不允许把 `web_seed_url` 直接喂给 `<video>`；它只能进 WebTorrent `urlList`。
3. 不允许把 `p2p-media-loader` 包装成 WebTorrent whole-file swarm。
4. 不允许把静态 poster、preview still、thumbnail 命中记为 WebTorrent 秒开成功。
5. 不允许新增第二播放器、第二 WebTorrent runtime、第二媒体预算 owner。
6. 不允许新增仓库 smoke 脚本替代真实 CLI 烟测；烟测必须用 `chrome-devtools-cli` 与 `playwright-cli` 的 CLI 链路记录命令和输出。
7. 不允许把 CDN 命中、临时 range 服务、Service Worker / CacheStorage 命中、静态 preview cache 命中记为正式视频播放成功。

---

## 1. 文件地图

### 1.1 后端与契约

- Modify: `src/契约.rs`  
  说明 `streaming_asset` 只允许 legacy/benchmark，或从新主链响应退场。
- Modify: `src/媒体资产外壳.rs`  
  隔离 `streaming_asset`、`load_streaming_asset_content`、冷源投影；新主链视频只投影 `file_asset + distribution`。
- Modify: `src/媒体协作分发.rs`  
  保持 WebTorrent locator、join ticket、media_state、survival_mode 是唯一正式分发事实。
- Modify if needed: `src/媒体上传外壳.rs`  
  保持新上传视频 complete 不写 HLS/DASH manifest，必要时补注释和测试。
- Modify: `frontend/契约.ts`  
  同步 TypeScript 契约：manifest/HLS 只能是 legacy/benchmark，不能是正式新主链 playback mode。

### 1.2 前端正式媒体链

- Modify: `frontend/媒体/媒体播放.ts`  
  正式视频播放只返回 `swarm` 或真实失败态；删除或隔离 `manifest` 正式模式。
- Modify: `frontend/媒体/媒体协作分发.ts`  
  保持官方 WebTorrent `streamURL` / service worker / route drain；确保 web seed 只进 `urlList`。
- Modify: `frontend/媒体/资产协作分发运行时.ts`  
  锁死轻帮助态、whole-file heavy reader 预算和 source evidence。
- Modify: `frontend/媒体/媒体查看器.ts`  
  删除或 legacy 隔离 `p2p-media-loader-hlsjs` 支路，不让 viewer 把 HLS 当正式播放成功。
- Modify: `frontend/媒体/videojs播放器壳.ts`  
  删除或 legacy 隔离 HLS provider；正式播放器壳只消费 WebTorrent/file source。
- Modify: `frontend/媒体/全局唯一播放器.ts`  
  保持唯一 player/container 迁移，不接管 source owner。
- Modify: `frontend/媒体/壳层/查看器会话协作.ts`  
  查看器投影只接受 `swarm` 和必要 legacy；正式新视频不得投影 manifest。
- Modify: `frontend/房间消息窗.ts`  
  时间线、viewer request、自动播 host 不再把 manifest/original 当正式视频源。
- Modify: `frontend/聊天媒体编排.ts`  
  `contentUrlByAttachmentId` 和帮助窗口只服务当前预算窗口，不给整房历史构造重直链。
- Modify: `frontend/媒体/壳层/视频预览协作.ts`
  locator / swarm preview source 阶段也接入退场取消或 generation 失效。
- Modify: `frontend/媒体运行时.ts`  
  预算快照补足 spec 要求的正式 source / live video / probe 指标。
- Modify: `frontend/media-sw.ts`  
  HLS/DASH 缓存改成 legacy/benchmark 或删除；正式 smoke 不允许它证明成功。

### 1.3 测试

- Modify: `tests/协作分发测试.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/流媒体资产契约测试.rs`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/videojs播放器壳测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`
- Modify: `frontend/tests/视频预览协作测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`

### 1.4 `budgetSnapshot` 必填表

实现时必须把 spec 14.5 的观测面直接落成可读快照。任何字段缺失都视为验收失败，因为缺字段就无法证明“零崩溃零闪烁”不是靠肉眼猜出来的。

| 字段 | 桌面阈值 | 移动阈值 | 失败判据 |
| --- | --- | --- | --- |
| `activeFormalPlayerCount` | `<= 1` | `<= 1` | 同时存在两颗正式播放器即失败 |
| `autoplayOwnerCount` | `<= 1` | `<= 1` | 自动播 owner 分裂即失败 |
| `currentHeavyVideoOwnerCount` | `<= 1` | `<= 1` | 重视频 owner 分裂即失败 |
| `bridgeVideoSurfaceCount` | `<= 1` 且 bridge `<= 800ms` | `<= 1` 且 bridge `<= 500ms` | 交接桥接面超量或超时即失败 |
| `liveVideoElementWithSrcCount` | `<= 6` | `<= 3` | 真实带 src 的 video 超预算即失败 |
| `formalVideoElementWithSrcCount` | `<= 1` | `<= 1` | 正式视频 src 超过一处即失败 |
| `hiddenProbeCount` | `<= 2` | `<= 1` | hidden probe 超预算即失败 |
| `lightPreviewVideoWithSrcCount` | `<= 4` | `<= 2` | 轻 preview 带 src 超预算即失败 |
| `warmCandidateCount` | `<= 4` | `<= 2` | 预热候选超预算即失败 |
| `inflightPreviewBootstrapCount` | `<= 4` | `<= 2` | preview bootstrap 并发超预算即失败 |
| `activeStreamReaderCount` | `<= 1` | `<= 1` | 前台 heavy reader 超过当前 owner 即失败 |
| `lightHelpForegroundReaderCount` | `== 0` | `== 0` | 轻帮助态拉起前台 reader 即失败 |
| `activeMediaSessionCount` | `<= 12` | `<= 6` | 活跃媒体会话超预算即失败 |
| `zeroRefHeavySessionCount` | `== 0` | `== 0` | 零引用重会话即失败 |
| `zeroRefWholeFileReaderCount` | `== 0` | `== 0` | 零引用 whole-file reader 即失败 |
| `zeroRefLightHelpSessionCount` | `<= 32` | `<= 8`，hidden/pagehide 后 `<= 4` | 轻帮助态泄露即失败 |
| `listenerCountByEvent.data/close/error` | 每类 `<= 3` | 每类 `<= 2` | listener 膨胀或 `MaxListenersExceededWarning` 即失败 |
| `timelineDomNodeCount` | `<= 800` | `<= 500` | 时间线 DOM 超预算即失败 |
| `pageDomNodeCount` | `<= 1400` | `<= 900` | 页面 DOM 超预算即失败 |
| `renderedTimelineRowCount` | `<= 40` | `<= 24` | 实渲染行数超预算即失败 |
| `nearWindowAttachmentCardCount` | `<= 80` | `<= 48` | 近窗口附件卡超预算即失败 |
| `imageSurfaceCount` | `<= 24` | `<= 12` | 图片 surface 超预算即失败 |
| `visibleLargeOrOriginalImageCount` | `<= 8` | `<= 4` | 大图/原图可见数超预算即失败 |
| `jsHeapUsedBytes` | 稳态 `<= 180MB`，压力后 `<= 220MB` | 稳态 `<= 90MB`，压力后 `<= 120MB` | JS heap 不回落即失败 |
| `rendererPrivateMemoryBytes` | `<= 700MB`，`>= 1GB` 硬失败 | `<= 350MB`，`>= 500MB` 硬失败 | renderer 内存不回落即失败 |
| `gpuMemoryBytes` | 记录并证明压力后回落 | 记录并证明压力后回落 | GPU/纹理内存持续上升即失败 |
| `lcpMs` | `<= 2500ms` | `<= 2500ms` | Core Web Vitals 超阈值即失败 |
| `cls` | `< 0.1` | `< 0.1` | 布局偏移超阈值即失败 |
| `inpMs` | `<= 200ms`，本地目标 `<= 100ms` | `<= 200ms`，本地目标 `<= 100ms` | 交互阻塞，或单次 `> 150ms` 长任务即失败 |
| `loafOver50msDelta` | `== 0` | `== 0` | 新增 LoAF 即失败 |
| `frameP95Ms/frameP99Ms` | 120Hz: p95 `<= 8.33ms`，p99 `<= 16.67ms`; 60Hz: p95 `<= 16.67ms` | 60Hz: p95 `<= 16.67ms` | 帧分布超预算即失败 |
| `jsStyleLayoutP95Ms` | 120Hz `<= 4ms`，60Hz `<= 8ms` | 60Hz `<= 8ms` | JS/style/layout 尾巴超预算即失败 |
| `rvfcDroppedFrameRatio` | `< 5%` | `< 5%` | `requestVideoFrameCallback` 掉帧超预算即失败 |
| `rvfcProcessingP95Ms` | `<= 20ms` | `<= 20ms` | 视频帧处理尾巴超预算即失败 |
| `previewTruthMs` | `<= 1200ms` | `<= 1800ms` | preview truth 超时或假成功即失败 |
| `warmToAutoplayMs` | `<= 250ms` | `<= 400ms` | 预热到自动播超时即失败 |
| `coldWebTorrentFirstFrameMs` | `<= 2000ms` | `<= 3000ms` | 冷 WebTorrent 首帧超时即失败 |
| `viewerOpenReturnMs` | `<= 250ms` | `<= 250ms` | viewer/fullscreen 打开或归位超时即失败 |
| `fakeUnavailableCount` | `== 0` | `== 0` | 同视频往返出现假“当前不可获取”即失败 |
| `webTorrentRouteDrainMs` | `>= 2000ms` | `>= 2000ms` | `/webtorrent/...` 尾波期间 404 即失败 |
| `ownerGeneration` / `sourceMode` / `formalSourceEvidence` | 必填 | 必填 | 无法证明当前正式 source 来自 WebTorrent 即失败 |

---

## 2. Task 1: 先把第二链写成红测

**Files:**
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/videojs播放器壳测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`
- Modify: `tests/协作分发测试.rs`

- [ ] **Step 1: 重读当前第二链入口**

Run:

```powershell
rg -n 'mode: "manifest"|p2p-media-loader|hls\.js|kind: "hls"|hls_master_url|dash_mpd_url|master\.m3u8|streaming_asset|variant=original|originalSrc|buildAttachmentContentUrl|CDN|cdn|CacheStorage|caches\.open|workbox-range-requests|Range|206|preview_asset|thumbnail_url|still_url|media-sw|ServiceWorker|serviceWorker' src frontend tests -g '!frontend/dist/**'
```

Expected: 能列出 HLS/DASH、manifest mode、original/direct、CDN、临时 range、Service Worker / CacheStorage、静态 preview cache 和 p2p-media-loader 的所有活入口。

失败条件：

1. 新主链正式播放经过 CDN、临时 range 服务、`Range`/`206` 原文件服务、`workbox-range-requests` 即失败。
2. `media-sw` / `CacheStorage` 命中被当作正式播放成功即失败。
3. `preview_asset`、`thumbnail_url`、`still_url`、poster、静态缓存被当作正式可播即失败。
4. `web_seed_url` 直接进入 `<video src>`、Video.js source 或 viewer request 即失败。

- [ ] **Step 2: 写媒体播放红测**

在 `frontend/tests/媒体播放测试.spec.ts` 增加或改写测试：

```ts
it("新主链视频即使 locator 带 streaming_asset，也不能返回 manifest 播放结果", async () => {});

it("新主链视频 swarm 不可用时返回真实失败态，不回退 original/canonical 直链", async () => {});

it("web_seed_url 只能透传给 WebTorrent urlList，不会作为播放器 src", async () => {});
```

Expected RED: 如果当前仍能产生 `mode: "manifest"` 或 original/canonical 播放成功，测试失败。

- [ ] **Step 3: 写 viewer / Video.js 红测**

在 `frontend/tests/媒体查看器测试.spec.ts` 和 `frontend/tests/videojs播放器壳测试.spec.ts` 增加：

```ts
it("正式新视频查看器不加载 hls.js，也不挂 p2p-media-loader", async () => {});

it("Video.js 壳收到新主链视频时只按 file/swarm source 同步，不创建 HLS provider", async () => {});
```

Expected RED: 仍动态 import HLS 或 P2P HLS 增强时失败。

- [ ] **Step 4: 写消息窗和内核红测**

在 `frontend/tests/房间消息窗媒体查看器测试.spec.ts` 与 `frontend/tests/聊天应用内核测试.spec.ts` 增加：

```ts
it("消息窗不会把 manifest playback 投影成正式查看器视频 src", async () => {});

it("本地完整视频重开查看器时必须重裁到 WebTorrent swarm，不允许先走 HLS manifest", async () => {});
```

Expected RED: 现有 manifest 兼容投影仍存在时失败。

- [ ] **Step 5: 写后端 locator 红测**

在 `tests/协作分发测试.rs` 或子模块里改写旧测试：

1. 新上传单文件视频 locator 返回 `file_asset` 和 `distribution`。
2. 新上传视频不返回 HLS/DASH manifest 作为正式主链。
3. 如果历史 `streaming_asset` 仍存在，必须标注为 legacy/benchmark，并且不参与新主链验收。

Run:

```powershell
cargo test --test 协作分发测试
```

Expected RED: 旧测试里“视频 locator 应返回正式 HLS 主清单入口”这类断言必须先失败或被改成 legacy 断言。

---

## 3. Task 2: 后端契约收口为 WebTorrent 唯一正式表面

**Files:**
- Modify: `src/契约.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/媒体协作分发.rs`
- Modify if needed: `src/媒体上传外壳.rs`
- Modify: `frontend/契约.ts`
- Modify: `tests/协作分发测试.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/流媒体资产契约测试.rs`

- [ ] **Step 1: 修改契约注释和类型语义**

要求：

1. `媒体清单描述` 不再写“标准主入口”。
2. `流媒体资产描述` 明确是 `legacy_streaming_asset` 或历史兼容面。
3. `媒体分发描述` 明确是正式新主链分发表面。
4. `媒体冷源描述` 只能是 WebTorrent web seed / 旧债冷备来源，不能是播放器正式 src。

- [ ] **Step 2: 新视频 locator 只暴露 file_asset 正式表面**

修改 `src/媒体资产外壳.rs`：

1. 对新上传单文件视频，`media_asset` / locator 只返回 `file_asset`、`distribution`、`media_state`。
2. HLS/DASH manifest 不再投影为新主链字段。
3. `origin.original_url` 只能保留在冷源描述里，且注释写明“禁止喂播放器”。

- [ ] **Step 3: 历史 HLS 只允许 legacy 隔离**

如果数据库里已有 `attachment_streaming_manifests`，处理规则：

1. endpoint 可暂时保留给旧数据读取或 benchmark。
2. 响应命名、测试名、注释都不得再叫“正式主链”。
3. `streaming_deleted_at` 后仍必须返回 null manifest。
4. 新上传路径不能再写 manifest 行。

- [ ] **Step 4: 保持 WebTorrent locator 不被削弱**

检查 `src/媒体协作分发.rs`：

1. `torrent_url` 必须可取到 metainfo。
2. `announce_urls` 必须同源或明确公网 tracker。
3. `web_seed_url` 只服务 WebTorrent `urlList`。
4. `join_ticket` 继续绑定 attachment/infohash。
5. `MEDIA_CONNECTING_TO_PEERS / MEDIA_NO_ONLINE_SEED` 继续表达真实可恢复来源，不得因为没有 HLS 就假成功。

- [ ] **Step 5: 跑后端定向测试**

Run:

```powershell
cargo test --test 协作分发测试
cargo test --test 媒体上传测试
cargo test --test 流媒体资产契约测试
```

Expected: 新上传视频只以 WebTorrent/file_asset 为正式表面；legacy HLS 断言只出现在 legacy/benchmark 语境。

---

## 4. Task 3: 前端播放结果删除正式 manifest mode

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/壳层/查看器会话协作.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/聊天应用内核.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 删除或隔离 `mode: "manifest"` 正式类型**

修改 `frontend/媒体/媒体播放.ts`：

1. `媒体播放结果` 的正式视频可播 mode 只允许 `swarm`。
2. `anchor` 只能保留给图片、legacy 冷源或明确非视频兼容，不得服务新主链视频。
3. 如果确实还需保留 manifest 类型，必须改名为 `legacy_manifest`，并且只能在 legacy 文件/测试中出现。

- [ ] **Step 2: 更新播放器注释**

把 `媒体播放.ts` 顶部“swarm 不足退回锚点”的旧注释改掉：

1. 视频：swarm 不足即真实不可用 / connecting / no seed。
2. 图片：按 blob canonical / swarm 规则读取。
3. 冷源：只作为 WebTorrent web seed 或 legacy 证据，不是正式播放链。

- [ ] **Step 3: 清掉查看器 manifest 投影**

修改 `frontend/媒体/壳层/查看器会话协作.ts`：

1. `可投影媒体播放结果` 不接受正式 `manifest`。
2. 查看器 request 不再携带 HLS `fallbackSrc` / `streamingDistribution` 作为新主链字段。
3. recovering 阶段继续清空旧 src，等待 WebTorrent owner 重裁。

- [ ] **Step 4: 清掉消息窗 manifest host**

修改 `frontend/房间消息窗.ts`：

1. `读取附件播放源` 不把 manifest 当正式可播源。
2. `同步时间线唯一播放器宿主` 的 `kind` 对新主链只应是 `file`。
3. 视频未拿到 swarm 时只显示 poster/preview truth，不能塞 m3u8 或 original 到 `<video>`。

- [ ] **Step 5: 跑前端定向测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/媒体播放测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天应用内核测试.spec.ts
```

Expected: 正式新视频只出现 `mode: "swarm"` 或真实失败态；没有 manifest 新主链成功。

---

## 5. Task 4: 删除或隔离 HLS 与 p2p-media-loader 前端活支路

**Files:**
- Modify: `frontend/媒体/videojs播放器壳.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/media-sw.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/tests/videojs播放器壳测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`

- [ ] **Step 1: 判断能否直接删依赖**

Run:

```powershell
rg -n 'hls\.js|p2p-media-loader-hlsjs|kind: "hls"|HlsJsP2PEngine' frontend -g '!frontend/dist/**'
```

Expected: 只剩 `videojs播放器壳.ts`、`媒体查看器.ts`、测试和 package 依赖。

- [ ] **Step 2: 删除正式 HLS provider**

首选实现：

1. 从 `videojs播放器壳.ts` 删除动态 import `hls.js`、HLS 实例、HLS fallback。
2. 播放器壳只接受 `kind: "file"` 的 source。
3. 如果暂时必须保留 legacy，移动到明确 `legacy` 命名的窄路径，并且默认不被新主链调用。

- [ ] **Step 3: 删除 `p2p-media-loader-hlsjs` 正式挂点**

修改 `媒体查看器.ts`：

1. 删除 `HlsJsP2PEngine` 动态 import。
2. 删除 `挂接P2PHls增强层` 作为正式壳依赖。
3. 如果保留 benchmark，必须只能由测试或显式 benchmark 入口调用，不进入 viewer 正式路径。

- [ ] **Step 4: 收口 service worker 缓存**

修改 `frontend/media-sw.ts`：

1. 正式媒体播放烟测只允许 `/webtorrent/...` / WebTorrent stream server 证据。
2. HLS/DASH manifest/segment 缓存删除或改成 legacy cache，且不参与正式成功指标。
3. 不缓存新主链正式视频字节成第二读取真相。

- [ ] **Step 5: 清理依赖**

如果步骤 2/3 已删掉所有正式引用：

```powershell
pnpm --dir frontend remove hls.js p2p-media-loader-hlsjs
pnpm --dir frontend install --lockfile-only
```

Expected: `frontend/package.json` 和 `frontend/pnpm-lock.yaml` 不再保留无用 HLS/P2P HLS 依赖。

- [ ] **Step 6: 跑 HLS 隔离测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/videojs播放器壳测试.spec.ts tests/媒体查看器测试.spec.ts tests/媒体服务工作线程测试.spec.ts
```

Expected: 正式 viewer / player 不加载 HLS；legacy/benchmark 如保留，必须被测试名和断言隔离。

---

## 6. Task 5: 收口媒体预算 owner 和浏览器重对象指标

**Files:**
- Modify: `frontend/媒体运行时.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Modify: `frontend/tests/聊天媒体编排测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`

- [ ] **Step 1: 扩展预算快照**

新增或投影 `1.4` 表里的全部字段，最低必须覆盖这些代码侧字段：

1. `activeFormalPlayerCount`
2. `autoplayOwnerCount`
3. `currentHeavyVideoOwnerCount`
4. `bridgeVideoSurfaceCount`
5. `bridgeVideoSurfaceAgeMs`
6. `activeSwarmCount`
7. `wholeFileHeavySessionCount`
8. `zeroRefHeavySessionCount`
9. `zeroRefWholeFileReaderCount`
10. `zeroRefLightHelpSessionCount`
11. `liveVideoElementWithSrcCount`
12. `formalVideoElementWithSrcCount`
13. `hiddenProbeCount`
14. `lightPreviewVideoWithSrcCount`
15. `warmCandidateCount`
16. `inflightPreviewBootstrapCount`
17. `activeStreamReaderCount`
18. `lightHelpForegroundReaderCount`
19. `activeMediaSessionCount`
20. `listenerCountByEvent`
21. `timelineDomNodeCount`
22. `pageDomNodeCount`
23. `renderedTimelineRowCount`
24. `nearWindowAttachmentCardCount`
25. `imageSurfaceCount`
26. `visibleLargeOrOriginalImageCount`
27. `jsHeapUsedBytes`
28. `rendererPrivateMemoryBytes`
29. `gpuMemoryBytes`
30. `lcpMs`
31. `cls`
32. `inpMs`
33. `loafOver50msDelta`
34. `frameP95Ms`
35. `frameP99Ms`
36. `jsStyleLayoutP95Ms`
37. `rvfcDroppedFrameRatio`
38. `rvfcProcessingP95Ms`
39. `previewTruthMs`
40. `warmToAutoplayMs`
41. `coldWebTorrentFirstFrameMs`
42. `viewerOpenReturnMs`
43. `fakeUnavailableCount`
44. `webTorrentRouteDrainMs`
45. `ownerGeneration`
46. `sourceMode`
47. `formalSourceEvidence`

Expected: 快照能区分桌面/移动阈值，能标出 owner generation，能说明正式 source 是 WebTorrent stream server、blob swarm source，还是失败态；不能只输出“activeVideoCount”这类粗字段。

- [ ] **Step 2: `contentUrlByAttachmentId` 不再放大整房直链**

修改 `frontend/聊天媒体编排.ts`：

1. 视频不为整房历史构造 `originalSrc`。
2. 图片大图只服务当前窗口或 viewer 明确打开，不服务整房历史。
3. 远处历史只保留冷表达，不预先拿重 URL。

- [ ] **Step 3: 帮助窗口不拉活整房附件**

修改 `读取当前帮助窗口附件标识`、`读取当前房间帮助附件候选`、`协作补齐协作.恢复当前房间缓存帮助任务`：

1. 默认输入不能是整房所有附件。
2. help window 只来自当前媒体窗口、自动播候选、viewer、owner、已完整缓存且在帮助窗口内的条目。
3. 轻帮助保留协作价值，不保留前台重 reader。

- [ ] **Step 4: 房间消息窗只按窗口渲染真实表面**

修改 `frontend/房间消息窗.ts`：

1. 真实 preview `<video src>` 稳态受预算限制。
2. 当前 owner、刚退场 owner、自动播候选优先。
3. 远处视频只显示 poster/preview truth，不保留 `/webtorrent/...` src。
4. 图片 `<img>` 数量遵守虚拟窗口，不被 content URL 表放大。

- [ ] **Step 5: 锁死轻帮助态**

修改 `frontend/媒体/资产协作分发运行时.ts`：

1. 零引用降轻时必须 `file.deselect()` 或等价停掉 whole-file heavy reader。
2. 保留 presence/join ticket/locallyComplete 协作价值。
3. `zeroRefHeavySessionCount == 0`。
4. `zeroRefWholeFileReaderCount == 0`。

- [ ] **Step 6: 跑预算定向测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/媒体运行时测试.spec.ts tests/聊天媒体编排测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/资产协作分发运行时测试.spec.ts
```

Expected: spec 14.5 的 v0 预算能被测试读到，并且超限会失败。

---

## 7. Task 6: hidden probe 与 preview truth 不再成为第二链

**Files:**
- Modify: `frontend/媒体/视频预览.ts`
- Modify: `frontend/媒体/壳层/视频预览协作.ts`
- Modify: `frontend/tests/视频预览测试.spec.ts`
- Modify: `frontend/tests/视频预览协作测试.spec.ts`

- [ ] **Step 1: 给 locator / swarm preview source 接入取消**

要求：

1. 附件退场、代次变化、viewer 切换、生命周期降载时，locator 请求必须 abort 或 generation 失效。
2. `解析协作分发预览源` 阶段失败或取消后必须释放 preview consumer。
3. 旧 generation 的 preview 结果不能写回当前状态。

- [ ] **Step 2: preview 不冒充正式成功**

测试必须断言：

1. 静态 poster / thumbnail / preview still 只能是 UI 表达。
2. hidden probe 抓到首帧不能把 formal source mode 改成成功。
3. 只有 WebTorrent swarm playback / streamURL 成立，才算正式视频可播。

- [ ] **Step 3: 保持 teardown 严格**

继续要求：

1. `pause()`
2. `removeAttribute("src")`
3. `load()`
4. AbortSignal
5. consumer release

- [ ] **Step 4: 跑 preview 定向测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/视频预览测试.spec.ts tests/视频预览协作测试.spec.ts
```

Expected: preview 取消、旧代次失效、consumer release、静态图不冒充正式可播全部通过。

---

## 8. Task 7: WebTorrent 官方链路证据化

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`

- [ ] **Step 1: 记录正式 source 证据**

正式 swarm source 必须可观测：

1. `serviceWorker.controller` 已接管或给出不可用原因。
2. `client.createServer({ controller })` 已创建。
3. source 来自 `file.streamURL` 或等价 WebTorrent stream server。
4. `torrent_info_hash` 与 locator 一致。
5. `web_seed_url` 进入 `urlList`，不直接成为播放器 src。

- [ ] **Step 2: route drain 继续按真实尾波**

保持 `/webtorrent/...` route drain：

1. drain 不短于 `2000ms`。
2. 由 ref-count / generation 决定释放。
3. browser tailwave 未结束不能 retire route。
4. 烟测中 `/webtorrent/...` 404 记为失败。

- [ ] **Step 3: 完整 peer / 片段帮助者失败态**

后 `24 小时` 失败态不能只看 `complete_peer == 0`：

1. 有片段帮助者能组成可恢复来源时，不进入 `MEDIA_NO_ONLINE_SEED`。
2. 确实没有可恢复来源时，进入真实 no-seed。
3. 两种情况都不得回退 HLS、original 或服务器第二主链。

- [ ] **Step 4: 跑 WebTorrent 定向测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/媒体协作分发测试.spec.ts tests/资产协作分发运行时测试.spec.ts
cargo test --test 协作分发测试 -- 可用性裁决
```

Expected: WebTorrent source evidence、route drain、no-seed 语义全部可测。

---

## 9. Task 8: viewer / fullscreen / owner 归位不闪不假失败

**Files:**
- Modify: `frontend/媒体/全局唯一播放器.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/媒体/壳层/查看器会话协作.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/videojs播放器壳测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 写 owner 往返保护测试**

```ts
it("timeline -> viewer/fullscreen -> timeline -> 同视频 viewer 不会报附件当前不可获取", async () => {});

it("owner 切换只迁移同一颗 player/container，不创建第二颗正式播放器", async () => {});

it("fullscreen API 失败时仍进入 viewer 沉浸态，并保留下一次用户点击重试全屏", async () => {});
```

- [ ] **Step 2: 按 consumer 粒度释放**

要求：

1. viewer 关闭只释放 viewer consumer。
2. 时间线自动播 owner 仍活着时，不粗暴按 attachmentId 清掉 swarm source。
3. 旧失败态不能污染下一次点击。
4. `全局唯一播放器.ts` 不持有 source owner。

- [ ] **Step 3: 保持视觉连续性**

要求：

1. owner 交接期间 poster / preview truth / canonical host 不闪白。
2. 退场 bridge 窗口有上限。
3. rVFC 探针只写当前 owner generation。

- [ ] **Step 4: 跑 viewer 定向测试**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/媒体查看器测试.spec.ts tests/videojs播放器壳测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天应用内核测试.spec.ts
```

Expected: 同一视频往返、唯一播放器、fullscreen 失败恢复、无闪烁预算全部通过。

---

## 10. Task 9: CLI 真烟测与最终验收

**Files:**
- No new smoke scripts.
- Modify only documentation if recording smoke evidence is required.

- [ ] **Step 1: 定向测试合集**

Run:

```powershell
pnpm --dir frontend exec vitest run tests/媒体播放测试.spec.ts tests/媒体协作分发测试.spec.ts tests/资产协作分发运行时测试.spec.ts tests/媒体运行时测试.spec.ts tests/视频预览测试.spec.ts tests/视频预览协作测试.spec.ts tests/媒体查看器测试.spec.ts tests/videojs播放器壳测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天媒体编排测试.spec.ts tests/聊天应用内核测试.spec.ts tests/媒体服务工作线程测试.spec.ts
```

Expected: 全部通过，且测试名不再把 HLS/DASH/p2p-media-loader 称为正式主链。

- [ ] **Step 2: 全量构建验证**

Run:

```powershell
pnpm --dir frontend test
pnpm --dir frontend build
cargo test
```

Expected: 前端测试、前端构建、Rust 测试全部通过。

- [ ] **Step 3: 第二链残留扫描**

Run:

```powershell
rg -n 'mode: "manifest"|p2p-media-loader|hls\.js|kind: "hls"|hls_master_url|dash_mpd_url|master\.m3u8|streaming_asset|variant=original|originalSrc|web_seed_url|CDN|cdn|CacheStorage|caches\.open|workbox-range-requests|Range|206|preview_asset|thumbnail_url|still_url|media-sw|ServiceWorker|serviceWorker' src frontend tests -g '!frontend/dist/**'
```

Expected:

1. `mode: "manifest"`、`kind: "hls"` 不出现在正式播放路径。
2. `hls_master_url` / `dash_mpd_url` 只出现在 legacy/benchmark/历史清理测试。
3. `originalSrc` / `variant=original` 不能作为正式视频播放成功断言。
4. `web_seed_url` 只用于 WebTorrent `urlList` 或后端 locator 响应，不喂播放器。
5. CDN、临时 range、`Range`/`206`、Service Worker / CacheStorage、静态 preview cache 不能出现在正式成功路径。

- [ ] **Step 4: 启动本地服务**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

Expected: 本地 HTTP/HTTPS 服务启动成功，端口就绪。

- [ ] **Step 5: Chrome DevTools CLI 烟测**

按 `chrome-devtools-cli` skill 的 CLI 命令链执行，不新增仓库脚本：

1. 打开 `https://127.0.0.1/`。
2. isolated newcomer 进房。
3. 采集首屏 `budgetSnapshot`。
4. 连续滚动 30s。
5. 打开/关闭 viewer。
6. 点击当前自动播放视频进入 fullscreen/viewer，返回后再次点击同一视频。
7. 切 `hidden -> visible`。
8. 老用户离线后返回同一房间，重复滚动和打开同一视频。
9. 高压房间：大量视频、大量图片、长历史消息、连续滚动 30s。
10. `24 小时` 冷备退场后两种场景：无完整 peer 但片段帮助者可恢复；确实没有任何可恢复来源。
11. 采 console/network/performance/DOM/video/memory/CWV/LoAF/rVFC。

Expected:

1. `console error == 0`
2. `console warning == 0`
3. `MaxListenersExceededWarning == 0`
4. `Target crashed == 0`
5. `/webtorrent/...` 404 == 0
6. HLS/DASH/original/CDN/p2p-media-loader 请求没有成为正式视频播放成功路径
7. `activeFormalPlayerCount <= 1`
8. `zeroRefHeavySessionCount == 0`
9. `zeroRefWholeFileReaderCount == 0`
10. live video / hidden probe / preview video 数满足 spec 14.5
11. 120Hz 设备或模拟环境采到帧分布；p95/p99 不超 `1.4` 表。
12. rVFC 掉帧率和 processing p95 满足 `1.4` 表。
13. LoAF、layout、style、JS 尾巴满足 `1.4` 表。
14. LCP/INP/CLS/Core Web Vitals 满足 `1.4` 表。
15. JS heap、renderer private memory、GPU/纹理内存压力后回落。
16. `24 小时` 后如果片段帮助者可恢复，必须仍走 WebTorrent；如果确实无可恢复来源，必须真实 no-seed，不能回退第二链。

- [ ] **Step 6: Playwright CLI 补烟测**

按 `playwright-cli` skill 的 CLI 命令链执行，不新增仓库脚本：

1. 移动 viewport。
2. 触摸滚动。
3. inline/fullscreen/viewer 往返。
4. sender 上传小 MP4。
5. receiver 通过 WebTorrent 正式链路播放。
6. 移动端隐藏/恢复、长滚动、高压图片/视频房间各跑一轮。

Expected:

1. 移动模拟不白屏、不假失败。
2. 新视频正式 `<video src>` 只来自 `/webtorrent/` 或 blob swarm source。
3. `streamURL` / range / seek / peer/download/upload 指标进入 smoke 记录。
4. 静态 preview 命中只记为 UI 表达，不记为正式可播。
5. 移动端 `budgetSnapshot` 满足 `1.4` 表的移动阈值。

- [ ] **Step 7: 烟测证据模板**

最终验收必须在提交前留下这类记录，不允许只写“看起来正常”：

```text
command:
room:
account/device tier:
viewport/refresh rate:
scenario:
budgetSnapshot:
  activeFormalPlayerCount:
  currentHeavyVideoOwnerCount:
  liveVideoElementWithSrcCount:
  hiddenProbeCount:
  activeStreamReaderCount:
  jsHeapUsedBytes:
  rendererPrivateMemoryBytes:
  frameP95Ms/frameP99Ms:
  rvfcDroppedFrameRatio/rvfcProcessingP95Ms:
  lcpMs/inpMs/cls/loafOver50msDelta:
network:
  /webtorrent 2xx:
  /webtorrent 404:
  hls/dash:
  cdn/original/range/206:
  serviceWorker/cacheStorage success path:
webtorrentEvidence:
  infoHash:
  streamURL/blob swarm source:
  webSeed only in urlList:
  peers/downloaded/uploaded:
decision:
  pass/fail:
  failed threshold:
```

Expected: 每个桌面、移动、高压、老用户返回、24h 退场场景都有命令、环境、证据、失败阈值和裁决。

- [ ] **Step 8: graphify 与提交**

Run:

```powershell
graphify update .
git diff --check
git status --short
git add src frontend tests docs/superpowers/plans
git commit -m "修复：收口唯一WebTorrent媒体主链与浏览器预算"
```

Expected: graphify 更新成功，工作树只包含本轮必要改动，中文提交完成。

---

## 11. 完成定义

1. 新主链正式视频播放只有 WebTorrent whole-file swarm。
2. `HLS/DASH`、`p2p-media-loader`、original/canonical direct、CDN、临时 range、静态 preview、浏览器缓存都不能冒充正式播放成功。
3. `Video.js v10` 只做唯一播放器壳，不拥有 source owner。
4. `web_seed_url` 只作为 WebTorrent `urlList`，不直接喂播放器。
5. 同一视频 `timeline -> viewer/fullscreen -> timeline -> viewer` 不闪、不假失败。
6. hidden probe、preview、locator、swarm preview source 都能取消和释放 consumer。
7. 桌面端和移动端预算快照满足 spec 14.5。
8. 全量前端测试、构建、Rust 测试通过。
9. 真实 CLI 烟测证明 console 0 error / 0 warning、无 crash、无 WebTorrent 404 尾波、无第二链成功。
10. `graphify update .` 已执行，`git status --short` 干净，中文 commit 完成。
