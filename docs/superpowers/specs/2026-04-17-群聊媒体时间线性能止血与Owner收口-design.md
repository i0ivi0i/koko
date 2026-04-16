# 群聊媒体时间线性能止血与 Owner 收口设计

日期：2026-04-17  
状态：Draft  
适用范围：`koko` 当前 Web 群聊时间线中图片/视频附件的浏览器侧媒体解析、自动播、协作分发接入与首屏滚动性能。  
关联资料：

- `docs/superpowers/specs/2026-04-16-Web大视频上传秒开播放与P2P协同主链-design.md`
- `docs/superpowers/specs/2026-04-16-媒体集成测试按真相归属瘦身-design.md`

## 1. 为什么要补这份 spec

最近真实群聊压测已经反复暴露同一类故障：

1. 房间里图/视频一多，滚动消息时页面明显卡顿、假死
2. 视频收发后，即使用户没有点开正式查看器，后台也会出现多条媒体拉流链
3. 同一附件会重复打 `/locator`、重复抢 `swarm`、重复回退 `anchor/original`
4. 浏览器会同时出现 `/api/attachments/...variant=original` 与 `/webtorrent/...` 的并行 Range 请求

这说明当前问题不是“某一个播放器 bug”，而是**时间线媒体 owner 边界没有收住**：

- 时间线静态卡片
- 时间线自动播
- 正式查看器
- WebTorrent 协作分发

这几层本该分主次，现在却在同一屏同时起跑。

## 2. 当前事实与直接根因

### 2.1 时间线会为房间内每个附件立即创建正式媒体会话

当前 `聊天媒体编排` 会遍历当前房间所有附件，并对每个附件直接 `session.启动()`。  
这意味着用户只是进入房间、刷消息，后台就已经开始为整个时间线解析播放源。

### 2.2 自动播 owner 会对同一附件再解析一次

当前存在两类消费者：

1. `session:<attachmentId>`
2. `inline_autoplay:<attachmentId>`

当附件进入可见区后，自动播会再次调用 `解析播放结果()`。  
于是同一附件经常会被正式会话和自动播会话各解析一遍。

### 2.3 `媒体定位器` 只有缓存，没有并发去重

当前 `创建媒体定位器()` 只有：

1. 内存缓存
2. 持久缓存

但没有 attachment 级 inflight promise 合并。  
所以两个 owner 同时请求同一附件时，真的会发出两次 `/api/media/:id/locator`。

### 2.4 时间线默认解析路径过重

当前 `媒体播放器` 默认把未显式声明的 surface 当成 `viewer`。  
这会让很多本来只是时间线静态卡片的附件，提前进入：

1. manifest 主链判断
2. swarm 抢占预算
3. anchor/original 探测

这不是“静态封面”，而是“准查看器预热”。

### 2.5 一旦进入 WebTorrent，会话默认趋向整文件补齐

当前 `媒体协作分发` 在拿到文件后直接 `file.select(1)`，并默认 `eagerCompleting = true`。  
这会把“当前能不能播”很快推向“尽快补完整文件”，在多附件时间线里非常伤滚动性能。

## 3. 设计目标与非目标

### 3.1 目标

1. 把时间线媒体恢复到“默认静态、按需升级”的主链
2. 保证同一附件在同一时刻只有一条权威解析链
3. 消灭重复 `/locator` 与重复抢占 `swarm` 的并发噪音
4. 让 WebTorrent whole-file backfill 只在明确值得时发生
5. 优先止住群聊滚动卡死、假死、崩溃

### 3.2 非目标

1. 这轮不改后端媒体契约和数据库 schema
2. 这轮不重做 Video.js v10 正式查看器主链
3. 这轮不追求“时间线也满血秒开播放全部视频”
4. 这轮不把 WebTorrent / HLS / blob 三条链完全重写

## 4. 设计四问

### 4.1 权威真相在哪里决定

必须收口成三类 owner：

1. 时间线卡片 owner：只回答“封面/缩略图是什么”，不负责真正播放
2. 自动播 owner：只允许当前唯一可见视频进入轻量播放
3. 正式查看器 owner：才拥有正式视频播放、恢复、补齐、切链裁决权

任何其它层都只能投影，不能自长第二套播放解析真相。

### 4.2 稳定交换契约是什么

对壳层保持这些稳定面：

1. 时间线继续拿 `preview/poster/thumbnail`
2. 自动播继续只允许单 owner
3. 正式查看器继续消费统一 `媒体播放结果`
4. 协作分发继续通过统一 `consumerId` 持有与释放

不允许再出现“时间线静态卡片偷偷拥有 viewer 级解析语义”。

### 4.3 同步锚点 / 顺序依据是什么

实施顺序必须是：

1. 先收口时间线 owner 语义
2. 再给 `媒体定位器` 加 inflight 去重
3. 再削弱 WebTorrent eager full-file backfill
4. 最后补浏览器冒烟与回归测试

顺序不能反，因为先改 WebTorrent 补齐策略，止不住前面重复 owner 带来的过载。

### 4.4 失败后如何恢复

每一步都必须可单独回退：

1. owner 收口失败，只回退编排层与时间线 surface 判定
2. locator 去重失败，只回退定位器内部 map
3. backfill 降级失败，只回退 `file.select(1)` 与 eager 策略

禁止把三件事混成一坨一起下刀。

## 5. 粗略方案

### 5.1 时间线默认不再启动正式播放解析

时间线附件进入房间后：

1. 图片只显示 preview / thumbnail
2. 视频只显示 poster
3. 不为“仅存在于时间线”的附件立即启动 `session.启动()`

只有这两种情况才允许进入真实解析：

1. 用户点开正式查看器
2. 当前自动播裁决出的唯一视频 owner

### 5.2 `媒体定位器` 增加 attachment 级 inflight 去重

`获取定位(attachmentId)` 需要增加：

1. `inflight: Map<string, Promise<媒体定位结果>>`
2. 同 attachment 并发请求复用同一 promise
3. 请求完成后再落缓存并清理 inflight

这样可以先把重复 `/locator` 直接砍掉。

### 5.3 自动播不能与正式会话同时各自 resolve

自动播与正式查看器要继续保留不同 `consumerId`，但不能继续各自独立冷启动整套定位链。  
粗略方向是：

1. 自动播优先复用当前附件已存在的正式解析结果
2. 若没有正式结果，再走自动播自己的轻量解析
3. 自动播禁止把时间线附件偷偷升级成长期正式会话

### 5.4 WebTorrent whole-file backfill 改成延后激活

当前 `file.select(1)` 和 `eagerCompleting = true` 太激进。  
这轮要改成两阶段：

1. 第一阶段只保证当前可播放
2. 第二阶段只有在正式查看器稳定播放、或显式收到 backfill 信号时，才开始整文件补齐

时间线自动播默认不应触发 whole-file backfill。

## 6. 验收标准

### 6.1 浏览器行为验收

同一房间内存在多条视频消息时：

1. 仅滚动消息，不点开查看器，不应为每个视频都打 `/locator`
2. 同一附件不应同时出现两次 locator 请求
3. 同一附件不应同时出现冷源 `original` 与 `webtorrent` 两条主播放链并发抢跑
4. 房间滚动时不应再因为多媒体时间线造成明显假死

### 6.2 代码边界验收

1. 时间线静态卡片不拥有 viewer 级播放语义
2. 自动播只有唯一 owner
3. 正式查看器仍然是唯一正式视频播放 owner
4. `媒体定位器` 必须具备 inflight 去重
5. WebTorrent whole-file backfill 不得在时间线默认态自动触发

## 7. 官方资料对齐要求

这轮实现需要继续对齐以下公开建议：

1. WebTorrent：优先按播放需要取块，不要把 whole-file eager 下载当时间线默认行为  
   `https://webtorrent.io/docs`
2. Chrome / web.dev：列表页视频应保持懒加载与轻量预览，避免后台为大量视频元素预拉重链路  
   `https://web.dev/articles/lazy-loading-video`
3. p2p-media-loader：它是流媒体增强层，不该成为第二个播放真相 owner  
   `https://novage.github.io/p2p-media-loader/docs/latest/`
4. Video.js v10：继续作为正式查看器壳层，不承担时间线多 owner 收敛职责  
   `https://videojs.org/blog/videojs-v10-beta-hello-world-again`

## 8. 当前结论

这次性能事故的核心，不是单个播放器组件坏了，  
而是**时间线页面把太多附件过早升级成了正式媒体消费者**。

所以真正的第一刀不是“再调一点缓存”或“再补一点 guard”，而是：

1. 收口时间线 owner
2. 去掉重复 locator 并发
3. 延后 whole-file backfill

先把这三刀落稳，再谈“更满血的 P2P 播放体验”。
