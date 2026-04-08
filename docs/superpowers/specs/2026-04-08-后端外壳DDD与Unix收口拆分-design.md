# 后端外壳按 DDD 与 Unix 智慧收口拆分设计

日期：2026-04-08  
状态：设计已确认，待进入 implementation plan  
范围：Rust 后端 `shell/adapter` 收口重构，重点聚焦 [src/外壳.rs](/E:/koko/src/外壳.rs#L1)；不改前端契约消费方式；不改数据库真相模型  
约束：本期最多新增 3 个后端运行时代码 `.rs` 文件；不改 [src/领域](/E:/koko/src/领域/mod.rs#L1)、[src/用例.rs](/E:/koko/src/用例.rs#L1)、[src/契约.rs](/E:/koko/src/契约.rs#L1) 的业务语义归属；重构过程必须坚持“保语义迁移”，禁止借机顺手改协议、改时序、改错误语义

## 0. 一句话结论

这次重构不是为了把 [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 机械切成几个文件，而是为了把其中已经长期混住在一起的四类 adapter/shell 职责拆回更稳定的协议边界：

1. 房间 HTTP 冷路径
2. 后台 HTTP 冷路径
3. realtime 热路径
4. 壳层公共转码与总装配

最终目标不是“文件更多”，而是：

1. `domain/usecase/contract` 继续掌握业务真相
2. `shell/adapter` 只负责协议翻译和接线，不再积累多种协议职责
3. 后续改房间接口、后台接口、realtime 热路径时，不再需要一起读懂一个 1900+ 行胖壳
4. 拆分过程不引入新的协议漂移、新的状态分叉或新的业务卡死点

---

## 1. 当前诊断

### 1.1 后端 DDD 骨架其实是成立的

当前 Rust 后端并不是“业务逻辑糊在一起”，而是已经具备比较清晰的分层：

1. [src/领域/消息.rs](/E:/koko/src/领域/消息.rs#L1)、[src/领域/房间.rs](/E:/koko/src/领域/房间.rs#L1)、[src/领域/成员.rs](/E:/koko/src/领域/成员.rs#L1) 负责领域不变量与最小规则
2. [src/用例.rs](/E:/koko/src/用例.rs#L1) 负责房间快照、增量事件、阅读推进、发言资格、消息成立等用例真相
3. [src/契约.rs](/E:/koko/src/契约.rs#L1) 提供稳定 command/query/snapshot/event/error code 表面
4. [src/适配.rs](/E:/koko/src/适配.rs#L1) 负责 PostgreSQL 仓储实现与持久化翻译
5. [src/入口.rs](/E:/koko/src/入口.rs#L1) 与 [src/总装.rs](/E:/koko/src/总装.rs#L1) 负责启动、配置、迁移和总装

也就是说，当前问题不在 DDD 核心塌陷，而在壳层没有继续收口。

### 1.2 真正肥大的不是业务核心，而是 `外壳.rs`

[src/外壳.rs](/E:/koko/src/外壳.rs#L1) 当前同时承担了：

1. HTTP 路由注册
2. Realtime 命名空间注册
3. 房间冷路径 handler
4. 后台冷路径 handler
5. 握手认证
6. 订阅与发消息热路径
7. DTO / query 解析
8. 错误码到协议错误的转码
9. 领域事件到 JSON 的转码

这说明现在的真实问题是：

**一个 shell/adapter 文件承担了太多协议职责闭环。**

### 1.3 当前最大风险不是“文件大”，而是“边界大”

如果继续保持现状，后面会持续出现：

1. 新增一个 HTTP 或 realtime 行为时，默认继续塞进 [src/外壳.rs](/E:/koko/src/外壳.rs#L1)
2. 房间冷路径、后台冷路径、realtime 热路径互相陪跑
3. 修改一个协议边界时，维护者必须同时担心不相干区域被误伤
4. 测试和排障时更难聚焦“是哪一类适配层出了问题”

---

## 2. 设计目标

### 2.1 必须达到

1. [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 不再持有三类完整 adapter 闭环
2. `domain/usecase/contract` 的真相归属保持不变
3. `shell/adapter` 按协议职责闭环收口，符合 Unix 风格的“一个模块只回答一种问题”
4. 重构过程不改变现有 HTTP / realtime 对外行为
5. 文件数量控制在克制范围内，不制造 `.rs` 文件海

### 2.2 明确不做

1. 不改数据库 schema
2. 不改 HTTP 路径
3. 不改 socket event name
4. 不改错误码语义
5. 不改房间快照、增量事件、阅读推进、消息成立的业务裁决
6. 不引入新的抽象层如 `manager/service/helper/util` 大杂烩

---

## 3. 架构原则

### 3.1 DDD 约束

后端必须继续维持：

1. 领域规则在 `domain`
2. 用例裁决在 `usecase`
3. 稳定共享语言在 `contract`
4. 数据库与 IO 在 `adapter`
5. 协议接线、错误转码、payload 映射在 `shell`

这次重构只能让壳更薄，不能让壳变成第二套用例层。

### 3.2 Unix 智慧

这次拆分遵守四个原则：

1. 一个模块只回答一种协议问题
2. 模块之间通过小而清晰的接口协作
3. 不按行数切文件，只按职责闭环切文件
4. 能留在现有稳定层次里的逻辑就不再额外新建层级

### 3.3 文件预算约束

当前非测试 Rust 代码文件数量仍在项目纪律允许范围内。本期最多新增 3 个 `.rs` 文件，目标总数仍控制在 `21` 个以内。

本次新增预算全部给真正缺失的三个壳层边界，不再额外申请第 4 个“工具箱文件”。

---

## 4. 方案比较

### 方案 A：不拆文件，只在 `外壳.rs` 内重排区域与注释

优点：

1. 短期风险最低
2. 代码改动表面最小

问题：

1. 只是排版变好，壳层边界没变
2. 后续功能仍会回流进同一个文件
3. 不解决协议职责混住问题

不采用。

### 方案 B：按协议职责闭环拆成 3 个专用外壳模块

优点：

1. 不动 `domain/usecase/contract` 真相
2. 只收口当前最肥大的 adapter 职责
3. 拆分之后认知路径更直
4. 文件数量增加克制，符合当前项目纪律

问题：

1. 需要严格守住“保语义迁移”
2. realtime 热路径必须最后拆，不能贪快

采用此方案。

### 方案 C：大幅继续抽更多 command handler / service / coordinator

优点：

1. 理论上更“纯”

问题：

1. 很容易变成抽象层泛滥
2. 文件海与调用跳转会拉高维护成本
3. 对当前项目规模属于过度设计

不采用。

---

## 5. 最终文件方案

### 5.1 新增 3 个文件

1. [src/房间外壳.rs](/E:/koko/src/房间外壳.rs)  
   负责房间 HTTP 冷路径接口与对应 query/body 收口。
2. [src/后台外壳.rs](/E:/koko/src/后台外壳.rs)  
   负责后台 HTTP 接口、最小后台鉴权接入与后台 DTO。
3. [src/实时外壳.rs](/E:/koko/src/实时外壳.rs)  
   负责 realtime 握手认证、订阅、发消息、发送失败分类。

### 5.2 [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 最终保留职责

1. `应用状态`
2. `构建应用状态`
3. `构建路由`
4. `注册realtime命名空间`
5. `构建共享仓储`
6. 壳层公共转码：
   - `ApiError`
   - `err_resp`
   - `map_domain_err_tuple`
   - `event_to_json`
   - `events_to_json`

### 5.3 三个新文件的硬归属

#### [src/房间外壳.rs](/E:/koko/src/房间外壳.rs)

承接：

1. `bootstrap_session`
2. `join_or_create_room`
3. `load_room_snapshot`
4. `update_room_read_anchor`
5. `load_room_events`
6. `load_room_history`
7. `BootstrapBody`
8. `JoinBody`
9. `UpdateReadAnchorBody`
10. `SnapshotQuery`
11. `ParsedEventsQuery`
12. `ParsedHistoryQuery`
13. `parse_events_query`
14. `parse_history_query`

只回答一个问题：

**房间冷路径 HTTP 如何解码、调用用例、转回稳定 JSON。**

#### [src/后台外壳.rs](/E:/koko/src/后台外壳.rs)

承接：

1. `admin_login`
2. `admin_overview`
3. `admin_rooms`
4. `admin_room_detail`
5. `AdminLoginBody`
6. `AdminLoginResp`
7. `require_admin`
8. `ADMIN_TOKEN`

只回答一个问题：

**后台 HTTP 如何接入与守卫。**

#### [src/实时外壳.rs](/E:/koko/src/实时外壳.rs)

承接：

1. `认证realtime连接`
2. `handle_realtime_subscribe`
3. `handle_realtime_send`
4. `RealtimeConnectAuth`
5. `已认证会话`
6. `RealtimeSubscribeBody`
7. `RealtimeSendBody`
8. `实时发送失败级别`
9. `分类单连接发送失败`
10. `分类广播发送失败`
11. 现有 `#[cfg(test)]` 下的失败分类测试

只回答一个问题：

**realtime 热路径如何接线、认证、订阅、广播和反馈控制面。**

---

## 6. 绝对不能漂移的语义边界

这部分是整份 spec 的核心。后续实施时，任何“顺手优化”只要碰了这些边界，都视为超出本期设计。

### 6.1 会话认证边界不能漂

[认证realtime连接](/E:/koko/src/外壳.rs#L1345) 当前只负责：

1. 解析握手载荷
2. 校验会话是否有效
3. 把已认证会话写入 socket extension

它明确**不负责**：

1. 房间成员资格裁决
2. 房间存在性判断
3. 发言资格裁决

后续迁移到 [src/实时外壳.rs](/E:/koko/src/实时外壳.rs) 后，这个边界必须保持原样。

### 6.2 订阅控制面与领域事件面的顺序不能漂

[handle_realtime_subscribe](/E:/koko/src/外壳.rs#L1435) 当前顺序是：

1. 先查询从 `from` 开始的增量
2. 若 `from > 最新事件位置`，返回 `control_result: need_snapshot_reload`
3. 正常时先 `join(room)`
4. 再发 `control_result: subscribed`
5. 最后发 `room_events`

这里的控制面和领域事件面是故意分开的。  
后续迁移时，不能改成：

1. 先发 `room_events` 再发 `subscribed`
2. 订阅失败时改发 `room_events`
3. 把 `need_snapshot_reload` 变成别的事件通道

### 6.3 订阅拒绝与系统错误的语义不能混

当前 [handle_realtime_subscribe](/E:/koko/src/外壳.rs#L1435) 里：

1. 业务拒绝走 `control_result: rejected`
2. 系统失败走 `control_result: error`

这是前端恢复与自愈链的重要前提。迁移时必须完全保留。

### 6.4 消息成立真相不能从用例层漂回热路径

[handle_realtime_send](/E:/koko/src/外壳.rs#L1652) 当前只在 `usecase::发送文本消息` 返回权威领域事件后，才广播 `room_event`。

这表示：

1. 消息成立真相在 `usecase + repository`
2. socket handler 只负责把已成立事件广播出去
3. 前端 optimistic 不是权威消息成立依据

迁移时绝不能：

1. 让 handler 先构造消息再补写数据库
2. 让 handler 先回成功再等待用例
3. 让成功反馈语义偏离当前权威事件广播逻辑

### 6.5 HTTP query 手动收口语义不能丢

[parse_events_query](/E:/koko/src/外壳.rs#L1867) 和 [parse_history_query](/E:/koko/src/外壳.rs#L1903) 当前是故意手动 parse，而不是直接交给框架自动拒绝。

理由是：

1. 缺参和格式错误也要走项目统一 JSON 错误结构
2. 不能让框架默认错误响应绕开项目自己的稳定错误语义

所以迁移时不能图省事直接换成会破坏错误 JSON 的自动解码写法。

### 6.6 阻塞仓储边界不能漂

当前所有 handler 基本都遵守：

1. async handler 中只做协议接线
2. 阻塞 DB 调用统一进入 `task::spawn_blocking`
3. 仓储统一通过 `构建共享仓储` 构建

这条边界一旦被“优化掉”，就有机会引入：

1. async 执行器阻塞
2. 热路径背压放大
3. 不同 handler 的仓储构造分叉

所以它必须保留。

### 6.7 日志 outcome 语义不能漂

集成测试已经验证过冷路径日志里 `accepted / succeeded / rejected` 与 `error_code` 的结构化语义。  
后续迁移时可以调文件位置，但不能把 outcome 语义改乱。

---

## 7. 低风险迁移顺序

这次迁移不允许“一次搬完再看哪里炸了”。必须分阶段，且每一阶段都要有清晰的回滚点。

### 第 1 阶段：锁住现有行为

实施前先确认并补齐必要的 characterization coverage。当前 [tests/集成测试.rs](/E:/koko/tests/集成测试.rs#L1) 已经覆盖了大量关键行为：

1. HTTP 冷路径闭环
2. `events/history/snapshot/read-anchor` 关键场景
3. admin 登录与后台查询链路
4. accepted / succeeded / rejected 日志语义
5. 部分 realtime 主链语义

这一阶段不改生产代码，只确认后续拆分所依赖的保护网已经足够。

### 第 2 阶段：先拆后台 HTTP

先把后台相关能力迁到 [src/后台外壳.rs](/E:/koko/src/后台外壳.rs)：

1. 与聊天室热路径解耦最明显
2. 依赖面最窄
3. 回归风险最低

迁移方式必须是：

1. 先复制到新文件
2. 由 [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 转调
3. 测试转绿后，再删旧实现

### 第 3 阶段：再拆房间 HTTP 冷路径

把房间 HTTP handler 与 query/body 收口迁到 [src/房间外壳.rs](/E:/koko/src/房间外壳.rs)。

这一步虽然函数多，但仍属于冷路径，风险主要是：

1. 参数解码漂移
2. 错误 JSON 漂移
3. 日志字段漂移

只要坚持保语义迁移，风险仍可控。

### 第 4 阶段：最后拆 realtime 热路径

把握手认证、订阅、发送、失败分类迁到 [src/实时外壳.rs](/E:/koko/src/实时外壳.rs)。

这一步必须最后做，因为它最容易误伤：

1. 订阅时序
2. `control_result` 与 `room_events` 分流
3. `room_event` 广播成立语义
4. 连接关闭、背压、序列化失败的日志与降级语义

### 第 5 阶段：收瘦总壳

等前三块稳定后，再把 [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 收成真正的总装配壳：

1. 构建状态
2. 注册 HTTP 路由
3. 注册 realtime 命名空间
4. 提供小型共享 helper

---

## 8. 实施时的禁止事项

为了防止实现阶段漂移，本期明确禁止：

1. 不改 [src/契约.rs](/E:/koko/src/契约.rs#L1) 的 event / snapshot / error code 结构
2. 不改 `/api/...` 路径和 socket event 名
3. 不改 `control_result` payload 的 `kind/code/message` 语义
4. 不把 `spawn_blocking` 去掉
5. 不把 `require_admin` 升级成复杂后台会话系统
6. 不把 `parse_events_query` / `parse_history_query` 改成会破坏统一错误 JSON 的快捷写法
7. 不额外新增 `helper / utils / manager / service` 杂项文件
8. 不在迁移过程中“顺便优化” SQL、日志文案、数据库结构、前端消费逻辑

---

## 9. 验证策略

### 9.1 每阶段都要跑的验证

1. `cargo test`
2. `cargo clippy --all-targets --all-features`
3. 至少点跑与当前迁移边界直接相关的测试

### 9.2 阶段性重点验证

#### 拆后台外壳后

重点看：

1. admin 登录成功/失败
2. overview / rooms / room detail
3. 后台鉴权失败错误码仍为 `admin_session_required`

#### 拆房间外壳后

重点看：

1. bootstrap
2. join or create
3. snapshot
4. read-anchor
5. events/history 的 query 错误语义
6. accepted / succeeded / rejected 结构化日志

#### 拆实时外壳后

重点看：

1. realtime 握手 invalid_session / system_error 分流
2. subscribe 的 `subscribed / rejected / need_snapshot_reload / error`
3. send 的权威事件广播
4. 广播失败分级

### 9.3 通过标准

这次重构只有同时满足下面条件，才算完成：

1. [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 明显瘦身
2. 新增 3 个外壳模块职责单一
3. `domain/usecase/contract` 未承受额外 adapter 反向污染
4. HTTP / realtime 行为无协议漂移
5. 全量测试和静态检查转绿

---

## 10. 为什么这套拆法更符合 DDD 与 Unix

### 10.1 它没有把业务真相继续往外扩散

这次不动 `domain/usecase/contract`，所以消息是否成立、谁能读历史、谁能发言、阅读推进是否成立等业务真相仍留在核心。

### 10.2 它让每个壳模块更专一

拆完后：

1. 房间冷路径只回答 HTTP 房间问题
2. 后台外壳只回答后台接口问题
3. 实时外壳只回答 realtime 热路径问题
4. 总壳只回答“系统如何组装”

这就是 Unix 风格的一件事只做好一件事。

### 10.3 它没有制造文件海

这次不是“看到大文件就拆成七八块”，而是只补 3 个当前真正缺失的壳层边界。  
这让代码更清楚，但不会因为抽象过度而让调用链变绕。

---

## 11. 未来防回胖规则

重构完成后，后续开发必须长期遵守：

1. 新增 HTTP 房间行为，默认先看 [src/房间外壳.rs](/E:/koko/src/房间外壳.rs)
2. 新增后台行为，默认先看 [src/后台外壳.rs](/E:/koko/src/后台外壳.rs)
3. 新增 realtime 行为，默认先看 [src/实时外壳.rs](/E:/koko/src/实时外壳.rs)
4. [src/外壳.rs](/E:/koko/src/外壳.rs#L1) 只允许新增总装配和少量共享 helper，不允许重新长出完整协议链
5. 任何“为了快先塞到外壳里”的行为，都视为架构退化，需要优先清理

---

## 12. 最终结论

这次后端重构的本质不是“把大文件分尸”，而是：

**在不动业务真相归属的前提下，把已经过胖的壳层 adapter 按协议职责重新收口。**

这条路线同时满足：

1. DDD：真相仍在 `domain/usecase/contract`
2. Unix：一个模块只回答一种问题
3. 工程纪律：文件数量克制，不制造新的抽象噪音
4. 稳定性：通过保语义迁移和分阶段验证，把回归风险压到最低

后续 implementation plan 必须严格围绕这份 spec 展开，不允许在执行阶段擅自扩 scope。
