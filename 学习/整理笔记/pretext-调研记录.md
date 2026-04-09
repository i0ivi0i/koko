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

## 7. 重新定义“全面使用”

如果按官方能力来理解，`Pretext` 的“全面使用”不能等于“整个前端都被 Pretext 替代”，但可以等于：

**Web 前端里凡是文本几何相关的裁决，都以 `Pretext` 为唯一权威。**

这里的“文本几何”包括：

1. 文本高度
2. 行数
3. 换行位置
4. 气泡自然宽度 / 收缩宽度
5. 输入区文本尺寸
6. inline rich text 的碎片换行
7. 虚拟列表需要的消息尺寸预测

换句话说，真正能“全面 Pretext 化”的，是**Web 前端文本几何层**，不是整个 Web 前端的全部职责。

## 8. 全面 Pretext 化后，浏览器还剩什么职责

即使采用最激进方案，浏览器和 DOM 仍然不可消失，只是职责会收缩：

1. 真实视口几何
   - 节点当前到底露出了多少像素
   - 当前相对容器顶部的偏移
   - `scrollTop / scrollHeight`
2. 交互宿主
   - 点击
   - 输入事件
   - 滚动事件
   - 焦点
3. 最终表达层
   - 把 `Pretext` 算好的几何 / 行结果表达成 DOM

所以更准确的说法是：

1. **文本几何主权上收给 `Pretext`**
2. **视口事实和交互事实仍然属于 DOM**

这也是为什么我前面把 `getBoundingClientRect()` 和 `scrollHeight` 单独拎出来。  
那不是在否定全面 Pretext 化，而是在划清**它该统治哪一层**。

## 9. 如果 Koko 要走 Web 前端全面 Pretext 化，真正应该改什么

这轮重新学习后，更准确的判断是：

### 9.1 应该全面交给 `Pretext` 的

1. 消息正文的高度预测
2. 消息正文的换行结果
3. 消息气泡的目标宽度 / 收缩宽度
4. 首屏恢复和历史补页时的大批量消息尺寸预计算
5. 未来虚拟列表的 item 尺寸权威
6. 输入区从单行走向多行后的文本高度预测
7. `@人`、chip、code span 这类 inline rich text 的行内排版

### 9.2 不该交给 `Pretext` 的

1. 房间恢复状态机
2. realtime 事件并流
3. 已读推进的业务裁决
4. 真实视口可见性采样
5. 历史补偿时锚点消息相对顶部偏移的最终校正

### 9.3 这意味着架构上要新增一层

如果我们真要“全部 Pretext”，就不能只在某个组件里零散调用 `prepare()`。

必须新增一个稳定边界：

**前端文本几何层**

它的职责是：

1. 输入：
   - 文本内容
   - 字体
   - 最大宽度
   - 行高
   - white-space / word-break 规则
2. 输出：
   - 高度
   - 行数
   - 每行范围 / 每行文本
   - 自然宽度
   - rich-inline 布局片段

然后让：

1. `视图 presenter`
2. `消息窗口`
3. `未来虚拟列表`
4. `输入区`

都只消费这层结果，而不是各自再猜。

## 10. 官方能力对“全面 Pretext 化”的支撑点

重新核对后，支持全面 Pretext 化设计的官方事实主要是：

1. `README` 已明确把使用场景分成：
   - 无 DOM 的段落高度预测
   - 手动逐行布局
2. 项目主页和 README 都把目标表述成：
   - DOM
   - Canvas
   - SVG
   - 未来 server-side
3. `0.0.5` 新增：
   - `measureLineStats()`
   - `measureNaturalWidth()`
   - `layoutNextLineRange()`
   - `materializeLineRange()`
   - `rich-inline`
   - virtualized markdown chat demo

这些点合在一起，说明它已经不是只有“量个高度”的玩具 API。  
它已经具备做 **Web 文本几何基础设施** 的雏形。

## 11. 对 Koko 的修正后判断

修正后的判断应该是：

1. **Koko 不适合把 Pretext 误当成整个前端的总替代品**
2. **但 Koko 完全可以把 Web 前端的文本几何层全面交给 Pretext**
3. **一旦这样做，就不该再停留在“局部优化插件”思路，而应直接按基础设施层重组消息渲染**

这和我前一版笔记的差别在于：

1. 前一版更多站在“当前 DOM 消息流还没必要全改”的现实角度
2. 这一版补上了“如果战略目标就是全面 Pretext 化，那它该全面到哪一层”的架构定义

## 12. 走到这一步时，真正的分叉点

如果要全面 Pretext 化，Web 前端有 3 条路：

1. **几何权威化**
   - `Pretext` 负责所有文本尺寸
   - DOM 仍负责最终自然换行显示
2. **行布局权威化**
   - `Pretext` 既负责尺寸，也负责逐行切分
   - DOM 只表达 `Pretext` 已算好的行结果
3. **富文本权威化**
   - 连 mentions / chips / code span / 输入区富文本都纳入 `Pretext` / `rich-inline`

这三条不是互斥，而是逐级加码。

## 13. 当前更准确的一句话结论

`Pretext` 最强的地方，不只是“减少 reflow”，而是让 **文本几何在 DOM 出现之前就先成立**。  

所以如果 Koko 的战略目标真是“Web 前端全面 Pretext 化”，那正确姿势不是把它当零散优化轮子，而是：

**把它立成 Web 前端文本几何主权层，再让消息列表、恢复首屏、虚拟化、输入区、inline rich text 全部向这层收口。**

## 14. 官方使用方法说明

这一节只讲“怎么用”，不再重复架构判断。

### 14.1 安装

官方安装方式：

```sh
npm install @chenglou/pretext
```

当前 npm 包信息：

1. 包名：`@chenglou/pretext`
2. 当前版本：`0.0.5`
3. 模块格式：ESM
4. 额外导出：`@chenglou/pretext/rich-inline`

### 14.2 最基础用法：只算高度 / 行数

适合：

1. 消息高度预测
2. 输入区多行高度预测
3. 虚拟列表 item 尺寸预估
4. 首屏恢复前的消息块预留空间

官方 API 组合：

1. `prepare(text, font, options?)`
2. `layout(prepared, maxWidth, lineHeight)`

要点：

1. `prepare()` 做一次性分段、测量、缓存
2. 同一段文本不要反复 `prepare()`
3. 宽度变化时只重跑 `layout()`
4. `font` 必须和最终 CSS `font` 简写保持一致
5. `lineHeight` 也必须和最终 CSS `line-height` 对齐

适合 Koko 的理解：

1. 消息事件并入后，先按“消息正文 + 字体 + 气泡目标宽度”得到高度
2. 再决定消息气泡尺寸、首屏预留空间、虚拟列表尺寸缓存

### 14.3 `pre-wrap` 用法：textarea / 多行输入

适合：

1. 多行输入框
2. 保留普通空格、`\t`、`\n` 的文本
3. 草稿区高度预测

官方方式是在 `prepare()` 时加：

```ts
{ whiteSpace: 'pre-wrap' }
```

这点对 Koko 很关键，因为如果后面把单行操作台升级成多行输入区，不能再靠浏览器事后撑高来猜尺寸。

### 14.4 手动逐行布局：消息正文换行主权

适合：

1. 彻底接管消息正文换行
2. 消息气泡 shrink-wrap
3. Canvas / SVG / DOM 自定义逐行渲染
4. 恢复首屏时按行级结果做稳定布局

核心 API：

1. `prepareWithSegments()`
2. `layoutWithLines()`
3. `measureLineStats()`
4. `walkLineRanges()`
5. `layoutNextLineRange()`
6. `materializeLineRange()`
7. `measureNaturalWidth()`

各自最适合什么：

1. `layoutWithLines()`
   - 一次拿到固定宽度下的所有行文本
   - 最适合 DOM 按行渲染
2. `measureLineStats()`
   - 只拿 `lineCount` 和 `maxLineWidth`
   - 最适合热路径统计，不分配多余字符串
3. `walkLineRanges()`
   - 只拿行范围，不立即 materialize 文本
   - 最适合先做宽度试探、binary search、shrink-wrap
4. `layoutNextLineRange()`
   - 适合逐行流式布局，尤其是不同 y 区域宽度不一样的场景
5. `materializeLineRange()`
   - 在需要真正渲染该行时，再把 range 转成行文本
6. `measureNaturalWidth()`
   - 适合先求文本最自然的目标宽度，再收缩气泡

如果 Koko 真要“全面 Pretext 化”，消息正文主链更像这样：

1. 事件文本进入文本几何层
2. `prepareWithSegments()`
3. 先用 `measureNaturalWidth()` / `measureLineStats()` 决定气泡宽度
4. 再用 `layoutWithLines()` 或 `walkLineRanges() + materializeLineRange()` 得到逐行结果
5. DOM 只表达这些结果

### 14.5 `rich-inline` 用法：mentions / chips / code span

适合：

1. `@人`
2. tag / pill
3. code span
4. 行内混合字体、混合片段

核心 API：

1. `prepareRichInline(items)`
2. `layoutNextRichInlineLineRange()`
3. `walkRichInlineLineRanges()`
4. `materializeRichInlineLineRange()`
5. `measureRichInlineStats()`

它的定位官方写得很明确：

1. 只做 inline
2. 只做 `white-space: normal`
3. 不是完整嵌套 markup tree 引擎
4. `break: 'never'` 很适合 mentions / chip 这种原子片段
5. `extraWidth` 由调用方提供，很适合 pill chrome

对 Koko 的映射就是：

1. 纯文本消息正文走 `prepareWithSegments()`
2. 富文本消息正文走 `rich-inline`
3. 不要混成第二套私有 inline 布局轮子

### 14.6 官方 demo 和本地运行方式

官方仓库给的本地 demo 方式：

1. `bun install`
2. `bun start`
3. Windows：`bun run start:windows`
4. 打开 `/demos/index`

这不是生产接入方式，但很适合我们后面做：

1. 文本宽度实验
2. 气泡 shrink-wrap 试验
3. virtualized chat 方案比对

## 15. 对 Koko 的 API 选型建议

如果以后真按“最全面极限”走，Web 前端里的 API 选择应该直接固定：

### 15.1 消息正文

默认：

1. `prepareWithSegments()`
2. `measureNaturalWidth()`
3. `measureLineStats()`
4. `layoutWithLines()`

原因：

1. 既要宽度
2. 又要高度
3. 又要最终逐行结果

### 15.2 热路径宽度试探

默认：

1. `walkLineRanges()`
2. `measureLineStats()`

原因：

1. 少分配字符串
2. 适合大量消息批量试探宽度

### 15.3 富文本正文

默认：

1. `prepareRichInline()`
2. `walkRichInlineLineRanges()`
3. `materializeRichInlineLineRange()`

### 15.4 多行输入区

默认：

1. `prepare()`
2. `layout()`
3. `whiteSpace: 'pre-wrap'`

## 16. 使用时必须记住的官方限制

这些限制在“全面 Pretext 化”时尤其不能忘：

1. 它不是完整 font rendering engine
2. 它现在主要覆盖：
   - `white-space: normal | pre-wrap`
   - `word-break: normal | keep-all`
   - `overflow-wrap: break-word`
   - `line-break: auto`
3. `system-ui` 在 macOS 上官方明确说精度不安全，应该用命名字体
4. `prepare()` / `prepareWithSegments()` 主要做水平布局分析，`lineHeight` 仍由调用方决定
5. segment width 是 browser-canvas width，不等于完整 glyph positioning
6. `rich-inline` 是故意做窄的，不是完整富文本排版引擎

所以 Koko 要全面接它，不是“无脑把所有文本都塞进去”，而是：

1. 统一字体契约
2. 统一行高契约
3. 统一消息文本几何输入输出
4. 避免超出它当前官方覆盖面的 CSS 排版特性

## 17. 二手文章的价值怎么取

这几篇文章里，真正有用的部分主要是：

1. 博客园文章
   - 对 `prepare/layout`
   - `layoutWithLines`
   - textarea `pre-wrap`
   - shrink-wrap / virtualization 场景的解释比较接地气
2. HackerNoon / 其它文章
   - 更像宣传和问题意识强化
   - 可以帮助理解“text before DOM”的价值
   - 但不应拿来代替官方 API 和 caveat

这轮我没把二手文章当裁决依据，只把它们当“帮助确认使用场景”的外圈材料。

## 18. 本仓库落地时新增确认的实现坑点

这部分不是官方 README 原句，而是 2026-04-09 这轮在 Koko Web 前端真实接入后确认下来的工程结论。

### 18.1 测试环境也必须给 `Pretext` 提供测量宿主

`Pretext` 在浏览器里依赖 `OffscreenCanvas` 或可用的 canvas 2D context。
这意味着：

1. 业务代码可以直接跑在浏览器里
2. 但 `happy-dom` 这类测试环境如果没有可用测量宿主，spec 会直接炸

Koko 这轮已经遇到过一次真实回归：

1. 普通聊天集成 spec 因为复用了测试支架里的测量 shim，所以是绿的
2. 独立 `端到端测试.spec.ts` 没有复用那层支架，结果 `Pretext` 直接在测试里崩掉

所以这里要记死一个实践规则：

**只要测试进程会执行 `Pretext` 布局，就必须统一安装测试测量宿主；这个 shim 只放测试，不要混进运行时代码。**

### 18.2 一旦文本几何主权上收，宿主尺寸变化就要主动触发重排

接入前，消息气泡宽度和输入区高度很多时候还能靠浏览器自然流在 resize 后“顺手变对”。
接入后，如果消息气泡宽度、输入区高度都改成由 `Pretext` 结果驱动，就会多出一个新的责任：

1. viewport 变窄了
2. 壳层必须主动重新 render
3. `Pretext` 才会按新宽度重算消息气泡和输入区高度

Koko 这轮也已经踩到这个坑：

1. 初始宽屏布局是对的
2. `window.innerWidth` 变小后，消息气泡仍挂着旧宽度
3. 根因不是 `Pretext` 算错，而是壳层没有在 resize 后请求重渲染

所以这里要把规则记成一句硬约束：

**只要文本几何由 `Pretext` 主导，宿主尺寸变化就必须有显式刷新入口；否则会留下“DOM 变窄了，文本几何还是旧值”的隐性错位。**

### 18.3 共享缓存要收口成同一个布局器实例

`Pretext` 的价值之一是“同一份文本先 `prepare`，后续不同宽度下反复 `layout`”。
在 Koko 这种聊天前端里，消息列表和输入区会同时消费同一套字体和文本布局能力。

如果每个 presenter / component 各自 new 一份布局器，就会产生两个问题：

1. 相同文本在同一页面里重复 `prepare`
2. 页面级测量缓存被拆散，热路径收益被打折

所以当前更合理的收口方式是：

1. 保留一个唯一的 `frontend/文本布局.ts`
2. 由它导出共享布局器实例
3. 消息展示项和输入区共用这份缓存

这不是为了造“单例模式”的仪式感，而是为了守住：

**同一张页面里的文本几何缓存也应只有一个 owner。**
