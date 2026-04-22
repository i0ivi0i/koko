# WebTorrent 高速分发补充收敛计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。本计划按 `supxcode` 约束编排：先证据、再裁决、后改动，且必须 TDD（先红后绿）。

**日期：** 2026-04-22  
**状态：** Ready（本轮已完成一批修复与烟测，仍有剩余闭环）  
**范围：** `koko` 新附件 WebTorrent 主链、多人会话烟测、失败态真相、可观测性澄清。

---

## 1. 这份补充计划要解决什么

本轮已经修掉 3 个关键漂移点，但离“spec 彻底闭环”还差最后一截：

1. 已修：新附件视频预览曾可能回退 canonical/original 冷源；现在已改为 distribution 存在时优先复用 swarm 会话。
2. 已修：前端未把 `media_state.retry_after_ms` 透传到 WebTorrent `noPeersIntervalTime`；现在已接入。
3. 已修：`attachment_not_found` 曾被当成普通不可用；现在已映射为 `media_deleted` 终态提示。
4. 未闭环：`24h` 纯 peer 场景的浏览器端真实烟测仍需自动化稳定复现与留档。
5. 未闭环：`MEDIA_DELETED` 端到端（真实房间消息仍在、附件被删）场景缺少一键可重复烟测入口。
6. 未闭环：网络面上 `webseed` 请求形态与“前端直链回退”在观察上仍容易混淆，缺少可观测性标签。

---

## 2. 本轮已完成证据（写入计划，防止回归）

### 2.1 代码与测试（已落地）

- [x] `frontend/聊天媒体编排.ts`：新附件视频预览 `distribution` 存在时优先 `解析协作分发源`，仅 legacy 才回退冷源。
- [x] `frontend/媒体/媒体协作分发.ts`：支持并透传 `noPeersIntervalTime`，读取 `media_state.retry_after_ms`。
- [x] `frontend/媒体/媒体播放.ts`：locator 抛 `attachment_not_found` 时返回 `media_deleted`。
- [x] 新增并通过测试：
  - `frontend/tests/聊天媒体编排测试.spec.ts`
  - `frontend/tests/媒体协作分发测试.spec.ts`
  - `frontend/tests/媒体播放测试.spec.ts`

### 2.2 多会话烟测（房间 `1234b`）

- [x] sender/viewerA/viewerB 三会话并发验证。
- [x] 使用本地目录 MP4 上传并播放（`D:\200-生活\230-照片备份\233-Telegram\色色`）。
- [x] viewer 侧 `video.currentSrc` 命中 `https://localhost/webtorrent/{infohash}/content-*.mp4`。
- [x] 真实 UI 命中 `当前没有在线种子，等待群友上线` 文案。
- [x] 说明：网络里出现 `/api/attachments/...variant=original` 多为 WebSeed 取块，不等于播放器前端回退直链。

---

## 3. 真正根因（按优先级）

1. **预览链路曾绕过主链**：预览分支在新附件也可能走 canonical/original，造成“主链口头统一、实现双链并存”。
2. **重试节奏未契约化**：后端给了 `retry_after_ms`，前端却未传到底层 swarm 探测，导致连接阶段节奏漂移。
3. **删除终态被错误扁平化**：locator 404 的业务语义未保留，UI 退化成泛化失败。
4. **可观测性不足导致误判**：WebSeed 请求与“前端直链回退”在日志上难区分，容易误报架构违规。

---

## 4. 剩余任务（必须继续 TDD）

### Task A：补齐 `24h` 纯 peer 端到端自动烟测

**目标：** 证明 `complete_at + 24h` 后无后端字节供给时，仍能在有在线完整 peer 时恢复，否则进入无在线种子真相。

**Files**
- Modify: `tests/协作分发测试/可用性裁决.rs`
- Create: `frontend/tests/e2e/协作分发24h纯peer烟测.spec.ts`（或现有 E2E 文件中新增场景）

**Checklist**
- [ ] 先写失败测试：可注入时钟推进到 `complete_at + 24h + 1s`。
- [ ] 验证后端 locator：`web_seed_url == null` 且 `survival_mode == peer_only_after_expiry`。
- [ ] 验证前端：先 `MEDIA_CONNECTING_TO_PEERS`，预算耗尽后 `MEDIA_NO_ONLINE_SEED`。
- [ ] 验证“有完整 peer 回归”后可自动恢复 `MEDIA_READY`。

### Task B：补齐 `MEDIA_DELETED` 的可重复端到端入口

**目标：** 不只靠单元测试，提供真实房间路径可演练“内容已删除”。

**Files**
- Modify: `src/媒体资产外壳.rs`（若需要暴露受控测试删除入口，仅测试环境可用）
- Modify: `frontend/tests/媒体播放测试.spec.ts`
- Create/Modify: `tests/协作分发测试/删除终态.rs`

**Checklist**
- [ ] 先写失败测试：附件存在于消息引用历史，但附件对象已被权威删除时，前端必须落 `内容已删除`。
- [ ] 保障 contract 不混淆：`MEDIA_DELETED` 与 `MEDIA_NO_ONLINE_SEED` 必须稳定区分。
- [ ] 烟测脚本里加入删除态步骤并保留截图/网络证据。

### Task C：给 WebSeed 请求加可观测性标记，防止误判“回退直链”

**目标：** 让日志与抓包能一眼区分“WebTorrent 通过 WebSeed 取块”与“播放器直链”。

**Files**
- Modify: `src/媒体协作分发.rs`
- Modify: `frontend/媒体/媒体协作分发.ts`
- Modify: `tests/协作分发测试/投影一致性.rs`

**Checklist**
- [ ] 先写失败测试：`web_seed_url` 附带明确来源标记（例如查询参数或受控 header 协议位）。
- [ ] 前端播放源保持 `/webtorrent/...` 不变，只增强 observability。
- [ ] 日志断言新增“webseed_path=true”的可检索字段。

---

## 5. 执行门禁（必须全部满足）

- [ ] `cargo test` 全绿。
- [ ] `pnpm --dir frontend test` 全绿。
- [ ] `pnpm --dir frontend typecheck` 全绿。
- [ ] `pnpm --dir frontend build` 全绿。
- [ ] 三会话 `chrome-devtools-cli` 烟测记录：
  - `https://localhost`
  - 房间 `1234b`
  - sender/viewerA/viewerB
  - 成功播放（`/webtorrent/...`）
  - 无在线种子文案
  - 删除终态文案

---

## 6. 风险与回滚边界

1. 新增可观测性字段时，禁止把 shell 展示语义写进共享 contract。
2. 删除态端到端演练若需要测试专用入口，必须明确仅测试环境启用。
3. 回滚只允许在“新代际附件”范围内，不允许把整条新主链裁决打回旧链。

---

## 7. 结论

这轮不是“没做完”，而是“主链漂移点已修复、核心回归已补齐，但端到端闭环还缺两块硬证据（`24h` 与 `MEDIA_DELETED`）”。本计划就是把这两块硬证据补成可重复、可审计、可长期回归的工程资产。
