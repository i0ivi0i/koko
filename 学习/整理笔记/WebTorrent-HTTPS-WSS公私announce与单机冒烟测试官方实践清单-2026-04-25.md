# WebTorrent HTTPS / WSS 公私 announce 与单机冒烟测试官方实践清单

日期：2026-04-25
适用范围：`koko` 的 WebTorrent 浏览器协作分发、同源 `/api/swarm/announce` 代理、成熟 tracker sidecar、dev seeder sidecar、HTTPS 本地烟测、未来 Linux 公网部署前置验证。
目标：把这次 HTTPS 冒烟暴露出的 `浏览器公开 WSS announce` 与 `服务端 sidecar 私有 tracker announce` 混用问题收成施工准绳，避免后续为了“HTTPS 正确”把所有链路都粗暴改成 WSS，或为了“本机方便”把浏览器退回不安全 WS。

关联资料：

- `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- `学习/整理笔记/2026-04-23-WebTorrent极限协同分发动工前官方资料校准.md`
- `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`
- `学习/整理笔记/WebTorrent最新版官方建议与高性能设计补充-2026-04.md`

---

## 1. 先说结论

这次真正要记死的是：

1. 浏览器公开入口必须按页面安全上下文暴露 `wss://公网域名/api/swarm/announce`。
2. 服务端 sidecar / backend / tracker 的本机控制链不应该复用浏览器公开 WSS URL。
3. sidecar 在同机部署时默认也必须走后端同源验票入口，例如 `ws://127.0.0.1:<APP_PORT>/api/swarm/announce`；裸 tracker upstream 只能给 Rust 代理使用。
4. `public announce` 是给浏览器 contract 的；`seeder announce` 是给做种 sidecar 的已认证入口；`tracker_upstream_url` 是 Rust 代理到成熟 tracker 的内部地址。三者同属 WebTorrent 分发平面，但不是同一个配置真相。
5. 禁止为了修 sidecar 本机证书问题，把浏览器 locator 从 `wss://` 退回 `ws://`。
6. 禁止为了追求“全 HTTPS”，强迫本机 sidecar 走 `wss://localhost/...`，这会把公网证书信任、反向代理和本机控制面绑死。
7. 一台电脑可以证明本地 HTTPS / WSS / WebRTC 链路搭得对，但不能证明全球 NAT、运营商网络和跨洲公网一定通。
8. 真正合格的烟测不能只看视频能播放；必须证明 `wire.type === "webrtc"`、tracker peer 数、上传/下载计数和 sidecar 日志都成立。

---

## 2. 官方资料给出的边界

### 2.1 WebTorrent 浏览器侧只和 WebRTC-capable peers 互通

WebTorrent FAQ 明确说明：浏览器里的 WebTorrent 使用 WebRTC，浏览器客户端只能从支持 WebRTC 的客户端下载。普通 TCP / UDP BitTorrent peer 不能直接被浏览器 WebTorrent 当成来源。

工程含义：

1. 浏览器里“能播”不等于 WebTorrent swarm 已通；它可能只是 WebSeed / HTTP range 在工作。
2. 服务端强 seed 要想真正帮助浏览器，必须是 WebRTC-capable peer，或者通过 `webtorrent-hybrid` / 等价成熟实现进入 web peer swarm。
3. 禁止把传统 torrent tracker / TCP seed 的成功当成浏览器 WebTorrent 成功。

来源：

- WebTorrent FAQ: <https://webtorrent.io/faq>
- WebTorrent GitHub: <https://github.com/webtorrent/webtorrent>

### 2.2 WebTorrent API 已经提供 announce、getAnnounceOpts 和观测点

WebTorrent docs 给出的关键能力包括：

1. `client.add(torrentId, opts)` 支持 `announce`、`getAnnounceOpts`、`urlList`。
2. `getAnnounceOpts` 可给 tracker announce 附加自定义参数，适合传 `join_ticket`。
3. `torrent.on("wire")` 能观察 peer 连接。
4. `torrent.on("download")`、`torrent.on("upload")`、`torrent.on("verified")`、`torrent.on("done")` 能观察真实传输与完整性。
5. `torrent.on("noPeers")` 能暴露 tracker / DHT / LSD / PEX 找不到 peer 的情况。
6. `torrent.numPeers`、`torrent.downloaded`、`torrent.uploaded` 是烟测必须读的运行态指标。

工程含义：

1. 禁止用 UI“观看视频”按钮点击成功冒充 swarm 成功。
2. 禁止只用 HTTP 206 range 证明 P2P 成功。
3. 浏览器与 sidecar 都应该把 `getAnnounceOpts` 作为 `join_ticket` 门禁扩展点，禁止在 URL 里手搓第二套门禁。

来源：

- WebTorrent API Documentation: <https://webtorrent.io/docs>

### 2.3 HTTPS 页面里的公开 WebSocket tracker 必须是 WSS

MDN mixed content 说明：HTTPS 页面加载不安全资源属于 mixed content，浏览器会升级或阻断不安全请求。MDN secure contexts 也把 `wss://` 归入可信 URL。

工程含义：

1. `https://localhost` 或公网 `https://im.example.com` 页面下发给浏览器的 tracker announce 必须是 `wss://...`。
2. 禁止在 HTTPS 页面里让浏览器直连 `ws://公网域名/...`。
3. 本地 loopback 虽然有特殊可信上下文规则，但生产设计不能依赖这个例外。

来源：

- MDN Mixed Content: <https://developer.mozilla.org/docs/Web/Security/Mixed_content>
- MDN Secure Contexts: <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts>

### 2.4 WebRTC 调试必须看连接与统计，不只看页面

MDN `RTCPeerConnection` 说明 WebRTC 连接拥有连接状态、ICE 状态和 `getStats()`；Chrome 官方也建议用标准 `getStats()`，并可通过 `chrome://webrtc-internals/` 实时对照。

工程含义：

1. 单机烟测至少要能观测 WebRTC peer 连接是否真的建立。
2. 自动化烟测可以优先从 WebTorrent `wire` / `torrent.numPeers` / tracker stats 入手；人工深查再打开 `chrome://webrtc-internals/`。
3. 禁止把 presence 心跳表当作 WebRTC 数据通道已通的唯一证明；presence 只能证明业务投影更新。

来源：

- MDN RTCPeerConnection: <https://developer.mozilla.org/docs/Web/API/RTCPeerConnection>
- Chrome getStats migration: <https://developer.chrome.com/blog/getstats-migration>

### 2.5 tracker 是成熟轮子边界，禁止长期手搓

`bittorrent-tracker` 官方提供 WebSocket tracker server、stats、scrape 等能力。`wt-tracker` 作为高性能 WebTorrent tracker，明确支持 `ws://` 和 `wss://` 同时处理，并提供 `/stats.json`，其 README 声称可用 uWebSockets.js 在小 VPS 上承载大量 WSS peer。

工程含义：

1. 当前实现已经禁止继续保留 `frontend/dev-tracker.mjs` 作为 tracker 核心。
2. Win11 + Node 25 本机验证显示 `wt-tracker@0.0.1` npm 包缺少 `dist/run-uws-tracker.js`，不能作为当前落地轮子。
3. 当前落地选择是官方 `bittorrent-tracker@11.2.2` CLI；它只负责 WebTorrent tracker/signaling，业务门禁由 Rust `/api/swarm/announce` 首帧验票代理负责。
4. `koko` 的业务真相是授权、资产、ticket、presence；WebTorrent signaling 能力应交给成熟 tracker 轮子。

来源：

- bittorrent-tracker: <https://github.com/webtorrent/bittorrent-tracker>
- wt-tracker: <https://github.com/Novage/wt-tracker>

---

## 3. `koko` 必须拆开的两条 announce 真相

### 3.1 浏览器公开 announce

拥有者：后端 locator / contract。
消费者：浏览器 WebTorrent runtime。
典型值：

1. 本机 HTTPS：`wss://localhost/api/swarm/announce`
2. 公网生产：`wss://im.example.com/api/swarm/announce`
3. 本机 HTTP 开发：`ws://127.0.0.1:8080/api/swarm/announce`

硬约束：

1. 它必须跟当前页面 origin / 反向代理头一致。
2. 它可以通过主服务同源代理转发到 tracker sidecar。
3. 它进入 `locator.distribution.announce_urls`。
4. 禁止把裸 sidecar 端口直接下发给公网浏览器。

### 3.2 sidecar 认证 announce

拥有者：后端 shell / infrastructure 配置。
消费者：dev seeder sidecar、未来服务器强 seed。
典型值：

1. 本机开发：`ws://127.0.0.1:8080/api/swarm/announce`
2. 同机不同端口：`ws://127.0.0.1:<APP_PORT>/api/swarm/announce`
3. 特殊生产拓扑：运维显式配置的私有或公网同源验票入口。

硬约束：

1. 它不进入浏览器 locator。
2. 它只进入后端发给 `/seed/start` 的控制面 payload。
3. 它默认应该从 `APP_PORT` 派生，而不是从请求头派生。
4. 它可以由 `SWARM_SEEDER_TRACKER_URL` 显式覆盖，但覆盖值仍应指向验票入口。
5. 禁止让 sidecar 复用 `runtime_distribution["announce_urls"]` 里的浏览器公开 WSS URL。
6. 禁止让 sidecar 默认直连裸 tracker 端口绕过 `join_ticket` 门禁。

### 3.3 tracker upstream

拥有者：后端 shell / infrastructure 配置。
消费者：Rust `/api/swarm/announce` 代理。
典型值：

1. 本机开发：`ws://127.0.0.1:7072`
2. 同内网部署：`ws://tracker.internal:7072`

硬约束：

1. 它只允许由 Rust 同源代理读取。
2. 它不能进入浏览器 locator。
3. 它不能进入 `/seed/start` payload。
4. 它可以由 `SWARM_TRACKER_UPSTREAM_URL` 显式覆盖。

---

## 4. 本次 HTTPS 烟测暴露的具体问题

现象：

1. 浏览器 `https://localhost` 上传新 MP4 成功。
2. locator 返回 `wss://localhost/api/swarm/announce`，这对浏览器是正确的。
3. WebTorrent 路由和 WebSeed 都返回 `206`，视频能播。
4. DB presence 记录了 sender / viewer 的 `partial_peer / complete_peer`。
5. 但 `webtorrent-seeder.stderr.log` 出现：

```text
[dev-seeder][11e06903...] warning: Error connecting to wss://localhost/api/swarm/announce
```

根因：

1. `src/媒体协作分发.rs` 根据 HTTPS 反代头推导 WSS public announce，这是正确的。
2. `src/外壳.rs::从协作分发响应构造做种启动命令` 直接把 public `announce_urls` 透传给 seeder。
3. dev seeder 作为本机 Node sidecar 不应该走浏览器 public WSS URL。
4. 这属于配置真相混用，不是 WebTorrent 本身坏，也不是 HTTPS 烟测应该退回 HTTP。

---

## 5. 一台电脑上怎么正确烟测

### 5.1 能证明什么

一台电脑可以证明：

1. HTTPS 页面是否能加载。
2. 浏览器 locator 是否下发 WSS announce。
3. 同源 `/api/swarm/announce` 是否能验票后代理到成熟 tracker。
4. sidecar 是否用后端认证 announce 成功入群。
5. 多个隔离浏览器上下文之间是否能建立 WebRTC peer。
6. WebSeed 关闭或受控阻断时，浏览器是否仍能从 peer 拉块。
7. tracker / seeder / browser 三侧指标是否一致。

### 5.2 不能证明什么

一台电脑不能完全证明：

1. 全球用户 NAT 穿透一定成功。
2. 移动网络、企业网、防火墙、运营商 CGNAT 下仍然稳定。
3. 跨洲 RTT、丢包、弱网下的 piece 调度足够好。
4. TURN 缺失时所有用户都能互通。

这些必须留给公网双节点、跨网络客户端和未来 TURN / STUN 配置烟测。

### 5.3 本机最小合格烟测流程

1. 启动 `run.ps1`，确保 Caddy / app / tracker / seeder 都起来。
2. 用 `https://localhost` 打开页面，进入房间 `1234b`。
3. 上传一个没发过的新 MP4。
4. 读取 locator，确认浏览器得到 `wss://localhost/api/swarm/announce`。
5. 读取 seeder `/health`，确认新 `infoHash` active。
6. 读取 seeder 日志，禁止出现 `Error connecting to wss://localhost/api/swarm/announce`。
7. 打开至少两个 isolated browser context，进入同一房间并观看同一视频。
8. 读取 tracker `/stats` 或所选成熟 tracker 的等价统计入口，确认同一 `infoHash` 的 peers 增加。
9. 读取 WebTorrent runtime 指标，确认 `numPeers > 0`、`downloaded/uploaded` 增长。
10. 受控阻断或禁用 WebSeed 路径，确认第二个 viewer 仍能从 peer 获取数据。
11. 读取浏览器控制台，禁止 mixed-content、WebSocket failure、WebRTC fatal error。
12. 如果自动化证据不足，再用 `chrome://webrtc-internals/` 或 `getStats()` 人工确认 ICE/datachannel。

### 5.4 合格判定

合格必须同时满足：

1. 浏览器 public announce 是 `wss://.../api/swarm/announce`。
2. sidecar seeder announce 是 `ws://127.0.0.1:<APP_PORT>/api/swarm/announce` 或显式配置的验票入口。
3. seeder 日志没有连接 public WSS 失败。
4. tracker 能看到同一 `infoHash` 下多个 peer。
5. browser WebTorrent 能看到 WebRTC wire 或等价 peer 传输指标。
6. HTTP range / WebSeed 成功只能算保底源成功，不能单独算 P2P 成功。

---

## 6. 未来 Linux 公网部署前的烟测升级

### 6.1 单机公网服务器

公网单机至少要验证：

1. `https://域名` 页面正常。
2. `wss://域名/api/swarm/announce` 通过反代进入 tracker。
3. sidecar 到 tracker 只能通过后端验票入口；后端再用 `SWARM_TRACKER_UPSTREAM_URL` 连接内网或本机 tracker upstream。
4. 证书续期不影响 WSS。
5. tracker stats 能按 `infoHash` 输出 peers。
6. seeder / backend / tracker 日志都带足够 correlation 信息。

### 6.2 双网络客户端

必须至少用两种网络：

1. 公网服务器 + 家宽 PC 浏览器。
2. 公网服务器 + 手机热点或另一运营商网络浏览器。

判定：

1. 双客户端能互相发现。
2. WebRTC datachannel 建立。
3. WebSeed 仍在前 24 小时帮助，但不是唯一来源。
4. 关闭某个 viewer 后，presence 与 tracker peer 数能收敛。

### 6.3 全球化前必须补的能力

1. STUN / TURN 配置策略。
2. tracker 高可用或成熟 tracker 替换评估。
3. `/stats`、`/stats.json` 或等价结构化观测。
4. smoke 脚本自动断言 WSS、公私 announce、peer 数、上传下载计数。
5. 日志里区分 `public_announce_url`、`seeder_announce_url`、`tracker_upstream_url`。

---

## 7. 给后续实现的禁令

1. 禁止把浏览器 public announce、sidecar seeder announce 和 tracker upstream 合并成一个配置。
2. 禁止让 sidecar 复用 locator 里的 `announce_urls`。
3. 禁止把 HTTPS 页面里的浏览器 tracker 改成 `ws://`。
4. 禁止把 `wss://localhost` 作为本机 sidecar 的默认 announce。
5. 禁止只用视频能播放证明 WebTorrent 协作分发成功。
6. 禁止只用 presence 心跳证明 WebRTC peer 已经互通。
7. 禁止把 WebSeed 206 当作 P2P 成功。
8. 禁止为了修本机烟测，把公网部署需要的 WSS contract 弱化。
9. 禁止继续扩展自研 tracker 成长期核心；当前默认使用成熟 tracker 轮子，未来公网部署前只允许在成熟 tracker 之间替换。

---

## 8. 原始来源

- WebTorrent Docs: <https://webtorrent.io/docs>
- WebTorrent FAQ: <https://webtorrent.io/faq>
- WebTorrent GitHub: <https://github.com/webtorrent/webtorrent>
- bittorrent-tracker: <https://github.com/webtorrent/bittorrent-tracker>
- wt-tracker: <https://github.com/Novage/wt-tracker>
- MDN Mixed Content: <https://developer.mozilla.org/docs/Web/Security/Mixed_content>
- MDN Secure Contexts: <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts>
- MDN RTCPeerConnection: <https://developer.mozilla.org/docs/Web/API/RTCPeerConnection>
- Chrome getStats migration: <https://developer.chrome.com/blog/getstats-migration>
