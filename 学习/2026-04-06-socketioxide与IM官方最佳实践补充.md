# 2026-04-06 socketioxide 与群聊 IM 官方最佳实践补充

适用范围：`koko` 实时主通道、冷路径补洞、房间恢复、消息广播、身份认证边界。

这份笔记只收官方资料里能直接影响设计的事实，不写实现代码。

## 1. 事实结论

### 1.1 socketioxide 的角色

- `socketioxide` 是 Rust 的 Socket.IO server / 实时 adapter，不是业务内核。
- 官方把它的能力边界写得很清楚：`namespaces`、`rooms`、`acknowledgements`、`state management`、`adapters`、`polling & websocket transports`。
- 官方文档明确：同一个 event 只能有一个 handler，后注册会覆盖先注册。
- 官方文档明确：connect middleware 可以做鉴权或日志，但 middleware 里不能往 socket 发消息，因为此时 socket 还没真正连接到 namespace。
- 官方文档区分了两类状态：全局共享状态 `with_state`，以及 per-socket 的 `extensions`。
- 官方明确提醒不要长期自己保存 `SocketRef`，否则需要自己清理，容易变成隐式资源管理负担。

### 1.2 Socket.IO 的交付语义

- `room` 是 server-only 的广播分组，不是业务成员真相。
- 多个 room 广播时是 union 语义，不会按房间重复发送。
- `socket.broadcast()` 默认不包含当前 socket，`io.emit()` 或全局上下文可以包含当前 socket。
- `ack` 是 request-response 风格的传输确认，不等于业务事实成立。
- `timeout` 可以给 ack 设置超时，但超时也只是传输确认失败，不是领域失败。
- 默认交付语义不是“必达”，而是顺序 + at-most-once；要更强保证，应用层仍要自己做 `unique id + persist + offset`。
- `connection state recovery` 只是缓冲垫，不是最终一致性方案；恢复失败时仍要靠应用自己重新同步。
- 官方 testing 文档展示的是真实 server + 真实 client 的集成测试思路，而不是只靠 mock 自证。

### 1.3 Telegram / WhatsApp 的高性能设计共识

- Telegram 的官方更新机制核心不是“连接永不掉”，而是用 `seq / pts / qts` 这类内部同步锚点判断是否缺洞，再通过 `updates.getDifference` / `getChannelDifference` 补洞。
- WhatsApp 官方多设备资料强调：每个设备都有自己的 identity key，服务器维护账号与设备身份的映射。
- WhatsApp 官方资料还强调：消息历史和应用状态要跨设备同步，但同步语义仍以设备与账号的受控映射为基础，不靠单一手机在线源真相。
- Meta 的私密消息白皮书强调 `security by design`、`defense in depth`、`reduce the attack surface`，本质上就是减少入口、减少状态、减少旁路真相。

### 1.4 对聊天 UI 的共识

- 官方 IM 资料和成熟产品实践共同指向同一件事：主聊天视图应优先展示消息内容、发送者、时间和上下文。
- 内部同步序号、补洞锚点、协议状态不应作为普通用户主视图的视觉元素。
- 能看见的应该是阅读体验和身份可辨识性，不应该是内部事件编号。

## 2. 直接来源链接

### socketioxide

- [socketioxide docs.rs](https://docs.rs/socketioxide/latest/socketioxide/)
- [socketioxide::socket::Socket](https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html)
- [socketioxide BroadcastOperators](https://docs.rs/socketioxide/latest/socketioxide/operators/struct.BroadcastOperators.html)

### Socket.IO 官方文档

- [Rooms](https://socket.io/docs/v4/rooms/)
- [Emitting events](https://socket.io/docs/v4/emitting-events/)
- [Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)
- [Testing](https://socket.io/docs/v4/testing/)

### Telegram / WhatsApp / Meta

- [Telegram updates 机制](https://core.telegram.org/api/updates)
- [Telegram updates.getDifference](https://core.telegram.org/method/updates.getDifference)
- [WhatsApp multi-device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [Meta Security Principles for Private Messaging](https://engineering.fb.com/wp-content/uploads/2022/07/Meta-Security-Principles-for-Private-Messaging-White-Paper-July-2022-2.pdf)

## 3. 对 koko 的影响

1. `session_id` 更适合放在连接准入和内部同步里，不适合在普通房间搜索页直接暴露。
2. `event_position` 应继续留在冷/热路径同步锚点里，不要渲染成聊天主视图序号。
3. `room` 只能当广播路由，不是成员资格真相；成员资格仍要由用例层裁决。
4. 订阅门禁应该先验身份和成员资格，再允许 join room，再广播。
5. 消息成立不能靠 `ack`，只能靠权威事件或快照锚点宣布。
6. 断线恢复不能替代补洞和重拉快照，`event_position` 仍然是主同步依据。
7. 广播语义要区分“包含自己”和“不包含自己”，不要把回显和广播混成一个模糊动作。
8. UI 主视图应该去掉内部序号，把“我发的 / 别人发的”视觉区分做出来。

## 4. 读完后的裁决

如果后续要动 `koko` 的实时链路，优先顺序应是：

1. 连接准入
2. 房间成员门禁
3. 权威事件广播
4. 补洞与快照恢复
5. 聊天 UI 的展示收口

