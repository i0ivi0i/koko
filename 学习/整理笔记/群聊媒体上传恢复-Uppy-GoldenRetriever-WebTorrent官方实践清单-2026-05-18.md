# 2026-05-18 群聊媒体上传恢复 Uppy / Golden Retriever / WebTorrent 官方实践清单

适用范围：`koko` 群聊里图片、视频、附件在切页面、挂后台、刷新页面后的发送与恢复体验。

目标：把 Uppy 官方恢复设计、tus 断点续传协议、WebTorrent 浏览器主链边界收成一张可施工清单，专门回答“媒体消息为什么不能永远卡在上传中”。

## 1. 先说结论

`koko` 的媒体发送体验必须把复杂性藏在系统里，把结果清楚地交给用户：

- 媒体消息一旦进入发送流程，最终只能落到 `已发送` 或 `失败可重试`，禁止无限停在 `上传中`。
- Uppy 的价值是文件选择、上传 UI、任务状态和恢复辅助，不是 `koko` 的媒体业务真相。
- Golden Retriever 主要恢复“用户选过什么文件和 Uppy 状态”，不是万能断点续传。
- tus 才是 HTTP 上传断点续传协议；它靠服务端 offset 继续 PATCH。
- `koko` 正式媒体字节主链仍必须是 WebTorrent，禁止为了续传体验偷偷引入第二条正式媒体分发真相。
- 页面恢复后必须做媒体任务对账：本地文件、torrent 身份、群消息状态、Uppy 状态都要归并成一个最终用户可理解状态。

## 2. Uppy 官方恢复设计

### 2.1 Golden Retriever

官方要点：

- `@uppy/golden-retriever` 会把选中文件和 Uppy 状态保存到浏览器缓存，让刷新、崩溃、误关标签页后尽量恢复。
- 它使用三类存储：
  - `localStorage`：保存 Uppy 状态和文件元数据；
  - `IndexedDB`：保存较小文件，官方口径通常是 5 MiB 以下；
  - 可选 `Service Worker`：辅助恢复大文件，但该存储是临时性的，不保证跨浏览器崩溃或重启长期存在。
- 如果文件无法恢复，Golden Retriever 会进入类似 ghost file 的语义，用户需要重新选择文件。

来源：<https://uppy.io/docs/golden-retriever/>

对 `koko` 的判断：

- Golden Retriever 适合补“刷新后找回用户选过的文件”这层体验。
- 不能把它当成“所有大视频都一定可恢复”的承诺。
- 对视频和大附件，恢复失败必须进入“重新选择以继续发送/供种”的明确状态，而不是继续显示 `上传中`。

### 2.2 Tus

官方要点：

- `@uppy/tus` 通过 `tus-js-client` 接入 tus 协议。
- tus 是 HTTP 断点续传协议，核心是：
  - `POST` 创建 upload resource；
  - `HEAD` 查询服务端已经收到的 `Upload-Offset`；
  - `PATCH` 从该 offset 继续传。
- tus 适合大文件、不稳定网络、暂停/恢复和避免重复上传。
- tus 需要客户端和服务端都实现协议。

来源：

- <https://uppy.io/docs/tus/>
- <https://tus.io/protocols/resumable-upload.html>
- <https://github.com/tus/tus-js-client/blob/main/docs/api.md>

对 `koko` 的判断：

- 如果某条链路仍使用 Rustus/tus 做上传代理，必须把 upload URL、attachment id、offset 可恢复性和过期策略纳入任务状态机。
- 但 tus 不能取代 WebTorrent 成为正式媒体分发主链；否则会绕开项目“纯 WebTorrent 正式媒体字节”的边界。
- tus 的设计可以作为恢复状态机参考：任何传输任务都要能查询当前位置、判断是否过期、继续或失败。
- `chunkSize` 默认 `Infinity`，官方明确说除非被代理/服务端请求体限制或 stream source 逼迫，否则不要设置；`koko` 当前 Cloudflare 公网链路存在请求体限制，显式 chunk 才有部署依据。
- tus-js-client 的恢复依赖 fingerprint / urlStorage / upload URL 和真实文件源；只恢复 UI 草稿状态并不能等价为断点续传。

### 2.3 Uploader 选择

官方要点：

- Uppy 官方 uploader 选择指南把 Tus 定位为可靠、可断点续传的大文件方案。
- Tus 内置退避重试能力，服务端或代理返回 429 时能降低过载放大。
- Tus 需要客户端和服务端一起实现，不是前端单边开关。

来源：<https://uppy.io/docs/guides/choosing-uploader/>

对 `koko` 的判断：

- 继续复用 Uppy/Tus 这类成熟能力，不新增私有上传协议。
- 但恢复任务 owner、业务附件 truth、WebTorrent 分发 truth 必须分清；不能把 Tus transport 成功当成群聊媒体 ready。

## 3. WebTorrent 浏览器主链边界

官方要点：

- WebTorrent 浏览器端通过 WebRTC 做 P2P，媒体可以直接 stream 到 `<video>`、`<audio>`、`<img>`。
- 浏览器使用 `client.createServer()` 时需要 Service Worker，让媒体元素能通过本地 stream URL 读取 torrent 文件。
- 浏览器端 seeding 和 streaming 需要明确管理 torrent 生命周期。
- WebTorrent v2 文档和迁移资料强调浏览器存储不再只是纯内存路径，但仍需要业务层显式保存 torrent 身份、恢复入口和清理策略。

来源：

- <https://webtorrent.io/docs>
- <https://mintlify.com/webtorrent/webtorrent/guides/browser-usage>

对 `koko` 的判断：

- 视频“秒发秒出”的正确模型是：本地拿到 File 后尽快生成 torrent 身份并发布群消息，发送者立即成为 seed，其他用户通过 WebTorrent 拉取。
- 刷新或后台回来后，系统应尝试用持久化的 torrent 身份和可恢复文件重新进入 seeding。
- 如果本地文件句柄/缓存不可恢复，不能展示“还在上传”，只能诚实提示“本机文件已丢失，重新选择后继续发送/供种”。

## 4. 浏览器存储与 Cloudflare 公网边界

官方要点：

- 浏览器存储按 origin 隔离，默认是 best-effort，可能因为配额、系统压力或用户清理被驱逐。
- Storage API 可以申请 persistent，但它仍然不是业务成功语义的权威存储。
- Cloudflare 请求体上限取决于账户套餐：Free / Pro 为 100 MB，Business 为 200 MB，Enterprise 默认 500 MB；超限返回 413。

来源：

- <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria>
- <https://developers.cloudflare.com/workers/writing-workers/resource-limits>

对 `koko` 的判断：

- 本地恢复记录要按“可能丢失”设计，丢了就进入失败/重新选择，而不是保持 `上传中`。
- Cloudflare 上限说明 `32 MiB` 这类 Tus chunk 收口不是拍脑袋，但 chunk 只能解决单请求体限制，不能解决刷新后 owner 丢失。

## 5. 这次 bug 的产品裁决

用户看到“永远上传中”时，系统已经破坏了发送任务的不变量：

- `上传中` 只能表示任务 owner 仍然活着，并且还有可观测进展或可恢复路径。
- 如果页面刷新导致内存里的 request、worker、torrent client 或 Uppy 实例消失，恢复入口必须接管旧任务。
- 如果恢复入口无法接管，UI 必须降级为失败可重试。

所以 `koko` 应该钉死一条规则：

> 媒体发送任务不得永久处于中间态。每个任务必须有身份、owner、恢复策略和最终归宿。

## 6. 可施工状态机

建议把壳层媒体发送任务收敛成这些状态：

- `draft_selected`：用户已选文件，尚未正式发送。
- `preparing`：正在生成业务附件身份、torrent 身份或上传会话。
- `seeding_local`：本地文件已进入 WebTorrent，正在供种。
- `published`：群消息已发布，其他成员可通过 WebTorrent 拉取。
- `recovering`：页面恢复后正在对账本地文件、Uppy 状态、torrent 身份和群消息状态。
- `sent`：发送完成，消息进入正常媒体态。
- `failed_retryable`：失败但用户可重试。
- `failed_needs_reselect`：本地文件不可恢复，需要用户重新选择。

禁止状态：

- 没有 owner 的 `uploading`。
- 没有进度、没有重试、没有超时裁决的 `recovering`。
- 群消息已经存在但本地任务丢失时继续伪装成 `上传中`。

## 7. 页面恢复时的对账顺序

页面从后台、刷新或重连回来后，不应该先弹全局“会话恢复”打断用户，而应该先做局部对账：

1. 读取本地持久化媒体任务索引。
2. 读取当前群消息里仍处于发送中/待确认的媒体消息。
3. 询问 Uppy/Golden Retriever 是否能恢复文件和元数据。
4. 询问 WebTorrent 是否能恢复 torrent / seed。
5. 对仍走 tus 的链路，用 upload URL / attachment id 查询 offset 或完成状态。
6. 合并成单一展示状态：继续、已完成、失败可重试、需要重新选择。

这一步必须是幂等的；重复恢复不能制造重复消息、重复 torrent、重复上传会话。

## 8. 对当前实现的排查清单

后续查代码时优先看这些点：

- Uppy 实例是否在页面恢复后被重建，旧 file id / attachment id 是否还能关联回来。
- 是否启用了 Golden Retriever，或是否有等价的本地任务恢复机制。
- 发送中的媒体消息是否只存在内存态，刷新后没有持久化任务索引。
- WebTorrent client / torrent 是否有恢复入口，还是刷新后只能重新建。
- 群消息中的媒体状态是否能从服务端事实重新推导，而不是永远相信本地 `uploading`。
- 失败态是否被 UI 吞掉，导致用户只看到 `上传中`。
- 是否存在“会话恢复提示”把上传恢复和连接恢复混成一个全局流程。

## 9. 产品口径

用户不是在“上传文件”，用户是在群聊里表达。

因此系统必须做到：

- 正常时：视频和图片秒发秒出，不阻断继续聊天。
- 弱网时：局部显示进度，不污染整个会话。
- 切后台回来时：尽量静默恢复。
- 恢复不了时：诚实失败，给重试或重新选择。
- 永远不让用户面对一个没有真实工作的 `上传中`。
