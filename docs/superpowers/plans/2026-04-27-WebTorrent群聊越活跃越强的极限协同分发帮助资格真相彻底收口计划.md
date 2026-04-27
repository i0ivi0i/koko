# WebTorrent群聊越活跃越强的极限协同分发帮助资格真相彻底收口计划

> **Inline Execution 约束**
> 1. 本计划按当前工作区直接执行，不另开 worktree / 分支。
> 2. 先写失败测试，再做最小实现，再转绿，再跑真实多人烟测。
> 3. 本轮不接受“先把 presence 藏掉再说”的假修复；必须同时收口可见预热、正式播放 bootstrap、帮助资格、presence 真相四层边界。

## 目标

把 `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md` 里最后一块没真正完工的缺口彻底补上：

1. **未观看、未真正自动播的可见视频**，不能再因为“只是落进当前窗口 / 候选集”就进入正式帮助链。
   - 反过来，**真正已经开始自动播放的附件** 仍然必须算正式帮助资格，不能被这轮修复误伤成保守版。
2. **视频预览、可见候选预热、正式播放、后台补齐** 必须各守自己的 owner，不再共用一条会导致真相串味的隐式路径。
3. **`swarm_peer_presence` 的 `partial_peer / complete_peer`** 只能代表“已经获得正式帮助资格，并且真的接入过 peer 平面”的浏览器事实。
4. 真正看过/自动播过/进入后台补齐后的用户，仍然继续符合 spec 要求的激进帮助链语义；不能因为收口 bug 又把系统做回保守版。

## 已确认根因

这不是单点 bug，而是四层真相被叠穿：

1. `frontend/聊天媒体编排.ts`
   - `预热自动播候选媒体会话` 会对可见候选直接 `session.启动()`。
   - 这把“马上可能会播放”偷换成了“正式媒体会话已经成立”。
2. `frontend/聊天媒体编排.ts`
   - `补齐当前房间媒体会话` 对当前窗口视频统一触发 `触发视频预览收敛(...)`。
   - 但当前预览协作还允许自己从零起 locator + swarm 解析，导致“只是可见”也会进 swarm。
3. `frontend/媒体/壳层/视频预览协作.ts`
   - preview 在没有现成正式播放源时，仍会自己去 `获取媒体定位 + 解析协作分发预览源`。
   - 这把“预览抓帧”偷换成了“预览也能建 swarm consumer”。
4. `frontend/媒体/资产协作分发运行时.ts`
   - 只要任意 consumer 连上真实 peer，当前会话就会上报 `partial_peer / complete_peer`。
   - 运行时没有“正式帮助资格”这条独立真相，导致 `preview / session` 也能冒充帮助者。

所以真正要补的是：

**把“看得见”“预热一下”“正式播放”“进入帮助链”重新拆回四层。**

## 架构裁决

本轮写死下面四条新裁决：

1. **可见窗口视频** 可以保留轻量会话外壳和预览状态，但不能仅凭可见就自建 swarm consumer。
2. **自动播候选** 可以表达“高价值即将播放”的信号，但不能再直接启动正式 `session` 播放解析。
3. **视频预览** 只能复用“已经存在的正式播放源 / 已缓存预览真相”；不能自己从零建 swarm。
4. **帮助资格** 必须成为 runtime 内的显式、可持续状态；只有真正进入帮助链的会话，才允许把 peer 连接事实翻译成 `partial_peer / complete_peer`。

## 修改边界

- `frontend/聊天媒体编排.ts`
  - 去掉“可见候选直接启动正式媒体会话”的旧真相。
  - 保留候选 trigger，但只允许把信号交给预览协作或真正的 autoplay owner。
- `frontend/媒体/壳层/视频预览协作.ts`
  - 预览只允许使用已有正式播放源、已有内容哈希缓存或嵌入式预览结果。
  - 默认可见路径与 `visible_candidate` 路径都不再从零起 locator/swarm。
- `frontend/媒体/资产协作分发运行时.ts`
  - 新增“已获得帮助资格”显式状态。
  - `preview / session` 就算连上 peer，也不能对外上报帮助者 presence。
  - `backfill` 真正激活后，帮助资格才成立；后续完成补齐、零引用保留、页面重开恢复都沿用这条真相。
- `frontend/媒体/媒体协作分发.ts`
  - 只补必要注释/类型对齐，不新增第二套帮助资格判断。
- `frontend/tests/*.spec.ts`
  - 把旧的“可见候选会先建正式会话/补成 ready preview”改成失败测试，再改实现转绿。
- `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
  - 烟测通过后回写新证据，删除已被本轮推翻的旧验收说法。

## 执行步骤

### Task 1：先把帮助资格边界钉成失败测试

- [ ] 改 `frontend/tests/聊天媒体编排测试.spec.ts`
  - 把“可见自动播候选会预热正式媒体会话”改成新真相：
    - 可见候选只触发预览/候选信号；
    - 不再调用 `session.启动()`；
    - `playbackByAttachmentId` 不应因为候选观察而提前拿到正式播放结果。
- [ ] 改 `frontend/tests/聊天应用内核测试.spec.ts`
  - 把“连续候选会先后触发三次 `session:` 解析”改成新真相：
    - 候选观察本身不触发 `session:` 正式解析；
    - 真正成为 autoplay owner 后，才触发 `inline_autoplay:` 正式解析。
- [ ] 改 `frontend/tests/视频预览协作测试.spec.ts`
  - 把“visible_candidate 会重试 locator/swarm 预览”改成新真相：
    - 没有现成正式播放源时，visible/default 只保持 `missing_source`；
    - 不再自己调用 `解析协作分发预览源`。
- [ ] 改 `frontend/tests/媒体协作分发测试.spec.ts`
  - 新增失败测试：
    - `preview` consumer 连上 peer 后，不得上报 `partial_peer / complete_peer`；
    - 普通 `session` consumer 连上 peer 后，也不得上报帮助者 presence；
    - 只有 `eagerCompleting/backfill` 会话才允许把 peer 事实变成帮助者事实。
- [ ] 运行定向测试，先确认现在是红的。

### Task 2：收口可见候选与正式播放 bootstrap

- [ ] 修改 `frontend/聊天媒体编排.ts`
  - 删除 `预热自动播候选媒体会话` 里直接 `session.启动()` 的路径。
  - 保留中文注释，明确“候选观察不是正式播放建立”。
- [ ] 校对 `读取当前活跃媒体窗口附件` / `补齐当前房间媒体会话`
  - 允许继续为当前窗口保留会话壳和预览状态；
  - 但不能再借这些路径隐式推进 swarm。
- [ ] 更新对应测试，使“真正 owner 才启动正式播放”成为门禁。

### Task 3：收口视频预览 owner，禁止从零建 swarm

- [ ] 修改 `frontend/媒体/壳层/视频预览协作.ts`
  - 没有现成正式播放源时，不再 `获取媒体定位 -> 解析协作分发预览源`。
  - 只有已有正式播放源、已有缓存、或后续 formal playback 到位时，预览才允许转 `ready`。
  - 保留对 `missing_source`、同版阻断、sourceVersion 抢占的既有保护语义，但删除“可见候选再试一次就能自己建 swarm”这条旧语义。
- [ ] 更新视频预览相关测试和中文注释，明确 preview 不再自带 swarm 准入权。

### Task 4：给 runtime 增加正式帮助资格真相

- [ ] 修改 `frontend/媒体/资产协作分发运行时.ts`
  - 增加类似“已进入帮助链/已获得帮助资格”的显式字段。
  - 这条资格只允许由真正的帮助链入口建立：
    - `eagerCompleting/backfill`
    - 不能再由 `preview/session/仅 owner source resolve` 隐式获得。
  - `wire/done` 事件处理改成双门禁：
    - 先看是否连上真实 peer；
    - 再看是否已获得帮助资格；
    - 两者同时成立，才允许 `partial_peer / complete_peer`。
- [ ] 保持历史正确行为：
  - 已正式进入帮助链的会话，补齐完成后继续保留 `complete_peer`；
  - 零引用轻帮助态、页面重开恢复、本地完整缓存恢复帮助任务都不能回退。
- [ ] 更新 `frontend/tests/资产协作分发运行时测试.spec.ts` 与 `frontend/tests/媒体协作分发测试.spec.ts`。

### Task 5：跑全量前端验证，再做真实多人烟测

- [ ] 运行：
  - `pnpm --dir frontend test -- "tests/聊天媒体编排测试.spec.ts" "tests/聊天应用内核测试.spec.ts" "tests/视频预览协作测试.spec.ts" "tests/媒体协作分发测试.spec.ts" "tests/资产协作分发运行时测试.spec.ts"`
  - `pnpm --dir frontend test`
  - `pnpm --dir frontend typecheck`
  - `pnpm --dir frontend build`
- [ ] 真实多人烟测重跑 `sender / A / B / C / D`
  - 仍用房间 `1234b`
  - 继续上传长 MP4
  - 重点验证：
    1. `D` 只进房、不点开、不真正自动播时，不再留下 `partial_peer / complete_peer`
    2. tracker peer 数不再因为纯可见预热而虚涨
    3. A/B/C 真看过后，仍能留下真实帮助者 presence
    4. D 真正开始自动播/点开后，才进入帮助链

### Task 6：spec 回写、图谱更新、最终收尾

- [ ] 更新 `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
  - 明写这次最后根因不是 announce，而是帮助资格真相串味。
  - 回写新的多人烟测证据和验证命令。
- [ ] 运行 `graphify update .`
- [ ] 跑最终全链路验证：
  - `pnpm --dir frontend test`
  - `pnpm --dir frontend typecheck`
  - `pnpm --dir frontend build`
  - `cargo test -j 1`
  - `pwsh -File tests/启动器脚本检查.ps1`
  - `pwsh -File tests/powershell/https-script.tests.ps1`
- [ ] `git status --short` 复核无噪音
- [ ] `git commit`，提交中文说明

## 计划自审

### 这份计划刻意避免了什么

1. **没有只改 `presence` 上报**
   - 因为那会把 bug 藏到“预览/候选仍在偷偷进 swarm”下面，属于掩耳盗铃。
2. **没有把问题简化成 announce 或 tracker 单点**
   - announce seam 已修过；这次根因是帮助资格 owner 混乱。
3. **没有为了省事把系统做回保守版**
   - 真正的 `inline_autoplay / viewer / backfill` 依然保留激进帮助链；
   - 收掉的只是“没看过却被误算成帮助者”的假激进。

### 这份计划的风险点

1. 去掉候选 formal bootstrap 后，首眼视频切换节奏可能变化。
   - 解决方式：用现有预览/owner 测试与真实烟测一起盯，不靠猜。
2. 预览不再自建 swarm 后，某些旧测试会大面积红。
   - 这是预期内的红；必须先改测试真相，再改实现。
3. runtime 帮助资格如果做成临时条件，而不是显式状态，后面恢复帮助任务还会再串味。
   - 所以必须落成独立字段，而不是继续靠 `consumerId` 前缀猜。
