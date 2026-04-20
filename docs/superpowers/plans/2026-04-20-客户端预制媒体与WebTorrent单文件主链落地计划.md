# 客户端预制媒体与 WebTorrent 单文件主链落地计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把媒体主链收敛成“客户端预制成品 -> 后端只收一份 canonical 文件 -> 查看器/自动播/分发都走同一份 WebTorrent payload”，并用测试锁死，不再允许后端图片三副本与视频 HLS/DASH 打包主链继续生长。

**Architecture:** 采用“先门禁、再迁移、最后删旧入口”的硬切思路。前端在 `媒体发布` 前完成图片/视频预制，失败即阻断发布；后端 complete 只做轻校验与单文件入库，不再生成多副本或流媒体分段。播放面把查看器与自动播统一到同一 canonical `content_hash/info_hash`，后端只保留 24h 初始做种窗口。

**Tech Stack:** Rust、Axum、SQLx、Vitest、Uppy + Tus、WebTorrent、WebCodecs（能力探测）、ffmpeg.wasm（兜底）、Video.js v10（壳层不变）。

---

## File Map

- Create: `tests/媒体上传测试/单文件主链.rs`
- Create: `frontend/媒体/视频预处理.ts`
- Create: `frontend/tests/视频预处理测试.spec.ts`
- Modify: `tests/媒体上传测试.rs`
- Modify: `tests/媒体上传测试/complete.rs`
- Modify: `tests/流媒体资产契约测试.rs`
- Modify: `tests/blob媒体资产契约测试.rs`
- Modify: `src/媒体内容解析.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/用例.rs`
- Modify: `src/契约.rs`
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `frontend/媒体/图片预处理.ts`
- Modify: `frontend/媒体/媒体草稿.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/聊天应用内核.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

## Constraints

- `Video.js v10` 仍是唯一播放器壳，不引入第二套播放器。
- 后端不再承担图片多副本/视频打包重活；失败不许降级回旧链路。
- 预制失败禁止发送；超过 15 分钟只提醒用户继续等待或取消，不自动放行。
- 同一附件的自动播、查看器、协作分发必须共享同一 `content_hash/info_hash`。
- 所有行为变更先写失败测试，再实现最小代码，再转绿，再提交。

### Task 1: 建立“单文件主链”失败测试门禁

**Files:**
- Create: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试.rs`
- Modify: `tests/媒体上传测试/complete.rs`
- Modify: `tests/流媒体资产契约测试.rs`
- Modify: `tests/blob媒体资产契约测试.rs`
- Create: `frontend/tests/视频预处理测试.spec.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`

- [ ] **Step 1: 先写 Rust 失败测试，锁死后端目标行为**

```rust
#[tokio::test]
#[serial]
async fn 图片complete后只保留一份canonical对象() {
    let complete = 执行图片complete().await;
    assert_eq!(complete["media_asset"]["kind"], "blob_image");
    assert!(complete["media_asset"]["variants"]["canonical"].is_object());
    assert!(complete["media_asset"]["variants"]["preview"].is_null());
    assert!(complete["media_asset"]["variants"]["full"].is_null());
    assert!(complete["media_asset"]["variants"]["original"].is_null());
}

#[tokio::test]
#[serial]
async fn 视频complete后不再返回hls_dash_manifest() {
    let complete = 执行视频complete().await;
    assert!(complete["media_asset"]["manifest"].is_null());
    assert!(complete["media_asset"]["lifecycle"]["streaming_expires_at"].is_null());
}
```

- [ ] **Step 2: 写前端失败测试，锁死“预制失败不可发”和“15分钟提醒”**

```ts
it("视频预制失败时不会触发 prepareMediaUpload", async () => {
  const 场景 = 创建场景({ preprocessVideo: vi.fn().mockRejectedValue(new Error("unsupported")) });
  await 场景.发布器.处理选择媒体文件([创建视频文件("bad.mov")]);
  expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
});

it("预制超过15分钟仅进入提醒态，不自动发送半成品", async () => {
  const 场景 = 创建场景({ preprocessVideo: 永不resolve的预处理Promise });
  await 场景.发布器.处理选择媒体文件([创建视频文件("long.mp4")]);
  await 推进到15分钟();
  expect(场景.草稿状态("long.mp4")?.status).toBe("processing");
  expect(场景.草稿状态("long.mp4")?.errorCode).toBe("media_preprocess_waiting");
});
```

- [ ] **Step 3: 运行失败测试并确认是“按预期失败”**

Run: `cargo test --test 媒体上传测试 单文件主链 -- --nocapture`  
Expected: FAIL，当前实现仍返回多变体/流媒体清单。

Run: `pnpm --dir frontend test -- tests/视频预处理测试.spec.ts tests/媒体发布测试.spec.ts`  
Expected: FAIL，当前发布器还未引入视频预处理门禁。

- [ ] **Step 4: 提交失败测试基线**

```bash
git add tests/媒体上传测试.rs tests/媒体上传测试/单文件主链.rs tests/媒体上传测试/complete.rs tests/流媒体资产契约测试.rs tests/blob媒体资产契约测试.rs frontend/tests/视频预处理测试.spec.ts frontend/tests/媒体发布测试.spec.ts
git commit -m "补齐单文件主链失败测试门禁"
```

### Task 2: 后端图片改成单 canonical 文件存储

**Files:**
- Modify: `src/媒体内容解析.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/用例.rs`
- Modify: `src/契约.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/blob媒体资产契约测试.rs`

- [ ] **Step 1: 写最小实现，只产出一个图片 canonical 字节**

```rust
pub struct 图片解析结果 {
    pub canonical_webp字节: Vec<u8>,
    pub 宽度: i32,
    pub 高度: i32,
}

pub fn 解析图片内容(input: &[u8]) -> Result<图片解析结果, 媒体内容解析错误> {
    // 高清优先：默认不缩放，仅编码成 high-quality webp
}
```

- [ ] **Step 2: complete 图片分支只写一份对象**

```rust
let canonical_storage_key = format!("images/{attachment_id}/canonical.webp");
object_store.put(&ObjectPath::from(canonical_storage_key.clone()), parsed.canonical_webp字节.into()).await?;
```

删除或旁路以下写入：
- `thumbnail_storage_key`
- `full_storage_key`
- `asset_original_storage_key`

- [ ] **Step 3: 统一查询/响应改为 canonical 视图**

```rust
// 查询层只返回 canonical key
pub struct 附件可读内容 {
    pub canonical存储键: Option<String>,
    pub mime_type: Option<String>,
}
```

```rust
// 响应层仅暴露 canonical 变体
"variants": { "canonical": { ... } }
```

- [ ] **Step 4: 运行 Rust 测试转绿**

Run: `cargo test --test 媒体上传测试 单文件主链 -- --nocapture`  
Expected: PASS

Run: `cargo test --test blob媒体资产契约测试 -- --nocapture`  
Expected: PASS

- [ ] **Step 5: 提交图片单文件改动**

```bash
git add src/媒体内容解析.rs src/媒体上传外壳.rs src/媒体附件适配.rs src/媒体资产外壳.rs src/用例.rs src/契约.rs tests/媒体上传测试/单文件主链.rs tests/blob媒体资产契约测试.rs
git commit -m "图片上传主链收敛为单canonical文件"
```

### Task 3: 后端视频移除 HLS/DASH 打包主链，只保留单 canonical 视频

**Files:**
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/媒体资产外壳.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/契约.rs`
- Modify: `tests/媒体上传测试/complete.rs`
- Modify: `tests/流媒体资产契约测试.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`

- [ ] **Step 1: 视频 complete 只保留单 canonical 文件写入**

```rust
let canonical_video_key = format!("videos/{attachment_id}/canonical.mp4");
object_store.put(&ObjectPath::from(canonical_video_key.clone()), canonical_bytes.into()).await?;
```

- [ ] **Step 2: 明确旁路旧流媒体打包入口**

删除/禁用这条主链：
- `流媒体打包::生成流媒体打包产物`
- `流媒体打包::上传流媒体打包产物`
- `写入流媒体清单元数据`

- [ ] **Step 3: 契约与响应改成“单文件视频资产”**

```rust
pub enum 媒体资产种类 {
    图片Blob,
    单文件视频,
}
```

```rust
// 视频响应不再给 manifest/lifecycle.streaming_*
"media_asset": {
  "kind": "file_video",
  "variants": { "canonical": { ... } },
  "manifest": null,
  "lifecycle": null
}
```

- [ ] **Step 4: 跑后端测试**

Run: `cargo test --test 媒体上传测试 complete_tests::视频* -- --nocapture`  
Expected: PASS

Run: `cargo test --test 流媒体资产契约测试 -- --nocapture`  
Expected: PASS（已更新为“无 manifest 主链”语义）

- [ ] **Step 5: 提交视频单文件改动**

```bash
git add src/媒体上传外壳.rs src/媒体资产外壳.rs src/媒体附件适配.rs src/契约.rs tests/媒体上传测试/complete.rs tests/流媒体资产契约测试.rs tests/媒体上传测试/单文件主链.rs
git commit -m "视频complete主链切换为单canonical文件并移除流媒体打包依赖"
```

### Task 4: 前端落地视频预处理（能力探测 + fallback）并接入发布门禁

**Files:**
- Create: `frontend/媒体/视频预处理.ts`
- Modify: `frontend/媒体/媒体发布.ts`
- Modify: `frontend/媒体/视频元数据.ts`
- Modify: `frontend/媒体/媒体草稿.ts`
- Modify: `frontend/tests/视频预处理测试.spec.ts`
- Modify: `frontend/tests/媒体发布测试.spec.ts`

- [ ] **Step 1: 写 `视频预处理` 模块（不把逻辑塞进发布器）**

```ts
export async function 预处理待上传视频文件(file: File, deps: 视频预处理依赖): Promise<预处理结果> {
  if (await deps.可直通(file)) return { file, strategy: "passthrough" };
  if (await deps.WebCodecs可用()) return await deps.使用WebCodecs预处理(file);
  return await deps.使用FfmpegWasm预处理(file); // 兜底
}
```

- [ ] **Step 2: `媒体发布.ts` 在 `prepareMediaUpload` 之前强制执行预处理**

```ts
if (kind === "video") {
  const processed = await 预处理待上传视频文件(sourceFile, 依赖);
  preparedFile = processed.file;
}
```

失败路径要求：
- 预处理异常 -> 草稿 `failed/media_preprocess_failed`。
- 超过 15 分钟 -> 草稿保留 `processing/media_preprocess_waiting`，不调用 prepare。

- [ ] **Step 3: 跑前端测试**

Run: `pnpm --dir frontend test -- tests/视频预处理测试.spec.ts tests/媒体发布测试.spec.ts`  
Expected: PASS

Run: `pnpm --dir frontend typecheck`  
Expected: PASS

- [ ] **Step 4: 提交前端预处理门禁**

```bash
git add frontend/媒体/视频预处理.ts frontend/媒体/媒体发布.ts frontend/媒体/视频元数据.ts frontend/媒体/媒体草稿.ts frontend/tests/视频预处理测试.spec.ts frontend/tests/媒体发布测试.spec.ts
git commit -m "前端接入视频预处理门禁并阻断失败发布"
```

### Task 5: 播放链统一为单文件 WebTorrent 真相（查看器 + 自动播）

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体查看器.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/房间消息窗.ts`
- Modify: `frontend/聊天应用内核.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Modify: `frontend/tests/媒体查看器测试.spec.ts`
- Modify: `frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- Modify: `frontend/tests/聊天应用内核测试.spec.ts`

- [ ] **Step 1: 先写失败测试，锁死“自动播和查看器必须同源”**

```ts
it("同一附件在inline_autoplay与viewer使用同一content_hash", async () => {
  const auto = await 解析自动播结果("att-1");
  const view = await 解析查看器结果("att-1");
  expect(auto.contentHash).toBe(view.contentHash);
});
```

- [ ] **Step 2: 实现统一来源裁决**

```ts
// 优先协作分发单文件
const swarm = await 尝试协作分发单文件(locator);
if (swarm) return swarm;
// 再回退 canonical anchor（同一对象）
return 读取canonical锚点(locator);
```

禁止：
- 自动播继续走独立 manifest 分支。
- 查看器单独生成第二套 payload 标识。

- [ ] **Step 3: 跑前端播放相关测试**

Run: `pnpm --dir frontend test -- tests/媒体播放测试.spec.ts tests/媒体查看器测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天应用内核测试.spec.ts`  
Expected: PASS

- [ ] **Step 4: 提交统一播放主链**

```bash
git add frontend/媒体/媒体播放.ts frontend/媒体/媒体查看器.ts frontend/媒体/资产协作分发运行时.ts frontend/房间消息窗.ts frontend/聊天应用内核.ts frontend/tests/媒体播放测试.spec.ts frontend/tests/媒体查看器测试.spec.ts frontend/tests/房间消息窗媒体查看器测试.spec.ts frontend/tests/聊天应用内核测试.spec.ts
git commit -m "查看器与自动播统一到单文件WebTorrent播放真相"
```

### Task 6: 全链路验证、冒烟与收尾

**Files:**
- Modify: `docs/superpowers/plans/2026-04-20-客户端预制媒体与WebTorrent单文件主链落地计划.md`

- [ ] **Step 1: 跑后端关键测试**

Run: `cargo test --test 媒体上传测试 -- --nocapture`  
Expected: PASS

Run: `cargo test --test blob媒体资产契约测试 -- --nocapture`  
Expected: PASS

- [ ] **Step 2: 跑前端关键测试与类型检查**

Run: `pnpm --dir frontend test -- tests/媒体发布测试.spec.ts tests/视频预处理测试.spec.ts tests/媒体播放测试.spec.ts tests/媒体查看器测试.spec.ts tests/房间消息窗媒体查看器测试.spec.ts tests/聊天应用内核测试.spec.ts`  
Expected: PASS

Run: `pnpm --dir frontend typecheck`  
Expected: PASS

- [ ] **Step 3: HTTPS 冒烟（真实链路）**

Run: `.\run.ps1`  
Manual Checks:
1. 上传图片/视频后，草稿先 `processing`，成功后才 `ready`。
2. 预处理失败的视频不会进入群聊。
3. 查看器和消息流自动播都能播放同一附件，并共享同一 WebTorrent 内容标识。
4. 断开服务端冷源后，已有 peer 仍可继续互助分发。

- [ ] **Step 4: 复核工作树并提交**

Run: `git status --short`  
Expected: 无无关格式化噪音。

```bash
git add docs/superpowers/plans/2026-04-20-客户端预制媒体与WebTorrent单文件主链落地计划.md
git commit -m "整理客户端预制媒体与WebTorrent单文件主链落地计划"
```

