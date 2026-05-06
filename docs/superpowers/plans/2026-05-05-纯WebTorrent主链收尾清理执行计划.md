# 纯 WebTorrent 主链最终收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入新 bug、不破坏现有业务的前提下，把新附件正式媒体字节彻底收口到唯一 WebTorrent 主链，并用新的 `1234b` 真实烟测证明收尾完成。

**Architecture:** 本轮只动 `contract / adapter / shell / migration / test`。后端继续拥有 `complete_at / web_seed_until / availability / delete` 这些权威事实，前端继续只围绕唯一 swarm source 组织正式播放和正式查看；任何 HTTP `origin / canonical / blob` 地址，若继续存在，只能是显式 legacy/迁移面，不能再被新附件正式消费者吃进去。

**Tech Stack:** Rust, Axum, SQLx, TypeScript, Vitest, Playwright CLI, browser-trace, WebTorrent, Service Worker

---

## Reality Check

先把当前真相写死，避免 plan 继续追已经清掉的假残留。

### 已经完成，不再当剩余 blocker

- `frontend/媒体/媒体协作分发.ts` 现在只读 `distribution.web_seed_url`，不再混 `origin.original_url / canonical.url`。
- `migrations/0001_当前数据库基线.sql` 已经不再声明 `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key`。
- `migrations/0002_删除streaming_manifest历史残留.sql` 已存在，`tests/启动与迁移测试.rs` 也已经钉死这组表不应出现在基线真相里。
- `frontend/media-sw.ts` 已经明确不再接管 `/api/media/.../blob/canonical` 作为第二正式缓存链。
- `originalSrc` 生产字段、空 `thumbnailSrc`、伪“contentUrl”命名、`mode: "anchor"` 伪正式语义，已经分别收口成当前状态。

### 当前真正还剩的 2 道门

1. **剩余 legacy 行为面收口**
   - `frontend/媒体/媒体播放.ts` 仍保留 `legacy_anchor`、`读取锚点地址(...)`、`anchor_unavailable`
   - `frontend/媒体/适配/媒体HTTP接口.ts` 仍保留 `variants.canonical` / `origin.original_url` 的 legacy 解析面
   - `src/媒体/资产/外壳.rs` 仍暴露 `/api/media/{attachment}/blob/canonical`
   - 一大批前端测试夹具和断言仍把 `legacy_anchor` 当现状

2. **新鲜验证和真实烟测闭环**
   - 前后端全量测试
   - `graphify update .`
   - 房间 `1234b` 的 sender / viewer 真实多媒体烟测

## Scope And Non-Goals

- 只收口**新上传附件**的正式播放/正式查看主链。
- legacy 附件允许短期保留显式隔离读取面，但必须不能被新附件正式路径消费。
- 不扩大到身份、房间、权限、消息治理等无关 bounded context。
- 不再把已经解决的 manifest 基线残留重新当成剩余任务；本轮只保留“继续验证它没有回归”。

## File Map

### Formal-vs-legacy split

- Modify: `frontend/媒体/媒体播放.ts`
  - 收掉新附件 `legacy_anchor` 正式消费路径
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
  - 隔离 `variants.canonical / origin.original_url` 的 legacy 解析面
- Modify: `frontend/聊天共享/契约.ts`
  - 如有必要，补清晰语义：正式分发表面 vs legacy 冷源描述
- Modify: `src/媒体/资产/响应投影.rs`
  - 如后端响应体仍把新视频 canonical/origin 暴露成正式可消费入口，这里要继续收口
- Modify: `src/媒体/资产/外壳.rs`
  - 保留或收窄 `/api/media/{attachment}/blob/canonical` 的 legacy 暴露边界

### Presenter / preview / room-shell surfaces

- Modify: `frontend/媒体/壳层/快照投影协作.ts`
- Modify: `frontend/房间消息窗/视图.ts`
- Modify: `frontend/房间消息窗/附件渲染.ts`
- Modify: `frontend/房间消息窗/视频附件渲染.ts`
- Modify: `frontend/房间消息窗/时间线媒体基类.ts`
  - 这些地方只能继续保留 preview/poster/legacy 元数据，不能脑补正式字节入口

### Tests

- Modify: `frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts`
- Modify: `frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/传输媒体定位与地址收口测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `frontend/tests/媒体会话测试.spec.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Modify: `frontend/tests/房间消息窗/*`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试/complete_视频与类型守卫.rs`
- Modify: `tests/媒体上传测试/complete_图片与回执竞争.rs`
- Modify: `tests/启动与迁移测试.rs`

### Verification-only guards

- Check only: `migrations/0001_当前数据库基线.sql`
- Check only: `migrations/0002_删除streaming_manifest历史残留.sql`
- Check only: `tests/启动器脚本检查.ps1`
- Check only: `qingli.ps1`

## Task 1: 先把当前剩余残留钉成会失败的测试

**Files:**
- Modify: `frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts`
- Modify: `frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/传输媒体定位与地址收口测试.spec.ts`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试/complete_图片与回执竞争.rs`

- [ ] **Step 1: 给新视频写失败测试，要求正式播放结果不再落到 `mode: "legacy_anchor"`**

```ts
expect(result.mode).not.toBe("legacy_anchor");
expect(result.mode).toBe("degraded");
```

- [ ] **Step 2: 给新视频写失败测试，要求 locator/asset 不再把正式可播放地址指向 `origin.original_url` 或 `variants.canonical.url`**

```rust
let canonical_url = file_asset["variants"]["canonical"]["url"]
    .as_str()
    .unwrap_or_default();
let origin_url = file_asset["origin"]["original_url"]
    .as_str()
    .unwrap_or_default();
assert!(
    !canonical_url.contains("/api/attachments/") && !origin_url.contains("/api/attachments/")
);
```

- [ ] **Step 3: 给新图片写失败测试，要求正式显示不再把 `/api/media/{attachment}/blob/canonical` 当正式源**

```ts
expect(formalUrl).toBeNull();
expect(result.mode).toBe("swarm");
```

- [ ] **Step 4: 给 transport/adapter 写失败测试，要求 `origin.original_url` 和 `variants.canonical` 只能进入 legacy 语义，不再自动变成正式入口**

Run: `pnpm --dir frontend test -- frontend/tests/传输媒体定位与地址收口测试.spec.ts`

Expected: FAIL，旧解析面仍把它们喂进正式播放/查看路径

- [ ] **Step 5: 跑前端定向测试，确认当前真的是先红**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/blob媒体资产测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts`

Expected: FAIL，失败点集中在 `legacy_anchor / blob canonical / origin canonical` 旧口径

- [ ] **Step 6: 跑后端定向测试，确认视频/图片合同旧口径先红**

Run: `cargo test --test 媒体上传测试 单文件主链 -- --nocapture`

Expected: FAIL，仍有新附件资产把 HTTP 地址暴露成正式入口

- [ ] **Step 7: 提交测试先红基线**

```bash
git add frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/blob媒体资产测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts tests/媒体上传测试/单文件主链.rs tests/媒体上传测试/complete_图片与回执竞争.rs
git commit -m "测试: 钉死纯WebTorrent剩余legacy残留红线"
```

## Task 2: 收掉新视频 `legacy_anchor / origin.original_url` 正式回退

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `frontend/聊天共享/契约.ts`
- Modify: `src/媒体/资产/响应投影.rs`
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Modify: `tests/媒体上传测试/complete_视频与类型守卫.rs`

- [ ] **Step 1: 先把 `读取锚点地址(...)` 拆成显式 legacy helper，不再伪装成统一播放入口**

```ts
const 读取Legacy锚点地址 = (locator: 媒体定位结果): string | null =>
  locator.file_asset?.variants.canonical?.url ??
  locator.file_asset?.origin.original_url ??
  locator.blob_asset?.variants?.canonical?.url ??
  null;
```

- [ ] **Step 2: 改 `媒体播放.ts`，让新视频路径不再返回 `legacy_anchor`**

```ts
if (input.kind === "video" && 是新附件(locator)) {
  return 创建降级结果(input, locator, "anchor_unavailable");
}
```

- [ ] **Step 3: 保留 `anchor_unavailable` 作为统一降级 reason，不把它再当成第二播放模式**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`

Expected: PASS，reason 仍可保留，但 mode 不再回到 legacy 播放

- [ ] **Step 4: 调整 adapter/contract，如果新视频 `variants.canonical / origin.original_url` 仍会被默认投进正式合同，这里继续收口**

Run: `pnpm --dir frontend test -- frontend/tests/传输媒体定位与地址收口测试.spec.ts`

Expected: PASS，新视频只剩 swarm 或 degraded

- [ ] **Step 5: 跑视频主链相关前后端测试**

Run: `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts frontend/tests/媒体会话测试.spec.ts frontend/tests/媒体运行时测试.spec.ts`

Expected: PASS

Run: `cargo test --test 媒体上传测试 complete_视频与类型守卫 -- --nocapture`

Expected: PASS

- [ ] **Step 6: 提交视频正式回退收口**

```bash
git add frontend/媒体/媒体播放.ts frontend/媒体/适配/媒体HTTP接口.ts frontend/聊天共享/契约.ts src/媒体/资产/响应投影.rs tests/媒体上传测试/单文件主链.rs tests/媒体上传测试/complete_视频与类型守卫.rs
git commit -m "重构: 收掉新视频legacy锚点正式回退"
```

## Task 3: 把新图片正式面和 `blob/canonical` 彻底隔开

**Files:**
- Modify: `frontend/媒体/媒体播放.ts`
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `frontend/媒体/壳层/快照投影协作.ts`
- Modify: `frontend/房间消息窗/视图.ts`
- Modify: `src/媒体/资产/外壳.rs`
- Modify: `frontend/tests/blob媒体资产测试.spec.ts`
- Modify: `frontend/tests/媒体服务工作线程测试.spec.ts`
- Modify: `tests/媒体上传测试/complete_图片与回执竞争.rs`

- [ ] **Step 1: 给新图片路径加显式判断，正式显示只认 swarm 或稳定占位，不再退回 `blob/canonical`**

```ts
const swarmPlayback = await 尝试协作分发主链(input, locator);
if (swarmPlayback) {
  return swarmPlayback;
}
if (input.kind === "image" && 是新附件(locator)) {
  return 创建稳定占位结果(input, locator);
}
```

- [ ] **Step 2: 保留 `/api/media/{attachment}/blob/canonical`，但把它明确限定成 legacy/迁移读取面**

```rust
if snapshot.distribution.is_some() {
    return Err(err_resp(
        StatusCode::GONE,
        "legacy_surface_only",
        "新附件正式图片已切到 WebTorrent 主链，blob canonical 仅保留给 legacy/迁移读取面",
    ));
}
```

- [ ] **Step 3: 调整 presenter/快照投影，`originalSrc / thumbnailSrc / posterSrc` 只剩 preview 或 legacy 含义**

Run: `pnpm --dir frontend test -- frontend/tests/blob媒体资产测试.spec.ts frontend/tests/房间消息窗`

Expected: PASS，消息窗不再把这些字段当正式字节入口

- [ ] **Step 4: 验证 service worker 不再把新图片 blob canonical 当正式缓存面**

Run: `pnpm --dir frontend test -- frontend/tests/媒体服务工作线程测试.spec.ts`

Expected: PASS

- [ ] **Step 5: 跑图片相关前后端定向测试**

Run: `pnpm --dir frontend test -- frontend/tests/blob媒体资产测试.spec.ts frontend/tests/媒体服务工作线程测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts frontend/tests/房间消息窗`

Expected: PASS

Run: `cargo test --test 媒体上传测试 complete_图片与回执竞争 -- --nocapture`

Expected: PASS

- [ ] **Step 6: 提交图片正式面收口**

```bash
git add frontend/媒体/媒体播放.ts frontend/媒体/适配/媒体HTTP接口.ts frontend/媒体/壳层/快照投影协作.ts frontend/房间消息窗/视图.ts src/媒体/资产/外壳.rs frontend/tests/blob媒体资产测试.spec.ts frontend/tests/媒体服务工作线程测试.spec.ts tests/媒体上传测试/complete_图片与回执竞争.rs
git commit -m "重构: 隔离新图片blob canonical正式消费"
```

## Task 4: 把测试夹具和壳层旧假设同步收干净

**Files:**
- Modify: `frontend/tests/媒体会话测试.spec.ts`
- Modify: `frontend/tests/媒体运行时测试.spec.ts`
- Modify: `frontend/tests/common/聊天媒体编排支架.ts`
- Modify: `frontend/tests/房间消息窗/*`
- Modify: `frontend/tests/聊天壳/*`
- Modify: `frontend/tests/聊天应用内核/*`

- [ ] **Step 1: 先清掉“新附件默认会得到 `legacy_anchor`”这类夹具默认值**

```ts
mode: "degraded"
```

- [ ] **Step 2: 仅给 legacy 专项用例保留显式 legacy fixture，不再让普通播放/查看测试共享它**

```ts
const legacyOnlyPlayback = {
  mode: "legacy_anchor" as const,
  attachmentId: "att-legacy-video-1",
  kind: "video" as const,
  src: "https://legacy.example/media.mp4",
  thumbnailUrl: null,
  hint: null,
};
```

- [ ] **Step 3: 跑媒体会话/运行时/消息窗相关回归**

Run: `pnpm --dir frontend test -- frontend/tests/媒体会话测试.spec.ts frontend/tests/媒体运行时测试.spec.ts frontend/tests/房间消息窗`

Expected: PASS

- [ ] **Step 4: 提交测试夹具与壳层旧假设清理**

```bash
git add frontend/tests/媒体会话测试.spec.ts frontend/tests/媒体运行时测试.spec.ts frontend/tests/common/聊天媒体编排支架.ts frontend/tests/房间消息窗 frontend/tests/聊天壳 frontend/tests/聊天应用内核
git commit -m "测试: 收掉新附件默认legacy锚点假设"
```

## Task 5: 只验证，不重开已经完成的 manifest 基线工作

**Files:**
- Check only: `migrations/0001_当前数据库基线.sql`
- Check only: `migrations/0002_删除streaming_manifest历史残留.sql`
- Check only: `tests/启动与迁移测试.rs`
- Check only: `tests/启动器脚本检查.ps1`
- Check only: `qingli.ps1`

- [ ] **Step 1: 确认基线文件仍不包含 `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key`**

Run: `rg -n "attachment_streaming_manifests|hls_master_storage_key|dash_mpd_storage_key" migrations/0001_当前数据库基线.sql`

Expected: no matches

- [ ] **Step 2: 跑启动与迁移测试，确认已经完成的 manifest 清理没有回归**

Run: `cargo test --test 启动与迁移测试 -- --nocapture`

Expected: PASS

- [ ] **Step 3: 跑脚本边界守卫**

Run: `pwsh -File tests/启动器脚本检查.ps1`

Expected: PASS

Run: `pwsh -File qingli.ps1 -Apply -Force`

Expected: PASS

## Task 6: 全量验证与 `1234b` 真实烟测闭环

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- Modify if needed: `graphify-out/*` via `graphify update .`

- [ ] **Step 1: 跑前端全量测试**

Run: `pnpm --dir frontend test`

Expected: PASS

- [ ] **Step 2: 跑前端类型检查与构建**

Run: `pnpm --dir frontend typecheck`

Expected: PASS

Run: `pnpm --dir frontend build`

Expected: PASS

- [ ] **Step 3: 跑后端全量测试**

Run: `cargo test -j 1`

Expected: PASS

- [ ] **Step 4: 更新 graph**

Run: `graphify update .`

Expected: PASS

- [ ] **Step 5: 启服务并做真实浏览器烟测**

Run:

```powershell
pwsh -File run.ps1
```

然后用 `playwright-cli` + `browser-trace` 做以下验证：

- 房间：`1234b`
- 会话：至少 `sender / viewer`
- 新视频：
  - 时间线自动播命中 `/webtorrent/...`
  - 查看器继续命中 `/webtorrent/...`
  - 不出现 `legacy_anchor` 正式消费
- 新图片：
  - 正式显示不请求 `/api/media/{attachment}/blob/canonical`
  - 如尚未具备可解码字节，只出现稳定占位，不偷偷走 HTTP 第二主链
- 回归面：
  - 进房正常
  - 发送图片/视频正常
  - 查看器/全屏不回归

- [ ] **Step 6: 结束前确认工作树干净并提交最终验证**

Run: `git status --short`

Expected: empty

```bash
git add -A
git commit -m "验证: 完成纯WebTorrent最终收尾并通过1234b烟测"
```

## Done When

- 新视频正式播放结果不再出现 `mode = "legacy_anchor"`。
- 新视频正式播放不再把 `origin.original_url / variants.canonical.url` 当可消费正式字节入口。
- 新图片正式显示不再依赖 `/api/media/{attachment}/blob/canonical`。
- `originalSrc / thumbnailSrc / posterSrc` 在新附件生产代码里只剩 preview 或 legacy 语义。
- `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key` 继续保持已完成退场状态，没有回归进基线和脚本。
- `pnpm --dir frontend test`、`pnpm --dir frontend typecheck`、`pnpm --dir frontend build`、`cargo test -j 1`、`graphify update .`、`pwsh -File tests/启动器脚本检查.ps1`、`pwsh -File qingli.ps1 -Apply -Force` 全部通过。
- `1234b` 真实烟测继续证明：新视频正式源命中 `/webtorrent/...`，新图片正式面不回 `blob/canonical`。
