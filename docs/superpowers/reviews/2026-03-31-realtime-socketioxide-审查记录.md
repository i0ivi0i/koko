# 审查记录

## 审查元数据
- 审查时间：2026-03-31 16:05 CST
- 仓库路径：`E:\koko`
- 审查模式：repo mode
- 审查主题：`socketioxide` 复用质量与全仓手搓轮子治理巡检
- Git 提交：`af842ad9e8d51434cc6fc934f310da274790bf7a`
- 工作树状态：干净
- 使用技能：`using-superpowers`、`koko-constitutional-audit`、`dispatching-parallel-agents`
- 并行审查：启动 2 个 explorer 子审查员；因未在主裁决窗口内返回可用结论，最终裁决仅采纳主审本地直证
- 外部校准：已使用 `socketioxide` 官方 docs.rs / GitHub README 与 Context7
- 过滤候选数：2
- 降级观察项数：2
- 成熟生态复用是否已评估：是
- 长期技术替换韧性是否已评估：是
- 是否使用反手搓轮子外部校准：是
- 总体置信度：中高
- 审查最终状态：延期处理

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
这仓库目前**没有再手搓一套完整的 runtime room / broadcast 引擎**；`members`、`messages`、`room_codes` 这些持久化事实属于业务真相，不应交给 `socketioxide`，这部分不是重复造轮子。真正的问题集中在 `src/rt.rs`：项目没有把 `socketioxide` 当作“经过认证的连接 + 房间/广播原语”来用，而是把**会话身份继续留在客户端 payload 里**，再在 adapter 里长出一层 `CommandPlan + RealtimeEffect` 私有小 DSL。前者已经是权威真相放错层，后者是正在形成的私有基础设施债。

## 立即治理
- 标题: Realtime 身份真相仍由客户端 payload 提供，socket 连接没有承接认证上下文
- 违反法则: `审查维护.md` 第 4.4 节“权限真相 / 成员资格真相只能归属 `domain / application`”与第 6.5 节“跨端共享能力先收敛稳定契约，禁止把壳层流程倒灌核心”；`AGENTS.md` 明确要求 `http / rt` adapter 只做鉴权承接和协议翻译，不得让客户端回声会话真相
- 类别: authority-of-truth violation / contract pollution / realtime adapter 边界失守
- 关键证据: [src/contract.rs](/E:/koko/src/contract.rs#L22) 与 [src/contract.rs](/E:/koko/src/contract.rs#L81) 把 `session_id` 暴露为可序列化 realtime command 字段；[src/rt.rs](/E:/koko/src/rt.rs#L166) 与 [src/rt.rs](/E:/koko/src/rt.rs#L192) 直接反序列化客户端命令后进入用例；对比 [src/http.rs](/E:/koko/src/http.rs#L79) 与 [src/http.rs](/E:/koko/src/http.rs#L100)，HTTP 路径会从 cookie 提取会话身份而不是信任请求体。官方 `socketioxide` 文档已经提供 connect middleware / extensions 来把认证后的连接上下文挂到 socket 上
- 为什么重要: 这会把“谁在这个 socket 上发言”降级成“客户端声称自己是谁”，造成 realtime 路径和 HTTP 路径出现两套身份承接方式。现在虽然还会查数据库成员资格，但 socket 与 session 没绑定，攻击者只要知道一个有效 `session_id` 就能在 realtime 命令里冒用它。这不是单点实现细节，而是权威真相放错层
- 修复方向: 用 `socketioxide` connect middleware + `Extension`/`State` 承接会话认证，把 `session_id` 从可序列化 realtime command 中移除；让 `subscribe_room_stream` / `send_text_message` 只接收业务意图字段，身份由 adapter 从已认证 socket 上下文注入，再进入 `application`

## 可延期精修
- 标题: `rt` adapter 开始长出 `CommandPlan + RealtimeEffect` 私有实时 DSL，重复包装 `socketioxide` 原语
- 违反法则: `审查维护.md` 第 3.1 原则 6“删除优先于堆叠，不要默认再包一层 manager / bridge / wrapper”；第 5.1 节“连接管理、背压、广播等通用能力默认先复用成熟生态”；`AGENTS.md` 明确要求优先清理实时主通道外围的手搓桥接和低价值包装
- 类别: hand-rolled infrastructure / adapter fattening / private framework debt
- 关键证据: [src/rt.rs](/E:/koko/src/rt.rs#L21) 到 [src/rt.rs](/E:/koko/src/rt.rs#L33) 定义了仓库私有 `RealtimeEffect` 与 `CommandPlan`；[src/rt.rs](/E:/koko/src/rt.rs#L75) 到 [src/rt.rs](/E:/koko/src/rt.rs#L149) 先把实时动作翻译成枚举，再在 [src/rt.rs](/E:/koko/src/rt.rs#L224) 到 [src/rt.rs](/E:/koko/src/rt.rs#L258) 重新解释成 `socket.join` / `emit` / `io.to(...).emit(...)`；[tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L27) 到 [tests/rt_flow.rs](/E:/koko/tests/rt_flow.rs#L124) 也主要在锁这个私有枚举，而不是锁 `socketioxide` 实际语义
- 为什么重要: 这层代码没有保护业务核心，它只是在 adapter 内把 `socketioxide` 已有的 join / emit / broadcast 能力换了一套仓库内部名字。继续扩功能时，这层枚举会不断膨胀，未来 ack、disconnect、presence、namespace、middleware 都会被继续私有化，最后变成 repo 自己的 realtime 小框架
- 修复方向: 删除这层中间 DSL，改成顶层 handler 直接调用用例并直接使用 `socketioxide` 原语；同时改用官方 `State`/`Extension`/connect middleware，让状态与认证沿库原生表面流动，而不是在仓库里再造一套效果解释器

## 待补证观察项
- 观察项: [src/rt.rs](/E:/koko/src/rt.rs#L239) 先给发送者发 `message_accepted`，随后又在 [src/rt.rs](/E:/koko/src/rt.rs#L249) 用全局 `io.to(room)` 广播 `message_created`；官方文档说明 `io.to(...)` 不会排除当前 socket。看起来发送者可能收到双事件，但当前 Web 壳还没有接通 realtime，缺少端到端证据。下一步应补一个真实 socket 集成测试，证明发送者是否会被双重投递，以及壳层是否正确去重
- 观察项: 本仓库依赖 [Cargo.toml](/E:/koko/Cargo.toml#L39) 锁在 `socketioxide = "0.17"`，本次外部校准查阅的是官方最新 docs.rs / README。核心建议方向是稳定的，但落地前仍应按 0.17 版本核一次 `with_state`、middleware 和相关 feature 开关的精确签名，避免“按最新版文档改旧版代码”

## 重复造轮子与冗余实现专项结论
- 未发现第二套 runtime room registry、第二套广播总线或第二套 socket transport。
- `members`、`messages`、`room_codes` 持久化事实属于领域 / 应用真相，不应让 `socketioxide` 取代；这些不是“手搓轮子”，是业务边界。
- 当前真正的冗余热点，是 adapter 内部那层私有实时效果枚举和手工状态线程，不是 domain/store 本身。

## 成熟生态复用与手搓轮子专项结论
- 当前仓库已经正确复用了 `socketioxide` 的基础接入、房间加入和广播能力，没有把 engine / socket server 本身重写一遍。
- 但复用还不够彻底：官方已经提供的 connect middleware、extensions、`State` extractor、room operator 没有被优雅吸收，结果是身份承接和状态传递仍靠仓库私有结构完成。
- 结论：这个仓库**还没有“再手搓一套 socketioxide”**，但 `src/rt.rs` 已经出现明显的“外围私有化包装”趋势，再放任会滑向私有框架债。

## 分层与前后端解耦专项结论
- `application / store` 里保留成员资格与消息成立真相，这是对的。
- 出问题的是 realtime adapter：它没有只做“已认证 socket -> 稳定 command”的翻译，而是允许客户端在 command 里自报 `session_id`。
- 当前 Web 壳 [src/web.rs](/E:/koko/src/web.rs#L53) 到 [src/web.rs](/E:/koko/src/web.rs#L97) 只做 HTTP bootstrap 和静态展示，还没有真的消费 realtime 契约；因此现在尚未形成第二套前端实时胶水，但如果后续继续绕开 `socketioxide` 增加 HTTP 聊天流，会很容易变成双入口 / 双流程

## 测试与验证结论
- 已运行命令：`cargo test`
- 结果：通过
- 说明：功能测试全绿只能证明当前代码可运行，不能替代结构治理结论
- 当前测试盲区：缺少真实 socket 连接认证、rooms、广播排除语义和 disconnect 行为的端到端集成测试

## 冲突裁决与过滤说明
- 已过滤“`RoomEntryPort` / `PgStore` 是否重复造房间能力”这一候选，因为这些代码承载的是持久化业务事实，不是 `socketioxide` 能替代的 runtime commodity plumbing。
- 已过滤“前端暂未接通 realtime 是否本身就是正式违规”这一候选，因为目前还没有第二套聊天传输流落地，只能算高价值风险，不足以提升为正式 finding。
- 已把“发送者可能收到双事件”降级为观察项，因为当前缺少端到端 socket 行为证据，尚不能只凭静态阅读就下正式判词。

## 后续治理建议
1. 先治理 realtime 身份承接：把认证上下文绑定到 socket，而不是绑定到 payload。
2. 紧接着收口 `src/rt.rs`：删 `RealtimeEffect`/`CommandPlan`，回到库原生 handler + extractor。
3. 补一组真实 socket 集成测试：认证失败、加入房间、发送消息、发送者排除/包含、disconnect。
4. 在这两步完成前，不建议继续往 `rt` 层堆 presence、typing、ack 扩展，否则只会把私有 DSL 越堆越厚。

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
