# Web 单一视频播放器壳与外置分发层设计

日期：2026-04-14  
状态：Draft  
适用范围：`koko` 仓库 `Web 前端` 当前阶段的视频查看、播放、补齐、释放与分发层收口。  
路线修订：本版基于 `2026-03-10` 至 `2026-04-11` 的较新官方资料，以及“必须使用最新 `Video.js v10`”这一新约束，将目标播放器壳从前版 `Vidstack` 推荐修订为 `Video.js v10`。
关联文档：

- `docs/superpowers/specs/2026-04-13-群聊媒体实时收发全链路TDD疏通-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/plans/2026-04-14-群聊视频查看器黑屏转圈修复计划.md`
- `学习/整理笔记/Video.js-v10-beta-播放器候选笔记.md`

## 1. 为什么要单独写这份 spec

当前群聊视频链路已经暴露出一个非常具体的问题：

- 同一套业务里，视频查看器并不是“一个播放器壳”，而是多条实现路径并存；
- 黑屏、转圈、切源竞态、查看器主链不稳，已经证明这种并存不是抽象上的小瑕疵，而是运行时 bug 温床；
- 现在又新增了一个更硬的要求：未来播放器功能要持续增删改，而且必须能围绕一套播放器表面长期演进。

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

这份文档还要多承担一件事：

**把路线讲硬，防止后续实现时又回到“双壳并存”“增强层反客为主”“为图快减功能止血”的老路。**

## 2. 官方与较新最佳实践给出的方向

### 2.1 `hls.js` 的定位是薄播放引擎，不是播放器壳

`hls.js` 官方文档和仓库示例持续强调的核心动作很薄：

1. 创建一个 `Hls` 实例；
2. `attachMedia(video)`；
3. `loadSource(url)`；
4. 在浏览器支持原生 HLS 时，允许直接回退原生 `<video src>`。

这说明 `hls.js` 最适合承担“流媒体播放引擎”职责，而不是整个播放器 UI 壳。

### 2.2 `Video.js v10` 的较新官方状态，已经明确是“可组合播放器壳”

根据 Video.js 官方在 `2026-03-10` 发布的 v10 Beta 博客、`2026-04-11` 的 changelog，以及当前 roadmap：

1. `Video.js v10` 是一次从头重建的模块化播放器体系；
2. 官方明确把 `State / UI / Media` 拆成可组合部件，不再走旧时代的大一体播放器对象；
3. 官方 roadmap 写明：`2026-03` 是 Beta，`2026 年中` 才计划 GA；
4. 官方当前仍把它描述为“适合真实项目试用，但 API 仍可能变化”的阶段；
5. 官方同时强调：v10 今天就能配合现有社区流媒体引擎工作，而不是要求你立刻改投某个私有新引擎。

这件事非常关键。
它说明 `Video.js v10` 现在最有价值的部分，不是“它已经彻底稳定”，而是：

- 它已经提供了我们需要的“单一播放器壳 + 可组合 UI + 外挂播放引擎”架构方向；
- 同时它也提醒我们必须做风险隔离，不能把 Beta API 直接散落到聊天壳和业务内核里。

### 2.3 对 `koko` 来说，应当选择 `@videojs/html` 路线，而不是 `@videojs/react`

Video.js v10 官方同时提供 `@videojs/html` 和 `@videojs/react` 两条入口。
但当前 `koko` 的 Web 前端不是 React 主栈，所以这里必须把边界写死：

1. `koko` 当前阶段只考虑 `@videojs/html` 这条壳层路线；
2. 不允许为了接入 `Video.js v10` 而把 React 再引进当前播放器主链；
3. 后续若要接 React，也必须是另一个独立架构决策，不能偷渡进这次播放器壳收口。

### 2.4 `Video.js v10` 的 SPF 很新，但当前不应该抢走正式 HLS 主链

Video.js 官方在 v10 Beta 里同时推出了 `SPF (Streaming Processor Framework)`。
从官方博客看，它的方向很先进，目标是把简单 ABR 场景的体积压得很小。

但当前阶段不能因为“它很新”就直接把它塞进 `koko` 正式主链，原因很直接：

1. `koko` 当前问题首先是“播放器壳没有收口”，不是“现有 HLS 引擎完全不够用”；
2. `hls.js` 已经在当前项目里存在，现有 `P2P Media Loader` 也天然更贴近它；
3. `Video.js v10` 自身还是 Beta，再叠一个新流媒体框架，会把风险同时放大到“壳迁移 + 引擎迁移”两个维度；
4. 这违反“先收口边界，再追求更激进技术收益”的原则。

所以这份 spec 明确规定：

**当前阶段选择 `Video.js v10` 做播放器壳，但 `HLS` 正式主链仍继续由 `hls.js` 承担。**

### 2.5 `P2P Media Loader` 是增强层，不是 UI 播放器

`p2p-media-loader` 官方文档的重点是：

- 它是 P2P streaming engine；
- 可挂接 `hls.js`、`Shaka Player` 等播放引擎；
- 它自己不是播放器壳。

所以它在 `koko` 里应该挂接到 `HLS engine` 这一层，而不是变成新的播放器 UI 入口，更不应该成为“首播能不能起来”的唯一关键路径。

### 2.6 `WebTorrent` 是分发平面，不是完整 HLS 播放器

WebTorrent 官方文档重点是：

- `file.streamTo(video)`；
- `streamURL`；
- `createServer`；
- tracker / peer / service worker。

这说明它更像“文件与字节流分发层”，不是 HLS 主播放壳。
所以它在 `koko` 里的正确位置仍然是：

- 资源分发；
- backfill；
- seeding；
- release；
- presence。

而不是新的播放器实现。

### 2.7 `Vidstack` 和 `Shaka` 仍然是优秀轮子，但这次不再作为最终路线

这里必须把“为什么前版是 `Vidstack`，而这版改成 `Video.js v10`”说清楚：

1. 前版推荐 `Vidstack` 并不错误，它仍然是成熟的单壳路线；
2. 但当前约束已经变成“必须使用最新 `Video.js v10`”；
3. 一旦这个约束成立，路线就不能继续写成 `Vidstack`，否则 spec 本身就会先漂；
4. `Shaka` 依旧强，但它更像重流媒体内核，不是当前最关键的壳层收口方案。

所以本版不是否定前版的判断，而是承认约束已经变化，并据此修正路线。

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
5. `WebTorrent / P2P / HLS` 的职责边界模糊，导致增强层有机会拖死正式播放主链；
6. 如果现在直接引入 `Video.js v10`，但不明确旧路退场点，就会再长出第三套桌面播放器壳。

## 4. 核心结论

这份 spec 的核心结论只有一句：

**Web 当前阶段只允许保留一个视频播放器壳；`HLS / file / blob / fullscreen` 都必须从属于这一个壳；`WebTorrent / P2P / swarm` 必须退到播放器壳外。**

这句话展开后，就是下面这些决定：

1. “一个播放器”指的是一个统一的 `Player Shell`，不是要求只有一个底层库；
2. `Video.js v10 (@videojs/html)` 作为统一播放器壳；
3. `hls.js` 继续作为 `HLS provider / engine`；
4. `WebTorrent / SwarmRuntime / backfill / release` 继续满血存在，但不再承担播放器 UI 壳职责；
5. 移动端全屏是行为策略，不再算一套独立播放器实现；
6. 不再允许“自定义 HLS overlay”和“Vidstack overlay”长期双活；
7. 不允许把 `Video.js v10` 的 Beta API 直接扩散到聊天壳、业务 owner、分发 runtime 各处，必须有薄适配层隔离；
8. 当前阶段不以 `SPF` 替换 `hls.js` 正式主链。

## 5. 为什么推荐 `Video.js v10 壳 + hls.js 引擎 + 外置分发层`

## 5.1 方案对比

### 方案 A：`Video.js v10 (@videojs/html)` 作为唯一播放器壳，`hls.js` 作为 HLS 引擎，分发层外置

优点：

1. 满足“必须使用最新 `Video.js v10`”这个明确约束；
2. 贴近官方 v10 的模块化方向，方便未来围绕一套壳继续改造；
3. 可以保留现有 `hls.js` 资产链和媒体会话信号；
4. 未来倍速、快捷键、字幕、错误提示、埋点、全屏等能力可以统一收口；
5. 壳迁移和分发层保留可以拆开做，不必用“减功能换稳定”。

缺点：

1. `Video.js v10` 当前仍是 Beta，API 变化风险真实存在；
2. 需要增加一层薄适配，不能让项目直接硬耦合到 v10 的内部细节；
3. 需要补一轮 TDD，防止收口过程中功能掉落。

### 方案 B：继续以 `Vidstack` 作为最终壳

优点：

1. 当前迁移成本更低；
2. 风险更小。

缺点：

1. 已经不满足“必须使用最新 `Video.js v10`”这个新约束；
2. spec 会和执行目标直接冲突，后续实现必然漂移。

### 方案 C：`Video.js v10` 壳 + `SPF` 直接接管 HLS 主链

优点：

1. 技术上更激进，也更贴近 v10 的新引擎方向；
2. 理论上可获得更小包体。

缺点：

1. 当前风险过高，是“壳迁移 + 引擎迁移”双重同时变更；
2. `koko` 当前首先要保的是满血功能，不是先赌更激进的新流媒体主链；
3. 这会让 `P2P Media Loader / WebTorrent / backfill` 的恢复成本明显上升。

### 方案 D：全面改成 `Shaka` 单引擎 + 自定义壳

优点：

1. 流媒体能力强；
2. 若后续走更重的 `DASH / offline / DRM`，技术上更稳。

缺点：

1. 当前问题不是流媒体引擎能力不够；
2. 这会把“播放器壳重写”和“当前收口双壳”绑在一起，风险过大；
3. 它也不满足“最新 `Video.js v10`”这个明确方向。

## 5.2 推荐方案

当前阶段明确推荐 **方案 A**：

**`Video.js v10 (@videojs/html)` 作为唯一播放器壳，`hls.js` 作为 HLS 引擎，`WebTorrent / P2P / SwarmRuntime` 外置为分发与补齐层。**

但这份推荐同时附带三个风险约束：

1. `Video.js v10` 当前仍是 Beta，所以必须有薄适配层；
2. `hls.js` 先继续留在正式主链，先别顺手再换引擎；
3. 所有旧路径都必须定义退场点，不能让新壳和旧壳长期并存。

## 6. 新的职责边界

### 6.1 `Player Shell Adapter`

这里不直接让聊天壳到处操作 `Video.js v10` 原始 API，而是收口成一个薄的 `Player Shell Adapter`。

它只负责：

- 统一视频查看器 UI；
- 统一全屏、关闭、快捷键、控制条、错误展示；
- 统一对外事件表面；
- 把 `Video.js v10` 与 provider 事件翻译为稳定播放器信号；
- 隔离 Beta API 变化，避免业务层四处绑死。

它不负责：

- 决定谁加入 swarm；
- 决定什么时候 complete；
- 决定是否 seeding；
- 决定 `24 小时` 清理；
- 决定聊天业务真相。

### 6.2 `Playback Engine / Provider`

负责：

- `HLS` 源加载；
- `blob/file` 视频加载；
- 媒体元素 attach；
- 原生或 JS 播放能力适配；
- 必要时挂接 `P2P Media Loader` 作为 HLS 增强层。

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
- 控制条和查看器交互；
- 直接生成第二套播放器入口。

### 6.4 `MediaSessionOwner`

继续负责：

- 运行态真相；
- `playing / waiting / stalled / recovering / locally_complete`；
- 接收播放器事件和 runtime 事件，再统一裁决。

## 7. 目标架构

```text
RoomTimeline
  -> MediaViewerShellAdapter
    -> Video.js v10 (@videojs/html)
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
4. 分发与补齐不再混入播放器内核；
5. `Video.js v10` 的具体 Beta API 被局部隔离，不再到处泄漏。

## 8. 迁移原则

### 8.1 不允许通过减功能换稳定

这次收口明确禁止下面这种伪修复：

1. 为了止血，直接删掉 `swarm / backfill / release`；
2. 为了图快，退回纯旧附件直链；
3. 为了少改，继续保留两套播放器长期双活；
4. 用“移动端特殊判断”再长一条旁路；
5. 为了迁移 `Video.js v10`，顺手把 `hls.js` 主链也一并换掉；
6. 为了接 `Video.js v10`，把 React 一起引进当前播放器主链。

### 8.2 不允许通过“最新技术”制造第二次漂移

这次还要额外堵住一个新风险：
“因为 `Video.js v10` 很新，所以后续执行时每个人都按自己理解往里塞东西。”

为防止这个问题，本 spec 明确写死：

1. 当前壳只走 `@videojs/html`；
2. 当前 HLS 主链只走 `hls.js`；
3. 当前不把 `SPF` 作为正式生产主链；
4. `Video.js v10` 只能通过薄适配层进入项目；
5. `WebTorrent / P2P / SwarmRuntime` 永远不拥有播放器壳。

### 8.3 允许的正确演进方式

允许的正确演进方式是：

1. 先保住单一播放器壳；
2. 再把 `blob/file` 路径接进新壳；
3. 再把 `HLS` provider 正确接回壳里；
4. 再把 swarm 运行时作为旁路增强挂上去；
5. 再把移动端原生全屏降级成“同一壳上的展示/平台策略”；
6. 最后让旧 `Vidstack overlay` 和旧自定义 `HLS overlay` 明确退场。

## 9. TDD 施工要求

这份 spec 后续的实现必须按 TDD 进行，并且至少补齐这些测试：

### 9.1 壳层统一性

1. `manifest` 视频进入统一播放器壳；
2. `blob/file` 视频也进入统一播放器壳；
3. 移动端只改变展示策略，不改变“单一播放器壳”事实；
4. 不再存在“一个视频走 `Video.js v10`，另一个视频走旧壳”的长期双活。

### 9.2 正式播放链

1. `HLS` provider 会正确 attach 到最终媒体元素；
2. 同一 `manifest` 的重复同步不会反复 `loadSource` 把自己打断；
3. provider 切换不再制造第二套 overlay；
4. `blob/file` 路径与 `manifest` 路径共用同一套控制表面；
5. 倍速、关闭、全屏、错误态、控制条、快捷键以后只需要改一套播放器表面。

### 9.3 分发层不掉

1. 播放器壳收口后，`ASSET_BACKFILLING` 仍能触发；
2. `ASSET_COMPLETE` 仍能推进 `MediaCacheOwner`；
3. 关闭查看器仍会 release；
4. `noPeers / waiting / recovering` 仍由 `MediaSessionOwner` 裁决；
5. sender 和其他成员打开同一个视频都能稳定播放，不允许通过删除 seeding / release 伪装成功。

### 9.4 退场验证

1. 旧自定义 HLS overlay 退场后，不再有代码直接依赖它；
2. 旧 `Vidstack overlay` 退场后，不再有代码直接依赖它；
3. 不再存在“普通视频走一套、HLS 走另一套 overlay”的双活结构；
4. `p2p-media-loader-hlsjs` 若恢复接入，也只能作为增强层，不得再卡在首播必经路径；
5. 项目里不因为这次迁移额外引入 React 播放器主链。

## 10. 当前阶段完成定义

做到下面这些，才算这份 spec 真正落地：

1. 运行时只剩一个视频播放器壳；
2. `HLS / file / blob` 都通过同一个壳进入查看器；
3. `WebTorrent / SwarmRuntime / P2P` 完全退回播放器外；
4. 发送者和其他成员打开视频都能稳定播放；
5. 倍速、控制条、关闭、全屏、错误态这些行为以后只需要改一套播放器表面；
6. 旧自定义 HLS overlay 已经退场；
7. 旧 `Vidstack overlay` 已经退场；
8. 没有通过删掉 backfill / release / seeding 来换取可播；
9. `Video.js v10` 的具体实现细节没有扩散成新的系统级耦合点。

## 11. 非目标

本 spec 不处理：

1. 音频统一播放器壳；
2. 图片查看器收口；
3. `iOS / Android / Desktop / CLI` 的播放器实现；
4. 当前阶段立即把 `SPF` 替换为正式 HLS 主链；
5. 为了 `Video.js v10` 接入而把 React 一起引入当前播放器主链；
6. 新造一套私有播放器框架。

## 12. 一句话结论

当前项目的问题不是“缺播放器库”，而是“播放器壳和分发层边界没有收口”。  
在“必须使用最新 `Video.js v10`”这个新约束下，Web 当前阶段最优解不是继续维持两套播放器实现，也不是趁机再换掉 HLS 主链，而是：

**收口成一个 `Video.js v10 (@videojs/html)` 播放器壳，让 `hls.js` 做流媒体引擎，让 `WebTorrent / P2P / SwarmRuntime` 退回壳外继续满血分发。**

## 13. 参考资料

- [Video.js v10 Beta: Hello, World (again)](https://videojs.org/blog/videojs-v10-beta-hello-world-again)
- [Video.js v10 Roadmap](https://videojs.org/docs/framework/react/concepts/v10-roadmap)
- [videojs/v10 CHANGELOG.md](https://github.com/videojs/v10/blob/main/CHANGELOG.md)
- [hls.js 官方仓库](https://github.com/video-dev/hls.js/)
- [P2P Media Loader 官方文档](https://novage.github.io/p2p-media-loader/docs/v2.2/)
- [P2P Media Loader 官方仓库](https://github.com/Novage/p2p-media-loader)
- [WebTorrent 官方文档](https://webtorrent.io/docs)
- [Vidstack 官方文档](https://vidstack.io/docs/player/)
- [Shaka Player 官方仓库](https://github.com/shaka-project/shaka-player)
