# 审查记录

## 审查元数据
- 审查时间：2026-04-01 CST
- 仓库路径：`E:\koko`
- 审查模式：focused mode
- 审查主题：Telegram iOS 聊天壳补审与中断恢复收口
- Git 提交：`未提交`
- 工作树状态：本轮只补共享查询契约归位与审查记录；未改聊天主链路业务行为
- 使用技能：`using-superpowers`、`dispatching-parallel-agents`、`test-driven-development`、`verification-before-completion`
- 并行审查：使用 3 位 subagent 分别复核架构状态、前端聊天壳现状、后端查询与测试覆盖；最终结论以主工作区实测为准
- 外部校准：未额外联网；本轮问题集中在仓库内实现状态与验证证据
- 成熟生态复用是否已评估：是，realtime 继续复用 `socketioxide` 官方兼容路径与同源静态装配
- 总体置信度：高
- 审查最终状态：延期处理

## 审查目标
- 恢复被中断的 Telegram iOS 聊天壳任务，判断当前代码到底落到了哪一步。
- 核对实施计划与主工作区现状是否一致，确认是否还存在未落地的大块功能。
- 收口本轮发现的结构缺口，并补上仓库制度要求的专项审查记录。

## 审查范围
- 计划与设计：
  - [2026-03-31-telegram-ios-聊天壳设计.md](/E:/koko/docs/superpowers/specs/2026-03-31-telegram-ios-聊天壳设计.md)
  - [2026-03-31-telegram-ios-聊天壳实施.md](/E:/koko/docs/superpowers/plans/2026-03-31-telegram-ios-聊天壳实施.md)
- 主链路实现：
  - [contract.rs](/E:/koko/src/contract.rs)
  - [app.rs](/E:/koko/src/app.rs)
  - [store.rs](/E:/koko/src/store.rs)
  - [http.rs](/E:/koko/src/http.rs)
  - [main.rs](/E:/koko/src/main.rs)
  - [chat.rs](/E:/koko/src/chat.rs)
  - [web.rs](/E:/koko/src/web.rs)
  - [view.rs](/E:/koko/src/view.rs)
  - [theme.css](/E:/koko/assets/theme.css)
- 关键测试：
  - [app_flow.rs](/E:/koko/tests/app_flow.rs)
  - [http_flow.rs](/E:/koko/tests/http_flow.rs)
  - [rt_flow.rs](/E:/koko/tests/rt_flow.rs)
  - [web_shell_flow.rs](/E:/koko/tests/web_shell_flow.rs)

## 总体结论
中断前的主体实现其实已经落在主线里了。按实施计划复核，Task 1-6 已可判为完成；真正没闭环的是 Task 7 的制度收口与本机 `cargo run` 实启验证。  
本轮额外补了一处有边界价值的收口：把 `ListJoinedRoomsQuery` 与 `SearchRoomsByCodeQuery` 从应用层私有 DTO 收回到共享 [contract.rs](/E:/koko/src/contract.rs)，并补了稳定 wire-shape 测试，避免多壳共享查询面只停留在 `app` 层。

## 任务状态判断
- Task 1：已完成  
  证据：joined rooms / search DTO 与应用用例已存在于 [contract.rs](/E:/koko/src/contract.rs) 与 [app.rs](/E:/koko/src/app.rs)，对应应用层测试在 [app_flow.rs](/E:/koko/tests/app_flow.rs)。
- Task 2：已完成  
  证据：`PgStore` 已实现 joined rooms / search SQL，HTTP 已暴露 `/api/rooms` 与 `/api/rooms/search`，对应集成测试在 [app_flow.rs](/E:/koko/tests/app_flow.rs) 与 [http_flow.rs](/E:/koko/tests/http_flow.rs)。
- Task 3：已完成  
  证据：前端壳状态机、本地恢复、补齐去重与纯状态测试均在 [chat.rs](/E:/koko/src/chat.rs)、[web.rs](/E:/koko/src/web.rs)、[web_shell_flow.rs](/E:/koko/tests/web_shell_flow.rs)。
- Task 4：已完成  
  证据：三段聊天壳与 Telegram iOS 深色样式已在 [view.rs](/E:/koko/src/view.rs) 与 [theme.css](/E:/koko/assets/theme.css)。
- Task 5：已完成  
  证据：同源入口、静态资源、fallback 与 API 装配已在 [http.rs](/E:/koko/src/http.rs) 与 [main.rs](/E:/koko/src/main.rs)，对应验证在 [http_flow.rs](/E:/koko/tests/http_flow.rs)。
- Task 6：已完成  
  证据：realtime bridge、pending/accepted/created 推进与 sender exclusion 已在 [web.rs](/E:/koko/src/web.rs)、[chat.rs](/E:/koko/src/chat.rs)、[rt.rs](/E:/koko/src/rt.rs) 和对应测试中跑通。
- Task 7：部分完成  
  证据：`cargo test`、`cargo check`、`scripts/dx-bundle-web.ps1` 已通过；但本机尚未补做带真实 `KOKO_DATABASE_URL` / `KOKO_ADMIN_TOKEN` 的 `cargo run` 实启验证，且此前缺少 Telegram 聊天壳专项审查记录。

## 本轮已收口内容
- 标题：joined/search 共享查询面归位到 contract
- 变更：
  - 在 [contract.rs](/E:/koko/src/contract.rs) 新增 `ListJoinedRoomsQuery`、`SearchRoomsByCodeQuery`，并给出稳定 `serde` 形状。
  - 在 [app.rs](/E:/koko/src/app.rs) 改为复用 `contract` 查询 DTO，不再私有定义平行结构。
  - 在 [app_flow.rs](/E:/koko/tests/app_flow.rs) 新增 `joined_room_queries_live_in_contract_with_stable_wire_shape`，先红后绿锁住共享查询面。
- 判断：这次收口符合“跨端共享唯一合法表面是 contract”的制度要求，且没有引入新轮子或新桥接层。

## 边界判断
- 守住的边界：
  - [contract.rs](/E:/koko/src/contract.rs) 仍只承载稳定 query / snapshot / event / error code，没有 Telegram 专属 cell、导航、布局或页面流程字段。
  - 前端壳仍在消费后端真相，没有把成员资格、权限真相或消息成立真相偷搬到本地状态。
- 仍需盯住的风险：
  - [web.rs](/E:/koko/src/web.rs) 同时包含 HTTP URL 解析、localStorage、Dioxus 资源编排和 `REALTIME_BRIDGE_SCRIPT`，现在仍算薄，但这是最接近“私有 realtime bridge 膨胀”的位置，后续不能继续长胖。
  - `message_accepted` / `message_created` 目前复用同一个 `MessageCreated` payload，通过事件名区分语义；Web 壳可用，但未来多壳扩展时需要继续盯合同可演进性。

## 验证结论
- 已实际运行并通过：
  - `cargo test --test app_flow joined_room_queries_live_in_contract_with_stable_wire_shape`
  - `cargo test`
  - `cargo check`
  - `powershell -ExecutionPolicy Bypass -File scripts/dx-bundle-web.ps1`
- 已核对：
  - `git status --short --branch`
  - `git diff --stat`
- 结果：
  - 当前工作树仅含本轮补收口改动。
  - 全量测试与编译通过。
  - Web bundle 脚本可正常产出 `dist/public`。

## 延期项
- 债务 1：未做本机 `cargo run` 实启补验
  - 原因：当前会话未提供可直接复用的 `KOKO_DATABASE_URL` / `KOKO_ADMIN_TOKEN` 运行环境。
  - 风险：虽然测试与打包已绿，但仍缺“真实启动后 `/` 与 `/api/*` 一起服务”的现场证据。
  - 当前控制措施：已用 `http_flow`、`rt_flow`、`web_shell_flow` 与 bundle 脚本覆盖主要链路。
  - 债务责任人：仓库主人
  - 回看触发点：下次继续触碰聊天壳、准备发布、或需要现场演示前
  - 最晚处理时机：下一次对外演示或发布前
- 债务 2：高风险改动的独立复核尚未完成
  - 原因：按 [审查维护.md](/E:/koko/审查维护.md)，AI 不能既是实施者又是唯一放行者。
  - 风险：制度上仍缺主人或指定 reviewer 的最后放行。
  - 当前控制措施：本轮已补齐专项审查记录，并明确所有已验证与未验证项。
  - 债务责任人：仓库主人
  - 回看触发点：下次聊天壳主链路改动前
  - 最晚处理时机：下一个相关提交进入主线前

## 后续建议
1. 若下一轮继续收口聊天壳，优先补 `cargo run` 实启验证，不要再重复做“主体功能是否存在”的仓内盘点。
2. 若继续强化多壳共核，再考虑把 `LoadRoomSnapshotQuery` 等现有共享查询也统一按 `contract` 语义检查一遍，但不要在没压力时大面积翻新。
3. 若 `web.rs` 再继续长胖，下一轮应优先按 adapter/shell 边界收口，而不是继续往 `REALTIME_BRIDGE_SCRIPT` 周围堆逻辑。
