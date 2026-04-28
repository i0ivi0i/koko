# Media Viewer Close Chain And Feed Budget Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本轮按主人要求采用 Inline Execution，不启用 subagent。

**Goal:** 修复真实浏览器里媒体查看器全屏态关闭按钮命中失败的问题，同时把消息流视频的“谁该重、谁该轻、为什么还活着”的裁决收口到同一份信息流媒体预算真相里，做到不破坏唯一 `Video.js v10` player、唯一 `WebTorrent` 正式主链、自动播放/查看器/全屏连续性。  
**Architecture:** 延续现有单播放器 + `WebTorrent` 主链，不新增第二播放器、不新增第二分发链；在既有 `聊天媒体编排.ts` / `媒体运行时.ts` / `房间消息窗.ts` / `媒体查看器.ts` 边界内完成 owner 收口，并删除重复判断路径。  
**Tech Stack:** TypeScript、Lit、Vitest、Playwright/Chrome DevTools CLI、Serena、Graphify。

---

## 1. 本轮问题定义

基于真实房间 `1234b` 的浏览器烟测，这轮必须一次收口两个底层问题：

1. **全屏查看器关闭链断裂**  
   真浏览器命中测试证明：全屏态右上角关闭按钮视觉存在，但命中落点仍落到 `VIDEO`，说明关闭控件没有进入与视频同一套 fullscreen top layer owner。
2. **信息流媒体预算真相仍然分裂**  
   现在 `房间消息窗.ts`、`聊天媒体编排.ts`、`媒体运行时.ts`、`资产协作分发运行时.ts` 各自只知道局部事实，预算快照也只有聚合数字，没有“每个附件为什么处于重播放 / 轻预热 / 冷表达 / 轻帮助”的单一裁决面。

这两个问题必须一起修。只修关闭按钮，是修表象；只加预算统计数字，不收口 owner，也不能防止下一轮再长回重复重对象。

## 2. 不可破坏的继承裁决

- [ ] 绝不新增第二正式播放器。
- [ ] 绝不让新主链视频回退到 `HLS`、原文件直链、CDN 或第二正式播放真相。
- [ ] 自动播放、查看器、全屏、退出归位继续复用同一颗 canonical player。
- [ ] `WebTorrent` 正式播放继续以当前 swarm 正式路径为准，不能因减负回退旧链路。
- [ ] 不把“预算收口”做成新 wrapper 垃圾层；旧重复判断要实删或实下沉。

## 3. 实现裁决

### 3.1 查看器关闭链裁决

- [ ] 全屏态的交互控件必须与实际 fullscreen owner 同层、同宿主、同生命周期。
- [ ] `媒体查看器.ts` 不能继续把视频容器推进 fullscreen top layer，却把关闭按钮留在普通 `document.body` 叠层。
- [ ] 关闭按钮、遮罩层、点击关闭、`Escape` 退出、viewer cleanup 必须共用同一份 session/fullscreen 生命周期。
- [ ] 关闭 viewer 时只能结束 viewer owner，不能清掉时间线仍引用的有效附件热源。

### 3.2 信息流媒体预算 owner 裁决

- [ ] 在现有 `聊天媒体编排.ts` / `媒体运行时.ts` 边界里落一个可观测的“附件级预算裁决”。
- [ ] 每个附件都必须能解释自己当前属于：
  - `heavy_playback`
  - `warm_preview`
  - `cold_expression`
  - `light_help`
- [ ] `房间消息窗.ts` 的 preview / canonical host 显示判断，不再直接拼接局部布尔真相；要消费编排层给出的统一投影。
- [ ] `聊天运行时预算状态` 不能只保留总数；要新增足够的结构化字段，让测试和烟测能读到当前 owner 原因与关键附件状态。
- [ ] 这轮先收口视频附件路径；图片预算保持现状，但不能被新结构打坏。

## 4. TDD 执行顺序

### 4.1 先补失败测试

- [ ] 给 `媒体查看器` 增加关闭链 regression 测试，覆盖“全屏宿主、关闭控件、cleanup 生命周期必须同 owner”。
- [ ] 给 `聊天媒体编排` / `房间消息窗` 增加预算裁决测试，证明：
  - 同一附件不会同时被两个地方判成重态；
  - owner 进入 canonical host 时，时间线渲染读取的是统一预算投影；
  - viewer 关闭后，时间线 owner 仍保持有效，不会误报不可获取。
- [ ] 给状态投影补测试，证明结构化预算快照会随 owner 切换更新，而不是只改数字不改原因。

### 4.2 再做最小实现

- [ ] 重构 `媒体查看器.ts`：让 fullscreen mount / overlay / close button 成为同一宿主树的一部分，统一绑定 session cleanup。
- [ ] 在 `聊天媒体编排.ts` 新增或收口附件级预算投影函数，统一决定每个视频附件的渲染重量与原因。
- [ ] 在 `房间消息窗.ts` 改为消费新的预算投影，删除重复的 preview/canonical 布尔拼装。
- [ ] 在 `状态.ts` 和相关投影处补结构化预算快照字段，确保调试面和测试面能读到“为什么重”。

### 4.3 最后做必要重构

- [ ] 清掉因为新 owner 收口后不再需要的重复布尔判断、重复状态字段和死测试分支。
- [ ] 只在复杂状态切换处补中文注释，说明 owner、代次和 cleanup 为什么这样做。
- [ ] 若顺手发现同 slice 内更高价值的 IM 生命周期 bug，且能用同一 owner 收口自然修掉，则一并修；禁止扩散到无关模块。

## 5. 模块级改动边界

### 5.1 `frontend/媒体/媒体查看器.ts`

- [ ] 调整 viewer DOM 结构，让交互控件进入真实 fullscreen owner 宿主。
- [ ] 统一 close / cleanup / fullscreen exit / session dispose 的数据流。
- [ ] 补详细中文注释，说明为什么控件必须和视频同层。

### 5.2 `frontend/聊天媒体编排.ts`

- [ ] 新增附件级预算裁决与投影。
- [ ] 让预算读取既能返回总数字，也能返回关键附件原因。
- [ ] 作为时间线视频表面判断的唯一上游。

### 5.3 `frontend/媒体运行时.ts`

- [ ] 只保留运行时 owner 事实与预算信号，不在这里重复做视图层拼装判断。
- [ ] 如有必要，补足当前 owner / warm candidate / viewerOpen 等投影字段。

### 5.4 `frontend/房间消息窗.ts`

- [ ] 删除或收敛本地直接拼 `shouldRevealCanonicalHost` / `shouldRenderPreviewVideo` 的分叉来源。
- [ ] 改成读取统一预算投影，再决定 DOM 表达。
- [ ] 确保不会因此打坏现有时间线宿主复用和无闪烁链。

### 5.5 `frontend/状态.ts`

- [ ] 为调试、预算测试和烟测增加结构化预算快照字段。
- [ ] 字段命名必须直接表达业务语义，禁止新增 `misc/meta/debug2` 一类模糊桶。

## 6. 验证清单

### 6.1 定向自动化验证

- [ ] `pnpm --dir frontend test -- --runInBand frontend/tests/媒体查看器测试.spec.ts`
- [ ] `pnpm --dir frontend test -- --runInBand frontend/tests/房间消息窗媒体查看器测试.spec.ts`
- [ ] 视改动范围补跑受影响的聊天媒体编排 / 状态投影测试。

### 6.2 构建与图谱验证

- [ ] `pnpm --dir frontend build`
- [ ] `graphify update .`

### 6.3 真实浏览器烟测

- [ ] 重新启动 `run.ps1`
- [ ] 进入房间 `1234b`
- [ ] 打开自动播放视频进入 viewer / fullscreen
- [ ] 验证关闭按钮在真浏览器里可点击命中，不再被 `VIDEO` 吃掉
- [ ] 退出 viewer 后再次点击同一视频，不出现“附件当前不可获取”
- [ ] 抽样读取结构化 budget snapshot，确认关键附件的重/轻原因能被解释
- [ ] 同时确认没有长回第二正式播放链

## 7. 完成标准

- [ ] 真浏览器全屏关闭按钮可用，点击命中正确
- [ ] viewer / fullscreen 关闭后时间线同附件仍可继续接管
- [ ] 时间线视频表面判断已有统一 owner 上游，不再是多处各猜各的
- [ ] 预算快照除总数外，还能解释关键附件为什么重、为什么轻
- [ ] 定向测试、构建、graphify、真实烟测全部新鲜通过
- [ ] `git status --short` 只有本轮必要变更

## 8. 自审

- [x] 计划直接对准真实烟测根因，不是表面 UI 补丁
- [x] 计划没有引入第二播放器、第二分发链或新 wrapper 层
- [x] 计划要求先失败测试、再最小实现、再重构，符合 TDD
- [x] 计划把验证拆成测试、构建、图谱、真实烟测四层，避免只看单一绿灯
- [x] 计划允许顺手修同 slice 的高价值 bug，但限制在相同 owner / 生命周期边界内，避免范围失控
