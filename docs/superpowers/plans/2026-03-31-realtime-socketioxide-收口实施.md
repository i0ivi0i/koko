# Realtime Socketioxide 收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 升级 `socketioxide` 到 `0.18.2`，把 realtime 身份承接收回到 `koko_session` cookie 的连接上下文，删除 `src/rt.rs` 的私有 realtime DSL，并保持回归测试全绿。

**Architecture:** `contract` 里的 realtime command 退回成 wire payload，`src/app.rs` 新增 app-only 输入结构继续承接显式 `session_id`。`src/rt.rs` 改成薄 adapter：connect middleware 认证一次并把 `AuthenticatedSession` 写进 socket extension，消息 handler 直接调用应用用例，再直接使用 `socketioxide` 原语做 `join`、sender ack 和排除 sender 的房间广播。

**Tech Stack:** Rust 2024, axum 0.8, socketioxide 0.18.2, tokio, serde, sqlx, uuid, chrono, tracing, futures-util, tokio-tungstenite 0.28（仅测试）

---

## File Structure

- `Cargo.toml`
  - 升级 `socketioxide` 到 `0.18.2`
  - 新增测试用 `futures-util = "0.3.32"` 与 `tokio-tungstenite = "0.28.0"`
- `Cargo.lock`
  - 刷新锁文件，固定 `socketioxide 0.18.2`
- `src/contract.rs`
  - 删除 realtime wire command 上的 `session_id`
  - 保持 `MessageCreated` / `RoomStreamSubscribed` / `CommandRejected` payload 不变
- `src/app.rs`
  - 新增 app-only 输入结构 `SubscribeRoomStreamInput` / `SendTextMessageInput`
  - 保持业务语义和错误语义不变
- `src/rt.rs`
  - 新增 `AuthenticatedSession`
  - 新增 cookie 解析 / handshake 认证 helper
  - 用 connect middleware + extension 替代 payload 身份承接
  - 删除 `CommandPlan` / `RealtimeEffect` / `plan_*` / `apply_effects`
- `src/main.rs`
  - 按 `socketioxide 0.18.2` 的 API 调整 layer/build 装配
- `tests/app_flow.rs`
  - 锁定 wire contract 无 `session_id`
  - 锁定 `application` 改用 app-only 输入后行为不变
- `tests/rt_flow.rs`
  - 移除对 `RealtimeEffect` / `CommandPlan` 的断言
  - 增加 cookie 认证 helper 测试
  - 增加最小 end-to-end realtime 测试，证明 sender 只收到 `message_accepted`，其他成员收到 `message_created`
- `docs/superpowers/reviews/2026-03-31-realtime-socketioxide-审查记录.md`
  - 回填治理结果与实际修复边界

---

### Task 1: 拆开 Wire Payload 与 Application 输入

**Files:**
- Modify: `src/contract.rs`
- Modify: `src/app.rs`
- Modify: `src/rt.rs`
- Test: `tests/app_flow.rs`
- Test: `tests/admin_flow.rs`
- Test: `tests/rt_flow.rs`

- [ ] **Step 1: 写失败测试，锁定 realtime wire payload 不再带 `session_id`**

```rust
#[test]
fn subscribe_room_stream_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SubscribeRoomStreamCommand {
        room_id: Uuid::from_u128(1),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000001\"}"
    );
}

#[test]
fn send_text_message_command_serializes_without_session_id() {
    let json = serde_json::to_string(&SendTextMessageCommand {
        room_id: Uuid::from_u128(2),
        body: "hello".to_string(),
        client_message_id: Some(Uuid::from_u128(3)),
    })
    .unwrap();

    assert_eq!(
        json,
        "{\"room_id\":\"00000000-0000-0000-0000-000000000002\",\"body\":\"hello\",\"client_message_id\":\"00000000-0000-0000-0000-000000000003\"}"
    );
}
```

- [ ] **Step 2: 写失败测试，锁定 `application` 改用 app-only 输入结构**

```rust
let result = subscribe_room_stream(
    &FakeSessionPort::allow(),
    &FakeMembershipPort::allow(),
    SubscribeRoomStreamInput {
        room_id,
        session_id,
    },
)
.await;
```

```rust
let event = send_text_message(
    &FakeSessionPort::allow(),
    &FakeMembershipPort::allow(),
    &store,
    &FixedIdGenerator(message_id),
    &FakeClock::new(now),
    SendTextMessageInput {
        room_id,
        session_id,
        body: "hello koko".to_string(),
        client_message_id: Some(client_message_id),
    },
)
.await;
```

- [ ] **Step 2.5: 盘清所有会被签名变更击中的调用点**

这一轮至少要一并改掉这些位置，不能只改 `app_flow`：

- `tests/app_flow.rs`
- `tests/admin_flow.rs`
- `src/rt.rs`
- `tests/rt_flow.rs`

先允许 `src/rt.rs` 继续保留旧 realtime DSL 直到 Task 4，但它在 Task 1 里必须先编译通过新的 app-only 输入签名。

- [ ] **Step 2.6: 用 grep 再扫一遍遗留调用点**

Run:

```powershell
rg -n "send_text_message\(|subscribe_room_stream\(" tests src
```

Expected:

- 输出里的调用点都已经被纳入 Task 1 或 Task 4
- 没有计划外的隐藏编译点

- [ ] **Step 3: 运行测试确认 RED**

Run:

```powershell
cargo test --test app_flow subscribe_room_stream_command_serializes_without_session_id
cargo test --test app_flow send_text_message_command_serializes_without_session_id
cargo test --test app_flow subscribe_room_stream_accepts_active_member
```

Expected:

- 序列化测试因 `session_id` 仍存在而失败
- `application` 测试因 `SubscribeRoomStreamInput` / `SendTextMessageInput` 尚不存在而编译失败

- [ ] **Step 4: 写最小实现**

在 `src/contract.rs` 里把 realtime wire command 改成 payload-only：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscribeRoomStreamCommand {
    pub room_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendTextMessageCommand {
    pub room_id: Uuid,
    pub body: String,
    pub client_message_id: Option<Uuid>,
}
```

在 `src/app.rs` 里新增 app-only 输入结构，并把 use-case 签名切过去：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscribeRoomStreamInput {
    pub room_id: Uuid,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendTextMessageInput {
    pub room_id: Uuid,
    pub session_id: Uuid,
    pub body: String,
    pub client_message_id: Option<Uuid>,
}
```

- 在 `src/rt.rs` 中先做最小编译迁移，让旧 `plan_*` 暂时改用新 app-only 输入：

```rust
command: subscribe_room_stream_input(
    AuthenticatedSession {
        session_id: command.session_id,
    },
    SubscribeRoomStreamCommand {
        room_id: command.room_id,
    },
)
```

这里的“从旧 command 临时取 `session_id`”只允许作为 Task 1 的过渡编译桥，Task 4 必须彻底删掉这条路径。

- 在 `tests/admin_flow.rs` 里把直接调用 `app::send_text_message(...)` 的地方改成：

```rust
SendTextMessageInput {
    room_id: room.room_id,
    session_id: first_session.session_id,
    body: "hello admin".to_string(),
    client_message_id: None,
}
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
cargo test --test app_flow subscribe_room_stream_command_serializes_without_session_id
cargo test --test app_flow send_text_message_command_serializes_without_session_id
cargo test --test app_flow subscribe_room_stream_accepts_active_member
cargo test --test app_flow send_text_message_returns_message_created_event
cargo test --test admin_flow admin_overview_returns_room_member_and_message_counts
cargo test --test admin_flow admin_rooms_returns_live_room_summaries
cargo test --test rt_flow init_tracing_is_idempotent
cargo check
```

Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git add src/contract.rs src/app.rs src/rt.rs tests/app_flow.rs tests/admin_flow.rs tests/rt_flow.rs
git commit -m "拆分 realtime wire payload 与应用层输入"
```

---

### Task 2: 升级 `socketioxide` 到 0.18.2 并锁定迁移基线

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `src/main.rs`
- Test: `cargo check`

- [ ] **Step 1: 先把目标版本写进依赖**

```toml
[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
socketioxide = "0.18.2"
```

如果要做最小 e2e client，补测试依赖：

```toml
[dev-dependencies]
futures-util = "0.3.32"
tokio-tungstenite = "0.28.0"
```

- [ ] **Step 2: 刷新锁文件**

Run:

```powershell
cargo update -p socketioxide --precise 0.18.2
```

Expected:

- `Cargo.lock` 出现 `socketioxide 0.18.2`
- 如果因特性冲突失败，停下并记录阻断证据，不要跳过

- [ ] **Step 3: 跑一次编译确认迁移断点**

Run:

```powershell
cargo check
```

Expected:

- 失败点主要集中在 `src/rt.rs` / `src/main.rs`
- 不应把失败扩散成无关模块的全面改造

- [ ] **Step 4: 做最小装配修正**

只修到新版 `socketioxide` 能装配 server，不提前改 realtime 逻辑：

```rust
let (socket_layer, io) = socketioxide::SocketIo::new_layer();
let router = koko::http::app_router(store, config.admin_token).layer(socket_layer);
```

如果 `0.18.2` 在 builder / layer API 上有小变化，只改 `src/main.rs` 和必要 import，让编译焦点继续收口到 `src/rt.rs`。

- [ ] **Step 5: 再跑一次编译**

Run:

```powershell
cargo check
```

Expected:

- 若仍失败，剩余失败应主要来自 realtime adapter 边界改造

- [ ] **Step 6: Commit**

```powershell
git add Cargo.toml Cargo.lock src/main.rs
git commit -m "升级 realtime 主通道到 socketioxide 0.18.2"
```

---

### Task 3: 建立 Cookie 认证与 App-Input 组装 Helper

**Files:**
- Modify: `src/rt.rs`
- Test: `tests/rt_flow.rs`

- [ ] **Step 1: 写失败测试，锁定 cookie 解析与认证语义**

```rust
#[tokio::test]
async fn authenticate_realtime_session_reads_koko_session_from_multi_cookie_header() {
    let session_id = Uuid::from_u128(1);
    let headers = HeaderMap::from_iter([(
        COOKIE,
        HeaderValue::from_str(
            &format!("theme=dark; koko_session={session_id}; other=value")
        )
        .unwrap(),
    )]);

    let session = authenticate_realtime_session(&FakeSessionPort::allow(), &headers)
        .await
        .unwrap();

    assert_eq!(session.session_id, session_id);
}

#[tokio::test]
async fn authenticate_realtime_session_rejects_missing_or_invalid_cookie() {
    let headers = HeaderMap::new();
    let error = authenticate_realtime_session(&FakeSessionPort::allow(), &headers)
        .await
        .unwrap_err();

    assert_eq!(error.code(), koko::contract::AppErrorCode::InvalidSession);
}
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
cargo test --test rt_flow authenticate_realtime_session_reads_koko_session_from_multi_cookie_header
cargo test --test rt_flow authenticate_realtime_session_rejects_missing_or_invalid_cookie
```

Expected:

- 编译失败，因为 helper 和 `AuthenticatedSession` 尚不存在

- [ ] **Step 3: 写最小实现**

在 `src/rt.rs` 增加：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticatedSession {
    pub session_id: Uuid,
}

pub async fn authenticate_realtime_session<S>(
    session_port: &S,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, AppError>
where
    S: SessionPort,
{
    let session_id = parse_koko_session_cookie(headers)?;
    if !session_port.is_active_session(session_id).await? {
        return Err(AppError::SessionNotActive { session_id });
    }
    Ok(AuthenticatedSession { session_id })
}
```

cookie helper 只负责：

```rust
fn parse_koko_session_cookie(headers: &HeaderMap) -> Result<Uuid, AppError>
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run:

```powershell
cargo test --test rt_flow authenticate_realtime_session_reads_koko_session_from_multi_cookie_header
cargo test --test rt_flow authenticate_realtime_session_rejects_missing_or_invalid_cookie
```

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/rt.rs tests/rt_flow.rs
git commit -m "补齐 realtime cookie 认证与会话承接基础"
```

---

### Task 4: 删除私有 DSL，改成 Direct Handler + Sender Exclusion

**Files:**
- Modify: `src/rt.rs`
- Modify: `tests/rt_flow.rs`
- Test: `tests/app_flow.rs`

- [ ] **Step 1: 写失败测试，替换对 `RealtimeEffect` / `CommandPlan` 的依赖**

把 `tests/rt_flow.rs` 从“断言 effect 枚举”改成“断言 adapter helper 与最小 e2e 语义”：

```rust
#[tokio::test]
async fn subscribe_room_stream_input_uses_authenticated_session() {
    let input = subscribe_room_stream_input(
        AuthenticatedSession { session_id: Uuid::from_u128(2) },
        SubscribeRoomStreamCommand {
            room_id: Uuid::from_u128(1),
        },
    );

    assert_eq!(
        input,
        SubscribeRoomStreamInput {
            room_id: Uuid::from_u128(1),
            session_id: Uuid::from_u128(2),
        }
    );
}
```

```rust
#[tokio::test]
async fn send_text_message_input_uses_authenticated_session() {
    let input = send_text_message_input(
        AuthenticatedSession { session_id: Uuid::from_u128(2) },
        SendTextMessageCommand {
            room_id: Uuid::from_u128(1),
            body: "hello".to_string(),
            client_message_id: None,
        },
    );

    assert_eq!(input.session_id, Uuid::from_u128(2));
}
```

- [ ] **Step 2: 写失败的最小 e2e realtime 测试**

使用 `tokio_tungstenite::connect_async` 连到临时 server，断言：

```rust
// 伪代码结构，实际按 test harness 写
// sender -> "message_accepted"
// receiver -> "message_created"
// sender 不应收到 "message_created"
```

最小断言集：

- 没有 `koko_session` cookie 的 client 连接失败
- sender 成功订阅并发消息后收到一次 `message_accepted`
- 同房间另一 client 收到一次 `message_created`
- sender 在等待窗口内未收到 `message_created`

- [ ] **Step 3: 运行测试确认 RED**

Run:

```powershell
cargo test --test rt_flow subscribe_room_stream_input_uses_authenticated_session
cargo test --test rt_flow send_text_message_input_uses_authenticated_session
cargo test --test rt_flow sender_receives_message_accepted_but_not_message_created
```

Expected:

- 编译失败或运行失败，因为旧 `rt.rs` 仍依赖 `CommandPlan` / `RealtimeEffect`

- [ ] **Step 4: 写最小实现，直接接回 `socketioxide`**

在 `src/rt.rs` 内：

1. 删掉：

```rust
pub enum RealtimeEffect { ... }
pub struct CommandPlan<T> { ... }
pub async fn plan_subscribe_room_stream(...) -> CommandPlan<()>
pub async fn plan_send_text_message(...) -> CommandPlan<MessageCreated>
async fn apply_effects(...)
```

2. 新增 app-input 组装 helper：

```rust
pub fn subscribe_room_stream_input(
    session: AuthenticatedSession,
    payload: SubscribeRoomStreamCommand,
) -> SubscribeRoomStreamInput

pub fn send_text_message_input(
    session: AuthenticatedSession,
    payload: SendTextMessageCommand,
) -> SendTextMessageInput
```

3. 在 `install_realtime` 里改成 connect middleware + direct handler：

```rust
io.ns("/", connect_handler.with(connect_middleware));
```

在 handler 内直接：

```rust
socket.join(payload.room_id.to_string());
socket.emit("room_stream_subscribed", &RoomStreamSubscribed { room_id: payload.room_id }).ok();
```

发送消息成功后：

```rust
socket.emit("message_accepted", &payload).ok();
socket
    .to(payload.room_id.to_string())
    .emit("message_created", &payload)
    .await
    .map_err(|_| AppError::DependencyFailure)?;
```

失败时只：

```rust
socket.emit("command_rejected", &CommandRejected { code: error.code() }).ok();
```

- [ ] **Step 5: 跑 targeted tests 确认 GREEN**

Run:

```powershell
cargo test --test rt_flow subscribe_room_stream_input_uses_authenticated_session
cargo test --test rt_flow send_text_message_input_uses_authenticated_session
cargo test --test rt_flow authenticate_realtime_session_reads_koko_session_from_multi_cookie_header
cargo test --test rt_flow sender_receives_message_accepted_but_not_message_created
cargo test --test app_flow send_text_message_returns_message_created_event
```

Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git add src/rt.rs tests/rt_flow.rs tests/app_flow.rs
git commit -m "移除 realtime 私有 DSL 并改回 socketioxide 原生处理"
```

---

### Task 5: 回填治理记录并做全量验证

**Files:**
- Modify: `docs/superpowers/reviews/2026-03-31-realtime-socketioxide-审查记录.md`
- Test: full suite

- [ ] **Step 1: 更新审查记录结论**

把“立即治理 / 可延期精修”改成已完成或已实质缓解，至少补这些事实：

- `socketioxide` 实际升级结论（已升到 `0.18.2` 或阻断说明）
- realtime wire payload 已去掉 `session_id`
- `CommandPlan` / `RealtimeEffect` 已删除
- sender exclusion 已有测试证据

- [ ] **Step 2: 跑全量验证**

Run:

```powershell
cargo test
```

Expected:

- 全绿
- 无新增无关失败

- [ ] **Step 3: 补一条编译验证**

Run:

```powershell
cargo check
```

Expected: PASS

- [ ] **Step 4: 检查工作树**

Run:

```powershell
git status --short
```

Expected:

- 只剩本任务相关改动
- 没有无关格式化噪音

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/reviews/2026-03-31-realtime-socketioxide-审查记录.md
git commit -m "回填 realtime 收口治理结果与验证证据"
```
