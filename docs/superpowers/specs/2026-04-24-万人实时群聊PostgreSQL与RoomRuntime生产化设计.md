# 万人实时群聊 PostgreSQL 与 RoomRuntime 生产化设计

日期：2026-04-24  
状态：Design  
适用范围：`koko` 第一阶段单台 Linux 公网服务器部署、全站 `10 万+` 在线、多个群聊房、单房间 `5000+` 在线、峰值 `20-50` 条消息/秒、前端纯 TypeScript、后端纯 Rust + `socketioxide`、WebTorrent 图片/视频协作分发，未来可迁移到边缘运行时与分布式房间协调。
核心目标：优化 PostgreSQL 在实时万人群聊里的权威事实能力，但不能把实时在线、广播扇出、媒体字节、观看者高频状态压力转嫁给 PostgreSQL。

关联文档：

- `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
- `docs/superpowers/specs/2026-04-23-万人实时群聊去屎山与长期防漂移约束.md`
- `学习/整理笔记/单节点多房间主通道实践清单.md`
- `学习/整理笔记/恢复门禁与单节点性能补充.md`
- `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`

官方依据：

- PostgreSQL Connections and Authentication：<https://www.postgresql.org/docs/current/runtime-config-connection.html>
- PostgreSQL Indexes：<https://www.postgresql.org/docs/current/indexes.html>
- PostgreSQL High Availability：<https://www.postgresql.org/docs/current/high-availability.html>
- PgBouncer Config：<https://www.pgbouncer.org/config>

---

## 实施与验收记录（2026-04-24）

本轮执行的是第一阶段单机生产化的基础收口，不把结果夸大成“已经实测 `10 万+` 在线”。已经落地的事实如下：

1. 应用 PostgreSQL 连接池已从硬编码退场，新增 `KOKO_DATABASE_MAX_CONNECTIONS / KOKO_DATABASE_MIN_CONNECTIONS / KOKO_DATABASE_ACQUIRE_TIMEOUT_MS / KOKO_DATABASE_CONNECT_TIMEOUT_MS / KOKO_DATABASE_IDLE_TIMEOUT_SECONDS`；迁移 pool 继续保持单连接语义，不被应用高并发 pool 放大。
2. 旧同步兼容入口 `Pg仓储::连接并迁移` 已复用同一套应用连接池配置，不再暗藏 `max_connections(5)` 的第二套连接真相。
3. 新增 `0019_万人实时群聊生产化索引.sql`，补齐 `swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC)`，只补当前 locator / availability 热查询真实需要的索引；房间事件历史继续复用既有 `(room_id, event_position)` 唯一约束，不重复建等价索引。
4. 用例层新增门禁证明：异步创建消息只命中一次统一权威消息事件提交，不会为了广播再读取订阅历史；历史页读取继续把 `event_position` 游标和受控 `limit` 交给仓储，不退回 `OFFSET` 或全量历史模型。
5. Realtime 广播路径新增 RoomRuntime 运行观测：成功批次、关闭连接、channel full、序列化错误和 adapter 错误都归为运行态字段；慢连接和已关闭连接不会改变“消息已成立”的业务真相，也不会写入 PostgreSQL。
6. 本轮没有引入 Kafka / Redis / PostgreSQL `LISTEN/NOTIFY` / 分库分表 / 新 `.rs` 文件；仍保持 `socketioxide` 为第一阶段实时主通道，PostgreSQL 只做权威事实与冷路径。

本轮实际执行并通过：

- `cargo test --test 启动与迁移测试 数据库连接池配置 -- --nocapture`
- `cargo test --test 启动与迁移测试 万人群聊生产化索引迁移必须覆盖当前热查询 -- --nocapture`
- `cargo test --test 用例测试 异步消息成立只提交一次权威事件且不读取订阅历史 -- --nocapture`
- `cargo test --test 用例测试 历史读取使用事件位置游标并限制批量大小 -- --nocapture`
- `cargo test 房间广播成功会记录一次批次送达 -- --nocapture`
- `cargo test 房间广播遇到慢连接和关闭连接只记录运行态并继续房间 -- --nocapture`
- `cargo test --test 用例测试 -- --nocapture`
- `cargo test --test 实时链路测试 -- --nocapture`
- `cargo test --test 启动与迁移测试 -- --nocapture`
- `cargo test -j 1`

补充复核：

1. `graphify-out/GRAPH_REPORT.md` 已重建；当前 god nodes 仍主要是既有通用 helper / 壳层节点，没有出现新的实时主通道与数据库访问混写热点。
2. `cargo fmt --check` 暴露仓库既有大量非本轮格式化漂移；为避免制造无关格式化噪音，本轮未执行全量 `cargo fmt`。
3. 尚未执行真实 `5000+` 连接或 `10 万+` 在线压测；当前只能证明连接池配置、索引、消息热路径和 RoomRuntime 广播错误分类边界已经收口。

---

## 0. 当前明确的规模假设

第一阶段不是小群 demo，而是：

1. 单台 Linux 公网服务器先承接正式用户。
2. 全站总在线目标为 `10 万+`。
3. 同时存在多个群聊房。
4. 单个最大房间在线峰值为 `5000+`。
5. 单房间峰值发言频率大约 `20-50 条/秒`。
6. 观看的人远多于发言的人。
7. 图片/视频需要 WebTorrent 秒开、拖动进度条、后台补齐和群友协作分发。
8. 后续目标是迁移到可替换的边缘运行时与分布式房间协调，实现全球边缘低延迟实时协调。

这组假设推出一个核心结论：

**PostgreSQL 要优化，但 PostgreSQL 不能成为实时在线人数、房间广播、媒体字节和观看者高频状态的承压点。**

---

## 1. PostgreSQL 的定位

PostgreSQL 只负责权威事实和可追溯历史：

1. 会话、匿名身份、房间、成员关系。
2. `room_events / messages / message_attachment_refs`。
3. 附件 ready 真相、媒体元数据、协作分发元数据。
4. 阅读锚点的单调推进结果。
5. `swarm_peer_presence` 这类经过节流的运行态存活事实。
6. 后台清理、做种对账、故障恢复所需的稳定查询面。

PostgreSQL 不负责：

1. 给 `5000+` 个房间连接逐个广播消息。
2. 保存每个在线用户的瞬时连接状态。
3. 承载 WebSocket 在线心跳。
4. 承载媒体字节流。
5. 承载拖动进度条时的高频播放状态。
6. 作为实时主链的 `LISTEN/NOTIFY` 总线。
7. 替代未来 Durable Objects 的房间协调者。

一句话裁决：

**每条消息只进 PostgreSQL 一次；每条消息广播给多少人，是 RoomRuntime / socket 层的事。**

---

## 2. 第一阶段推荐架构

采用“单机 Linux 强化 + PostgreSQL 生产化 + RoomRuntime 边界”的方案。

### 2.1 为什么不是现在就做分布式

`20-50 条消息/秒` 对单主 PostgreSQL 不是主要压力。  
真正危险的是：

1. 单条消息乘以 `5000+` 连接的广播扇出。
2. 慢客户端拖住发送队列。
3. 浏览器重连风暴。
4. 房间恢复快照无界查询。
5. 阅读锚点和 presence 被观看者放大成高频写入。
6. 视频分发把服务器、群友、WebTorrent 和 locator 查询混成一条不可控链。

过早引入多主、分片、读写分离或复杂队列，会先制造一致性和运维复杂度，而不是先解决真实瓶颈。

### 2.2 第一阶段保留的简单结构

1. Rust 应用进程继续用 `socketioxide` 承接实时连接。
2. PostgreSQL 作为单主权威事实库。
3. PgBouncer 位于应用和 PostgreSQL 之间。
4. 媒体字节留在对象存储、本地文件、WebSeed 和 WebTorrent 平面。
5. RoomRuntime 在应用内形成明确 owner 边界。
6. 所有接口继续经 `application / domain / contract / adapter / shell` 分层，不让数据库或 socket 回调承载业务真相。

### 2.3 为未来 Durable Objects 预留的边界

未来迁移到 Workers + Durable Objects 时，不应重写业务核心。  
因此第一阶段要把单房间实时协调抽成稳定概念：

1. RoomRuntime 接收已经成立的领域事件。
2. RoomRuntime 管理房间内连接集合。
3. RoomRuntime 做广播、背压、节流和恢复提示。
4. RoomRuntime 不决定消息是否合法。
5. RoomRuntime 不拥有成员资格、权限、消息成立真相。
6. RoomRuntime 可以在未来映射成 Durable Object 的 room actor。

这里的 RoomRuntime 是架构边界，不要求现在立刻做成复杂 actor 框架。

---

## 3. 消息写入与广播路径

### 3.1 消息成立路径

单条消息必须保持短事务：

1. 校验会话和房间成员资格。
2. `UPDATE rooms SET latest_event_position = latest_event_position + 1 ... RETURNING`。
3. 写入 `room_events`。
4. 写入 `messages`。
5. 写入 `message_attachment_refs`。
6. 更新附件 `committed_at`。
7. commit 后形成一个已成立领域事件。

这条链可以串行化单房间事件位置。  
在 `20-50 msg/s` 下，优先保顺序真相，不急着拆成分片顺序。

### 3.2 广播路径

事务成功后：

1. 应用层拿到已成立事件。
2. RoomRuntime 将事件广播给房间内连接。
3. 发送失败、慢连接、断线重连由 socket 层处理。
4. 客户端落后时，从事件位置走历史增量补齐。

禁止：

1. 在广播循环中反复查询 PostgreSQL。
2. 每个接收者单独落一条数据库记录。
3. 用 PostgreSQL `LISTEN/NOTIFY` 作为本项目实时主链。
4. 把广播成功与否混入消息是否成立。

---

## 4. PostgreSQL 连接与池化

当前生产入口若写死连接池大小，会在公网部署时变成隐性风险。  
第一阶段必须把连接配置外置。

### 4.1 应用侧配置

建议引入：

1. `APP_DATABASE_MAX_CONNECTIONS`
2. `APP_DATABASE_MIN_CONNECTIONS`
3. `APP_DATABASE_ACQUIRE_TIMEOUT_MS`
4. `APP_DATABASE_CONNECT_TIMEOUT_MS`
5. `APP_DATABASE_IDLE_TIMEOUT_SECONDS`
6. `APP_DATABASE_STATEMENT_TIMEOUT_MS`

默认值必须保守，不追求把 PostgreSQL 连接数拉满。  
PostgreSQL 官方文档明确指出 `max_connections` 会影响资源预留，因此连接数不是越大越好。

### 4.2 PgBouncer 边界

第一阶段上线必须有 PgBouncer：

1. 应用连接 PgBouncer。
2. PgBouncer 控制真实 PostgreSQL server connections。
3. PgBouncer 接纳短暂连接洪峰排队。
4. PostgreSQL 保留可预期的真实连接数。

PgBouncer 模式先以 transaction pooling 为目标，但必须确认 `sqlx` 和迁移路径没有依赖 session 状态。  
迁移可以继续直连 PostgreSQL，不走运行期池。

### 4.3 禁止的做法

1. 禁止让 `10 万+` 在线用户等价成数据库连接。
2. 禁止通过无限加大 PostgreSQL `max_connections` 掩盖应用层排队问题。
3. 禁止长事务跨网络等待、跨媒体处理、跨 socket 广播。
4. 禁止在 socket handler 里持有数据库连接做慢 IO。

---

## 5. 关键表与索引方向

索引只为真实查询服务。  
PostgreSQL 官方也明确：索引能加速读取，但会增加写入和维护成本，因此不能为了“看起来高性能”乱加索引。

### 5.1 消息与历史

当前 `room_events` 和 `messages` 已有 `(room_id, event_position)` 唯一约束，适合 cursor 分页。

继续坚持：

1. 历史页只用 `event_position` 游标。
2. 禁止 OFFSET 深分页。
3. 恢复快照只取有限窗口。
4. 增量事件必须允许从 `last_seen_event_position` 补齐。

如压测显示历史页 join 成为热点，再考虑覆盖索引或投影表，不提前制造第二消息真相。

### 5.2 swarm_peer_presence

`swarm_peer_presence` 是媒体协作分发的运行态表。  
locator 会按 `swarm_id + peer_kind` 找最近存活时间，因此需要面向这个查询形状。

建议新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_kind_seen
ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC);
```

这比只按 `(swarm_id, last_seen_at DESC)` 更贴近：

1. 最近 `partial_peer`。
2. 最近 `complete_peer`。
3. 最近 `backend_strong_seed`。

同时继续保留 `attachment_id` 索引用于删除清理和排查。

### 5.3 做种对账与冷源清理

做种对账扫描需要稳定、可限量、可按到期时间排序。  
如果压测显示 `attachment_distribution_metadata + attachments` join 扫描变热，应补 partial index：

1. ready 附件未删除。
2. torrent 元信息完整。
3. `web_seed_until` 未过期。
4. 按 `web_seed_until ASC` 拉取有限条数。

清理任务也只允许按到期字段和未删除字段命中 partial index。

### 5.4 阅读锚点

阅读锚点是用户级真相，不是滚动像素。  
后端只接受单调推进：

1. `ON CONFLICT` 更新时只允许更大的 event position 覆盖。
2. 前端必须节流。
3. 后端可以合并相近推进。
4. 推进失败不能影响消息主链。

禁止把每次滚动、每个可见消息变化都直接写库。

---

## 6. RoomRuntime 边界

RoomRuntime 是“单房间实时协调 owner”，但不是业务真相 owner。

它负责：

1. 房间内 socket 集合。
2. 已成立事件广播。
3. 慢客户端队列上限。
4. 断线重连后的恢复提示。
5. presence / read-anchor 的本地节流协助。
6. 房间级运行指标。

它不负责：

1. 判断谁能发言。
2. 判断消息是否成立。
3. 决定成员资格。
4. 决定附件是否可见。
5. 决定媒体是否 ready。
6. 保存不可丢失历史。

这条边界要有“无人值守”的智能自动感：

1. 房间热起来时，自动保护数据库，不把观看者状态放大成写风暴。
2. 慢客户端自动降级为恢复模式，而不是拖住整个房间。
3. 连接队列过深时自动断开落后连接，让它从事件位置补齐。
4. presence 和阅读锚点自动节流、合并、去重。
5. 后台对账自动补偿做种状态，不靠人工刷新。
6. 监控触发阈值后自动暴露清晰状态，不让用户只看到模糊失败。

这里的“智能”不是新增一个黑盒调度系统，而是把自保护规则写进 owner 边界。

---

## 7. 媒体与数据库的边界

WebTorrent 图片视频秒开和拖动进度条，不能靠 PostgreSQL 扛。

数据库只保存：

1. 附件存在性。
2. ready 状态。
3. 内容 hash。
4. torrent 元信息。
5. WebSeed 窗口。
6. presence 存活时间。
7. 删除和清理真相。

数据库不保存：

1. 视频字节。
2. 用户播放进度。
3. 拖动进度条的瞬时状态。
4. 每个 peer 的完整 piece bitmap。
5. 每个连接的实时带宽统计。

`5000+` 人看同一视频时，理想效果是：

1. PostgreSQL 只被 locator / torrent / presence 的受控请求命中。
2. 前 `24 小时` WebSeed 和 swarm 共同供字节。
3. 群友越多，WebTorrent swarm 越强。
4. 数据库不会因为更多人观看同一视频而线性增长压力。

---

## 8. 观测与无人值守运行

“无人值守”不等于无人维护，而是系统在正常波动中能自己暴露状态、保护边界、恢复轻微失衡。

第一阶段至少要有：

1. `pg_stat_statements`。
2. 慢查询日志。
3. 数据库连接池使用率。
4. 连接池 acquire 等待时间。
5. PostgreSQL active / idle / idle in transaction 连接数。
6. RoomRuntime 房间在线数。
7. 房间广播队列长度。
8. 慢客户端断开/降级次数。
9. 每房间消息写入耗时。
10. 每房间广播耗时。
11. locator 查询耗时。
12. presence 写入频率。
13. 阅读锚点写入频率。
14. WebSeed / swarm 请求比例。

阈值触发后应自动给出明确方向：

1. 数据库连接池耗尽：提示连接池或 PgBouncer 队列压力。
2. 慢查询升高：提示具体 SQL 指纹。
3. 单房间广播队列过深：提示慢客户端或房间过热。
4. presence 写入异常升高：提示客户端心跳失控。
5. locator 延迟升高：提示 swarm presence 索引或数据库压力。

禁止只给“系统繁忙”这类无法定位的黑箱错误。

---

## 9. Linux 单机部署基础边界

这份设计不展开完整运维手册，但第一阶段不能忽略 Linux 运行边界：

1. 文件描述符上限必须足够支撑 WebSocket 连接。
2. TCP backlog / keepalive / ephemeral port / conntrack 要按实际部署核对。
3. 反向代理和 TLS 终止不能隐藏断线原因。
4. PostgreSQL 数据盘和媒体盘不能互相拖垮。
5. 日志不能在高峰期同步阻塞热路径。
6. 备份和压缩不能与高峰窗口抢 IO。

媒体文件、数据库 WAL、应用日志应尽量分离 IO 压力。

---

## 10. 未来迁移到边缘运行时与分布式房间协调

未来边缘协调方案的直觉映射：

1. 一个房间一个协调单元，或大房间按 room shard 拆多个协调单元。
2. 边缘入口负责鉴权承接、静态资源和边缘路由。
3. 协调单元负责房间实时协调、WebSocket、短期内存态和局部状态。
4. 长期媒体字节仍走对象存储 / WebTorrent 平面。
5. 权威历史可按迁移阶段留在 PostgreSQL 或可替换的边缘存储组合里。

但第一阶段不能提前把代码写死到某个厂商 API。
正确方式是先抽稳定契约：

1. 房间命令。
2. 已成立事件。
3. 房间恢复查询。
4. 广播端口。
5. 连接生命周期事件。
6. 运行态指标。

这样 Rust 单机和未来边缘协调单元都只是不同 adapter。

---

## 11. 实现红线

1. 禁止把在线人数映射成数据库连接数。
2. 禁止把房间广播写成 PostgreSQL 查询循环。
3. 禁止用 PostgreSQL 扛媒体字节。
4. 禁止用 `LISTEN/NOTIFY` 作为实时主链。
5. 禁止无限加大 `max_connections` 代替 PgBouncer 和背压。
6. 禁止 OFFSET 深分页。
7. 禁止每次滚动都写阅读锚点。
8. 禁止把每个观看者的高频播放状态写库。
9. 禁止把 RoomRuntime 做成业务真相 owner。
10. 禁止为了未来 DO 迁移，现在就引入复杂分布式一致性。
11. 禁止把监控做成只给人工看的报表，必须能指导自动保护和明确故障定位。
12. 禁止把“无人值守”理解成黑盒自动调参；所有自动行为都必须有明确阈值、日志和退路。

---

## 12. 验证门禁

实现计划至少要验证：

1. 单房间 `5000+` 连接时，消息写入只产生一次数据库事务。
2. 单房间 `20-50 msg/s` 时，`rooms.latest_event_position` 串行推进不成为首要瓶颈。
3. 单条消息广播给 `5000+` 连接时，不产生 `5000` 次数据库查询。
4. 慢客户端不会拖住房间广播。
5. 历史恢复走 cursor 和有限窗口。
6. 阅读锚点推进被节流且单调。
7. presence 心跳维持受控频率。
8. locator 查询命中 `swarm_id + peer_kind + last_seen_at` 索引。
9. 连接池耗尽时能明确看到等待、排队、超时指标。
10. PgBouncer 后 PostgreSQL 真实连接数受控。
11. WebTorrent 视频播放和拖动进度条不会把播放状态写进 PostgreSQL。
12. 高峰重连时，恢复链路不会全量拉房间历史。
13. 房间热度升高时，系统能自动暴露队列、慢连接、数据库等待和 presence 写入频率。
14. 设计仍能映射到未来 Durable Objects 的 room actor。

---

## 13. 最终裁决

第一阶段要优化 PostgreSQL，但不能把压力放在 PostgreSQL 上。

正确方向是：

**PostgreSQL 只做权威事实库；RoomRuntime 承担单房间实时协调；socketioxide 承担单机 WebSocket 热路径；WebTorrent / WebSeed / 对象存储承担媒体字节；PgBouncer、索引、短事务、节流、背压和观测让系统具备无人值守的自保护能力。**

这套设计既能支撑单台 Linux 公网服务器上的 `10 万+` 全站在线和 `5000+` 单房间在线，也不把未来迁移到 Workers + Durable Objects 的路径堵死。
