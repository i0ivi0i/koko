# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common development commands

### Full app (recommended local dev)
- `pwsh ./run.ps1`
  - Loads `.env`, updates Rust/frontend lock dependencies, builds frontend once, starts frontend watch + typecheck watch, then runs backend.

### Backend (Rust)
- Run app: `cargo run`
- Run all tests: `cargo test`
- Run a specific test file:
  - `cargo test --test 领域测试`
  - `cargo test --test 用例测试`
  - `cargo test --test 集成测试`
- Run a single Rust test:
  - `cargo test --test 用例测试 引导匿名会话可返回会话快照 -- --exact`
- Lint (required standard): `cargo clippy -- -D warnings`
- Format check: `cargo fmt --check`

### Frontend (Lit + TypeScript)
- Typecheck: `pnpm --dir frontend typecheck`
- Typecheck (watch): `pnpm --dir frontend typecheck:watch`
- Build: `pnpm --dir frontend build`
- Build (watch): `pnpm --dir frontend dev:watch`
- Run frontend tests: `pnpm --dir frontend test`
- Run frontend e2e-style spec: `pnpm --dir frontend test:e2e`
- Run a single frontend test file:
  - `pnpm --dir frontend test -- frontend/tests/聊天壳测试.spec.ts`

## High-level architecture

Koko is a **Rust modular monolith** for group chat/IM, with strict internal layering and a thin frontend shell.

### 1) Backend layering (DDD + hexagonal boundaries)

Declared in `src/lib.rs` and implemented via Chinese-named modules:

- `entry` (`src/入口.rs`): startup orchestration only (init logs, load config, migrate, start server)
- `assembly` (`src/总装.rs`): configuration + logging + migration utilities
- `shell` (`src/外壳.rs`): HTTP routes + Socket.IO wiring + response mapping
- `usecase` (`src/用例.rs`): application use cases and repository port trait
- `domain` (`src/领域/*.rs`): pure business invariants/errors (no framework/IO)
- `adapter` (`src/适配.rs`): PostgreSQL implementation of the repository port
- `contract` (`src/契约.rs`): stable cross-layer commands/queries/snapshots/events/error codes

Dependency direction is intentionally one-way:
- `shell -> usecase -> domain`
- `shell/usecase -> contract`
- `adapter` implements usecase port and handles persistence/transactions.

### 2) Truth model and event flow

Persistence is PostgreSQL (`migrations/0001_初始化真相模型.sql`) with core tables:
- `sessions`, `rooms`, `room_members`, `room_events`, `messages`

Important invariant: room stream position is authoritative and monotonic (`event_position`).
`messages` is tied to `room_events` via `(room_id, event_position)` FK, so “message created” and event stream stay consistent.

### 3) Realtime vs control-plane separation

In `src/外壳.rs`, realtime uses `socketioxide`.

- Domain facts are emitted as room events (`room_event` / `room_events` payloads from `contract::领域事件`).
- Non-domain control feedback (subscribe/rejected/error) is emitted separately (`control_result`).

Do not mix transport ACK/control semantics with domain events.

### 4) Frontend structure

Frontend is in `frontend/` with Lit web components:
- `入口.ts`: bootstrap entry, loads chat shell and optional admin shell
- `聊天壳.ts`: chat UI flow (bootstrap session, join room, pull events)
- `后台壳.ts`: admin read-only flow (login, overview, room list/detail)
- `传输.ts`: HTTP + socket transport adapter for frontend
- `契约.ts`: frontend-side DTO interfaces
- `状态.ts` / `视图.ts`: state model + formatting helpers

`frontend/index.html` mounts `<koko-chat-shell>` and loads `/dist/app.js`.
Backend statically serves frontend assets from `src/外壳.rs`.

## Repo-specific rules that matter

These are critical in this repository (from existing project rules/docs):

1. **Read before edit**: re-read target files before modifying; do not rely on stale memory.
2. **Search broadly first**: inspect all related code paths before changing behavior.
3. **Root-cause over patching**: fix underlying cause, not symptom-only tweaks.
4. **Keep layer boundaries strict**:
   - no business truth in frontend/shell/handler/repo glue.
   - adapter translates and persists; usecase/domain decide business semantics.
5. **Prefer reuse over hand-rolled infra**: especially realtime path (`socketioxide` is the chosen core runtime).
6. **Context7 for docs**: when library/framework/API behavior is involved, fetch current docs via Context7.
7. **Keep verification explicit**: run commands that directly prove the change (tests/typecheck/clippy/fmt as applicable).

## Test layout

- Rust domain rules: `tests/领域测试.rs`
- Rust usecase orchestration/log field checks: `tests/用例测试.rs`
- Rust integration (config/migration/http/realtime paths): `tests/集成测试.rs`
- Frontend component tests: `frontend/tests/聊天壳测试.spec.ts`, `frontend/tests/后台壳测试.spec.ts`
- Frontend flow smoke test: `frontend/tests/端到端测试.spec.ts`
