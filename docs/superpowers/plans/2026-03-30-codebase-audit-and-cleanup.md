# Codebase Audit And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the entire codebase for duplicated wheel-building, redundant framework layers, and dead or overlapping code paths, then clean them up without weakening the current DDD and multi-shell boundaries.

**Architecture:** Treat this as a characterization-first cleanup campaign, not a rewrite. Every cleanup must start from a concrete hotspot in the current code, add or tighten tests that prove the observable contract, then collapse or replace redundant code only inside the correct layer (`domain / application / contract / adapter / shell`).

**Tech Stack:** Rust 2024, Dioxus web shell, Axum HTTP, Socketioxide realtime, SQLx/Postgres, Reqwest, Tokio, serde, thiserror.

---

## File Responsibility Map

- `src/domain.rs`: Pure business value objects and invariants.
- `src/contract.rs`: Cross-shell shared commands, queries, events, snapshots, error codes.
- `src/app.rs`: Application use-cases and port interfaces; current hotspot for abstraction sprawl.
- `src/store.rs`: SQLx-backed adapter; current hotspot for persistence/query duplication and hidden error compression.
- `src/http.rs`: HTTP adapter and cookie/auth translation.
- `src/rt.rs`: Realtime adapter and effect execution plan.
- `src/main.rs`: Native composition root for Axum, Socketioxide, SQLx, and runtime wiring.
- `src/web.rs`: Browser chat shell and same-origin API adaptation.
- `src/admin.rs`: Browser admin shell and backend read-model loading.
- `src/chat.rs`: Shell-side chat state; hotspot for local-only optimistic IDs and timestamps.
- `src/view.rs`: Pure presentation components.
- `src/support.rs`: Cross-cutting support utilities that are not shell-specific.
- `tests/app_flow.rs`: Main characterization test hotspot for app/store behavior; currently oversized.
- `tests/http_flow.rs`: Browser-shell + HTTP behavior checks.
- `tests/admin_flow.rs`: Admin shell + admin HTTP behavior checks.
- `tests/rt_flow.rs`: Realtime planning/effects characterization.
- `tests/http_support/mod.rs`: Shared HTTP harness; current hotspot for reusable test infrastructure.

## Campaign Rules

- Do not rewrite multiple subsystems in one pass.
- Do not remove any abstraction until a characterization test proves what must stay true.
- Prefer existing ecosystem capabilities over custom support code when the crate is already in use.
- Do not add new non-test `.rs` files unless the audit proves a boundary cannot be cleaned up inside the current 13-file cap.
- Commit after each cleanup slice with a Chinese message that states the hotspot and boundary affected.
- Prefer behavior-level guards over source-text assertions; only lock an implementation detail when that detail is itself the contract.
- Add a failing test first only when the cleanup introduces a missing guard; when preserving existing behavior, strengthen an existing passing characterization instead of fabricating a red/green loop against internals.

## Initial Hotspots

- `src/app.rs`: three admin read-model entrypoints currently coexist (`get_admin_overview`, `list_admin_rooms`, `load_admin_panel`), which is a likely application-surface overlap.
- `src/store.rs`: persistence logic is concentrated here; active-row decoding and `map_sqlx_error` suggest repeated adapter policy and blind dependency failure compression.
- `src/http.rs` + `src/rt.rs` + `src/main.rs`: composition and adapter glue need a full check for framework leakage, duplicated wiring, and boundaries that should stop at `application / contract`.
- `src/web.rs` + `src/admin.rs`: browser shells still duplicate request/bootstrap patterns and error-to-UI plumbing.
- `src/chat.rs`: local pending-message IDs and timestamps are legitimate UX state only if they never become business truth; this must be re-validated as part of the shell audit.
- `tests/app_flow.rs` + `tests/http_support/mod.rs`: test harness logic is oversized and may already be hiding repeated setup concerns.

### Task 1: Freeze A Reliable Audit Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-codebase-audit-and-cleanup.md`
- Read: `Cargo.toml`
- Read: `src/lib.rs`
- Read: `src/app.rs`
- Read: `src/store.rs`
- Read: `src/http.rs`
- Read: `src/rt.rs`
- Read: `src/main.rs`
- Read: `src/chat.rs`
- Read: `src/web.rs`
- Read: `src/admin.rs`
- Read: `tests/app_flow.rs`

- [ ] **Step 1: Record the current verification baseline**

Run: `cargo test --quiet`
Expected: all current tests pass

- [ ] **Step 2: Record the wasm compatibility baseline**

Run: `cargo check --target wasm32-unknown-unknown`
Expected: exit 0

- [ ] **Step 3: Inventory module size hotspots**

Run: `Get-ChildItem src -File | ForEach-Object { $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines; "src/{0}:{1}" -f $_.Name, $lines }`
Expected: identify `src/app.rs` and `src/store.rs` as primary audit hotspots

- [ ] **Step 4: Inventory test size hotspots**

Run: `Get-ChildItem tests -Recurse -File | ForEach-Object { $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines; "tests/{0}:{1}" -f ($_.FullName.Substring((Resolve-Path tests).Path.Length + 1) -replace '\\','/'), $lines }`
Expected: identify `tests/app_flow.rs` as primary audit hotspot

- [ ] **Step 5: Write the measured hotspot list into this plan**

Record at least these candidates:
- `src/app.rs`: port/proxy sprawl and thin pass-through use-cases
- `src/store.rs`: persistence/query concentration and coarse SQLx error compression
- `src/main.rs` + `src/http.rs` + `src/rt.rs`: composition-root and adapter boundary drift
- `src/chat.rs`: shell-local pending state that must not become business truth
- `src/web.rs` + `src/admin.rs`: shell HTTP helper ownership and repeated client setup
- `tests/app_flow.rs` + `tests/http_support/mod.rs`: test harness concentration and repeated setup logic

- [ ] **Step 6: Record the baseline in this plan without creating a docs-only checkpoint**

Expected:
- the plan file captures the measured hotspots
- no commit is created unless this planning task itself is the explicit deliverable

### Task 2: Audit Reused Wheels Versus Custom Support Code

**Files:**
- Read: `Cargo.toml`
- Read: `src/main.rs`
- Modify: `src/support.rs`
- Modify: `src/web.rs`
- Modify: `src/admin.rs`
- Modify: `src/chat.rs`
- Modify: `src/http.rs`
- Modify: `src/rt.rs`
- Test: `tests/http_flow.rs`
- Test: `tests/admin_flow.rs`
- Test: `tests/rt_flow.rs`

- [ ] **Step 1: Inventory the dependency/framework surface before touching helpers**

Run:
- `cargo tree -e features`
- `cargo tree --duplicates`

Expected:
- identify whether a current crate feature already covers any custom helper being audited
- identify whether multiple framework layers are solving the same concern

- [ ] **Step 2: Search for hand-written support around libraries already in use**

Run: `Select-String -Path src\*.rs -Pattern 'reqwest|web_sys|socketioxide|sqlx|Uuid::now_v7|Utc::now|CookieJar|thiserror'`
Expected: produce a candidate list of custom wrappers and helper functions

- [ ] **Step 3: Decide which helpers are justified adapters and which are duplicate wheels**

Use this decision rule:
- Keep if it translates shell/adapter environment into stable app/contract inputs
- Keep if it protects a real shell UX concern without becoming business truth
- Remove if it just rewraps a crate feature without adding boundary value

- [ ] **Step 4: Add a behavior-level guard before changing any helper**

Use one of these patterns:
- strengthen an existing behavior test that already proves the helper boundary
- add a new failing test only when a missing invariant is being introduced

Example target in `tests/http_flow.rs`:
```rust
#[tokio::test]
async fn bootstrap_endpoint_sets_session_cookie_for_followup_calls() {
    // guard the shell-facing contract instead of naming the internal helper.
}
```

- [ ] **Step 5: Run the focused tests to verify the guard works**

Run: `cargo test --test http_flow && cargo test --test admin_flow && cargo test --test rt_flow`
Expected:
- PASS before refactor when guarding existing behavior
- or FAIL first only if you are intentionally adding a missing guard

- [ ] **Step 6: Remove or relocate exactly one duplicate helper at a time**

Priority order:
1. shell-only URL/origin helpers
2. repeated reqwest client setup with no shell-specific state
3. shell-local pending timestamp/ID generation that can be made explicit as UX-only state
4. adapter-local event/error translation wrappers that add no policy

- [ ] **Step 7: Re-run the focused shell and realtime tests**

Run: `cargo test --test http_flow && cargo test --test admin_flow && cargo test --test rt_flow`
Expected: PASS

- [ ] **Step 8: Commit the single helper cleanup**

```bash
git add src/support.rs src/web.rs src/admin.rs src/chat.rs src/http.rs src/rt.rs tests/http_flow.rs tests/admin_flow.rs tests/rt_flow.rs Cargo.toml Cargo.lock
git commit -m "清理: 收口重复辅助轮子与适配职责"
```

### Task 3: Audit Application-Layer Redundancy And Port Sprawl

**Files:**
- Modify: `src/app.rs`
- Read: `src/contract.rs`
- Read: `src/domain.rs`
- Test: `tests/app_flow.rs`
- Test: `tests/domain_flow.rs`

- [ ] **Step 1: Identify thin pass-through use-cases and overlapping ports**

Inspect these current candidates:
- `get_admin_overview`
- `list_admin_rooms`
- `load_admin_panel`
- separate admin read-model port traits that may be unnecessarily fragmented

- [ ] **Step 2: For each candidate, decide whether the abstraction protects a boundary**

Keep if it enforces application semantics or future shell neutrality.
Collapse if it only forwards from one trait to another with zero policy.

- [ ] **Step 3: Add a behavior-level guard before collapsing any app API**

Example in `tests/app_flow.rs`:
```rust
#[tokio::test]
async fn admin_panel_read_model_stays_available_through_the_application_boundary() {
    // assert observable app behavior, not trait or function spellings.
}
```

- [ ] **Step 4: Run the targeted app tests**

Run: `cargo test --test app_flow`
Expected:
- PASS before refactor when guarding existing behavior
- or FAIL first only if you are intentionally adding a missing guard

- [ ] **Step 5: Collapse exactly one redundant abstraction cluster**

Preferred order:
1. admin read-model wrappers/port split
2. repeated dependency-failure checks that can be centralized without hiding business meaning
3. any contract/application mapping duplication proven to be mechanical

- [ ] **Step 6: Re-run app and domain verification**

Run: `cargo test --test app_flow && cargo test --test domain_flow`
Expected: PASS

- [ ] **Step 7: Commit the application-layer cleanup**

```bash
git add src/app.rs src/contract.rs src/domain.rs tests/app_flow.rs tests/domain_flow.rs
git commit -m "清理: 收口应用层冗余抽象"
```

### Task 4: Audit Store And Adapter Redundancy

**Files:**
- Modify: `src/store.rs`
- Modify: `src/http.rs`
- Modify: `src/rt.rs`
- Modify: `src/main.rs`
- Test: `tests/app_flow.rs`
- Test: `tests/http_flow.rs`
- Test: `tests/rt_flow.rs`

- [ ] **Step 1: Inventory repeated persistence and adapter patterns**

Current audit candidates:
- repeated `status = 'active'` row validation paths
- one-size-fits-all `map_sqlx_error`
- composition-root wiring that may duplicate adapter concerns across `main.rs`, `http.rs`, and `rt.rs`
- effect planning versus effect execution split in realtime

- [ ] **Step 2: Add or tighten a behavior-level guard for the first cleanup target**

Examples:
```rust
#[tokio::test]
async fn load_room_snapshot_rejects_snapshot_with_foreign_room_messages() {
    // existing guard remains the boundary
}
```

```rust
#[tokio::test]
async fn message_is_broadcast_only_after_persistence_and_sender_gets_feedback() {
    // effect ordering remains the boundary
}
```

- [ ] **Step 3: Run only the targeted tests**

Run: `cargo test --test app_flow load_room_snapshot_rejects_snapshot_with_foreign_room_messages -- --exact`
Expected:
- PASS before refactor when guarding existing behavior
- or FAIL first only if you are tightening a missing guard

- [ ] **Step 4: Refactor one adapter duplication cluster**

Allowed targets:
- centralize repeated active-row decoding if it reduces duplication without hiding invariants
- strengthen SQLx error mapping granularity if it removes blind compression
- remove adapter glue that only forwards effect payloads unchanged
- simplify composition wiring only if the framework boundary remains outside `application / contract`

- [ ] **Step 5: Re-run adapter-focused suites**

Run: `cargo test --test app_flow && cargo test --test http_flow && cargo test --test rt_flow`
Expected: PASS

- [ ] **Step 6: Commit the adapter/store cleanup**

```bash
git add src/store.rs src/http.rs src/rt.rs src/main.rs tests/app_flow.rs tests/http_flow.rs tests/rt_flow.rs
git commit -m "清理: 收口存储与适配层冗余实现"
```

### Task 5: Audit Frontend Shell And Presentation Redundancy

**Files:**
- Modify: `src/web.rs`
- Modify: `src/admin.rs`
- Modify: `src/chat.rs`
- Modify: `src/view.rs`
- Test: `tests/http_flow.rs`
- Test: `tests/admin_flow.rs`

- [ ] **Step 1: Search for repeated shell-only concerns**

Look for:
- duplicate request bootstrap/load patterns
- duplicate error-to-UI plumbing
- shell state that mirrors contract data without adding UX value
- shell-local optimistic IDs/timestamps that risk leaking into business truth
- presentation-only logic leaking into shell state or vice versa

- [ ] **Step 2: Guard the intended shell boundary with behavior tests**

Example:
```rust
#[tokio::test]
async fn admin_panel_fetch_failure_surfaces_as_shell_error_state() {
    // guard shell behavior, not Dioxus API spellings.
}
```

- [ ] **Step 3: Run the shell-focused tests**

Run: `cargo test --test http_flow && cargo test --test admin_flow`
Expected: PASS

- [ ] **Step 4: Remove one redundant shell path at a time**

Priority order:
1. duplicate request-building code
2. shell state that only mirrors contract fields
3. shell-local optimistic state that is not adding UX value
4. presentation branching that belongs entirely inside `view.rs`

- [ ] **Step 5: Verify wasm build still succeeds**

Run: `cargo check --target wasm32-unknown-unknown`
Expected: exit 0

- [ ] **Step 6: Commit the shell/presentation cleanup**

```bash
git add src/web.rs src/admin.rs src/chat.rs src/view.rs tests/http_flow.rs tests/admin_flow.rs Cargo.toml Cargo.lock
git commit -m "清理: 收口前端壳层与展示层冗余"
```

### Task 6: Audit Test Infrastructure Redundancy

**Files:**
- Modify: `tests/app_flow.rs`
- Modify: `tests/http_support/mod.rs`
- Modify: `tests/admin_flow.rs`
- Modify: `tests/http_flow.rs`
- Modify: `tests/rt_flow.rs`

- [ ] **Step 1: Identify duplicated harness or fixture code**

Current hotspot list:
- repeated bootstrap/cookie helper patterns across HTTP/admin tests
- oversized `tests/app_flow.rs` sections that mix unrelated concerns
- DB reset/cleanup logic concentrated in `tests/http_support/mod.rs`

- [ ] **Step 2: Add a failing test only if the refactor changes test helper behavior**

Example:
```rust
#[tokio::test]
async fn bootstrap_session_sets_cookie_and_reuses_it_on_followup_request() {
    // guard helper semantics before moving code
}
```

- [ ] **Step 3: Move shared test setup into existing helpers, not new scattered files**

Preferred destinations:
- HTTP/admin shared setup -> `tests/http_support/mod.rs`
- app-only DB helpers -> keep inside `tests/app_flow.rs` unless duplication is proven across suites

- [ ] **Step 4: Re-run the full test suite after each helper extraction**

Run: `cargo test`
Expected: PASS

- [ ] **Step 5: Commit the test infrastructure cleanup**

```bash
git add tests/app_flow.rs tests/http_support/mod.rs tests/admin_flow.rs tests/http_flow.rs tests/rt_flow.rs
git commit -m "清理: 收口测试基础设施与重复辅助代码"
```

### Task 7: Final Architecture Review And Cleanup Gate

**Files:**
- Modify: `docs/superpowers/plans/2026-03-30-codebase-audit-and-cleanup.md`
- Read: `Cargo.toml`
- Read: `src/*.rs`
- Read: `tests/*.rs`

- [ ] **Step 1: Re-check file count and boundary drift**

Run: `Get-ChildItem src -File *.rs | Measure-Object`
Expected: non-test `.rs` count remains within the project cap

- [ ] **Step 2: Re-run all authoritative verification**

Run: `cargo test --quiet && cargo check --target wasm32-unknown-unknown`
Expected: exit 0

- [ ] **Step 3: Re-audit for leftover duplicate wheels and framework overlap**

Run:
- `Select-String -Path src\*.rs -Pattern 'reqwest::Client::new|Utc::now|Uuid::now_v7|map_sqlx_error|impl .*Port for PgStore'`
- `cargo tree -e features`

Expected:
- any remaining matches are deliberate and justified
- any remaining framework/dependency overlap is explicitly documented as intentional

- [ ] **Step 4: Update this plan with completed hotspots and deferred items**

Deferred items must include:
- why they were not cleaned now
- what invariant blocks cleanup
- which future change should revisit them

- [ ] **Step 5: Capture closeout evidence without a docs-only tail commit**

Expected:
- the plan file records completed slices and deferred architectural debt
- the last code cleanup commit already contains the related evidence
