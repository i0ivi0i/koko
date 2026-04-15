# 2026-04-15 socket.io / socketioxide 2026 新实践

适用范围：`koko` 的实时主通道、房间广播、断线恢复，以及未来 Linux 公网多节点扩展。  
目标：把 `socket.io` 官方传输语义、`socketioxide` Rust 生态现实、以及多节点扩展边界对齐。

## 1. 先说结论

这轮最重要的结论有九条：

1. `socketioxide` 现在仍然是 Rust 生态里最合适的成熟轮子之一，没必要为了“更纯”去手搓实时协议层。
2. 但 transport 轮子成熟，不代表业务自动可靠；`socket.io` 官方仍明确默认只是 `at most once`。
3. 所以聊天室真正的消息真相，仍要靠权威事件落库、游标、补拉、快照，而不是盲信 socket transport。
4. `socketioxide` 官方文档明确说每个连接/消息 handler 都会起新任务，这对并发是好事，但不等于你可以不做背压和限流。
5. `socketioxide-redis` 已经给了多节点房间广播能力，但它和 JS `@socket.io/redis-adapter` 协议不兼容，不能混搭。
6. `socketioxide-redis` 提供的 driver 走 `RESP3`，Redis 至少要 `v7+`。
7. `socket.io` 官方自己的 Redis adapter 现在也在推荐新项目优先用 sharded adapter，而且它不支持 connection state recovery。
8. 高连接数下，问题常常不在业务代码，而在 `nofile`、本地端口范围、压缩、parser、握手内存这类基础门禁。
9. 如果你们未来真要做多节点“可恢复实时”，不要把这个目标托付给 adapter；该落持久层的真相必须落持久层。

## 2. socket.io 官方 2026 仍然值得记的事实

### 2.1 交付语义

`socket.io` 官方文档现在仍写得很直接：

- 消息顺序有保证。
- 默认交付语义是 `at most once`。
- 连接断开时，客户端会缓冲一些待发事件，但服务端不会替断线客户端长期缓存丢失事件。

这对 `koko` 的直接含义：

1. 你不能把“emit 成功返回”理解成业务对端一定收到。
2. 掉线期间漏掉的消息，要靠权威事件流、offset、补拉接口或快照同步。
3. transport 层广播只适合实时体验，不适合承担消息真相。

### 2.2 Connection State Recovery

官方文档的边界也讲得很清楚：

- 这是为“临时断线”设计的，不是万能同步方案。
- 需要服务端显式开启。
- `maxDisconnectionDuration` 要设成合理值，不要无限拉长。
- 即使用了这个功能，客户端和服务端状态仍可能需要重新同步。

这对 `koko` 的直接含义：

1. 这能力可以作为“断网瞬断体验增强”，但不能当作业务一致性主方案。
2. 房间成员资格、消息可见性、治理事件等真相，仍要靠应用层重新校准。

### 2.3 Redis Adapter / Performance

官方 2026 文档里这些点最有价值：

- Redis adapter 基于 Redis Pub/Sub。
- 官方支持表里明确写着：Redis adapter 不支持 connection state recovery。
- 新项目官方建议优先使用 sharded adapter。
- 官方还提醒 `redis` 包存在重连后订阅恢复问题，必要时考虑 `ioredis`。
- `maxHttpBufferSize` 默认只有 `1 MB`。
- `perMessageDeflate` 默认关闭，而且官方明确提醒它会带来显著性能和内存开销。
- 如果发很多二进制，官方建议考虑 msgpack parser。
- 可以通过清掉初始 HTTP request 引用来省内存。
- OS 层还要看 `nofile` 和本地端口范围。

这对 `koko` 的直接含义：

1. 不要在实时主通道里传大块媒体字节；它天然不是给这事设计的。
2. 高并发长连接环境里，内存优化和系统参数不属于“运维可有可无”，而是实时主链的一部分。
3. 多节点时，断线恢复和消息补偿不能偷懒丢给 Redis adapter。

## 3. socketioxide 官方 2026 的真实边界

### 3.1 主库 `socketioxide`

当前 docs.rs 文档最关键的点：

- `SocketIoBuilder` 暴露了 `max_payload`、`max_buffer_size`、`ping_interval`、`ping_timeout`、`connect_timeout`、`with_parser`、`with_adapter` 等关键参数。
- 文档明确写了：每个传入连接 / 消息都会 spawn 新任务，避免阻塞事件管理任务。
- Extractor 和 handler 机制已经足够成熟，没必要再封第二层私有协议壳去重复它。

这对 `koko` 的直接含义：

1. 并发是有底层支持的，但你仍要控制每个 handler 的工作量。
2. 业务规则继续应该落在 command / usecase，而不是回调里直接做全套裁决。
3. `max_payload`、`max_buffer_size` 不该永远吃默认值，尤其是未来开放公网后。

### 3.2 `socketioxide-redis`

当前 docs.rs 文档里最关键的几件事：

- 它是给同一应用的多节点广播、房间管理、远程 socket 操作准备的。
- 提供的 driver 支持 standalone redis、cluster、fred。
- cluster 情况会使用 sharded pub/sub 分摊负载。
- 提供的 driver 为了效率使用 `RESP3`，官方明确要求 Redis `v7+`。
- 它和 JS `@socket.io/redis-adapter` / `@socket.io/redis-emitter` 协议不兼容，官方直接说不要混用 JS socket.io server 和 Rust socketioxide server。
- 所有消息用 msgpack 编码。

这对 `koko` 的直接含义：

1. 未来多节点如果继续纯 Rust 主链，就应该继续站在 `socketioxide-redis` 上。
2. 如果你未来同时上 JS socket.io 节点和 Rust 节点，不要以为能直接共享同一套 Redis adapter。
3. Redis 升级到 `v7+` 不是“以后再说”，而是多节点扩展前提。

## 4. 对 `koko` 最有价值的设计裁决

### 4.1 现在就应该坚持的

1. 实时主通道继续保留纯 Rust `socketioxide`。
2. 消息成立真相继续走应用层 / 持久层，不让 socket callback 偷承载业务真相。
3. 媒体上传下载大字节继续走 HTTP / 对象存储 / P2P，不走 socket.io 主通道。

### 4.2 未来多节点前必须补的

1. 明确 `max_payload`、`max_buffer_size`、`ping_timeout` 等边界值。
2. 明确多节点是否采用 `socketioxide-redis`。
3. 如果采用，基础设施前提要满足：
   - Redis 7+
   - RESP3
   - 不与 JS Redis adapter 混搭
4. 为断线恢复准备权威补拉机制，而不是只靠 transport recovery。

### 4.3 现在不要做的

1. 不要手搓第二套房间广播协议。
2. 不要把媒体大块数据塞进实时消息通道。
3. 不要把 connection recovery 误当作一致性系统。

## 5. 对公网高并发的直接启发

如果目标是“公网万人实时群聊 + 高并发媒体链路”，那么实时层最诚实的架构口径应该是：

1. `socketioxide` 负责连接、房间、广播、在线态、轻量事件。
2. 消息真相由应用层和存储层兜底。
3. 媒体字节流走上传专线和下载专线，不占实时主通道。
4. 多节点扩展优先复用现成 adapter，不重复造轮子。

## 6. 官方来源

- Socket.IO Delivery Guarantees: <https://socket.io/docs/v4/delivery-guarantees/>
- Socket.IO Connection State Recovery: <https://socket.io/docs/v4/connection-state-recovery/>
- Socket.IO Redis Adapter: <https://socket.io/docs/v4/redis-adapter/>
- Socket.IO Performance Tuning: <https://socket.io/docs/v4/performance-tuning/>
- Socket.IO Server Options: <https://socket.io/docs/v4/server-options/>
- socketioxide docs.rs: <https://docs.rs/socketioxide/latest/socketioxide/>
- socketioxide `SocketIoBuilder`: <https://docs.rs/socketioxide/latest/socketioxide/struct.SocketIoBuilder.html>
- socketioxide-redis docs.rs: <https://docs.rs/socketioxide-redis/latest/socketioxide_redis/>
