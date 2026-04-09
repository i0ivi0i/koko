# 2026-04-06 socketioxide 官方最佳实践与多房间群聊落地笔记

适用范围：`koko` 下一阶段的实时主通道重整。  
目标：先把 `socketioxide` 官方边界和 Socket.IO 官方语义吃透，再围绕它补齐“多房间、可广播、可恢复、可验证”的群聊主链。

## 0. 先定角色

在 `koko` 里，DDD 领域是船长，负责裁决业务真相；`socketioxide` 不是第二个船长，而是实时主通道的大副。

这句话落到工程上，含义只有五条：

1. `socketioxide` 负责连接、命名空间、房间、广播、ACK、断开、适配器、多节点同步这些实时基础设施能力。
2. `socketioxide` 不负责成员资格真相、消息是否成立、谁能发言、谁能看见。
3. `socketioxide` handler 的任务是把实时输入翻译成稳定命令，把权威领域事件广播出去，而不是在回调里偷偷裁决业务。
4. `socketioxide` 提供的 rooms / operators / state / middleware / adapter 必须优先复用，不再手搓第二套实时协议核心。
5. 真正的优雅不是“去 socketioxide 化”，而是“让 socketioxide 只做它擅长的事，并把业务真相留在领域和用例层”。

## 1. 官方资料先给出的硬边界

### 1.1 `socketioxide` 官方定位很清楚：它是 Socket.IO server，不是业务内核

- 官方文档把 `socketioxide` 描述为 Rust 的 Socket.IO server 实现，直接集成 `tower/tokio/hyper` 生态。
- 官方文档把能力清单写得很明确：`namespaces / rooms / acknowledgements / state management / adapters / polling & websocket transports`。
- 这说明它天生就是实时 adapter 层，而不是应用层或领域层。

对 `koko` 的直接约束：

1. 不再手搓“私有 realtime core”去复制 rooms、广播选择器、ACK、跨节点房间同步这些能力。
2. 领域层只定义 `命令 / 事件 / 快照 / 错误码 / event_position`，实时收发和 fanout 交给 `socketioxide`。

### 1.2 只能一个事件一个 handler，不能偷偷多点接线

- `socketioxide` 官方文档明确写了：同一个 event 只能存在一个 handler；后注册会替换前注册。

对 `koko` 的直接约束：

1. 同一实时事件名不得在不同模块重复注册。
2. 所有 socket 事件名要先收口成稳定表，再注册到唯一入口。
3. 任何“顺手再挂一个 handler”都是隐式覆盖风险，不得进入主干。

### 1.3 connect middleware 是鉴权门，不是发消息门

- 官方文档支持在 namespace connect handler 前串多个 middleware。
- middleware 返回 `Result<(), E>`；失败则连接被拒绝，并返回 `connect_error`。
- 官方还明确提醒：因为此时 socket 还没真正接入 namespace，所以 middleware 里不能往这个 socket 发消息。

对 `koko` 的直接约束：

1. 会话合法性、基础鉴权、最早期连接参数校验，优先放 connect middleware。
2. middleware 只做“能不能接入”判定，不做入房、发消息、补洞这种业务流程。
3. 订阅成功、快照下发、历史补洞不能塞在 middleware 里做。

### 1.4 全局状态和每 socket 状态要分层，不要乱塞

- 官方文档区分了两类状态：
  - `with_state` 提供全局共享状态，需可 `Clone`，官方建议用 `Arc` 共享。
  - `extensions` 提供 per-socket 扩展状态。
- 官方 extractor 顺序也有明确约束：extractor 按声明顺序运行，出错时 handler 不会被调用，并会打 tracing 错误。

对 `koko` 的直接约束：

1. 全局共享状态只放 adapter 所需共享资源，比如 `SocketIo` 句柄、广播服务、仓储工厂、运行配置。
2. per-socket extension 只放连接会话上下文，比如已认证的 `session_id`、当前订阅集合、节点局部连接元信息。
3. 不得把房间成员真相、消息成立真相塞进 extension 当“局部缓存真相”。

### 1.5 官方明确建议：不要自己长期保存 `SocketRef`

- 官方文档明确提醒：`SocketRef` 是 socket 的引用，不建议自己塞进 `HashMap/Vec` 长期保存；如果这么做，断开时要自己清理，否则有内存泄漏风险。
- 同时官方说明 `SocketIo` 句柄廉价可 clone，且可跨 namespace 发消息；`SocketRef` 只局限当前 namespace。

对 `koko` 的直接约束：

1. 不要自己维护“房间 -> SocketRef 列表”这种私有广播核心。
2. 房间 fanout 优先复用 `socketioxide` 的 room/operator 能力。
3. 跨 handler、跨任务需要广播时，优先传 `SocketIo` 或围绕它的薄服务，不长期持有 `SocketRef`。

## 2. 多房间群聊最关键的官方做法

### 2.1 room 是广播分组，不是业务成员真相

- Socket.IO 官方文档明确写了：room 是 server-only concept，客户端拿不到加入过的 room 列表。
- 官方还说明：向多个 room 广播时执行的是 union，落在多个房间里的 socket 也只会收到一次。
- `socketioxide` 也沿用同样语义：`to(room)` 默认排除当前 socket；`within(room)` 包含当前 socket。

对 `koko` 的直接约束：

1. 业务上谁是成员，只由 `application/domain` 判断。
2. 实时上某个连接是否 join 某个 room，只表示“当前连接被纳入某个广播分组”。
3. 房间广播必须根据语义选对 operator：
   - “广播给其他人，不含自己”用 `to(room)`
   - “广播给全房，包括自己”用 `within(room)` 或 `io.to(room)`
4. 多房间广播时要记住 union 语义，不能假设会重复送达。

### 2.2 join / leave / emit 在远程 adapter 下都不是“本地小动作”

- `socketioxide` operators 文档明确指出：`join()` / `leave()` / `emit()` 在水平扩展或远程 adapter 下可能与远端实例通信，因此相关操作需要按官方方式 `await`。

对 `koko` 的直接约束：

1. 不能把 room join/broadcast 当纯内存副作用随手调用然后不等结果。
2. 未来如果切 Redis adapter，多房间广播相关代码不需要改语义，但必须已经写成官方推荐的 await 形式。
3. 这也是为什么“自己维护一套房间表和广播循环”是倒退，不是进步。

### 2.3 ACK 只能证明对端回了，不证明业务真相成立

- Socket.IO 官方把 acknowledgements 定义成 request-response 风格能力。
- `socketioxide` 官方也把 ACK 分成两类：
  - `AckSender`：服务端响应客户端 ACK。
  - `emit_with_ack`：服务端发消息并等待客户端确认，可配 timeout。
- 官方默认 ACK 有超时语义；`socketioxide` 里默认 5 秒，也可用 builder 或 operator 覆盖。

对 `koko` 的直接约束：

1. ACK 只能用于传输级确认、控制面确认、客户端处理确认。
2. “消息已创建”仍然必须由领域事件或带同一锚点的快照宣布。
3. 可以把 ACK 用在订阅控制面、后台命令、运维探活，不要把 ACK 当消息成立凭证。

### 2.4 recovery 是缓冲垫，不是最终一致性方案

- Socket.IO 官方写得很直白：临时断线不可避免，recovery 不是永远成功；恢复失败时仍然需要应用自己做客户端与服务端重新同步。
- 官方恢复依赖合理的 `maxDisconnectionDuration`，不是无限窗口。
- Delivery guarantees 文档也明确：默认只有顺序保证和 `at most once`；要更强保证，应用必须自己做 `unique id + persist + offset`。

对 `koko` 的直接约束：

1. `event_position` 仍然是主同步锚点，不能因为用了 socketioxide / Socket.IO 就不做补洞。
2. 恢复主线必须仍然是：`已知位置 -> 订阅/重连 -> 检测缺口 -> 拉增量 -> 不可闭合则重拉快照`。
3. 连接恢复成功只能减少重拉频率，不能替代权威同步闭环。

## 3. 对 `koko` 下一步最直接的修复建议

### 3.1 先补“真群聊”，不要停在“只回显给自己”

现在最该修的不是更多页面，而是把实时主链修成真正的多房间群聊：

1. 订阅房间时，先经过会话/成员资格校验，再允许该连接 join 对应广播 room。
2. 发送消息成功后，不再只 `emit` 回当前 socket，而是向该房间广播权威领域事件。
3. 发送者是否也收到广播，要基于契约统一决定，不能现在一处回显、另一处广播。
4. 若选择“全房都收同一个权威事件”，推荐统一使用包含发送者的广播语义，避免发送者走单独旁路。

### 3.2 让 connect middleware 做最早的连接准入

建议把最早期校验收口到 connect middleware：

1. 校验基础会话格式或连接 auth 结构。
2. 把已认证的连接级 `session_id` 放进 socket extension。
3. 后续 `subscribe_room_stream` / `send_text_message` 不再信任 payload 里的自由文本会话标识。

这样可以减少两种退化：

1. 前端随便伪造 `session_id`。
2. 同一连接上每个事件都重新发明一遍“我是谁”协议。

### 3.3 让 room 只做 fanout，成员真相只做裁决

建议把实时“订阅房间”拆成两步：

1. 用例层回答：该 `session_id` 是否有资格订阅这个房间。
2. adapter 层执行：让当前 socket join 这个广播 room，并返回控制面结果。

这会让边界非常清楚：

1. 领域决定谁有资格。
2. socketioxide 负责把合格连接纳入广播分组。
3. 两者谁都不冒充对方。

### 3.4 广播语义收口到一个薄服务，不要散在回调里

建议新增一个非常薄的实时广播服务，内部只包 `SocketIo` operator 组合，不包业务规则：

1. `广播房间权威事件(room_id, event)`
2. `向单连接返回控制面结果(socket, result)`
3. `向重连连接补发某段事件流(socket, events)`

这不是再造轮子，因为它不重新实现 rooms/emit/adapter，只是把项目自己的实时语义入口收口到一处。

### 3.5 现在就按官方 testing 思路补真集成测试

Socket.IO 官方 testing 文档给的是“真实 server + 真实 client socket”的测试范式，而不是 mock 一个回调自证。

对 `koko` 来说，下一步至少要补这几类：

1. 两个真实 client socket 订阅同房，A 发消息，B 必须收到广播。
2. A 发消息后，A 自己是否也收到同一领域事件，要按设计断言。
3. 非成员连接订阅房间，必须收到拒绝或 `connect_error`，不能静默成功。
4. ACK 超时或 client 不回 ACK 时，控制面超时应能被观测。
5. 模拟断线重连后，从已知 `event_position` 续接并补洞。

## 4. 反模式清单

以下做法和官方最佳实践冲突，后续不要再走：

1. 不要自己维护 `room_id -> Vec<SocketRef>` 当私有广播系统。
2. 不要在多个文件里给同一 event 名重复注册 handler。
3. 不要把订阅成功、ACK、页面已显示，当成消息成立或同步成立。
4. 不要让 payload 里自由携带并主导 `session_id`，而连接本身没有认证上下文。
5. 不要把 join room、成员校验、发消息、补洞、广播揉在一个 socket handler 里。
6. 不要因为有 recovery 就省掉 `event_position + 增量补洞 + 快照兜底`。
7. 不要把 `socketioxide` 提供的 room/operator/adapter 能力再包成第二个私有实时核心。
8. 不要把“只在本节点广播”的 `local()` 当默认行为，除非就是明确要限制在单节点。

## 5. 给 `koko` 的落地顺序建议

先后顺序建议如下：

1. 连接准入：把会话认证收口到 connect middleware 或最早期实时准入层。
2. 订阅收口：订阅命令先做成员资格校验，再 join 对应房间广播组。
3. 广播收口：消息成立后向房间广播权威领域事件，而不是只回当前连接。
4. 同步闭环：统一 `event_position` 续接、补洞、快照兜底。
5. 真测试：补真实 socket client/server 集成测试，再谈下一功能。
6. 多节点预留：代码按 adapter 兼容语义写好，但单节点先跑稳；真正多节点时再接 Redis adapter。

## 6. 结论

`socketioxide` 在 `koko` 里的正确位置，不是被削弱、绕开或替代，而是被正确使用。

真正优雅的多房间群聊不是“自己手搓一个更纯的实时层”，而是：

1. 让领域继续做船长，只决定业务真相。
2. 让 `socketioxide` 做称职的大副，只负责实时基础设施。
3. 让房间广播、连接准入、ACK、恢复、适配器这些成熟能力回到官方推荐路径。
4. 让 `koko` 的代码收缩到稳定契约、业务语义、同步锚点和薄适配层，而不是膨胀成一套私有实时轮子。

## 7. 官方来源

### socketioxide / docs.rs

- socketioxide crate docs: [https://docs.rs/socketioxide/latest/socketioxide/](https://docs.rs/socketioxide/latest/socketioxide/)
- BroadcastOperators: [https://docs.rs/socketioxide/latest/socketioxide/operators/struct.BroadcastOperators.html](https://docs.rs/socketioxide/latest/socketioxide/operators/struct.BroadcastOperators.html)
- Socket API: [https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html](https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html)
- socketioxide-redis README / docs: [https://docs.rs/crate/socketioxide-redis/latest](https://docs.rs/crate/socketioxide-redis/latest)

### Socket.IO 官方文档

- Rooms: [https://socket.io/docs/v4/rooms/](https://socket.io/docs/v4/rooms/)
- Emitting events: [https://socket.io/docs/v4/emitting-events/](https://socket.io/docs/v4/emitting-events/)
- Delivery guarantees: [https://socket.io/docs/v4/delivery-guarantees/](https://socket.io/docs/v4/delivery-guarantees/)
- Connection state recovery: [https://socket.io/docs/v4/connection-state-recovery/](https://socket.io/docs/v4/connection-state-recovery/)
- Testing: [https://socket.io/docs/v4/testing/](https://socket.io/docs/v4/testing/)
