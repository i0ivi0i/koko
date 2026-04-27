# WebTorrent高速分发防止群友偷懒彻底完工 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底收口 `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md` 仍未闭合的底层真相，让“`24 小时` 后服务器退出媒体字节供给”在后端 locator、原始字节端点、自动化验证和真实烟测里都只剩一条权威语义。

**Architecture:** 本轮不再做表层播放器补丁，而是直接修复 `complete/upload 写库 -> 附件快照 -> 原图内容读取 -> locator/失败态 -> 烟测证据` 这条链上的双时钟问题。核心原则有两条：第一，新主链附件的服务器字节供给资格只认同一条 `24 小时` 权威窗口；第二，验收只能证明“真实来源资格”和“真实字节退场”，不能再用表面网络流量代替业务完成态。

**Tech Stack:** Rust、Axum、SQLx、PostgreSQL、TypeScript 前端壳、Vitest、Rust 集成测试、Playwright CLI、WebTorrent

---

## 文件与边界

- `src/用例.rs`
  - `附件读取结果` 与 `读取附件内容` 的应用层 owner。这里必须收口“服务器是否仍允许提供原始媒体字节”的最终裁决，不能再只看旧 `attachments.origin_*`。
- `src/媒体附件适配.rs`
  - `查询附件快照_异步` / `查询附件可读内容_异步` 的数据库适配 owner。这里负责把新主链附件的分发表面与旧附件兼容表面一起翻译成应用层稳定快照。
- `src/媒体资产外壳.rs`
  - 原始字节端点与 locator 的 HTTP adapter。这里不新增业务判断，只校验壳层错误码与响应契约仍和应用层一致。
- `src/媒体上传外壳.rs`
  - 新附件 complete 后写入 `attachment_distribution_metadata / canonical_media_assets / attachments` 的来源。这里要补充注释和回归，明确三处时间字段的角色，防止以后再漂回“两套真相”。
- `tests/协作分发测试/内容读取.rs`
  - 原始字节受控读取的集成测试 owner。本轮要补“`web_seed_until` 已过期但 `attachments.origin_expires_at` 仍可读时，服务端也必须拒绝原始字节”的红灯回归。
- `tests/协作分发测试/可用性裁决.rs`
  - locator / no-seed / deleted 契约测试 owner。本轮要补跨端点一致性断言，证明 locator 与原始字节端点不再各说各话。
- `tests/媒体上传测试/complete.rs`
  - 新附件写库后的字段一致性回归 owner。本轮要补“新链附件 `origin_expires_at` 与 `web_seed_until` 初始同步写入”的门禁，防止 writer 再制造新漂移。
- `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`
  - 这份 spec 目前的“已彻底完成”结论不成立。本轮代码与烟测通过后，必须把实现/验收记录改写成新的真实证据。

## Task 1: 先用失败测试把真正的未闭合点钉死

**Files:**
- Modify: `tests/协作分发测试/内容读取.rs`
- Modify: `tests/协作分发测试/可用性裁决.rs`

- [ ] **Step 1: 为“`24 小时` 后原始字节仍被服务器直供”写失败测试**

在 `tests/协作分发测试/内容读取.rs` 新增一个最小回归，要求同时满足：
- 附件是新主链 `ready` 视频附件；
- `attachment_distribution_metadata.web_seed_until` 被手动拨到过去；
- `attachments.origin_expires_at` 仍故意保留在未来，复现当前双时钟缺口；
- 直接请求 `/api/attachments/{attachment}/content?variant=original` 时，服务端必须拒绝媒体字节，不允许再返回 `206`。

- [ ] **Step 2: 为 legacy 兼容边界写保护测试**

在同一测试文件再补一个保护用例：
- 当附件没有 `attachment_distribution_metadata` 新主链记录时；
- 原始内容读取仍按既有 `attachments.origin_*` 冷源兼容逻辑工作；
- 防止这次修复顺手把旧代际附件全部误伤。

- [ ] **Step 3: 为 locator / 原始字节端点一致性补失败测试**

在 `tests/协作分发测试/可用性裁决.rs` 新增一个跨端点用例：
- `web_seed_until` 已过期、没有 `complete_peer/backend_strong_seed` 时；
- locator 必须先进入 `MEDIA_CONNECTING_TO_PEERS` 再落到 `MEDIA_NO_ONLINE_SEED`；
- 同一窗口下原始字节端点不得继续返回任何服务器媒体字节。

- [ ] **Step 4: 运行定向测试确认当前真的为红**

Run:
```powershell
cargo test --test 协作分发测试 内容读取 -- --nocapture
cargo test --test 协作分发测试 可用性裁决 -- --nocapture
```

Expected:
- 至少出现“原始字节端点仍返回 `206`”相关失败；
- 证明本轮测试抓到的是刚刚烟测确认的真实根因，而不是新写出来的假问题。

## Task 2: 在应用层收口单一的“服务器媒体字节供给资格”

**Files:**
- Modify: `src/用例.rs`
- Modify: `src/媒体附件适配.rs`

- [ ] **Step 1: 重新读取目标符号并确认兼容边界**

重新阅读并标出：
- `src/用例.rs` 中 `附件读取结果`、`读取附件内容`
- `src/媒体附件适配.rs` 中 `查询附件快照_异步`
- `src/媒体附件适配.rs` 中 `查询协作分发元数据_异步`

确认本轮要补的是“新主链附件的服务器字节资格字段”，不是把 locator 运行态或房间可见性逻辑搅在一起。

- [ ] **Step 2: 在附件快照里显式带出新主链服务器字节窗口**

为 `附件读取结果` 增加一个带详细中文注释的稳定字段，语义写死为：
- 新主链附件：这里承载后端对前端继续提供服务器媒体字节的截止时间；
- legacy 附件：字段允许为空，继续按旧 `origin_*` 兼容；
- 它不代表 peer 可用性，不代表 locator 运行态，只代表“服务器自己还能不能继续吐字节”。

- [ ] **Step 3: 让 `查询附件快照_异步` 用一条查询把新旧真相翻译清楚**

修改 `查询附件快照_异步`：
- 左连接 `attachment_distribution_metadata`；
- 把 `dm.web_seed_until` 翻译到新的应用层字段；
- 保留 `attachments.origin_expires_at / origin_deleted_at` 给 legacy 冷源兼容和物理清理使用；
- 新增中文注释说明“新主链服务器字节资格”和“物理冷源生命周期”不是一回事，但前者优先决定能否继续对外供字节。

- [ ] **Step 4: 修改 `读取附件内容` 只认单一服务器字节资格**

在 `读取附件内容` 中收口规则：
- `variant != 原图` 不受本轮新规则影响；
- `variant == 原图` 时，若附件存在新主链服务器字节截止时间，则必须先看这个字段；
- 只有当该字段不存在时，才回退到 legacy `origin_*` 判断；
- 删除态仍继续以 `origin_deleted_at / 附件状态` 为最高优先级。

- [ ] **Step 5: 跑 Task 1 定向测试让它转绿**

Run:
```powershell
cargo test --test 协作分发测试 内容读取 -- --nocapture
cargo test --test 协作分发测试 可用性裁决 -- --nocapture
```

Expected:
- 新增回归通过；
- legacy 兼容保护用例通过；
- 没有引入新的未就绪/权限回归。

## Task 3: 把 writer 初始写库和读侧裁决的关系钉成门禁

**Files:**
- Modify: `tests/媒体上传测试/complete.rs`
- Modify: `src/媒体上传外壳.rs`

- [ ] **Step 1: 为 complete 写库一致性补失败测试**

在 `tests/媒体上传测试/complete.rs` 新增/补强断言：
- 新上传视频/图片 complete 后；
- `attachment_distribution_metadata.web_seed_until`
- `canonical_media_assets.web_seed_until / origin_expires_at`
- `attachments.origin_expires_at`
至少在初始写库时必须保持同一批 `24 小时` 主链窗口语义。

- [ ] **Step 2: 只在 writer owner 里补最小中文注释和必要收口**

在 `src/媒体上传外壳.rs` 相关 complete 写库位置补详细中文注释，明确：
- `web_seed_until` 是新主链服务器字节供给资格；
- `origin_expires_at` 仍服务物理冷源清理与兼容面；
- 新附件初始写入时两者必须同步，避免以后又出现 writer 自己制造的双时钟。

- [ ] **Step 3: 跑 complete 定向回归**

Run:
```powershell
cargo test --test 媒体上传测试 complete -- --nocapture
```

Expected:
- 新增的一致性断言转绿；
- 现有 complete 回归不受影响。

## Task 4: 升级验收门禁，禁止再拿表面流量冒充完成态

**Files:**
- Modify: `tests/协作分发测试/可用性裁决.rs`
- Modify: `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`

- [ ] **Step 1: 给自动化测试补“证据类型”约束**

在 `tests/协作分发测试/可用性裁决.rs` 的新增/修改注释里写死：
- `locator / torrent / /webtorrent/... / original` 有网络请求，不等于服务器媒体字节资格或 peer 帮助资格成立；
- 对这份 spec，真正关键证据是“原始字节端点是否已经退场”和“locator 是否说真话”。

- [ ] **Step 2: 回写 spec 的未完成根因与最终验收记录**

只有代码和烟测通过后，才修改 `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`：
- 把当前“2026-04-22 已彻底完成”的结论改成更精确的新结论；
- 明写 `2026-04-27` 补上的真正最后一刀，是“原始字节端点与 locator 共用同一条 `24 小时` 服务器退字节真相”；
- 删掉或改写任何会让人误以为“有流量就等于主链完成态”的旧表述。

- [ ] **Step 3: 运行 spec 相关回归并人工复读文档**

Run:
```powershell
cargo test --test 协作分发测试 -- --nocapture
```

Expected:
- 与 24 小时退场、无在线种子、删除态有关的回归全部通过；
- spec 文案与代码现状一致，不再夸大完成度。

## Task 5: 真实多人烟测、完整验证、图谱更新与提交

**Files:**
- No new code files expected

- [ ] **Step 1: 启动本地栈并确认端口就绪**

Run:
```powershell
$runLog = Join-Path $PWD 'tmp\\run-webtorrent-2026-04-22-finish.log'
$runErr = Join-Path $PWD 'tmp\\run-webtorrent-2026-04-22-finish.err.log'
$launcher = Start-Process pwsh -ArgumentList '-File', 'run.ps1' -PassThru -WindowStyle Hidden -RedirectStandardOutput $runLog -RedirectStandardError $runErr
```

确认：
- `http://127.0.0.1:8080/`
- `https://localhost/`
- `http://127.0.0.1:7072/stats`
全部可访问。

- [ ] **Step 2: 重跑 1234b 真实多人烟测**

使用 `playwright-cli` 多隔离上下文：
- 房间 `1234b`
- `sender / A / B / C / D`
- `D:\200-生活\230-照片备份\233-Telegram\色色` 下多条长 MP4

必须同时采集：
- `A/B/C` 打开视频时的 swarm 字节请求与 `presence`
- 把目标附件的 `web_seed_until` 拨到过去后，`D` 的 locator 状态变化
- 在同一时刻直接请求 `/api/attachments/{attachment}/content?variant=original`，确认服务端不再回 `206`

- [ ] **Step 3: 跑最终全链路验证**

Run:
```powershell
pnpm --dir frontend test
pnpm --dir frontend typecheck
pnpm --dir frontend build
cargo test -j 1
pwsh -File tests/启动器脚本检查.ps1
pwsh -File tests/powershell/https-script.tests.ps1
```

Expected:
- 全部 exit 0。

- [ ] **Step 4: 更新知识图谱并清理运行态**

Run:
```powershell
graphify update .
pwsh -File qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles -OptimizeStartupArtifacts
git status --short
```

Expected:
- 图谱已更新；
- 工作树只剩本轮有价值改动；
- 没有烟测日志、临时脚本、无意义格式化噪音。

- [ ] **Step 5: 用中文提交**

Run:
```powershell
git add src/用例.rs src/媒体附件适配.rs src/媒体上传外壳.rs tests/协作分发测试/内容读取.rs tests/协作分发测试/可用性裁决.rs tests/媒体上传测试/complete.rs docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md docs/superpowers/plans/2026-04-27-WebTorrent高速分发防止群友偷懒彻底完工计划.md
git commit -m "修复 WebTorrent 24 小时退字节双真相并补齐验收门禁"
```

Expected:
- 产生一条中文 commit；
- 提交前后 `git status --short` 干净，或只剩主人明确保留的改动。
