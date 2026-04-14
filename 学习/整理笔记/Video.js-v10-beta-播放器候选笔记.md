# Video.js v10 beta 播放器候选笔记

日期：2026-04-14
适用范围：`koko` Web 端视频播放器壳、HLS/ABR 播放引擎、媒体分发层边界的后续候选评估。
资料状态：Video.js v10 仍是 beta，官方不建议一般生产项目做大迁移；但在 `koko` 已新增“必须使用最新 `Video.js v10`”这个硬约束后，这份笔记不再只是候选观察，而是用来校准正式路线的风险与边界。

## 1. 先说结论

1. Video.js v10 不是 v8 的小修小补，而是一次从底层重写的播放器平台：它把 Video.js、Plyr、Vidstack、Media Chrome 几条开源播放器经验合并进一个新架构。
2. 它最值得看的地方不是“老牌 Video.js 又回来了”，而是：
   - 默认包体大幅下降；
   - React 和 HTML Web Components 都成为正式入口；
   - State / UI / Media 被拆开，通过 API contract 协作；
   - `createPlayer({ features })` 让播放器按功能组合，而不是默认带一整坨控制器；
   - SPF 试图把简单 ABR/HLS 场景的流媒体引擎也做成可组合小内核。
3. 如果没有额外约束，Video.js v10 现在仍更适合试用、隔离验证和新项目，而不是拿来做一次无保护的大迁移。
4. 但在 `koko` 当前约束已经变成“必须使用最新 `Video.js v10`”后，最稳的路线不是再拖着双壳不动，而是：
   - 用 `Video.js v10 (@videojs/html)` 收口成唯一播放器壳；
   - 继续保留 `hls.js` 作为正式 HLS 引擎；
   - 继续把 `WebTorrent / P2P / SwarmRuntime` 留在播放器壳外；
   - 不把 React runtime 顺手引进当前前端主链；
   - 不同时做“播放器壳迁移 + HLS 主引擎迁移”。

一句话：

**Video.js v10 的方向和 `koko` 的长期架构目标很合拍；在“必须使用最新 v10”这个新约束下，它可以进入正式主路线，但只能承担单一播放器壳，不能顺手吞掉 `hls.js` 主链和壳外分发层。**

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

### 2.4 官方明确提供了非 React 的 HTML 主入口

这次最容易误判的一点是：很多人看到 v10 文档首页会先看到 React 风格示例，然后顺手把它理解成“v10 的正式现代入口就是 React”。

这个理解不对。

官方安装文档明确提供了 `@videojs/html` 路线，核心形态是：

- `@videojs/html/video/player`
- `@videojs/html/media/hls-video`
- `@videojs/html/video/skin`
- `@videojs/html/video/skin.css`

HTML 结构则是：

```html
<video-player>
  <video-skin>
    <hls-video src="stream.m3u8"></hls-video>
  </video-skin>
</video-player>
```

这件事对 `koko` 很重要，因为它说明：

1. `Video.js v10` 不要求我们引入 React 才能得到现代播放器壳；
2. 当前项目正确表面应当是 `@videojs/html`，不是 `@videojs/react`；
3. React 文档仍然值得读，但主要是帮助理解 `createPlayer / features / skin / media` 这套新心智，而不是让我们照着接 React runtime。

### 2.5 `media-container` / `video-skin` 的边界很值得直接学

官方 HTML 文档把 `video-player`、`media-container`、`video-skin` 的边界讲得很清楚：

1. provider 负责状态与 media attach；
2. container 负责可视边界、交互面、fullscreen；
3. packaged skin 内部自带 container；
4. fullscreen 是 container 进入全屏，不是底层 `<video>` 自己进全屏；
5. 自定义 media 元素例如 `<hls-video>` 通过上下文注册到 player，而不是在业务层自己乱做第二层 attach。

这条对 `koko` 直接有施工价值，因为当前项目历史问题里就有：

- overlay 和播放器壳边界不清；
- 移动端全屏和桌面壳分成两条路径；
- HLS attach 和普通 file/blob 路径没有收口到同一播放器表面。

官方这个设计正好可以拿来压这些旧复杂度。

### 2.6 v10 的架构更像“播放器内核 + 组件/预设”，不是旧式黑盒控件

官方文章里最值得记住的架构点：

1. State、UI、Media 被拆成独立组件。
2. 组件通过 API contracts 协作，而不是塞进一个 monolithic player object。
3. `createPlayer` 接收 features 数组，功能像状态 slice 一样被组合进播放器能力。
4. UI primitives 是 unstyled 的，皮肤可以 eject 成项目可改的真实组件。
5. 不导入的组件不会进入 bundle。

这和 `koko` 的架构原则相容：播放器应该是 `MediaOwner` 下面的一种可替换通用能力，不应该把分发、缓存、业务事件、权限或时间线真相吞进去。

### 2.7 v10 beta 自带三类 preset

beta 当前主推三类预设：

- 普通 video；
- 普通 audio；
- background video。

这说明 v10 正在把“用例组合”变成正式入口，不再要求所有场景从一个全量视频播放器开始删东西。

对 `koko` 来说，这个方向可以借鉴，但不能照搬：聊天视频查看器不是普通站点 video preset，它还带着 `MediaSessionOwner`、`SwarmRuntime`、全屏会话、返回键清理、backfill/release 等项目内语义。

### 2.8 安装文档里的 CSP 不是部署细节，而是选型边界

官方安装文档当前还把 CSP 要求写得很明确：

- `connect-src` 要允许 manifest、playlist、caption、segment 请求；
- HLS/MSE 变体要允许 `media-src blob:`；
- `hls.js` 变体要允许 `worker-src blob:`；
- poster / thumbnail 要进 `img-src`；
- 当前部分 UI / HTML player styling 还需要 `style-src 'unsafe-inline'`。

这意味着如果后续执行期只盯播放器 API，不把 CSP 一起写进 spec 和 plan，最后大概率会在线上或准生产环境里踩坑。

## 3. 当前真正该采用的不是 React 集成，而是 HTML 集成

当前 `koko` 的主线不是 React，所以这部分必须先摆正：

1. 正式施工只采用 `@videojs/html`；
2. React 文档只用于理解 v10 的架构抽象；
3. 不允许为了播放器壳迁移，把 React runtime 偷渡进当前主链。

最小 HTML 集成的关键信号是：

- 用 `createPlayer({ features })` 或直接导入官方定义模块；
- 用 `<video-player>` 承载 player provider；
- 用 `<video-skin>` 或 `<media-container>` 承载 UI 与 fullscreen 边界；
- 用 `<hls-video>`、`<video>`、`<audio>` 之类的 media element 表达真实媒体源。

这和旧 `videojs(videoElement, options)` 心智已经不一样了。
后续不论写 spec 还是写适配层，都不能再按旧版“大播放器实例 + 到处塞 options/plugin”的脑回路下刀。

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

这对候选评估是好信号，但对生产迁移也是风险信号：基础面还在持续变。

所以对 `koko` 的直接工程结论不是“别用”，而是：

1. 用可以，但只把它收口成单一播放器壳；
2. 不能把 `beta.16 / beta.17` 这些新增手势、热键 API 直接写成项目核心强依赖；
3. 计划和测试里要把“若 v10 beta 行为变动，适配层是否还能稳住”当作正式风险。

## 5. 放回 `koko` 当前播放器决策

当前 [2026-04-14-Web单一视频播放器壳与外置分发层-design.md](/E:/koko/docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md) 的较新结论已经改成：

**当前阶段收口成 `Video.js v10 (@videojs/html)` 播放器壳，让 `hls.js` 做流媒体引擎，让 `WebTorrent / P2P / SwarmRuntime` 退回壳外。**

这轮资料不是推翻这条路线，而是把它补硬。

原因：

1. 当前 bug 根因是播放器壳双活、分发层和播放层混层，不是 Vidstack 或 hls.js 本身能力不足。
2. 既然约束已经改成“必须使用最新 `Video.js v10`”，那就必须同步把旧 `Vidstack` 最终路线退掉，否则 spec 自己先漂。
3. v10 官方明确 beta API 不稳定，迁移指南未出，所以必须隔一层薄适配。
4. `koko` 的媒体分发真相属于 `SwarmRuntime / MediaSessionOwner / MediaCacheOwner`，播放器库只能消费最终播放源和输出播放信号。
5. 当前最该删除的是旧自定义 HLS overlay 和旧 Vidstack overlay 的双活结构，不是顺手把 `hls.js` 主链也拆了。

## 6. 后续执行 Video.js v10 路线，必须这样做

后续正式施工前，至少必须回答：

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

- 继续补硬 spec 和 plan，先把最新官方事实写死。
- 正式路线采用 `Video.js v10 (@videojs/html)` 单壳，但不同时更换 HLS 正式主链。
- characterization tests 必须先补，先钉死满血功能，再迁壳。

中期：

- 用薄适配层把 `Video.js v10` 控在播放器壳边界内。
- 先让 `blob/file`、再让 `manifest` 收口到同一壳。
- 再把壳外 swarm/backfill/release 信号平稳接回去。

长期：

- 如果 `koko` 未来把热点视频正式升级成 HLS/DASH 分片流媒体，Video.js v10 的 SPF 和可组合播放器壳值得重新进入候选排序。
- 但只要它不能保持“一个播放器壳、分发层外置、业务真相不入播放器”，就不能进一步扩权。

## 8. 参考资料

- [Video.js v10 Beta: Hello, World (again)](https://videojs.org/blog/videojs-v10-beta-hello-world-again)
- [Video.js v10 Overview](https://videojs.org/docs/framework/react/concepts/overview)
- [Video.js React Installation](https://videojs.org/docs/framework/react/how-to/installation)
- [Video.js HTML Player Container](https://videojs.org/docs/framework/html/reference/player-container)
- [videojs/v10 CHANGELOG.md](https://github.com/videojs/v10/blob/main/CHANGELOG.md)
- [Video.js v10 GitHub 仓库](https://github.com/videojs/v10)

## 9. 本次取证备注

- Context7 可解析出 `/videojs/v10` 和 `/videojs/video.js`，但本次查询没有返回文档片段，所以以 Video.js 官方页面和 GitHub changelog 为准。
- 抓取时间是 2026-04-14；v10 beta 变化很快，后续如果要进入 POC，必须重新读 changelog。
