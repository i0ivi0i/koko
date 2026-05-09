# 媒体拼贴布局重构：Telegram Mosaic 算法

## 目标

将多附件消息的布局从固定尺寸 CSS Grid 改为 Telegram 同源的比例自适应绝对定位布局，消除横屏视频在竖向格子中的黑边和自动播闪烁。

## 问题

当前 `规划媒体拼贴布局` 只按附件数量选模板，所有格子统一 portrait 比例（1:1.28）。横屏视频被强塞进竖格子，`object-fit: cover` 暴力裁切 60%+ 画面，且视频解码前后尺寸突变导致闪烁。

## 方案

移植 Telegram Web K 的 `groupedLayout.ts` 算法（GPLv3，已验证万人群场景）：

### 核心算法

1. **输入**：每个附件的 `{w, h}`，容器 `maxWidth`（当前 384px）
2. **分类**：`ratio = w/h`，`>1.2` 为横(w)，`<0.8` 为竖(n)，否则方(q)
3. **模板选择**：按 proportions 字符串 + 数量选择布局策略
4. **输出**：每个附件的绝对几何 `{x, y, width, height}`，容器总高度

### 布局策略（≤4 张）

| 数量 | 条件 | 布局 |
|------|------|------|
| 1 | - | 按比例缩放到 maxWidth |
| 2 | 都横 + 接近比例 | 上下叠放 |
| 2 | 都横/都方 | 等宽左右 |
| 2 | 混合 | 按比例分左右宽度 |
| 3 | 首张竖 | 左列满高 + 右列两张叠 |
| 3 | 首张横 | 上行满宽 + 下行两张并排 |
| 4 | 首张横 | 上行满宽 + 下行三张按比例 |
| 4 | 首张竖 | 左列满高 + 右列三张叠 |

### 布局策略（≥5 张）

暴力搜索最优行分配：枚举所有 2-4 行分法，每行内按 ratio 等比分宽，选总高最接近 maxHeight 的方案。

### 渲染方式

- 容器：`position: relative; width: {maxWidth}px; height: {totalHeight}px`
- 卡片：`position: absolute; left/top/width/height` 由算法输出
- 媒体：`width: 100%; height: 100%; object-fit: cover`（裁切量极小）

## 约束

- **maxWidth**：`Math.max(248, Math.min(layoutEnv.maxContentWidth, 384))`（沿用现有）
- **maxHeight**：`Math.round(maxWidth * 4 / 3)`（Telegram ComplexLayouter 默认值）
- **minWidth**：`Math.round(maxWidth * 0.17)`（约 65px，Telegram 按比例推导）
- **spacing**：`8`（沿用现有间距）

## 边界情况

- 附件 `width` 或 `height` 为 0/未知 → fallback 为 1:1（ratio = 1.0）
- 单附件 → 保持现有按比例缩放逻辑，不走 mosaic 算法
- 附件数 > 10 → 截断为前 10 张参与布局（Telegram 上限）

## 不变的

- 视频附件渲染链（poster/preview/frozen-frame/canonical）
- 媒体播放器 owner 逻辑
- 虚拟列表复用机制
- 单附件消息的布局（保持现有按比例缩放）

## Interface 变化

- `媒体附件拼贴布局` → 新增 `totalHeight: number`，删除 `template/columnCount/rowHeight`
- `图片附件展示项` / `视频附件展示项` → `gridColumnStart/Span/gridRowStart/Span` 改为 `layoutX/layoutY/layoutWidth/layoutHeight`
- `displayWidth`/`displayHeight` 语义不变（= layoutWidth/layoutHeight），保持下游渲染兼容
- 新增纯函数模块 `媒体拼贴几何.ts`（零依赖，可独立测试）

## 影响文件

1. `frontend/房间消息窗/媒体拼贴几何.ts` — **新建**，Telegram Layouter 算法纯函数
2. `frontend/房间消息窗/视图.ts` — 删除 `规划媒体拼贴布局`，改用新模块；适配 `派生媒体附件展示结果` + `计算媒体附件气泡宽度`
3. `frontend/房间消息窗/附件渲染.ts` — grid div → relative 容器 + absolute 卡片；`读取附件卡片样式` 改为输出 left/top/width/height
4. `frontend/应用根/聊天壳样式.ts` — 删 `.message-attachment-grid` 的 grid 样式，改为 relative 容器；确认无其他组件依赖被删选择器
5. `frontend/tests/` — 新增 `媒体拼贴几何.spec.ts` 纯函数测试

## 验收标准

1. 纯函数测试：每个卡片的 `width/height` 与媒体原始 `w/h` 比例差 < 15%
2. 纯函数测试：所有卡片 x+width ≤ maxWidth，y+height ≤ totalHeight（无溢出）
3. 纯函数测试：相邻卡片间距 = spacing（无缝隙无重叠）
4. 视觉验证：1 竖 + 1 横混排，两张都填满各自卡片
5. 视觉验证：3-6 张混合比例媒体，整体紧凑
6. 运行时验证：自动播无闪烁（容器高度由算法预确定）
7. 运行时验证：虚拟列表滚动性能无退化
