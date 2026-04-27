# WebTorrent群聊越活跃越强的极限协同分发彻底完工 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底收口 `2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md` 的真实完工缺口，让浏览器 peer 平面在真实多人房间里真正建立，且前端不再把 tracker announce 当普通 HTTP 资源处理，也不再保留 `hint` 类型与真实运行态不一致的半收口状态。

**Architecture:** 本轮不做“哪里坏了补哪里”的表面修补，而是一次性修复 `contract -> HTTP adapter -> WebTorrent runtime -> presence truth -> smoke verification` 这条链的语义断层。核心原则是：`announce_urls` 属于 tracker transport 线索，不属于普通 fetch URL；`webSeed` 与真实 peer 继续严格分治；所有回归测试都围绕这条真实语义展开，而不是继续让不同测试层各自假设不同的 announce 真相。

**Tech Stack:** TypeScript、WebTorrent、bittorrent-tracker、Vitest、Playwright CLI、Rust/Axum 协作分发后端、PostgreSQL

---

## 文件与边界

- `frontend/媒体/适配/媒体HTTP接口.ts`
  - 当前根因入口。这里把 `announce_urls` 和普通媒体内容地址一起走 `解析绝对地址`，抹掉了 tracker 协议语义。
- `frontend/传输.ts`
  - 保留通用 HTTP 绝对地址解析器；本轮不在这里偷塞 tracker 特判，而是在媒体 adapter 内显式分出 announce resolver。
- `frontend/契约.ts`
  - 收紧 `announce_urls` 注释，明确它是 runtime tracker transport surface，不是普通 HTTP fetch surface。
- `frontend/媒体/媒体协作分发.ts`
  - 真实 WebTorrent `client.add()` 的 tracker 接口；这里必须只接收已经被正确归一化成 `ws/wss` 的 announce 列表。
- `frontend/媒体/资产协作分发运行时.ts`
  - `hint` 真相、`webSeed`/真实 peer 分治、公开快照与事件类型的根 owner；本轮要把 `null` hint 的类型收口完整。
- `frontend/媒体/媒体播放.ts`
  - 已经接受 `hint | null`，本轮只做和运行时类型对齐的验证，不再引入第二套 UI 语义。
- `frontend/tests/传输测试.spec.ts`
  - 当前把相对 announce 验成 `http://...`，直接编码了错误前提；这里要改成 `ws/wss` 真相。
- `frontend/tests/媒体定位测试.spec.ts`
  - 当前多处假数据仍把 announce 写成 `http://media.local/announce`；要统一收口成 tracker 语义。
- `frontend/tests/媒体协作分发测试.spec.ts`
  - 用于锁定 `接入协作分发种子` 只吃正确 announce 协议，并覆盖 adapter/runtime 接缝。
- `frontend/tests/资产协作分发运行时测试.spec.ts`
  - 为 `hint: null`、`webSeed` 静默、真实 peer 才升级 presence 的行为补定向回归。
- `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
  - 代码全绿且真实烟测通过后，再把 spec 的“已实现/已验收”段落修正为新的真实证据，删除已经被本轮推翻的旧说法。

## Task 1: 先把错误 seam 用失败测试钉死

**Files:**
- Modify: `frontend/tests/传输测试.spec.ts`
- Modify: `frontend/tests/媒体定位测试.spec.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`

- [ ] **Step 1: 为 announce adapter 真相补失败测试**

在 `frontend/tests/传输测试.spec.ts` 新增/改写用例，明确：
- `https://localhost` 基座下，`/api/swarm/announce` 必须收口成 `wss://localhost/api/swarm/announce`
- `http://localhost:3000` 基座下，`/api/swarm/announce` 必须收口成 `ws://localhost:3000/api/swarm/announce`
- 已经是 `ws://` / `wss://` 的 announce 必须原样保留
- 如果后端以后显式给出 `https://tracker.example/announce`，前端必须转成 `wss://tracker.example/announce`

- [ ] **Step 2: 为旧假前提补失败定位测试**

在 `frontend/tests/媒体定位测试.spec.ts` 把现有 `http://media.local/announce` 假数据改成真实 tracker 语义，并新增断言：定位结果中的 announce 不允许继续停留在 `http/https`。

- [ ] **Step 3: 为 runtime 接缝补失败测试**

在 `frontend/tests/媒体协作分发测试.spec.ts` 补一个最小回归：
- 输入 distribution 的 `announce_urls` 为 `wss://...`
- `接入协作分发种子` 必须原样把该值传给 `runtime.client.add`
- 不允许在 runtime 层再做第二次协议猜测

- [ ] **Step 4: 跑定向测试确认现在确实是红的**

Run:
```powershell
pnpm --dir frontend test -- "tests/传输测试.spec.ts" "tests/媒体定位测试.spec.ts" "tests/媒体协作分发测试.spec.ts"
```

Expected:
- 至少出现 announce URL 相关断言失败
- 证明本轮测试真的能抓住刚刚烟测暴露出来的 seam

## Task 2: 修复 announce contract -> adapter -> runtime 的真实语义断层

**Files:**
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `frontend/契约.ts`
- Modify: `frontend/媒体/媒体协作分发.ts`

- [ ] **Step 1: 先重新读取目标代码与上下文**

重新读：
- `媒体HTTP接口/loadMediaLocator`
- `媒体HTTP接口/解析媒体资产分发表面`
- `媒体协作分发/接入协作分发种子`
- `契约.ts` 中 `媒体协作分发定位片段`

确认不会把通用 HTTP resolver 和 tracker resolver 混成一套。

- [ ] **Step 2: 在媒体 adapter 内新增专用 announce resolver**

实现一个带详细中文注释的专用解析逻辑，要求：
- 相对 `/api/swarm/announce` 根据当前页面 origin 转成 `ws/wss`
- `http://` 转成 `ws://`
- `https://` 转成 `wss://`
- `ws://` / `wss://` 原样保留
- 其他媒体地址继续走原有 `解析绝对地址`

- [ ] **Step 3: 收紧共享契约注释**

在 `frontend/契约.ts` 明写：
- `announce_urls` 是 tracker transport surface
- 它不是普通 HTTP 资源地址
- 前端 adapter 必须在进入 runtime 前把它正规化成浏览器可用的 websocket announce 地址

- [ ] **Step 4: 保持 runtime 只消费收口后的 announce**

`frontend/媒体/媒体协作分发.ts` 不新增重复 resolver，不在 `client.add` 前再次猜协议；只补中文注释，说明 announce 真相 owner 已经在 adapter 收口。

- [ ] **Step 5: 跑 Task 1 定向测试确认转绿**

Run:
```powershell
pnpm --dir frontend test -- "tests/传输测试.spec.ts" "tests/媒体定位测试.spec.ts" "tests/媒体协作分发测试.spec.ts"
```

Expected:
- announce seam 相关用例全部转绿

## Task 3: 把 `hint: null` 真相与运行时类型一次收口

**Files:**
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `frontend/媒体/资产协作分发运行时.ts`
- Modify: `frontend/tests/资产协作分发运行时测试.spec.ts`
- Modify: `frontend/tests/媒体播放测试.spec.ts`

- [ ] **Step 1: 为 `hint` 真相补失败测试**

在 `frontend/tests/资产协作分发运行时测试.spec.ts` 补用例锁定：
- 只有 `webSeed` 时，公开 `hint` 允许为 `null` 或“正在补块”，但绝不能伪装成“正在协作分发”
- `done` 但从未连上真实 peer 时，`hint` 必须允许回到 `null`
- 连上真实 peer 后，才允许 `complete_peer` / `partial_peer` 路径持续上报

- [ ] **Step 2: 跑定向测试确认当前为红**

Run:
```powershell
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts" "tests/媒体播放测试.spec.ts"
pnpm --dir frontend typecheck
```

Expected:
- 至少出现 `hint` 类型或运行时断言失败

- [ ] **Step 3: 修改公开类型与事件类型**

在 `frontend/媒体/媒体协作分发.ts` 和 `frontend/媒体/资产协作分发运行时.ts` 完整收口：
- `协作分发媒体源["hint"]` 改成允许 `null`
- `SWARM_ACTIVE` / `TORRENT_DONE` / `读取会话状态` / 快照投影 与 `推导协作分发提示` 全链条保持一致
- 所有新增/修改代码补详细中文注释，解释“为什么允许 null”

- [ ] **Step 4: 校对播放器壳层语义**

确认 `frontend/媒体/媒体播放.ts` 只做可播放提示过滤，不再背着运行时兜第二套 hint 真相；必要时只补注释和细微类型对齐。

- [ ] **Step 5: 跑定向测试与 typecheck 转绿**

Run:
```powershell
pnpm --dir frontend test -- "tests/资产协作分发运行时测试.spec.ts" "tests/媒体播放测试.spec.ts"
pnpm --dir frontend typecheck
```

Expected:
- 运行时测试通过
- `pnpm --dir frontend typecheck` 重新变绿

## Task 4: 用跨层回归把“多人真的进入 swarm”锁成自动化门禁

**Files:**
- Modify: `frontend/tests/传输测试.spec.ts`
- Modify: `frontend/tests/媒体协作分发测试.spec.ts`
- Modify: `tests/协作分发测试.rs`（仅当需要补 contract 注释/断言时）

- [ ] **Step 1: 审视现有测试分裂点**

重新检查：
- Rust locator contract 为什么返回 `/api/swarm/announce`
- 前端传输测试为什么把它验成 `http://...`
- runtime 测试为什么常直接喂 `ws://127.0.0.1:7072`

把这些差异整理进测试注释，禁止未来再次出现“三层各说各话”。

- [ ] **Step 2: 给 seam 增加显式门禁**

补自动化断言，至少覆盖：
- 后端 contract 可以继续返回相对同源路径
- 前端 adapter 必须把它翻译成浏览器可用 websocket announce
- runtime 层只接受该收口后的值，不再把 `http/https` announce 当可用 swarm 入口

- [ ] **Step 3: 跑前端完整测试与 build**

Run:
```powershell
pnpm --dir frontend test
pnpm --dir frontend build
```

Expected:
- 前端完整测试通过
- build 通过

## Task 5: 真实多人烟测、spec 证据回写、全链路最终验收

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`

- [ ] **Step 1: 启动本地栈**

Run:
```powershell
$runLog = Join-Path $PWD 'tmp\\run-inline-plan.log'
$runErr = Join-Path $PWD 'tmp\\run-inline-plan.err.log'
$launcher = Start-Process pwsh -ArgumentList '-File', 'run.ps1' -PassThru -WindowStyle Hidden -RedirectStandardOutput $runLog -RedirectStandardError $runErr
```

等待 `https://127.0.0.1`、8080、7072、7073、443 全部就绪。

- [ ] **Step 2: 用真实多人房间重跑烟测**

使用 `playwright-cli` 多隔离上下文复现：
- 房间 `1234b`
- `sender / A / B / C / D`
- 上传 `D:\200-生活\230-照片备份\233-Telegram\色色` 内 MP4
- A/B/C 点开同一条视频，D 后进入

必须采集：
- tracker `stats.json`
- `swarm_peer_presence`
- 浏览器网络/控制台

- [ ] **Step 3: 通过真实证据判定是否达标**

达标标准：
- tracker peer 数不再只有 backend seeder
- `swarm_peer_presence` 出现真实浏览器 `partial_peer` / `complete_peer`
- A/B/C/D 真实进入 swarm 后，不再只剩 server-assisted 假热度
- 不破坏“没有真实 peer 时不撒谎”的既有门禁

- [ ] **Step 4: 回写 spec 的实现与验收记录**

只有当 Step 3 真实通过时，才允许更新 spec：
- 替换掉已经被本轮证伪的旧烟测说法
- 写入新日期、新命令、新数据库/tracker 证据
- 明说这次根因是 `announce` contract/adapter/runtime seam，而不是继续把生命周期表象当根因

- [ ] **Step 5: 跑最终全链路验证**

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
- 全部 exit 0

- [ ] **Step 6: 清理运行态并复核工作树**

Run:
```powershell
pwsh -File qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles -OptimizeStartupArtifacts
git status --short
```

Expected:
- 只剩本轮有价值代码/文档改动
- 无临时烟测垃圾
