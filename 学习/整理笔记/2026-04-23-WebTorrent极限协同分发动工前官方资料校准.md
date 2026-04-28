# 2026-04-23 WebTorrent 极限协同分发动工前官方资料校准

适用范围：`docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md` 关联的极限协同分发任务，重点覆盖 `partial_peer / complete_peer` 语义、`WebTorrent` 浏览器事件面、`webtorrent-hybrid` 边界、`XState v5` actor owner 与刷新恢复。
目标：在动代码前，把这次真正会碰到的官方 API、成熟轮子边界和高性能分发心智钉死，避免边改边猜、手搓第二套 runtime、或把 UI 意图误判成 swarm 真相。

关联旧笔记：

1. `学习/整理笔记/群聊媒体-WebTorrent协作分发官方实践清单.md`
2. `学习/整理笔记/WebTorrent最新版官方建议与高性能设计补充-2026-04.md`
3. `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`
4. `学习/整理笔记/浏览器内应用与前端应用化官方实践笔记.md`

---

## 1. 这次实现前最该记死的结论

1. `partial_peer` 不是一个新的底层协议能力，而是我们对**已真实进入 swarm、已拿到可用 file/source、但尚未整附件完成**这一阶段的业务投影；它不该再逼出第二张表、第二套 runtime 或第二条播放链。
2. `complete_peer` 的升级锚点应该继续站在 `WebTorrent` 官方现成事实之上：`torrent.done === true` 或等价的本地完整事实成立后再升，不要让 UI“正在看/看过了”冒充完成来源。
3. “A/B/C 与服务器一起帮助 D”这个心智是对的，而且更接近 BitTorrent 原生设计；协议天然就是多连接、多 piece request、可并行从多个来源取块，不是单对单传输模型。
4. 前端仍应继续沿现有 owner 链推进：`聊天媒体编排 -> 媒体播放器 -> 资产协作分发运行时 -> WebTorrent runtime`。这次要做的是去掉保守门槛，不是重做一套更“高级”的 swarm 核心。
5. `WebTorrent` 官方已经给出了我们这次真正会用到的 API：`client.add`、`client.remove`、`client.destroy`、`torrent.on('wire')`、`torrent.on('download')`、`torrent.on('done')`、`torrent.on('upload')`、`torrent.on('noPeers')`、`torrent.select / critical`、`file.streamURL / streamTo`。这轮不需要手搓第二套下载/播流内核。
6. `XState v5` 官方对 actor 的口径非常适合当前任务：actor 内部状态只能由 actor 自己改，按 mailbox 串行处理消息；这正好支持“每个 swarm session 自己拥有状态，外层只发事件，不越层共写”。
7. 页面重开后的“恢复帮助任务”要收敛在当前 owner 链里做，不要误解成必须新增一个全局后台守护进程；`XState` 的持久化说明的是“可恢复的 actor 真相”，不是“应该无边界恢复所有历史附件”。

---

## 2. 官方资料对本次 plan 的直接约束

### 2.1 `WebTorrent` 的浏览器 API 已足够支撑这次改动

`WebTorrent` 官方 docs 明确给出：

1. `client.add(torrentId, opts)` 支持 `announce`、`getAnnounceOpts`、`urlList`、`maxWebConns`、`store`、`destroyStoreOnDestroy`、`strategy`。
2. 下载中的 torrent 会自动做种。
3. `client.remove()` / `torrent.destroy()` 会销毁连接，并可选择是否销毁底层 store。
4. `torrent.on('wire')` 代表新 peer 连接建立。
5. `torrent.on('download')` / `torrent.on('upload')` / `torrent.on('verified')` / `torrent.on('done')` / `torrent.on('noPeers')` 都是现成观测点。

这对当前实现的含义：

1. `partial_peer` 的上报锚点应建立在**真实 swarm/runtime 事实**上，例如已连上 peer、已拿到 file/source、已开始验证/下载，而不是浏览器壳“现在在看”这种弱信号。
2. `complete_peer` 的升级锚点应继续站在 `torrent.done` 或本地完整缓存事实上。
3. 会话销毁、后台降载和零引用清理要继续复用 `remove/destroy` 语义，不该为了“恢复帮助任务”手搓另一套悬空任务管理器。

来源：

- `WebTorrent API Documentation`: <https://webtorrent.io/docs>

### 2.2 `createServer + streamURL / streamTo` 已经是官方正式播放通道

官方 docs 明确写了：

1. `client.createServer()` 动态按需抓取 torrent pieces 来满足 HTTP 请求，而且支持 Range requests。
2. `file.streamTo(elem)` 需要先 `createServer()`，并支持 streaming、seeking 以及浏览器原生容器/编解码器。
3. `file.streamURL` 也是建立在同一个官方 server 能力上。

这对当前实现的含义：

1. 去掉 `reuseOnly` 的目标是**放开冷启动协作分发会话**，不是手搓另一条 raw whole-file 或自定义 Range 主链。
2. 视频 backfill 仍然只能走现有 `resolveSwarmSource` / runtime / `streamURL` 这条官方路径。
3. `HLS/origin` 不该因为“更稳”重新回到正式播放主链；那会直接把系统做回双链。

来源：

- `WebTorrent API Documentation`: <https://webtorrent.io/docs>

### 2.3 浏览器 WebTorrent 仍然只认 WebRTC-capable peers

`WebTorrent FAQ` 和 `webtorrent-hybrid` README 的组合结论很清楚：

1. 浏览器里的 `WebTorrent` 只能下载由 WebRTC-capable client 做种的 torrent。
2. `webtorrent-hybrid` README 仍明确写着：在 Node.js 中，如果想连接包括 WebRTC peers 在内的全部 peer 类型，要用 `webtorrent-hybrid`；而且它与 `webtorrent` 保持相同 CLI 与 module API。

这对当前实现的含义：

1. `frontend/dev-seeder.mjs` 继续优先站在 `webtorrent-hybrid` 或同级成熟实现上是对的，不要为“更纯”手搓 Node 侧 WebRTC torrent 栈。
2. 服务器和浏览器共同帮助 D 的前提，就是服务器这边确实是浏览器可连接的 swarm 成员，而不是名字叫 seeder、实际却只是第二条直链。
3. 这次前端/后端只扩展 `partial_peer` 语义，不改变 `webtorrent-hybrid` 这类成熟轮子的职责边界。

来源：

- `WebTorrent FAQ`: <https://webtorrent.io/faq>
- `webtorrent-hybrid`: <https://github.com/webtorrent/webtorrent-hybrid>

### 2.4 BitTorrent 原生就是多来源取块，不是单对单模型

`BEP 3` 和 `BEP 19` 给出的高性能心智非常直接：

1. `BEP 3` 说明数据传输发生在“interested + unchoked”连接上，downloaders 应保持多个 piece request 同时排队，这叫 pipelining。
2. `BEP 3` 还说明末段会进入 endgame：对剩余块向多个下载来源同时发请求，哪边先到就取消别家的重复请求。
3. `BEP 19` 说明 `WebSeed`/HTTP seed 是正式 BitTorrent 能力，目的之一就是保证总有一个不 choke 的 seed 帮人起步，而且传统客户端也能从它带来的 pieces 继续传播。

这对当前实现的含义：

1. 你想要的“服务器 + A/B/C 一起帮助 D，D 之后再帮助 E/F”不是临时发明，而是更贴近协议的正确心智。
2. `partial_peer` 的价值就在于：它虽然还不是 ready/complete，但它已经可能在贡献一部分块，应该让后端把它投影成 `MEDIA_CONNECTING_TO_PEERS` 而不是等价于“没有价值”。
3. 服务器强 seed 与群友多源协同不是冲突关系；只要仍在 swarm 正式主链里，它们本来就应该一起工作。

来源：

- `BEP 3`: <https://www.bittorrent.org/beps/bep_0003.html>
- `BEP 19`: <https://www.bittorrent.org/beps/bep_0019.html>

### 2.5 `XState v5` 的 actor owner 语义正好支持这次改造

`Stately/XState` 官方 docs 明确写了：

1. actor 有自己封装的内部状态，只能由 actor 自己更新。
2. actors 通过异步事件通信，并且一次只处理一条消息，内部 mailbox 串行消费。
3. `createActor(...)` 会创建 root actor，同时隐式创建 actor system。
4. persisted snapshot 可通过 `actor.getPersistedSnapshot()` 获取，再用 `createActor(logic, { snapshot })` 恢复。
5. 对 machine actors 来说，持久化/恢复是 deep 的：invoked / spawned actors 会递归恢复。
6. `systemId` / `system.get()` 允许同一 actor system 里的 actor 在不共享内部状态的前提下协作。

这对当前实现的含义：

1. `资产协作分发运行时.ts` 继续做 session 的唯一 owner 是正确方向，不能把 `eagerCompleting`、heartbeat 类型切换、生命周期清理重新分散回播放器或聊天壳。
2. “恢复帮助任务”应该是**根据当前房间 + 媒体缓存事实重新激活正确 actor**，而不是壳层直接共写 swarm 真相。
3. 页面重开恢复时，恢复的是**当前房间需要的帮助任务**，不是全局历史附件大扫荡；这也符合 actor/system 的边界思维。

来源：

- `Stately Actors`: <https://stately.ai/docs/actors>
- `Stately State machines`: <https://stately.ai/docs/machines>
- `Stately Persistence`: <https://stately.ai/docs/persistence>
- `Stately System`: <https://stately.ai/docs/system>

---

## 3. 对 Task 1-4 的落地指导

### 3.1 Task 1 后端 `partial_peer` 裁决

动机已经足够明确：

1. `partial_peer` 是来源语义扩展，不是 availability 新真相表。
2. 后端唯一该做的是：让 `partial_peer` 进入 `MEDIA_CONNECTING_TO_PEERS` 的裁决面，而不是抬成 `MEDIA_READY`。
3. `MEDIA_READY` 继续只认 `complete_peer / backend_strong_seed / valid web seed`。

所以 Task 1 的“最小实现”是顺着现有后端 owner 走：

1. 扩 `peer_kind` 合法值。
2. 扩聚合查询。
3. 扩媒体状态裁决。
4. 不新造第二张表、不把裁决下放到前端。

### 3.2 Task 2 前端 heartbeat 与 eager backfill

最关键的外部依据是：`WebTorrent` 已经给了足够细的 runtime 事实，没必要把 UI gaze 当成 swarm 真相。

因此更稳的实现原则是：

1. `viewer_intent` 仍表示“有人正在看/想看”。
2. `partial_peer` 只在会话已真实进入 swarm、拿到 file/source、开始补块后上报。
3. `complete_peer` 只在 `done/locallyComplete` 后上报。
4. 心跳升级应在同一会话里切换，不双写两条并行真相。

### 3.3 Task 3 去掉 `reuseOnly`

这一步不是“让视频绕过现有 runtime 冷拉 whole-file”，而是：

1. 允许视频 backfill 像图片一样走现有 `resolveSwarmSource` 冷启动。
2. 继续只站在官方 `client.add / createServer / streamURL` 这条路径上。
3. 不把 HLS/origin 当作新的正式 whole-file fallback。

### 3.4 Task 4 页面重开恢复帮助任务

官方 `XState` 的恢复语义支持“用 persisted/cached facts 恢复 actor”，但不支持“无边界共享内部状态”。  
所以恢复逻辑的边界应继续保持：

1. 由 `聊天媒体编排.ts` 基于当前房间附件集合 + `媒体缓存` 完整事实决定是否恢复。
2. 恢复动作继续通过 `媒体播放器.激活协作补齐` 进入原 owner 链。
3. 禁止全局扫描历史缓存并偷挂一堆后台任务。

---

## 4. 这次明确不需要再查、也不该手搓的东西

1. 不需要为 `partial_peer` 发明新的 swarm 协议或 tracker 协议。
2. 不需要为视频 backfill 手搓第二套 Range / chunk 下载逻辑。
3. 不需要为恢复帮助任务手搓全局后台守护进程。
4. 不需要为浏览器 peer/Node seeder 互通再手搓 WebRTC torrent 栈，继续复用 `webtorrent` / `webtorrent-hybrid`。
5. 不需要把 `XState` 的 actor owner 打散成多个模块共写同一份 session 状态。

---

## 5. 给后续编码的硬门禁

1. `partial_peer` 只能表示“真实 swarm 连接中的帮助者”，不能由 UI 意图冒充。
2. `complete_peer` 只能由完整字节事实升级，不能由“已经在播”“已经看过一段”冒充。
3. 后端仍是 `MEDIA_READY / CONNECTING / NO_ONLINE_SEED / DELETED` 的唯一裁决 owner。
4. 前端只扩展 runtime 心跳与恢复逻辑，不新增第二套 swarm runtime、第二套后台 whole-file 主链、第二套缓存真相。
5. 任何“为了更稳”而把 `HLS/origin` 偷回正式播放链的做法，都违背这次资料校准后的边界。

---

## 6. 原始来源

### 官方文档

- WebTorrent API Documentation: <https://webtorrent.io/docs>
- WebTorrent FAQ: <https://webtorrent.io/faq>
- webtorrent-hybrid README: <https://github.com/webtorrent/webtorrent-hybrid>
- BitTorrent BEP 3: <https://www.bittorrent.org/beps/bep_0003.html>
- BitTorrent BEP 19: <https://www.bittorrent.org/beps/bep_0019.html>
- Stately State machines: <https://stately.ai/docs/machines>
- Stately Actors: <https://stately.ai/docs/actors>
- Stately Persistence: <https://stately.ai/docs/persistence>
- Stately System: <https://stately.ai/docs/system>

### 通过 Context7 补充核对

- `/statelyai/docs`：XState v5 `createActor`、persisted snapshot restore、actor system / `systemId`
