# 2026-04-06 socketioxide 单节点到多节点部署与门禁笔记

适用范围：`koko` 作为实时群聊应用，在“先单节点跑稳，再向多节点扩展”的整个演进过程中的开工前门禁。  
目标：避免实现阶段临时拍脑袋改配置、手搓集群同步、误判代理行为，或者把“单节点 demo 能跑”错当“万人在线架构已成立”。

## 1. 这份笔记解决什么问题

第一份笔记解决的是“`socketioxide` 该怎么用，别再手搓第二套实时核心”。  
这份笔记解决的是“就算 `socketioxide` 用对了，部署、配置、adapter、测试门禁没吃透，后面一样会掉坑”。

换句话说：

1. 第一份是“职责边界”。
2. 这一份是“运行与扩展边界”。

## 2. 单节点阶段先守住什么

### 2.1 单节点不是玩具阶段，但也不要提前写成伪分布式

Socket.IO 和 `socketioxide` 官方都已经把边界说清楚了：

1. 默认 adapter 是本地内存 `LocalAdapter`。
2. `rooms / sockets / emit / join / leave` 在单节点时完全可以先依赖本地 adapter。
3. 真正要跨节点广播和同步房间成员时，再接共享 adapter。

对 `koko` 的约束：

1. 单节点阶段不要提前手搓“伪多节点同步层”。
2. 代码从第一天开始就按 adapter 兼容语义写，但不要提前实现分布式复杂度。
3. 真正的前提是：handler 签名、广播入口、房间操作都不要绑死 `LocalAdapter` 的具体实现细节。

### 2.2 单节点阶段就要写出“未来可接 adapter”的代码形状

`socketioxide` 官方文档明确提醒：

- 如果未来打算切其他 adapter，涉及 adapter 的 extractor 应该写成泛型 `A: Adapter`，而不是绑死默认类型。

官方建议的形状是：

```rust
async fn my_handler<A: Adapter>(s: SocketRef<A>, io: SocketIo<A>) { }
```

对 `koko` 的约束：

1. 实时 handler、广播服务、连接管理入口从现在开始就优先写成 `A: Adapter` 泛型友好形态。
2. 不要先写死单节点 API，等要扩容时再全仓大改。

这不是提前过度设计，而是避免未来为了接 Redis adapter 重写实时主链。

## 3. Builder 配置里真正该盯的门禁

### 3.1 `max_payload` 不是“越大越好”

`socketioxide` `SocketIoBuilder` 官方文档：

- `max_payload` 表示单条 payload 最大字节数。
- 默认是 `100 kb`。
- 超过后 `emit()` 会返回错误。

对 `koko` 的约束：

1. 文本群聊默认不要盲目把 payload 上限开很大。
2. 如果以后支持富消息、二进制或大附件，也不要沿用同一个实时通道配置硬扛。
3. 一旦调大，要同步写清楚为什么、对内存和 DoS 面积有什么影响。

### 3.2 `max_buffer_size` 是背压边界，不是摆设

`socketioxide` 官方文档：

- `max_buffer_size` 表示每连接最多缓冲多少个 packet。
- 默认 `128` 个。
- 缓冲满了之后 `emit()` 会返回错误。

这条很关键，因为它直接关系到：

1. 慢客户端会不会悄悄把服务拖死。
2. 群聊广播风暴时，系统是显式失败，还是无界积压。

对 `koko` 的约束：

1. 不要无视 `emit()` / broadcast 返回错误。
2. 不能把“发不出去”的事实吞掉当作没事发生。
3. 后续实现广播服务时，必须把缓冲满、连接已断、序列化失败这些错误纳入日志与测试。

### 3.3 `ack_timeout` 不是业务超时，而是 ACK 等待边界

`socketioxide` 官方文档：

- `ack_timeout` 默认 5 秒。
- 官方文档文字写的是“等待客户端 ACK 多久，超时后关闭连接”。

不管内部具体实现细节怎样，这至少说明一件事：

1. ACK 等待是有时间边界的。
2. 不应该把 ACK 等待无限挂起。
3. 更不应该把 ACK 设计成业务真相依赖项。

对 `koko` 的约束：

1. ACK 只服务传输/控制面，不进入业务成立判据。
2. 任何依赖 ACK 的控制面交互都必须能超时、可观察、可降级。

### 3.4 `ping_interval` / `ping_timeout` 直接影响断线判定

`SocketIoBuilder` 和 Socket.IO 官方 server options 都提供了这两个参数。

Socket.IO 官方文档明确：

- `pingInterval` 默认 `25000ms`
- `pingTimeout` 默认 `20000ms`
- 两者共同决定何时认为连接断开
- 值越小，暂时卡顿越容易触发重连；值越大，坏连接越晚暴露

对 `koko` 的约束：

1. 不要为了“看起来断线更快”就盲目把心跳窗口压得过小。
2. 断线恢复测试必须覆盖心跳导致的 `ping timeout` 场景。
3. 代理配置必须与这两个值联动检查。

### 3.5 `transports` 策略必须是显式决策

Socket.IO 官方文档明确：

- 默认 `["polling", "websocket"]`
- 如果只开 `websocket`，可以减少 sticky-session 依赖
- 但会失去 long-polling fallback

对 `koko` 的约束：

1. 不能默认“反正客户端是浏览器，就先都开着”。
2. 也不能默认“为了干净，全部只走 websocket”。
3. 这必须作为显式架构决策：
   - 如果保留 polling，就要承担 sticky-session 要求。
   - 如果只走 websocket，就要明确放弃 fallback，并验证目标环境是否允许。

## 4. 反向代理与多节点最容易踩的坑

### 4.1 开多节点时，默认先问 sticky-session，而不是先问 Redis

Socket.IO 官方“Using multiple nodes”文档把两件事放在最前面：

1. 如果启用了 HTTP long-polling，就必须 sticky session。
2. 必须使用兼容 adapter。

而且官方明确说：

- 不做 sticky-session，会出现 `Session ID unknown` 和 HTTP 400。
- 这是因为 polling 生命周期里有多个 HTTP 请求，必须命中同一个原始进程。

对 `koko` 的约束：

1. 以后多节点发布前，先验 sticky，再谈 adapter。
2. 谁要是上来先写“跨节点房间同步”代码，却没确认 sticky / transports 策略，就是顺序错了。

### 4.2 代理超时必须大于心跳总窗口

Socket.IO 官方在 nginx / Apache 配置里都明确提醒：

- 代理层超时必须大于 `pingInterval + pingTimeout`
- 否则代理会误以为连接闲置，强制掐断，客户端看到 `transport close`

对 `koko` 的约束：

1. 反向代理配置不是部署细节噪音，而是实时链路的一部分。
2. 只要改了心跳参数，就必须回扫代理超时。
3. 这必须进入发布前门禁，不允许只在事故后补知识。

### 4.3 CORS + cookie sticky 不是小事

Socket.IO 官方明确：

- 如果 sticky-session 依赖 cookie，且前后端跨域，服务端必须允许 `credentials`
- 客户端也必须 `withCredentials: true`
- 否则 cookie 不发，sticky 失效，仍会得到 `Session ID unknown`

对 `koko` 的约束：

1. 如果未来前后端分域，又保留 polling，就必须把 sticky/cookie/CORS 联动验证写进发布清单。
2. 这类问题不能靠“本地能连上”证明没问题。

## 5. adapter 这件事，到底什么时候该上

### 5.1 先单节点跑稳，再接共享 adapter

这是目前最稳的节奏：

1. 单节点先把订阅、广播、补洞、断线恢复、日志、测试闭环跑稳。
2. 再引入共享 adapter 解决跨节点广播和房间同步。

原因很简单：

1. 如果单节点语义没跑稳，接 adapter 只会把 bug 扩散到多节点。
2. adapter 解决的是“节点间同步”，不是“业务真相没理清”。

### 5.2 `socketioxide-redis` 是现成轮子，但有协议边界

官方文档已经明确：

1. `socketioxide-redis` 支持 standalone / sentinel / clustered Redis 拓扑。
2. 支持 sharded pub/sub。
3. 依赖 RESP3，Redis 版本建议 7+。
4. 最重要的一条：它不兼容 `@socketio/redis-adapter` 和 `@socketio/redis-emitter`，协议完全不同，不能和 Node 版 Socket.IO Redis adapter 混用。

对 `koko` 的约束：

1. 如果未来是纯 Rust `socketioxide` 集群，Redis adapter 可以优先复用。
2. 如果未来要与 Node Socket.IO 集群混跑，不能想当然地认为“都叫 Socket.IO，就能共用 Redis adapter 协议”。
3. 一旦有跨语言集群诉求，必须在开工前重新做兼容性调研。

### 5.3 `local()` 只能在明确需要节点本地广播时用

`socketioxide` operators 支持 `local()`，官方语义就是：

- 在集群场景里只广播给当前节点，不经过远程 adapter。

对 `koko` 的约束：

1. `local()` 绝不能当默认广播方式。
2. 只有明确要做节点本地通知时才允许使用。
3. 群聊权威事件默认不能被 `local()` 限死在单节点。

## 6. 真正的万人在线，不是先写性能神话，而是先立门禁

### 6.1 不要把“万人在线”理解成一开始就做所有复杂度

真正成熟的路径是：

1. 先把语义边界写对。
2. 先把背压、超时、缓冲、广播错误变成显式系统行为。
3. 再逐步扩大连接数和节点数。

如果一开始就为了“万人在线”提前手搓：

1. 私有房间索引
2. 私有跨节点广播协议
3. 私有连接恢复层
4. 私有 ACK/重试层

那不是提前布局，而是在提前积债。

### 6.2 真正要盯的是失败模式

对 `koko` 来说，后续实现必须明确覆盖这些失败模式：

1. 广播时连接已断开
2. 广播时缓冲区已满
3. payload 超限
4. ACK 超时
5. 代理误切连接
6. reconnect 后 recovery 失败
7. 多节点下非 sticky 导致会话漂移
8. adapter 未连通导致跨节点 fanout 失效

没有把这些失败模式显式化，所谓“万人在线”只是口号。

## 7. 开工前必须满足的测试门禁

### 7.1 单节点阶段最少 5 类测试

1. 两个真实 socket client 同房广播测试
2. 非成员订阅/发言拒绝测试
3. `event_position` 补洞与快照兜底测试
4. 广播错误与缓冲失败的可观测性测试
5. 断线重连后恢复与不可恢复分支测试

### 7.2 多节点前再加 4 类测试

1. adapter 接通后跨节点广播测试
2. 多节点房间 join/leave 同步测试
3. sticky 配置错误时的故障演练
4. 代理超时与心跳参数联动验收

### 7.3 发布门禁不允许缺的配置验证

1. `transports` 策略是否与部署方案一致
2. 心跳参数是否与代理超时匹配
3. sticky-session 是否确实生效
4. adapter 是否与当前集群技术栈兼容
5. 广播失败是否有结构化日志可追

## 8. 给 `koko` 的最终执行建议

真正稳的路线只有这一条：

1. 先继续把单节点 `socketioxide` 主通道修正到正确形态。
2. 所有实时代码从现在开始按 adapter 兼容语义写。
3. 单节点跑稳之前，不引入 Redis adapter。
4. 真要上多节点时，优先复用 `socketioxide-redis`，不自研跨节点广播协议。
5. 在发布与扩容前，把 sticky、proxy timeout、transport、adapter 兼容性做成显式门禁。

## 9. 结论

“工欲善其事，必先利其器”在这里的真实含义，不是把 `socketioxide` API 背下来，而是把它的运行边界、配置边界、部署边界、adapter 边界、测试边界都先钉死。

这样后面动手时，才不至于一遇到：

1. 房间广播问题，就手搓广播核心
2. 多节点问题，就手搓同步协议
3. 恢复问题，就手搓第二套重连语义
4. 部署问题，就把锅甩给“库不行”

真正优雅的做法，是先把成熟轮子的边界吃透，再让自己的代码只承载业务真相和薄适配层。

## 10. 官方来源

- Socket.IO Using multiple nodes: [https://socket.io/docs/v4/using-multiple-nodes/](https://socket.io/docs/v4/using-multiple-nodes/)
- Socket.IO server options: [https://socket.io/docs/v4/server-options/](https://socket.io/docs/v4/server-options/)
- Socket.IO delivery guarantees: [https://socket.io/docs/v4/delivery-guarantees/](https://socket.io/docs/v4/delivery-guarantees/)
- Socket.IO connection state recovery: [https://socket.io/docs/v4/connection-state-recovery/](https://socket.io/docs/v4/connection-state-recovery/)
- socketioxide crate docs: [https://docs.rs/socketioxide/latest/socketioxide/](https://docs.rs/socketioxide/latest/socketioxide/)
- `SocketIoBuilder` docs: [https://docs.rs/socketioxide/latest/socketioxide/struct.SocketIoBuilder.html](https://docs.rs/socketioxide/latest/socketioxide/struct.SocketIoBuilder.html)
- socketioxide-redis crate docs: [https://docs.rs/socketioxide-redis/latest/socketioxide_redis/](https://docs.rs/socketioxide-redis/latest/socketioxide_redis/)
