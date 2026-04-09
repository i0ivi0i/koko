# 2026-04-04 群聊 IM 官方建议与大神实践对齐清单

适用范围：`koko` 群聊 IM 架构治理、低级 bug 复发防线、实时链路边界收口。  
目标：把 Socket.IO / socketioxide 官方建议和成熟 IM 设计模式，压成可执行约束，而不是停在概念层。

## 1. Socket.IO 官方最佳实践（直接可落地）

### 1.1 先保可靠连接，再谈“纯 WebSocket”

- 官方明确双向链路可能是 `WebTransport` / `WebSocket`，最差会回落到 `HTTP long-polling`。
- Engine.IO 默认“先可靠再性能”：先用 polling 建立，再尝试升级到更优传输。
- 心跳是权威断线判据（`pingInterval` + `pingTimeout`），不是页面“看起来连着”。

对 `koko` 的约束：
- 冷路径（join/load snapshot/send command/recover gap）保留 HTTP，不要强行全塞 WebSocket。
- 热路径只承载事件流，不承载业务真相裁决。

### 1.2 交付语义要说真话：顺序保证 != 必达

- 官方保证消息顺序（包括 polling 升级到 websocket 期间）。
- 默认只保证 `at most once`：断线时事件可能丢，服务端默认不为离线客户端缓存所有错过事件。
- 若要增强交付，官方建议应用层自己做：`event_id + 持久化 + offset + 重连补发`。

对 `koko` 的约束：
- transport ack 只能代表“收到了包/回了响应”，不能代表 `message_created` 成立。
- 必须保持 `client_message_id + message_id + event_position` 三件套做幂等和补洞。

### 1.3 Connection State Recovery 是“缓冲垫”，不是最终一致性方案

- 官方写明：恢复能力不总是成功，应用仍需处理客户端与服务端重新同步。
- 恢复窗口受 `maxDisconnectionDuration` 约束，不可无限拉长。
- 适配器兼容性有边界（官方页已列出支持矩阵，非所有 adapter 都等价）。

对 `koko` 的约束：
- 断线恢复主线必须是：`event_position` 补洞失败 => 重拉快照 => 从锚点续流。
- 不得把“恢复成功过几次”当作可靠性证明。

### 1.4 Rooms 是路由工具，不是业务成员真相

- 官方明确：room 是 server-only concept。
- room 广播是路由分组；成员资格/权限/可见性不是 room 概念。
- 多节点时 room 状态依赖 adapter，同名 room 不等于业务成员真相一致。

对 `koko` 的约束：
- `socket room` 只负责 fanout；成员资格、发言权限、消息可见性只在 `application/domain` 裁决。

### 1.5 多节点上线注意事项（非常容易踩坑）

- 官方指出：默认启用 long-polling 时，多节点必须 sticky session，否则会出现 `Session ID unknown` / HTTP 400。
- 若只走 websocket 可降低 sticky 依赖，但会失去 long-polling 回退。
- 反向代理超时必须大于 `pingInterval + pingTimeout`，否则会被代理层误杀连接。

对 `koko` 的约束：
- 部署文档必须把 sticky、proxy timeout、transports 策略写成显式门禁。

### 1.6 实时链路必须有真实 C/S 集成测试

- 官方 Testing 文档给出服务端 + 客户端联调范式（含 ack、emitWithAck）。

对 `koko` 的约束：
- 至少保留：应用层测试、HTTP command 测试、realtime integration、browser E2E 四层。

## 2. socketioxide 官方实践（Rust 项目重点）

### 2.1 把 socketioxide 当“实时 adapter 层”，不要再手搓第二协议

- 官方 crate 定位：Socket.IO server in Rust（Tower/Hyper 生态），支持 rooms/ack/state/adapter。
- 文档明确 adapter 负责 rooms/sockets 内部状态管理；默认 `LocalAdapter`，多节点需换共享 adapter。

对 `koko` 的约束：
- 保留 `socketioxide` 作为实时主通道 adapter，不自研第二套实时协议语义。

### 2.2 状态和并发边界

- 官方建议全局共享状态用 `SocketIoBuilder::with_state`，并推荐 `Arc` 在 handler 间共享。
- 文档提示一个 event 只能有一个 handler；后注册会替换前注册。

对 `koko` 的约束：
- 禁止“同事件多处注册 + 互相覆盖”的隐式行为。
- 共享状态只放可克隆、可并发安全对象，业务真相仍回 `application/domain`。

### 2.3 多节点与生态兼容边界（redis 适配器）

- `socketioxide-redis` README 明确：不兼容 `@socketio/redis-adapter` / `@socketio/redis-emitter`，不能混用 JS Redis adapter 协议。

对 `koko` 的约束：
- 若未来 Rust/Node 混合集群，必须先统一协议边界；不能“看起来都叫 socket.io”就直接互通。

## 3. 大神 IM 设计模式（官方/标准一手材料）

### 3.1 Telegram：`seq/pts/qts + getDifference` 是补洞核心

- 官方更新机制核心不是“连接永不掉”，而是本地状态与远端状态比对。
- 一旦出现 `local + count < remote`，必须判定 gap 并调用 `updates.getDifference` / `getChannelDifference`。
- `differenceTooLong` 说明增量过大，要按新状态重建同步。

可迁移到 `koko`：
- `event_position` 必须成为一等公民；发现缺口先补洞，再宣布“已同步”。

### 3.2 Discord：HTTP 与 Gateway 分工明确 + 可恢复会话

- 官方 Gateway 文档明确：多数资源操作可走 HTTP API；Gateway 负责实时事件。
- 客户端需缓存序列号 `s`，断线后基于 `session_id + seq` 执行 Resume，并按序回放 missed events。
- 心跳与 ACK 是连接活性判据，ACK 丢失应主动重连并尝试恢复。

可迁移到 `koko`：
- 冷热路径分离不是“传统包袱”，而是大规模实时系统通用工程纪律。

### 3.3 Matrix：事务 ID 保障幂等重试

- Client-Server API 指出 transaction identifier 用于区分“新请求”和“重传请求”，让服务器幂等处理。

可迁移到 `koko`：
- `client_message_id` 必须进入权威命令契约，避免重试重复入库或重复广播。

### 3.4 WhatsApp Multi-Device：每设备身份 + 设备映射 + 同步机制

- 官方文章强调：多设备后每个设备有独立身份密钥。
- 服务器维护“账号 -> 设备集合”映射；发送侧根据设备列表做 fanout。
- 跨设备同步不止消息，还包括应用状态（归档、星标、联系人等）并持续同步。

可迁移到 `koko`：
- “用户在线态”与“设备连接态”必须区分；真相单位是账号与成员资格，不是某个 socket 连接。

### 3.5 Meta 私密消息安全原则：降低攻击面 = 降低 bug 面积

- 白皮书明确 `Security by Design and Defense in Depth`。
- 明确 `Reduce the Attack Surface`：只暴露必要表面、控制复杂度、减少服务端可见数据面。

可迁移到 `koko`：
- 减少机制种类、减少例外入口、删除低价值桥接，本质上同时提升安全性与稳定性。

## 4. 给 `koko` 的执行性清单（可直接进门禁）

1. `ack != message_created`，只有权威事件/快照锚点能宣布消息成立。  
2. `room != member truth`，room 只用于路由广播。  
3. 所有同步链路必须携带并推进 `event_position`。  
4. gap 检测失败不可静默：必须补洞或重拉快照。  
5. 发送命令强制携带 `client_message_id`，服务端幂等。  
6. HTTP(冷路径) 与 realtime(热路径) 明确分工，不混锅。  
7. socket handler 不做业务裁决，只做协议翻译+命令映射。  
8. 共享契约（contract）禁止壳层展示字段和流程状态。  
9. 多节点上线前必须完成 sticky/proxy timeout/adapter 兼容性验收。  
10. 保留四层测试门禁：application / HTTP / realtime / E2E。  

## 5. 原始来源（官方优先）

- Socket.IO How it works: https://socket.io/docs/v4/how-it-works/  
- Socket.IO Delivery guarantees: https://socket.io/docs/v4/delivery-guarantees/  
- Socket.IO Connection state recovery: https://socket.io/docs/v4/connection-state-recovery/  
- Socket.IO Rooms: https://socket.io/docs/v4/rooms/  
- Socket.IO Using multiple nodes: https://socket.io/docs/v4/using-multiple-nodes/  
- Socket.IO Testing: https://socket.io/docs/v4/testing/  
- socketioxide API: https://docs.rs/socketioxide/latest/socketioxide/  
- socketioxide crate README: https://docs.rs/crate/socketioxide/latest/source/README.md  
- socketioxide-redis README: https://docs.rs/crate/socketioxide-redis/latest/source/README.md  
- Telegram Working with Updates: https://core.telegram.org/api/updates  
- Telegram updates.getDifference: https://core.telegram.org/method/updates.getDifference  
- Discord Gateway docs: https://docs.discord.com/developers/events/gateway  
- Matrix Client-Server API: https://spec.matrix.org/latest/client-server-api/  
- WhatsApp Multi-Device: https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/  
- Meta Security Principles for Private Messaging (PDF): https://engineering.fb.com/wp-content/uploads/2022/07/Meta-Security-Principles-for-Private-Messaging-White-Paper-July-2022-2.pdf  
