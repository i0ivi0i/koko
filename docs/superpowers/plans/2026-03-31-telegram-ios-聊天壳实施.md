# Telegram iOS 聊天壳 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `Koko` 落地一个可同源打开、可真实体验的 Telegram iOS 深色聊天壳，打通会话列表、群号搜索、加入/进入群、消息快照、发送消息与 realtime 增量主链路。

**Architecture:** 后端只新增稳定查询与同源装配，不返回 Telegram 专属 UI 结构；前端继续沿 Dioxus + Rust + Wasm 主线，在现有 `chat/web/view` 文件中扩展薄壳状态机和 Telegram iOS 展示层。realtime 继续复用已收口的 `socketioxide 0.18.2` 主通道，聊天页采用“先快照，再订阅，再补一次快照”的缺口闭合策略。

**Tech Stack:** Rust 2024, Dioxus 0.7 (web), Axum 0.8, socketioxide 0.18.2, SQLx 0.8, reqwest 0.12, web-sys, tower-http static fs

---

## File Structure

### Existing Files To Modify

- `src/contract.rs`
  - 新增会话列表与群号搜索的共享查询/响应结构；继续保持 shell-neutral，不引入 UI 语义。
- `src/app.rs`
  - 新增 `list_joined_rooms` 与 `search_rooms_by_code` 应用用例和对应 port；保持权限真相与排序真相在 application/store。
- `src/store.rs`
  - 实现 joined rooms 查询与 room-code 搜索 SQL；复用现有房间/消息事实表，不新增前端壳专属持久化。
- `src/http.rs`
  - 暴露新查询 API；补同源前台入口与静态资源装配；继续把 session 承接留在 cookie。
- `src/main.rs`
  - 接入静态前端交付所需的 router 装配，保证单入口同源体验。
- `src/chat.rs`
  - 把当前单房间极简状态扩成薄壳状态机：会话列表、搜索流程、聊天页、本地 `last_open_room_id`、双快照补齐去重。
- `src/web.rs`
  - 负责 bootstrap、同源 API URL、列表/搜索/聊天资源调度、本地恢复与页面导航。
- `src/view.rs`
  - 重写为 Telegram iOS 深色主题的会话列表页、搜索/加入流程页、聊天页三段壳。
- `assets/theme.css`
  - 高还原 Telegram iOS 深色主题样式与关键过渡；不影响 admin 页面可用性。
- `Cargo.toml`
  - 仅在需要同源静态资源装配或浏览器 localStorage/History 能力时，补最小稳定依赖与 `web-sys` feature。
- `Dioxus.toml`
  - 明确 `[application].out_dir` 与 `asset_dir`，把 web 产物目录固定下来，避免实现时前端产物路径漂移。

### Existing Tests To Modify

- `tests/app_flow.rs`
  - 新增 application/store 层 joined rooms / search rooms 行为测试。
- `tests/http_flow.rs`
  - 新增新 API 路由、同源前台入口与静态资源 fallback 测试。
- `tests/rt_flow.rs`
  - 只在聊天壳需要锁定补齐窗口或 sender exclusion 交互时追加最小断言，不重写已有 realtime 验证。

### New Tests To Add

- `tests/web_shell_flow.rs`
  - 锁定纯前端壳状态：无群直达加群页、`last_open_room_id` 恢复、搜索输入态、聊天页双快照补齐去重。

### Responsibility Notes

- 不新增第二套“UI manager / router / coordinator / socket bridge”文件。
- 若 `view.rs` 在实现中出现明显失控，可拆出**一个**高价值 presenter/viewmodel 文件；否则默认继续在现有文件内收口。
- 若同源静态装配需要 Dioxus 产物目录说明，优先改 `Dioxus.toml` 与 `http.rs`，不要新增部署说明胶水模块。

## Task 1: 收口共享契约与应用查询面

**Files:**
- Modify: `src/contract.rs`
- Modify: `src/app.rs`
- Modify: `tests/app_flow.rs`

- [ ] **Step 1: 为 joined rooms / room-code search 写失败测试**

在 `tests/app_flow.rs` 新增最小测试组，覆盖：
- `list_joined_rooms_returns_member_rooms_sorted_by_latest_message`
- `list_joined_rooms_returns_empty_for_session_with_no_rooms`
- `search_rooms_by_code_matches_case_insensitive_prefix_and_marks_membership`
- `search_rooms_by_code_prioritizes_exact_hit_then_joined_rooms`

测试断言只使用稳定字段：
- `room_id`
- `room_code`
- `display_title`
- `latest_preview`
- `latest_message_at`
- `is_joined`

- [ ] **Step 2: 运行 targeted test，确认失败**

Run: `cargo test --test app_flow list_joined_rooms_returns_member_rooms_sorted_by_latest_message`

Run: `cargo test --test app_flow search_rooms_by_code_matches_case_insensitive_prefix_and_marks_membership`

Expected:
- 编译失败，提示缺少新 contract / app API；或测试失败，提示查询尚未实现

- [ ] **Step 3: 在共享层与应用层补最小结构**

在 `src/contract.rs` 新增：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JoinedRoomSummary {
    pub room_id: Uuid,
    pub room_code: String,
    pub display_title: String,
    pub latest_preview: String,
    pub latest_message_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomSearchResult {
    pub room_id: Uuid,
    pub room_code: String,
    pub display_title: String,
    pub latest_preview: String,
    pub latest_message_at: Option<DateTime<Utc>>,
    pub is_joined: bool,
}
```

在 `src/app.rs` 新增：
- `ListJoinedRoomsQuery { session_id }`
- `SearchRoomsByCodeQuery { session_id, input }`
- `JoinedRoomsPort`
- `RoomSearchPort`
- `list_joined_rooms(...)`
- `search_rooms_by_code(...)`

要求：
- 先校验 session 活跃，再查列表/搜索
- 搜索 query 只承接原始输入，不把 UI 焦点态等壳层语义带进 app

- [ ] **Step 4: 跑 targeted tests 转绿**

Run: `cargo test --test app_flow list_joined_rooms_returns_member_rooms_sorted_by_latest_message`

Run: `cargo test --test app_flow search_rooms_by_code_matches_case_insensitive_prefix_and_marks_membership`

Expected:
- PASS

- [ ] **Step 5: 提交 Task 1**

```bash
git add src/contract.rs src/app.rs tests/app_flow.rs
git commit -m "补齐会话列表与群号搜索共享契约"
```

## Task 2: 落库 joined rooms / search SQL，并锁住 HTTP 查询面

**Files:**
- Modify: `src/store.rs`
- Modify: `src/http.rs`
- Modify: `tests/app_flow.rs`
- Modify: `tests/http_flow.rs`

- [ ] **Step 1: 为 store / http 查询面写失败测试**

在 `tests/app_flow.rs` 增加基于 `PgHarness` 的真实数据库测试：
- `pg_store_lists_joined_rooms_with_latest_preview`
- `pg_store_searches_rooms_by_normalized_code_prefix`

在 `tests/http_flow.rs` 增加：
- `joined_rooms_endpoint_requires_bootstrapped_session`
- `joined_rooms_endpoint_returns_current_memberships`
- `room_search_endpoint_returns_case_insensitive_matches`

建议路由固定为：
- `GET /api/rooms`
- `GET /api/rooms/search?query=...`

- [ ] **Step 2: 运行 targeted tests，确认失败**

Run: `cargo test --test app_flow pg_store_lists_joined_rooms_with_latest_preview`

Run: `cargo test --test http_flow joined_rooms_endpoint_returns_current_memberships`

Expected:
- FAIL，提示缺少 store port 实现或 HTTP 路由不存在

- [ ] **Step 3: 在 `src/store.rs` 实现最小真相查询**

实现 `JoinedRoomsPort` 与 `RoomSearchPort`：
- joined rooms:
  - 只返回当前 session 已加入且活跃的房间
  - 排序：`latest_message_at DESC NULLS LAST, room_code ASC`
- search:
  - 对 normalized room code 做 case-insensitive prefix 匹配
  - exact hit 优先，其次 joined=true 优先，其次最新消息时间

SQL 约束：
- 不返回 UI 样式字段
- `latest_preview` 为空时返回空字符串
- `latest_message_at` 没消息时返回 `NULL`

- [ ] **Step 4: 在 `src/http.rs` 暴露查询 API**

新增 handler：
- `joined_rooms`
- `search_rooms`

要求：
- 仍然从 session cookie 承接身份
- search query 参数保持简单，如 `query`
- 空 query 返回空数组，避免后端替前端做页面流程判断

- [ ] **Step 5: 跑 targeted tests 转绿**

Run: `cargo test --test app_flow pg_store_lists_joined_rooms_with_latest_preview`

Run: `cargo test --test app_flow pg_store_searches_rooms_by_normalized_code_prefix`

Run: `cargo test --test http_flow joined_rooms_endpoint_requires_bootstrapped_session`

Run: `cargo test --test http_flow joined_rooms_endpoint_returns_current_memberships`

Run: `cargo test --test http_flow room_search_endpoint_returns_case_insensitive_matches`

Expected:
- PASS

- [ ] **Step 6: 提交 Task 2**

```bash
git add src/store.rs src/http.rs tests/app_flow.rs tests/http_flow.rs
git commit -m "实现会话列表与群号搜索查询接口"
```

## Task 3: 扩展前端壳状态机，锁住列表/搜索/本地恢复/补齐窗口

**Files:**
- Modify: `src/chat.rs`
- Modify: `src/web.rs`
- Add: `tests/web_shell_flow.rs`

- [ ] **Step 1: 为前端壳状态写失败测试**

在 `tests/web_shell_flow.rs` 新增纯状态测试：
- `boot_with_no_rooms_routes_to_join_flow`
- `boot_with_rooms_routes_to_conversation_list`
- `last_open_room_id_routes_directly_into_existing_chat`
- `stale_last_open_room_id_falls_back_to_list`
- `subscription_refill_merges_second_snapshot_without_duplicates`
- `search_input_updates_without_mutating_remote_truth`
- `conversation_item_exposes_unread_placeholder_without_becoming_truth_source`

测试只操作 Rust 状态模型，不依赖真实浏览器或网络。

- [ ] **Step 2: 运行 targeted test，确认失败**

Run: `cargo test --test web_shell_flow`

Expected:
- FAIL，提示缺少 conversation list / join flow / local restore / dedupe API

- [ ] **Step 3: 在 `src/chat.rs` 扩成薄壳状态机**

新增但保持薄边界：
- `ShellScreen`
- `ConversationItem`
- `RoomSearchState`
- `ChatTimelineState`
- `LastOpenRoom`

必须支持的方法：
- `apply_joined_rooms(...)`
- `restore_last_open_room(...)`
- `open_room_from_snapshot(...)`
- `start_room_subscription(...)`
- `apply_subscription_refill_snapshot(...)`
- `apply_search_results(...)`
- `set_search_query(...)`

硬约束：
- 不把已加入群真相塞进 localStorage
- 去重按稳定消息标识，而不是按消息文案
- `last_open_room_id` 只是一条体验态，不改后端真相

- [ ] **Step 4: 在 `src/web.rs` 明确壳层 orchestration 接口**

先只补纯 Rust 可测逻辑：
- `resolve_last_open_room_id(...)`
- `should_enter_join_flow(...)`
- `select_initial_screen(...)`

如需 localStorage，仅先写 `#[cfg(target_arch = "wasm32")]` 包装函数签名与 fallback，保持 native tests 可跑。

- [ ] **Step 5: 跑 targeted tests 转绿**

Run: `cargo test --test web_shell_flow`

Expected:
- PASS

- [ ] **Step 6: 提交 Task 3**

```bash
git add src/chat.rs src/web.rs tests/web_shell_flow.rs
git commit -m "收口前台聊天壳状态机与本地恢复"
```

## Task 4: 重建 Telegram iOS 深色会话列表与加群流程壳

**Files:**
- Modify: `src/view.rs`
- Modify: `assets/theme.css`
- Modify: `tests/http_flow.rs`

- [ ] **Step 1: 先写界面结构退化测试**

在 `tests/http_flow.rs` 或合适的现有前端测试里补最小断言：
- 新壳仍会加载 `theme.css`
- admin 路由未被聊天壳误接管
- 同源入口不存在时返回的不是旧的“只看单房间页面”壳
- 会话列表项会渲染 unread placeholder，但不需要真实未读计数真相

如果当前测试框架不适合做 DOM 断言，就锁：
- `view.rs` 暴露的页面分支函数
- `web::App` 在不同 shell state 下选择的页面枚举

- [ ] **Step 2: 运行 targeted test，确认失败**

Run: `cargo test --test http_flow admin_panel_route_is_not_exposed_from_http_router`

Expected:
- 至少一条新断言 FAIL，证明旧 UI 结构不满足新壳

- [ ] **Step 3: 在 `src/view.rs` 重写三段壳**

实现组件：
- `ConversationListScreen`
- `JoinByCodeScreen`
- `ChatScreen`

要求：
- 单栏移动优先
- 顶部导航、搜索栏、列表 cell、聊天输入区尽量贴 Telegram iOS 深色主题
- 会话列表 cell 明确保留 unread placeholder 视觉占位，但不伪造真实未读计数
- 只消费壳层状态，不自己发 HTTP / realtime

- [ ] **Step 4: 在 `assets/theme.css` 重做深色主题与响应式**

必须覆盖：
- iPhone 竖屏基准
- iPad / 桌面自适应可用
- 会话列表到聊天页的层级推进感
- 搜索栏、列表按压态、输入区、气泡视觉

禁止：
- 引入 Tailwind
- 增加第二套组件库
- 给 admin 样式带出与当前任务无关的排版噪音

- [ ] **Step 5: 跑 targeted tests 与格式校验**

Run: `cargo test --test http_flow`

Expected:
- PASS

- [ ] **Step 6: 提交 Task 4**

```bash
git add src/view.rs assets/theme.css tests/http_flow.rs
git commit -m "重建 Telegram iOS 深色前台聊天界面"
```

## Task 5: 接通会话列表/搜索/聊天页数据流与同源前端入口

**Files:**
- Modify: `src/web.rs`
- Modify: `src/http.rs`
- Modify: `src/main.rs`
- Modify: `Dioxus.toml`
- Modify: `Cargo.toml`
- Modify: `tests/http_flow.rs`

- [ ] **Step 1: 为同源入口与数据装配写失败测试**

在 `tests/http_flow.rs` 新增：
- `root_entry_serves_frontend_shell`
- `frontend_shell_fallback_serves_index_for_unknown_non_api_path`
- `conversation_boot_flow_uses_same_origin_api_paths`

说明：
- 非 API 页面命中前台壳
- `/api/...` 继续走 JSON 契约
- Socket.IO 路径不被静态 fallback 截断

- [ ] **Step 2: 运行 targeted test，确认失败**

Run: `cargo test --test http_flow root_entry_serves_frontend_shell`

Run: `cargo test --test http_flow frontend_shell_fallback_serves_index_for_unknown_non_api_path`

Expected:
- FAIL，说明当前后端还不能同源提供前台入口

- [ ] **Step 3: 在 `src/web.rs` 增加真实数据 orchestration**

实现：
- bootstrap session resource
- joined rooms resource
- search rooms resource（带输入节流可后补；本轮先保证真实功能）
- join room action（固定复用现有 `join_or_create_room_by_code` 契约，不新增 join-only 命令）
- `load_room_snapshot` action（固定复用现有快照查询，不新增 chat-only 初始化查询）
- 订阅成功后二次快照补齐

要求：
- API 路径全部同源解析
- 搜索 query 为空时不打后端或明确返回空结果
- 不把 API 错误码转成契约外真相

- [ ] **Step 4: 在 `src/http.rs` / `src/main.rs` 装配同源前端入口**

目标：
- Axum 同源提供 Dioxus web 产物与 `/assets/...`
- 非 API 页面 fallback 到前台入口文件
- `/api/*` 与 Socket.IO 继续优先匹配现有后端路径

如需额外 feature：
- 仅补 `tower-http` 静态文件支持所缺的稳定配置
- 在 `Dioxus.toml` 固定 `[application].out_dir = "dist"`，并明确 `asset_dir` 指向现有静态资源目录

- [ ] **Step 5: 跑 targeted tests 转绿**

Run: `cargo test --test http_flow root_entry_serves_frontend_shell`

Run: `cargo test --test http_flow frontend_shell_fallback_serves_index_for_unknown_non_api_path`

Run: `cargo test --test http_flow conversation_boot_flow_uses_same_origin_api_paths`

Run: `cargo check`

Expected:
- PASS

- [ ] **Step 6: 提交 Task 5**

```bash
git add src/web.rs src/http.rs src/main.rs Dioxus.toml Cargo.toml tests/http_flow.rs
git commit -m "打通前台聊天壳同源入口与数据装配"
```

## Task 6: 接通聊天 realtime 与发送消息主链路

**Files:**
- Modify: `src/web.rs`
- Modify: `src/chat.rs`
- Modify: `tests/web_shell_flow.rs`
- Modify: `tests/rt_flow.rs`

- [ ] **Step 1: 为聊天主链路补失败测试**

在 `tests/web_shell_flow.rs` 增加：
- `send_message_keeps_pending_until_message_accepted`
- `message_created_from_other_member_appends_to_timeline`
- `subscription_refill_then_realtime_event_does_not_duplicate_message`

若前端 realtime 薄互操作需要单独适配，在 `tests/rt_flow.rs` 只补一条对外行为测试，不测试私有桥接实现细节。

- [ ] **Step 2: 运行 targeted test，确认失败**

Run: `cargo test --test web_shell_flow send_message_keeps_pending_until_message_accepted`

Expected:
- FAIL，提示 pending / accepted / created 对齐逻辑未完整接通

- [ ] **Step 3: 在 `src/web.rs` 接通 realtime 客户端与事件流**

要求：
- 优先遵守 `socketioxide` 官方兼容路径
- 如必须使用官方 Socket.IO client，接入层保持最薄，只暴露：
  - connect / disconnect
  - subscribe_room_stream
  - send_text_message
  - event callback
- 不在 JS/interop 层承载业务真相或 UI 状态机

- [ ] **Step 4: 在 `src/chat.rs` 完成消息时间线推进**

必须支持：
- pending message 入列
- `message_accepted` 确认本地 pending
- `message_created` 追加他人消息
- 第二次快照与 realtime 事件按稳定 id 去重

- [ ] **Step 5: 跑 targeted tests 转绿**

Run: `cargo test --test web_shell_flow`

Run: `cargo test --test rt_flow sender_receives_message_accepted_but_not_message_created`

Expected:
- PASS

- [ ] **Step 6: 提交 Task 6**

```bash
git add src/web.rs src/chat.rs tests/web_shell_flow.rs tests/rt_flow.rs
git commit -m "接通聊天页实时订阅与消息发送主链路"
```

## Task 7: 全量验证、噪音回收与运行说明校准

**Files:**
- Modify only if needed: `docs/superpowers/reviews/2026-03-31-realtime-socketioxide-审查记录.md`
- Modify only if needed: relevant source/tests touched in prior tasks

- [ ] **Step 1: 运行全量验证**

Run: `cargo test`

Run: `cargo check`

Expected:
- 全绿

- [ ] **Step 2: 运行前台打包验证**

Run: `dx bundle --platform web`

Expected:
- 成功产出可部署的 web 静态资源到 `Dioxus.toml` 的 `[application].out_dir`

- [ ] **Step 3: 运行本地启动验证**

Run: `cargo run`

Expected:
- Axum 正常启动
- `/` 返回前台聊天壳
- `/api/session/bootstrap`、`/api/rooms`、`/api/rooms/search`、`/api/rooms/join`、`/api/rooms/{room_id}/snapshot` 正常工作

- [ ] **Step 4: 清理无关格式化噪音**

检查：
- `git diff --stat`
- `git status --short`

要求：
- 不保留与当前任务无关的导入顺序/换行变动
- 不误伤 admin 页面与已完成的 realtime 收口结果

- [ ] **Step 5: 提交最终验证收口**

```bash
git add -A
git commit -m "完成 Telegram iOS 聊天壳前台主链路"
```

## Verification Notes

- Dioxus 0.7 web 产物目录以 `Dioxus.toml` 的 `[application].out_dir` 为准；提交前必须确认 Axum static/fallback 与 `dx bundle --platform web` 的输出路径一致。
- 若浏览器 realtime 客户端最终采用最薄 JS 互操作，必须在 Task 6 提交说明中明确“为什么这是遵守 `socketioxide` 官方兼容路径，而不是私造第二前端栈”。
- 若 `view.rs` 或 `chat.rs` 在实现时失控到不可维护，先停下重排边界，再继续写 UI；不要用更多 manager/coordinator 临时糊住。

## Recommended Commit Cadence

1. `补齐会话列表与群号搜索共享契约`
2. `实现会话列表与群号搜索查询接口`
3. `收口前台聊天壳状态机与本地恢复`
4. `重建 Telegram iOS 深色前台聊天界面`
5. `打通前台聊天壳同源入口与数据装配`
6. `接通聊天页实时订阅与消息发送主链路`
7. `完成 Telegram iOS 聊天壳前台主链路`

## Handoff Reminders For Implementers

- 先做 Task 1-2，把后端稳定查询面钉死，再碰 UI。
- Task 3-4 只处理前端壳状态和展示，不把真相偷搬到前端。
- Task 5 是同源交付关键点，不允许“先靠两个服务凑合跑”。
- Task 6 若遇到浏览器 realtime 客户端阻塞，先回到官方兼容路径和最薄互操作，不要手搓协议。
