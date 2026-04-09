# 2026-04-09 socketioxide / socket.io 与 Telegram / WhatsApp 官方资料再补强

适用范围：`koko` 当前“历史加载 / 断线恢复 / 房间同步 / 多设备边界 / Rust 技术选型”的下一轮判断。  
目标：不重复旧笔记已经写透的那些大原则，只补这次再查官方资料后，最值得新增进脑子的硬约束。

---

## 1. 这次新补到的结论

### 1.1 `socket.io` 官方依然把 `retries + ackTimeout` 定义成“发出命令的传输重试”，不是“业务已成立”

- 官方客户端文档写得很清楚：`ackTimeout` 要和 `retries` 一起使用。
- 同一段文档还明确说：超过重试上限后，packet 会被丢弃。
- 这说明它解决的是“客户端发出的这一包有没有被服务端确认收到”，不是“消息是不是已经变成权威事实”。

对 `koko` 的直接约束：

1. `send_text_message` 未来如果要加客户端重试，可以加，但它只能服务“命令送达率”。
2. “消息已创建”仍然必须由权威事件回流、或带同一锚点的快照/增量来宣布。
3. 不能把 ACK 成功、HTTP 200、socket emit 成功、页面本地回显，这几件事混成一件。

来源：

- https://socket.io/docs/v4/client-options/
- https://socket.io/docs/v4/delivery-guarantees/

### 1.2 `socket.io` 官方教程现在更明确地把聊天持久化和 offset 恢复写成“正路”，不是可选锦上添花

- 官方 tutorial 的 ending notes / step 8 直接给了一个“落库消息 + client_offset 去重 + serverOffset 续接 + connectionStateRecovery”的聊天服务样例。
- 这条样例的核心不是“聊天室 demo”，而是把四件事钉死：
  1. 客户端命令要有幂等键；
  2. 服务端消息要持久化；
  3. 客户端要记住自己处理到哪里；
  4. `socket.recovered` 失败时要按 offset 自己补缺口。

对 `koko` 的直接约束：

1. `client_message_id` 这条链是对的，不能再弱化。
2. `event_position + 快照 + 增量补洞` 不是“自己想复杂了”，而是官方正路。
3. `connection state recovery` 只能减轻重拉频率，不能替代应用自己的补洞闭环。

来源：

- https://socket.io/docs/v4/delivery-guarantees/
- https://socket.io/docs/v4/tutorial/step-8
- https://socket.io/docs/v4/tutorial/ending-notes

### 1.3 `socketioxide` 官方 API 的几个硬边界，值得从“知道”升级成“写代码时强制遵守”

这次再看 docs.rs，真正值得钉死的不是“它能发消息”，而是下面几条：

1. 同一个事件只能挂一个 handler，后注册会覆盖前注册。
2. 全局共享依赖应通过 `with_state` / `State<T>` 这类官方入口注入。
3. 每个 socket 的连接级上下文应放进 socket 自己的 extensions / data，不要再散一套私有连接表。
4. `SocketRef` 不适合被你长期塞进自建 `HashMap`；跨任务/跨模块广播时，优先传可便宜 clone 的 `SocketIo`。
5. 广播 `emit()`、以及 `join()/leave()` 这类操作在远程 adapter 下可能与远端实例通信，因此必须按官方语义 `await`。

对 `koko` 的直接约束：

1. 房间 fanout 继续交给 `socketioxide` rooms/operators，不再手搓 `room -> sockets`。
2. 连接级 `session_id / 当前订阅 / 节点局部连接态` 放 socket extension；成员资格真相别塞进去。
3. Realtime handler 保持薄：解协议、拿连接上下文、转稳定 command、回控制面或权威事件。

来源：

- https://docs.rs/crate/socketioxide/latest/source/README.md
- https://docs.rs/socketioxide/latest/socketioxide/
- https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html

### 1.3.1 `Socket.IO` 的 room / 多节点边界，也该从“知道”升级成“强约束”

- 官方 `Rooms` 文档继续强调：room 是 server-only concept，不是客户端真相。
- 断开连接时，socket 会自动离开自己加入过的 rooms。
- 官方 `Using multiple nodes` 文档继续明确：只要还启用 polling，多节点部署就需要 sticky session；否则很容易遇到 `Session ID unknown`。
- 如果你显式只用 WebSocket transport，可以不需要 sticky session，但代价是放弃 long-polling fallback。

对 `koko` 的直接约束：

1. 前端不能把“当前订阅了哪个 room”当成员资格真相。
2. Realtime adapter 继续只把 room 当广播分组能力，不回灌业务真相。
3. 如果未来做多节点，只要不彻底放弃 polling，就必须连 sticky session 一起设计，而不是上线后补锅。

来源：

- https://socket.io/docs/v4/rooms/
- https://socket.io/docs/v4/using-multiple-nodes/

### 1.4 Telegram 官方更新模型给了一个很重要的提醒：当前正在看的会话，应该获得比“后台会话”更积极的补洞力度

- Telegram 官方更新文档继续坚持 `seq / pts / qts + getDifference` 这一套。
- 但它更值得学的地方不是字段名，而是同步策略：当前活跃会话/频道不是和其他会话一视同仁地“被动等推送”，而是应当被更积极地检查差量。
- `dialog` 构造里继续带着 `unread_count`、`read_inbox_max_id`、`read_outbox_max_id` 这类字段，说明成熟 IM 里的“已读推进”一直都是逻辑锚点，不是像素位置。
- `messages.readHistory` 也继续表达同一件事：已读推进是逻辑锚点推进，不是像素位置。

对 `koko` 的直接约束：

1. 当前用户正在看的房间，恢复和补洞优先级应高于其他房间。
2. `last_read_event_position` 继续只表达逻辑已读锚点，不表达滚动条像素。
3. “用户正在看当前房间”这件事，值得成为 future 优化切点，例如更积极的增量检查、补洞、首屏恢复。

来源：

- https://core.telegram.org/api/updates
- https://core.telegram.org/method/updates.getDifference
- https://core.telegram.org/constructor/dialog
- https://core.telegram.org/method/messages.readHistory

### 1.5 WhatsApp / Meta 这两年的公开资料，新增了三条比旧笔记更值得学的东西

#### A. 多设备不只是“每设备独立连接”，还包括更强的身份验证与设备目录校验

- 2021 multi-device 文章讲的是：每个设备有自己的 identity key，服务端维护账号到设备身份映射，一对一走 client-fanout，群组继续用 sender key。
- 2023 key transparency 文章进一步补了：设备目录和身份变化要进 append-only 的 Auditable Key Directory（AKD），而且可公开审计。

这对 `koko` 的启发：

1. 以后如果要认真做多设备，不只是“多 session”就够了，还得考虑设备目录和身份变更真相。
2. 用户级安全校验和运行时连接态，不该混成一个层。

#### B. WhatsApp 公开说明“联系人/应用状态”也需要跨设备私密同步，不只是消息历史

- 2024 的 IPLS 文章讲的是：linked devices 上的联系人管理与恢复，也要有自己的隐私保护存储系统。
- 这说明成熟 IM 真正在同步的不是只有消息，还包括联系人、归档、星标、设备侧应用状态等。

这对 `koko` 的启发：

1. 当前 `阅读锚点 / 房间历史 / 本地恢复锚点` 这类状态，未来不要再偷懒当“纯页面细节”。
2. 要提前分清：哪些是 UI 临时态，哪些已经开始接近“跨设备应该同步的应用状态”。

#### C. 2026 Meta 公开谈 WhatsApp 的 Rust at Scale，给纯 Rust 路线补了新的现实依据

- Meta 公开写了：WhatsApp 已把 Rust 媒体一致性库分发到数十亿设备和浏览器。
- 文章里提到他们不是一把梭替换，而是并行实现、差分 fuzz、集成测试、逐步替换。
- 同时他们强调：高风险、处理不可信输入的热路径，优先落在 memory-safe 语言上。

这对 `koko` 的启发：

1. 继续优先纯 Rust 路线是对的，不必因为“先做 IM 原型”就默认退回多语言。
2. 但采纳 Rust 不该靠口号，仍要配合差分测试、兼容验证、分阶段替换。
3. 对未来任何处理不可信输入的热路径，Rust 是值得优先押注的现实方案，不只是审美偏好。

来源：

- https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
- https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/
- https://engineering.fb.com/2024/10/22/security/ipls-privacy-preserving-storage-for-your-whatsapp-contacts/
- https://engineering.fb.com/2026/01/27/security/rust-at-scale-security-whatsapp/

---

## 2. 这轮最不该再重复抄写的旧结论

下面这些，`学习/` 里已经讲过很多次了，这次新笔记不再铺开重讲：

1. 默认投递不是必达，仍要保留 offset/position 补洞。
2. room 是广播分组，不是成员资格真相。
3. recovery 是缓冲垫，不是最终一致性方案。
4. Telegram / WhatsApp 的共同点是“快照 + 增量 + 补洞”。
5. 前端滚动位置不是已读真相，已读应该挂在逻辑锚点上。

如果要回看旧结论，直接读这些已有笔记：

- `学习/2026-04-06-socketioxide官方最佳实践与多房间群聊落地笔记.md`
- `学习/2026-04-06-socketioxide与IM官方最佳实践补充.md`
- `学习/2026-04-08-单机多房间实时主链官方资料再学习整理.md`
- `学习/2026-04-06-Telegram-WhatsApp-高性能IM设计与同步锚点笔记.md`

---

## 3. 对 `koko` 当前最直接的新增约束

把这轮新增信息压成工程动作，最有价值的是下面 7 条：

1. **命令送达确认** 和 **消息成立回流** 必须继续分层。  
   以后即使加 `retries + ackTimeout`，也不能让 ACK 冒充 `message_created`。

2. **当前活跃房间** 的恢复与补洞优先级，应该高于普通后台房间。  
   这点更接近 Telegram 的做法。

3. **连接级上下文** 要继续上收进 socket extension / auth，不要把 `session_id` 长期留在业务 payload 里做“自由文本自报家门”。

4. **跨设备应用状态** 未来要尽早分层。  
   阅读锚点、房间恢复锚点、联系人/房间元数据，哪些只是本地 UI，哪些应该进可同步状态，要提前分清。

5. **多设备安全真相** 未来不是“多开几个 session”这么简单。  
   如果真往这边做，要预留设备标识、设备关系、设备校验的契约空间。

6. **Rust 优先** 继续成立，但采用方式要学 WhatsApp：  
   并行验证、差分测试、逐步替换，而不是一口气大爆改。

7. **历史加载 / 恢复体验** 这类问题别再只盯浏览器壳层。  
   真实主链仍然是：权威顺序锚点、前插/补洞语义、连接恢复边界、客户端幂等命令。

---

## 4. 一句话总结

这轮再学习之后，最该更新的认知不是“继续迷信实时推送”，而是：

**成熟 IM 把命令重试、事件权威、连接恢复、活跃会话优先级、多设备身份目录、应用状态同步、Rust 安全热路径，这几件事分得比我们平时直觉里更细。**

---

## 5. 直接来源

- Socket.IO delivery guarantees: https://socket.io/docs/v4/delivery-guarantees/
- Socket.IO connection state recovery: https://socket.io/docs/v4/connection-state-recovery/
- Socket.IO client options: https://socket.io/docs/v4/client-options/
- Socket.IO tutorial step 8: https://socket.io/docs/v4/tutorial/step-8
- Socket.IO tutorial ending notes: https://socket.io/docs/v4/tutorial/ending-notes
- Socket.IO rooms: https://socket.io/docs/v4/rooms/
- Socket.IO using multiple nodes: https://socket.io/docs/v4/using-multiple-nodes/
- socketioxide README (docs.rs source): https://docs.rs/crate/socketioxide/latest/source/README.md
- socketioxide crate docs: https://docs.rs/socketioxide/latest/socketioxide/
- socketioxide Socket docs: https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html
- Telegram Working with Updates: https://core.telegram.org/api/updates
- Telegram updates.getDifference: https://core.telegram.org/method/updates.getDifference
- Telegram dialog: https://core.telegram.org/constructor/dialog
- Telegram messages.readHistory: https://core.telegram.org/method/messages.readHistory
- WhatsApp multi-device: https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
- WhatsApp key transparency: https://engineering.fb.com/2023/04/13/security/whatsapp-key-transparency/
- IPLS for WhatsApp contacts: https://engineering.fb.com/2024/10/22/security/ipls-privacy-preserving-storage-for-your-whatsapp-contacts/
- Rust at Scale for WhatsApp: https://engineering.fb.com/2026/01/27/security/rust-at-scale-security-whatsapp/
