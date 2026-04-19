# 2026-04-19 WebTorrent 秒开秒播秒切与图片秒开：官方与 BEP 性能清单

目标：回答“最新版 WebTorrent 能不能支撑群聊视频秒开秒播秒切、图片秒开”，并给出可直接落地的高性能设计清单。

## 1. 先给结论（今天复核版）

- 能，但前提是架构做对。
- `WebTorrent` 官方确认浏览器可直接流式播放视频/音频，也可直接展示图片文件。
- 真正稳定的“秒开”不是只靠纯 swarm；官方能力本身就支持 `tracker + web seed + p2p` 协同。
- 群聊里要追求“秒开秒播秒切”，核心不是换更多播放器，而是把 **同一 infohash/磁链** 在消息流与查看器复用，并把冷启动与热扩散分层。

## 2. 最新版事实（2026-04-19 实测）

本地命令直接查 npm registry（避免搜索缓存误差）：

```powershell
npm view webtorrent version
# 2.8.5
```

```powershell
npm view webtorrent time --json
# 最新发布时间: 2025-11-30T01:30:21.996Z
```

补充：`webtorrent-hybrid` npm 页面已经标注 deprecated，并建议 WebTorrent `>= 2.3.0` 直接使用 `webtorrent` 包。

## 3. 官方能力边界（WebTorrent）

- 浏览器端 `file.streamTo(...)` 支持视频、音频、图片等文件；视频可在未完整下载前播放并支持 seek。
- `file.streamTo` 依赖 `client.createServer(...)`（浏览器侧通常配合 Service Worker）。
- `client.createServer` 明确支持 HTTP Range 请求，这对 seek 和“秒切”非常关键。
- `client.add` 支持：
- `announce`（tracker 列表）
- `urlList`（web seeds）
- `maxWebConns`（每个 web seed 并发）
- `strategy`（`sequential` / `rarest`）
- 细粒度优先级能力：
- `torrent.select / torrent.deselect / torrent.critical`
- `file.select / file.deselect`
- 观测与降级钩子：
- `torrent.on('download'|'upload'|'wire'|'noPeers'|'error')`

## 4. BitTorrent 标准里与“秒开”直接相关的性能项

- BEP 12（Multitracker）：
- 使用 `announce-list` 分 tier；同层随机，成功 tracker 前移。结论：不要单 tracker。
- BEP 19（WebSeed）：
- HTTP/FTP 可作为 seed；可作为“常开、可预期”的补给源。结论：冷启动保底要留 web seed。
- BEP 23（Compact Peer List）：
- tracker 可返回紧凑 peers，降低响应体与 tracker 负担。结论：高并发下 tracker 压力更可控。
- BEP 9（Metadata over magnet）：
- metadata 分 16KiB 块交换；无 tracker 时 SHOULD 使用 DHT 获取 peers。结论：磁链首段阶段要考虑 metadata 完整性与超时策略。
- BEP 5（DHT）：
- 提供 trackerless peer 发现机制（协议层能力）。

## 5. “大神路线”里最实用的高性能设计（基于公开实现）

- OpenWebTorrent 官方直接建议：使用多个 tracker 提升可达性（同时给出公共 WSS tracker）。
- `wt-tracker`（Novage）给出高性能 WebTorrent tracker 路线（uWebSockets.js、统计接口等）。
- `aquatic`（Rust）明确支持 UDP/HTTP/WebTorrent 三种 tracker 实现，主打多线程、内存态、Prometheus 观测；`tracker.webtorrent.dev` 公开说明运行在 aquatic 上。
- `p2p-media-loader` 明确主张 Hybrid CDN + P2P（不是“纯 P2P 宗教”），适合大规模流媒体削峰。

## 6. 给 `koko` 群聊的落地清单（可直接执行）

下面是**基于上面官方资料做的工程推断**（不是逐字引用）：

- 单一真相：
- 消息流自动播、查看器全屏播、预览缩略图必须共用同一 `magnet/infohash` 真相，不允许再分叉成不同源路径。
- 冷启动保底：
- 每个媒体种子都带 `announce-list`（至少 3 个可用 WSS tracker）。
- 同时写 `urlList`（web seed / HTTP 冷备）；`maxWebConns` 视带宽压测调整。
- 秒切策略：
- App 级复用单个 WebTorrent client，避免每次开查看器重建 client/swarm。
- 查看器打开时不重复“二次 add”；优先复用既有 torrent handle。
- 对当前要播文件调用 `file.select`，并对首段与 seek 目标段做 `torrent.critical`。
- 图片秒开策略：
- 缩略图/首屏图优先走 `file.streamURL` 或 `file.blob()` 直出；热图继续留在 swarm 中复用。
- 无 peer 时必须立即走 web seed/HTTP，不要让用户等“转圈找 peer”。
- 观测与回退：
- 统一上报 `noPeers`（按 tracker/dht/pex 分类）、首帧时间、seek 复位次数、切换耗时。
- 一旦 `noPeers` 连续触发，自动切到 web seed 路径并保留重试回流 swarm 机制。

## 7. 一句话裁决

最新版 WebTorrent 完全能成为群聊媒体“热扩散主引擎”；但要稳定实现“秒开秒播秒切 + 图片秒开”，必须是 **多 tracker + web seed 保底 + 同一 infohash 真相 + 选择/关键片优先级调度** 的组合拳，而不是纯 swarm 单押。

## 8. 来源（2026-04-19 复核）

- WebTorrent Docs: <https://webtorrent.io/docs>
- WebTorrent FAQ: <https://webtorrent.io/faq>
- WebTorrent npm: <https://www.npmjs.com/package/webtorrent>
- webtorrent-hybrid npm（deprecated 说明）: <https://www.npmjs.com/package/webtorrent-hybrid>
- WebTorrent BEP Support（官方仓库文档）: <https://github.com/webtorrent/webtorrent/blob/master/docs/bep_support.md>
- create-torrent npm（`pieceLength/announceList/urlList`）: <https://www.npmjs.com/package/create-torrent>
- BEP 12: <https://www.bittorrent.org/beps/bep_0012.html>
- BEP 19: <https://www.bittorrent.org/beps/bep_0019.html>
- BEP 23: <https://www.bittorrent.org/beps/bep_0023.html>
- BEP 9: <https://www.bittorrent.org/beps/bep_0009.html>
- BEP 5: <https://www.bittorrent.org/beps/bep_0005.html>
- OpenWebTorrent（多 tracker 建议）: <https://openwebtorrent.com/>
- tracker.webtorrent.dev: <https://tracker.webtorrent.dev/>
- wt-tracker: <https://github.com/Novage/wt-tracker>
- aquatic: <https://github.com/greatest-ape/aquatic>
- p2p-media-loader: <https://github.com/Novage/p2p-media-loader>
