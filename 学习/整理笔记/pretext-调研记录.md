# 2026-04-09 pretext 调研记录

## 1. 本轮核对来源

- 官方仓库：`https://github.com/chenglou/pretext`
- 官方演示：`https://chenglou.me/pretext/`
- 版本状态：`@chenglou/pretext` `0.0.5`，发布日期是 **2026-04-09**
- 辅助文章：
  - `https://www.cnblogs.com/guangzan/p/19796050`
  - `https://aiia.ro/blog/pretext-js-tutorial-guide/`
  - `https://vectosolve.com/blog/pretext-svg-text-layout-300x-faster-2026`
  - `https://hackernoon.com/pretext-does-what-css-cant-measuring-text-before-the-dom-even-exists`

这轮结论以**官方 README / CHANGELOG / STATUS / benchmark JSON** 为准，博客文章只当理解补充，不当裁决依据。

## 2. 官方已证实的能力边界

`pretext` 是一个纯 JS/TS 的**多行文本测量与换行排版库**，不是 UI 框架，也不是浏览器排版引擎替代品。

当前官方已经明确提供两层能力：

1. `prepare()` + `layout()`
   - 适合“只要高度 / 行数”的场景。
   - `prepare()` 负责一次性分段、测量、缓存。
   - `layout()` 负责宽度变化后的纯算术热路径。
2. `prepareWithSegments()` + `layoutWithLines()` / `walkLineRanges()` / `layoutNextLineRange()`
   - 适合手动逐行排版、Canvas / SVG / WebGL 这类自绘场景。
3. `@chenglou/pretext/rich-inline`
   - 适合 inline rich text、mentions、chips 这类“行内富文本但不碰块级排版”的场景。

官方还明确写了这些边界：

1. 目前主要瞄准 `white-space: normal | pre-wrap`。
2. 目前主要瞄准 `word-break: normal | keep-all`。
3. 它做的是**水平排版计算**，`line-height` 仍由调用方自己提供。
4. 它不是完整 font rendering engine。
5. 它能给出换行与宽度，但**不是**自带完整 glyph positioning / 浏览器级排版还原。

## 3. 官方当前成熟度

从 2026-04-09 的官方状态文件看，成熟度比 4 月初高了一截，但仍应视作“快速演进中的专业库”，不是几十个版本沉淀后的基础设施。

已确认的点：

1. 浏览器精度 dashboard 标的是 Chrome / Safari / Firefox 各 `7680 / 7680` 命中。
2. 2026-04-09 发布的 `0.0.5` 新增了：
   - `measureLineStats()`
   - `measureNaturalWidth()`
   - `layoutNextLineRange()`
   - `materializeLineRange()`
   - `rich-inline`
   - `wordBreak: 'keep-all'`
   - markdown chat demo
3. 仓库里持续维护 accuracy / benchmark / corpus 三套检查数据，而不是只有 README 宣传。

这说明它不是 PPT 项目，但也说明它**变化还很快**，接入时要盯版本，不宜把整个前端文本层重心全押在它一个库上。

## 4. 该怎么看它的性能数字

官方 Chrome benchmark 当前大致是：

1. `prepare()`：500 段文本冷批次约 `20.05ms`
2. `layout()`：同批次热路径约 `0.1345ms`
3. `DOM batch`：约 `3.85ms`
4. `DOM interleaved`：约 `42ms`

这里要避免看宣传文案看歪：

1. `pretext` **不是所有阶段都比 DOM 快**。
   - 冷启动 `prepare()` 本身并不便宜。
   - 真正值钱的是“prepare 一次后，后续反复 layout 很便宜”。
2. 所谓“300x 更快”“600x 更快”，只能理解成**某些热路径 / 某些对照方式**下的量级宣传，不能机械外推到我们项目全部场景。
3. 真正适合它的，是：
   - 同一批文本要反复在不同宽度下算高度
   - 大量文本需要提前知道行数 / 高度
   - 不能接受反复 DOM reflow

## 5. 它不是什么

为了避免误判，这里反着记一遍：

1. 它不是 Lit / React / Vue 替代品。
2. 它不是聊天前端壳层框架。
3. 它不是状态管理。
4. 它不是滚动可见性观测器。
5. 它不能替代真实 DOM 里 `getBoundingClientRect()` 这种“已渲染后的位置事实”。
6. 它不能替代 socket.io-client，也不能替代我们现有实时链路。

## 6. Koko 当前前端现状

结合当前仓库实现，`pretext` 在 Koko 里**不能全面铺开**，原因不是它不强，而是我们当前前端问题结构不是“所有文本都值得先离开 DOM”。

### 6.1 当前文本渲染形态

现在消息区还是普通 DOM 消息流：

1. `frontend/房间消息窗.ts`
   - 用 `<div class="message-body">${item.body}</div>` 直接渲染正文。
2. `frontend/聊天壳.ts`
   - 用 CSS 控消息气泡宽度、换行、输入区和消息区布局。
3. `frontend/package.json`
   - 前端依赖只有 `lit`、`socket.io-client`、`xstate`，目前没有 `pretext`。

这说明我们现在不是 Canvas/SVG 自绘聊天界面，也没有单独的文本排版子系统。

### 6.2 当前真正依赖 DOM 真相的地方

`frontend/房间滚动器.ts` 现在用 `getBoundingClientRect()` 和 `scrollHeight` 做三件事：

1. 历史分页补偿
2. 已读锚点采样
3. 当前消息片段是否稳定可读

这些依赖的是**已经渲染后的真实视口位置**。  
`pretext` 能帮忙预测文本高度，但它替代不了：

1. 当前节点在视口里到底露出了多少像素
2. 历史前插后旧锚点相对顶部偏移了多少
3. 某条消息现在是否已经足够可读

所以它不能把现有滚动器整块替掉。

### 6.3 当前输入区也还没到它的甜区

现在唯一操作台还是单行 `<input>`，不是多行 `textarea` / 富文本编辑器。  
这意味着 `pre-wrap` / 输入区自适应高度预测这一块，在 Koko 当前版本里也不是高优先级。

## 7. 对 Koko 的最终判断

### 7.1 不能“全面使用”

结论先写死：**不能，也不应该把 Koko 项目“全面改成用 Pretext”。**

原因：

1. 它只解决“文本测量与换行排版”，不覆盖我们前端壳、实时链路、状态编排、DOM 视口事实。
2. 我们当前消息流仍然主要依赖浏览器正常块布局，这不是它要替掉的对象。
3. 我们当前滚动稳定性问题核心在“视口锚点与真实 DOM 几何”，不是“缺一个离线排版引擎”。
4. 当前输入区还是单行输入，不值得为了 `pretext` 先制造复杂度。

### 7.2 可以“局部使用”

如果后面确实遇到性能压力，`pretext` 适合放在**shell / presenter / 前端适配层的文本测量子模块**，而不是放进 `domain / application / contract`。

最值得试的场景只有这几类：

1. **消息高度预测 + 虚拟滚动**
   - 当消息量大到必须做虚拟列表时，用它提前算高度，减少猜高度和滚动跳动。
2. **大批量消息预排版**
   - 例如恢复房间后一次性渲染大量历史消息，先算高度缓存，再决定首屏切片和预留空间。
3. **未来的多行输入区**
   - 如果操作台升级成 `textarea` / 富文本输入，可用 `whiteSpace: 'pre-wrap'` 做高度预测。
4. **未来的 Canvas / SVG 特殊消息视图**
   - 例如富媒体卡片、自绘海报消息、可视化消息时间轴，这时它的逐行 API 才会真正放大价值。
5. **mentions / chips / inline rich text**
   - 如果未来聊天正文不是纯字符串，而是带 @人、标签、代码片段的 inline rich text，可评估 `rich-inline`。

## 8. 推荐接入策略

如果以后要接，不要一上来“全量接管消息文本”，而要走最小试点：

1. 先保持现有 DOM 消息流和滚动器不动。
2. 新建一个前端内部 `text-measure` 薄适配层，隔离 `pretext` API。
3. 第一阶段只做“消息高度预测 / 虚拟列表预研”。
4. 验证项必须包含：
   - 中英文混排
   - emoji
   - CJK
   - 长链接 / 超长连续字符串
   - 字体未加载完成时的偏差
   - 宽度变化后的重算成本
5. 如果只是普通 DOM 消息列表、消息量也还没到虚拟化门槛，就先别引入。

## 9. 现阶段建议

对 Koko 当前仓库，最稳的判断是：

1. **不做“全面上 Pretext”**。
2. **把它当未来前端性能子模块候选保留**。
3. **等出现真实痛点再试点**：
   - 消息列表虚拟化
   - 大批量历史恢复首屏稳定
   - 多行输入区
   - 自绘文本视图

一句话收口：

`pretext` 很强，但它强在“把文本测量从 DOM 里抽出来”；  
Koko 当前最核心的前端难点，仍然是“真实消息视口、锚点恢复、实时增量与壳层编排”。  
所以它适合做**局部增益轮子**，不适合被误用成“整个项目前端文本基础设施总替换”。
