# Telegram 媒体查看器交互与轮子选型

- 整理日期：2026-04-12
- 结论用途：给群聊图片、视频、附件查看体验定方向，避免继续手搓媒体查看器轮子。

## Telegram 方向

Telegram 的关键逻辑不是“把播放器塞进聊天列表”，而是：

- 聊天流里的图片和视频只是入口。
- 点开图片或视频后，进入独立 media viewer。
- media viewer 里负责左右切换同一聊天的媒体、缩放、平移、保存、转发、删除等动作。
- GIF 才更偏向在聊天流里点按播放/停止；普通视频不应该按 GIF 逻辑塞进消息单元里长期播放。

参考来源：

- https://core.telegram.org/blackberry/chat-media-view
- https://telegram.org/blog/shared-media-join-requests-and-more/fr

落到本项目就是一句话：消息列表只展示预览和打开意图，真正观看交给独立媒体查看器。

## 我们的边界

当前前端是 Lit + TypeScript，不是 React / Vue；媒体查看器轮子优先级应该是：

1. 框架无关，能直接被 Lit 壳层薄适配。
2. 图片和视频都能进同一个 viewer，而不是图片一套、视频一套。
3. 支持移动端触摸、键盘导航、图片缩放、视频播放、动态数据源。
4. MIT 或足够清晰的开源许可证，避免 GPL / 商业授权先卡住项目。
5. 壳层只做适配和状态桥接，不把查看器能力重新手搓一遍。

## 候选轮子

### GLightbox

- npm：`glightbox@3.3.1`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 401 KB
- 形态：纯 JavaScript lightbox，无运行时框架绑定。
- 能力：图片、自托管视频、YouTube/Vimeo、iframe、inline content、键盘导航、触摸导航、图片缩放、动态 elements、可定制皮肤。
- 官方 README 直接支持 `elements` 动态数组和 `setElements()`，适合我们从消息展示项投影成 viewer slides。
- 初步判断：优先 POC。它最符合“不要为 Lit 项目引入 React 壳，也不要继续手搓”的方向。

参考来源：

- https://github.com/biati-digital/glightbox
- https://www.npmjs.com/package/glightbox

### Bigger Picture

- npm：`bigger-picture@1.1.20`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 328 KB
- 形态：JavaScript photo / video / iframe / HTML lightbox gallery。
- 能力方向很贴近“媒体查看器”，比旧包 `bigpicture` 更接近完整 gallery。
- 初步判断：第二候选。需要再做真实 POC 验证维护活跃度、API 稳定性和 TypeScript 接入质量。

参考来源：

- https://github.com/henrygd/bigger-picture
- https://www.npmjs.com/package/bigger-picture

### PhotoSwipe

- npm：`photoswipe@5.4.4`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 1.2 MB
- 优点：图片体验强，ESM、动态 import、手势和缩放成熟。
- 风险：官方文档明确说它主要为 photos 设计，视频/其他内容要通过 custom content、filters 或插件扩展；视频插件本身也标注仍在开发中且只支持 `<video>`。
- 初步判断：如果我们只做图片 viewer，它很强；如果要图片+视频统一 viewer，它不是第一选择。

参考来源：

- https://photoswipe.com/
- https://photoswipe.com/custom-content/
- https://github.com/dimsemenov/photoswipe-video-plugin
- https://www.npmjs.com/package/photoswipe

### lightGallery

- npm：`lightgallery@2.9.0`
- 许可证：GPLv3；商业项目需要商业许可。
- 体积：npm `dist.unpackedSize` 约 7.97 MB
- 优点：功能最全，图片、HTML5 视频、缩放、缩略图、全屏、旋转、触摸、键盘、插件体系都成熟。
- 风险：授权边界重；如果项目不是 GPLv3 兼容开源应用，就不能当普通 MIT 依赖随手引入。
- 初步判断：功能上强，许可证上谨慎；除非明确接受 GPLv3 或购买商业许可，否则不作为默认路线。

参考来源：

- https://www.lightgalleryjs.com/docs/settings/
- https://www.lightgalleryjs.com/license/
- https://www.npmjs.com/package/lightgallery

## 另一层：视频播放器内核

上面这些是“媒体查看器壳”：负责弹层、左右切换、关闭、缩放、手势、键盘、图片和视频的统一浏览。

下面这些是“视频播放器内核”：负责把一个视频播好。它们很优秀，但多数不负责图片查看、媒体序列、Telegram 式 viewer 弹层和聊天流生命周期。

正确组合方式不是二选一，而是：查看器壳负责“看哪一条媒体、怎么打开关闭和切换”，视频播放器内核只在当前 slide 是视频时接管播放。

### Plyr

- npm：`plyr@3.8.4`
- 许可证：MIT
- 体积：npm `dist.unpackedSize` 约 5.33 MB
- 形态：HTML5 video / audio、YouTube、Vimeo 的可访问播放器。
- 优点：控制条、键盘、字幕、全屏、画中画、自定义皮肤和统一 API 都比原生 `<video controls>` 更像成熟产品。
- 边界：它是播放器，不是图片+视频统一查看器；不会天然解决图片放大、媒体左右切换、聊天媒体序列和 viewer 关闭清理。
- 初步判断：如果 GLightbox / Bigger Picture 的自托管视频体验不够好，Plyr 是第一层可插拔播放器升级；适合“原视频 URL 原样播放，但控件体验更好”的场景。

参考来源：

- https://github.com/sampotts/plyr
- https://www.npmjs.com/package/plyr

### Video.js / Video.js v10 beta

- 稳定 npm 包：`video.js@8.23.7`
- v10 beta 包：`@videojs/html@10.0.0-beta.17`、`@videojs/core@10.0.0-beta.17`、`@videojs/react@10.0.0-beta.17`
- 许可证：Apache-2.0
- 形态：Web 视频播放器框架；稳定版 `video.js` 内置 HLS / DASH 相关能力，v10 beta 走更现代的模块化组件路线。
- 优点：比 Plyr 更偏“播放器平台”，适合 HLS / DASH、插件、统一视频 API、复杂控制条和更长期的视频能力演进。
- 边界：v10 当前是 beta，不应和稳定 `video.js` 包混为一谈；它仍然不是图片+视频统一查看器壳。
- 初步判断：如果只播群友上传的原始 MP4，先不用上 Video.js；如果我们开始支持 HLS / DASH、清晰度切换、字幕轨、复杂播放器状态，再把 Video.js 作为播放器内核候选。若考虑 v10，只能做隔离 POC，不能直接压到主流程。

参考来源：

- https://videojs.org/
- https://v10.videojs.org/
- https://github.com/videojs/video.js
- https://www.npmjs.com/package/video.js
- https://www.npmjs.com/package/@videojs/html
- https://www.npmjs.com/package/@videojs/core

### Shaka Player

- npm：`shaka-player@5.0.10`
- 许可证：Apache-2.0
- 体积：npm `dist.unpackedSize` 约 80.29 MB
- 形态：DASH / HLS / EME / DRM 方向的自适应流媒体播放器库。
- 优点：强在自适应码率、manifest、DRM、离线和流媒体平台能力，不依赖 Flash。
- 边界：它解决的是“复杂视频流怎么稳定播放”，不是“群聊媒体怎么像 Telegram 一样打开、缩放、切换、关闭”。
- 初步判断：如果未来做直播、点播、加密媒体、HLS / DASH 清晰度自适应，Shaka 很值得单独 POC；但对当前“群友发原图原视频附件”的路径，它太重，不是第一步。

参考来源：

- https://github.com/shaka-project/shaka-player
- https://www.npmjs.com/package/shaka-player

### libmedia + AVPlayer

- npm：`@libmedia/avplayer@1.3.0`、`@libmedia/avplayer-ui@1.3.0`
- 许可证：LGPL-3.0-or-later
- 形态：TypeScript 实现的高性能媒体库，支持 WebCodecs 和 Wasm；AVPlayer 是其中的音视频播放器实现。
- 优点：能力更底层，覆盖软解、硬解、MSE、多种封装格式和协议；当浏览器原生 `<video>` 播不了、需要自定义解封装/解码/协议管线时，它比普通播放器更接近“媒体引擎”。
- 风险：LGPL 许可要单独审；多线程能力涉及 `SharedArrayBuffer` 和 COOP / COEP 响应头；集成复杂度明显高于 Plyr / Video.js。
- 初步判断：它很强，但不是“轻量替换当前查看器”的第一步。只有当我们明确需要浏览器原生不支持的格式、协议、转码/解码管线，或要建设高级媒体引擎时，才进入 POC。

参考来源：

- https://github.com/zhaohappy/libmedia
- https://www.npmjs.com/package/@libmedia/avplayer
- https://www.npmjs.com/package/@libmedia/avplayer-ui

## 当前选型裁决

按真实需求分层，不要把所有轮子混成一个池子：

1. 当前 IM 体验缺口是“Telegram 式媒体查看器”：先选 GLightbox / Bigger Picture 这一类 viewer 壳。
2. 当前视频来源是群友上传的原视频文件：先用原视频 URL，必要时在 viewer 内嵌 Plyr 提升控件，不让后端改画质。
3. 如果后面走 HLS / DASH / 清晰度自适应：再评估 Video.js 稳定版或 Shaka Player。
4. 如果后面要自定义协议、特殊封装、浏览器原生不支持格式、WebCodecs / Wasm 媒体管线：再评估 libmedia + AVPlayer。
5. 如果明确要追 Video.js v10：单独开 beta POC，不能把 beta API 直接写进主聊天流。

## 推荐下一步

先做 GLightbox 小步 POC，不直接大改主流程；视频内核先保持可替换，不把 Plyr / Video.js / Shaka / libmedia 的选择写死进业务代码：

1. 增加一个极薄的 `媒体查看器适配器`，输入是当前房间的媒体展示项数组和起始 attachment id。
2. 把图片/视频映射成 GLightbox `elements`，图片走原图 URL，视频走原视频 URL。
3. 保留当前消息列表“只预览、不播放”的边界。
4. 如果原生视频控件体验不够，再把 Plyr 作为 viewer 内部的视频播放器内核 POC，不提前上 Shaka / libmedia。
5. 用测试锁住：点击图片/视频时打开 viewer；viewer 关闭后回到聊天；列表中不出现可播放的 `controls` 视频。
6. POC 只验证一条竖切：一张图片 + 一个自托管视频 + 左右切换 + 关闭清理实例。

不建议下一步继续做的事：

- 不要继续给当前手搓 viewer 加更多按钮、缩放、拖拽和手势。
- 不要把视频播放重新塞回消息列表。
- 不要为了一个 viewer 引入 React/Vue 运行时。
- 不要在许可证没定清楚前引入 GPLv3 / 商业授权库。
- 不要把 Shaka / libmedia 这种重型视频内核当成普通 lightbox 直接塞进聊天壳层。
