# 2026-04-10 群聊媒体 P2P 轮子与锚点方案对齐笔记

适用范围：`koko` 在“图片 + 视频同轮落地”的媒体主链里，为浏览器 P2P、tracker、锚点种子节点做轮子定板。  
目标：把“复用谁、为什么复用、为什么不选别的”写清楚，阻断后面任何手搓 tracker / seed / 私有协议核心的冲动。

## 1. 先给总裁决

### 1.1 结论一句话

这一轮媒体主链的基础设施裁决固定为：

1. 浏览器 P2P 客户端：`webtorrent`
2. 第一阶段 canonical tracker：`bittorrent-tracker`
3. 高负载 tracker 备选：`wt-tracker`
4. 锚点种子节点：优先 `webtorrent` Node 进程；若 Node 侧浏览器互通在真实验证里被官方实现细节卡住，再退到 `webtorrent-hybrid`

### 1.2 为什么这样定

因为 `koko` 现在最需要的不是“再发明一套媒体协议世界”，而是：

1. 浏览器能直接工作
2. tracker 能支持 WebTorrent / WebRTC 场景
3. 锚点层能尽快作为独立进程落地
4. 后端 Rust 核心不被迫吞进 BitTorrent/WebRTC 协议复杂度

这条路线最符合：

1. DDD：业务真相仍留在 `domain / application`
2. Unix：tracker、seed、locator、消息真相各做各的一件事
3. 不重复造轮子：协议栈和 P2P 传输完全交给成熟实现

## 2. 官方资料里查到的关键事实

### 2.1 `webtorrent`

官方文档明确写了两件关键事：

1. `WebTorrent is a streaming torrent client for Node.js and the web. WebTorrent provides the same API in both environments.`
2. 文档 API 里直接把 tracker 选项指向 `bittorrent-tracker`，还支持 `urlList` web seeds 与 `client.seed(...)`

这说明：

1. 它是浏览器侧 canonical 客户端，没有争议
2. 它也是 Node 侧 seed 进程的第一候选
3. 它已经自带我们最需要的核心 API：`client.add / client.seed / announce / urlList / createServer`

来源：

- [WebTorrent API Documentation](https://webtorrent.io/docs)
- [webtorrent/webtorrent](https://github.com/webtorrent/webtorrent)

### 2.2 `webtorrent-hybrid`

官方仓库有一处非常值得诚实记录的张力：

1. 仓库首页写了：`This package is deprecated as of WebTorrent >= 2.3.0 as native WebRTC support has been added to WebTorrent.`
2. 但同一 README 又还保留着旧描述：Node 里的 `webtorrent` 只连 TCP/UDP peers，连浏览器 WebRTC peers 要用 `webtorrent-hybrid`

这代表什么：

1. 官方路线已经把 `webtorrent` 当成长期 canonical 包
2. 但 Node 侧连浏览器 peers 的文档口径还存在历史残留，不够干净

因此正确做法不是拍脑袋，而是：

1. 第一候选仍定 `webtorrent`
2. 但实现时必须做一个最小互通验证
3. 如果 Node 侧真实互通在当前版本/平台上有坑，再把 `webtorrent-hybrid` 只作为锚点 seed 进程的保守退路

注意：

- 这不等于“双活”
- 更不等于“让业务同时支持两套 P2P 核心”
- 只是 seed 节点进程的受控实现备选

来源：

- [webtorrent/webtorrent-hybrid](https://github.com/webtorrent/webtorrent-hybrid)
- [webtorrent/webtorrent](https://github.com/webtorrent/webtorrent)

### 2.3 `bittorrent-tracker`

`WebTorrent` 官方文档对 tracker 选项直接写明：

- `For possible values of opts.tracker see the bittorrent-tracker documentation.`

这意味着：

1. 它是 `webtorrent` 官方生态直接指向的 tracker 轮子
2. 它天然更适合当第一阶段 canonical tracker
3. 它的边界和 `webtorrent` API 心智一致，集成阻力最小

结合现有公开资料，它也是：

1. 支持 WebTorrent/WebSocket tracker 的成熟实现
2. 能跑成独立进程/服务

对 `koko` 的真正价值：

1. 先把“浏览器 peer 发现”做通
2. 先验证 tracker ticket / 私有群聊门禁如何挂接
3. 不在第一阶段同时追求“最强性能 + 最纯 Rust + 最多特性”

来源：

- [WebTorrent API Documentation](https://webtorrent.io/docs)
- [webtorrent/bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)

### 2.4 `wt-tracker`

`wt-tracker` 官方仓库给出的定位很直接：

1. `High-performance WebTorrent tracker`
2. README 写了明确的高并发数字：在 2 GiB / 1 vCPU VPS 上可处理大量 WSS peers
3. 它是专门做 WebTorrent tracker 的高性能实现

它的含义不是“立即取代第一候选”，而是：

1. 如果 `bittorrent-tracker` 在真实压测里成为瓶颈，`wt-tracker` 是非常像样的升级候选
2. 但它更偏 tracker 专项高性能轮子，不像 `bittorrent-tracker` 那样是 WebTorrent 官方文档直接牵出来的主线

所以这轮裁决是：

1. `wt-tracker` 进入备选清单
2. 不与 `bittorrent-tracker` 双活
3. 只有当第一阶段 tracker 明确扛不住，再考虑替换

来源：

- [Novage/wt-tracker](https://github.com/Novage/wt-tracker)

### 2.5 `torrust-tracker`

`Torrust` 官方站点自己的对比表写得很清楚：

1. `Torrust` 当前 `WebTorrent` 一栏是 `No`
2. 路线图里单列了 `Webtorrent`，说明它自己也承认这件事还在演进中

这对 `koko` 的意义非常简单：

1. 它现在不是浏览器 WebTorrent 场景的第一阶段候选
2. 不能因为它是 Rust 就硬塞进当前 canonical tracker 位置

来源：

- [Torrust Tracker 官方站点](https://torrust.com/torrent-tracker)

### 2.6 `aquatic`

同一张官方对比表里，`aquatic` 的 `WebTorrent` 一栏是 `Yes`。  
这说明它不是假候选，而是一个值得保留的 Rust 路线备选。

但当前阶段不把它放到第一位，原因是：

1. 我们这轮的目标不是“先追求最纯 Rust”
2. 我们更需要 `webtorrent` 官方生态里直接互咬、集成最顺的第一条路
3. `aquatic` 更适合放在“如果第一阶段 tracker 路线不满意，再对比评估”的位置

因此这轮裁决里：

1. `aquatic` 记入备选
2. 不作为第一阶段 canonical tracker

来源：

- [Torrust Tracker 官方对比表](https://torrust.com/torrent-tracker)

## 3. 最终裁决

### 3.1 浏览器 P2P 客户端

固定为：`webtorrent`

原因：

1. 官方客户端
2. 浏览器直接可用
3. API 已覆盖 `seed / add / tracker / web seeds`
4. 不需要我们再包第二套浏览器 P2P 核心

### 3.2 第一阶段 canonical tracker

固定为：`bittorrent-tracker`

原因：

1. `webtorrent` 官方文档直接指向它
2. 生态语言一致，最利于先做通
3. 更适合作为第一阶段“把边界先跑顺”的 tracker

### 3.3 高负载 tracker 备选

保留为：`wt-tracker`

触发条件：

1. `bittorrent-tracker` 在真实压测下出现明确瓶颈
2. 问题是 tracker 性能本身，而不是我们自己的 locator / ticket / seed 设计有问题

未触发前禁止：

1. 双活部署
2. 提前抽象一层“通用 tracker 适配框架”

### 3.4 锚点种子节点

第一候选：`webtorrent` Node 进程  
保守退路：`webtorrent-hybrid`

这里的边界必须写死：

1. 锚点种子节点是独立进程/边车，不进 Rust 业务核心
2. 它只负责 seed / warming / swarm 补位
3. 权限真相、locator 签发、附件 ready 真相都不在它身上

### 3.5 明确不选的路线

当前阶段明确不选：

1. `WebTorrent + IPFS/Helia` 双活
2. `BTFS`
3. `Torrust` 作为第一阶段 canonical tracker
4. 自己手搓 tracker / DHT / browser torrent client
5. 为“纯 Rust 洁癖”把协议复杂度重新搬回业务仓库

## 4. tracker ticket 放在哪一层

这件事如果放错层，后面一定烂。

正确边界：

1. `domain / application`
   - 判断谁有权拿 locator
   - 判断附件是否 `ready / degraded / deleted`
2. `adapter`
   - 把已授权结果翻译成短期 tracker ticket / locator
   - 把 ticket 交给 tracker 使用
3. `tracker`
   - 只做 peer 发现与 announce
   - 不拥有成员资格、消息真相、附件真相

所以，tracker ticket 的正确位置是：

- **后端 adapter 负责签发**

不是：

- 前端自己造
- tracker 自己查业务库裁权
- 业务 domain 直接知道 tracker 协议细节

## 5. 给后续实现的硬约束

1. 不允许为了图快，把 `wt-tracker` 和 `bittorrent-tracker` 同时挂上生产链路
2. 不允许把 seed 节点放进 Rust 单体里硬耦合
3. 不允许把 `magnet / tracker_urls / swarm peers` 塞进消息真相或领域事件
4. 不允许为了“更通用”再包一层私有 P2P 管理器核心
5. 允许做薄适配，但薄适配必须压缩复杂度，不能制造第二核心

## 6. 这轮对 `koko` 的真正含义

这次裁决的核心不是“Node 比 Rust 好”，而是：

1. 通用协议复杂度交给成熟生态
2. Rust 核心继续守住业务真相和稳定契约
3. 让图片和视频发送链以后变得可维护、可扩容、可排障

大白话就是：

- **业务继续纯 Rust**
- **P2P 协议层老老实实站在成熟轮子肩膀上**
- **不要为了语言洁癖把自己拖回手搓 tracker 屎山**
