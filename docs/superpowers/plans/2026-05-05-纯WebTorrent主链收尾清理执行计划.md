# 纯 WebTorrent 主链收尾清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把新附件正式媒体字节彻底收口到唯一 WebTorrent 主链，删掉视频 `anchor/origin` 正式回退、把图片 `blob/canonical` 降成 legacy 面，并清理 streaming manifest 历史残留。

**Architecture:** 这次改动不碰 `domain/application` 的业务真相，主刀落在 `contract / adapter / shell`。后端继续拥有 `complete_at / web_seed_until / availability / delete` 真相，前端只消费唯一 swarm source；所有 HTTP `content/blob/origin` 地址要么退出新附件正式面，要么明确降成 legacy/迁移壳。

**Tech Stack:** Rust, Axum, SQLx, TypeScript, Vitest, Playwright CLI, browser-trace, WebTorrent, Service Worker

---

## Scope And Non-Goals

- 只收口**新上传附件**的正式播放/查看主链。
- legacy 历史附件允许短期保留兼容读取面，但必须被明确隔离，不能再被新附件正式链路消费。
- 不在本轮顺手改消息、房间、身份等无关 bounded context。
- 不把“暂时不消费”伪装成“已经清理完成”；没有删掉或隔离完成的残留，必须继续留在 plan 和门禁里。

## File Map

### Backend

- Modify: `src/媒体/资产/响应投影.rs`
  - 收口新视频 `file_asset.canonical` 投影，禁止继续指向 `/api/attachments/{attachment}/content?...`
- Modify: `src/媒体/资产/外壳.rs`
  - 收口 `load_media_locator`、`load_blob_asset_content`、`load_attachment_content` 的正式/legacy 边界
- Modify: `src/媒体/协作分发/适配.rs`
  - 隔离或删除 `attachment_streaming_manifests` 相关新主链残留
- Modify: `src/外壳/mod.rs`
  - 如有必要，调整 legacy 路由暴露边界

### Frontend

- Modify: `frontend/聊天共享/契约.ts`
  - 把“正式主链”和“legacy 冷源描述”语义再钉死
- Modify: `frontend/媒体/媒体播放.ts`
  - 删除新视频 `anchor` 正式回退；收紧新图片正式读取
- Modify: `frontend/媒体/媒体协作分发.ts`
  - 删除对 `origin/canonical/blob` 的第二读取面依赖
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
  - 调整 locator/asset 解析，避免继续默认生成第二正式读取面
- Modify: `frontend/平台/传输.ts`
  - 收口 `buildAttachmentContentUrl(...)` 的消费边界
- Modify: `frontend/媒体/壳层/快照投影协作.ts`
  - 删除新附件 `originalSrc / thumbnailSrc / posterSrc` 正式消费
- Modify: `frontend/房间消息窗/视图.ts`
  - 删除旧 fallback 字符串和新附件正式字节入口依赖
- Modify: `frontend/media-sw.ts`
  - 图片 blob 缓存面降级为 legacy-only 或直接移除

### Tests

- Modify: `frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts`
- Modify: `frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/传输媒体定位与地址收口测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `frontend/tests/房间消息窗/*`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试/complete_视频与类型守卫.rs`
- Modify: `tests/协作分发测试/*`
- Modify: `tests/媒体后台测试/冷源清理.rs`
- Modify: `tests/测试支撑/媒体/seed.rs`
- Modify: `tests/启动与迁移测试.rs`

---

### Task 1: 先把“禁止第二主链”的测试写死

**Files:**
- Modify: `frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts`
- Modify: `frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/传输媒体定位与地址收口测试.spec.ts`
- Modify: `tests/媒体上传测试/单文件主链.rs`

- [ ] **Step 1: 为新视频写失败测试，要求 locator 不再把 canonical 指向受控 HTTP 内容地址**

```ts
expect(locator.file_asset?.variants.canonical?.url).toBeNull();
```

- [ ] **Step 2: 为新视频写失败测试，要求播放器不再返回 `mode: "anchor"`**

```ts
expect(result.mode).toBe("degraded");
expect(result.reason).toBe("anchor_unavailable");
```

- [ ] **Step 3: 为新图片写失败测试，要求正式显示优先走 swarm，不再把 `blob/canonical` 当正式主链**

```ts
expect(result).toMatchObject({
  mode: "swarm",
  formalByteSource: "webtorrent_official_stream",
});
```

- [ ] **Step 4: 为 transport 写失败测试，要求新附件 locator 不再把 `/api/attachments/.../content` 绝对化成正式视频 canonical**

Run: `pnpm --dir frontend test -- frontend/tests/传输媒体定位与地址收口测试.spec.ts`
Expected: FAIL，仍能看到 `content?variant=original` 断言或 fixture 不匹配

- [ ] **Step 5: 跑前端定向测试，确认当前确实先红**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/blob媒体资产测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts`
Expected: FAIL，失败点集中在 `anchor/blob canonical/content` 旧口径

- [ ] **Step 6: 跑后端定向测试，确认新视频 canonical 投影旧口径先红**

Run: `cargo test --test 媒体上传测试 单文件主链 -- --nocapture`
Expected: FAIL，仍断言/产出 `/api/attachments/.../content`

- [ ] **Step 7: 提交测试先红基线**

```bash
git add frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/blob媒体资产测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts tests/媒体上传测试/单文件主链.rs
git commit -m "测试: 钉死纯WebTorrent主链收尾红线"
```

### Task 2: 收掉新视频 `anchor/origin` 正式回退

**Files:**
- Modify: `frontend/聊天共享/契约.ts`
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `src/媒体/资产/响应投影.rs`
- Modify: `src/媒体/资产/外壳.rs`

- [ ] **Step 1: 调整共享契约，明确新视频正式资产不再依赖 HTTP canonical/origin 字节地址**

```ts
export interface 单文件视频资产描述 {
  asset_id: string;
  content_hash: string;
  kind: "file_video";
  variants: {
    canonical: null;
  };
  distribution: 媒体资产分发表面;
  origin: 媒体冷源描述;
}
```

- [ ] **Step 2: 调整后端响应投影，让新视频 `file_asset.canonical` 不再回填受控 HTTP 地址；`origin` 只保留冷备元数据，不再被正式播放链消费**

```rust
"variants": {
    "canonical": serde_json::Value::Null,
},
"origin": 媒体冷源描述转响应体(...)
```

- [ ] **Step 3: 调整 `load_media_locator`，不要再把 `原始地址` 当作新视频正式 canonical 输入**

Run: `cargo test --test 媒体上传测试 complete_视频与类型守卫 -- --nocapture`
Expected: PASS，新视频 locator 仍完整，但不再把 `content` 地址投进正式视频 asset

- [ ] **Step 4: 调整前端 `媒体播放.ts`，让视频路径彻底不再走 `尝试锚点(...)`**

```ts
if (input.kind === "video") {
  释放协作分发占用(input);
  return 创建降级结果(input, locator, "anchor_unavailable");
}
```

- [ ] **Step 5: 调整 `媒体协作分发.ts` 与 HTTP adapter，删掉对视频 `origin/canonical` 回读**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
Expected: PASS，视频只剩 swarm 或 degraded

- [ ] **Step 6: 运行视频主链相关前后端测试**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts`
Expected: PASS

Run: `cargo test --test 媒体上传测试 -- --nocapture`
Expected: PASS

- [ ] **Step 7: 提交视频主链收口**

```bash
git add frontend/聊天共享/契约.ts frontend/媒体/媒体播放.ts frontend/媒体/媒体协作分发.ts frontend/媒体/适配/媒体HTTP接口.ts src/媒体/资产/响应投影.rs src/媒体/资产/外壳.rs
git commit -m "重构: 收掉新视频anchor回退并只保留WebTorrent主链"
```

### Task 3: 把新图片正式主链从 `blob/canonical` 拉回 WebTorrent

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/media-sw.ts`
- Modify: `frontend/平台/传输.ts`
- Modify: `frontend/媒体/壳层/快照投影协作.ts`
- Modify: `frontend/房间消息窗/视图.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `frontend/tests/传输媒体定位与地址收口测试.spec.ts`

- [ ] **Step 1: 为新图片把 `blob/canonical` 从正式播放结果中降级，保留为 legacy-only**

```ts
const 读取图片Blob主链 = () => null;
```

- [ ] **Step 2: 把房间消息窗/快照投影里的 `originalSrc / thumbnailSrc / posterSrc` 改成只服务 legacy 或 preview UI**

```ts
const 正式媒体源 = null;
const previewSrc = legacyOnly ? originalSrc : null;
```

- [ ] **Step 3: 调整 `buildAttachmentContentUrl(...)` 的消费边界，不再让新附件正式读取依赖它**

Run: `pnpm --dir frontend test -- frontend/tests/传输媒体定位与地址收口测试.spec.ts frontend/tests/blob媒体资产测试.spec.ts`
Expected: PASS，新图片主链只认 swarm 或稳定占位

- [ ] **Step 4: 调整 `media-sw.ts`，图片 blob 缓存面只保留给 legacy 显式路径，或直接删除**

Run: `pnpm --dir frontend test -- frontend/tests/媒体服务工作线程测试.spec.ts`
Expected: PASS，service worker 不再把新图片 blob canonical 当正式主链缓存

- [ ] **Step 5: 跑图片相关前端测试**

Run: `pnpm --dir frontend test -- frontend/tests/blob媒体资产测试.spec.ts frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts frontend/tests/媒体服务工作线程测试.spec.ts`
Expected: PASS

- [ ] **Step 6: 提交图片主链收口**

```bash
git add frontend/媒体/媒体播放.ts frontend/media-sw.ts frontend/平台/传输.ts frontend/媒体/壳层/快照投影协作.ts frontend/房间消息窗/视图.ts
git commit -m "重构: 收掉新图片blob canonical正式主链"
```

### Task 4: 清掉房间消息窗和传输层的第二入口垃圾

**Files:**
- Modify: `frontend/房间消息窗/视图.ts`
- Modify: `frontend/媒体/壳层/快照投影协作.ts`
- Modify: `frontend/平台/传输.ts`
- Modify: `frontend/tests/房间消息窗/*`

- [ ] **Step 1: 删除 `读取附件内容地址()` 里的旧 fallback 字符串**

```ts
return attachmentContentAddressMap.get(key) ?? null;
```

- [ ] **Step 2: 调整消息窗测试，要求新附件缺少正式 swarm source 时显示 degraded/占位，而不是偷偷补 HTTP 地址**

Run: `pnpm --dir frontend test -- frontend/tests/房间消息窗`
Expected: 先红后绿

- [ ] **Step 3: 跑传输与消息窗相关测试**

Run: `pnpm --dir frontend test -- frontend/tests/传输媒体定位与地址收口测试.spec.ts frontend/tests/房间消息窗`
Expected: PASS

- [ ] **Step 4: 提交第二入口清理**

```bash
git add frontend/房间消息窗/视图.ts frontend/媒体/壳层/快照投影协作.ts frontend/平台/传输.ts frontend/tests/房间消息窗
git commit -m "清理: 删除消息窗与传输层第二媒体入口"
```

### Task 5: 删除或隔离 streaming manifest 历史残留

**Files:**
- Modify: `src/媒体/协作分发/适配.rs`
- Modify: `tests/媒体后台测试/冷源清理.rs`
- Modify: `tests/协作分发测试/*`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试/complete_视频与类型守卫.rs`
- Modify: `tests/测试支撑/媒体/seed.rs`
- Modify: `tests/启动与迁移测试.rs`
- Modify: `migrations/0001_当前数据库基线.sql`

- [ ] **Step 1: 写失败测试，要求新主链路径不再依赖 `attachment_streaming_manifests`**

```rust
assert!(!tables.contains(&"attachment_streaming_manifests".to_string()));
```

- [ ] **Step 2: 先从新主链 owner 删除读写，再把测试支撑迁到 legacy/显式兼容面或彻底删掉**

Run: `cargo test --test 媒体上传测试 -- --nocapture`
Expected: 先红，表现为 manifest 相关断言/fixture 失配

- [ ] **Step 3: 更新迁移基线和启动测试，确保 schema 真删掉或已被明确隔离**

Run: `cargo test --test 启动与迁移测试 -- --nocapture`
Expected: PASS

- [ ] **Step 4: 运行后端媒体与后台相关回归**

Run: `cargo test --test 协作分发测试 -- --nocapture`
Expected: PASS

Run: `cargo test --test 媒体后台测试 -- --nocapture`
Expected: PASS

- [ ] **Step 5: 提交 manifest 残留清理**

```bash
git add src/媒体/协作分发/适配.rs tests/媒体后台测试/冷源清理.rs tests/协作分发测试 tests/媒体上传测试 tests/测试支撑/媒体/seed.rs tests/启动与迁移测试.rs migrations/0001_当前数据库基线.sql
git commit -m "清理: 删除新主链streaming manifest历史残留"
```

### Task 6: 全链路验证与真实烟测

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- Modify if needed: `graphify-out/*` via `graphify update .`

- [ ] **Step 1: 运行前端全量测试、类型检查、构建**

Run: `pnpm --dir frontend test`
Expected: PASS

Run: `pnpm --dir frontend typecheck`
Expected: PASS

Run: `pnpm --dir frontend build`
Expected: PASS

- [ ] **Step 2: 运行后端全量测试**

Run: `cargo test -j 1`
Expected: PASS

- [ ] **Step 3: 更新知识图**

Run: `graphify update .`
Expected: PASS，无新主链 owner 继续指向 `anchor/blob canonical/manifest`

- [ ] **Step 4: 跑真实浏览器烟测**

Run:

```powershell
pwsh -File run.ps1
```

然后用 `playwright-cli` + `browser-trace` 做以下烟测：

- 房间：`1234b`
- 会话：`sender / A / B / C / D`
- 新视频：验证时间线、查看器、全屏都命中 `/webtorrent/...`
- 新图片：验证正式显示来自 WebTorrent 主链或稳定占位，不再读取 `blob/canonical`
- 后 `24 小时`：验证无在线种子/删除态说真话

- [ ] **Step 5: 清理启动残留并确认工作树干净**

Run:

```powershell
git status --short
```

Expected: 空

- [ ] **Step 6: 提交最终验证与文档收口**

```bash
git add -A
git commit -m "验证: 收口纯WebTorrent主链并完成全链路烟测"
```

---

## Done When

- 新视频正式播放链不再出现 `mode = "anchor"`。
- 新视频 `file_asset.canonical.url` 不再回指 `/api/attachments/{attachment}/content?...`。
- 新图片正式显示不再依赖 `/api/media/{attachment}/blob/canonical` 或 `media-sw.ts` blob 缓存面。
- `originalSrc / thumbnailSrc / posterSrc` 不再作为新附件正式字节入口。
- `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key` 不再挂在新主链 owner 上。
- 前后端测试、构建、`graphify update .`、真实浏览器烟测全部通过。
