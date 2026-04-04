# 群聊IM 纯TS前端 Big Bang 替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性将 Web 前端从 Dioxus/Rust-WASM 替换为纯 TypeScript（Lit + socket.io-client），后端保持纯 Rust，业务命令/事件 100% 走 realtime。

**Architecture:** 保持 Rust `domain/application/contract/store/http/rt` 权威真相不变，只替换 shell。前端新壳落到 `frontend/`，通过 esbuild 产物覆盖 `dist/public`，并删除 Dioxus 前端链路与残留门禁。HTTP 只保留静态资源、健康检查与管理入口。

**Tech Stack:** Rust, axum, socketioxide, TypeScript, Lit, socket.io-client, esbuild, PowerShell, cargo test

---

## File Structure (Lock Before Editing)

### New files

- `frontend/package.json`: 前端依赖与构建命令（Lit、socket.io-client、esbuild、typescript）。
- `frontend/tsconfig.json`: TS 编译约束。
- `frontend/src/main.ts`: 前端入口与挂载。
- `frontend/src/app-shell.ts`: Lit 根组件。
- `frontend/src/realtime/socket-client.ts`: realtime 连接/重连/事件收发。
- `frontend/src/contract/types.ts`: 前端消费契约类型。
- `frontend/src/state/chat-store.ts`: 仅体验态（草稿/pending/连接提示）。
- `frontend/src/views/chat-view.ts`: 聊天主视图。
- `frontend/src/views/search-view.ts`: 搜索/进房视图。
- `scripts/ts-bundle-web.ps1`: 前端打包脚本（替代 dx-bundle）。

### Existing files to modify

- `run.ps1`: 保持纯启动器，不加业务逻辑（仅必要注释更新）。
- `scripts/verify-rust-workspace.ps1`: 切换为 TS 打包校验。
- `src/main.rs`: 移除 wasm 前端入口残留，保留纯服务端入口。
- `src/support.rs`: 前端产物守卫输入链改为 `frontend/src/**` + `dist/public/index.html`。
- `src/http.rs`: 静态资源路径与首页资源断言适配 TS 产物。
- `src/lib.rs`: 移除 Dioxus 前端模块导出。
- `Cargo.toml`: 删除 Dioxus/WebAssembly 前端依赖。
- `.gitignore`: 忽略前端 node 产物。
- `docs/superpowers/specs/2026-04-04-群聊IM-纯TS前端BigBang替换-design.md`: 回填实施结果。

### Existing files to delete

- `Dioxus.toml`
- `scripts/dx-bundle-web.ps1`
- `src/web.rs`
- `src/view.rs`
- `src/chat.rs`
- `tests/http_cases/chat_state.rs`
- `tests/http_cases/view_render.rs`
- `tests/http_cases/web_shell.rs`
- `tests/http_support/fixtures/frontend/wasm/koko.js`

### Test files to modify

- `tests/http.rs`: 移除旧壳测试模块，挂接新 TS 壳冒烟测试。
- `tests/http_cases/routes.rs`: 更新静态资源与首页断言。
- `tests/http_cases/run_script.rs`: 从 `dx-bundle` 路径断言切到 `ts-bundle` 路径。
- `tests/http_cases/startup.rs`: 前端守卫文案与新鲜度输入链断言。

---

### Task 1: 建立“旧壳必须清零”失败门禁

**Files:**
- Modify: `tests/http.rs`
- Modify: `tests/http_cases/routes.rs`
- Modify: `tests/http_cases/startup.rs`

- [ ] **Step 1: 写失败测试，断言首页不再依赖 wasm/dioxus 资源**

```rust
#[test]
fn bundled_index_must_not_reference_wasm_or_dioxus_runtime() {
    let html = load_index_html();
    assert!(!html.contains("_bg.wasm"));
    assert!(!html.contains("dioxus"));
    assert!(html.contains("/assets/app.js"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test http routes::bundled_index_must_not_reference_wasm_or_dioxus_runtime -- --nocapture`
Expected: FAIL（当前仍引用 wasm/dioxus）

- [ ] **Step 3: 写失败测试，断言前端守卫输入链为 frontend/src**

```rust
#[test]
fn frontend_freshness_inputs_must_point_to_ts_sources() {
    let message = stale_error_message();
    assert!(message.contains("frontend/src"));
    assert!(!message.contains("src/web.rs"));
}
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cargo test frontend_freshness_inputs_must_point_to_ts_sources -- --nocapture`
Expected: FAIL

- [ ] **Step 5: Commit**

```bash
git add tests/http.rs tests/http_cases/routes.rs tests/http_cases/startup.rs
git commit -m "test: 增加纯TS前端替换的清零门禁"
```

---

### Task 2: 建立纯TS前端构建链（替代 dx-bundle）

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `scripts/ts-bundle-web.ps1`
- Modify: `scripts/verify-rust-workspace.ps1`
- Modify: `.gitignore`
- Delete: `scripts/dx-bundle-web.ps1`

- [ ] **Step 1: 写失败测试，验证 verify 脚本不再引用 dx-bundle**

```rust
#[test]
fn verify_script_must_call_ts_bundle_pipeline() {
    let script = std::fs::read_to_string("scripts/verify-rust-workspace.ps1").unwrap();
    assert!(script.contains("ts-bundle-web.ps1"));
    assert!(!script.contains("dx-bundle-web.ps1"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test http run_script::verify_script_must_call_ts_bundle_pipeline -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现前端构建链**

```powershell
# scripts/ts-bundle-web.ps1
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run typecheck
pnpm --dir frontend run build
```

- [ ] **Step 4: 运行构建链验证**

Run: `powershell -ExecutionPolicy Bypass -File scripts/ts-bundle-web.ps1`
Expected: PASS（生成 dist/public/index.html 与 dist/public/assets/app.js）

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json scripts/ts-bundle-web.ps1 scripts/verify-rust-workspace.ps1 .gitignore
git rm scripts/dx-bundle-web.ps1
git commit -m "build: 切换为纯TS前端打包链并移除dx脚本"
```

---

### Task 3: 落地 Lit + socket.io-client 最小可用壳

**Files:**
- Create: `frontend/src/main.ts`
- Create: `frontend/src/app-shell.ts`
- Create: `frontend/src/realtime/socket-client.ts`
- Create: `frontend/src/contract/types.ts`
- Create: `frontend/src/state/chat-store.ts`
- Create: `frontend/src/views/search-view.ts`
- Create: `frontend/src/views/chat-view.ts`

- [ ] **Step 1: 写失败测试，要求首页能渲染 TS 壳基础区域**

```rust
#[tokio::test]
async fn root_entry_serves_ts_shell_regions() {
    let html = request_root_html().await;
    assert!(html.contains("data-koko-shell=\"search\""));
    assert!(html.contains("data-koko-shell=\"chat\""));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test http routes::root_entry_serves_ts_shell_regions -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现 TS 壳与 realtime 客户端**

```ts
// frontend/src/realtime/socket-client.ts
import { io } from "socket.io-client";
export const socket = io({ transports: ["websocket"] });
```

- [ ] **Step 4: 前端类型与构建验证**

Run: `pnpm --dir frontend run typecheck && pnpm --dir frontend run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.ts frontend/src/app-shell.ts frontend/src/realtime/socket-client.ts frontend/src/contract/types.ts frontend/src/state/chat-store.ts frontend/src/views/search-view.ts frontend/src/views/chat-view.ts
git commit -m "feat: 增加Lit纯TS聊天壳与socket客户端"
```

---

### Task 4: 切换 Rust 启动守卫到 TS 输入链

**Files:**
- Modify: `src/support.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 写失败测试，前端过期提示必须引用 ts-bundle 脚本**

```rust
#[test]
fn stale_frontend_message_must_point_to_ts_bundle_script() {
    let error = stale_error_message();
    assert!(error.contains("scripts/ts-bundle-web.ps1"));
    assert!(!error.contains("dx-bundle-web.ps1"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test stale_frontend_message_must_point_to_ts_bundle_script -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现守卫切换**

```rust
const FRONTEND_BUNDLE_INPUT_PATHS: [&str; N] = ["frontend/src/main.ts", ...];
```

- [ ] **Step 4: 验证守卫与编译**

Run: `cargo check && cargo test frontend_bundle_freshness -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/support.rs src/main.rs
git commit -m "refactor: 前端守卫切换到TS输入链并统一提示"
```

---

### Task 5: 删除 Dioxus 前端链路与依赖

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/lib.rs`
- Delete: `src/web.rs`
- Delete: `src/view.rs`
- Delete: `src/chat.rs`
- Delete: `Dioxus.toml`

- [ ] **Step 1: 写失败测试，禁止 Dioxus 依赖残留**

```rust
#[test]
fn cargo_toml_must_not_depend_on_dioxus_for_web_shell() {
    let cargo = std::fs::read_to_string("Cargo.toml").unwrap();
    assert!(!cargo.contains("dioxus"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test cargo_toml_must_not_depend_on_dioxus_for_web_shell -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现清零删除**

```toml
# Cargo.toml 删除 dioxus / wasm web-shell 相关条目
```

- [ ] **Step 4: 编译与测试验证**

Run: `cargo check && cargo test --test app --test http --test rt`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml src/lib.rs
git rm src/web.rs src/view.rs src/chat.rs Dioxus.toml
git commit -m "refactor: 清零Dioxus前端链路与依赖"
```

---

### Task 6: 清理旧前端测试残留并替换为新壳门禁

**Files:**
- Modify: `tests/http.rs`
- Modify: `tests/http_cases/routes.rs`
- Modify: `tests/http_cases/run_script.rs`
- Delete: `tests/http_cases/chat_state.rs`
- Delete: `tests/http_cases/view_render.rs`
- Delete: `tests/http_cases/web_shell.rs`
- Delete: `tests/http_support/fixtures/frontend/wasm/koko.js`

- [ ] **Step 1: 写失败测试，禁止旧 wasm fixture 残留**

```rust
#[test]
fn old_wasm_fixture_must_be_removed() {
    assert!(!std::path::Path::new("tests/http_support/fixtures/frontend/wasm/koko.js").exists());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test old_wasm_fixture_must_be_removed -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现测试清零与新断言替换**

```rust
// routes.rs 改为断言 /assets/app.js + shell data-region
```

- [ ] **Step 4: 运行 HTTP/RT 回归**

Run: `cargo test --test http && cargo test --test rt`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/http.rs tests/http_cases/routes.rs tests/http_cases/run_script.rs
git rm tests/http_cases/chat_state.rs tests/http_cases/view_render.rs tests/http_cases/web_shell.rs tests/http_support/fixtures/frontend/wasm/koko.js
git commit -m "test: 移除旧前端测试残留并切换TS壳门禁"
```

---

### Task 7: 集成冒烟与反回流门禁

**Files:**
- Modify: `scripts/verify-rust-workspace.ps1`
- Modify: `tests/http_cases/startup.rs`

- [ ] **Step 1: 写失败测试，反回流检查必须拦截 dx bundle 字样**

```rust
#[test]
fn verify_script_must_reject_dx_bundle_regression() {
    let script = std::fs::read_to_string("scripts/verify-rust-workspace.ps1").unwrap();
    assert!(script.contains("Select-String -Pattern 'dx-bundle-web'"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test verify_script_must_reject_dx_bundle_regression -- --nocapture`
Expected: FAIL

- [ ] **Step 3: 最小实现反回流门禁与冒烟命令**

```powershell
if (Select-String -Path . -Pattern 'dx-bundle-web|_bg.wasm|dioxus' -Quiet) { throw "legacy frontend residue" }
```

- [ ] **Step 4: 运行完整验证矩阵**

Run: `cargo test --test app --test http --test rt && powershell -ExecutionPolicy Bypass -File scripts/verify-rust-workspace.ps1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-rust-workspace.ps1 tests/http_cases/startup.rs
git commit -m "chore: 增加前端反回流门禁与全链路冒烟验证"
```

---

### Task 8: 文档回填与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-群聊IM-纯TS前端BigBang替换-design.md`
- Modify: `docs/superpowers/plans/2026-04-04-群聊IM-纯TS前端BigBang替换实施计划.md`

- [ ] **Step 1: 回填实施结果与实际偏差**

```markdown
## 实施结果
- 旧前端已清零
- 纯TS壳已接管
- 业务命令/事件走 realtime
```

- [ ] **Step 2: 运行最终验收命令**

Run: `cargo test && powershell -ExecutionPolicy Bypass -File run.ps1`
Expected: PASS（服务可启动，UI可访问）

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-04-群聊IM-纯TS前端BigBang替换-design.md docs/superpowers/plans/2026-04-04-群聊IM-纯TS前端BigBang替换实施计划.md
git commit -m "docs: 回填纯TS前端BigBang实施结果"
```

---

## Notes for Execution

1. 全流程必须遵守：先失败测试，再最小实现，再转绿，再提交。
2. 每个 Task 结束必须检查 `git status --short`，不留无关噪音。
3. 不允许保留“临时双前端”状态到任务结束。
4. 所有提交信息使用中文并明确边界变化。
