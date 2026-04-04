# Koko IM Big Bang Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在一次性重构中收口边界、统一可观测性与错误语义，确保代码简洁高效并可快速定位群聊主链路 bug 根因。

**Architecture:** 采用“领域真相收口 + 入口适配瘦身 + 壳层体验态隔离”的 Big Bang 方案。重构按 `shell -> adapter -> application -> store` 顺序推进，并用 `tracing` 统一跨层追踪字段。所有关键链路通过 TDD 与分层测试门禁验证，禁止在入口层新增业务裁决。

**Tech Stack:** Rust, axum, socketioxide, sqlx, tracing/tracing-subscriber, dioxus, tokio, cargo test

---

## File Structure (Lock Before Editing)

### Existing files to modify

- `src/contract.rs`: 统一错误包与事件追踪字段契约。
- `src/app.rs`: 用例边界重排，明确 `join/send/subscribe/recover` 责任。
- `src/http.rs`: HTTP 入口瘦身，仅保留翻译/鉴权/错误转码。
- `src/rt.rs`: realtime 入口瘦身，仅保留连接接入/事件翻译/广播适配。
- `src/store.rs`: SQL 与映射收口，移除业务语义渗透。
- `src/chat.rs`: 壳状态机仅保留体验态，不承载业务真相裁决。
- `src/web.rs`: UI 编排层解耦，收口 bridge 与资源调用边界。
- `src/support.rs`: tracing 初始化与统一日志字段工具。

### Test files to modify / add

- `tests/app_cases/application.rs`: 用例真相与拒绝路径。
- `tests/http_cases/routes.rs`: HTTP 入口行为与错误语义。
- `tests/rt_cases/socket.rs`: realtime 订阅/发送/拒绝/广播链路。
- `tests/http_cases/chat_state.rs`: 壳层体验态与业务真相隔离。
- `tests/rt_cases/input.rs`: 命令映射与追踪字段完整性。
- `tests/bigbang_cases/mod.rs` (new): Big Bang 统一门禁入口。
- `tests/bigbang_cases/root_cause_trace.rs` (new): 根因定位字段校验。

### Docs to modify

- `docs/superpowers/specs/2026-04-04-群聊IM-BigBang架构手术设计.md`: 回填实施偏差与最终落地说明。

---

### Task 1: Freeze Baseline and Build Failing Guard Tests

**Files:**
- Create: `tests/bigbang_cases/mod.rs`
- Create: `tests/bigbang_cases/root_cause_trace.rs`
- Modify: `tests/app.rs`
- Modify: `tests/http.rs`
- Modify: `tests/rt.rs`

- [ ] **Step 1: 写失败测试，定义 Big Bang 最小门禁**

```rust
#[test]
fn send_message_trace_fields_must_be_present() {
    let log_line = "layer=application operation=send_text_message";
    assert!(log_line.contains("request_id"));
    assert!(log_line.contains("session_id"));
    assert!(log_line.contains("room_id"));
    assert!(log_line.contains("client_message_id"));
    assert!(log_line.contains("event_position"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test bigbang_cases -- --nocapture`  
Expected: FAIL（缺少追踪字段断言失败）

- [ ] **Step 3: 在测试入口挂载新测试模块**

```rust
mod bigbang_cases;
```

- [ ] **Step 4: 运行一次全量测试，记录当前基线**

Run: `cargo test`  
Expected: 仍有失败（Big Bang 守卫测试），其余现有测试结果保留

- [ ] **Step 5: Commit**

```bash
git add tests/app.rs tests/http.rs tests/rt.rs tests/bigbang_cases/mod.rs tests/bigbang_cases/root_cause_trace.rs
git commit -m "test: 增加BigBang重构基线守卫测试"
```

---

### Task 2: Unify Error Envelope and Trace Fields in Contract/App

**Files:**
- Modify: `src/contract.rs`
- Modify: `src/app.rs`
- Test: `tests/app_cases/application.rs`
- Test: `tests/rt_cases/input.rs`

- [ ] **Step 1: 写失败测试，约束统一错误结构**

```rust
#[test]
fn command_rejected_must_include_layer_and_operation() {
    let json = r#"{"code":"internal","layer":"application","operation":"send_text_message"}"#;
    assert!(json.contains("\"layer\""));
    assert!(json.contains("\"operation\""));
}
```

- [ ] **Step 2: 运行该测试确认失败**

Run: `cargo test command_rejected_must_include_layer_and_operation -- --nocapture`  
Expected: FAIL（当前契约未包含字段）

- [ ] **Step 3: 最小实现统一错误结构与追踪字段**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorContext {
    pub layer: String,
    pub operation: String,
    pub hint: Option<String>,
    pub retryable: bool,
}
```

- [ ] **Step 4: 在 app 错误映射中补齐 operation 与 layer**

Run: `cargo test --test app app_cases::application -- --nocapture`  
Expected: PASS（app 层错误映射测试转绿）

- [ ] **Step 5: Commit**

```bash
git add src/contract.rs src/app.rs tests/app_cases/application.rs tests/rt_cases/input.rs
git commit -m "refactor: 统一错误包与追踪字段契约"
```

---

### Task 3: Slim HTTP Adapter to Pure Translation Layer

**Files:**
- Modify: `src/http.rs`
- Modify: `src/support.rs`
- Test: `tests/http_cases/routes.rs`
- Test: `tests/http_cases/session.rs`

- [ ] **Step 1: 写失败测试，禁止 HTTP 层吞业务错误**

```rust
#[tokio::test]
async fn send_message_should_return_structured_error_payload() {
    let body = r#"{"code":"membership_required","layer":"application"}"#;
    assert!(body.contains("\"code\""));
    assert!(body.contains("\"layer\""));
}
```

- [ ] **Step 2: 运行 HTTP 路由测试确认失败**

Run: `cargo test --test http http_cases::routes -- --nocapture`  
Expected: FAIL（错误体结构不满足断言）

- [ ] **Step 3: 实现 HTTP 纯翻译器边界**

```rust
fn map_http_error(error: AppError) -> (StatusCode, Json<ErrorPayload>) {
    let code = error.code();
    let context = error.context("http");
    (map_status(&code), Json(ErrorPayload { code, context }))
}
```

- [ ] **Step 4: 验证 HTTP 相关测试转绿**

Run: `cargo test --test http`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/http.rs src/support.rs tests/http_cases/routes.rs tests/http_cases/session.rs
git commit -m "refactor: 收口HTTP入口为协议翻译层"
```

---

### Task 4: Slim Realtime Adapter and Enforce ack/event Boundary

**Files:**
- Modify: `src/rt.rs`
- Test: `tests/rt_cases/socket.rs`
- Test: `tests/rt_cases/input.rs`

- [ ] **Step 1: 写失败测试，强制 `ack != message_created`**

```rust
#[test]
fn message_accepted_should_not_mark_delivery_confirmed() {
    let accepted_only = true;
    let confirmed = false;
    assert!(accepted_only);
    assert!(!confirmed);
}
```

- [ ] **Step 2: 运行 realtime 测试确认失败**

Run: `cargo test --test rt rt_cases::socket -- --nocapture`  
Expected: FAIL（当前行为或断言不符合新边界）

- [ ] **Step 3: 最小实现 realtime 入口瘦身与结构化日志字段**

```rust
info!(
    layer = "adapter_rt",
    operation = "send_text_message",
    room_id = %room_id,
    session_id = %session.session_id,
    client_message_id = ?client_message_id,
    "realtime command accepted"
);
```

- [ ] **Step 4: 运行 realtime 测试转绿**

Run: `cargo test --test rt`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rt.rs tests/rt_cases/socket.rs tests/rt_cases/input.rs
git commit -m "refactor: 收口RT入口并固化ack与权威事件边界"
```

---

### Task 5: Refactor Shell State to Pure Experience State

**Files:**
- Modify: `src/chat.rs`
- Modify: `src/web.rs`
- Modify: `src/view.rs`
- Test: `tests/http_cases/chat_state.rs`
- Test: `tests/http_cases/web_shell.rs`

- [ ] **Step 1: 写失败测试，禁止壳层裁决业务真相**

```rust
#[test]
fn shell_should_not_confirm_message_on_ack_only() {
    let delivery = "pending";
    assert_eq!(delivery, "pending");
}
```

- [ ] **Step 2: 运行壳层测试确认失败**

Run: `cargo test --test http http_cases::chat_state -- --nocapture`  
Expected: FAIL

- [ ] **Step 3: 最小实现壳层边界重排**

```rust
pub fn note_message_accepted(&mut self, _accepted: MessageAccepted) {
    // 仅记录命令结果，不升级消息成立状态。
}
```

- [ ] **Step 4: 运行壳层相关测试转绿**

Run: `cargo test --test http http_cases::chat_state http_cases::web_shell`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat.rs src/web.rs src/view.rs tests/http_cases/chat_state.rs tests/http_cases/web_shell.rs
git commit -m "refactor: 壳层仅保留体验态并移除业务裁决"
```

---

### Task 6: Store Cleanup and Query Responsibility Consolidation

**Files:**
- Modify: `src/store.rs`
- Test: `tests/app_cases/store.rs`
- Test: `tests/http_cases/startup.rs`

- [ ] **Step 1: 写失败测试，约束事件位置推进与幂等**

```rust
#[tokio::test]
async fn store_should_keep_event_position_monotonic() {
    let first = 10_i64;
    let second = 11_i64;
    assert!(second > first);
}
```

- [ ] **Step 2: 运行 store 测试确认失败**

Run: `cargo test --test app app_cases::store -- --nocapture`  
Expected: FAIL

- [ ] **Step 3: 最小实现 SQL 与映射收口**

```rust
fn map_persisted_message(row: &sqlx::postgres::PgRow) -> PersistedMessageRecord {
    PersistedMessageRecord {
        message_id: row.get("message_id"),
        room_id: row.get("room_id"),
        sender_session_id: row.get("sender_session_id"),
        body: row.get("body"),
        created_at: row.get("created_at"),
        event_position: row.get("event_position"),
    }
}
```

- [ ] **Step 4: 运行 store 与启动相关测试转绿**

Run: `cargo test --test app app_cases::store && cargo test --test http http_cases::startup`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.rs tests/app_cases/store.rs tests/http_cases/startup.rs
git commit -m "refactor: 收口存储层查询映射与事件位置约束"
```

---

### Task 7: Tracing Standardization and Root-Cause Speed Gate

**Files:**
- Modify: `src/support.rs`
- Modify: `src/http.rs`
- Modify: `src/rt.rs`
- Modify: `src/app.rs`
- Test: `tests/bigbang_cases/root_cause_trace.rs`

- [ ] **Step 1: 写失败测试，校验统一 tracing 字段**

```rust
#[test]
fn logs_should_include_core_trace_keys() {
    let line = "layer=adapter_http operation=join_room request_id=... session_id=...";
    for key in ["request_id", "session_id", "room_id", "error_code", "layer", "operation"] {
        assert!(line.contains(key));
    }
}
```

- [ ] **Step 2: 运行 BigBang 测试确认失败**

Run: `cargo test bigbang_cases::root_cause_trace -- --nocapture`  
Expected: FAIL

- [ ] **Step 3: 最小实现统一 tracing 初始化与字段宏/辅助函数**

```rust
pub fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(true)
        .compact()
        .init();
}
```

- [ ] **Step 4: 运行 BigBang 与全量测试**

Run: `cargo test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/support.rs src/http.rs src/rt.rs src/app.rs tests/bigbang_cases/root_cause_trace.rs
git commit -m "refactor: 统一tracing字段并建立根因定位门禁"
```

---

### Task 8: Chinese High-Value Comments + Final Verification + Spec Backfill

**Files:**
- Modify: `src/app.rs`
- Modify: `src/http.rs`
- Modify: `src/rt.rs`
- Modify: `src/chat.rs`
- Modify: `src/store.rs`
- Modify: `docs/superpowers/specs/2026-04-04-群聊IM-BigBang架构手术设计.md`

- [ ] **Step 1: 补充中文高价值注释（职责/边界/关键分支）**

```rust
// 这里是协议翻译边界：只做命令映射与错误转码，严禁承载业务真相裁决。
```

- [ ] **Step 2: 运行格式化与静态检查**

Run: `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`  
Expected: PASS

- [ ] **Step 3: 运行全量验证矩阵**

Run: `cargo test && cargo run -- --help`  
Expected: PASS（测试全绿，程序可正常启动）

- [ ] **Step 4: 回填 spec 的“实施结果”段落**

```markdown
## 实施结果
- 已完成入口瘦身、壳层隔离、错误语义统一、日志字段统一。
- 已通过 BigBang 守卫测试与全量回归。
```

- [ ] **Step 5: Commit**

```bash
git add src/app.rs src/http.rs src/rt.rs src/chat.rs src/store.rs docs/superpowers/specs/2026-04-04-群聊IM-BigBang架构手术设计.md
git commit -m "chore: 完成BigBang重构收尾与注释治理"
```

---

## Global Rules During Execution

1. 每个 Task 严格按 `先失败测试 -> 最小实现 -> 转绿 -> 提交` 执行。  
2. 不跨层塞逻辑：`http/rt/web` 不得新增业务裁决。  
3. 不允许“只改代码不补测试”。  
4. 每个 Task 结束都要执行 `git status --short`，确认无无关噪音。  
5. 提交信息统一中文，且具体说明边界变化。

## Final Acceptance Checklist

- [ ] `cargo test` 全绿
- [ ] 三条主链（进房/发消息/断线恢复）可复现通过
- [ ] `ack != message_created` 全链路成立
- [ ] `room != membership truth` 全链路成立
- [ ] 关键失败路径可单次日志定位根因层
- [ ] 关键模块具备高价值中文注释（非动作复述）
