# socketioxide 单节点多房间群聊主通道设计

日期：2026-04-06  
状态：已确认设计，待按计划实施

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

### 6.3 `src/契约.rs`

原则：

1. 优先复用现有 `领域事件 / 控制面结果 / 错误码`
2. 不新增第二套 realtime 专属业务事件语义

允许的最小调整：

1. 如现有 `控制面结果` 无法表达订阅建立后的必要信息，则做最小增量扩展
2. 继续保持共享契约无 UI 语义、无页面流程语义

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

### 7.2 单一广播路径

消息成立后只允许一条权威广播路径：

1. 用例返回领域事件
2. `socketioxide` room operator 广播
3. 所有订阅者统一接收

禁止：

1. 给发送者单发一份“成功事件”
2. 给其他成员再广播一份“房间事件”
3. 两条路径表达同一事实

### 7.3 单节点先跑满，再预留多节点

本阶段：

1. 使用单节点默认 adapter
2. handler 和广播入口按 `A: Adapter` 兼容形态组织
3. 不接 Redis adapter

这样做的目的是：

1. 先把语义跑稳
2. 避免以后切 adapter 时重写主链

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

### 9.3 性能与错误观测验证

至少验证：

1. room 广播链路有结构化日志
2. 广播失败可被日志追踪
3. 没有第二套成功路径

## 10. 实施顺序

1. 增加连接级会话上下文与 connect middleware
2. 新增订阅资格用例
3. 调整 realtime 订阅 payload 与 handler
4. 引入薄的房间广播服务
5. 调整发送 handler 为房间广播统一事件流
6. 补真实 socket 多客户端集成测试
7. 跑现有测试 + 新增测试 + 关键链路手动验证

## 11. 验收标准

当且仅当以下全部满足，才算本设计落地成功：

1. 单节点下，多个客户端可加入多个房间并实时群聊
2. 发送者与接收者都收同一份权威 `room_event`
3. 订阅与发送都不再依赖 payload 里的自由 `session_id`
4. `socketioxide` rooms/operator 被真正用于房间广播
5. 没有新增第二套真相、第二套路由、第二套同步锚点
6. 真实 socket 集成测试通过
7. 冷路径快照 + 增量兜底仍成立

## 12. 风险与边界

### 12.1 当前明确不做

1. 多节点 adapter 接入
2. sticky session 发布门禁
3. Redis / Valkey 集群同步
4. 全量性能压测

### 12.2 当前必须准备好

1. handler 形态不绑死单节点实现
2. room 广播逻辑不自建私有核心
3. 同步锚点继续统一到 `event_position`
4. 广播入口未来可平滑切 Redis adapter

## 13. 结论

这次设计的本质不是“给 `koko` 加一个 websocket 功能”，而是：

1. 把 `socketioxide` 从“最小接线器”升级为真正称职的实时主通道二副
2. 把 `koko` 从“有消息闭环但无 realtime 主链”推进到“有单节点优雅多房间群聊主通道”
3. 在不牺牲领域主权、不手搓私有 realtime 核心的前提下，把成熟轮子的能力用满
