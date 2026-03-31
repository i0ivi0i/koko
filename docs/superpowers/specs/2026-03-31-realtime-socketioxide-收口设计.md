# Koko Realtime `socketioxide` 收口设计

## 文档定位

本文档只解决一个热点簇：

- 把 realtime 身份承接从“客户端每条消息自报 `session_id`”收回到 socket 连接上下文
- 删除 `src/rt.rs` 中重复包装 `socketioxide` 原语的私有实时 DSL

本文档不是聊天功能扩张设计，不新增新的产品能力，也不顺手改造无关子系统。

---

## 1. 目标

本轮目标只有四个：

1. 让 realtime 与 HTTP 入口都承接同一套会话真相
2. 让 `socketioxide` 负责它擅长的连接、房间、广播和 handler/extractor 表达
3. 删除 adapter 内没有明确边界价值的 `CommandPlan + RealtimeEffect`
4. 补齐能证明新边界成立的测试

完成后，仓库应满足：

- realtime command 不再携带 `session_id`
- socket 连接一旦建立，就带着已校验的会话身份进入 handler
- `rt` adapter 直接调用 `application` 用例，再直接使用 `socketioxide` 原语
- 现有业务真相仍留在 `application / domain / store`

---

## 2. 非目标

本轮明确不做：

- 新增前台实时 UI 功能
- 新增 presence / typing / ack 等新事件
- 改造房间、成员、消息的领域模型
- 改造 admin 查询链路
- 引入新的 runtime、语言或前端工具链

如果后续要让 Web 前台真正接通 realtime，那是下一轮功能实现，不混在本轮治理修复里。

---

## 3. 现状问题

### 3.1 身份真相放错层

当前 [src/contract.rs](/E:/koko/src/contract.rs) 中的 realtime command 把 `session_id` 暴露为 wire 字段，导致客户端可以在每次 realtime 命令里自报身份。

这使 realtime 与 HTTP 形成两套身份承接方式：

- HTTP：从 cookie 承接会话
- realtime：从 payload 承接会话

这违反了“adapter 承接鉴权，客户端只表达业务意图”的边界原则。

### 3.2 adapter 开始私有化 `socketioxide`

当前 [src/rt.rs](/E:/koko/src/rt.rs) 先把 join / emit / broadcast 翻译成 `RealtimeEffect`，再解释回 `socketioxide` 原语。

这层结构没有保护业务真相，只是在 adapter 内再造了一层 repo 私有实时 DSL。继续发展下去，会把 ack、disconnect、presence、namespace 等能力一并私有化。

---

## 4. 设计决策

### 4.1 一次性收口，不做过渡态

本轮不采用“先修身份、下一轮再删 DSL”的过渡路径，而是一次性完成：

- 收回身份承接
- 删除私有 DSL
- 调整测试到新边界

理由：

- 两个问题根因相关，拆开做会形成半旧半新的中间态
- 继续保留私有 DSL，会抬高后续每一个 realtime 修复的成本
- 仓库当前体量小，适合一次性在热点簇内收口

### 4.2 保留业务真相，删除通用包装

本轮不会误删这些代码：

- `members` 成员关系真相
- `messages` 消息持久化真相
- `room_codes` 房间短码真相
- `application` 中的成员校验、消息成立校验

这些是业务边界，不是重复造 `socketioxide` 轮子。

真正要删除的是：

- `CommandPlan`
- `RealtimeEffect`
- “先翻成私有枚举，再解释回 `socketioxide`”这层 adapter 包装

---

## 5. 新边界设计

### 5.1 `contract` 层

`contract` 继续只表达多壳共享业务语义，但不再混入 adapter 自己的身份承接字段。

调整原则：

- `SubscribeRoomStreamCommand` 删除 `session_id`
- `SendTextMessageCommand` 删除 `session_id`
- 事件 `MessageCreated`、`RoomStreamSubscribed`、`CommandRejected` 保持业务语义不变
- HTTP 侧使用的 `JoinOrCreateRoomByCodeCommand` 与 `LoadRoomSnapshotQuery` 保持现状，因为它们不是客户端 wire contract，而是应用调用参数

### 5.2 `rt` adapter 层

`rt` adapter 改成两段式：

1. 连接阶段
   - 从 socket 握手上下文提取现有会话标识
   - 校验该会话是否有效
   - 将已认证会话身份挂到 socket extension
   - 未通过认证则拒绝 namespace 连接

2. 消息阶段
   - handler 只接收业务 payload
   - 从 socket extension 提取已认证 `session_id`
   - 组装应用层命令后直接调用 `app::*`
   - 根据结果直接调用 `socketioxide` 的 `join` / `emit` / `to/within`

### 5.3 `application` 层

`application` 仍然拥有：

- 会话有效性校验
- 成员资格校验
- 消息成立真相
- 持久化后的消息事件生成

本轮不把业务判断下放回 `rt` adapter。

### 5.4 `main` 装配层

如果当前 `socketioxide` feature 组合不足以使用所需 extractor / state，将在 `Cargo.toml` 中补足最小 feature 集。

装配原则：

- 优先使用 `socketioxide` 原生 middleware / extension / state 表面
- 不新增 repo 私有 realtime manager / bridge / facade

---

## 6. 身份承接方案

本轮默认方案：

- 使用 socket 握手阶段的连接上下文承接会话，而不是消息 payload
- 认证结果写入 socket extension
- 后续消息 handler 只从 extension 读身份

实现上允许两种等价落点，但只选一种：

1. 直接从握手请求里的 cookie / 请求上下文提取会话
2. 使用 connect auth payload 仅承载“连接级会话证明”，并在 middleware 中校验后写入 extension

推荐顺序：

- 优先用已有 HTTP cookie / 握手上下文
- 若当前 `socketioxide 0.17` 下 cookie 提取成本明显更高，再退到“连接级 auth payload”方案

无论选哪种，都必须满足：

- 身份只在连接阶段承接一次
- 业务消息 payload 中不再出现 `session_id`
- adapter 负责承接身份，客户端只表达业务意图

---

## 7. `socketioxide` 使用原则

本轮明确按官方表面使用：

- connect middleware：做会话认证
- socket extension：存连接级身份
- top-level handler：注册事件
- `socket.join(...)`：加入房间
- `socket.emit(...)`：发给当前连接
- `socket.to(...)` 或 `socket.within(...)`：对房间广播

约束：

- 不在仓库里再造一层“effect interpreter”
- 不长期持有 `SocketRef`
- 不把 runtime room 当成员真相
- 不让 disconnect / room cleanup 决定业务事实

---

## 8. 发送消息语义

发送消息的顺序保持：

1. handler 取已认证 `session_id`
2. 组装 `SendTextMessageCommand`
3. 调用 `app::send_text_message`
4. 持久化成功后返回 `MessageCreated`
5. sender 收到确认事件
6. 房间成员收到广播事件

本轮同时修正一个高风险歧义：

- 必须明确 sender 是否应该收到广播副本

默认设计：

- sender 收到 `message_accepted`
- 房间广播排除 sender

理由：

- sender 的本地确认语义与房间广播语义不同
- 避免 sender 同时收到确认和广播副本造成双重事件流

如果当前库表面上要表达“房间内广播排除当前 socket”，优先使用 `socket.to(room_id)` 而不是全局 `io.to(room_id)`。

---

## 9. 测试设计

本轮必须补齐三层测试。

### 9.1 `contract` 回归测试

证明：

- realtime command 不再序列化 `session_id`
- 事件 wire format 仍稳定

### 9.2 `application` 回归测试

证明：

- 现有 `subscribe_room_stream` / `send_text_message` 业务语义不变
- 用例仍以显式 `session_id` 作为应用输入参数

说明：

- `application` 仍然关心身份真相
- 只是这份身份不再由客户端每条 realtime 消息自报

### 9.3 `rt` adapter 测试

证明：

- 未认证连接无法进入 namespace 或无法通过 handler
- 已认证连接能够把 socket 上下文转成应用层命令
- 成功订阅后会加入 room 并回送确认
- 发送消息成功后先确认，再向房间其他成员广播
- 失败时只发拒绝事件，不广播

若现有测试基建不足，本轮允许先补纯 Rust adapter 单元测试和最小集成测试，但至少要能证明：

- 身份不再来自 message payload
- sender 不会因为广播路径再次收到重复事件

---

## 10. 风险与控制

### 风险 1：`socketioxide 0.17` 与最新文档 API 有差异

控制：

- 实施前先按当前锁定版本核实际 API
- 若确需最小 feature 调整，只做与本轮边界直接相关的补充

### 风险 2：测试改造后出现大面积脆弱性

控制：

- 先写失败测试，再逐步替换
- 不把 application 测试和 realtime adapter 测试混成一层

### 风险 3：顺手扩成前端功能改造

控制：

- 本轮不接通 Web 前台 realtime
- 只收口 server-side realtime 边界与契约

---

## 11. 完成标准

当且仅当以下条件都成立，本轮才算完成：

1. realtime command wire contract 中不再出现 `session_id`
2. realtime 连接阶段能承接并校验会话身份
3. `src/rt.rs` 中不再存在 `CommandPlan` 和 `RealtimeEffect`
4. handler 直接使用 `socketioxide` 原语完成 join / emit / broadcast
5. sender 不会因广播路径再收到重复消息事件
6. `cargo test` 全绿
7. 审查记录可被更新为“已治理完成或已实质缓解”

---

## 12. 实施边界总结

本轮是一次治理性修复，不是功能扩张。

它的本质是：

- 保留业务真相
- 删除通用包装
- 把身份承接收回 adapter
- 把 realtime 基础设施重新贴回 `socketioxide` 官方表面

如果这轮完成，`Koko` 的 realtime 链路会重新回到：

- 业务真相在 `application / domain / store`
- 连接、房间、广播在 `socketioxide`
- adapter 只翻译，不私有化成熟生态

