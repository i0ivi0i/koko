# socketioxide 单节点多房间群聊主通道设计

日期：2026-04-06  
状态：设计已落地，单节点主通道已实现并完成真实链路验收

## 实现状态（2026-04-06）

1. 已完成启动期共享 `PgPool` 与共享 `应用状态`
2. 已完成 handshake `auth.session_id` + connect middleware + socket extension
3. 已完成订阅资格回到 usecase，订阅成功后 `join(room)`
4. 已完成发送成功后统一 `room_event` 房间广播，取消发送者私有成功回显
5. 已完成前端乐观态通过 `client_message_id` 与权威 `room_event` 收敛
6. 已完成基于官方 `socket.io-client` 的真实双客户端同房广播验收

## 1. 目标

本设计只解决一个问题：

把 `koko` 当前“有消息真相最小闭环，但 realtime 主链未成立”的状态，收口成：

1. 单节点可用的多房间实时群聊主通道
2. 发送者与接收者统一收敛到同一条权威事件流
3. `socketioxide` 作为实时主通道二副被满血使用
4. 领域继续掌握成员资格、消息成立、事件位置推进等业务真相
5. 后续扩展多节点时，不需要重写单节点主链

本设计明确不解决：

1. 多节点部署与 Redis adapter 接入
2. 已读、撤回、@提及、文件消息
3. 富权限体系和房间治理
4. 复杂在线态与 presence 系统
5. 端到端加密

## 2. 现状与问题

当前后端已经具备：

1. 匿名会话引导
2. 按短码进房或建房
3. 房间快照与按位置拉增量
4. 文本消息落库与 `event_position` 推进
5. 最小 HTTP 冷路径

当前后端仍缺失：

1. realtime 连接级身份收口
2. 成员资格校验后的房间订阅
3. 真正的房间广播 fanout
4. 发送者与接收者统一的权威事件流
5. 真实多客户端 socket 集成测试

当前 realtime 最大问题不是“不能收消息”，而是“还没有一条真正成立的群聊实时主链”：

1. 订阅链路还没有把成员资格校验、房间 join、增量续接收口成一条路径
2. 发送成功后只是回当前 socket，不是向房间广播
3. `socketioxide` 的 room/operator 能力还没真正发挥出来

## 3. 设计原则

### 3.1 船长与二副分工

1. 领域与用例是船长：决定谁能订阅、谁能发言、消息何时成立、事件位置如何推进。
2. `socketioxide` 是实时主通道二副：负责连接、命名空间、房间、广播、ACK、adapter、断开、连接上下文。
3. 禁止二副篡位：`socketioxide` 不得决定成员真相、消息成立真相或同步真相。

### 3.2 不手搓已有成熟能力

本阶段明确禁止：

1. 自建 `room_id -> Vec<SocketRef>` 私有广播表
2. 自建第二套 ACK 协议
3. 自建第二套重连恢复协议
4. 自建第二套 realtime 事件总线
5. 自建第二套房间同步核心

可直接复用的成熟能力：

1. `socketioxide` rooms / operators / middleware / extensions / adapters
2. PostgreSQL 事务与持久化
3. 现有 `event_position` 快照 + 增量同步闭环

### 3.3 性能优先，但不牺牲真相

单节点阶段要把 `socketioxide` 用到高性能正确形态，但禁止为性能破坏：

1. 领域主权
2. 单一真相
3. 权威事件流
4. 同步锚点
5. 失败路径显式暴露

## 4. 总体架构

### 4.1 逻辑分层

1. `domain`
   - 成员资格不变量
   - 文本消息不变量
   - 房间短码规则

2. `application / usecase`
   - 校验订阅资格
   - 发送文本消息
   - 加载房间快照
   - 推进消息事件位置

3. `contract`
   - 稳定命令/快照/领域事件/控制面结果/错误码

4. `adapter / shell`
   - HTTP 冷路径
   - `socketioxide` realtime 热路径
   - 协议翻译
   - room join / room broadcast
   - 控制面结果转码

### 4.1.1 真相归属矩阵

为防止后续实现时边界漂移，以下真相归属在本设计中不可改写：

| 内容 | 唯一允许归属 |
|---|---|
| 会话是否合法 | `application/usecase` + 仓储事实查询 |
| 谁是房间成员 | `application/usecase` + 仓储事实查询 |
| 谁能发言 | `domain` 不变量 |
| 消息是否成立 | `usecase` 返回的权威领域事件 |
| `event_position` 如何推进 | `repository` 事务提交链 |
| room 是否加入 | `socketioxide` runtime |
| 连接是否在线 | `socketioxide` runtime |
| 页面 pending / 草稿 / 乐观态 | 前端 shell |

额外强调：

1. `room joined` 不是成员真相
2. `socket connected` 不是会话真相
3. `control_result.success` 不是消息成立
4. `ack` 不是消息成立

### 4.2 冷热路径分工

冷路径继续负责：

1. bootstrap session
2. join room / create room
3. load snapshot
4. load events
5. 后台查询

热路径负责：

1. 已认证连接的 realtime 订阅
2. 同房权威事件广播
3. `event_position` 续接起点对齐
4. 控制面结果与错误返回

### 4.3 运行时主链时序

为避免后续改实现时偷偷长出第二条路径，本设计把两条主链写死如下。

#### 4.3.1 订阅主链

1. 客户端建立 socket 连接并携带 `session_id`
2. connect middleware 校验会话并写入 socket extension
3. 客户端发送 `subscribe_room_stream { room_id, from }`
4. realtime handler 从 extension 读取 `session_id`
5. 用例层校验该会话对该房间是否具备订阅资格
6. 校验通过后 `socket.join(room_id)`
7. 从仓储拉取 `from` 之后的增量事件
8. 返回 `control_result.subscribed`
9. 回补缺失 `room_events`

#### 4.3.2 发送主链

1. 客户端发送 `send_text_message { room_id, client_message_id, text }`
2. realtime handler 从 extension 读取 `session_id`
3. 调用发送消息用例
4. 用例完成成员资格校验、文本不变量校验、事务提交、事件位置推进
5. 仓储返回权威 `领域事件::消息已创建`
6. realtime broadcaster 向 `room_id` 广播统一 `room_event`
7. 发送者和所有订阅者都收到同一份权威事件

这两条链任何一步若失败，都只允许走：

1. `connect_error`
2. `control_result.rejected`
3. `control_result.error`

禁止长出：

1. 发送者私有成功事件
2. 页面专用成功状态
3. 第二套“轻量同步通知”

## 5. Realtime 契约设计

### 5.1 连接准入

客户端在 socket 连接握手阶段提供：

```json
{
  "session_id": "s-xxxx"
}
```

服务端在 connect middleware 中完成：

1. auth 数据解析
2. `session_id` 最小合法性校验
3. 会话存在性确认
4. 把已认证会话上下文放进 socket extension

本阶段最小准入结果：

1. 合法：允许接入 namespace
2. 非法：拒绝连接，返回 `connect_error`

### 5.2 订阅命令

客户端事件：

`subscribe_room_stream`

负载：

```json
{
  "room_id": "r-xxxx",
  "from": 12
}
```

服务端处理步骤：

1. 从 socket extension 取连接级 `session_id`
2. 用例层校验该会话是否具备房间成员资格
3. 校验通过后，让当前 socket `join(room_id)`
4. 查询 `from` 之后的增量事件
5. 先发控制面结果，再发补齐事件流

订阅建立后的不变量：

1. 当前 socket 已加入 `room_id` 对应广播分组
2. 当前 socket 的业务订阅资格已在用例层通过
3. 当前 socket 收到的后续 `room_event` 都只代表已成立领域事实
4. 当前 socket 若断线重连，仍以 `event_position` 作为唯一续接锚点

控制面结果语义：

1. 订阅已建立
2. 起始位置/当前最新位置
3. 拒绝订阅
4. 系统错误

### 5.3 发送命令

客户端事件：

`send_text_message`

负载：

```json
{
  "room_id": "r-xxxx",
  "client_message_id": "c-xxxx",
  "text": "hello"
}
```

服务端处理步骤：

1. 从 socket extension 取连接级 `session_id`
2. 调用发送消息用例
3. 用例返回权威领域事件 `消息已创建`
4. 通过 room operator 向整个房间广播统一 `room_event`

本设计明确规定：

1. 发送者与其他成员都收同一份 `room_event`
2. 发送者前端如果要做乐观态，使用 `client_message_id` 与权威事件配对收敛
3. 不再给发送者单独走“命令成功即消息成立”的旁路

发送成功后的不变量：

1. 房间事务已提交
2. `room_events` 与 `messages` 已同步写入
3. `rooms.latest_event_position` 已推进
4. 广播出去的 `room_event` 与事务提交返回的领域事件语义完全一致
5. 广播语义不因“发送者本人”发生分叉

### 5.4 事件语义

权威业务事件：

`room_event`

它承载的仍然是现有契约里的 `领域事件::消息已创建`。

控制面事件：

`control_result`

它只承载：

1. 订阅建立
2. 订阅拒绝
3. 命令拒绝
4. 系统错误

禁止让 `control_result` 冒充领域事件。

### 5.5 连接上下文语义

本设计引入连接级上下文，但其职责必须被严格限制。

socket extension 允许保存：

1. `session_id`
2. 必要的认证结果
3. 节点局部连接元信息

socket extension 禁止保存：

1. 房间成员资格真相缓存
2. 消息成立缓存
3. `event_position` 权威真相
4. 任何跨连接共享业务状态

## 6. 模块改动设计

### 6.1 `src/用例.rs`

新增一个最小用例：

1. `校验房间订阅资格(仓储, room_id, session_id)`

职责：

1. 只判断该会话是否能订阅该房间
2. 不夹带 socket、HTTP、room、adapter 语义

保留现有：

1. `发送文本消息`
2. `加载房间快照`
3. `按短码进房或建房`

禁止在 `usecase` 层引入：

1. `SocketRef`
2. `SocketIo`
3. room join / leave
4. 广播 operator
5. HTTP / JSON / socket 协议细节

### 6.2 `src/外壳.rs`

新增或调整：

1. connect middleware
2. 连接上下文 extension 类型
3. 订阅 handler
4. 发送 handler
5. 房间广播薄服务

广播薄服务只做：

1. 向指定房间广播权威领域事件
2. 向单连接返回控制面结果
3. 向单连接补发某段事件流

该服务禁止：

1. 决定成员资格
2. 决定消息成立
3. 决定同步是否闭环

`外壳.rs` 的实现必须遵守：

1. realtime handler 只做协议翻译与接线，不写业务裁决
2. 任何与成员资格、消息成立有关的判断，必须转回 `usecase`
3. 任何向房间广播的业务事实，必须来自权威领域事件，不得在 handler 里拼装第二套事实
4. 不得在不同位置重复注册同一 event handler

### 6.3 `src/契约.rs`

原则：

1. 优先复用现有 `领域事件 / 控制面结果 / 错误码`
2. 不新增第二套 realtime 专属业务事件语义

允许的最小调整：

1. 如现有 `控制面结果` 无法表达订阅建立后的必要信息，则做最小增量扩展
2. 继续保持共享契约无 UI 语义、无页面流程语义

额外约束：

1. 不新增 `realtime_message_success` 之类只服务当前 adapter 的新事件
2. 不新增 `sender_view` / `receiver_view` 之类壳层专属载荷
3. 不新增只有 Web 能理解的字段形状

### 6.4 `src/适配.rs`

保留现有事务链：

1. 锁房间
2. 写 `room_events`
3. 写 `messages`
4. 推进 `rooms.latest_event_position`

本阶段不在仓储层新增：

1. room 广播逻辑
2. socket 状态逻辑
3. 第二套同步状态

额外约束：

1. 仓储层只返回事实与错误码，不返回 socket 专用状态
2. 事务链不得为 realtime 适配层“顺手”塞额外展示字段
3. 不得把 room 成员 runtime 状态写回数据库冒充业务成员关系

## 7. 高性能设计约束

### 7.1 热路径最薄化

realtime handler 只允许做：

1. 取连接上下文
2. 解析 payload
3. 调用用例
4. 广播结果或返回控制面错误

禁止在热路径：

1. 做展示模型拼装
2. 堆复杂条件分支
3. 重复解析身份
4. 维护私有广播表
5. 新造同步状态机
6. 无必要的重复序列化
7. 为“好 debug”保留双发或双写逻辑

### 7.2 单一广播路径

消息成立后只允许一条权威广播路径：

1. 用例返回领域事件
2. `socketioxide` room operator 广播
3. 所有订阅者统一接收

禁止：

1. 给发送者单发一份“成功事件”
2. 给其他成员再广播一份“房间事件”
3. 两条路径表达同一事实

补充要求：

1. 广播入口必须尽量集中，便于未来切 adapter 与加日志
2. 若未来需要局部控制面单发，也不得与权威业务广播共用事件名

### 7.3 单节点先跑满，再预留多节点

本阶段：

1. 使用单节点默认 adapter
2. handler 和广播入口按 `A: Adapter` 兼容形态组织
3. 不接 Redis adapter

这样做的目的是：

1. 先把语义跑稳
2. 避免以后切 adapter 时重写主链

### 7.4 性能优化边界

本设计允许的性能优化：

1. 使用 `socketioxide` 原生 room/operator
2. 连接级身份缓存于 extension
3. 薄 broadcaster 封装，减少重复逻辑
4. 合理的 builder 配置优化

本设计禁止的性能优化：

1. 把成员资格判断缓存进 socket 当权威真相
2. 用本地成功态替代权威事件回流
3. 为减少一次数据库查询而让业务规则掉回 adapter
4. 为减少广播代码量而自造第二套私有消息总线

## 8. 失败语义

### 8.1 连接失败

1. session 无效
2. auth 结构非法
3. 中间件校验失败

结果：

1. 拒绝 namespace 连接
2. 返回 `connect_error`

### 8.2 订阅失败

1. 非成员
2. 房间不存在
3. 参数非法
4. 系统错误

结果：

1. 不加入 room
2. 返回 `control_result.rejected` 或错误

### 8.3 发送失败

1. 非成员
2. 文本为空
3. `client_message_id` 非法
4. 系统错误

结果：

1. 不广播
2. 返回 `control_result.rejected` 或错误

### 8.4 广播失败

本阶段必须显式记录：

1. 序列化失败
2. 连接已断
3. 内部缓冲满

广播失败不允许静默吞掉。

### 8.5 可观测性字段

为防止后面排障失焦，本设计要求以下字段尽量贯穿主链日志：

1. `session_id`
2. `room_id`
3. `client_message_id`
4. `event_position`
5. `usecase`
6. `adapter`
7. `error_code`

若某条日志确实拿不到其中某些字段，也必须明确是哪个阶段拿不到，而不是随意缺失。

## 9. 测试设计

### 9.1 保留现有测试

继续保留：

1. 领域测试
2. 用例测试
3. HTTP 冷路径测试
4. 事务顺序测试

### 9.2 新增 realtime 真实集成测试

至少补以下测试：

1. 两个真实 socket client 订阅同房，A 发消息，A/B 都收到同一 `room_event`
2. 非成员订阅被拒绝
3. 非成员发送被拒绝
4. 发送者的 `client_message_id` 能与回流权威事件对齐
5. 断线后从指定 `event_position` 续接补齐
6. 同一房间内多个订阅者收到的 `event_position` 连续一致
7. 不同房间之间广播严格隔离
8. 发送失败时不会错误广播给房间其他成员

### 9.3 性能与错误观测验证

至少验证：

1. room 广播链路有结构化日志
2. 广播失败可被日志追踪
3. 没有第二套成功路径

## 10. 防漂移实施检查点

为了防止实现阶段跑偏，每完成一段都必须回看以下检查点。

### 10.1 完成连接准入后检查

1. realtime 事件是否已不再信任 payload 里的 `session_id`
2. connect middleware 是否只做准入，不做业务流程
3. extension 是否只保存连接级上下文

### 10.2 完成订阅主链后检查

1. 订阅资格是否由用例层裁决
2. `join(room)` 是否只在资格通过后执行
3. 订阅建立后是否统一先发控制面结果，再补发事件

### 10.3 完成发送主链后检查

1. 是否已取消“只回当前 socket”的旁路成功事件
2. 是否已统一为房间广播权威领域事件
3. 发送者与接收者是否收同一份 `room_event`

### 10.4 完成测试后检查

1. 是否已有真实双客户端同房广播测试
2. 是否已有非成员拒绝测试
3. 是否已有跨房间隔离测试
4. 是否已有断线续接测试

## 11. 实施顺序

1. 增加连接级会话上下文与 connect middleware
2. 新增订阅资格用例
3. 调整 realtime 订阅 payload 与 handler
4. 引入薄的房间广播服务
5. 调整发送 handler 为房间广播统一事件流
6. 补真实 socket 多客户端集成测试
7. 跑现有测试 + 新增测试 + 关键链路手动验证

### 11.1 每步完成定义

每一步只有满足以下条件才允许进入下一步：

1. 对应代码已落地
2. 对应测试已补齐或更新
3. 没有新增第二套真相路径
4. 日志与错误语义未退化
5. 注释已同步

## 12. 验收标准

当且仅当以下全部满足，才算本设计落地成功：

1. 单节点下，多个客户端可加入多个房间并实时群聊
2. 发送者与接收者都收同一份权威 `room_event`
3. 订阅与发送都不再依赖 payload 里的自由 `session_id`
4. `socketioxide` rooms/operator 被真正用于房间广播
5. 没有新增第二套真相、第二套路由、第二套同步锚点
6. 真实 socket 集成测试通过
7. 冷路径快照 + 增量兜底仍成立

### 12.1 明确视为失败的情况

以下任一情况出现，都视为设计未落地成功：

1. 发送者看到的消息成立路径与其他成员不同
2. 仍可通过 payload 伪造 `session_id`
3. 订阅不经成员资格校验也能成功
4. 业务成功路径依赖 `control_result` 或 ACK
5. 为广播方便新增私有 `room -> sockets` 表
6. 为性能方便新增第二套简化事件语义

## 13. 风险与边界

### 13.1 当前明确不做

1. 多节点 adapter 接入
2. sticky session 发布门禁
3. Redis / Valkey 集群同步
4. 全量性能压测

### 13.2 当前必须准备好

1. handler 形态不绑死单节点实现
2. room 广播逻辑不自建私有核心
3. 同步锚点继续统一到 `event_position`
4. 广播入口未来可平滑切 Redis adapter

### 13.3 未来多节点时禁止回头推翻的设计点

以下点一旦在本阶段立住，未来多节点也不允许推翻：

1. 领域事件仍是唯一权威业务广播载荷
2. `event_position` 仍是唯一同步锚点
3. room 仍只是广播分组，不是业务成员真相
4. 连接级身份仍来自连接上下文，不回退到每事件自带身份

## 14. 结论

这次设计的本质不是“给 `koko` 加一个 websocket 功能”，而是：

1. 把 `socketioxide` 从“最小接线器”升级为真正称职的实时主通道二副
2. 把 `koko` 从“有消息闭环但无 realtime 主链”推进到“有单节点优雅多房间群聊主通道”
3. 在不牺牲领域主权、不手搓私有 realtime 核心的前提下，把成熟轮子的能力用满
