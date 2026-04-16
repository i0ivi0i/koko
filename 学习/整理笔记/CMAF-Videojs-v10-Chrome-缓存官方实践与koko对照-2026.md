# 2026-04-16 CMAF / Video.js v10 / Chrome 缓存官方实践与 koko 对照

适用范围：`koko` 当前 `WebTorrent + HLS/CMAF + Video.js v10 + Service Worker` 的浏览器视频播放、重复观看缓存复用、以及后续公网部署前的缓存策略收口。  
目标：回答两个问题。

1. 我们前面“重看视频优先重裁决到本地 `webtorrent`”这刀修法，到底对不对。
2. 按 `CMAF`、`Video.js v10`、`Chrome` 官方口径，浏览器视频缓存要怎样做，才算更优雅、更自动、更接近正式上线方案。

## 1. 先说结论

结论先写死：

1. 我们前面的修法方向是对的，但它是**播放编排纠偏**，还不是“官方缓存架构终局”。
2. `Video.js v10` 官方现在给你的，是**播放器壳与状态/容器/媒体分层**，不是“帮你自动完美缓存”的播放器内核。
3. `Chrome` 官方对媒体缓存的要求很明确：如果你真想让 `<video>` 稳定复用缓存，不能只靠播放过程中自然出现的 `206 Partial Content`，而要**显式缓存完整媒体**，并**正确处理 `Range` 请求**。
4. `CMAF/HLS` 官方路线强调的是：**标准分段、稳定 URL、标准 HTTP/CDN、fMP4/CMAF、独立可解码分段、减少碎片请求**。这条线天然比“把一整块原片 URL 丢给浏览器碰运气”更缓存友好。
5. 所以，对 `koko` 当前实现最准确的判断是：
   - 当前修法：对，解决了“本地已完整但查看器误回落网络链”的错误。
   - 当前状态：还不够“官方优雅自动”。
   - 下一阶段真正该补的：不是再堆播放器小技巧，而是把 `CMAF/HLS`、`SW`、`Range`、`Cache-Control`、`WebTorrent persistent store` 这几层契约打通。

## 2. 先分清浏览器里到底有哪几层“缓存”

这一步如果不分清，后面很容易把问题看歪。

### 2.1 HTTP Cache

这是浏览器标准缓存，主要受响应头控制，比如：

- `Cache-Control`
- `ETag`
- `Last-Modified`

它最适合：

- 指纹化静态资源
- 稳定 URL 的媒体分段
- 可重验证的清单文件

### 2.2 Cache Storage / Service Worker

这是 `SW` 主动管理的缓存，不是浏览器自动帮你做好的那种。

它最适合：

- App Shell
- 你明确想受控缓存的媒体资源
- 需要在离线或特殊裁决下直接命中缓存的资源

### 2.3 WebTorrent persistent store

这不是浏览器 HTTP Cache，也不是普通 Cache Storage。

它更像：

- 协作分发资产仓
- 浏览器本地持久化的 swarm 数据
- 未来 peer-only 续播的底座

所以“重复观看没有优雅命中缓存”这件事，不能只盯着 Network 面板里有没有再发 HTTP。  
对于 `koko`，真正相关的是三件事：

1. 查看器有没有优先命中本地 `webtorrent` 可读流。
2. `HLS/CMAF` 支路有没有稳定吃到 HTTP/SW 缓存。
3. DevTools 是否在用“禁用缓存/硬刷新”这种本来就故意模拟首访的模式。

## 3. CMAF / HLS 官方真正推荐的缓存友好路径

### 3.1 Apple 的主张不是“原片直链”，而是标准分段

Apple 官方在 `Using CMAF with HLS` 里把 `CMAF` 直接定义成 segmented media 的标准形态，并明确说明它是给 `HLS` 和 `MPEG-DASH` 这类自适应流交付与解码使用的。  
这说明：**官方正路是分段媒体对象，不是把整块原视频当唯一高级播放表面。**

### 3.2 Apple 对“下载/缓存友好”的写法很具体

`HLS Authoring Specification for Apple Devices appendixes` 里有几条非常重要：

1. 用 `mediastreamvalidator`、`hlsreport` 验证流。
2. 面向下载的 HLS 内容，**应优先封装为 `fMP4` 或 elementary audio stream**。
3. 连续分段应使用 **`EXT-X-BYTERANGE` 且 range 连续**，这样可以减少 HTTP 请求数。
4. 内容应尽量避免过多小文件。
5. 示例清单里显式使用 `#EXT-X-INDEPENDENT-SEGMENTS`。

这些点翻译成工程话就是：

- 分段本身要可独立解码，浏览器切换和 seek 才会稳。
- URL/对象布局要稳定，浏览器和 CDN 才更好复用缓存。
- 小碎片过多会恶化缓存与请求开销。

### 3.3 对 koko 的直接含义

如果你想让 `HLS/CMAF` 这条支路更像正式生产缓存链，应该持续靠近下面这组约束：

1. 输出 `fMP4/CMAF` 友好的标准分段。
2. 分段 URL 尽量稳定，别把无意义抖动参数塞进 URL。
3. 对 manifest 和 segment 区分缓存策略。
4. 让清单与分段的生命周期设计明确，而不是“一把梭同一个 header”。

## 4. Video.js v10 官方到底负责什么，不负责什么

### 4.1 v10 当前公开口径

截至 **2026-04-16**，Video.js 官方公开文档把 `v10` 明确标成 `beta`。官方公开路线写的是：

- `Video.js video player v10 beta`
- `Adaptive streaming support via existing community engines`
- `Close to stable, but API changes are still possible`
- `Intended for experimental adoption in real-world projects`
- 公开站点把正式 `Release` 目标放在 `Mid-2026`

所以在这个日期点，官方对 `v10` 的态度不是“它已经是缓存主脑”，而是“它是新的播放器框架表面，流媒体能力仍依赖现有 engine”。

### 4.2 v10 的职责边界

官方 `Overview` 和 `createPlayer` / `media-container` 文档给出的边界很清楚：

1. `createPlayer()` 返回 `Provider`、`Container`、`usePlayer`、`useMedia`。
2. `Provider` 持有状态和动作。
3. `Container` 负责布局、全屏、交互面、media attachment。
4. media discovery 是 provider 处理，不是 container。
5. 自适应流仍建议接现有 streaming engine。

这意味着：

- `Video.js v10` 适合做我们现在说的“唯一播放器壳”。
- 但不要指望它自动解决 `SW` 缓存、HTTP `Range`、CMAF 分段策略、WebTorrent store 生命周期。
- 真正的缓存命中与媒体来源选择，还是要靠播放编排层、浏览器缓存契约、以及底层流引擎。

### 4.3 对 koko 的直接含义

我们当前把 `Video.js v10` 当壳用，这方向是对的。  
但如果把“缓存不优雅”也怪到 `Video.js v10` 身上，那就是怪错对象了。

## 5. Chrome 官方对媒体缓存的要求，比很多人以为的更硬

### 5.1 Service Worker 必须真的控制了页面

Chrome 官方 `A service worker's life` 写得很清楚：

1. “被 SW 控制的页面”才允许 SW 代表它拦截请求。
2. 新注册的 SW 默认要到**下一次导航或刷新**后，才开始控制页面。
3. 官方示例明确写了：首次注册后需要 reload，才会变成 controlled page。

所以如果你拿“首次载入”“硬刷新”或“SW 还没接管的页面”去看缓存命中，结论很容易偏。

### 5.2 DevTools 的 Disable cache / Empty Cache And Hard Reload，本来就是模拟首访

Chrome DevTools 官方文档明确说：

- `Disable cache` 用来模拟 first-time visitor。
- `Empty Cache And Hard Reload` 这类流程本来就是偏向强制重新走网络的调试手段。

所以你如果用这两种模式观察“重复观看是否命中缓存”，天然就会看到更像首访的行为。  
这不是缓存失效证据，而是测试姿势本身就故意绕过缓存。

### 5.3 媒体播放时自然产生的 206，不会自动帮你把完整文件缓存好

这一条是最关键的官方结论。

Chrome Workbox 官方 `Serving cached audio and video` 明确说：

1. 如果你想从缓存里提供媒体，应该**预先显式把媒体加入缓存**。
2. 方式可以是 precache、`cache.add()`、或 warm strategy cache。
3. **仅靠播放过程中的 runtime streaming 不行**，因为播放时从网络抓到的通常只是 partial content。
4. 要正确支持媒体缓存，还要让 `<video>/<audio>` 使用 `crossorigin`，并在 `SW` 里正确处理 `Range`。
5. 但官方也明确提醒：媒体通常很大，预缓存要克制，否则容易浪费带宽并触发存储配额问题。

### 5.4 Range 不是可选项

`workbox-range-requests` 官方文档写得很直接：

1. 浏览器带了 `Range` 头时，普通缓存命中并不会自动切出正确的字节范围。
2. `RangeRequestsPlugin` 的职责，就是从缓存的完整响应里切出请求需要的那一段。
3. 如果你只有 `206` 的 partial response，本身并不等于“我已经有一份完整可复用的本地媒体缓存”。

### 5.5 HTTP Cache 的官方常识也不能丢

`web.dev` 官方对 HTTP Cache 的建议依然有效：

1. 指纹化资源适合 `Cache-Control: max-age=31536000`，必要时加 `immutable`。
2. 未指纹化 URL 不要靠“浏览器猜”，要显式设置 `Cache-Control`。
3. `ETag` / `Last-Modified` 能减少重复下载成本。
4. 稳定 URL 很重要；同内容多 URL 会被重复缓存。

这对媒体尤其关键，因为：

- manifest 常常需要重验证。
- segment 更适合稳定 URL + 明确缓存头。
- 如果 URL 形状经常漂，缓存复用率会很差。

## 6. 回到 koko：我们当前实现哪里对，哪里还不够

下面是**基于当前代码与官方资料做的工程判断**。

### 6.1 已经对齐的部分

1. [E:\\koko\\frontend\\app-sw.ts](E:/koko/frontend/app-sw.ts) 只缓存 App Shell 静态资源，没有把聊天业务数据和媒体业务数据胡乱塞进去。
2. [E:\\koko\\frontend\\media-sw.ts](E:/koko/frontend/media-sw.ts) 对图片 blob 做了单独受控缓存，而其它媒体/P2P 请求继续交给官方 `webtorrent/dist/sw.min.js`，没有再手搓第二套私有 P2P worker 协议。
3. 前面“重看视频先重裁决本地 `webtorrent` 可读流”的修法，解决的是**播放编排错误**，这刀本身是对的。

### 6.2 还不够官方优雅自动的部分

1. 当前 `media-sw` 还**没有**为视频 HTTP/HLS 这条链建立显式的、`Range` 感知的缓存策略。
2. 当前更像是：
   - `WebTorrent persistent store` 负责本地 swarm 数据。
   - `HLS/HTTP` 回退继续走网络或浏览器默认缓存。
   - 但浏览器级媒体缓存策略还没有被正式收口。
3. 所以“已经看过的视频再次观看”为何偶尔还像重新拉取，根因并不神秘：
   - 有时是查看器首开太快，先走到 `manifest/HLS`；
   - 有时是页面尚未被对应 SW 控制；
   - 有时是 HTTP/HLS 支路本来就没有建立完整媒体缓存；
   - 有时是测试时用了本来就会绕过缓存的 DevTools 模式。

### 6.3 这意味着什么

这意味着我们前面的修法不能叫错，但也不能叫“终局已成”。  
更准确的说法是：

- **它修复了错误决策。**
- **它还没把缓存体系做成标准生产级。**

## 7. 现在最值得继续下刀的方向

如果目标是“更官方、更优雅、更自动”，下一阶段应优先做这些，而不是再堆播放器侧补丁：

1. 为 `HLS/CMAF` 明确设计缓存头：
   - manifest：偏重验证
   - segments：偏重稳定复用
2. 保证 segment URL 稳定，减少无意义 cache key 漂移。
3. 如果要让浏览器/SW 正式缓存视频资源，补上**完整媒体预热策略**与**`Range` 正确响应策略**。
4. 把“首开、普通刷新、硬刷新、SW 未接管、peer-only、本地已完整”这些场景分开测试，不混在一起下结论。
5. 继续保留 `WebTorrent persistent store` 作为 peer-only 长期生存平面，但不要把它和 HTTP Cache / Cache Storage 混成一个概念。

## 8. 当前裁决

当前最准确的裁决只有一句：

**我们前面的修法是必要且正确的，但还没达到 `CMAF + Video.js v10 + Chrome` 官方意义上的“完美缓存复用”；下一阶段该补的是标准媒体缓存契约，而不是继续只在播放器壳上打补丁。**

## 9. 官方来源

以下链接均为这次整理时实际查阅的一手来源：

- Apple `Using CMAF with HLS`  
  <https://developer.apple.com/documentation/http-live-streaming/about-the-common-media-application-format-with-http-live-streaming-hls>
- Apple `HLS Authoring Specification for Apple devices appendixes`  
  <https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices-appendixes>
- Apple `Deploying a Basic HTTP Live Streaming (HLS) Stream`  
  <https://developer.apple.com/documentation/http-live-streaming/deploying-a-basic-http-live-streaming-hls-stream>
- Apple HLS portal  
  <https://developer.apple.com/streaming/>
- Video.js v10 Roadmap  
  <https://videojs.org/docs/framework/react/concepts/v10-roadmap>
- Video.js v10 Overview  
  <https://videojs.org/docs/framework/react/concepts/overview>
- Video.js `createPlayer`  
  <https://videojs.org/docs/framework/react/reference/create-player>
- Video.js `media-container`  
  <https://videojs.org/docs/framework/html/reference/player-container>
- Video.js home / current v10 surface  
  <https://videojs.org/>
- Chrome Workbox `Serving cached audio and video`  
  <https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video>
- Chrome Workbox `A service worker's life`  
  <https://developer.chrome.com/docs/workbox/service-worker-lifecycle>
- Chrome Workbox `workbox-range-requests`  
  <https://developer.chrome.com/docs/workbox/modules/workbox-range-requests>
- Chrome DevTools Network Reference  
  <https://developer.chrome.com/docs/devtools/network/reference/>
- Chrome DevTools `Inspect network activity`  
  <https://developer.chrome.com/docs/devtools/network/>
- web.dev `Prevent unnecessary network requests with the HTTP Cache`  
  <https://web.dev/articles/http-cache>
