# Telegram iOS 高保真视觉复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不污染 `contract / application / domain` 边界的前提下，把 `ConversationListScreen`、`JoinByCodeScreen`、`ChatScreen` 三页主链路壳显著推进到 Telegram iOS 手机壳观感。

**Architecture:** 这轮实现只允许在 `shell/view + CSS` 主层完成绝大多数改动，必要时仅做最小壳层接线白名单内的补齐。状态真相继续留在 `chat.rs` 和 `web.rs` 现有边界内，避免为了 UI 复刻把 Telegram 页面语义倒灌进共享层。

**Tech Stack:** Rust, Dioxus RSX, hand-written CSS, existing Rust test suite

---

## File Structure

### Primary files
- Modify: `E:\koko\Cargo.toml`
  - 如当前缺少视图渲染测试能力，补最小 `dev-dependency` 支撑 Dioxus SSR 字符串渲染测试。
- Modify: `E:\koko\src\view.rs`
  - 负责三页壳层结构、命名、最小可访问交互、必要测试辅助函数。
- Modify: `E:\koko\assets\theme.css`
  - 负责 Telegram iOS 风格视觉系统、导航栏、搜索栏、列表 cell、聊天页与响应式壳体展示。
- Modify: `E:\koko\tests\web_shell_flow.rs`
  - 负责壳层状态分流与必要的主链路结构保护测试。
- Create: `E:\koko\tests\view_render_flow.rs`
  - 负责 `view.rs` 的 SSR 结构渲染测试，避免把视图结构断言硬塞进现有状态流测试。

### Secondary files
- Modify only if strictly needed: `E:\koko\src\web.rs`
  - 仅允许白名单内最小壳层接线：搜索 loading 派生、键盘/aria 事件补齐、必要壳层可观测标记。

### Files that must not be expanded for this task
- `E:\koko\src\contract.rs`
- `E:\koko\src\chat.rs`
- `E:\koko\src\http.rs`

---

### Task 1: Lock Shell Structure Test Baseline

**Files:**
- Modify: `E:\koko\Cargo.toml`
- Modify: `E:\koko\src\view.rs`
- Create: `E:\koko\tests\view_render_flow.rs`

- [ ] **Step 1: Add the minimal render-test foundation**

If `dioxus-ssr` is absent from `dev-dependencies`, add `dioxus-ssr = "0.7.4"` so tests can render Dioxus components into deterministic HTML strings.

Use the official SSR rendering path:
- `VirtualDom::new_with_props(...)` for `view::ChatPage`
- `vdom.rebuild_in_place()`
- `dioxus_ssr::render(&vdom)` or `dioxus_ssr::render_element(...)`

Do not invent a wrapper component unless the Dioxus API forces it. The test baseline should render the existing prop-driven shell root directly.

- [ ] **Step 2: Write the failing SSR tests for first-pass Telegram iOS shell structure**

Add tests that fail against current shell expectations:
- conversation list shell exposes a dedicated navigation region, embedded search shell, and conversation row semantics
- search shell exposes a back navigation layout and search result list semantics
- chat shell exposes navigation region, message thread region, and composer region

Use existing `ChatState` builders or small local helpers. Prefer testing stable structure/text markers, not incidental class counts.

- [ ] **Step 3: Run tests to verify they fail for the expected reason**

Run: `cargo test --test view_render_flow`
Expected: FAIL because the new structural assertions are not yet true.

- [ ] **Step 4: Add minimal structural markers/helpers in `view.rs` to satisfy test intent**

Only add shell-level roles / labels / stable classes needed to express Telegram-style regions clearly. Do not redesign visuals yet.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --test view_render_flow`
Expected: PASS for the new shell structure assertions.

- [ ] **Step 6: Simplify touched structure without changing behavior**

Apply `code-simplifier` discipline:
- prefer explicit helper names over inline duplication
- avoid introducing new abstraction layers
- keep component responsibilities local to existing file

- [ ] **Step 7: Commit**

```bash
git add E:\koko\Cargo.toml E:\koko\src\view.rs E:\koko\tests\view_render_flow.rs
git commit -m "锁定 Telegram 壳层结构测试基线"
```

---

### Task 2: Refactor Navigation And Search To Telegram iOS Shell

**Files:**
- Modify: `E:\koko\src\view.rs`
- Modify: `E:\koko\assets\theme.css`
- Modify: `E:\koko\tests\view_render_flow.rs`

- [ ] **Step 1: Write the failing SSR tests for navigation/search presentation boundaries**

Add tests that express the desired shell contract:
- conversation list no longer depends on the old `Menu / TL` framing
- search bar is treated as embedded iOS-style shell chrome, not a standalone “card panel”
- chat/search top bars expose consistent back/title/meta regions

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test view_render_flow`
Expected: FAIL with assertions showing old navigation/search shell shape is still present.

- [ ] **Step 3: Implement minimal `view.rs` changes for new nav/search composition**

Target outcomes:
- replace fake three-column web header feel with Telegram-style top bar composition
- embed search shell into conversation/search flow
- keep all room/query truth sourcing unchanged

Do not add any new state to `chat.rs`.

- [ ] **Step 4: Implement minimal `theme.css` changes for nav/search visual system**

Target outcomes:
- iOS-style header density
- iOS-style search field shell
- reduced “floating card” feeling
- clearer safe-area handling

- [ ] **Step 5: Run focused tests**

Run: `cargo test --test view_render_flow`
Expected: PASS

- [ ] **Step 6: Run state-flow regression tests**

Run: `cargo test --test web_shell_flow`
Expected: PASS

- [ ] **Step 7: Refactor for clarity and debt control**

Apply `code-refactoring-tech-debt` and `code-simplifier` discipline:
- remove leftover dead nav/search classes if replaced
- collapse duplicate shell fragments
- avoid introducing a new private mini design system

- [ ] **Step 8: Commit**

```bash
git add E:\koko\src\view.rs E:\koko\assets\theme.css E:\koko\tests\view_render_flow.rs E:\koko\tests\web_shell_flow.rs
git commit -m "重做 Telegram 风格导航栏与搜索栏"
```

---

### Task 3: Refactor Conversation List Cells To Telegram Density

**Files:**
- Modify: `E:\koko\src\view.rs`
- Modify: `E:\koko\assets\theme.css`
- Modify: `E:\koko\tests\view_render_flow.rs`

- [ ] **Step 1: Write failing SSR tests for conversation row semantics**

Add tests for:
- stable avatar/title/preview/time/unread regions
- keyboard-accessible row semantics
- no dependency on presentation truth beyond existing joined room fields

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test web_shell_flow`
and `cargo test --test view_render_flow`
Expected: FAIL because rows still reflect current heavy-card layout assumptions or lack the new semantics.

- [ ] **Step 3: Implement minimal `view.rs` row structure updates**

Target outcomes:
- row-level keyboard handling
- stable semantic grouping for avatar/content/meta
- no new truth fields

- [ ] **Step 4: Implement minimal `theme.css` list cell updates**

Target outcomes:
- flatter Telegram iOS list rhythm
- reduced card thickness, shadow, and border emphasis
- better unread/time balance
- controlled truncation

- [ ] **Step 5: Run tests**

Run:
- `cargo test --test view_render_flow`
- `cargo test --test web_shell_flow`
Expected: PASS

- [ ] **Step 6: Run broader suite to catch regressions**

Run: `cargo test --test app_flow --test http_flow --test rt_flow --test web_shell_flow`
Expected: PASS

- [ ] **Step 7: Refactor touched code for simplicity**

Remove duplicated row/search result patterns where safe, but keep distinct responsibilities readable.

- [ ] **Step 8: Commit**

```bash
git add E:\koko\src\view.rs E:\koko\assets\theme.css E:\koko\tests\view_render_flow.rs E:\koko\tests\web_shell_flow.rs
git commit -m "收紧会话列表项为 Telegram iOS 密度"
```

---

### Task 4: Refactor Chat Shell, Background, And Composer

**Files:**
- Modify: `E:\koko\src\view.rs`
- Modify: `E:\koko\assets\theme.css`
- Modify: `E:\koko\tests\view_render_flow.rs`

- [ ] **Step 1: Write failing SSR tests for chat shell composition**

Add tests for:
- chat top bar semantics
- message thread region marker
- composer structure marker
- send control remains disabled when draft is empty

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test web_shell_flow`
and `cargo test --test view_render_flow`
Expected: FAIL because the current composer/thread shell does not yet match the new contract.

- [ ] **Step 3: Implement minimal `view.rs` chat shell updates**

Target outcomes:
- Telegram-style nav composition
- clearer thread region
- composer substructure ready for Telegram-like styling
- no changes to message truth flow

- [ ] **Step 4: Implement minimal `theme.css` chat shell updates**

Target outcomes:
- more Telegram-like wallpaper/background layering
- more Telegram-like bubble width/density
- more Telegram-like composer and send action treatment

- [ ] **Step 5: Run focused tests**

Run:
- `cargo test --test view_render_flow`
- `cargo test --test web_shell_flow`
Expected: PASS

- [ ] **Step 6: Run regression suite**

Run: `cargo test`
Expected: PASS

- [ ] **Step 7: Simplify and remove debt**

Specific debt targets:
- delete stale shell classes superseded by the new visual model
- merge duplicate spacing rules
- keep `theme.css` tokens coherent instead of layering ad-hoc overrides

- [ ] **Step 8: Commit**

```bash
git add E:\koko\src\view.rs E:\koko\assets\theme.css E:\koko\tests\view_render_flow.rs E:\koko\tests\web_shell_flow.rs
git commit -m "重做聊天页壳层与输入区视觉结构"
```

---

### Task 5: Add Allowed Minimal Shell Wiring If Still Needed

**Files:**
- Modify only if needed: `E:\koko\src\web.rs`
- Test: `E:\koko\tests\web_shell_flow.rs`

- [ ] **Step 1: Identify whether any approved shell-local state is still missing**

Only proceed if one of these is genuinely required:
- search loading derivation
- search focus wiring
- keyboard accessibility completion
- aria/event completion
- minimal observability marker for tests

- [ ] **Step 2: Write the failing test for the exact missing shell-local behavior**

Do not broaden scope. One missing behavior per test.

- [ ] **Step 3: Run the failing test**

Run the smallest command that proves failure, e.g.:
`cargo test --test web_shell_flow <relevant filter>`

- [ ] **Step 4: Implement the minimal shell-local wiring in `web.rs`**

Explicit constraint:
- no new shared state in `chat.rs`
- no new contract fields
- no Telegram-specific business branches

- [ ] **Step 5: Run focused and then broad verification**

Run:
- `cargo test --test web_shell_flow`
- `cargo test`

Expected: PASS

- [ ] **Step 6: Commit if this task was needed**

```bash
git add E:\koko\src\web.rs E:\koko\tests\web_shell_flow.rs
git commit -m "补齐壳层最小接线以支持 Telegram 复刻"
```

---

### Task 6: Empty States, Error Bar, And Wide-Shell Finish

**Files:**
- Modify: `E:\koko\src\view.rs`
- Modify: `E:\koko\assets\theme.css`
- Modify: `E:\koko\tests\view_render_flow.rs`
- Modify: `E:\koko\tests\web_shell_flow.rs`
- Modify only if strictly needed: `E:\koko\src\web.rs`

- [ ] **Step 1: Write failing tests for empty/error/wide-shell finish items**

Split the proof by ownership boundary:
- `view_render_flow.rs` covers shell-local empty states and wide-shell structural markers
- `web_shell_flow.rs` covers the top error banner because its input source already lives in `App` as `bootstrap_error.or(shell_error())`

Add tests for:
- conversation/search/chat empty states use the intended shell regions
- top error banner remains shell-only, is rendered by `App`, and stays structurally separate from page truth
- wide-shell container markers remain present for centered phone-shell presentation

- [ ] **Step 2: Run tests to verify they fail**

Run:
- `cargo test --test view_render_flow`
- `cargo test --test web_shell_flow`

Expected: FAIL

- [ ] **Step 3: Implement minimal `view.rs` / `theme.css` finish work and only the allowed `web.rs` wiring if genuinely needed**

Target outcomes:
- empty states no longer feel like standalone web cards
- error banner continues to use the existing `bootstrap_error + shell_error` source in `App`; do not create a new shared truth path
- wide-shell presentation preserves phone-shell feel

- [ ] **Step 4: Run focused tests**

Run:
- `cargo test --test view_render_flow`
- `cargo test --test web_shell_flow`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add E:\koko\src\view.rs E:\koko\assets\theme.css E:\koko\tests\view_render_flow.rs E:\koko\tests\web_shell_flow.rs E:\koko\src\web.rs
git commit -m "收口空态错误态与宽屏壳体表现"
```

---

### Task 7: Final Cleanup, Manual Baseline Review, And Verification

**Files:**
- Modify: any of the already touched files only if needed for cleanup

- [ ] **Step 1: Review touched code for simplification opportunities**

Apply `code-simplifier`:
- remove redundant class names
- trim dead helpers
- keep explicit, readable control flow

Apply `code-refactoring-tech-debt`:
- confirm no new fake truth states
- confirm no new contract pollution
- confirm no new private framework glue has appeared

- [ ] **Step 2: Run frozen-baseline manual review**

Using:
- `E:\koko\学习\Telegram-iOS`
- `E:\koko\学习\Telegram-iOS-UI学习地图.md`
- `E:\koko\docs\superpowers\specs\2026-04-01-telegram-ios-高保真视觉复刻-design.md`

Execute the fixed checklist from the spec and record whether each item is satisfied:
- navigation bar hierarchy
- iOS-style search field feel
- conversation cell density
- composer feel
- reduced web feel in bubbles/background
- wide-shell phone-shell presentation

- [ ] **Step 3: Verify worktree contains only intended changes**

Run: `git diff --stat`
Expected: changes limited to plan-approved files and no unrelated formatting churn.

- [ ] **Step 4: Run fresh full verification**

Run:
- `cargo test`
- `cargo check`

Expected: both exit successfully.

- [ ] **Step 5: Inspect final status**

Run: `git status --short --branch`
Expected: only intended modified files remain before the final commit.

- [ ] **Step 6: Commit final cleanup**

```bash
git add E:\koko\Cargo.toml E:\koko\src\view.rs E:\koko\assets\theme.css E:\koko\tests\view_render_flow.rs E:\koko\tests\web_shell_flow.rs E:\koko\src\web.rs
git commit -m "完成 Telegram iOS 高保真视觉复刻第一轮收口"
```

---

## Notes For Execution

- Prefer modifying existing components over creating new files.
- Do not add a private mini design system or new layer of UI wrappers.
- When in doubt, move visual complexity into CSS, not business state.
- If a behavior cannot be expressed without polluting `chat.rs` or `contract.rs`, stop and revisit the plan instead of improvising.
