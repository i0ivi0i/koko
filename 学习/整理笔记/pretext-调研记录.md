# 2026-04-04 pretext 调研记录

## 1. 拉取来源

- 仓库: `https://github.com/chenglou/pretext`
- 本地路径: `学习/pretext/`
- 拉取方式: `git clone --depth 1`

## 2. 它到底是什么

`pretext` 是一个纯 JS/TS 的**多行文本测量与换行排版库**，核心价值是：

1. 避免反复 DOM 测量（如 `getBoundingClientRect` / `offsetHeight`）造成 reflow。
2. 先 `prepare()` 预处理，再 `layout()` 走纯算术热路径。
3. 支持多语言、emoji、bidi 混排。

它不是前端 UI 框架，不负责组件系统、状态管理、路由或实时通信。

## 3. 对 Koko 群聊项目的直接价值

在“万人级实时群聊”里，`pretext` 适合做以下高价值点：

1. 消息列表高度预测与虚拟滚动（减少跳动和卡顿）。
2. 输入框多行高度预测（减少输入时布局抖动）。
3. 大量消息渲染前的文本排版预计算。

## 4. 与当前路线的关系

若前端改为纯 TS（Lit + socket.io-client）：

1. `pretext` 可以作为**文本排版性能子模块**接入。
2. 它不能替代 Lit，也不能替代 socket.io-client。
3. 最佳位置是“渲染性能增强层”，不是“前端主框架层”。

## 5. 结论

1. `pretext` 值得引入到新 TS 前端方案中，作为消息文本测量/排版优化轮子。
2. 它不适合作为前端整体架构替代品。
3. 推荐策略：先完成前端壳切换，再在消息列表和输入区落 `pretext` 优化。
