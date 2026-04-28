# WebTorrent 满血协同分发要求

日期：2026-04-23（2026-04-28 融合）
状态：Authority / Implemented
适用范围：`koko` 的新上传图片/视频附件、`WebTorrent` 正式媒体字节主链、前 `24 小时` 后端强 seed、`24 小时` 后纯 peer 接力、时间线自动播放、查看器、全屏、后台补齐、帮助任务恢复、失败态与删除态。
上层总纲：`docs/superpowers/specs/2026-04-25-项目视频播放要求.md`

本文件统一取代并吸收以下旧 spec：

- `2026-04-22-WebTorrent高速分发防止群友偷懒.md`
- `2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`

上述旧文件只作为 git 历史存在，不再作为第二入口；其关键裁决、边界、验证门禁与完工记录已经融合进本文。

关联文档：

- `docs/superpowers/specs/2026-04-25-项目视频播放要求.md`
- `UIUX禁令.md`
- `学习/浏览器中的应用-前端应用化方案.md`
- `学习/整理笔记/浏览器内应用与前端应用化官方实践笔记.md`
- `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`

官方与生态依据：

- WebTorrent Docs：<https://webtorrent.io/docs>
- WebTorrent FAQ：<https://webtorrent.io/faq>
- BitTorrent BEP 3：<https://www.bittorrent.org/beps/bep_0003.html>
- BitTorrent BEP 19：<https://www.bittorrent.org/beps/bep_0019.html>
- simple-peer：<https://github.com/feross/simple-peer>
- bittorrent-tracker：<https://github.com/webtorrent/bittorrent-tracker>

---

## 0. 总裁决

**`koko` 的正式媒体内容字节只允许走唯一 `WebTorrent` whole-file swarm 主链；前 `24 小时` 后端只能作为 swarm 内强 seed 参与，`24 小时` 后退出该附件的媒体字节供给；每个看过或自动播放过且仍在线的群友，都应尽量被养成后来者的帮助者；群越活跃，分发越强；没人能发时，系统必须说真话。**

这句话自然推出十条最高红线：

1. 禁止第二正式播放主链。
2. 禁止第二正式分发链。
3. 禁止新媒体继续依赖 `HLS / DASH / original_url / CDN / range` 直链作为正式媒体字节来源。
4. 禁止把 `poster / still / thumbnail` 做回新媒体正式查看真相。
5. 禁止把后端 `WebSeed / WebRTC seeder` 偷换成前端绕开 swarm 的服务器直播。
6. 禁止滑走、失焦、切消息后默认停止后台补齐和帮助任务。
7. 禁止把自动播放用户降级成一次性消费者。
8. 禁止把片段帮助者排除出 swarm 有效协作面。
9. 禁止把“当前没有在线种子”和“内容已删除”混成一类。
10. 禁止把浏览器、移动端、弱网或运行时上限包装成第二套保守产品真相。

---

## 1. 这份文档真正解决什么

旧两份 spec 分别压住了两类漂移：

1. `2026-04-22` 文档负责裁死“只允许 `WebTorrent` 主链、`24 小时` 后服务器退字节、失败态说真话”。
2. `2026-04-23` 文档负责裁死“看过就要继续帮、多来源并行、片段 peer 有价值、群越活跃越强”。

两份文档的真实关系不是并列，也不是前后打架，而是一条连续主线：

**先禁止第二主链，再把唯一主链做满血；先让服务器前期足够强，再让群友后期接得住；先保证系统不撒谎，再让活跃度真正变成分发能力。**

因此本文不再拆成“防偷懒”和“越活跃越强”两个入口，而是统一为一份 WebTorrent 分发要求。

---

## 2. 主链唯一性

### 2.1 正式媒体字节只认 WebTorrent

对新上传并 `complete` 的图片/视频附件，前端正式媒体内容字节只允许从同一条 `WebTorrent` swarm 会话进入时间线、查看器与全屏。

允许存在的控制面：

1. 鉴权。
2. 房间消息。
3. metainfo / torrent metadata。
4. tracker signaling。
5. peer presence。
6. 删除通知。
7. 状态查询。

这些控制面可以走 `HTTPS/WSS`，但它们不拥有正式媒体字节真相。

### 2.2 禁止第二主链

新媒体链路禁止长期保留或新增：

1. `HLS / DASH` 正式播放链。
2. `original_url` 正式查看链。
3. 前端播放器直接拉服务器原文件的正式路径。
4. CDN 正式兜底链。
5. 临时 range 服务正式兜底链。
6. 只给查看器用的第二媒体源。
7. 只给时间线用的第二媒体真相。
8. 只为首屏好看而生成的服务器 thumbnail / still 正式资产。

如果某条路径仍然存在，只能是 legacy 兼容、benchmark、迁移期隔离或控制面，不能继续承担新媒体正式播放字节。

### 2.3 旧媒体兼容边界

本文默认前向生效：

1. 新上传并 `complete` 的附件必须进入 WebTorrent 主链。
2. 已经落地的 legacy `HLS / poster / thumbnail / still` 资产可以作为历史债务暂时存在。
3. 历史 backfill、批量重种、旧资产清理应在独立 plan 中处理，不能阻塞新主链真相收口。
4. 允许按附件代际区分 legacy 与新链路，但禁止新附件继续落回旧真相。

---

## 3. 官方与生态边界

### 3.1 WebSeed 是 swarm 成员，不是第二主链豁免证

BitTorrent / WebTorrent 允许 `WebSeed`、tracker、metainfo、浏览器 WebRTC peer 与服务器种子共同存在。
本项目允许服务器在前 `24 小时` 很强，但只允许它强在 swarm 内。

正确理解是：

1. 后端可以作为 `WebSeed` 把稳定吞吐注入 swarm。
2. 后端可以通过真正可被浏览器 peer 连接的 `WebRTC seeder` 参与分发。
3. 浏览器 peer 可以同时连接服务器强 seed 与其他群友。
4. 所有来源都属于同一个 swarm 平面。

错误理解是：

1. 口头说 `WebTorrent` 主链，实际前端继续直连服务器播放。
2. `WebTorrent` 只做后台装饰。
3. 群友几乎没有上传压力。
4. swarm 永远热不起来。

### 3.2 多来源并行是主线，不是可选优化

BitTorrent / WebTorrent 的正常形态不是单来源串行下载，而是：

1. 同时向多个来源请求不同 piece。
2. 谁在线、谁快、谁手里有缺的片段，谁就多发一点。
3. `WebSeed`、浏览器 peer、本地缓存可以共同组成当前分发面。
4. tracker / signaling / NAT 穿透等基础设施配合调度连接。

因此 D 新进入时，目标不是“只连服务器”或“只连 A”，而是尽量同时吃 `服务器强帮助者 + A/B/C 片段帮助者 + 完整帮助者`。

### 3.3 高吞吐不等于无限全连

本文要求产品语义激进，但不要求底层愚蠢：

1. 允许单 torrent peer 连接上限。
2. 允许请求队列上限。
3. 允许单页面并发 swarm 数上限。
4. 允许浏览器内存、带宽、socket、DataChannel、后台标签调度等硬边界。

但这些只能是基础设施级硬边界，不能上抬成产品层保守规则。
禁止用“浏览器有限”为理由写死“默认只保最近 `3-5` 条帮助任务”“移动端默认不补齐”“弱网默认不帮别人”“滑出视口就停”。

---

## 4. 权威时间与服务器退字节

### 4.1 `24 小时` 起点只认 complete_at

`24 小时` 倒计时的权威起点是：

**后端 `complete` 成功落权威事实的 `complete_at`。**

禁止使用：

1. 首次观看时间。
2. 前端本地时间。
3. 消息发送时间的粗糙替代。
4. 首次进入 swarm 的动态时间。
5. 浏览器会话自己的推测。

倒计时必须由后端权威时钟写入并持久化，进程重启不得重置。

### 4.2 前 24 小时：服务器必须很强

前 `24 小时` 内，后端不是旁路 CDN，而是 swarm 内强帮助者。它必须尽量承担：

1. `WebSeed` 字节供给。
2. 浏览器可连的 `WebRTC seeder` 字节供给。
3. 冷启动阶段的高吞吐推进。
4. 让 A/B/C 尽快补齐并成为后来者帮助者。

禁止因为“怕看起来不够 P2P”而让服务器装弱。装弱不会更去中心化，只会让 swarm 烧不起来。

### 4.3 后 24 小时：服务器退出媒体字节

`complete_at + 24h` 到点后，后端必须停止该附件的：

1. `WebSeed` 字节供给。
2. `WebRTC seeder` 字节供给。
3. 任何直接或间接变成前端第二正式媒体链的兜底路径。

保留的是控制面，不是媒体字节：

1. 附件存在性真相。
2. `infohash / magnet / torrent metadata`。
3. tracker / signaling。
4. 鉴权与房间关系。
5. 删除语义。
6. 当前是否能探测到可恢复来源的状态事实。

### 4.4 web_seed_until 是新主链服务器退字节真相

新主链附件的服务器退字节裁决必须以 `attachment_distribution_metadata.web_seed_until` 为权威。
没有协作分发表的历史附件，才允许回退到 `attachments.origin_expires_at` 作为 legacy 兼容。

禁止同一附件出现双真相：

1. locator 已经进入 `MEDIA_CONNECTING_TO_PEERS / MEDIA_NO_ONLINE_SEED`。
2. `/api/attachments/{attachment}/content?variant=original` 却还能继续返回正式媒体字节。

读取附件内容、查询媒体定位、壳层 `origin` 描述，都必须共享同一条服务器退字节时间。
`origin_deleted_at` 只表达物理删除终态；它可以让冷源更早失效，但不能重新定义服务器是否仍可对外发正式媒体字节。

---

## 5. 角色、状态与帮助语义

### 5.1 角色

| 角色 | 定义 |
| --- | --- |
| 发片人 | 把附件发进群并完成上传的人 |
| 服务器强帮助者 | 前 `24 小时` 内参与 swarm 的后端强 seed，包括 `WebSeed` 与真正可连的 `WebRTC seeder` |
| 已看群友 | 自动播放或点开过该附件的在线群友 |
| 后来者 | 较晚进入该附件播放/查看链路的用户 |
| 返回者 | 之前看过，后来刷新、关闭或离开，之后又回来且本地数据仍在的用户 |

### 5.2 peer 类型

| 术语 | 定义 |
| --- | --- |
| `viewer_intent` | 用户已经进入观看/自动播放意图，但不能单独证明媒体可用 |
| `partial_peer` | 当前虽未持有完整 payload，但已持有别人缺少的有用片段，能够参与协作分发 |
| `complete_peer` | 已持有完整 payload，能够稳定继续做种 |
| `backend_strong_seed` | 前 `24 小时` 内后端提供的 swarm 内强来源 |
| `available source` | 本地完整 payload、本地已足够显示/播放的权威字节、前 `24 小时` 的后端强 seed、当前重试窗口内可用的完整或可恢复片段来源 |

关键边界：

1. `partial_peer` 有价值，但不能直接把状态抬成 `MEDIA_READY`。
2. `complete_peer / backend_strong_seed / 本地完整 payload` 是最清晰的 ready 来源。
3. 后 `24 小时` 阶段不能因为缺少单个完整 peer 就过早误杀；如果多个片段来源能真实拼出首播关键字节与持续补齐能力，也应允许恢复。
4. 不能因为存在几个零散碎片，就在拼不出任何可恢复来源时撒谎说 ready。

### 5.3 contract 状态

| Contract code | 含义 | 默认 UI 文案 | 进入条件 | 退出条件 |
| --- | --- | --- | --- | --- |
| `MEDIA_READY` | 当前已具备正式 payload 可用字节来源 | 不额外提示 | 本地已完整、已连上可用来源、或仍在 `0-24 小时` 且后端强 seed 可用 | 访问时需要重新找 peer 且当前暂无来源，可转入 `MEDIA_CONNECTING_TO_PEERS` |
| `MEDIA_CONNECTING_TO_PEERS` | 附件仍存在，系统正在合理重试窗口内寻找可用来源 | `正在尝试连接群友` | `24 小时` 后访问时缺少当前可用来源；或从 `MEDIA_NO_ONLINE_SEED` 被触发重试 | 找到来源回到 `MEDIA_READY`；超时转入 `MEDIA_NO_ONLINE_SEED`；附件被删转入 `MEDIA_DELETED` |
| `MEDIA_NO_ONLINE_SEED` | 附件仍存在，但当前重试窗口结束后仍无可恢复来源 | `当前没有在线种子，等待群友上线` | `MEDIA_CONNECTING_TO_PEERS` 在重试预算内未找到来源 | 手动重试、周期探测、收到 peer 恢复信号后重新进入 `MEDIA_CONNECTING_TO_PEERS`；附件被删转入 `MEDIA_DELETED` |
| `MEDIA_DELETED` | 附件已被删除，不再允许恢复 | `内容已删除` | 删除权威事实成立 | 不允许退出 |

前端文案只能从稳定 contract code 派生，不能自己再发明另一套状态机。
本地仍握有完整 payload 的客户端，在附件未删除前可以直接 `MEDIA_READY`；删除权威事实一旦成立，必须无条件切到 `MEDIA_DELETED`。

### 5.4 默认重试节奏

默认参数先写死：

1. 单次 `MEDIA_CONNECTING_TO_PEERS` 尝试窗口默认 `8 秒`。
2. 窗口内 tracker / presence / swarm 可用性探测默认按 `2 秒` 周期重试。
3. `8 秒` 内出现 `available source`，立即回到 `MEDIA_READY`。
4. `8 秒` 到点仍无来源，转入 `MEDIA_NO_ONLINE_SEED`。
5. `MEDIA_NO_ONLINE_SEED` 且媒体壳仍活跃时，默认每 `15 秒` 发起一次新连接尝试。
6. 用户手动点击重试，可立即重新进入 `MEDIA_CONNECTING_TO_PEERS`。

这些数值后续可以配置，但默认语义和量级不能被重新放空。

---

## 6. 一段媒体进入群后的 48 小时故事

### 6.1 第 0 分钟：complete 成立

发片人完成上传后，后端必须：

1. 落附件 `complete` 权威事实。
2. 生成唯一正式 payload 分发真相。
3. 写入 `complete_at`。
4. 写入 `web_seed_until`。
5. 生成 `infohash / magnet / torrent metadata / piece` 元信息。
6. 把服务器强帮助者加入 swarm。

从这一刻开始，目标不只是“第一个人能播出来”，而是尽快把这段媒体养成越来越强的协同分发网。

### 6.2 A 第一个看

A 第一个滑到或点开该媒体时：

1. A 先拿到首播或首屏关键片段。
2. A 继续补齐完整 payload。
3. A 滑走后可以停止前台解码和视觉 owner。
4. A 的后台补齐和帮助任务默认继续。
5. A 拿到的片段应尽快对 B/C/D 有价值。

禁止把 A 的观看只当成一次消费。

### 6.3 B、C 也看过

B、C 自动播放或点开后，A/B/C 不能被理解成三个互相隔离的消费者。正确理解是：

1. 三人都在积累 piece。
2. 三人都可能成为后来者来源。
3. 未完整也可能已经有别人缺的有用片段。
4. 前 `24 小时` 服务器仍很强，但不再是唯一来源。

### 6.4 D 新进入

D 新进入时，目标不是找唯一来源，而是从活着的帮助者里并行拉：

1. 前 `24 小时` 同时吃服务器强帮助者。
2. 同时吃 A/B/C 已有的有用片段。
3. 同时利用完整帮助者。
4. 谁快、谁有 D 缺的 piece，谁就多发。

禁止单来源串行，禁止先等一个来源失败再试下一个。

### 6.5 D 继续帮助 E、F

D 看过后也不是终点：

1. D 自己继续补齐。
2. D 已持有的片段立刻对 E/F 可见。
3. D 完整后升级为完整帮助者。
4. A/B/C 帮 D，D 再帮 E/F，活跃度转成分发能力。

### 6.6 24 小时后 G、H 再进入

到了 `24 小时`，服务器退出媒体字节供给。
但只要 A/B/C/D/E/F 中仍有人在线，且手里有 G/H 需要的可恢复字节，G/H 仍应被群友接住。

后 `24 小时` 的真相不是：

1. 服务器一退所有人立刻死。
2. `24 小时` 后媒体天然不该好播。
3. 只有单个完整 peer 才允许恢复。

真实裁决是：

1. 前 `24 小时` 服务器负责把网养热。
2. 后 `24 小时` 群友负责继续接力。
3. 群友越活跃、留下的数据越多，后来者越容易被接住。
4. 当前确实没人能发时，系统必须说真话。

### 6.7 A 离开后回来

A 可能刷新、关闭标签页、浏览器重启，过一阵子再回来。规则是：

1. 如果 A 本地数据仍在，应尽量恢复之前的帮助任务。
2. 如果 A 主动清缓存或清站点数据，视为明确结束那批旧帮助任务。
3. 禁止页面一关就把所有帮助记忆失忆。
4. 禁止用户清缓存后系统还强行复活旧帮助任务。

---

## 7. 前端运行时规则

### 7.1 时间线、查看器、全屏共享同一媒体真相

时间线、查看器、全屏不能是三条媒体链。它们只是同一 payload、同一 swarm 会话、同一播放/查看真相的不同壳层表达。

禁止出现：

1. 时间线是 torrent，查看器变直链。
2. 时间线看 payload，查看器看 still/poster。
3. 全屏重新创建第二媒体会话。
4. 时间线、查看器、全屏各自维护第二 owner。

### 7.2 自动播放算进入帮助链

自动播放和点开查看器都算正式进入帮助链：

1. 自动播放用户不降级成二等观看者。
2. 不要求用户显式表达“愿意帮助别人”。
3. 自动播放触发后，系统应尽量补齐并继续帮助后来者。

如果只把查看器用户算帮助者，群里大量时间线自动播放用户就不会转成分发能力。

### 7.3 滑走不停补齐

滑走、失焦、切消息后，可以停止：

1. 高负载解码。
2. 当前活跃渲染 owner。
3. 前台 UI 资源争用。

不能默认停止：

1. 已开始的后台补齐。
2. 已持有片段的对外帮助。
3. 帮助任务本身的继续生长。

### 7.4 不主动裁掉旧帮助任务

活跃群里，一个用户可能自动播放过 `10` 条、`20` 条视频。产品层默认不主动写死：

1. 只保最近 `3-5` 条。
2. 只保当前屏幕内。
3. 只保最热视频。
4. 只保查看器打开过的媒体。

底层如果确实需要资源仲裁，只能作为运行时硬边界存在，不能改变产品承诺，更不能包装成“默认只帮几条”的新产品哲学。

### 7.5 图片也走同一真相

本文覆盖图片，不只覆盖视频：

1. 图片正式查看字节统一来自 WebTorrent payload。
2. 支持渐进式或分段可解码显示的格式，应优先使用同一 payload 的早期可解码字节。
3. 不支持渐进式解码且本地无预览缓存时，允许稳定应用级占位态。
4. 占位态是 UI 态，不是服务器生成的第二资产。
5. 一旦 payload 达到完整解码门槛，立即切入正式图像显示。

图片冷启动允许“先稳定占位、后真实显示”，不允许“为了避免占位而偷偷回服务器拿缩略图”。

---

## 8. 本地缓存、删除与会话恢复

### 8.1 服务器退场不等于本地失忆

`24 小时` 退场只影响服务器字节供给，不会让本地完整 payload、本地已下载 piece、本地派生预览缓存自动失效。

只要附件未删除：

1. 本地完整 payload 可以继续播放/查看。
2. 本地完整 payload 可以继续做种。
3. 本地已下载 piece 可以继续帮助别人。
4. 页面重开后应尽量恢复当前房间内本地仍完整的帮助任务。

### 8.2 删除优先级最高

删除权威事实一旦成立：

1. 当前帮助任务必须退出。
2. 本地完整 payload、部分 piece、派生预览缓存进入 purge。
3. 当前活跃媒体壳尽快切到 `MEDIA_DELETED`。
4. 本地缓存不能继续装作 `MEDIA_READY`。

“暂无在线种子”是可恢复缺席态，“内容已删除”是不可恢复终态，两者必须是不同 code。

### 8.3 session-aware 缓存

locator 持久化缓存与 `.torrent` 描述缓存必须 session-aware：

1. 后端失败时只允许回退同 session 缓存。
2. 禁止跨 session 复用旧真相。
3. 帮助任务恢复必须受房间与本地数据约束。
4. 跨房间缓存不能误恢复成本房间帮助任务。

---

## 9. 质量裁决

默认禁止：

1. 降分辨率。
2. 降码率。
3. 降帧率。
4. 生成更糊的第二正式视频版本。
5. 用“更好播”为名做隐性降质重编码。

允许的优化：

1. 直通。
2. `remux`。
3. `faststart`。
4. 不改变清晰度的容器级优化。
5. piece 选择与缓存策略优化。
6. owner 调度与资源预算优化。

秒开要靠单一主链、早期关键片段优先、前 `24 小时` 后端强 seed、滑到即补齐、补齐后做种、统一 owner 调度，不能靠第二链、服务器封面图、降质版本或模糊失败态伪造。

---

## 10. 实现红线

后续写 plan 和落代码时，禁止越过下面这些红线：

1. 禁止新增前端正式媒体直链入口。
2. 禁止恢复 `HLS / DASH / CDN / original_url` 为新媒体正式播放主链。
3. 禁止让 `poster / still / thumbnail` 回到新媒体正式真相。
4. 禁止让时间线、查看器、全屏维护第二套媒体 owner。
5. 禁止把自动播放用户从帮助链剔除。
6. 禁止把滑走、失焦、切屏默认实现成帮助任务结束。
7. 禁止把多人并行帮助偷换成单来源或伪串行拉取。
8. 禁止把片段帮助者排除出 swarm 有效成员集合。
9. 禁止在产品层写死“只保最近几条帮助任务”。
10. 禁止为移动端、弱网、某浏览器单独长出第二套保守协作分发真相。
11. 禁止 `24 小时` 后服务器继续承担该附件第二字节主链。
12. 禁止把后 `24 小时` 的失败态重新做成模糊加载失败。
13. 禁止把“当前没有人能发”和“内容已删除”混成一类。
14. 禁止把底层协议/运行时硬边界上抬成产品退缩借口。
15. 禁止以降质换取所谓秒开。

---

## 11. 验证门禁

后续 plan 与实现至少要证明下面这些事实：

1. 新上传图片和视频，前端正式内容字节都从同一条 `WebTorrent` 主链进入时间线与查看器。
2. 前 `24 小时` 内，后端确实以 `WebSeed + WebRTC seeder` 身份参与 swarm。
3. 相对 `/api/swarm/announce` 必须被前端 adapter 收口成 `ws/wss` tracker transport，不能被当成普通 HTTP 资源。
4. A/B/C 自动播放或看过同一附件后，D 新进入时体现为多来源并行，而不是单来源串行。
5. `partial_peer` 能参与帮助，但不能单独把 `MEDIA_READY` 抬起来。
6. 用户滑到媒体后，即使滑走，后台补齐仍继续。
7. payload 补齐完成后，客户端进入做种态，而不是只缓存不上传。
8. 查看器、全屏与时间线共享正式媒体真相，不存在查看器回直链。
9. 同一用户在活跃群里自动播放过多条视频后，产品层不能偷偷裁掉旧帮助任务。
10. 页面重开后，若本地完整缓存仍在，当前房间内附件会恢复帮助任务；若用户主动清缓存，则旧帮助任务不应强行恢复。
11. `24 小时` 前后切换只认后端 `complete_at`，服务重启不重置。
12. `24 小时` 后，后端对该附件停止媒体字节供给，且 locator 与原图内容端点共享 `web_seed_until` 退字节真相。
13. `24 小时` 后若群友集合仍能提供首播关键字节与持续补齐字节，后来者仍应被接住。
14. `24 小时` 后若合理重试窗口内确实找不到任何可恢复来源，前端必须进入 `MEDIA_NO_ONLINE_SEED`。
15. 附件删除后，前端必须进入 `MEDIA_DELETED`；本地缓存不能继续伪装 ready。
16. 图片冷启动不会偷偷请求服务器 thumbnail；不支持渐进式显示时进入稳定占位态。
17. 全链路没有生成更糊的第二正式媒体版本。
18. `chrome-devtools-cli` 真实烟测至少覆盖 `https://localhost` 或 `https://127.0.0.1`、房间 `1234b`、sender / A / B / C / D 多隔离上下文、图片和视频、前 `24 小时` 强 seed、后 `24 小时` 纯 peer、无在线种子与内容已删除。

---

## 12. 已完成收口记录

### 12.1 2026-04-22：主链、失败态与退场语义落地

本轮已完成：

1. Rust 协作分发状态机落地 `MEDIA_READY / MEDIA_CONNECTING_TO_PEERS / MEDIA_NO_ONLINE_SEED / MEDIA_DELETED`。
2. 前端时间线/查看器统一消费 `media_state.code`，不再把新附件回退到第二正式播放链。
3. `presence` 语义收口为 `viewer_intent / complete_peer / backend_strong_seed`，`available` 只认真实可用来源。
4. 运行态真相迁移到 `swarm_peer_presence`，移除 `attachment_distribution_metadata.last_peer_seen_at` 旧字段。
5. 相关回归覆盖空 body presence 不误抬 `MEDIA_READY`、shared swarm 合法续命、backend strong seed 合法续命、连接群友态、无在线种子态、删除终态、协作分发片段可用性。

已执行验证：

- `cargo test -j 1`
- `pnpm --dir frontend test`
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend build`
- `pwsh -File tests/启动器脚本检查.ps1`

真实烟测记录：

- `https://localhost`
- 房间 `1234b`
- sender / viewer 双隔离上下文
- viewer 正式播放命中 `GET /webtorrent/{infohash}/content-*.mp4 [206]`
- 同时可见 locator / torrent / presence 控制面请求

### 12.2 2026-04-23：高活跃帮助链落地

本轮已完成：

1. 后端 `swarm_peer_presence` 扩展 `partial_peer`，但 `MEDIA_READY` 仍只认 `complete_peer / backend_strong_seed / 可用 web_seed`。
2. 前端协作分发 runtime 默认 eager 补齐，进入 swarm 后先上报 `partial_peer`，补齐完成后升级为 `complete_peer`。
3. 视频协作补齐去掉 `reuseOnly` 保守门槛。
4. 页面重开后，只要本地完整缓存仍在，当前房间内附件会恢复帮助任务。
5. `聊天媒体编排` 修正帮助任务生命周期：进入帮助链后，不因暂时退出当前时间线消息集合而立刻释放；真正结束条件只剩删除态、显式清空和真实销毁。

真实烟测记录：

- `https://localhost`
- 房间 `1234b`
- sender / A / B / C / D 多隔离上下文
- A/B/C/D 入房后真实发起 locator / torrent / `webtorrent/{infohash}/content-*.mp4` 请求
- A/B/C 点开同一视频后真实上报 presence
- 数据库同一附件同时出现多个 `complete_peer` 和 `backend_strong_seed`
- 人工拨过 `web_seed_until` 并清空 peer presence 后，前端先进入“正在尝试连接群友”，再落到“当前没有在线种子，等待群友上线”
- 切删除终态后，前端重试立即切成“内容已删除”

### 12.3 2026-04-24：兼容尾巴与缓存真相收口

本轮已完成：

1. locator 顶层 `original_url` 从正式表面退场；冷源锚点只保留在 nested asset 的 `origin`。
2. 前端定位、播放、协作分发删除 `locator.original_url` fallback。
3. 单 worker owner 运行时快照收口为 `workerRegistered / workerWaiting`，双入口兼容字段退场。
4. 视频预览 owner 删除 `canonical/original` 冷源回退，预览只认 swarm 主链。
5. `reuseOnly` 从生产接口、运行时分支和测试依赖里退场，并增加架构门禁。
6. locator 缓存与 `.torrent` 缓存改成 session-aware。
7. 帮助任务恢复扩到“当前房间且本地完整缓存仍在的附件集合”。

已执行验证：

- `cargo test --test 协作分发测试 -- --nocapture`
- `cargo test --test 流媒体资产契约测试 -- --nocapture`
- `cargo test --test 媒体测试边界守卫 -- --nocapture`
- `cargo test -j 1`
- `pnpm --dir frontend test`
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend build`
- `node scripts/check-frontend-architecture-fitness.mjs`
- `node scripts/check-frontend-browser-app-constitution.mjs`
- `pwsh -File tests/启动器脚本检查.ps1`
- `pwsh -File tests/powershell/https-script.tests.ps1`

### 12.4 2026-04-27：服务器退字节与 announce seam 真实完工

本轮补上两个最终断层。

第一，服务器退字节真相补齐：

1. `查询附件快照_异步` 将 app-facing 冷备窗口投影成单一真相：有协作分发表时优先认 `web_seed_until`，历史附件才回退 `origin_expires_at`。
2. `读取附件内容`、`查询媒体定位`、壳层 `origin` 描述共享同一条服务器退字节时间。
3. 新主链附件 complete 回归测试钉死 `attachments.origin_expires_at` 与 `attachment_distribution_metadata.web_seed_until` 写入一致。

已执行验证：

- `cargo test --test 协作分发测试 新主链附件在web_seed窗口结束后原图内容接口不再继续直供媒体字节 -- --nocapture`
- `cargo test --test 协作分发测试 web_seed过期后的locator与原图端点共享同一条服务器退字节真相 -- --nocapture`
- `cargo test --test 协作分发测试 -- --nocapture`
- `cargo test --test 媒体上传测试 complete图片上传会把prepared附件升级成ready并写入canonical资产 -- --nocapture`
- `cargo test --test 媒体上传测试 complete视频上传会写入canonical并返回file_asset -- --nocapture`
- `cargo test --test 媒体上传测试 -- --nocapture`

第二，announce transport seam 补齐：

1. 前端 adapter 将相对 `/api/swarm/announce` 基于当前页面 origin 收口成 `ws/wss`。
2. runtime 不再把 `http/https` announce 当可用 swarm 入口。
3. `announce_urls` 注释明确它属于 tracker transport surface，不是普通 HTTP fetch surface。
4. `hint` 真相收口：`webSeed`-only / light session 可以合法回到 `null`，不再把非 peer 状态硬抬成“正在协作分发”。

已执行验证：

- `pnpm --dir frontend test -- "tests/传输测试.spec.ts" "tests/媒体定位测试.spec.ts" "tests/媒体协作分发测试.spec.ts"`
- `pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts" "tests/媒体播放测试.spec.ts"`
- `pnpm --dir frontend test -- "tests/媒体共享契约测试.spec.ts"`
- `pnpm --dir frontend test`
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend build`
- `cargo test -j 1`
- `pwsh -File tests/启动器脚本检查.ps1`
- `pwsh -File tests/powershell/https-script.tests.ps1`

真实多人浏览器烟测：

- 环境：`https://127.0.0.1`
- 房间：`1234b`
- 会话：`sender / A / B / C / D / E`
- 新附件：`att-36c15bc2f8f5`
- 新鲜会话 `E` 真实发起 locator / torrent / `/webtorrent/... [206]` / original content `[206]`
- `E` 真实上报 `POST /api/media/att-36c15bc2f8f5/presence?... => 204`
- tracker `http://127.0.0.1:7072/stats` 显示 `2 torrents (2 active)`、`Connected Peers: 4`、`Peers Seeding Only: 4`、`Clients: WebTorrent 2.8 : 4`
- PostgreSQL `swarm_peer_presence` 显示 `backend_strong_seed = 1`、`complete_peer = 4`、`partial_peer = 2`
- fresh session `s-1ac8f6ab9ff3` 自己留下 `complete_peer`

因此，截至 `2026-04-27`，WebTorrent 主链与满血协同分发可以视为经过真实多人复核后的彻底完成态。

---

## 13. 自审结论

本文融合后保留了旧两份 spec 的全部关键裁决：

1. `2026-04-22` 的主链唯一、服务器强 seed、`24 小时` 退字节、失败态、删除态、质量裁决、`web_seed_until` 真相都已收进第 2、4、5、8、9、11、12 节。
2. `2026-04-23` 的自动播放即帮助、多来源并行、片段帮助者、滑走不停、任务恢复、不裁最近几条、移动端不分裂、announce seam、多人烟测证据都已收进第 3、5、6、7、8、10、11、12 节。
3. 新文档没有把后端强 seed 和“只允许 WebTorrent”写成矛盾：后端只以 swarm 成员身份参与，不能成为第二前端直链。
4. 新文档没有把 `partial_peer` 和 `MEDIA_READY` 混掉：片段 peer 有协作价值，但 ready 仍要看当前客户端当前窗口里的真实可恢复来源。
5. 新文档没有把 `24 小时` 后纯 peer 可用性写成绝对可播：有来源则接住，无来源则说真话。
6. 新文档没有把删除态与无种子态混掉：删除永远是不可恢复终态。
7. 新文档与 `项目视频播放要求` 的关系清晰：本文是 WebTorrent 分发细则，上层总纲继续拥有 canonical 资产、唯一播放器与播放视觉连续性总裁决。
