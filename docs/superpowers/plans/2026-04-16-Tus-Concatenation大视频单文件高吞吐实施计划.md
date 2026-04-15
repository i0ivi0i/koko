# Tus Concatenation 大视频单文件高吞吐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking。

**Goal:** 在不引入正式对象存储的前提下，把 `koko` 的大视频上传从“单附件单资源上传”升级成“`Tus Concatenation` 下的单附件上传会话 + partial/final transport”，让单个大视频真正支持并行分片高吞吐上传，同时不破坏当前 `prepare -> hook -> complete` 的业务真相。

**Architecture:** 继续站在 `Uppy + @uppy/tus + Rustus` 上，不重造第二套上传协议。核心变化是把领域真相从 `attachment_id -> 单运输记录` 升级成 `attachment_id -> 当前 upload_session` 与 `upload_session_id -> partial* + final`；前端只负责表达 `upload_session_id` 和 partial/final metadata，Rustus hook 负责把协议负载翻译成 transport 事实，`complete` 只消费会话上的 canonical final locator。

**Tech Stack:** TypeScript, Vitest, Rust, Axum, SQLx/PostgreSQL, Uppy `@uppy/tus`, Rustus, Tokio, PowerShell

---

## File Structure / Responsibility Map

### Existing files to modify

- `frontend/媒体/媒体发布.ts`
  - 前端上传器创建、`large-video` 档位、`resume / restart` 行为、Tus metadata 构造
- `frontend/tests/媒体发布测试.spec.ts`
  - 前端上传 transport 配置与草稿语义回归测试
- `frontend/传输.ts`
  - 若 prepare/abandon/complete 合同需要新字段，负责 HTTP 调用和契约映射
- `frontend/契约.ts`
  - 若 prepare 返回值新增 `upload_session_id` 或 transport role 信息，这里是共享契约面
- `src/媒体上传外壳.rs`
  - `prepare / complete / abandon` HTTP 壳与 `complete` 等待 transport 逻辑
- `src/rustus_hook外壳.rs`
  - `pre-create / post-finish` hook 解析、合法性校验、transport 回执登记
- `src/用例.rs`
  - 上传会话/transport 的领域用例与仓储端口
- `src/适配.rs`
  - 同步仓储端口桥接
- `src/媒体附件适配.rs`
  - SQLx 持久化：`attachment_upload_sessions`、`attachment_upload_transports`
- `src/外壳.rs`
  - 路由与后台清理调度
- `run.ps1`
  - Rustus `tus-extensions` / concatenation 相关启动参数接线
- `tests/媒体上传测试/rustus_hook.rs`
  - hook 合法/非法 partial/final 场景回归测试
- `tests/媒体上传测试.rs`
  - `prepare / complete / abandon` 与 session/final locator 集成测试
- `tests/测试支撑/媒体.rs`
  - Rustus hook 请求体 fixture、prepare/Tus 契约断言
- `tests/启动器脚本检查.ps1`
  - 启动器参数检查

### New files to create

- `migrations/<timestamp>_attachment_upload_sessions.sql`
  - 新建 `attachment_upload_sessions` 表，扩展 `attachment_upload_transports` 为会话下多记录
- `tests/媒体上传测试/tus_concatenation.rs`
  - 专门承载“会话 / partial / final / cleanup”高风险路径，避免把旧 `媒体上传测试.rs` 继续撑爆

### Why this split

- `src/媒体上传外壳.rs` 和 `src/rustus_hook外壳.rs` 已经是 canonical 入口，继续在这里扩展语义比平行新建第二套上传入口更干净。
- transport 事实会明显变复杂，所以为测试单独新开 `tests/媒体上传测试/tus_concatenation.rs` 是合理的；它属于测试文件，不违反 `.rs` 文件收缩约束。
- 领域真相收口在 `usecase + repo`，Rustus payload 细节停留在 adapter，不让协议字段渗进 domain。

## Task 1: Characterization Tests For Current Single-Receipt Boundary

**Files:**
- Modify: `frontend/tests/媒体发布测试.spec.ts`
- Modify: `tests/媒体上传测试/rustus_hook.rs`
- Test: `pnpm --dir frontend test -- tests/媒体发布测试.spec.ts`
- Test: `cargo test --test 媒体上传测试 rustus_pre_create -- --nocapture`

- [ ] **Step 1: Add a failing frontend test that proves large-video will need partial metadata**

在 `frontend/tests/媒体发布测试.spec.ts` 新增一条测试，名字类似：

```ts
it("large-video 恢复 parallelUploads 时必须同时声明 metadataForPartialUploads", () => {
  const options = 构造媒体Tus传输选项({
    tusEndpoint: "http://storage.local/files",
    profile: "large-video",
  });

  expect(options.parallelUploads).toBe(4);
  expect(options.metadataForPartialUploads).toEqual(
    expect.objectContaining({
      attachment_id: expect.any(String),
      upload_session_id: expect.any(String),
    }),
  );
});
```

- [ ] **Step 2: Run frontend test to verify it fails for the right reason**

Run:

```bash
pnpm --dir frontend test -- tests/媒体发布测试.spec.ts
```

Expected: FAIL because current `构造媒体Tus传输选项` neither returns `parallelUploads` nor `metadataForPartialUploads`.

- [ ] **Step 3: Add a failing Rust test that proves current hook cannot accept partial/final semantics**

在 `tests/媒体上传测试/rustus_hook.rs` 新增一条测试，名字类似：

```rust
#[tokio::test]
#[serial]
async fn rustus_pre_create_partial_upload即使带attachment_id也会因为缺少会话语义而被拒绝() {
    // 构造 prepare 68 bytes
    // 构造 hook body length = 34, metadata = { attachment_id, upload_session_id }
    // 预期当前逻辑还无法通过，会返回 invalid_argument 或 attachment_not_ready
}
```

这条测试的目标不是锁死最终错误码，而是表征：**当前 hook 根本没会话语义位置。**

- [ ] **Step 4: Run Rust test to verify it fails for the right reason**

Run:

```bash
cargo test --test 媒体上传测试 rustus_pre_create_partial_upload即使带attachment_id也会因为缺少会话语义而被拒绝 -- --nocapture
```

Expected: FAIL because current adapter / usecase has no `upload_session_id` path.

- [ ] **Step 5: Commit characterization tests**

```bash
git add frontend/tests/媒体发布测试.spec.ts tests/媒体上传测试/rustus_hook.rs
git commit -m "补充Tus Concatenation现状表征测试"
```

## Task 2: Schema And Domain Model For Upload Sessions

**Files:**
- Create: `migrations/<timestamp>_attachment_upload_sessions.sql`
- Modify: `src/用例.rs`
- Modify: `src/适配.rs`
- Modify: `src/媒体附件适配.rs`
- Test: `cargo test --test 媒体上传测试 -- --nocapture`

- [ ] **Step 1: Write failing repository/domain tests for upload session persistence**

在 `tests/媒体上传测试/tus_concatenation.rs` 新增最小持久化测试：

```rust
#[tokio::test]
#[serial]
async fn prepare会创建upload_session并把attachment标记到当前活跃会话() {
    // arrange
    // act
    // assert session exists, attachment points at session
}
```

以及：

```rust
#[tokio::test]
#[serial]
async fn 一个upload_session可以登记多个partial和一个final_transport() {
    // arrange
    // act
    // assert transport_role rows
}
```

- [ ] **Step 2: Run tests to verify they fail because schema/model does not exist**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: FAIL due to missing fields/tables/ports.

- [ ] **Step 3: Add migration for upload sessions and multi-record transports**

在新 migration 中：

1. 新建 `attachment_upload_sessions`
2. 为 `attachments` 增加 `current_upload_session_id`（如 spec 定了）
3. 扩展 `attachment_upload_transports`：
   - `upload_session_id`
   - `transport_role`
   - `concat_order`
4. 添加必要索引与唯一约束：
   - 每个 session 允许多个 `partial`
   - 每个 session 最多一个 `final`
   - 每个 attachment 最多一个活跃 session

- [ ] **Step 4: Extend domain structs and repository ports minimally**

在 `src/用例.rs` / `src/适配.rs` 中新增：

1. `媒体上传会话读取结果`
2. `媒体上传transport角色`
3. `创建媒体上传会话(...)`
4. `登记partial_transport(...)`
5. `登记final_transport(...)`
6. `查询附件当前上传会话(...)`

要求：

- 中文注释解释“附件锚点”和“会话锚点”的分工
- 不把 Rustus payload 字段名漏进 domain

- [ ] **Step 5: Implement SQLx persistence in `src/媒体附件适配.rs`**

最小实现：

1. prepare 时创建 session
2. 查询时能按 `attachment_id` 找到当前活跃 session
3. transport 表可表达 `single / partial / final`

- [ ] **Step 6: Run tests to verify green**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: PASS for newly added session persistence tests.

- [ ] **Step 7: Commit schema/domain slice**

```bash
git add migrations src/用例.rs src/适配.rs src/媒体附件适配.rs tests/媒体上传测试/tus_concatenation.rs
git commit -m "建立媒体上传会话与多transport领域模型"
```

## Task 3: Prepare Contract And Frontend Session Metadata

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `frontend/契约.ts`
- Modify: `frontend/传输.ts`
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`
- Test: `pnpm --dir frontend test -- tests/媒体发布测试.spec.ts`
- Test: `pnpm --dir frontend typecheck`

- [ ] **Step 1: Write failing frontend contract test for `upload_session_id`**

在 `frontend/tests/媒体发布测试.spec.ts` 新增：

```ts
it("prepare 返回 upload_session_id 后会写入最终和partial metadata", async () => {
  // prepare mock 带 upload_session_id
  // 处理大视频文件
  // 断言 addFile meta 含 upload_session_id
  // 断言 Tus transport options partial metadata fields 含 upload_session_id
});
```

- [ ] **Step 2: Run frontend test to verify it fails**

Run:

```bash
pnpm --dir frontend test -- tests/媒体发布测试.spec.ts
```

Expected: FAIL because `upload_session_id` does not yet exist in contract/meta.

- [ ] **Step 3: Extend prepare response contract**

在 `src/媒体上传外壳.rs` 和 `frontend/契约.ts` 中为 prepare 结果新增：

1. `upload_session_id`
2. 如需要，可新增 transport profile hints，但不要引入 UI 语义字段

- [ ] **Step 4: Thread `upload_session_id` through frontend transport meta**

在 `frontend/媒体/媒体发布.ts`：

1. 扩展 `媒体上传Meta`
2. `构造媒体上传Meta` 带入 `upload_session_id`
3. `构造媒体Tus传输选项` 为 `large-video` 恢复：
   - `parallelUploads: 4`
   - `metadataForPartialUploads: { attachment_id, upload_session_id }`
4. 保留详细中文注释，写清这是 partial/final 协议边界，不是普通优化

- [ ] **Step 5: Update frontend HTTP layer**

在 `frontend/传输.ts` 中：

1. 解析 prepare 返回的 `upload_session_id`
2. 不改变 `resume / restart` 现有壳层语义

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
pnpm --dir frontend test -- tests/媒体发布测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: PASS

- [ ] **Step 7: Commit prepare/frontend metadata slice**

```bash
git add frontend/契约.ts frontend/传输.ts frontend/媒体/媒体发布.ts frontend/tests/媒体发布测试.spec.ts src/媒体上传外壳.rs
git commit -m "接通媒体上传会话标识与大视频partial元数据"
```

## Task 4: Rustus Hook Adapter For Partial And Final

**Files:**
- Modify: `src/rustus_hook外壳.rs`
- Modify: `tests/测试支撑/媒体.rs`
- Modify: `tests/媒体上传测试/rustus_hook.rs`
- Test: `cargo test --test 媒体上传测试 rustus_ -- --nocapture`

- [ ] **Step 1: Add failing hook tests for partial/final translation**

在 `tests/媒体上传测试/rustus_hook.rs` 增加四条核心测试：

1. `rustus_pre_create_partial在同会话下会放行`
2. `rustus_pre_create_final_concat在同会话下会放行`
3. `rustus_post_finish_partial只登记partial_transport`
4. `rustus_post_finish_final才会写入session_final_locator`

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test --test 媒体上传测试 rustus_ -- --nocapture
```

Expected: FAIL because hook body currently only models `id/offset/length/path/metadata`.

- [ ] **Step 3: Extend hook adapter model without leaking protocol names into domain**

在 `src/rustus_hook外壳.rs`：

1. 扩展 `RustusUploadBody`
2. 增加 adapter 内部 helper，把真实 hook payload 翻译成：
   - `transport_role`
   - `upload_session_id`
   - `declared_byte_size`
   - `is_partial / is_final`
3. 中文注释明确：协议字段只在 adapter 停留

- [ ] **Step 4: Split pre-create validation by role**

实现规则：

1. `single`：`length == prepared.byte_size`
2. `partial`：`length < prepared.byte_size` 合法，但 session 必须匹配
3. `final`：不再按整文件 length 判断，而是按 session + partial 集合判断

- [ ] **Step 5: Split post-finish handling by role**

实现规则：

1. `partial`：只写 transport row
2. `final`：更新 session 的 canonical final locator
3. late callback on abandoned session：继续拒绝

- [ ] **Step 6: Run hook tests to verify green**

Run:

```bash
cargo test --test 媒体上传测试 rustus_ -- --nocapture
```

Expected: PASS

- [ ] **Step 7: Commit hook slice**

```bash
git add src/rustus_hook外壳.rs tests/测试支撑/媒体.rs tests/媒体上传测试/rustus_hook.rs
git commit -m "让Rustus hook识别partial与final上传回执"
```

## Task 5: Complete Path Consumes Canonical Final Only

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `tests/媒体上传测试.rs`
- Modify: `tests/媒体上传测试/tus_concatenation.rs`
- Test: `cargo test --test 媒体上传测试 -- --nocapture`

- [ ] **Step 1: Add failing complete tests**

新增至少三条：

1. `complete在只有partial没有final时返回attachment_not_ready`
2. `complete只读取当前活跃session的final_locator`
3. `restart后旧session_final不会被complete误消费`

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: FAIL because `complete` 目前还是按单 transport receipt 读。

- [ ] **Step 3: Rework complete waiting logic**

在 `src/媒体上传外壳.rs`：

1. `媒体上传运输回执已就绪` / `等待complete所需运输回执` 改成 session-aware
2. 只认当前活跃 session 的 canonical final locator
3. partial locator 永远不能进入 complete 主链

- [ ] **Step 4: Preserve business truth boundary**

确认实现仍满足：

1. `transport finished != attachment ready`
2. 只有 `complete` 成功才升级附件状态

- [ ] **Step 5: Run tests to verify green**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: PASS

- [ ] **Step 6: Commit complete slice**

```bash
git add src/媒体上传外壳.rs tests/媒体上传测试.rs tests/媒体上传测试/tus_concatenation.rs
git commit -m "让complete仅消费上传会话的final回执"
```

## Task 6: Abandon, GC, And Partial Residue Cleanup

**Files:**
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/外壳.rs`
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `tests/媒体上传测试.rs`
- Modify: `tests/媒体上传测试/tus_concatenation.rs`
- Test: `cargo test --test 媒体上传测试 -- --nocapture`

- [ ] **Step 1: Add failing cleanup tests**

新增：

1. `restart会放弃整个旧upload_session`
2. `abandoned session 的late partial post_finish不会复活`
3. `final完成后partial残留会被清理`
4. `过期unfinished session 会被后台清理`

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: FAIL due to missing session-level abandon/gc logic.

- [ ] **Step 3: Promote abandon from attachment-level to session-level**

在 `src/用例.rs` / `src/媒体附件适配.rs`：

1. `标记媒体上传已放弃` 改成放弃当前活跃 session
2. 旧 attachment 仍切 `abandoned`，但 transport/session 都要同步记录

- [ ] **Step 4: Extend cleanup loop**

在 `src/外壳.rs`：

1. 查询 abandoned/expired sessions
2. 删除 partial/final 临时文件
3. 回写 session / transport 删除事实

- [ ] **Step 5: Keep frontend restart behavior unchanged semantically**

在 `frontend/媒体/媒体发布.ts` 只做最小接线：

1. `restart` 继续先 `abandon`
2. 不新长第二套壳层语义

- [ ] **Step 6: Run tests to verify green**

Run:

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: PASS

- [ ] **Step 7: Commit cleanup slice**

```bash
git add src/用例.rs src/媒体附件适配.rs src/外壳.rs frontend/媒体/媒体发布.ts tests/媒体上传测试.rs tests/媒体上传测试/tus_concatenation.rs
git commit -m "补齐上传会话放弃与partial残留回收闭环"
```

## Task 7: Rustus Startup Parameters And Ops Guardrails

**Files:**
- Modify: `run.ps1`
- Modify: `tests/启动器脚本检查.ps1`
- Test: `powershell -ExecutionPolicy Bypass -File .\\tests\\启动器脚本检查.ps1`

- [ ] **Step 1: Write failing launcher test for concatenation settings**

在 `tests/启动器脚本检查.ps1` 新增断言：

1. `run.ps1` 必须显式接出 `RUSTUS_TUS_EXTENSIONS`
2. 默认值或启动示例里必须包含 `concatenation`
3. 如有 `remove-parts` 或相关能力，也必须显式记录是否启用

- [ ] **Step 2: Run launcher test to verify failure**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\启动器脚本检查.ps1
```

Expected: FAIL if concatenation is not explicitly guarded.

- [ ] **Step 3: Wire concatenation-related startup flags**

在 `run.ps1`：

1. 明确 `RUSTUS_TUS_EXTENSIONS` 的默认/推荐值
2. 保持其他现有 workers/body/file size 设定不漂移
3. 中文注释写清“为什么这个参数在当前阶段是硬门槛”

- [ ] **Step 4: Run launcher test to verify green**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\启动器脚本检查.ps1
```

Expected: PASS

- [ ] **Step 5: Commit launcher slice**

```bash
git add run.ps1 tests/启动器脚本检查.ps1
git commit -m "接通Rustus concatenation启动参数与门禁检查"
```

## Task 8: Final Verification And Graph Update

**Files:**
- Modify: `graphify-out/GRAPH_REPORT.md`
- Modify: `graphify-out/graph.json`

- [ ] **Step 1: Run focused frontend verification**

```bash
pnpm --dir frontend test -- tests/媒体发布测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: PASS

- [ ] **Step 2: Run focused Rust verification**

```bash
cargo test --test 媒体上传测试 -- --nocapture
```

Expected: PASS

- [ ] **Step 3: Run launcher verification**

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\启动器脚本检查.ps1
```

Expected: PASS

- [ ] **Step 4: Rebuild graphify because code files changed**

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` updated

- [ ] **Step 5: Review worktree**

```bash
git status --short
```

Expected: only intended code/test/graph files remain

- [ ] **Step 6: Commit final verification outputs**

```bash
git add frontend src tests run.ps1 graphify-out
git commit -m "完成Tus Concatenation大视频单文件高吞吐主链改造"
```

## Notes For Execution

- 先做表征测试，再动 schema；不要先改 migration 再补测试。
- 任何一步如果发现 Rustus hook 实际 payload 与 spec 假设不一致，立即停在 adapter 层补真实抓包说明，不要把猜测硬编码进 domain。
- `upload_session_id` 是运输生命周期锚点，不要让它变成前端 UI 主键或页面流程字段。
- 如果某一步需要 broad refactor 才能通过测试，先停下来压缩范围；这期目标是打通 Tus Concatenation 主链，不是顺手重写媒体子系统。
- 由于当前未授权子代理，本计划默认给主线程或未来显式授权的执行器使用；没有授权前，不派 reviewer/worker 子代理。
