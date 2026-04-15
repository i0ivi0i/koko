# 2026-04-15 群聊媒体 WebTorrent / Video.js v10 2026 新实践

适用范围：`koko` 的媒体协作分发、浏览器内视频播放、后续播放器演进。  
目标：把 `WebTorrent` 和 `Video.js v10` 目前真正值得用的官方心智收成新笔记。

## 1. 先说结论

这一轮最该记住的结论有八条：

1. 浏览器协作分发继续优先复用 `WebTorrent`，不要自研 P2P 核心。
2. 视频流式播放优先走 `client.createServer() + file.streamTo() / streamURL` 这条官方路径，不手搓 range server。
3. 浏览器 WebTorrent 不是“能连所有 BT 客户端”；要连得上，peer 端必须支持 WebRTC。
4. 热门内容浏览器互传、冷门内容 HTTP / Web Seed 兜底，这本来就是 WebTorrent 官方鼓励的心智。
5. 当前官方文档里 `maxWebConns` 默认是 `4`，不是越大越好。
6. 浏览器标签页刷新或关闭时，store 生命周期要主动设计；不想跨会话保留，就必须销毁 store。
7. `Video.js v10` 已经进入 beta 路线，但 2026-04 仍处在“可以试、别盲目全量切生产”的阶段。
8. 对你们这种正式公网群聊项目来说，WebTorrent 是很适合补“协作分发”，但主播放链仍要保留稳定 HTTP / 对象存储兜底。

## 2. WebTorrent 官方 2026 真正给了什么

### 2.1 客户端主能力

官方文档里几个最重要的 API 事实：

- 浏览器版 `WebTorrent` 依赖浏览器原生 `WebRTC`。
- `client.add()` 支持：
  - `announce`
  - `getAnnounceOpts`
  - `urlList`
  - `maxWebConns`
  - `private`
  - `store`
  - `destroyStoreOnDestroy`
  - `storeCacheSlots`
  - `strategy`
- 当前文档写的 `maxWebConns` 默认值是 `4`。
- 下载中的 torrent 会自动继续做种。
- 官方明确提醒：如果不想跨会话留存数据，要在页面关闭前主动销毁 store。
- 任何客户端 fatal error 都应该监听并处理。

对 `koko` 的直接约束：

1. 你们现在这条“浏览器互传 + web seed 兜底”的方向是对的。
2. 但要把生命周期设计清楚：哪些附件需要跨会话尽量续，哪些只在当前页临时存在。
3. `maxWebConns` 不要无脑拉高，否则浏览器和源站压力都会一起变差。

### 2.2 流式播放

官方推荐路径非常明确：

- 先注册 service worker。
- `client.createServer({ controller })`
- 然后用 `file.streamTo(video)` 或 `file.streamURL` 做媒体播放。

FAQ 也明确写了：

- 浏览器里视频/音频流播依赖 `MediaSource`。
- 很多格式都能展示，但只有 `.mp4`、`.m4v`、`.m4a` 明确写了“包括 seeking 在内都完整支持”。
- 浏览器端 seeking 是按需动态抓取需要的 pieces。

对 `koko` 的直接约束：

1. 你们如果要稳定的浏览器视频播放体验，上传侧和转码侧最好继续优先产出 `mp4` 友好容器。
2. 不要再手搓一套私有视频补块协议。
3. WebTorrent 播放要和 HTTP 直链播放共存，不要把播放链绑死在 P2P 上。

### 2.3 浏览器 peer 的边界

FAQ 里最关键的现实约束：

- 浏览器只能下载被 WebRTC-capable client 做种的 torrent。
- 浏览器 WebTorrent 不能直接和普通传统 BT 客户端随便互联。
- 官方本身就把 peer-assisted delivery 当作重要 use case：热门内容浏览器互传，冷门内容由 HTTP origin 稳定供应。

对 `koko` 的直接约束：

1. 正式公网群聊里，WebTorrent 是“降源站压力、加速热门附件”的轮子，不是替代源站的唯一下载方案。
2. 24 小时保底源继续站在 Web Seed / HTTP origin 上是正路。

### 2.4 协议立场

WebTorrent FAQ 还有一个很关键的架构观点：

- 维护者明确说，不重新发明全新协议，而是继续站在 BitTorrent 线上，只把浏览器连接方式换成 WebRTC。

这对 `koko` 的价值很直接：

1. P2P 核心继续站在成熟协议上。
2. 你们自己只保留业务门禁、授权、tracker 策略、seed 生命周期这些业务边界。

## 3. Video.js v10 在 2026-04 的真实阶段

### 3.1 官方路线

当前官方 v10 路线图写得很清楚：

- `v10` 是一次从头重建，目标是更模块化、更现代、更适合框架化开发。
- `v8` 现在只保留 bug fix 和关键安全修复，不再规划新功能。
- `March 2026` 是 v10 beta。
- `Mid-2026` 目标是 v10 GA。
- 当前 beta 阶段，官方明确说适合实验性真实项目试用，但 API 仍可能变化。
- 现阶段的适配流媒体能力仍依赖现有社区 engines。

对 `koko` 的直接约束：

1. 如果你要的是“现在就稳定上线”，就别把 v10 当成熟生产迁移目标。
2. 如果你要的是“为未来前端浏览器应用化留观察点”，那 v10 值得持续跟踪。

### 3.2 v10 React 方向

当前官方文档给出的新心智：

- `createPlayer()` 是新的主入口。
- 返回 `Provider / Container / usePlayer / useMedia` 这组能力。
- `usePlayer` / `useStore` 支持 selector 风格订阅，适合更克制地接播放器状态。
- 整体方向是把播放器能力拆成更小、可组合、可类型化的部件。

对 `koko` 的直接约束：

1. 这条路和你们现在追求的“薄壳、多壳共核、避免大一统组件怪物”是契合的。
2. 但在 v10 GA 前，不适合为了“更先进”就强推大迁移。

## 4. 对 `koko` 最有价值的设计裁决

### 4.1 现在就应该坚持的

1. 协作分发继续用 `WebTorrent`。
2. 保底源继续保留 HTTP / Web Seed。
3. 视频流播优先复用 `createServer + streamTo / streamURL`。
4. 浏览器播放主格式继续优先兼容 `mp4`。

### 4.2 现在先别做的

1. 不要自研 tracker 协议。
2. 不要自研视频 piece range 服务。
3. 不要现在就大规模迁移到 `Video.js v10`。

### 4.3 可以进入观察清单的

1. `Video.js v10` GA 节点。
2. 你们现有播放器壳是否能平滑包住 v10 的 `Provider / Container / hooks` 模型。
3. WebTorrent store 的跨会话策略。

## 5. 官方来源

- WebTorrent Docs: <https://webtorrent.io/docs>
- WebTorrent FAQ: <https://webtorrent.io/faq>
- Video.js v10 Roadmap: <https://videojs.org/docs/framework/react/concepts/v10-roadmap>
- Video.js `createPlayer`: <https://videojs.org/docs/framework/react/reference/create-player>
- Video.js `usePlayer`: <https://videojs.org/docs/framework/react/reference/use-player>
- Video.js `useStore`: <https://videojs.org/docs/framework/react/reference/use-store>
