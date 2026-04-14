# Video.js v10 beta 播放器候选笔记

日期：2026-04-14
适用范围：`koko` Web 端视频播放器壳、HLS/ABR 播放引擎、媒体分发层边界的后续候选评估。
资料状态：Video.js v10 仍是 beta，官方不建议生产项目做大迁移。

## 1. 先说结论

1. Video.js v10 不是 v8 的小修小补，而是一次从底层重写的播放器平台：它把 Video.js、Plyr、Vidstack、Media Chrome 几条开源播放器经验合并进一个新架构。
2. 它最值得看的地方不是“老牌 Video.js 又回来了”，而是：
   - 默认包体大幅下降；
   - React 和 HTML Web Components 都成为正式入口；
   - State / UI / Media 被拆开，通过 API contract 协作；
   - `createPlayer({ features })` 让播放器按功能组合，而不是默认带一整坨控制器；
   - SPF 试图把简单 ABR/HLS 场景的流媒体引擎也做成可组合小内核。
3. 对 `koko` 当前阶段，Video.js v10 只能进入“中期候选池”，不能立刻替换现有路线。
4. 原因很硬：
   - 当前项目问题是播放器壳和分发层双活混层，不是缺一个新播放器库；
   - 现有 spec 已经决定先收口 `Vidstack 壳 + hls.js 引擎 + WebTorrent/SwarmRuntime 外置分发层`；
   - v10 官方自己说 API 还不稳定，迁移指南会在要求用户迁移前再给；
   - 当前前端是纯 TypeScript，不是 React 项目，不能为了播放器顺手引入 React 运行时；
   - 如果现在引入 Video.js v10，很容易变成第三套播放器路径，直接违反“一个播放器壳”和“旧路退场”的边界。

一句话：

**Video.js v10 的方向和 `koko` 的长期架构目标很合拍，但当前只能观察和隔离 POC，不能作为正在进行的播放器收口主路线。**

## 2. 官方资料里最关键的事实

### 2.1 v10 是合并多条播放器经验后的重写

官方 beta 文章明确把 v10 定位成 ground-up rewrite，不只是 Video.js 自己的重写，也吸收了 Plyr、Vidstack、Media Chrome 这些项目的经验。

这点对 `koko` 有价值：它说明 v10 不是旧式 Video.js 插件平台简单升级，而是正在朝“一个可组合播放器平台”演进。

但这也意味着迁移风险更高：它是新架构，API 仍在动。

### 2.2 包体和性能方向很激进

官方文章给出的对比口径里，v10 默认播放器相对 v8 默认包体明显缩小：

- v10 默认播放器比 v8 默认播放器小约 88%。
- 去掉 ABR 后，v10 HTML 视频播放器约 `97.4 kB minified / 25.1 kB gzip`。
- v10 React 视频播放器约 `62.0 kB minified / 18.0 kB gzip`。
- v10 React background video 约 `10.7 kB minified / 3.5 kB gzip`。
- 简单 React 播放按钮示例可以压到 `< 5 kB gzip`。

更关键的是 ABR/HLS 方向：

- v10 引入 SPF，Streaming Processor Framework。
- SPF 的目标是把流媒体引擎拆成按需组合的 functional components。
- 官方给的简单 HLS/ABR 场景里，`v10 + SPF React` 约 `107.3 kB minified / 31.6 kB gzip`。
- 单看 SPF-composed engine，官方表格给到约 `38.5 kB minified / 12.1 kB gzip`。

这个方向对 `koko` 有意义，因为群聊热点视频未来如果走 HLS/DASH 分片，播放器壳和流媒体引擎包体会成为真实成本。

### 2.3 SPF 不是马上替代 hls.js / Shaka 的万能引擎

官方说得很清楚：SPF 当前目标不是取代 HLS.js、Shaka 这类完整流媒体引擎，而是让简单 ABR 场景用更小的引擎。

所以 `koko` 不能把 SPF 理解成“以后不用 hls.js / Shaka 了”。更稳的判断是：

- 简单点播 HLS：未来可以关注 SPF。
- 复杂 HLS/DASH、live、DRM、ads、字幕、离线：仍然要看 hls.js、Shaka 或 Video.js 自己后续兼容层。
- 当前项目已有 hls.js 资产，不应该因为 v10 beta 就提前拆掉。

### 2.4 v10 的架构更像“播放器内核 + 组件/预设”，不是旧式黑盒控件

官方文章里最值得记住的架构点：

1. State、UI、Media 被拆成独立组件。
2. 组件通过 API contracts 协作，而不是塞进一个 monolithic player object。
3. `createPlayer` 接收 features 数组，功能像状态 slice 一样被组合进播放器能力。
4. UI primitives 是 unstyled 的，皮肤可以 eject 成项目可改的真实组件。
5. 不导入的组件不会进入 bundle。

这和 `koko` 的架构原则相容：播放器应该是 `MediaOwner` 下面的一种可替换通用能力，不应该把分发、缓存、业务事件、权限或时间线真相吞进去。

### 2.5 v10 beta 自带三类 preset

beta 当前主推三类预设：

- 普通 video；
- 普通 audio；
- background video。

这说明 v10 正在把“用例组合”变成正式入口，不再要求所有场景从一个全量视频播放器开始删东西。

对 `koko` 来说，这个方向可以借鉴，但不能照搬：聊天视频查看器不是普通站点 video preset，它还带着 `MediaSessionOwner`、`SwarmRuntime`、全屏会话、返回键清理、backfill/release 等项目内语义。

## 3. React 安装文档给出的落地方式

React 文档当前主入口是：

```text
pnpm add @videojs/react
```

最小结构是：

1. 引入对应皮肤 CSS，例如 `@videojs/react/video/skin.css`。
2. 从 `@videojs/react` 引入 `createPlayer`。
3. 从 `@videojs/react/video` 引入 `videoFeatures`、`VideoSkin`、`Video`。
4. `const Player = createPlayer({ features: videoFeatures })`。
5. 渲染时用 `Player.Provider -> VideoSkin -> Video`。

这个结构说明 v10 的 React 入口很像一个可组合播放器框架，而不是传统 `videojs(videoElement, options)` 的命令式初始化模型。

但这也强化了 `koko` 的约束：

- 当前前端不是 React 应用，不能为播放器额外引入 React runtime。
- 如果后续评估 v10，优先看 HTML Web Components 表面，而不是 React 表面。
- React 文档仍然值得读，因为它暴露了 v10 的核心抽象：features、skin、media component、provider。

### CSP 注意点

React 安装文档还给了 CSP 边界，后续如果做 POC 必须提前检查：

- `media-src` 要允许媒体 URL。
- `img-src` 要允许 poster / thumbnail。
- `connect-src` 要允许 HLS manifest、playlist、caption、segment 请求。
- HLS 变体使用 MSE 时需要 `media-src blob:`。
- hls.js 变体需要 `worker-src blob:`。
- 当前部分 UI / HTML player styling 还需要 `style-src 'unsafe-inline'`。

这条很重要：如果以后把它接进 `koko`，CSP 不是“最后线上再补”的细节，而是播放器候选评估的一部分。

## 4. changelog 头部能看出什么

我这次按 2026-04-14 抓取的 changelog 头部，最新是：

```text
@videojs/core@10.0.0-beta.17 - 2026-04-11
```

近期变化说明 v10 仍在快速补基础播放器能力：

- `beta.17`：新增 HTML `<media-gesture>`、React gesture hooks 和 `MediaGesture` 组件，把 gesture bindings 接进默认 skins/presets；同时修了 define modules 的 safeDefine 显式导入。
- `beta.16`：新增 hotkey system、ARIA 支持、React/HTML hotkeys、sub-1x playback rates、`toggleControls`、Mux audio、gesture system、SPF architecture reactors；同时修 Safari track、React media component conventions、time slider seek 等细节，并把 React peer dependency 收窄到 v18+。
- `beta.14`：新增 native HLS error handling、native hls video CDN、volume slider scroll support、ui bundles for eject、home page storyboard；修复 HLS media 下 thumbnails 等问题。
- `beta.13`：修复 React media proxy。
- `beta.12`：新增 Mux video component、HLS media preload、native HLS media refactor、error dialog、HLS.js media error handling。

这几条合起来看，v10 正在快速补：

- 手势；
- 快捷键；
- HLS/native HLS/HLS.js 错误处理；
- React/HTML 组件一致性；
- skin eject；
- SPF 结构。

这对候选评估是好信号，但对生产迁移也是风险信号：基础面还在持续变，当前不适合替换项目主播放器链。

## 5. 放回 `koko` 当前播放器决策

当前 `docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md` 的结论仍然成立：

**当前阶段先收口成 `Vidstack` 播放器壳，让 `hls.js` 做流媒体引擎，让 `WebTorrent / P2P / SwarmRuntime` 退回壳外。**

Video.js v10 这次资料不会推翻它，只会补充一条后续观察路线。

原因：

1. 当前 bug 根因是播放器壳双活、分发层和播放层混层，不是 Vidstack 或 hls.js 本身能力不足。
2. 引入 v10 会新增一个第三播放器生态，短期只会增加双真相和双路径风险。
3. v10 官方明确 beta API 不稳定，迁移指南未出。
4. `koko` 的媒体分发真相属于 `SwarmRuntime / MediaSessionOwner / MediaCacheOwner`，播放器库只能消费最终播放源和输出播放信号。
5. 当前最该删除的是旧自定义 HLS overlay，不是把 `Vidstack + hls.js` 整体换掉。

## 6. 后续如果评估 Video.js v10，必须这样做

如果未来要重新评估 v10，建议只允许隔离 POC，不直接接主链。

POC 必须回答：

1. 能否只用 HTML Web Components 表面接入，不引入 React runtime。
2. 能否让播放器只消费 `MediaSessionOwner` 已裁决出的 `src / manifest / poster / textTracks`，不让 Video.js 自己拥有媒体定位和分发真相。
3. 能否把 HLS、file、blob 都收进一个统一播放器表面。
4. 能否把 `WebTorrent / SwarmRuntime / backfill / release` 保持在播放器外。
5. 能否把播放事件转成项目自己的稳定 player signals，而不是把 Video.js 内部事件直接泄漏到聊天壳。
6. 包体是否真的优于当前 `Vidstack + hls.js` 组合，且不是只在简单 demo 里好看。
7. CSP、Service Worker、blob URL、worker、Range/HLS segment 请求是否和现有媒体缓存策略兼容。
8. 移动端全屏、返回键、方向锁是否不退化。
9. 旧播放器路径是否有明确退场点，不能多一套长期双活。

如果这些问题不能回答，就不进入编码。

## 7. 当前建议

短期：

- 不引入 Video.js v10。
- 继续按现有 spec 收口 `Vidstack 壳 + hls.js 引擎 + 外置分发层`。
- 把 Video.js v10 作为候选资料记录下来，等 GA 和迁移指南。

中期：

- 等 v10 GA 或至少 API 稳定后，做一个不接主链的 HTML Web Components POC。
- 对比 `Vidstack + hls.js` 与 `Video.js v10 + SPF / hls.js` 在真实群聊视频场景里的包体、事件表面、HLS 能力、移动端全屏和 CSP 成本。

长期：

- 如果 `koko` 未来把热点视频正式升级成 HLS/DASH 分片流媒体，Video.js v10 的 SPF 和可组合播放器壳值得重新进入候选排序。
- 但只要它不能保持“一个播放器壳、分发层外置、业务真相不入播放器”，就不能引进。

## 8. 参考资料

- [Video.js v10 Beta: Hello, World (again)](https://videojs.org/blog/videojs-v10-beta-hello-world-again)
- [Video.js React Installation](https://videojs.org/docs/framework/react/how-to/installation)
- [videojs/v10 CHANGELOG.md](https://github.com/videojs/v10/blob/main/CHANGELOG.md)
- [Video.js v10 GitHub 仓库](https://github.com/videojs/v10)

## 9. 本次取证备注

- Context7 可解析出 `/videojs/v10` 和 `/videojs/video.js`，但本次查询没有返回文档片段，所以以 Video.js 官方页面和 GitHub changelog 为准。
- 抓取时间是 2026-04-14；v10 beta 变化很快，后续如果要进入 POC，必须重新读 changelog。
