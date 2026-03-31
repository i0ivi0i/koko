# 审查记录

## 审查元数据
- 审查时间：2026-03-31 16:58 CST
- 仓库路径：`E:\koko`
- 审查模式：repo mode
- 审查主题：`socketioxide` 复用质量与全仓手搓轮子治理巡检
- Git 提交：`10417c44b5aa852990064555aa60e0fe113d4923`
- 工作树状态：存在与本轮无关的未提交改动；治理热点已落实到 `9403df0`、`87c6419`、`2791ebb`、`10417c4`
- 使用技能：`using-superpowers`、`koko-constitutional-audit`、`dispatching-parallel-agents`
- 并行审查：实现与评审均使用多位 subagent；Task 4 质量 reviewer 已给出 `approved`，spec reviewer 因平台延迟未在裁决窗口内返回可采纳正文，最终以主审本地直证补足裁决
- 外部校准：已使用 `socketioxide` 官方 docs.rs / GitHub README 与 Context7
- 过滤候选数：2
- 降级观察项数：0
- 成熟生态复用是否已评估：是
- 长期技术替换韧性是否已评估：是
- 是否使用反手搓轮子外部校准：是
- 总体置信度：中高
- 审查最终状态：已完成治理并回填证据

## 审查目标
- 检查仓库是否在 `socketioxide` 已覆盖的能力外又手搓了一套实时基础设施。
- 检查全仓是否存在类似“通用问题私有化、成熟生态不用、adapter 偷藏真相”的退化点。
- 给出是否应继续站在 `socketioxide` 肩膀上，还是已经开始长出私有小框架的裁决。

## 审查范围
- 核心文件：`src/rt.rs`、`src/contract.rs`、`src/http.rs`、`src/main.rs`、`src/app.rs`、`src/store.rs`、`src/web.rs`、`tests/rt_flow.rs`
- 仓库治理法则：`AGENTS.md`、`审查维护.md`
- 外部资料：
  - `socketioxide` GitHub README
  - `socketioxide` docs.rs `Socket`
  - `socketioxide` docs.rs `SocketIoBuilder`

## 审查依据
- 内建宪法基线：稳定业务真相优先于框架便利；成熟生态复用优先于手搓通用基础设施；adapter 只翻译不决策。
- 项目叠加法则：
  - `审查维护.md` 第 3.2 节：禁止新增手搓成熟轮子、禁止形成第二套真相、禁止 handler / socket 回调偷偷承载业务规则。
  - `审查维护.md` 第 4.4 节：权限真相、成员资格真相、消息成立真相只能归属 `domain / application`。
  - `AGENTS.md`：聊天系统实时主通道默认保留并复用纯 Rust 的 `socketioxide`；连接管理、订阅、广播属于 adapter，消息是否合法、谁能订阅、谁能发言属于 `application / domain`。
- 外部校准：
  - `socketioxide` 推荐用 handler / extractor / middleware / room operator 直接表达实时行为，而不是在仓库里再造一层私有实时 DSL。
  - `socketioxide` 的 `Socket::to(...)` 明确排除当前 socket，`io.to(...)` 在全局上下文不会排除当前 socket。
  - `socketioxide` builder 明确提供 `with_state(...)`，connect middleware / extensions 也有官方示例。

## 专家阵容与调度说明
- 主审：Codex 主代理，负责法则加载、仓库扫描、外部文档校准、最终裁决。
- 并行审查：
  - explorer 1：聚焦 realtime / `socketioxide` 热点。
  - explorer 2：聚焦全仓其它手搓轮子与边界污染。
- 由于子审查员未在裁决时限内产出可直接采纳的证据，本次正式结论全部以主审直接阅读源码、运行命令和官方文档校准为准。

## 总体结论
这仓库在审查时**没有再手搓一套完整的 runtime room / broadcast 引擎**，问题主要集中在 realtime adapter 的边界失守。现在这两个热点都已经实质收口：`socketioxide` 已升级到 [Cargo.toml](/E:/koko/Cargo.toml#L39) 的 `0.18.2`，realtime wire payload 已从 [src/contract.rs](/E:/koko/src/contract.rs#L23) 和 [src/contract.rs](/E:/koko/src/contract.rs#L81) 移除 `session_id`，连接身份改由 [src/rt.rs](/E:/koko/src/rt.rs#L48) 的 cookie 认证与 [src/rt.rs](/E:/koko/src/rt.rs#L121) 的 connect middleware / `Extension` 承接，`CommandPlan` / `RealtimeEffect` 私有 DSL 已从 realtime 主通道删除，sender exclusion 也已有 [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L100) 的端到端测试证据。

## 已完成治理 1
- 标题: realtime 身份真相已从客户端 payload 收回到 socket 认证上下文
- 原问题类别: authority-of-truth violation / contract pollution / realtime adapter 边界失守
- 修复结果:
  - [src/contract.rs](/E:/koko/src/contract.rs#L23) 的 `SubscribeRoomStreamCommand` 与 [src/contract.rs](/E:/koko/src/contract.rs#L81) 的 `SendTextMessageCommand` 现在只保留业务意图字段，不再暴露 `session_id`
  - [src/app.rs](/E:/koko/src/app.rs) 已使用 app-only 输入结构继续承接 `session_id`，身份真相没有回声到共享 wire contract
  - [src/rt.rs](/E:/koko/src/rt.rs#L48) 的 `authenticate_realtime_session(...)` 会从 `koko_session` cookie 认证 session，并在 [src/rt.rs](/E:/koko/src/rt.rs#L197) 写入 socket extension
  - [src/rt.rs](/E:/koko/src/rt.rs#L136) 与 [src/rt.rs](/E:/koko/src/rt.rs#L163) 的 handler 改为从 `Extension<AuthenticatedSession>` 取身份，再组装应用层输入
- 治理判断: HTTP 与 realtime 重新回到同一套“由 adapter 承接认证、由 application/domain 裁决真相”的边界

## 已完成治理 2
- 标题: `rt` adapter 私有 DSL 已删除，房间与广播原语已直接交回 `socketioxide`
- 原问题类别: hand-rolled infrastructure / adapter fattening / private framework debt
- 修复结果:
  - [src/rt.rs](/E:/koko/src/rt.rs) 中原有 `CommandPlan`、`RealtimeEffect`、`plan_*`、`apply_effects` 已删除
  - [src/rt.rs](/E:/koko/src/rt.rs#L141) 订阅成功后直接调用 `app::subscribe_room_stream(...)`，随后用 `socket.join(...)` 与 `room_stream_subscribed`
  - [src/rt.rs](/E:/koko/src/rt.rs#L168) 发送消息成功后直接调用 `app::send_text_message(...)`，随后先对 sender 发 `message_accepted`，再通过 [src/rt.rs](/E:/koko/src/rt.rs#L224) 的 `socket.to(room)` 向同房间其他连接广播 `message_created`
  - `socketioxide` 依赖已升级到 [Cargo.toml](/E:/koko/Cargo.toml#L39) 的 `0.18.2`，并启用了 `extensions` feature；最小 e2e 客户端现使用 [Cargo.toml](/E:/koko/Cargo.toml#L51) 的 `futures-util` 与 [Cargo.toml](/E:/koko/Cargo.toml#L52) 的 `tokio-tungstenite`
- 治理判断: realtime adapter 已收回到“薄 handler + 原生 extractor / room operator”表面，没有继续长成仓库私有小框架

## 已消除观察项
- sender 双重投递风险已被消除：旧实现里 `io.to(room)` 的全局广播风险已替换为 [src/rt.rs](/E:/koko/src/rt.rs#L224) 的 `socket.to(room)`；[tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L100) 已证明 sender 收到 `message_accepted`，同房间其他成员收到 `message_created`，sender 在等待窗口内收不到 `message_created`
- 版本漂移风险已被消除：仓库不再停留在 `socketioxide 0.17`，而是已升级到 `0.18.2` 并按该版本 API 完成落地

## 重复造轮子与冗余实现专项结论
- 未发现第二套 runtime room registry、第二套广播总线或第二套 socket transport。
- `members`、`messages`、`room_codes` 持久化事实属于领域 / 应用真相，不应让 `socketioxide` 取代；这些不是“手搓轮子”，是业务边界。
- 本轮已完成的收口重点，是删除 adapter 内部那层私有实时效果枚举与手工桥接；domain/store 仍只保留业务真相，没有被误伤。

## 成熟生态复用与手搓轮子专项结论
- 当前仓库已经正确复用了 `socketioxide` 的基础接入、房间加入和广播能力，没有把 engine / socket server 本身重写一遍。
- 审查时暴露出的“复用不彻底”问题已经收口：当前实现已使用 connect middleware、extensions 和 room operator 承接身份、订阅与广播。
- 结论：这个仓库**没有再手搓一套 `socketioxide`**；而且本轮已经把 realtime 主通道从“外围私有化包装趋势”拉回到成熟生态原生表面。

## 分层与前后端解耦专项结论
- `application / store` 里保留成员资格与消息成立真相，这是对的。
- 审查时出问题的是 realtime adapter；现在它已经回到“已认证 socket -> 稳定 command / input”的翻译职责，不再允许客户端在 realtime payload 里自报 `session_id`。
- 当前 Web 壳 [src/web.rs](/E:/koko/src/web.rs#L53) 到 [src/web.rs](/E:/koko/src/web.rs#L97) 只做 HTTP bootstrap 和静态展示，还没有真的消费 realtime 契约；因此现在尚未形成第二套前端实时胶水，但如果后续继续绕开 `socketioxide` 增加 HTTP 聊天流，会很容易变成双入口 / 双流程

## 测试与验证结论
- 已运行并通过的定向验证：
  - `cargo test --test rt_flow subscribe_room_stream_input_uses_authenticated_session`
  - `cargo test --test rt_flow send_text_message_input_uses_authenticated_session`
  - `cargo test --test rt_flow authenticate_realtime_session_reads_koko_session_from_multi_cookie_header`
  - `cargo test --test rt_flow sender_receives_message_accepted_but_not_message_created`
  - `cargo test --test app_flow send_text_message_returns_message_created_event`
  - `cargo check`
- 已运行并通过的全量验证：
  - `cargo test`
  - `cargo check`
- 本轮新增的关键证据：
  - [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L232) 锁定 cookie 认证 helper
  - [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L56) 与 [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L76) 锁定 adapter 只组装 app-only 输入
  - [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L100) 用真实 socket client 证明 sender exclusion 与未认证连接失败
- 工作树说明：当前仍有与本轮无关的未提交改动存在于 `src/app.rs`、`src/domain.rs`、`src/store.rs`、`src/view.rs`、`tests/app_flow.rs`、`tests/http_support/mod.rs`；本轮 Task 5 仅提交审查记录文档，不夹带这些变更

## 冲突裁决与过滤说明
- 已过滤“`RoomEntryPort` / `PgStore` 是否重复造房间能力”这一候选，因为这些代码承载的是持久化业务事实，不是 `socketioxide` 能替代的 runtime commodity plumbing。
- 已过滤“前端暂未接通 realtime 是否本身就是正式违规”这一候选，因为目前还没有第二套聊天传输流落地，只能算高价值风险，不足以提升为正式 finding。
- “发送者可能收到双事件”已不再保留为观察项，因为本轮已经补上端到端 socket 行为证据。

## 后续治理建议
1. 后续继续加 realtime 能力时，优先沿 [src/rt.rs](/E:/koko/src/rt.rs) 当前这条“connect middleware + `Extension` + direct handler”主通道扩展，不要再回头造仓库私有 DSL。
2. 若后面补 presence、typing、disconnect、ack，先补最小 e2e 测试，再决定是否真的需要新增 adapter helper。
3. 工作树里目前仍有与本轮无关的未提交改动；后续提交时继续保持隔离，避免把无关噪音混进 realtime 治理链路。

## 附录与引用资料
- 仓库法则：
  - `E:\koko\审查维护.md`
  - `E:\koko\AGENTS.md`
- 本地证据：
  - `E:\koko\src\contract.rs`
  - `E:\koko\src\rt.rs`
  - `E:\koko\src\http.rs`
  - `E:\koko\src\main.rs`
  - `E:\koko\tests\rt_flow.rs`
  - `E:\koko\src\web.rs`
  - `E:\koko\Cargo.toml`
- 外部资料：
  - <https://github.com/Totodore/socketioxide>
  - <https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html#method.to>
  - <https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html#method.join>
  - <https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html#method.on_disconnect>
  - <https://docs.rs/socketioxide/latest/socketioxide/struct.SocketIoBuilder.html#method.with_state>
