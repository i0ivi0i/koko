# 2026-04-17 浏览器应用化官方实践补充：Safari / Chrome / WebTorrent / P2P / Video.js

适用范围：`koko` 前端从“网页脚本思维”转向“浏览器中的应用”，以及多人群聊、多房间、重媒体、P2P 与缓存恢复的上位架构判断。  
目标：把这次补查的官方资料压成一份短笔记，直接回答一个问题: 浏览器厂商和相关官方，到底把什么叫作“浏览器中的应用”。

## 1. 先说结论

这次补查之后，可以把判断写死：

1. Chrome / web.dev / WebKit 的官方语境，确实早就在讲 `Web App`，不是“大网页”。
2. 它们共同强调的是生命周期、恢复、存储驱逐、更新治理、前后台边界，而不是“页面只要还能显示就算活着”。
3. WebTorrent / WebRTC / p2p-media-loader / Video.js 官方也都在强调各自边界，不支持把所有能力混成第二个私有播放内核。
4. 对 `koko` 这种公网万人实时群聊来说，真正该建设的是 **AppRuntime + actor owner + 预算 + 恢复协议**，而不是继续在页面组件里补 guard。

## 2. Chrome / web.dev 官方提醒了什么

### 2.1 Web App 是应用，不是标签页里的脚本集合

- web.dev 把 PWA 定义成“modern, high quality applications built with web technology”。
- 可安装、独立窗口、系统级入口、像应用一样启动，是官方正面鼓励的方向。

工程含义：

1. 我们不能只按页面路由和 DOM 树来理解系统。
2. 启动、恢复、更新、后台、返回行为都属于应用问题。

资料：

- https://web.dev/articles/install-criteria
- https://web.dev/learn/pwa/architecture

### 2.2 `hidden` 是最后一个可靠信号，不要再迷信 unload

- Chrome Page Lifecycle API 明确建议：把 `hidden` 当作最后一个可靠的生命周期节点。
- `beforeunload` 不可靠，还会影响 bfcache。

工程含义：

1. 前后台切换时，必须尽早保存必要状态、停掉重活。
2. 不能等页面真销毁了再想起收尾。

资料：

- https://developer.chrome.com/docs/web-platform/page-lifecycle-api

### 2.3 多视频页面必须控制预载和自动播

- web.dev 建议视频列表优先 `poster + preload="none"`，或至少 `metadata`。
- 用 `IntersectionObserver` 做懒加载，而不是默认给整列视频建重链。
- Chrome 自动播策略明确：静音自动播才是稳定安全路径。

工程含义：

1. 群聊时间线只能保留轻量预览。
2. 自动播要单 owner、静音、少实例。

资料：

- https://web.dev/articles/lazy-loading-video
- https://web.dev/articles/fast-playback-with-preload
- https://developer.chrome.com/blog/autoplay

### 2.4 Service Worker 要显式治理更新，不要让旧壳混跑

- web.dev 一直强调 SW 生命周期、接管时机、更新策略都要明确设计。
- `skipWaiting()` 不能乱用；旧缓存要清；不要随意改 SW URL。

工程含义：

1. app shell 更新要有协议。
2. 旧 bundle 继续活着不是“小问题”，它会直接把旧 bug 留在用户端。

资料：

- https://web.dev/articles/service-worker-lifecycle
- https://web.dev/learn/pwa/update

## 3. WebKit / Safari 官方提醒了什么

### 3.1 Service Worker 是按需后台部件，不是页面的影子分身

- WebKit 在 `Workers at Your Service` 里明确说明：SW 有独立生命周期与独立存储进程，没有 client 时会终止。

工程含义：

1. SW 只能当后台能力和缓存加速层。
2. 不能把业务真相寄托在“SW 还活着”上。

资料：

- https://webkit.org/blog/8090/workers-at-your-service/

### 3.2 存储默认 best-effort，Safari 会清理

- WebKit `Updates to Storage Policy` 明确写：存储默认 best-effort。
- `StorageManager.persist()` 是申请，不是永远获批。
- Home Screen Web App 更容易获得更好的持久化待遇，但仍不能假定永不丢失。

工程含义：

1. Cache / IDB / Blob / 媒体段不能当权威真相。
2. `koko` 必须设计“本地加速层丢失后的恢复”。

资料：

- https://webkit.org/blog/14403/updates-to-storage-policy/

### 3.3 Safari 也在讲 Web App，只是更强调 feature detection

- WebKit 对 iOS/iPadOS Web Push 的说明，前提就是 Home Screen Web App。
- 官方明确建议做 feature detection，不做 browser detection。

工程含义：

1. “浏览器中的应用”不是 Chrome 独有想法。
2. 但 Safari 下必须更真实地面对差异与回收。

资料：

- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## 4. WebTorrent / WebRTC / p2p-media-loader / Video.js 官方真正建议什么

### 4.1 WebTorrent 是重型协作分发层，不适合在时间线里到处冷启动

- WebTorrent 浏览器侧依赖 WebRTC。
- `file.streamURL` / `file.streamTo` 依赖 `client.createServer()`。
- seek 会重新创建 read stream。

工程含义：

1. 它适合正式查看器、热复用、后台补齐、做种。
2. 不适合时间线冷视频一划过视口就起重会话。

资料：

- https://webtorrent.io/docs

### 4.2 WebRTC 是 transport，不是产品真相

- WebRTC 官方定位就是 peer connection 与 data channels。
- 它不提供媒体产品语义、资产生命周期或业务恢复规则。

工程含义：

1. 不能把“用了 WebRTC”当成架构设计完成。
2. 真正的 owner 仍然要在应用层自己裁决。

资料：

- https://webrtc.org/getting-started/overview
- https://webrtc.org/getting-started/data-channels

### 4.3 p2p-media-loader 只该待在 HLS / DASH 支路

- 官方文档只围绕 `Hls.js` 和 `Shaka`。
- 它公开的配置项本质上都在回答 segment-level P2P 调度。

工程含义：

1. 它是标准流媒体增强层。
2. 不该被抬成第二个全局播放 owner。

资料：

- https://novage.github.io/p2p-media-loader/docs/latest/

### 4.4 Video.js v10 继续做唯一播放器壳，不替你统一真相

- 官方 v10 站点强调的是 provider / container / media abstraction。
- 它回答播放器壳怎么组织，不回答应用运行时真相归属。

工程含义：

1. 继续用它做正式查看器壳是合理的。
2. 但 owner、缓存、恢复、预算仍要自己治理。

资料：

- https://v10.videojs.org/

## 5. HLS / DASH / CMAF 官方方向

- Apple HLS 与 DASH-IF IOP v5 都持续指向标准分段流媒体。
- `CMAF / fMP4` 是正式流媒体主链的共同底层，不是边缘高级玩法。

工程含义：

1. 正式查看器继续走标准流媒体主链。
2. P2P 增强要挂在标准主链边上，不要反客为主。

资料：

- https://developer.apple.com/streaming/
- https://dashif.org/guidelines/iop-v5/

## 6. 落到 koko 的直接裁决

这批资料落到 `koko`，可以直接形成六条判断：

1. 页面只是壳，真正的前端运行时真相必须收口到 `AppRuntime`。
2. 浏览器事件只作输入信号，必须先变成应用事件。
3. SW、缓存、IDB、Blob、WebTorrent store 都是可回收加速层，不是业务权威。
4. 时间线轻预览、正式查看器、P2P 协作分发、标准流媒体继续分层，不准再混成“万能链”。
5. 多房间、重媒体、实时群聊的性能治理，必须做预算，不是继续加 guard。
6. Safari/Chrome 差异必须按特性探测和恢复协议处理，不能靠浏览器名分支硬写死。

## 7. 一句话

“浏览器中的应用”不是把网页做得更像 App 图标，  
而是接受浏览器就像一套会冻结、会更新、会回收、会驱逐的操作系统，然后按这个现实来设计前端运行时。
