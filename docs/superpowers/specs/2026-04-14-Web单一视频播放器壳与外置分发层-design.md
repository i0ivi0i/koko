# Web 单一视频播放器壳与外置分发层设计

日期：2026-04-14  
状态：Draft  
适用范围：`koko` 仓库 `Web 前端` 当前阶段的视频查看、播放、补齐、释放与分发层收口。  
关联文档：

- `docs/superpowers/specs/2026-04-13-群聊媒体实时收发全链路TDD疏通-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/plans/2026-04-14-群聊视频查看器黑屏转圈修复计划.md`

## 1. 为什么要单独写这份 spec

当前群聊视频链路已经暴露出一个非常具体的问题：

- 同一套业务里，视频查看器并不是“一个播放器壳”，而是多条实现路径并存；
- 黑屏、转圈、切源竞态、查看器主链不稳，已经证明这种并存不是抽象上的小瑕疵，而是运行时 bug 温床。

从当前代码看，项目实际上存在三条视频查看路径：

1. `自定义 HLS overlay + hls.js`
2. `Vidstack overlay`
3. `移动端原生全屏 fallback`

再加上 `WebTorrent / 媒体协作分发 / backfill / release` 这套分发运行时，当前结构已经非常容易出现下面这些问题：

1. 一次业务修复要同时判断到底该改哪条播放器链；
2. 一个 bug 可能其实是“播放器职责”和“分发职责”混层造成的；
3. 未来要加倍速、快捷键、字幕、埋点、错误提示、全屏、移动端行为时，很难保证所有链路一致；
4. 代码虽然复用了成熟轮子，但整体形态还不是“一个壳 + 多 provider + 外置分发层”，而是“两个播放器实现 + 一条原生旁路 + 一套 swarm 运行时”。

这份 spec 的目标，不是粗暴地“删掉一个库”，而是把视频能力收口成：

**一个播放器壳，一个统一事件表面，一个正式播放主链；分发、补齐、做种继续满血保留，但退回播放器外。**

## 2. 官方与较新最佳实践给出的方向

### 2.1 `hls.js` 的定位是薄播放引擎，不是播放器壳

`hls.js` 官方文档和仓库示例持续强调的核心动作很薄：

1. 创建一个 `Hls` 实例；
2. `attachMedia(video)`；
3. `loadSource(url)`；
4. 在浏览器支持原生 HLS 时，允许直接回退原生 `<video src>`。

这说明 `hls.js` 最适合承担“流媒体播放引擎”职责，而不是整个播放器 UI 壳。

### 2.2 `Vidstack` 的定位就是“一个壳，多 provider”

Vidstack 官方当前文档强调的是：

- 单一标准 API；
- 统一的 player shell；
- 不同 provider 在同一个壳里切换；
- `HLS / Video / Audio / YouTube` 这些只是 provider，不该长成多套业务壳。

这和本项目“未来要持续改造播放器，但不想一处功能改三套”的诉求高度一致。

### 2.3 `P2P Media Loader` 是增强层，不是 UI 播放器

`p2p-media-loader` 官方文档的重点是：

- 它是 P2P streaming engine；
- 可挂接 `hls.js`、`Shaka Player` 等播放引擎；
- 也可以和 `Vidstack` 这类播放器壳配合。

它自己不是播放器壳，更不应该成为“首播能不能成功”的唯一关键路径。

### 2.4 `WebTorrent` 是分发平面，不是完整 HLS 播放器

WebTorrent 官方文档重点是：

- `file.streamTo(video)`；
- `streamURL`；
- `createServer`；
- tracker / peer / service worker。

这说明它更像“文件与字节流分发层”，不是 HLS 主播放壳。

### 2.5 `Shaka` 和 `Video.js` 都是可选方向，但当前不是最优切入点

`Shaka Player` 很强，支持 `HLS / DASH / offline / DRM`，适合做流媒体内核；  
`Video.js + VHS` 生态也成熟。

但对当前项目来说，这两条路都意味着“迁移播放器壳”本身，而当前最痛的问题并不是“库能力不够”，而是：

- 当前已经同时拥有 `Vidstack` 和 `hls.js`；
- 真正缺的是“播放器壳收口”和“分发层退回壳外”；
- 不是再换一套新播放器生态。

所以当前阶段的推荐路线不是“重选播放器大战”，而是：

**继续站在现有成熟轮子上，把它们摆回正确职责。**

## 3. 当前代码现实，不要再自欺欺人

### 3.1 当前依赖层面

前端依赖已经安装了这些相关库：

- `vidstack`
- `hls.js`
- `p2p-media-loader-hlsjs`
- `webtorrent`
- `photoswipe`

但“安装了什么”和“现在运行时真正依赖什么”不是一回事。

### 3.2 当前运行时层面

现有运行时事实是：

1. `HLS` 视频走自定义 `HTMLVideoElement + hls.js` overlay；
2. 非 `HLS` 视频走 `Vidstack <media-player>` overlay；
3. 移动端再走一条原生全屏旁路；
4. `媒体协作分发` 再单独负责 swarm / backfill / release。

这已经不是一个播放器壳，而是三条查看路径叠在同一个业务面上。

### 3.3 这会直接造成什么问题

1. 播放器事件语义不统一；
2. UI 行为与正式播放职责纠缠；
3. HLS 与普通视频的改动需要分别维护；
4. 移动端全屏逻辑容易继续长成第四套特殊路径；
5. `WebTorrent / P2P / HLS` 的职责边界模糊，导致增强层有机会拖死正式播放主链。

## 4. 核心结论

这份 spec 的核心结论只有一句：

**Web 当前阶段只允许保留一个视频播放器壳；`HLS / file / blob / fullscreen` 都必须从属于这一个壳；`WebTorrent / P2P / swarm` 必须退到播放器壳外。**

这句话展开后，就是下面这些决定：

1. “一个播放器”指的是一个统一的 `Player Shell`，不是要求只有一个底层库；
2. `Vidstack` 作为统一播放器壳；
3. `hls.js` 继续作为 `HLS provider / engine`；
4. `WebTorrent / SwarmRuntime / backfill / release` 继续满血存在，但不再承担播放器 UI 壳职责；
5. 移动端全屏是行为策略，不再算一套独立播放器实现；
6. 不再允许“自定义 HLS overlay”和“Vidstack overlay”长期双活。

## 5. 为什么推荐 `Vidstack 壳 + hls.js 引擎 + 外置分发层`

## 5.1 方案对比

### 方案 A：`Vidstack` 作为唯一播放器壳，`hls.js` 作为 HLS 引擎，分发层外置

优点：

1. 最符合官方“一个壳，多 provider”的思路；
2. 对当前项目改造成本最低；
3. 可以保留现有 `hls.js` 资产链和媒体会话信号；
4. 未来倍速、快捷键、错误提示、埋点、全屏等能力可以统一收口。

缺点：

1. 需要把现有自定义 HLS overlay 慢慢退场；
2. 需要补一轮 TDD，防止收口过程中功能掉落。

### 方案 B：全面改成 `Shaka` 单引擎 + 自定义壳

优点：

1. 流媒体能力强；
2. 后续若走更重的 `DASH / offline / DRM`，技术上更稳。

缺点：

1. 当前问题不是流媒体引擎能力不够；
2. 这会把“播放器壳重写”和“当前 bug 修复”绑在一起，风险过大；
3. 现阶段属于换轮子，不属于收口边界。

### 方案 C：全面迁到 `Video.js`

优点：

1. 生态老牌；
2. 插件丰富。

缺点：

1. 对当前项目没有明显边界收益；
2. 迁移成本依旧高；
3. 和当前已有 `Vidstack + hls.js` 资产不如方案 A 自然衔接。

## 5.2 推荐方案

当前阶段明确推荐 **方案 A**：

**`Vidstack` 作为唯一播放器壳，`hls.js` 作为 HLS 引擎，`WebTorrent / P2P / SwarmRuntime` 外置为分发与补齐层。**

这是当前最符合：

- 官方推荐；
- 现有项目资产；
- 低风险收口；
- 不减功能；
- 未来好维护。

## 6. 新的职责边界

### 6.1 `Player Shell`

只负责：

- 统一视频查看器 UI；
- 统一全屏、关闭、快捷键、控制条、错误展示；
- 统一对外事件表面；
- 把 provider 事件翻译为稳定播放器信号。

不负责：

- 决定谁加入 swarm；
- 决定什么时候 complete；
- 决定是否 seeding；
- 决定 `24 小时` 清理。

### 6.2 `Playback Engine / Provider`

负责：

- `HLS` 源加载；
- `blob/file` 视频加载；
- 媒体元素 attach；
- 原生或 JS 播放能力适配。

不负责：

- UI 壳层；
- 聊天应用状态；
- swarm/presence。

### 6.3 `SwarmRuntime / WebTorrent / P2P`

负责：

- backfill；
- seeding；
- presence；
- release；
- 分发与补齐。

不负责：

- 首播一定能不能起来；
- 最终 `<video>` 如何挂源；
- 控制条和查看器交互。

### 6.4 `MediaSessionOwner`

继续负责：

- 运行态真相；
- `playing / waiting / stalled / recovering / locally_complete`；
- 接收播放器事件和 runtime 事件，再统一裁决。

## 7. 目标架构

```text
RoomTimeline
  -> MediaViewerShell (Vidstack)
    -> Provider: HLS (hls.js)
    -> Provider: Video/blob/file

MediaSessionOwner
  -> consume player signals
  -> consume swarm signals

SwarmRuntime / WebTorrent / Backfill
  -> attach to asset/distribution layer
  -> never own player shell
```

这套结构的关键不是“只剩一个库”，而是：

1. 壳层只剩一个；
2. 事件表面只剩一个；
3. HLS 与普通视频只剩 provider 差异；
4. 分发与补齐不再混入播放器内核。

## 8. 迁移原则

### 8.1 不允许通过减功能换稳定

这次收口明确禁止下面这种伪修复：

1. 为了止血，直接删掉 `swarm / backfill / release`；
2. 为了图快，退回纯旧附件直链；
3. 为了少改，继续保留两套播放器长期双活；
4. 用“移动端特殊判断”再长一条旁路。

### 8.2 允许的演进方式

允许的正确演进方式是：

1. 先保住单一播放器壳；
2. 再把 `HLS` provider 正确接回壳里；
3. 再把 swarm 运行时作为旁路增强挂上去；
4. 旧自定义 HLS overlay 明确退场。

## 9. TDD 施工要求

这份 spec 后续的实现必须按 TDD 进行，并且至少补齐这些测试：

### 9.1 壳层统一性

1. `manifest` 视频进入统一播放器壳；
2. `blob/file` 视频也进入统一播放器壳；
3. 移动端只改变展示策略，不改变“单一播放器壳”事实。

### 9.2 正式播放链

1. `HLS` provider 会正确 attach 到最终媒体元素；
2. 同一 `manifest` 的重复同步不会反复 `loadSource` 把自己打断；
3. provider 切换不再制造第二套 overlay。

### 9.3 分发层不掉

1. 播放器壳收口后，`ASSET_BACKFILLING` 仍能触发；
2. `ASSET_COMPLETE` 仍能推进 `MediaCacheOwner`；
3. 关闭查看器仍会 release；
4. `noPeers / waiting / recovering` 仍由 `MediaSessionOwner` 裁决。

### 9.4 退场验证

1. 旧自定义 HLS overlay 退场后，不再有代码直接依赖它；
2. 不再存在“普通视频走 Vidstack、HLS 走另一套 overlay”的双活结构；
3. `p2p-media-loader-hlsjs` 若恢复接入，也只能作为增强层，不得再卡在首播必经路径。

## 10. 当前阶段完成定义

做到下面这些，才算这份 spec 真正落地：

1. 运行时只剩一个视频播放器壳；
2. `HLS / file / blob` 都通过同一个壳进入查看器；
3. `WebTorrent / SwarmRuntime / P2P` 完全退回播放器外；
4. 发送者和其他成员打开视频都能稳定播放；
5. 倍速、控制条、关闭、全屏、错误态这些行为以后只需要改一套播放器表面；
6. 旧自定义 HLS overlay 已经退场；
7. 没有通过删掉 backfill / release / seeding 来换取可播。

## 11. 非目标

本 spec 不处理：

1. 音频统一播放器壳；
2. 图片查看器收口；
3. `iOS / Android / Desktop / CLI` 的播放器实现；
4. 立即把 `Shaka` 或 `Video.js` 引入项目；
5. 新造一套私有播放器框架。

## 12. 一句话结论

当前项目的问题不是“缺播放器库”，而是“播放器壳和分发层边界没有收口”。  
Web 当前阶段最优解不是继续维持两套播放器实现，也不是换一套新轮子，而是：

**收口成一个 `Vidstack` 播放器壳，让 `hls.js` 做流媒体引擎，让 `WebTorrent / P2P / SwarmRuntime` 退回壳外继续满血分发。**

## 13. 参考资料

- [Vidstack 官方文档](https://vidstack.io/docs/player/)
- [Vidstack Core Concepts: Loading](https://vidstack.io/docs/player/core-concepts/loading/)
- [Vidstack HLS Provider](https://vidstack.io/docs/player/api/providers/hls/)
- [hls.js 官方仓库](https://github.com/video-dev/hls.js/)
- [P2P Media Loader 官方文档](https://novage.github.io/p2p-media-loader/docs/v2.2/)
- [P2P Media Loader 官方仓库](https://github.com/Novage/p2p-media-loader)
- [WebTorrent 官方文档](https://webtorrent.io/docs)
- [Shaka Player 官方仓库](https://github.com/shaka-project/shaka-player)
- [Video.js HTTP Streaming](https://github.com/videojs/http-streaming)
