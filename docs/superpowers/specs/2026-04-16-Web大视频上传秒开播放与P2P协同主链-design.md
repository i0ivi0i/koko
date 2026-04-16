# Web 大视频上传、秒开播放与 P2P 协同主链设计

日期：2026-04-16  
状态：Draft  
适用范围：`koko` 当前 `Web 前端 + Rust 后端` 的大视频上传完成后资产形成、浏览器正式播放、秒开体验、`24 小时` 冷备窗口、以及服务器删掉原视频/母本/流媒体产物后的长期协作分发。
文档目标：把当前阶段真正要执行的主链、轮子边界、真相 owner、过期规则和验证门禁一次写清，防止后续实现时再把 `Video.js`、`hls.js`、`p2p-media-loader`、`WebTorrent`、`WebRTC` 混成一锅。

关联文档：

- `docs/superpowers/specs/2026-04-16-本地盘阶段切换tusd承载大视频高吞吐上传-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md`
- `docs/superpowers/specs/2026-04-15-Web群聊视频单一真相与视口自动播-design.md`
- `docs/superpowers/specs/2026-04-16-Tus-Concatenation大视频单文件高吞吐设计.md`

官方参考（2026-04-16 重新核对）：

- [Uppy Choosing the uploader](https://uppy.io/docs/guides/choosing-uploader/)
- [Uppy Tus](https://uppy.io/docs/tus/)
- [Uppy AWS S3](https://uppy.io/docs/aws-s3/)
- [tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)
- [tusd Configuration](https://tus.github.io/tusd/getting-started/configuration/)
- [WebTorrent Docs](https://webtorrent.io/docs)
- [WebTorrent FAQ](https://webtorrent.io/faq)
- [WebRTC Overview](https://webrtc.org/getting-started/overview)
- [WebRTC Data Channels](https://webrtc.org/getting-started/data-channels)
- [MDN StorageManager.persist()](https://developer.mozilla.org/docs/Web/API/StorageManager/persist)
- [MDN Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [HTTP Live Streaming - Apple Developer](https://developer.apple.com/streaming/)
- [DASH-IF IOP v5](https://dashif.org/guidelines/iop-v5/)
- [MSE ISO BMFF Byte Stream Format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)
- [hls.js](https://github.com/video-dev/hls.js)
- [P2P Media Loader Documentation](https://novage.github.io/p2p-media-loader/docs/latest/)
- [Video.js v10 beta blog](https://videojs.org/blog/videojs-v10-beta-hello-world-again)
- [Video.js v10 overview](https://videojs.org/docs/framework/react/concepts/overview)
- [Video.js HTML player container](https://videojs.org/docs/framework/html/reference/player-container)
- [Video.js v10 roadmap](https://videojs.org/docs/framework/react/concepts/v10-roadmap)

## 1. 这份 spec 真正要解决什么

这次不是普通的“播放器优化”或“P2P 再补一点”。

主人已经把目标说得很硬：

**就算服务器里已经没有了原视频和母本，群友们依然可以高速播放视频、高速边下边播、同时继续高速互帮互助。**

这句话的含义不是：

1. 服务器流量少一点；
2. 首屏多一点 P2P 命中率；
3. `p2p-media-loader` 接上去看起来更先进。

它真正要求的是：

1. 上传成功后，系统要形成一套**能长期协作分发**的权威资产；
2. `24 小时` 内服务器可以辅助冷启动和补种；
3. `24 小时` 后服务器要能删掉原视频、服务端规范化母本副本、`HLS/DASH manifest + segments`；
4. 删除之后系统仍主要靠**群友浏览器里保留下来的完整资产**和在线 swarm 继续活；
5. 如果没有足够完整 peer，内容允许自然死亡；
6. 这不是 bug，而是正式产品语义。

如果不先把这条主链写死，最容易长出五种屎山：

1. `Video.js`、`hls.js`、`WebTorrent` 各自长一套播放判断；
2. `p2p-media-loader` 和 `WebTorrent` 被硬揉成第二个私有分发核心；
3. 上传层、流媒体层、P2P 层各自偷偷兜底，最后没人能说清楚谁是长期 owner；
4. 以为“浏览器缓存里可能还留着段文件”就等于长期存活方案已经成立；
5. 为了“统一”，再手搓一层私有上传/播放/P2P 门面，把成熟轮子全包坏。

所以这份 spec 只做一件事：

**把当前阶段的主链、资产、轮子边界、过期规则和验证门禁写死，让后续实现不再漂。**

## 2. 当前现场事实

当前仓库已经不是空白状态：

1. 上传主链已经是 `Uppy + @uppy/tus -> tusd -> prepare / hook / complete`；
2. 后端已经能在 `complete` 后产出：
   - 静态封面；
   - mezzanine / 可边下边播母本；
   - `HLS/DASH` 投影；
   - torrent / web seed 线索；
3. 前端已经有 `Video.js v10` 播放器壳；
4. 前端已经有 `hls.js` provider；
5. 前端已经有 `WebTorrent` 协作分发运行时；
6. `Video.js` 壳上已经给 `p2p-media-loader-hlsjs` 预留了外挂增强点；
7. 测试里已经开始出现：
   - `preview_asset`
   - `streaming_video media_asset`
   - `mezzanine`
   - `HLS/DASH` 受控路由
   - `swarm_id / announce / web_seed`

也就是说，现在不是“从零选型”，而是：

**在已有链路已接半截的前提下，把谁是正式主路、谁是短期增强、谁是长期 owner 一次裁决清楚。**

## 3. 官方资料给出的硬边界

### 3.1 上传层：当前继续 `Tus/tusd`，未来对象存储再切 multipart

Uppy 官方路线非常清楚：

1. 当前 `client -> upload server` 正路是 `@uppy/tus`；
2. 未来 `client -> object storage` 正路是 `@uppy/aws-s3 multipart`。

所以当前阶段继续 `Uppy + @uppy/tus + tusd` 是正路。
本期不应该：

1. 手搓 multipart；
2. 提前为了“终局感”把当前主链掰成 presign 直传；
3. 把 transport 成功误写成业务 ready。

### 3.2 浏览器标准播放主链：`HLS / DASH / CMAF / fMP4`

Apple、DASH-IF、W3C 这三边给出的共同方向是一致的：

1. 浏览器正式流媒体主链应基于 `HLS / DASH`；
2. 分发资产应收口到 `CMAF / fMP4` 分段形态；
3. 浏览器真正吃的是 `initialization segment + media segments`，不是把整块大 MP4 当唯一高级主路。

这意味着：

1. 秒开、标准播放器兼容、ABR，这条线最正的路仍是 `HLS/DASH/CMAF`；
2. 但这条线本身并不等于“服务器删光后仍能长期活”；
3. 如果 `24 小时` 后连 `manifest + segments` 都删掉，`HLS/DASH` 就正式退出长期平面。

### 3.3 `p2p-media-loader`：分段级增强层，不是长期 owner

`p2p-media-loader` 官方最新文档明确支持：

1. `Hls.js`
2. `Shaka Player`

官方集成心智也非常明确：

1. 挂到既有 streaming engine 上；
2. 增强 segment 读取与 peer 分摊；
3. 不自带播放器壳；
4. 不自带长期资产平面。

所以它的正确定位是：

**只增强 `HLS/DASH` 支路的 segment-level P2P，不承担 `24 小时` 后的长期资产存活。**

### 3.4 `WebTorrent`：whole-file swarm 才是删源后的长期平面

`WebTorrent` 官方文档和 FAQ 给出的事实很硬：

1. 浏览器里基于 `WebRTC`；
2. 支持 `createServer() + streamTo() / streamURL()`；
3. 默认支持顺序流式播放；
4. 默认支持做种；
5. 浏览器侧只会从 `WebRTC-capable` peers 下载；
6. 它不是 live streaming 内核。

这说明它强在：

1. 整文件协作分发；
2. 文件级回填；
3. 本地完整资产保留；
4. 服务器删源后的继续存活。

也就是说，在 `koko` 这里：

**`WebTorrent` 必须达到满血状态，成为 `24 小时` 后继续活着的正式长期协作分发主平面。**

### 3.5 `WebRTC`：只是 transport，不是产品真相

WebRTC 官方资料只回答：

1. peer connection；
2. data channel；
3. 任意数据 transport。

它不回答：

1. 媒体主链；
2. 资产生命周期；
3. 播放器 source owner；
4. `24 小时` 规则。

所以：

**`WebRTC` 只做底层 transport，不承载产品真相。**

### 3.6 `Video.js v10`：当前仍是 beta，只做唯一播放器壳

Video.js 官方当前仍明确把 `v10` 定位成 beta，roadmap 也写明：

1. API 仍可能变化；
2. 当前适合 experimental adoption；
3. 可与既有 streaming engines 一起工作；
4. `media-container` 负责 layout / fullscreen / interaction surface；
5. provider 负责 media attach / discovery。

这意味着对 `koko` 当前阶段，最稳的判断仍然是：

1. `Video.js v10` 只做唯一播放器壳；
2. 不吞 `hls.js`；
3. 不吞 `WebTorrent`；
4. 不吞业务真相和 source owner。

## 4. 当前阶段最终裁决

### 4.1 一句话版

**当前阶段采用“双平面 + 24 小时切换”路线：**

- `0-24 小时`：服务器暂存 `poster + 服务端规范化 mezzanine + HLS/DASH/CMAF + Web Seed + tracker/bootstrap`，播放时 aggressively 抢 swarm，同时用标准流媒体保证秒开；
- `24 小时` 后：删除原视频、服务端 mezzanine 副本、`HLS/DASH manifest + segments`，服务器退出长期媒体分发，系统正式只靠群友浏览器里保留下来的完整资产和在线 swarm 继续活；
- 长期正式主平面只有 `WebTorrent`；
- `p2p-media-loader` 长期保留在系统里，但只作为 `HLS` 支路增强能力，不承担删源后的长期正式存活。

### 4.2 为什么不是“`HLS` 和 `WebTorrent` 都长期当正式平面”

这是本次最容易漂的点，必须讲清楚。

主人已经接受：

1. `24 小时` 后服务器可以删掉原视频和服务端规范化母本副本；
2. 也接受一起删掉 `HLS/DASH manifest + segments`；
3. 也接受如果没有足够完整 peer，内容可以自然死亡。

在这个前提下：

1. `HLS/DASH` 这条平面在 `24 小时` 后已经没有权威服务端资产；
2. `p2p-media-loader` 只增强 streaming segments，本身不是长期 asset plane；
3. 浏览器里即便残留了一些 `HLS` 缓存，也只是 best-effort，不足以升级成正式长期主链；
4. 真正能稳稳接住“服务器删源后继续活”的，只能是保留了完整资产的 `WebTorrent` swarm。

所以，工程判断必须写硬：

**两者都长期保留在系统里，但删源后的长期正式平面只有 `WebTorrent`。**

## 5. `complete` 后的权威资产形成

### 5.1 `complete` 是唯一资产形成入口

必须明确：

1. transport 成功 != 业务 ready；
2. hook 到达 != 业务 ready；
3. 文件落盘 != 业务 ready；
4. 只有 `complete` 成功，才代表附件业务上真正升级成 `ready`，并形成权威资产。

### 5.2 `complete` 后必须同时形成四类权威资产

#### 1. `preview_asset`

职责：

1. 给消息流和查看器未打开态直接吃静态封面；
2. 让晚进群和历史恢复不再临时抠首帧；
3. 成为 `snapshot / locator / complete response` 的共享真相。

#### 2. `mezzanine`

职责：

1. 成为当前阶段 whole-file 正式权威字节形态；
2. 适合 seek、适合流式读取、适合 `WebTorrent` 分发；
3. 在 `0-24 小时` 内由服务端暂存，用来生成 `HLS/DASH`、web seed 和冷启动强化；
4. 在 `24 小时` 后继续以统一字节身份存在于 peer 侧持久化存储和 swarm 中。

这里要特别写死：

**长期要活的不是用户原片，也不是服务器里永久留着一份母本文件，而是系统裁决后的 mezzanine 字节身份；服务端副本只在冷备窗口内存在。**

#### 3. `HLS/DASH/CMAF`

职责：

1. 只服务 `24 小时` 冷备窗口内的标准流媒体秒开和平滑播放；
2. 给 `hls.js + p2p-media-loader` 提供标准播放和分段增强地基；
3. 不承担删源后的长期正式平面。

#### 4. `distribution metadata`

最少应包含：

1. `swarm_id`
2. `torrent metainfo`
3. `announce_urls`
4. `web_seed_url`
5. 可用性 / 冷备窗口线索

这些是后续 source resolver 和 swarm runtime 的权威输入，不应该让前端自己脑补。

### 5.3 原视频、mezzanine、流媒体产物的语义必须分清

#### 用户原片

定位：

1. 只在上传完成到系统产出权威资产前短暂存在；
2. 一旦 `complete` 成功，应尽快退场；
3. 不再承担长期正式读取语义。

#### mezzanine

定位：

1. 当前阶段 whole-file 正式权威资产形态；
2. `WebTorrent` 长期主平面的字节基础；
3. `0-24 小时` 内服务端有一份规范化副本，`24 小时` 后删除服务端副本；
4. 服务端删副本后，群友间继续互帮互助依赖的是同一份规范化完整字节在 peer 侧的持有和做种。

#### `HLS/DASH/CMAF`

定位：

1. `0-24 小时` 秒开和平滑播放资产；
2. `24 小时` 后正式删除；
3. 不允许悄悄活成第二长期主链。

### 5.4 过期和删除必须写成真相字段

至少要有明确的权威时间锚点：

1. `origin_expires_at`
2. `origin_deleted_at`
3. `streaming_expires_at`
4. `streaming_deleted_at`
5. `mezzanine_expires_at`
6. `mezzanine_deleted_at`
7. `survival_mode = peer_only_after_expiry`

没有这些权威字段，后面就只能靠脚本习惯和人的默契，迟早漂。

## 6. 播放源裁决与 `24 小时` 切换规则

### 6.1 默认态永远先吃 `poster`

消息流、查看器关闭态、首次打开前，永远先显示 `poster`。
不要把冷启动细节、swarm 预热细节、`HLS` 初次 attach 细节直接暴露给用户。

### 6.2 正式打开时，同时预热两条链，但只允许一个 winner

当前阶段建议规则：

1. 打开播放器时立即启动 `WebTorrent` acquire / attach / 本地完整资产探测 / swarm 预热；
2. 同时开始 `HLS manifest` 预热；
3. 如果 swarm 在很短预算内已经可播，就直接走 `WebTorrent`；
4. 如果 swarm 还没热起来，就立刻让 `HLS + hls.js` 顶上。

这里最重要的约束不是“谁更高贵”，而是：

**冷启动可以并行预热，但正式播放只能有一个 source owner 做一次裁决。**

### 6.3 已经稳定走了 `HLS` 的会话，不为了“更 P2P”中途硬切回 `WebTorrent`

当前阶段明确不建议：

1. 播着播着从 `HLS` 强切到 `WebTorrent`；
2. 为了追求“全 P2P”而在同一会话里乱切源。

原因很直接：

1. 这最容易把时间线、seek、音轨、字幕、controls、恢复态打坏；
2. 也最容易让 `Video.js`、`hls.js`、`WebTorrent` 再次互相越位。

当前阶段更稳的裁决是：

1. 本次会话已经稳定进了 `HLS`，就让 `HLS` 播到底；
2. `p2p-media-loader` 继续分摊 segment；
3. `WebTorrent` 在后台继续 backfill 完整资产、继续做种；
4. 下一次打开或恢复时，再优先命中 `WebTorrent`。

### 6.4 `0-24 小时` 内，服务器只是冷启动强化节点

在窗口内允许：

1. `HLS/DASH/CMAF` 秒开；
2. `Web Seed` 辅助 whole-file 冷启动；
3. tracker/bootstrap 帮 swarm 热起来。

但必须明确：

1. 这些都只是强化，不是长期 owner；
2. 不能写成“服务器优先播放源”；
3. 不能让 `HLS` 在语义上偷偷升级成长期主平面。

### 6.5 `24 小时` 后的正式语义

一旦过了 `24 小时`：

1. 删除原视频；
2. 删除服务端 mezzanine 副本；
3. 删除 `HLS/DASH manifest + segments`；
4. 服务器退出长期媒体分发。

之后的正式播放规则就只剩：

1. 有本地完整资产或在线完整 peer：继续高速播放、继续高速互帮互助；
2. 没有足够完整 peer：等待，或者自然死亡；
3. 不再偷偷退回服务器 `HLS` 主链。

## 7. 各个轮子的职责边界

### 7.1 `Uppy + @uppy/tus + tusd`

只负责：

1. 单大文件高吞吐上传；
2. 断点续传；
3. 并行分片 transport；
4. 上传 sidecar 生命周期。

不负责：

1. 播放；
2. 流媒体分发；
3. P2P；
4. 业务 `ready` 真相。

### 7.2 `Shaka Packager + HLS / DASH / CMAF`

只负责：

1. 把权威视频字节变成 mezzanine 与标准流媒体投影；
2. 为 `0-24 小时` 秒开提供标准资产；
3. 为 `HLS` 支路增强提供统一地基。

不负责：

1. 浏览器 UI；
2. 长期 swarm 会话；
3. 上传 transport。

### 7.3 `Video.js v10`

只负责：

1. 唯一正式播放器壳；
2. 控件、全屏、播放器容器、播放会话外观；
3. provider 装配点。

不负责：

1. 决定吃 `HLS` 还是 `WebTorrent`；
2. 决定长期存活策略；
3. 决定业务 ready / expiry / distribution 真相。

### 7.4 `hls.js`

只负责：

1. Web 端 `HLS` 播放引擎；
2. 驱动标准流媒体读取；
3. 作为 `p2p-media-loader-hlsjs` 的挂接点；
4. 在 swarm 还没热起来时承担标准播放秒开支路。

不负责：

1. 第二套 UI；
2. 长期 whole-file 平面；
3. 业务会话真相。

### 7.5 `p2p-media-loader`

只负责：

1. 给 `hls.js / Shaka` 做 segment-level P2P 增强；
2. 在不打断正式播放主链的前提下分摊后续 segment 带宽；
3. 长期保留在系统里作为 `HLS` 支路增强能力。

不负责：

1. `24 小时` 后的长期正式存活平面；
2. whole-file backfill；
3. 正式播放器壳；
4. 业务会话真相。

### 7.6 `WebTorrent`

只负责：

1. 整文件级协作分发；
2. swarm 做种与回填；
3. `service worker + streamURL/streamTo` 的文件级浏览器流式桥接；
4. 承担整资产补齐、扩散和删源后的长期存活；
5. 在 `24 小时` 冷备窗口内，与服务器补种节点共同强化 swarm；
6. 在 `24 小时` 后接管正式长期协作分发。

不负责：

1. 冒充 `HLS` 引擎；
2. 第二套正式播放器 UI；
3. 替代 `p2p-media-loader` 去做分段流媒体增强。

### 7.7 `WebRTC`

只负责：

1. peer 连接；
2. data transport；
3. 运行时网络链路。

不负责：

1. 媒体主链；
2. 业务真相；
3. 资产生命周期；
4. 播放器 source owner。

## 8. DDD / Unix 裁决

### 8.1 真相 owner

业务真相仍然只有后端掌握：

1. 上传是否成立；
2. 附件何时 `ready`；
3. 哪些资产是权威资产；
4. 哪些分发线索可以下发；
5. `24 小时` 何时到期；
6. 哪些资产该删，哪些资产要长期保留。

前端只掌握：

1. 当前播放会话；
2. 当前壳层展示态；
3. 当前浏览器运行时里的 `WebTorrent / p2p-media-loader` 会话态。

### 8.2 适配层不得越位

明确禁止：

1. 让 `Video.js` 壳决定媒体真相；
2. 让 `WebTorrent` runtime 决定业务 ready；
3. 让 `p2p-media-loader` 长成第二个媒体内核；
4. 让前端再发明一层“大一统媒体门面”。

### 8.3 不要把浏览器持久化缓存误写成正式长期真相

这里要写得很克制：

1. 浏览器持久化缓存是重要能力；
2. 但按 MDN 当前口径，默认很多存储仍是 best-effort；只有拿到 `navigator.storage.persist()` 授权后，才更接近“除非用户主动清理，否则不被常规压力回收”；
3. 即便如此，它仍受浏览器配额、用户清理和设备策略影响，不是绝对承诺；
4. 它的正确价值是帮助 `WebTorrent` 继续 serving / seeding；
5. 不能因此把“残留的 `HLS` 段缓存”误升级成删源后的正式长期平面。

## 9. 明确禁止项

这份 spec 先把不能做的事写死：

1. 禁止手搓 uploader；
2. 禁止手搓 multipart；
3. 禁止手搓浏览器流媒体播放内核；
4. 禁止手搓 P2P 媒体引擎；
5. 禁止把 `24 小时` 服务器冷备写成长期优先播放源；
6. 禁止在 Web 同时公开 `HLS` 和 `DASH` 两条正式播放入口；
7. 禁止给消息流再造一份专用 preview video 资产；
8. 禁止把这些成熟轮子外再包一层厚重私有“统一媒体核心”；
9. 禁止把 `WebTorrent` 降级成只负责旁路回填的一次性小能力；
10. 禁止把 `p2p-media-loader` 升级成删源后的长期正式平面；
11. 禁止让 `HLS` 在 `24 小时` 后偷偷继续活成第二长期主链；
12. 禁止因为“浏览器缓存里可能还留着段文件”就宣称 `HLS` 长期方案已经成立。

## 10. 先锁的测试不变量

当前阶段最先要锁住的，不是 UI 漂亮不漂亮，而是下面这些硬不变量：

1. `complete` 成功才会把附件升级成 `ready`；
2. `complete` 后会直接返回 `preview_asset`；
3. `complete` 后会返回稳定的 `streaming_video media_asset`；
4. `complete` 后会形成稳定 mezzanine；
5. `complete` 后 `HLS master / child playlist / DASH MPD` 都走受控媒体路由；
6. `complete` 后会返回稳定的 `swarm_id / announce / web_seed`；
7. `origin` 只退到冷备描述，不再冒充正式主链；
8. `24 小时` 到期后删掉原视频、服务端 mezzanine 副本和 `HLS/DASH` 资产，只保留 peer 侧继续存活语义；
9. 没有完整 peer 时内容允许自然死亡；
10. 迟到 hook / old session / old capability 不能复活当前业务状态。

## 11. 粗阶段路线

### 阶段 A：当前落地口径

1. 保持 `Uppy + @uppy/tus + tusd` 上传正路；
2. 让后端 `complete` 一次性形成：
   - `preview_asset`
   - mezzanine
   - `HLS/DASH/CMAF`
   - distribution metadata
3. 浏览器正式播放收口到 `Video.js 壳 + 统一 source resolver`；
4. `p2p-media-loader-hlsjs` 只作为 `HLS` 支路增强点接入；
5. `WebTorrent` 升级成删源后的正式长期协作分发平面。

### 阶段 B：当前期望效果

1. 单大视频上传完成后，后端快速形成可播 `HLS`；
2. 群友点开后 aggressively 抢 swarm，冷启动不够快时再走 `HLS` 秒开；
3. 播放过程中后台尽快补齐完整资产；
4. 完整看过或补齐过的节点继续参与做种和分发；
5. `24 小时` 后服务器删掉原视频、服务端 mezzanine 副本和 `HLS/DASH` 产物，群聊仍靠 swarm 持续高速互帮互助。

### 阶段 C：未来演进

1. 上传层从 `Tus/tusd` 平滑迁到对象存储 multipart；
2. Web 继续保留 `Video.js 壳 + 多源裁决`；
3. `DASH` 继续为多端保留；
4. `WebTorrent` 继续是删源后的长期主分发平面；
5. `p2p-media-loader` 继续作为 `HLS` 支路长期增强能力存在，但不扩权成长期 owner。

## 12. 最终结论

这份 spec 最终只裁决七句话：

1. 当前大视频入站正路仍是 `Uppy + @uppy/tus + tusd`；
2. 上传完成后应尽快形成 `preview_asset + mezzanine + HLS/DASH/CMAF + distribution metadata`；
3. `0-24 小时` 内服务器保留标准流媒体和补种能力，用来保证秒开与强化 swarm；
4. `24 小时` 后删除原视频、服务端 mezzanine 副本、`HLS/DASH manifest + segments`，服务器退出长期媒体分发；
5. 删源后的长期正式平面只有 `WebTorrent`，它必须满血承担继续播放、继续分发和继续互帮互助；
6. `p2p-media-loader-hlsjs` 长期保留，但只作为 `HLS` 支路增强层，不承担删源后的长期正式平面；
7. `Video.js v10` 只做唯一播放器壳；整条链必须坚持“不手搓轮子，只保留业务真相和薄适配层”。

一句话收口：

**真正优雅的路线不是让所有轮子互相取代，而是让 `Tus/tusd` 把字节稳稳传上来，让 `complete` 形成 `preview_asset + mezzanine + HLS/DASH/CMAF + swarm clues`，让服务端只在前 `24 小时` 暂存规范化完整字节并做冷启动强化，让 `Video.js` 负责唯一播放壳，让 `hls.js + p2p-media-loader` 负责前 `24 小时` 的标准流媒体秒开与分段增强，让 `WebTorrent` 满血承担删源后的长期协作分发。**
