# 群聊媒体 WebTorrent 协作分发与 24 小时 Web Seed 设计

日期：2026-04-11  
状态：Draft  
适用范围：`koko` 的群聊图片、视频分发主链  
关联文档：

- `docs/superpowers/specs/2026-04-11-群聊媒体上传切换到Tus与Rustus-design.md`
- `docs/superpowers/specs/2026-04-10-群聊媒体P2P热分发与锚点持久化-design.md`

## 1. 这份设计解决什么问题

当前仓库已经把首次上传主链收到了：

`prepare -> tus/rustus -> complete -> create_message`

这条链在代码里已经成立：

- `src/房间外壳.rs::prepare_media_upload()` 负责创建 `prepared` 附件并下发 Tus 契约。
- `src/房间外壳.rs::complete_media_upload()` 负责消费权威字节、提取媒体元数据、把附件升级成 `ready`。
- `frontend/媒体/媒体发布.ts::创建默认媒体上传器()` 已经改成 `@uppy/tus`，前端不再伪装成 S3 上传。

所以当前真正缺的不是“怎么让 A 把第一份字节传进来”，而是：

- 附件 `ready` 之后，后续观看者如何不再长期依赖服务器直出；
- 如何把看过的用户变成新的分发者；
- 如何让服务器只承担短期保底，而不是长期字节仓库。

## 2. 目标与非目标

### 2.1 目标

- 保留当前 `Tus/Rustus` 首次上传真相层，不重写 `prepare -> complete -> create_message`。
- 让 Linux 公网服务器只承担 24 小时字节保底。
- 前期只有 Web 时，浏览器就是主力 peer。
- 已观看用户默认进入协作上传集合，不提供关闭开关。
- 压力必须分散到 B/C/D/E 等多个 peer，不能退化成“所有人只从 B 拉”。
- 超过 24 小时后，如果网络里已经没有任何副本，附件允许自然失活，但消息继续存在。

### 2.2 非目标

- 不承诺永久免费保存所有媒体。
- 不把 IPFS / Helia / BTFS 拉进第一阶段主链。
- 不让 WebTorrent 取代 `Tus/Rustus` 的首次入站职责。
- 不在第一阶段就要求 iOS/Android/PC/CLI 一起上。
- 不承诺对已经拿到明文字节的恶意客户端做物理回收。

## 3. 候选路线与裁决

### 3.1 不选的路线

- 纯中心化直出：长期硬盘和带宽都回到服务器，直接违背产品方向。
- 纯 WebTorrent 主链：冷启动太脆，后端也拿不到稳定的第一份权威字节。
- IPFS / Helia / BTFS 主链：当前阶段复杂度过高，而且持久可用性仍依赖额外保活机制。

### 3.2 最终裁决

本项目媒体主链固定拆成两层：

1. 上传真相层：继续使用 `Tus/Rustus`
2. 协作分发层：使用 `WebTorrent + 私有 swarm 门禁 + 24 小时 Web Seed`

一句话：

`Tus` 负责“让内容先成立”，`WebTorrent` 负责“让内容继续扩散”。

## 4. 关键边界

### 4.1 后端仍是业务真相权威

后端只掌握这些事实：

- 附件是否存在
- 附件属于谁
- 附件当前是否 `prepared / ready / degraded / deleted`
- 哪条消息引用了哪个附件
- 当前请求者是否有权拿到附件分发元数据

后端不把这些运行态当作业务真相：

- 当前 peer 数
- tracker 是否抖动
- 谁现在缓存了哪些块
- 某次 WebRTC 握手是否成功

### 4.2 服务器只做 24 小时保底源

Linux 服务器对每份媒体只承担：

- 初始可达；
- swarm 冷启动兜底；
- 24 小时内补缺块。

24 小时一到：

- 服务器删字节；
- 后端保留元数据；
- swarm 继续或自然失活。

### 4.3 Web 前端在前期就是主力 peer

前期只有 Web，所以浏览器不是“顺手帮忙”，而是第一代主力分发节点。  
但要同时承认它的运行时边界：

- 关页就断；
- 后台会被冻结或限速；
- 缓存清理不可控。

因此正确结论是：

- 前期 Web 是主力 peer；
- 但 Web 不是永久 keeper。

## 5. 端到端数据流

### 5.1 A 发送图片/视频

1. 前端调用 `prepare_media_upload()`。
2. 后端创建 `prepared` 附件并下发 Tus 契约。
3. A 通过 `Tus/Rustus` 上传第一份权威字节。
4. 后端 `complete_media_upload()` 消费字节并把附件升级成 `ready`。
5. 只有这一步之后，消息才允许引用该附件。

这里必须写死：

- `WebTorrent` 不参与“附件从无到有”的真相建立。

### 5.2 附件 ready 后生成分发元数据

附件 `ready` 之后，系统生成分发侧最小锚点：

- `attachment_id`
- `content_id`
- `content_hash`
- `swarm_id` 或 `torrent_info_hash`
- `web_seed_until`

这些元数据只服务于后续分发，不决定消息是否成立。

### 5.3 B 第一次观看

1. B 点击媒体。
2. 前端先向后端请求附件分发元数据，而不是假设某个直链永远存在。
3. 后端校验权限。
4. 权限通过后，返回：
   - swarm ticket
   - magnet/torrent 元数据
   - web seed 信息
5. B 客户端优先向 peer 请求块。
6. 如果此时 swarm 还弱，就从 24 小时 web seed 补块。
7. B 拿到块后，自动进入协作上传集合。

### 5.4 C / D / E 后续观看

正确目标不是“都从 B 一个人拉”，而是：

- 文件按 piece 分发；
- 后来的观看者同时向 B / C / D / E / web seed 请求不同块；
- 服务器只补缺口，不长期包办全部字节。

### 5.5 清缓存后重新观看

用户以前是否看过，不重要。  
只要本地现在没有块，就像新请求者一样重新加入 swarm。  
判断依据只有一个：

**当前网络里是否还有可达副本。**

### 5.6 24 小时之后

- 如果 swarm 里还有副本，附件继续可用；
- 如果已无任何副本，附件进入“当前不可获取”；
- 消息继续存在，不被误判为删除或无效。

## 6. 协作分发规则

### 6.1 不允许把压力全部给一个 B

实现如果退化成：

- B 看过；
- 后面所有人都默认只从 B 拉；

那就说明 swarm 设计失败了。

### 6.2 目标是榨干整体 swarm，而不是保护单个用户

前期产品哲学已经明确：

- 不提供“关闭协作上传”开关；
- 观看过、缓存过、拿到过块的在线用户，默认都进入资源池；
- 控制面存在的目的，是避免 swarm 自己乱掉，不是保守地少传。

### 6.3 仍然需要调度，不是无限裸传

需要调度的原因不是“保护用户”，而是：

- 避免所有连接都压到一个 peer；
- 避免浏览器开无限连接先把自己卡死；
- 避免重复拉同一批块，浪费总吞吐。

所以后续调度目标应写成：

- 最大化 swarm 总吞吐；
- 最小化单点热点。

## 7. 权限、门禁和治理

### 7.1 不走公开 tracker

如果直接把群聊媒体丢给公开 tracker，后端就失去准入门禁。  
这和当前房间/成员权限模型冲突。

### 7.2 推荐形态：私有 WSS tracker + 后端签发短期 swarm ticket

流程固定为：

1. 客户端向后端请求附件分发元数据；
2. 后端校验会话、房间成员资格、附件状态；
3. 校验通过后，签发短期 swarm ticket；
4. 客户端拿 ticket 加入对应 swarm。

这样 tracker 只负责 peer 发现，不负责业务裁决。

### 7.3 删除 / 封禁

后端删除或封禁附件时，至少必须做到：

- 停止签发 swarm ticket；
- 停止返回 web seed；
- cooperative 客户端收到 tombstone 后停止继续分享并清理缓存。

但不能对外承诺：

- 技术上抹掉所有已经发出去的明文字节。

## 8. 实施分期

### Phase 1：补齐分发元数据

- 不碰现有 `Tus/Rustus` 主链；
- 只为 `ready` 附件补齐 `content_id / content_hash / swarm_id / web_seed_until`。

### Phase 2：让 Web 前端进入 swarm，服务器 24 小时保底

- 发送成功后开始 seed；
- 查看时优先尝试 swarm，再回退 web seed。

### Phase 3：强化多 peer 调度

- 多 peer 并发拉取；
- 服务器只补缺块；
- 避免单个 B 成为唯一热点。

### Phase 4：引入强 peer

- 桌面 helper；
- NAS keeper；
- 志愿 seed 节点。

这一阶段主要解决 24 小时之后的长尾可用性。

## 9. 实施时最容易漂移的点

后续写计划和代码时，必须守住这五条。

1. 不允许 `WebTorrent` 取代 `Tus/Rustus` 的首次入站职责。
2. 不允许用 peer 可达性去定义消息成立。
3. 不允许把 `seeding / peerless / tracker_failed` 这类运行态做成领域状态。
4. 不允许把“Web 前期主力 peer”实现成“浏览器看完就算了”的假 swarm。
5. 不允许把 24 小时 web seed 偷偷扩张成长期仓库。

## 10. 验证要求

这部分不是计划明细，但以后实现至少要证明这些事情。

### 10.1 上传真相层回归

- `prepare` 仍然只创建 `prepared`
- `complete` 仍然只在权威字节成立后升级 `ready`
- `create_message` 仍然只引用 `ready` 附件

### 10.2 协作分发层回归

- A 发出后，B 第一次观看可以从服务器补块成功；
- B 看过后，C 来时不只连接 B；
- C / D / E 看过后，后续观看者可以从多 peer 并行拿块；
- 24 小时后服务器退出时，如果 swarm 还有 peer，附件继续可用；
- 24 小时后如果已无任何副本，附件进入“当前不可获取”。

### 10.3 权限与治理回归

- 非成员拿不到 swarm ticket；
- 附件被删/封后，后端不再返回 swarm 准入和 web seed；
- cooperative 客户端收到 tombstone 后停止继续分享。

## 11. 最终结论

本项目图片/视频的 canonical 路线正式定为：

**首次入站：`Tus/Rustus`**  
**后续扩散：`WebTorrent + 私有 swarm 门禁 + 24 小时 Web Seed`**

这条设计只表达三件事：

1. 后端继续掌握业务真相，消息只引用 `ready` 附件。
2. Linux 服务器只做 24 小时字节保底，不做长期媒体仓库。
3. 前期 Web 前端就是主力 peer，所有在线观看者默认进入强制协作上传集合，并通过多 peer 并发共同分担压力。

## 12. 参考资料

- WebTorrent 文档：<https://webtorrent.io/docs>
- WebTorrent 项目主页：<https://webtorrent.io/>
- BitTorrent 协议（BEP 3）：<https://www.bittorrent.org/beps/bep_0003.html>
- Web Seed（BEP 19）：<https://bittorrent.org/beps/bep_0019.html>
- Helia：<https://ipfs.github.io/helia/>
- IPFS Persistence：<https://docs.ipfs.tech/concepts/persistence/>
- BTFS Overview：<https://docs.btfs.io/v2.3.5/docs/btfs-overview>
- BTFS Storage Rental：<https://docs.btfs.io/v1.0/docs/storage-rental>

