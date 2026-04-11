# 2026-04-11 群聊媒体 WebTorrent 协作分发官方实践清单

适用范围：`koko` 的群聊图片、视频，以及后续普通文件的协作分发主链。  
目标：把 `WebTorrent`、`bittorrent-tracker`、`wt-tracker`、`Web Seed`、浏览器后台与持久化的官方建议收成一张能直接指导实现的清单，避免后面手搓 tracker、手搓 range 服务、手搓第二套私有协议。

## 1. 先说结论

这一轮最该记死的结论有六条：

1. 浏览器侧 canonical 客户端继续固定为 `webtorrent`，不自研第二套 P2P 核心。
2. 私有 tracker 第一阶段继续优先 `bittorrent-tracker`，高负载瓶颈再看 `wt-tracker`，不双活。
3. 24 小时保底源应该老老实实走 `Web Seed` 标准，不手搓自定义分块 API。
4. 视频播放不要手搓 range 服务，优先站在 `client.createServer() + file.streamURL / file.streamTo()` 上；图片和普通文件可以继续吃统一的 `src` 抽象。
5. 浏览器第一版的真实目标只能是“在就传，刷新尽量续，关页就停”，不要吹成“纯浏览器永久保种”。
6. 将来要严门禁时，优先利用 tracker 现成的 announce 自定义参数和服务端过滤能力，不要另发明一条私有握手协议。

## 2. 官方资料里最关键的事实

### 2.1 `WebTorrent` 已经把客户端核心 API 准备好了

`WebTorrent` 官方文档对 `client.add()` 明确给了这些我们直接会用到的选项：

- `announce`：tracker 列表
- `getAnnounceOpts`：每次 announce 时带自定义参数
- `urlList`：`Web Seed` 列表
- `maxWebConns`：每个 Web Seed 的最大并发连接数，默认 `4`
- `private`：开启后不会把 hash 分享给 DHT 和 PEX
- `store` / `destroyStoreOnDestroy` / `storeCacheSlots`：本地 piece 存储相关能力
- `strategy`：`rarest` 或 `sequential`

这说明：

1. 我们不需要再包一层“私有 swarm 客户端核心”。
2. 以后要接短期 ticket，可以先走 `getAnnounceOpts` 这条官方路。
3. 24 小时保底源直接用 `urlList` 就行，不需要再造“媒体补块协议”。
4. 私有群聊 swarm 至少要把 `announce`、`private`、`urlList` 收成后端权威返回，而不是让前端各算各的。

另外官方文档还明确写了：

- 下载中的 torrent 默认会自动继续做种。
- 浏览器侧如果不想跨会话保留数据，必须在页面关闭前主动销毁 store。

这两句合在一起的真实含义是：

1. “看过后默认帮传”本身就是 `WebTorrent` 的自然路径，不用自己发明上传状态机。
2. “刷新尽量续”可以建立在现成 store 能力上先做 best-effort，不必第一刀就手搓自定义 chunk store。

来源：

- <https://webtorrent.io/docs>

### 2.2 `WebTorrent` 官方对视频播放的推荐不是“自己拼 Range”

官方文档给出的浏览器示例是：

1. 注册 service worker
2. `client.createServer({ controller })`
3. 用 `file.streamTo()` 或 `file.streamURL`

官方还单独写明：

- `file.blob()` 适合生成 `Blob URL`
- `file.streamTo()` / `file.streamURL` 需要先 `createServer()`
- `streamTo()` / `streamURL` 支持流式播放、seeking，以及浏览器原生容器/编解码器能力

这给 `koko` 的直接启发是：

1. 视频不要手搓 range server。
2. 图片、普通文件如果只是展示或下载，`Blob URL` 就够用。
3. 视频如果要保留“点开就能播、拖进度条还能工作”的体验，应该优先吃 `streamURL` 这一类官方能力。

来源：

- <https://webtorrent.io/docs>
- <https://webtorrent.io/faq>

### 2.3 浏览器 WebTorrent 不是“随便一个 BT peer 都能连”

`WebTorrent` FAQ 写得很直白：

- 浏览器里的 `WebTorrent` 只能下载由 **支持 WebRTC 的 peer** 做种的 torrent。
- 浏览器 peer 之间走的是 `WebRTC`，不是普通 TCP/uTP。

这意味着：

1. 不能想当然地拿普通 BT 客户端来给浏览器群友供种。
2. 如果后面要补 Node 侧强 peer，就要确认它能给 WebRTC peers 做种。
3. tracker 也必须是能服务 WebTorrent/WebRTC 的那一类，不是随便一个传统 tracker 就行。

来源：

- <https://webtorrent.io/faq>

### 2.4 `WebTorrent` 维护者的设计口径本身就反对“再造一个新协议”

`WebTorrent` FAQ 对自己的设计理由讲得很清楚：

- 它没有另造一套全新协议，而是继续站在 BitTorrent 线上，只是把浏览器侧的连接方式换成 `WebRTC`。
- 维护者明确说过：重新发明协议会把项目拖进巨大兔子洞。

这对 `koko` 的价值非常直接：

1. 我们现在真正该做的是“把业务边界挂到成熟协议上”，不是再自研协议核心。
2. swarm 的 wire protocol、piece 交换、WebRTC 建连、Web Seed 支持，都应该继续交给成熟实现。

来源：

- <https://webtorrent.io/faq>

### 2.5 `bittorrent-tracker` 已经给了后续私有门禁需要的挂点

`bittorrent-tracker` 官方 README 里有两件事特别关键：

1. 客户端侧有 `getAnnounceOpts()`，可以在 announce 里带自定义参数。
2. 服务端侧有 `filter(infoHash, params, cb)`，可以基于原始参数做允许/拒绝判断，还明确提到了 private tracker 场景。

README 同时还写明：

- 它支持 `HTTP / UDP / WebSocket` tracker。
- `ws` 是内置能力。
- 可以通过 `/stats` 或 `/stats.json` 看统计。
- CLI 有 `--interval` 和 `--trust-proxy` 等现成参数。
- README 也明确给了 `import Server from 'bittorrent-tracker/server'` 这个官方子入口。

这说明：

1. 将来严门禁时，优先把短期 ticket 放进 announce 参数，再在服务端 `filter()` 里校验。
2. 没必要再发明“tracker 前先打一个私有握手 socket”的第二协议。
3. 第一版浏览器 swarm 至少要有 `ws / wss`，`udp` 可以等后面真有原生客户端再说。
4. 当前 Win11 + Node 25 开发机上，如果官方 CLI 先把 client/node-datachannel 一并拖进来，优先改用官方 `server` 子入口，不要为了 CLI 坏掉就手搓 tracker。

来源：

- <https://github.com/webtorrent/bittorrent-tracker>

### 2.6 `wt-tracker` 的定位就是“高性能 WebTorrent tracker”

`wt-tracker` README 给出的定位非常直接：

- 它就是高性能 `WebTorrent tracker`
- README 直接给了量级参考：`2 GiB / 1 vCPU` 的 VPS 可承受大量 `WSS` peers
- 它还给出了 `maxConnections`、`maxOffers`、`announceInterval` 等配置项

这意味着：

1. 它很像样，但它的价值点是“吞吐升级”，不是“第一阶段边界更稳”。
2. 所以它更适合作为第二选择，不适合和 `bittorrent-tracker` 一起双活上场。

来源：

- <https://github.com/Novage/wt-tracker>

### 2.7 `Web Seed` 标准本来就是给“HTTP 兜底源”准备的

BitTorrent 官方 `BEP 19` 说得很明白：

- `Web Seed` 就是把 `HTTP/FTP` 服务器当成 torrent 的种子源。
- 它的好处之一就是：总有一个不 choke 的兜底 seed 可以让人起步。
- 它不需要改 tracker，也不需要让 HTTP 服务器懂 BitTorrent。
- `url-list` 在 metadata 里是可忽略扩展；不支持的客户端可以无视它。

这对 `koko` 的实际含义是：

1. 24 小时保底源完全可以继续用普通 HTTP 服务承载。
2. 不需要为了“像 P2P 一点”去手写一个私有分块接口。
3. 服务器的角色就是兜底和冷启动，不是再变回长期主仓库。

来源：

- <https://www.bittorrent.org/beps/bep_0019.html>

### 2.8 官方也承认“顺序播放”和“网络健康”之间需要平衡

`WebTorrent` FAQ 提到：

- 纯 BitTorrent 倾向 `rarest-first`
- `WebTorrent` 支持“按顺序播放”
- 但当缓冲足够后，应当回到更健康的选择策略
- 在现实网络里，用户往往会比真正看完媒体更早把文件下满，所以通常还是有不少时间在做种

这对 `koko` 的直接约束是：

1. 不能把第一版做成“只按观看进度懒加载”的播放器。
2. 一旦开始查看，就该尽快把整个附件补齐并持续参与分发。
3. 播放体验只是表面，后台补齐整文件才是协作分发的真正目标。

来源：

- <https://webtorrent.io/faq>

### 2.9 浏览器后台限制是真的，但 WebRTC / WebSocket 不在最差那档

MDN 在 `Page Visibility API` 页面里明确写了：

- 后台标签页的 `setTimeout` 等 timer 会被节流
- 但使用实时网络连接的代码，如 `WebSockets` 和 `WebRTC`，属于不被这类节流直接掐掉的例外

这意味着：

1. “切后台就立刻死掉”不是准确心智。
2. 但也不能把后台标签页当成稳定 seedbox。
3. 所以第一版目标定成“在就传，刷新尽量续，关页就停”是诚实的，不是保守过头。

来源：

- <https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>

### 2.10 浏览器持久化只能争取，不能命令

MDN 的 `StorageManager.persist()` 明确说明：

- 这是向浏览器请求持久化存储
- 浏览器可能同意，也可能拒绝
- 如果没拿到，存储在压力下可能被清掉
- 它还要求安全上下文（HTTPS）

这说明：

1. “刷新尽量续”可以主动争取，但不能承诺成绝对真相。
2. 第一版不该把成败押在一套复杂的自研持久化层上。
3. 最合理的路线是：先站在 `WebTorrent` 现成 store 上，再 opportunistic 地请求持久化。

来源：

- <https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist>

### 2.11 `service worker` 的 scope 不是想写多大就多大

MDN 对 `navigator.serviceWorker.register()` 写得很明确：

- 默认 `scope` 是 `service worker` 脚本所在目录。
- 如果你想让 scope 超出脚本所在目录，服务端必须回 `Service-Worker-Allowed` 响应头。
- `register()` 可以重复调用；如果 scope 和脚本没变，浏览器会把它当更新检查，而不是重复装一份新的注册。

这三句对 `koko` 的现实意义非常大：

1. 如果 `sw.js` 只放在 `/dist/sw.js`，默认 scope 就只是 `/dist/`，管不到首页和房间页。
2. 所以 `Phase 2` 要么把 `sw.js` 暴露在站点根路径，比如 `/sw.js`；要么继续放在 `/dist`，但必须给这个脚本加 `Service-Worker-Allowed: /`。
3. `register()` 可以放在壳层启动时执行，但如果担心每次都多打一趟请求，可以先用 `getRegistration()` 再决定是否显式更新。

来源：

- <https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register>
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker-Allowed>

### 2.12 `WebTorrent` 官方对浏览器打包的口径比“直接 npm import 一切都行”更克制

`WebTorrent` README 公开写了几种浏览器侧路径：

- 直接用预构建脚本
- 用 `browserify`
- 用 `webpack`，但要额外配置
- 或者直接 `import WebTorrent from 'webtorrent/dist/webtorrent.min.js'`，跳过 bundler 配置

这对 `koko` 的真正提醒是：

1. 当前前端是 `esbuild`，不是官方文档重点覆盖的那几条 bundler 路。
2. 所以 `Phase 2` 最稳的做法，不是先去手搓一轮 `Node builtin polyfill` 和 bundler 黑魔法。
3. 更像样的第一选择，是优先评估官方预构建入口 `webtorrent/dist/webtorrent.min.js` 能不能直接接进现有前端构建。

这里不是说 `esbuild` 一定不行，  
而是说：**在没有证据前，不要为了“更工程化”先去发明一套打包兼容层。**

来源：

- <https://github.com/webtorrent/webtorrent>

### 2.13 Rust 侧 metainfo 生成也要先站成熟轮子，不要手搓

我额外查了几个 Rust 侧候选，结论很现实：

- `lava_torrent` 文档明确写了：**目前不建议用于 critical system**
- `cratetorrent` 文档明确写了：当前状态更像 **toy program**
- `librqbit` 文档则明确把自己描述成：**fully featured, easy to use torrent downloading library**，并公开暴露了 `create_torrent`
- `librqbit` 本地 crate 源码也能直接看到：`src/lib.rs` re-export 了 `create_torrent` 和 `CreateTorrentOptions`，`create_torrent_file.rs` 的结果对象还能直接拿 `info_hash()` 和 `as_bytes()`
- `bip_metainfo` 至少明确支持从目录或内存数据构建 metainfo，但公开文档更偏基础 builder，不像 `librqbit` 那样还在持续作为完整客户端骨架使用
- `bip_metainfo` 本地 examples / lib 也能直接看到：`MetainfoBuilder::new().build(...)` 可以产出 metainfo bytes，`DirectAccessor::new(...)` 能从内存字节构建，之后用 `Metainfo::from_bytes(...).info().info_hash()` 取 `info_hash`

这对 `koko` 的意义很直接：

1. `Phase 2` 如果真要在 Rust 后端稳定产出 metainfo，先看 `librqbit::create_torrent` 这一类还在真实客户端里活着的轮子。
2. `librqbit` 的优势是“更接近完整客户端骨架，API 也更直接”；`bip_metainfo` 的优势是“builder 更薄、更聚焦 metainfo 本身”。
3. `lava_torrent` 和 `cratetorrent` 这些带明显 caveat 的轮子，不该在没有充分理由时直接进主链。
4. 退一步，就算最终没选 `librqbit`，也应该先做“成熟轮子比较 + 最小验证”，而不是自己手搓 `.torrent` 和 `info_hash`。

来源：

- <https://docs.rs/lava_torrent/latest/lava_torrent/>
- <https://docs.rs/cratetorrent/latest/cratetorrent/>
- <https://docs.rs/librqbit/latest/librqbit/>
- <https://docs.rs/bip_metainfo/latest/bip_metainfo/>

## 3. 给 `koko` 的直接实现判断

### 3.1 私有 swarm 的最小官方组合

第一版最像样的组合应该是：

1. 浏览器客户端：`webtorrent`
2. tracker：`bittorrent-tracker`
3. 24 小时兜底：`urlList` Web Seed
4. 未来严门禁：`getAnnounceOpts` + tracker `filter`

最小配置心智：

- 只下发自家 `announce` 列表
- 打开 `private: true`
- 下发 `urlList`
- `maxWebConns` 先显式钉在官方默认 `4`

最后一条不是官方硬规定，而是结合官方默认值做的工程判断：  
第一版先别为了“更猛”把 Web Seed 并发乱开大，先站稳官方默认值，再用压测说话。

### 3.2 第一版别急着手搓自定义 chunk store

官方文档已经给了 store 体系，浏览器侧也能跨会话保留数据。  
所以第一版更合理的路线是：

1. 先用 `WebTorrent` 现成 store
2. 页面启动时尝试 `navigator.storage.persist()`
3. 把“刷新尽量续”当成 best-effort
4. 真有证据说明默认 store 不够，再评估更重的持久化方案

这样更符合“不重复造轮子”的原则。

### 3.3 视频路径优先站在 `streamURL`，别手写 Range

对 `koko` 第一版，最稳的判断是：

- 视频：优先 `createServer + streamURL`
- 图片：可先用 `Blob URL` 或复用 `streamURL`
- 普通文件：下载/预览按类型分流，但底层仍复用同一 torrent / store / tracker 入口

关键不是一定要所有类型都走同一条展示路径，  
而是不要自己写第二套 chunk/range server。

### 3.4 “开始查看后尽快补齐整个附件”是合理的，不是逆官方

官方既支持顺序播放，也承认网络健康需要回到更完整的 piece 分布。  
所以 `koko` 的第一版实现判断应当是：

1. 用户一开始查看，就立即加入 swarm
2. 播放可以先开始
3. 但后台默认保持整附件仍在下载，直到 `done`
4. 不允许做成“只按观看进度拉到哪算哪”的懒加载播放器

### 3.5 观测埋点不要瞎造名词，直接吃现成事件

官方 API 已经给了足够多的观测点：

- `download`
- `upload`
- `verified`
- `done`
- `noPeers`
- `wire`

再加上 `wire.type` 里能区分 `webrtc`、`webSeed` 等连接类型，  
足够先把“现在到底在吃 peer 还是在吃保底源”这类关键观测做起来。  
第一版没必要再发明一套私有 swarm 诊断协议。

### 3.6 `Phase 2` 的 service worker 落位必须写进计划，不然一定返工

结合当前 `koko` 源码现状：

- Rust 壳层现在只把 hashed 静态资源挂在 `/dist`
- 前端入口 HTML 走 `/`
- 还没有专门的 `sw.js` 出口

所以 `Phase 2` 计划里必须明确二选一：

1. 新增站点根路径 `sw.js` 出口
2. 继续走 `/dist/sw.js`，但后端显式给这个脚本回 `Service-Worker-Allowed: /`

不先把这条写进计划，最后多半会出现：

- `createServer()` 接上了
- `streamURL` 也写了
- 但房间页根本不在 service worker 控制范围里

那就会变成“代码看起来都有了，实际上媒体 URL 还是跑不起来”的假完成。

### 3.7 `Phase 2` 更适合先站在官方预构建入口，而不是先折腾 bundler 兼容层

结合当前 `koko` 前端：

- 构建器是 `esbuild`
- 只有 `入口.ts` 一个主入口
- 目前没有额外的 Node polyfill 层

因此 `Phase 2` 更像样的计划顺序应该是：

1. 先验证 `webtorrent/dist/webtorrent.min.js` 能否稳定接进现有构建
2. 能接通就先走这条最薄路径
3. 只有这条路被真实证据卡住，再评估更重的 bundler 适配

这样更符合“不重复造轮子”和“先让真系统跑起来”的原则。

### 3.8 `Phase 2` 的 metainfo 轮子也要先做一轮成熟度裁决

结合上面的资料，`Phase 2` 计划不该把“Rust 生成 torrent 元信息”写成一句空气话。  
更诚实的顺序应当是：

1. 先比较 `librqbit::create_torrent` 和 `bip_metainfo`
2. 记录为什么不用带明显 caveat 的 `lava_torrent / cratetorrent`
3. 选一个进入最小验证
4. 验证过后再正式接到主链

这样才能既不手搓，也不把一个文档里自己都写了“toy / not recommended critical”的轮子硬塞进生产设计。

对 `koko` 当前代码再往下想一层，实际结论还会更具体：

1. `complete_media_upload()` 在附件升 `ready` 前，已经直接把 `original_bytes` 读进来了。
2. 这意味着 `Phase 2` 如果要继续保持“对象存储驱动可替换、本地/S3 都能走”的边界，`bip_metainfo::DirectAccessor::new(file_name, bytes)` 这类“直接从权威字节产 metainfo”的路径，会比 `librqbit::create_torrent(path)` 更贴现有主链。
3. 反过来说，如果后面真选 `librqbit`，那就必须先回答清楚：对象存储驱动不是本地文件路径时，元信息到底从哪里稳定产出。

所以当前更像样的工程判断是：

- `Phase 2` 先把 `bip_metainfo` 作为主链首选；
- `librqbit` 保留为备选和比较项，而不是无脑先进主链。

### 3.9 当前 `koko` 的附件内容出口还缺标准 Range，不能直接假装自己已经是合格 Web Seed

结合现有源码，`load_attachment_content()` 现在是：

1. 校验权限；
2. 从对象存储把整个对象读出来；
3. 直接回 `200 + body`。

它还没有：

- `Accept-Ranges: bytes`
- `Content-Range`
- `206 Partial Content`

这对 `Phase 2` 的直接含义是：

1. 不能把现有 `/api/attachments/{id}/content` 直接吹成“已经是合格 Web Seed”。
2. 但这也不意味着要手搓私有 chunk 协议。
3. 更正确的路线是：继续复用这个受控内容出口，只给它补 **标准 HTTP Range 语义**。

也就是说，真正该补的是：

- 标准 Range
- 受控 `web_seed_url`
- 不额外发明第二套“媒体补块 API”

## 4. 对 implementation plan 的直接影响

写 implementation plan 时，应该直接按下面这些硬约束落：

1. 不手搓 tracker 核心，不手搓 Range 服务器，不手搓第二套 piece 协议。
2. 前端真正新增的核心文件应是 `frontend/媒体/媒体协作分发.ts`，不是 `P2P.ts`。
3. 后端真正新增的核心文件应是 `src/媒体协作分发.rs`，只收口分发元数据、24 小时窗口、过期裁决接口落位，不接管上传主链。
4. `bittorrent-tracker` 的票据门禁先留接口和中文注释，别一开始就手搓私有握手层。
5. 视频 path 需要把 service worker / `createServer()` / `streamURL` 作为正式方案纳入计划，而不是事后补丁。
6. 第一版浏览器目标写死成“在就传，刷新尽量续，关页就停”。
7. `Phase 2` 必须明确 `sw.js` 的实际出线路径与 scope/header 方案，不能留成“实现时再看”。
8. `Phase 2` 优先验证官方预构建 `webtorrent` 浏览器入口，不先手搓 bundler 兼容层。
9. `Phase 2` 必须先完成 Rust 侧 metainfo 轮子裁决与最小验证，不允许把 `.torrent / info_hash` 生成写成私有实现。
10. 如果最终选 `librqbit`，计划里要明确落 `create_torrent / info_hash / as_bytes` 这条现成 API；如果最终选 `bip_metainfo`，计划里要明确落 `MetainfoBuilder / DirectAccessor / Metainfo::from_bytes(...).info().info_hash()` 这条现成 API。
11. `Phase 2` 的 Web Seed 不能只靠现有 `200 + full body` 内容接口冒充完成，必须补标准 HTTP Range 语义。

## 5. 原始来源（官方优先）

- WebTorrent Docs：<https://webtorrent.io/docs>
- WebTorrent FAQ：<https://webtorrent.io/faq>
- bittorrent-tracker README：<https://github.com/webtorrent/bittorrent-tracker>
- wt-tracker README：<https://github.com/Novage/wt-tracker>
- BitTorrent BEP 19：<https://www.bittorrent.org/beps/bep_0019.html>
- MDN Page Visibility API：<https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>
- MDN StorageManager.persist()：<https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist>
