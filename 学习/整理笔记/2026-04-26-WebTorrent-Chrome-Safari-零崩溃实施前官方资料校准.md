# 2026-04-26 WebTorrent / Chrome / Safari 零崩溃实施前官方资料校准

适用范围：`koko` 当前“万人群聊浏览器零崩溃零闪烁”实现前的资料校准，重点覆盖 `WebTorrent` 浏览器正式 API、Chrome/web.dev 的长列表与媒体性能建议、Safari/WebKit 的视频与自动播边界。
目标：在动实现前，把这轮最容易手搓错、最容易靠旧印象乱猜的接口、生命周期和高性能边界重新钉死，避免又写出第二套私有播放/分发真相。

关联旧笔记：

1. `学习/整理笔记/浏览器应用化官方实践补充-Safari-Chrome-P2P-2026.md`
2. `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`
3. `学习/整理笔记/WebTorrent最新版官方建议与高性能设计补充-2026-04.md`
4. `学习/整理笔记/2026-04-23-WebTorrent极限协同分发动工前官方资料校准.md`

---

## 1. 这轮动手前先记死的结论

1. `WebTorrent` 官方浏览器正路已经给够了：`service worker + client.createServer({ controller }) + file.streamTo()/streamURL`。这轮不允许再手搓第二条 raw range / 私有拉块播放链。
2. Chrome / web.dev 对长列表和多视频页面的态度很明确：只保留窗口附近少量真实媒体表面，其他位置优先 `poster + preload="none|metadata" + lazy load + IntersectionObserver`，不是把整列 `<video>` 一起挂活。
3. Chrome Page Lifecycle 已经把 `hidden` 定义成最后一个可靠信号；`hidden -> frozen` 前就该保存必要状态、停掉后台不该继续跑的重活、关掉会妨碍缓存/回收的连接。
4. Safari / WebKit 对自动播和内联播放的限制更硬：静音、`playsinline`、可见时自动播；macOS 的自动播授权还是按 media element 算，不适合满屏长一堆新 `<video>` 元素抢权限。
5. 真正的“零抽搐”不是只看功能能不能播，还要看长滚动下的长帧、布局/样式重算、DOM 体积和主线程压力。Chrome 官方已经给了可观测 API 和 DevTools insight，不需要我们再发明一套“感觉流畅”。
6. 也不能把“减主线程压力”误解成“把 WebTorrent/WebRTC 主链搬进 Worker”。官方文档明确说 Web Worker 没有 DOM，也没有 `WebRTC`；能搬走的是纯计算，不是正式媒体/peer 会话真相。

---

## 2. WebTorrent 官方给出的硬边界

### 2.1 浏览器正式播放和正式预览能力，官方已经给了

`WebTorrent` 官方文档现在仍明确给出浏览器正路：

1. 先注册 `service worker`
2. 再 `client.createServer({ controller })`
3. 然后 `client.add(...)`
4. 最后 `file.streamTo(video)` 或走 `file.streamURL`

这说明：

1. 浏览器里的正式媒体来源继续只该站在 `createServer + streamTo/streamURL` 上。
2. seek / Range 请求 / 浏览器原生容器解码，本来就该复用官方 server 语义。
3. 这轮如果要收口崩溃根因，应该收口会话数量、生命周期和预算，而不是重写播放传输内核。

来源：

- [WebTorrent API Documentation](https://webtorrent.io/docs)

### 2.2 生命周期清理也有官方语义，不要自己造

`WebTorrent` 官方 docs 明确写了：

1. `client.add()` 支持 `destroyStoreOnDestroy`、`storeCacheSlots`、`strategy`、`paused`、`deselect`
2. `client.remove()` 会销毁 peer 连接，并且可按需销毁 store
3. `client.destroy()` 会销毁整个 client 和全部 torrent/connection
4. `client.on('error')` 必须监听

这对当前计划的直接约束：

1. 零引用/离屏/后台清理应该继续站在 `remove/destroy` 语义上。
2. store 缓存、piece 选择和会话销毁已经有官方 knob，不需要再补第二套“私有下载器生命周期”。
3. 如果浏览器崩溃区来自会话与 reader 单向膨胀，优先查 `storeCacheSlots`、destroy 路径、selected/deselected 文件、活跃 `stream` 数，而不是补更多 UI guard。

来源：

- [WebTorrent API Documentation](https://webtorrent.io/docs)

### 2.3 WebTorrent 官方自己就不是“纯 P2P 宗教”

`WebTorrent` FAQ 直接把它定位成 `peer-assisted delivery`：

1. 热内容可以 browser-to-browser 快速传播
2. 冷内容仍可可靠地由 HTTP origin 提供
3. 浏览器 web peer 只能连接支持 `WebTorrent/WebRTC` 的 peers

这意味着：

1. `WebTorrent` 协同主链要保，但不应该被误改成“整房每条历史视频都常驻前台重对象”。
2. 浏览器正式 swarm 的收益建立在真实 WebRTC-capable peer 上，不是建立在“多挂几个 `<video>` 看起来更热”。
3. 冷启动/长期兜底与协同扩散，本来就是两层分工，不需要发明第三条私有混合链。

来源：

- [WebTorrent FAQ](https://webtorrent.io/faq)

---

## 3. Chrome / web.dev 对“长时间滚动不崩不卡”的直接要求

### 3.1 `hidden` 是最后一个可靠信号，不要把收尾压到 unload

Chrome Page Lifecycle 文档明确建议：

1. `hidden` 往往是开发者最后一次可靠观察到的状态变化
2. 到了 `hidden` 就要把它当作“用户会话大概率结束”
3. `hidden -> frozen` 前应停止用户不希望后台继续跑的任务
4. 特别点名要关掉 `WebRTC`、`WebSocket`、网络轮询，并持久化动态视图状态
5. 不要依赖 `unload`

这对 `koko` 的直接约束：

1. 预算释放不能晚到页面真销毁才做。
2. 后台标签页时，重 reader / 重 listener / 重下载态必须能尽快回落。
3. 继续帮助后人可以保留，但必须和前台重活拆开。

来源：

- [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

### 3.2 多视频时间线默认应该懒，不应该整列预载

web.dev 对视频懒加载和 preload 的建议非常直接：

1. 非自动播视频优先 `preload="none"`，并配 `poster`
2. 多视频页面更适合 `preload="metadata"` 或 `none`
3. 用 `IntersectionObserver` 懒加载视频源
4. 同域视频太多会撞上连接数和资源挂起问题

这对 `koko` 的直接约束：

1. 群聊时间线里的非 owner 历史视频，不该默认挂真实播放源。
2. 近视口窗口预算必须比“消息数”小得多。
3. `preview truth` 和真实媒体表面必须彻底解耦。

来源：

- [Lazy loading video](https://web.dev/articles/lazy-loading-video)
- [Fast playback with audio and video preload](https://web.dev/articles/fast-playback-with-preload)

### 3.3 可见性判断优先 `IntersectionObserver`，而不是滚动里狂测矩形

web.dev 对 `IntersectionObserver` 的建议也很硬：

1. `getBoundingClientRect()` 热路径轮询会强迫浏览器重排并引入 jank
2. 无限列表更推荐 sentinel 模式
3. sentinel 要复用，不要无限新增 observer/observe 调用
4. 一个 `IntersectionObserver` 可以观察多个元素

这对 `koko` 的直接约束：

1. 可见窗口/近视口预算要优先站在共享 `IntersectionObserver` 或 sentinel recycle 方案上。
2. 不该让每个消息卡片自己在滚动里做热判断。
3. “看起来只是判断一下可见性”本身就可能是 jank 根因。

来源：

- [IntersectionObserver's coming into view](https://web.dev/articles/intersectionobserver)

### 3.4 Chrome 已经给了“卡不卡”的观测口，不要只靠肉眼

Chrome 官方这两组资料直接给了这轮该接的性能证据：

1. `Long Animation Frames API` 把超过 `50ms` 的长帧直接暴露给 `PerformanceObserver`
2. `Optimize DOM size` insight 把布局/样式重算超过 `40ms` 当作失败信号
3. `How large DOM sizes affect interactivity` 明确指出大 DOM 会拖慢渲染、内存和 INP

这对 `koko` 的直接约束：

1. 真实烟测必须记录长帧与大布局/大样式重算证据。
2. “视频能播”不等于“时间线可长期滚动”。
3. 长列表必须做窗口化和 DOM 收敛，而不是只盯着视频对象本身。

来源：

- [Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames)
- [Optimize DOM size](https://developer.chrome.com/docs/performance/insights/dom-size)
- [How large DOM sizes affect interactivity](https://web.dev/articles/dom-size-and-interactivity)

### 3.5 Off-main-thread 能减压，但搬不走 WebRTC 真相

web.dev 的 OMT 文档明确写了：

1. Web Worker 没有 DOM
2. 也没有 `WebRTC`
3. 适合搬走的是纯计算和不依赖 DOM/WebRTC 的工作

所以：

1. 不要试图把 `WebTorrent` 正式会话 owner、真实 `<video>` 控制、或 WebRTC 连接管理硬搬进 Worker。
2. 可以考虑搬走的是统计、摘要、非 DOM 预算聚合之类纯计算活。

来源：

- [Use web workers to run JavaScript off the browser's main thread](https://web.dev/articles/off-main-thread)

---

## 4. Safari / WebKit 的直接约束

### 4.1 iPhone 端自动播和内联播放不是无限制的

WebKit 对 iOS 视频策略写得很明确：

1. 只有静音或没有音轨的视频才允许自动播
2. 自动播开始时元素必须在屏幕可见区域
3. 元素变为不可见时会暂停自动播
4. iPhone 上要想内联播放，必须加 `playsinline`

这对 `koko` 的直接约束：

1. 时间线预览视频必须继续坚持静音 + `playsinline`。
2. 离屏历史卡片不该继续拖着真实自动播 `<video>` 活着。
3. “远离视口也继续 hold 住真实视频表面”不仅浪费，还和 Safari 的可见性策略相冲。

来源：

- [New \<video\> Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)

### 4.2 macOS Safari 的自动播授权是按元素给的

WebKit 对 macOS 自动播策略还特别提醒：

1. 自动播限制是按 media element 生效
2. 如果想连续播放多个视频，应该换同一个元素的 source，而不是不停创建新元素

这和我们现有的“唯一正式播放器”裁决是同向的，直接约束了这轮实现：

1. 正式播放仍应继续只认一颗 canonical player。
2. 不能为了修 crash 又把时间线搞回多颗正式视频元素互抢 owner。

来源：

- [Auto-Play Policy Changes for macOS](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)

---

## 5. Apple 标准流媒体主链提醒

Apple 当前官方 `HTTP Live Streaming` 资料仍把 HLS 定义成：

1. 面向 Apple 设备和 PC 的标准 live / on-demand 传输方案
2. 可部署在普通 web server 和 CDN 上
3. `Low-Latency HLS` 与 `CMAF` 都是正式文档主线

这对当前计划的含义不是“改回 HLS 主导”，而是：

1. 别把 `WebTorrent` 误写成第二个假 HLS 引擎。
2. 标准流媒体冷启动支路和 whole-file 协同主链，本来就该边界清楚。
3. 需要可靠跨 Safari/Chrome 播放时，优先复用浏览器和标准流媒体生态，而不是自造奇怪协议。

来源：

- [HTTP Live Streaming (HLS)](https://developer.apple.com/streaming/)
- [Enabling Low-Latency HTTP Live Streaming (HLS)](https://developer.apple.com/documentation/http-live-streaming/enabling-low-latency-http-live-streaming-hls)
- [About the Common Media Application Format with HTTP Live Streaming (HLS)](https://developer.apple.com/documentation/http-live-streaming/about-the-common-media-application-format-with-http-live-streaming-hls)

---

## 6. 对当前零崩溃 implementation plan 的直接施工约束

1. `WebTorrent` 正式字节链继续只认官方 `createServer + streamTo/streamURL`；不新长私有拉块播放器。
2. 群聊消息流必须窗口化；真实媒体表面、活媒体会话、whole-file heavy 会话都只能是近视口/当前 owner/当前帮助窗口的子集。
3. 页面进入 `hidden` 时就要开始释放前台重活；`frozen` 前必须能关掉不该继续挂着的 `WebRTC/WebSocket/轮询/重 reader`。
4. 预览视频默认走轻路径：静音、`playsinline`、`poster`、`preload="none|metadata"`、近视口才真正挂源。
5. 可见性判断优先共享 `IntersectionObserver` / sentinel recycle；禁止在滚动热路径里到处 `getBoundingClientRect()`。
6. 真正的“丝滑”要写进证据链：烟测里必须抓 `Long Animation Frame`、大布局/大样式重算、内存、活会话数、真实 `<video>` 数。
7. 如果后面需要 Worker，只能搬纯计算，不搬 WebRTC 会话 owner、正式视频元素或业务真相。