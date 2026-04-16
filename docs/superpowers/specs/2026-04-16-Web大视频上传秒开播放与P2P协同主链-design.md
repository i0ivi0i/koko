# Web 大视频上传、秒开播放与 P2P 协同主链设计

日期：2026-04-16  
状态：Draft  
适用范围：`koko` 当前 `Web 前端 + Rust 后端` 的大视频上传、打包、浏览器正式播放、秒开体验、P2P 分发协同；本稿是简洁粗稿，只裁决主链和轮子边界，不展开实施细节。  

关联文档：

- `docs/superpowers/specs/2026-04-16-本地盘阶段切换tusd承载大视频高吞吐上传-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md`
- `docs/superpowers/specs/2026-04-15-Web群聊视频单一真相与视口自动播-design.md`

官方参考：

- [Uppy Choosing the uploader](https://uppy.io/docs/guides/choosing-uploader/)
- [Uppy Tus](https://uppy.io/docs/tus/)
- [Uppy AWS S3](https://uppy.io/docs/aws-s3/)
- [tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)
- [tusd Configuration](https://tus.github.io/tusd/getting-started/configuration/)
- [HTTP Live Streaming - Apple Developer](https://developer.apple.com/streaming/)
- [DASH-IF IOP v5](https://dashif.org/guidelines/iop-v5/)
- [MSE ISO BMFF Byte Stream Format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)
- [P2P Media Loader Documentation](https://novage.github.io/p2p-media-loader/docs/latest/)
- [WebTorrent Docs](https://webtorrent.io/docs)
- [Video.js](https://videojs.org/index.html)
- [WebRTC Data Channels](https://webrtc.org/getting-started/data-channels)

## 1. 为什么现在要补这一份粗 spec

现在上传主链已经做回来了，但离“群友发完视频，其他人高速边下边播、秒开、还能 P2P 分摊流量”还差最后一层裁决：

1. 哪个轮子负责上传；
2. 哪个轮子负责正式播放；
3. 哪个轮子负责分段 P2P；
4. 哪个轮子负责整文件协作分发；
5. 哪个轮子只是 transport，不许越位成业务真相。

如果这里不先收口，最容易长出四种屎山：

1. `Video.js`、`hls.js`、`WebTorrent` 各自长一套播放判断；
2. `p2p-media-loader` 和 `WebTorrent` 被硬揉成第二个私有分发核心；
3. 上传层、播放层、P2P 层各自偷偷兜底，最后没人说得清主链到底是哪条；
4. 为了“优雅统一”再手搓一层厚上传/播放/P2P 门面。

这份文档只解决一件事：

**把成熟轮子之间的职责边界写死，让它们打配合，而不是互相打架。**

## 2. 当前现场事实

当前仓库已经不是空白状态：

1. 上传主链已经是 `Uppy + @uppy/tus -> tusd -> prepare / complete`；
2. 后端已经能产出视频缩略图、可边下边播的母本、`HLS/DASH` 投影、torrent / web seed 线索；
3. 前端已经有 `Video.js v10` 播放器壳；
4. 前端已经有 `hls.js` provider；
5. 前端已经有 `WebTorrent` 协作分发运行时；
6. `Video.js` 壳上已经给 `p2p-media-loader-hlsjs` 预留了外挂增强点。

所以这次不是“从零选型”，而是：

**在现有轮子已接半截的前提下，裁决谁是正路，谁是增强层，谁只能做侧车。**

## 3. 官方最佳实践给出的硬边界

### 3.1 上传层

Uppy 官方给的路线很清楚：

1. 当前是 `client -> upload server` 时，正路是 `@uppy/tus`；
2. 未来是 `client -> object storage` 时，正路是 `@uppy/aws-s3 multipart`。

所以当前阶段继续 `Tus/tusd` 是对的，未来对象存储成熟后再切 multipart 也是对的。  
本期不应该手搓 multipart，也不应该为了“终局感”提前把当前主链掰成 presign 直传。

### 3.2 浏览器正式播放主链

Apple、DASH-IF、W3C 这三边给出的共同方向是：

1. 浏览器正式流媒体主链应基于 `HLS / DASH`；
2. 分发资产应尽量收口到 `CMAF / fMP4` 分段形态；
3. 浏览器吃的是 `initialization segment + media segments`，不是把整块大 MP4 当唯一高级主链。

所以“发完视频后给群友秒开”的正路，不是把整文件 MP4 / torrent 宗教化，而是：

**上传成功后尽快形成稳定的可播母本和流媒体投影，让浏览器既能走标准流媒体主链，也能继续依赖 P2P 长期活下去。**

### 3.3 浏览器 P2P 层

`p2p-media-loader` 官方文档明确支持把 P2P 挂在：

1. `Hls.js`
2. `Shaka Player`

这说明它的定位是：

**给分段播放引擎做 P2P 增强，而不是替代播放引擎本身。**

这里的“首屏仍可走 HTTP / Web seed，后续 segment 再逐步吃 P2P”是我根据官方集成方式和播放器语义做的工程裁决，不是文档原句；它只回答 `HLS` 这条播放支路该怎么增强，不回答整个群聊视频长期存活问题。

### 3.4 WebTorrent 层

`WebTorrent` 官方文档明确是：

1. 浏览器内基于 `WebRTC`；
2. 通过 `service worker + createServer + file.streamTo(video)` 支持文件流式播放与 seek；
3. 擅长的是 torrent / file / web seed 语义。

这说明它很强，但它强在：

**整文件协作分发、文件级回填、service worker 流式桥接。**

它不是 `HLS/DASH/CMAF` 的官方播放内核，但在 `koko` 这里，`WebTorrent` 必须达到满血状态，成为群聊视频的正式长期协作分发平面，而不是只负责“旁路回填一次”的小配角。

### 3.5 Video.js v10

Video.js 官方当前仍明确挂着 `v10 beta`。  
所以它适合作为：

1. 正式播放器壳；
2. 控件、全屏、交互、皮肤与容器 owner。

但当前不适合让它同时吞掉：

1. HLS 正式播放引擎；
2. P2P 分发内核；
3. 上传或媒体业务真相。

## 4. 最终裁决

当前阶段的浏览器视频正路，统一裁决为：

1. **上传入口**
   - `Uppy + @uppy/tus + tusd`
2. **权威视频资产形成**
   - 后端 `complete`
   - `ffprobe` 探测
   - `Shaka Packager` 产出 `poster + 可边下边播母本 + HLS/DASH 投影`
3. **浏览器正式播放壳**
   - `Video.js v10` 只做播放器壳
4. **浏览器播放源裁决**
   - 优先命中 `WebTorrent / swarm` 可播源
   - 若 swarm 还没热起来，再走 `HLS + hls.js`
   - `DASH` 继续保留为权威投影和未来多端冗余，不在 Web 里搞双入口
   - 任何 HTTP / web seed 都只作为兜底，不提升成长期依赖
4. **浏览器分段 P2P 增强**
   - `p2p-media-loader-hlsjs`
   - 只挂到 `hls.js` provider 上
   - 只增强 `HLS` 支路，不替代长期 swarm 主平面
5. **长期协作分发主平面**
   - `WebTorrent`
   - 正式承担整文件 / blob / swarm / backfill / 做种扩散
   - `24 小时` 内服务器拿着原文件/母本作为临时补种强化节点
   - `24 小时` 后服务器删除原文件和母本，系统转入纯群友互帮互助分发
6. **底层浏览器 P2P transport**
   - `WebRTC`
   - 只做底层传输，不承载产品真相

一句话：

**浏览器正式视频壳仍是 `Video.js`；播放源优先级是“先 swarm、再 HLS、最后兜底 HTTP/web seed”；`WebTorrent` 是正式长期协作分发主平面，`p2p-media-loader-hlsjs` 是 `HLS` 支路增强层。**

## 5. 各个轮子的职责边界

### 5.1 `Uppy + @uppy/tus + tusd`

只负责：

1. 单大文件高吞吐上传；
2. 断点续传；
3. 并行分片 transport；
4. 上传取消与 sidecar 生命周期。

不负责：

1. 播放；
2. 流媒体分发；
3. P2P；
4. 业务 `ready` 真相。

### 5.2 `Shaka Packager + HLS / DASH / CMAF`

只负责：

1. 把权威视频字节变成可边下边播母本与标准流媒体投影；
2. 让浏览器和未来多端都消费标准产物；
3. 给秒开、临时 HLS 支路和后续 P2P 扩散提供统一地基。

不负责：

1. 浏览器 UI；
2. P2P 会话；
3. 上传 transport。

### 5.3 `Video.js v10`

只负责：

1. 唯一正式播放器壳；
2. 控件、全屏、播放器容器、播放会话外观；
3. 壳外 provider 的装配点。

不负责：

1. 决定吃 `HLS` 还是 `WebTorrent`；
2. 决定 P2P 策略；
3. 决定上传和媒体业务真相。

### 5.4 `hls.js`

只负责：

1. Web 端 `HLS` 播放引擎；
2. 驱动分段流媒体读取；
3. 作为 `p2p-media-loader-hlsjs` 的挂接点；
4. 在 swarm 尚未热起来时，承担浏览器标准播放兜底支路。

不负责：

1. 第二套 UI；
2. 产品级 P2P 策略；
3. 业务会话真相。

### 5.5 `p2p-media-loader`

只负责：

1. 给 `hls.js` / `Shaka` 这类流媒体引擎做 segment-level P2P 增强；
2. 在不打断正式播放主链的前提下，分摊后续片段带宽；
3. 增强 `HLS` 支路，不负责长期资产存活。

不负责：

1. 正式播放器壳；
2. 整文件 torrent runtime；
3. 上传；
4. 业务会话真相。

### 5.6 `WebTorrent`

只负责：

1. 整文件级协作分发；
2. swarm 做种与回填；
3. `service worker + streamURL/streamTo` 的文件级浏览器流式桥接；
4. 承担整资产补齐、扩散和长期存活；
5. 在 `24 小时` 冷备窗口内，与服务器补种节点共同强化 swarm；
6. 在 `24 小时` 后接管纯群友互帮互助分发。

不负责：

1. 冒充 `HLS` 引擎本身；
2. 第二套正式播放器 UI；
3. 替代 `p2p-media-loader` 去做分段流媒体增强。

## 6. 秒开、高速边下边播与 24 小时后的长期存活策略

这里必须把“秒开”说成工程裁决，而不是营销话术。

当前阶段的主策略定为：

1. 消息流与查看器先吃稳定 `poster`，立即可见；
2. 正式打开后优先尝试 `WebTorrent / swarm` 可播源；
3. 如果 swarm 启动预算内还没热起来，再走 `HLS + hls.js` 兜底；
4. `24 小时` 冷备窗口内，服务器拿原文件/母本作为临时补种节点，加强 swarm 与 web seed；
5. `p2p-media-loader` 只在 `HLS` 支路上逐步分摊后续 segment 带宽；
6. `WebTorrent` 同时在后台继续补齐完整资产、继续做种、继续扩散；
7. `24 小时` 后服务器删除原文件和母本，后续播放与扩散纯靠群友本地完整资产和在线 swarm；
8. 任一支路失败时，播放器只能降级，不得把业务状态判死。

这条策略的核心不是“永远先打服务器”，而是：

**让秒开稳定，同时让 `WebTorrent/P2P` 真正成为长期主力，而服务器只在前 `24 小时` 扮演补种强化角色。**

## 7. DDD / Unix 裁决

### 7.1 真相 owner

业务真相仍然只有后端掌握：

1. 上传是否成立；
2. 附件何时 `ready`；
3. 哪些流媒体资产是权威资产；
4. 哪些分发线索可以下发给前端。

前端只掌握：

1. 当前播放会话；
2. 当前壳层展示态；
3. 当前浏览器运行时里的 P2P / WebTorrent 会话态。

### 7.2 适配层不得越位

明确禁止：

1. 让 `Video.js` 壳决定媒体真相；
2. 让 `WebTorrent` runtime 决定正式播放主链；
3. 让 `p2p-media-loader` 长成第二个媒体内核；
4. 让前端为上传、播放、P2P 再发明一层“大一统媒体门面”。

## 8. 明确禁止项

这份 spec 先把不能做的事写死：

1. 禁止手搓 uploader；
2. 禁止手搓 multipart；
3. 禁止手搓浏览器流媒体播放内核；
4. 禁止手搓 P2P 媒体引擎；
5. 禁止把 `24 小时` 服务器母本误写成长期优先播放源；
6. 禁止在 Web 同时公开 `HLS` 和 `DASH` 两条正式播放入口；
7. 禁止给消息流再造一份专用 preview video 资产；
8. 禁止把这些成熟轮子外再包一层厚重私有“统一媒体核心”；
9. 禁止把 `WebTorrent` 降级成只负责旁路回填的一次性小能力。

## 9. 粗阶段路线

### 阶段 A：当前落地口径

1. 保持 `Tus/tusd` 上传正路；
2. 保持后端权威产出 `poster + 可播母本 + HLS/DASH`；
3. 浏览器正式播放收口到 `Video.js 壳 + 统一 source resolver`；
4. `p2p-media-loader-hlsjs` 只作为 `HLS` 支路增强点接入；
5. `WebTorrent` 升级成正式长期协作分发平面。

### 阶段 B：当前期望效果

1. 单大视频上传完成后，后端快速形成可播 `HLS`；
2. 群友点开后优先走 swarm，冷启动不够快时再走 `HLS` 秒开；
3. `24 小时` 内服务器临时补种强化 swarm；
4. 完整看过或补齐过的节点继续参与做种和分发；
5. `24 小时` 后服务器删掉原文件和母本，群聊仍靠 swarm 持续高速互帮互助。

### 阶段 C：未来演进

1. 上传层从 `Tus/tusd` 平滑迁到对象存储 multipart；
2. Web 继续保留 `Video.js 壳 + 多源裁决`；
3. `DASH` 继续为多端保留；
4. `WebTorrent/P2P` 继续是长期主分发平面；
5. P2P 层继续复用成熟轮子，不新增私有内核。

## 10. 最终结论

这份粗 spec 最终只裁决六句话：

1. 当前大视频入站正路仍是 `Uppy + @uppy/tus + tusd`；
2. 上传完成后应尽快形成 `poster + 可播母本 + HLS/DASH/CMAF` 资产；
3. Web 正式播放壳仍是 `Video.js v10`，但播放源要先看 swarm，再看 `HLS`；
4. Web 的 `HLS` 支路增强正路是 `p2p-media-loader-hlsjs` 挂到 `hls.js` 上；
5. `WebTorrent` 必须达到满血状态，成为群聊视频的正式长期协作分发主平面；
6. `24 小时` 冷备窗口内服务器只做补种强化，`24 小时` 后系统纯靠群友互帮互助继续播；
7. 整条链必须坚持“不手搓轮子，只保留业务真相和薄适配层”。

一句话收口：

**真正优雅的路线不是让所有轮子互相取代，而是让 `Tus/tusd` 负责把字节先稳稳传上来，让后端把视频做成可播母本与流媒体投影，让 `Video.js` 负责唯一播放壳，让 `hls.js + p2p-media-loader` 负责 `HLS` 支路，让 `WebTorrent` 满血承担长期协作分发，而服务器只在前 `24 小时` 做补种强化。**
