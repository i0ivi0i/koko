# Socketioxide 单节点多房间群聊主通道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `koko` 的 realtime 主链从“最小接线”收口成单节点可用的多房间群聊主通道，发送者与接收者统一收敛到同一份权威事件流。

**Architecture:** 领域与用例继续掌握成员资格、消息成立和 `event_position` 推进；`socketioxide` 只负责连接准入、房间分组、房间广播和控制面结果。连接级身份通过 handshake `auth` 进入 socket extension，消息成立后统一通过房间广播 `room_event`，禁止发送者旁路成功事件和私有广播表。

**Tech Stack:** Rust, axum, socketioxide, sqlx/PostgreSQL, socket.io-client, Tokio, tracing

---

## File Structure

### Existing files to modify

- [E:\koko\src\总装.rs](E:\koko\src\总装.rs)
  - 启动时创建长期 `PgPool` 与共享状态，替代按请求建连接池的模式。
- [E:\koko\src\适配.rs](E:\koko\src\适配.rs)
  - 让仓储基于共享 `PgPool` 工作，移除内部私有 runtime 持有方式。
- [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
  - 增加 connect middleware、socket extension、订阅/发送 handler 收口、room broadcaster。
- [E:\koko\src\用例.rs](E:\koko\src\用例.rs)
  - 新增订阅资格用例，保持业务裁决在 usecase/domain。
- [E:\koko\src\契约.rs](E:\koko\src\契约.rs)
  - 如有必要，仅做最小控制面结果补充，不新增第二套业务语义。
- [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)
  - 补 realtime 真实多客户端集成测试、连接准入测试、跨房间隔离测试。
- [E:\koko\frontend\传输.ts](E:\koko\frontend\传输.ts)
  - 用 `auth` 传连接级 `session_id`，不再在每个业务事件里重复自带身份。
- [E:\koko\frontend\状态.ts](E:\koko\frontend\状态.ts)
  - 让乐观态通过 `client_message_id` 与权威事件收敛。
- [E:\koko\frontend\聊天壳.ts](E:\koko\frontend\聊天壳.ts)
  - 调整订阅/发送事件负载，统一消费 `room_event` 与 `control_result`。
- [E:\koko\frontend\tests\聊天壳测试.spec.ts](E:\koko\frontend\tests\聊天壳测试.spec.ts)
  - 补前端收敛逻辑与身份传递测试。
- [E:\koko\frontend\tests\端到端测试.spec.ts](E:\koko\frontend\tests\端到端测试.spec.ts)
  - 如现有 E2E 已覆盖聊天主线，则更新契约与行为断言。

### New files likely to create

- [E:\koko\tests\realtime_集成测试.rs](E:\koko\tests\realtime_集成测试.rs)
  - 用官方 `socket.io-client` / 等价客户端补两端真实 socket 集成测试。若更适合继续放在现有 `集成测试.rs` 中，可不拆分。

### Relevant references

- [E:\koko\docs\superpowers\specs\2026-04-06-socketioxide-单节点多房间群聊主通道-design.md](E:\koko\docs\superpowers\specs\2026-04-06-socketioxide-单节点多房间群聊主通道-design.md)
- [E:\koko\学习\2026-04-06-socketioxide官方最佳实践与多房间群聊落地笔记.md](E:\koko\学习\2026-04-06-socketioxide官方最佳实践与多房间群聊落地笔记.md)
- [E:\koko\学习\2026-04-06-单节点多房间群聊主通道关键轮子官方最佳实践清单.md](E:\koko\学习\2026-04-06-单节点多房间群聊主通道关键轮子官方最佳实践清单.md)

---

### Task 1: 启动期共享状态与长期连接池归位

**Files:**
- Modify: [E:\koko\src\总装.rs](E:\koko\src\总装.rs)
- Modify: [E:\koko\src\适配.rs](E:\koko\src\适配.rs)
- Modify: [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
- Test: [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)

- [ ] **Step 1: 写失败测试，锁定“应用共享一个 `PgPool` 而不是按请求建池”的目标**

在 [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs) 新增或调整测试，断言：

```rust
#[tokio::test]
async fn 构建路由时持有共享数据库状态() {
    // 目标：证明路由构建不需要每个 handler 再自己建仓储 runtime
    // 具体验证方式可按最终状态结构调整。
}
```

- [ ] **Step 2: 运行测试，确认当前实现不满足共享池设计**

Run: `cargo test 构建路由时持有共享数据库状态 -- --nocapture`  
Expected: FAIL，现状下缺少共享 `PgPool` 状态或测试需最小调整后失败

- [ ] **Step 3: 最小实现共享状态**

实现要点：

```rust
#[derive(Clone)]
pub struct 应用状态 {
    pub pool: sqlx::PgPool,
    pub admin_password: String,
}
```

```rust
let pool = sqlx::postgres::PgPoolOptions::new()
    .max_connections( /* 合理单节点值 */ )
    .connect(&config.database_url)
    .await?;
```

```rust
Router::new().with_state(state)
```

同时让 `Pg仓储` 改为围绕共享 `PgPool` 工作，而不是内部再建 Tokio runtime。

- [ ] **Step 4: 运行测试并确认现有冷路径测试仍通过**

Run: `cargo test 启动缺配置即失败 数据库真相模型可迁移 http冷路径闭环 -- --nocapture`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/总装.rs src/适配.rs src/外壳.rs tests/集成测试.rs
git commit -m "重整共享状态并引入长期数据库连接池"
```

---

### Task 2: 连接级身份收口到 handshake auth 与 middleware

**Files:**
- Modify: [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
- Modify: [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)
- Modify: [E:\koko\frontend\传输.ts](E:\koko\frontend\传输.ts)
- Test: [E:\koko\frontend\tests\聊天壳测试.spec.ts](E:\koko\frontend\tests\聊天壳测试.spec.ts)

- [ ] **Step 1: 写失败测试，锁定连接级身份认证**

新增测试，至少覆盖：

```rust
#[tokio::test]
async fn realtime连接缺少合法session时被拒绝() {
    // 使用 socket.io 客户端连入，不带 session_id 或带非法 session_id
    // 断言收到 connect_error 或连接失败
}
```

前端测试补：

```ts
it("connects with auth.session_id instead of per-event session_id", async () => {
  // 断言 transport 层连接时使用 auth
})
```

- [ ] **Step 2: 运行测试，确认当前实现会失败**

Run: `cargo test realtime连接缺少合法session时被拒绝 -- --nocapture`  
Expected: FAIL

Run: `pnpm test -- --runInBand 聊天壳`  
Expected: FAIL

- [ ] **Step 3: 最小实现 connect middleware 与 socket extension**

实现要点：

```rust
#[derive(Clone)]
struct 已认证会话 {
    session_id: String,
}
```

```rust
async fn 认证中间件<A: Adapter>(
    socket: SocketRef<A>,
    TryData(auth): TryData<ConnectAuth>,
    state: State<应用状态>,
) -> Result<(), String> { /* 校验 session 存在性并写 extension */ }
```

前端连接改成：

```ts
io(baseUrl, {
  transports: ["websocket"],
  auth: { session_id }
})
```

- [ ] **Step 4: 跑测试确认连接身份已从 payload 收口到连接上下文**

Run: `cargo test realtime连接缺少合法session时被拒绝 -- --nocapture`  
Expected: PASS

Run: `pnpm test -- --runInBand 聊天壳`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/外壳.rs tests/集成测试.rs frontend/传输.ts frontend/tests/聊天壳测试.spec.ts
git commit -m "收口realtime连接级身份到auth与middleware"
```

---

### Task 3: 订阅资格用例与房间 join 主链

**Files:**
- Modify: [E:\koko\src\用例.rs](E:\koko\src\用例.rs)
- Modify: [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
- Modify: [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)

- [ ] **Step 1: 写失败测试，锁定“非成员不可订阅、合法成员才 join room”**

新增测试：

```rust
#[tokio::test]
async fn 非成员订阅房间被拒绝() {
    // A 创建房间
    // B 未入房直接订阅
    // 断言收到 rejected/control_result，并且后续不会收到该房间广播
}
```

- [ ] **Step 2: 运行测试，确认当前实现无法正确阻断**

Run: `cargo test 非成员订阅房间被拒绝 -- --nocapture`  
Expected: FAIL

- [ ] **Step 3: 增加最小订阅资格用例并接入 handler**

用例示意：

```rust
pub fn 校验房间订阅资格(
    仓储: &dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识)?;
    domain::member::校验成员可发言(is_member).map_err(映射领域错误)
}
```

订阅 handler 只做：

```rust
校验房间订阅资格(...)
socket.join(room_id).await?;
```

- [ ] **Step 4: 跑测试确认订阅资格和 room join 主链成立**

Run: `cargo test 非成员订阅房间被拒绝 realtime主链闭环 -- --nocapture`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/用例.rs src/外壳.rs tests/集成测试.rs
git commit -m "补齐订阅资格用例并收口房间订阅主链"
```

---

### Task 4: 统一房间广播路径，移除发送者旁路成功事件

**Files:**
- Modify: [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
- Modify: [E:\koko\src\契约.rs](E:\koko\src\契约.rs)
- Modify: [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)
- Modify: [E:\koko\frontend\状态.ts](E:\koko\frontend\状态.ts)
- Modify: [E:\koko\frontend\聊天壳.ts](E:\koko\frontend\聊天壳.ts)

- [ ] **Step 1: 写失败测试，锁定“发送者与接收者收到同一份权威事件”**

新增测试：

```rust
#[tokio::test]
async fn 同房发送后发送者与接收者都收到同一room_event() {
    // A/B 都订阅同房
    // A 发消息
    // 断言 A/B 收到相同 message_id/client_message_id/event_position
}
```

前端测试：

```ts
it("reconciles optimistic message with the same authoritative room_event", async () => {
  // 断言发送者不是靠单独成功事件收敛，而是靠 room_event + client_message_id
})
```

- [ ] **Step 2: 运行测试，确认当前实现失败**

Run: `cargo test 同房发送后发送者与接收者都收到同一room_event -- --nocapture`  
Expected: FAIL

Run: `pnpm test -- --runInBand 聊天壳`  
Expected: FAIL

- [ ] **Step 3: 最小实现房间广播统一路径**

实现要点：

```rust
async fn 广播房间权威事件<A: Adapter>(
    io: SocketIo<A>,
    room_id: &str,
    event: &serde_json::Value,
) { /* io.to/within(room_id).emit("room_event", ...) */ }
```

`handle_realtime_send` 成功后不再：

```rust
socket.emit("room_event", ...)
```

改为统一房间广播。

前端消费层统一把 `room_event` 作为消息成立来源。

- [ ] **Step 4: 跑测试确认统一广播路径成立**

Run: `cargo test 同房发送后发送者与接收者都收到同一room_event realtime主链闭环 -- --nocapture`  
Expected: PASS

Run: `pnpm test -- --runInBand 聊天壳`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/外壳.rs src/契约.rs tests/集成测试.rs frontend/状态.ts frontend/聊天壳.ts
git commit -m "统一房间广播路径并取消发送者旁路成功事件"
```

---

### Task 5: 补齐 `event_position` 续接、跨房间隔离与错误观测

**Files:**
- Modify: [E:\koko\src\外壳.rs](E:\koko\src\外壳.rs)
- Modify: [E:\koko\tests\集成测试.rs](E:\koko\tests\集成测试.rs)
- Modify: [E:\koko\frontend\tests\端到端测试.spec.ts](E:\koko\frontend\tests\端到端测试.spec.ts)

- [ ] **Step 1: 写失败测试，锁定续接与跨房间隔离**

新增测试：

```rust
#[tokio::test]
async fn 从指定event_position订阅时只补发缺失事件() {
    // 先写入多条消息
    // 客户端从 position N 订阅
    // 断言只收到 N 之后的事件
}

#[tokio::test]
async fn 不同房间之间广播严格隔离() {
    // A 在 room1，B 在 room2
    // room1 发消息，B 不得收到
}
```

- [ ] **Step 2: 运行测试，确认当前行为不完整**

Run: `cargo test 从指定event_position订阅时只补发缺失事件 不同房间之间广播严格隔离 -- --nocapture`  
Expected: 至少一项 FAIL

- [ ] **Step 3: 最小实现续接与日志补齐**

实现要点：

```rust
tracing::info!(
    session_id = ...,
    room_id = ...,
    client_message_id = ...,
    event_position = ...,
    usecase = "...",
    adapter = "socketioxide",
    ...
)
```

并确保订阅时：

1. 先发 `control_result.subscribed`
2. 再按 `from` 补发事件
3. 不跨房间广播

- [ ] **Step 4: 跑测试确认续接、隔离和观测字段成立**

Run: `cargo test -- --nocapture`  
Expected: PASS

Run: `pnpm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/外壳.rs tests/集成测试.rs frontend/tests/端到端测试.spec.ts
git commit -m "补齐事件续接跨房间隔离与主链观测"
```

---

### Task 6: 收尾验证与文档同步

**Files:**
- Modify: [E:\koko\docs\superpowers\specs\2026-04-06-socketioxide-单节点多房间群聊主通道-design.md](E:\koko\docs\superpowers\specs\2026-04-06-socketioxide-单节点多房间群聊主通道-design.md)
- Modify: [E:\koko\学习\2026-04-06-单节点多房间群聊主通道关键轮子官方最佳实践清单.md](E:\koko\学习\2026-04-06-单节点多房间群聊主通道关键轮子官方最佳实践清单.md)

- [ ] **Step 1: 回看实现与 spec 的防漂移检查点**

人工检查：

1. 没有 payload 自带 `session_id`
2. 没有私有 `room -> sockets` 广播表
3. 没有发送者旁路成功事件
4. `PgPool` 已启动期共享

- [ ] **Step 2: 运行最终验证命令**

Run: `cargo test -- --nocapture`  
Expected: PASS

Run: `pnpm test`  
Expected: PASS

如项目存在格式化门禁，再执行：

Run: `cargo fmt --check`  
Expected: PASS

- [ ] **Step 3: 同步文档与注释**

更新设计文档状态与任何必要的学习笔记，确保没有语义漂移。

- [ ] **Step 4: 复查工作树**

Run: `git status --short`  
Expected: 仅剩本任务相关文件，无无关格式化噪音

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-06-socketioxide-单节点多房间群聊主通道-design.md 学习/2026-04-06-单节点多房间群聊主通道关键轮子官方最佳实践清单.md
git commit -m "完成单节点多房间群聊主通道收尾与文档同步"
```

