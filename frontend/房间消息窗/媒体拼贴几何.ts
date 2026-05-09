/**
 * 媒体拼贴几何算法 — 移植自 Telegram Web K groupedLayout.ts
 *
 * 核心思想：
 * 1. 每个媒体按自身宽高比 (ratio = w/h) 参与布局计算；
 * 2. 根据媒体数量和 ratio 组合，选择最优的排列模板；
 * 3. 输出每个媒体的绝对坐标 {x, y, width, height}，容器只需 position: relative。
 *
 * 性能：纯数学计算，O(n) 级别，适合万人群聊高频消息流。
 * 来源：https://github.com/nicegram/nicegram-web-k (GPLv3)
 */

/* ── 公开类型 ── */

/** 媒体的原始像素尺寸 */
export interface 媒体尺寸 {
  w: number;
  h: number;
}

/** 布局配置参数 */
export interface 拼贴配置 {
  /** 容器最大宽度（px） */
  maxWidth: number;
  /** 卡片间距（px） */
  spacing: number;
}

/** 单个媒体在容器中的绝对位置和尺寸 */
export interface 拼贴项几何 {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 布局计算结果 */
export interface 拼贴结果 {
  /** 每个媒体的绝对几何 */
  items: 拼贴项几何[];
  /** 容器总高度 */
  totalHeight: number;
  /** 容器内容宽度（= maxWidth） */
  contentWidth: number;
}

/* ── 内部工具 ── */

/** 安全索引：内部函数由调用方保证数组长度，默认值 1 仅为满足 TS 严格模式 */
function 取(arr: readonly number[], i: number): number {
  return arr[i] ?? 1;
}

/** 累加数组元素 */
function 累加(arr: number[], initial: number): number {
  let sum = initial;
  for (const v of arr) sum += v;
  return sum;
}

/** 将值限制在 [min, max] 范围 */
function 夹紧(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 将 Telegram 内部 geometry 列表转为公开的 拼贴结果。
 * Telegram 算法输出 {x, y, width, height, sides}，
 * 我们只取前四项，并计算容器总高度。
 */
function 转换为拼贴结果(
  geometries: Array<{ x: number; y: number; width: number; height: number }>,
  maxWidth: number
): 拼贴结果 {
  let totalHeight = 0;
  const items: 拼贴项几何[] = [];
  for (const g of geometries) {
    items.push({
      x: Math.round(g.x),
      y: Math.round(g.y),
      width: Math.round(g.width),
      height: Math.round(g.height),
    });
    totalHeight = Math.max(totalHeight, Math.round(g.y + g.height));
  }
  return { items, totalHeight, contentWidth: maxWidth };
}

/* ── 公开入口 ── */

/**
 * 计算多媒体附件的拼贴几何布局。
 *
 * @param sizes - 每个媒体的原始像素尺寸
 * @param config - 布局配置（maxWidth, spacing）
 * @returns 每个媒体的绝对坐标和容器总高度
 */
export function 计算媒体拼贴几何(
  sizes: 媒体尺寸[],
  config: 拼贴配置
): 拼贴结果 {
  const { maxWidth, spacing } = config;

  /* 边界情况：空输入 */
  if (sizes.length === 0) {
    return { items: [], totalHeight: 0, contentWidth: maxWidth };
  }

  /* 截断到 10 张（Telegram 上限） */
  const count = Math.min(sizes.length, 10);

  /* 安全化尺寸：0 或负值 fallback 为 1:1 */
  const safeSizes = sizes.slice(0, count).map((s) => ({
    w: s.w > 0 ? s.w : 1,
    h: s.h > 0 ? s.h : 1,
  }));

  /* 单张走简单按比例缩放 */
  if (count === 1) {
    return 布局单张(safeSizes[0]!, maxWidth);
  }

  /* 计算每张的宽高比 */
  const ratios = safeSizes.map((s) => s.w / s.h);

  /* 分类：w=横屏(>1.2), n=竖屏(<0.8), q=方形 */
  const proportions = ratios
    .map((r) => (r > 1.2 ? "w" : r < 0.8 ? "n" : "q"))
    .join("");

  /* 平均比例 */
  const averageRatio = 累加(ratios, 0) / count;

  /* maxHeight = maxWidth * 4/3（Telegram ComplexLayouter 默认值） */
  const maxHeight = Math.round((maxWidth * 4) / 3);

  /* 最小卡片宽度 */
  const minWidth = Math.round(maxWidth * 0.17);

  /* 5+ 张或有超宽比例 → 复杂布局搜索 */
  if (count >= 5 || ratios.some((r) => r > 2)) {
    return 复杂布局(ratios, averageRatio, maxWidth, minWidth, spacing, maxHeight);
  }

  /* 2~4 张走精确模板 */
  if (count === 2) return 布局两张(ratios, proportions, maxWidth, minWidth, spacing, maxHeight);
  if (count === 3) return 布局三张(ratios, proportions, maxWidth, minWidth, spacing, maxHeight);
  return 布局四张(ratios, proportions, maxWidth, minWidth, spacing, maxHeight);
}

/* ── 单张布局 ── */

function 布局单张(size: 媒体尺寸, maxWidth: number): 拼贴结果 {
  const width = maxWidth;
  const height = Math.round((size.h * width) / size.w);
  return {
    items: [{ x: 0, y: 0, width, height }],
    totalHeight: height,
    contentWidth: maxWidth,
  };
}

/* ── 两张布局 ── */

function 布局两张(
  ratios: number[],
  proportions: string,
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const maxSizeRatio = maxWidth / maxHeight;
  const averageRatio = (取(ratios, 0) + 取(ratios, 1)) / 2;

  /* 两张都横 + 比例接近 + 偏宽 → 上下叠 */
  if (
    proportions === "ww" &&
    averageRatio > 1.4 * maxSizeRatio &&
    取(ratios, 1) - 取(ratios, 0) < 0.2
  ) {
    return 两张上下叠(ratios, maxWidth, spacing, maxHeight);
  }

  /* 两张都横或都方 → 等宽左右 */
  if (proportions === "ww" || proportions === "qq") {
    return 两张等宽左右(ratios, maxWidth, spacing, maxHeight);
  }

  /* 混合 → 按比例分宽 */
  return 两张按比例左右(ratios, maxWidth, minWidth, spacing, maxHeight);
}

/** 两张上下叠放 */
function 两张上下叠(
  ratios: number[],
  maxWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const width = maxWidth;
  const height = Math.round(
    Math.min(
      width / 取(ratios, 0),
      Math.min(width / 取(ratios, 1), (maxHeight - spacing) / 2)
    )
  );
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width, height },
      { x: 0, y: height + spacing, width, height },
    ],
    maxWidth
  );
}

/** 两张等宽左右排列 */
function 两张等宽左右(
  ratios: number[],
  maxWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const width = (maxWidth - spacing) / 2;
  const height = Math.round(
    Math.min(width / 取(ratios, 0), Math.min(width / 取(ratios, 1), maxHeight))
  );
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width, height },
      { x: width + spacing, y: 0, width, height },
    ],
    maxWidth
  );
}

/** 两张按比例分左右宽度 */
function 两张按比例左右(
  ratios: number[],
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const minimalWidth = Math.round(minWidth * 1.5);
  const secondWidth = Math.min(
    Math.round(
      Math.max(
        0.4 * (maxWidth - spacing),
        ((maxWidth - spacing) / 取(ratios, 0)) * (1 / (1 / 取(ratios, 0) + 1 / 取(ratios, 1)))
      )
    ),
    maxWidth - spacing - minimalWidth
  );
  const firstWidth = maxWidth - secondWidth - spacing;
  const height = Math.min(
    maxHeight,
    Math.round(Math.min(firstWidth / 取(ratios, 0), secondWidth / 取(ratios, 1)))
  );
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width: firstWidth, height },
      { x: firstWidth + spacing, y: 0, width: secondWidth, height },
    ],
    maxWidth
  );
}

/* ── 三张布局 ── */

function 布局三张(
  ratios: number[],
  proportions: string,
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  /* 首张竖屏 → 左列满高 + 右列两张叠 */
  if (proportions[0] === "n") {
    return 三张左加右叠(ratios, maxWidth, minWidth, spacing, maxHeight);
  }
  /* 首张横屏/方形 → 上行满宽 + 下行两张并排 */
  return 三张上加下排(ratios, maxWidth, spacing, maxHeight);
}

/** 三张：左列满高 + 右列两张叠 */
function 三张左加右叠(
  ratios: number[],
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const firstHeight = maxHeight;
  const thirdHeight = Math.round(
    Math.min(
      (maxHeight - spacing) / 2,
      (取(ratios, 1) * (maxWidth - spacing)) / (取(ratios, 2) + 取(ratios, 1))
    )
  );
  const secondHeight = firstHeight - thirdHeight - spacing;
  const rightWidth = Math.max(
    minWidth,
    Math.round(
      Math.min(
        (maxWidth - spacing) / 2,
        Math.min(thirdHeight * 取(ratios, 2), secondHeight * 取(ratios, 1))
      )
    )
  );
  const leftWidth = Math.min(
    Math.round(firstHeight * 取(ratios, 0)),
    maxWidth - spacing - rightWidth
  );
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width: leftWidth, height: firstHeight },
      { x: leftWidth + spacing, y: 0, width: rightWidth, height: secondHeight },
      {
        x: leftWidth + spacing,
        y: secondHeight + spacing,
        width: rightWidth,
        height: thirdHeight,
      },
    ],
    maxWidth
  );
}

/** 三张：上行满宽 + 下行两张并排 */
function 三张上加下排(
  ratios: number[],
  maxWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const firstWidth = maxWidth;
  const firstHeight = Math.round(
    Math.min(firstWidth / 取(ratios, 0), (maxHeight - spacing) * 0.66)
  );
  const secondWidth = (maxWidth - spacing) / 2;
  const secondHeight = Math.min(
    maxHeight - firstHeight - spacing,
    Math.round(Math.min(secondWidth / 取(ratios, 1), secondWidth / 取(ratios, 2)))
  );
  const thirdWidth = firstWidth - secondWidth - spacing;
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width: firstWidth, height: firstHeight },
      {
        x: 0,
        y: firstHeight + spacing,
        width: secondWidth,
        height: secondHeight,
      },
      {
        x: secondWidth + spacing,
        y: firstHeight + spacing,
        width: thirdWidth,
        height: secondHeight,
      },
    ],
    maxWidth
  );
}

/* ── 四张布局 ── */

function 布局四张(
  ratios: number[],
  proportions: string,
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  /* 首张横屏 → 上行满宽 + 下行三张按比例 */
  if (proportions[0] === "w") {
    return 四张上加下三列(ratios, maxWidth, minWidth, spacing, maxHeight);
  }
  /* 首张竖屏/方形 → 左列满高 + 右列三张叠 */
  return 四张左加右三叠(ratios, maxWidth, minWidth, spacing, maxHeight);
}

/** 四张：上行满宽 + 下行三张按比例并排 */
function 四张上加下三列(
  ratios: number[],
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const w = maxWidth;
  const h0 = Math.round(
    Math.min(w / 取(ratios, 0), (maxHeight - spacing) * 0.66)
  );
  const h = Math.round(
    (maxWidth - 2 * spacing) / (取(ratios, 1) + 取(ratios, 2) + 取(ratios, 3))
  );
  const w0 = Math.max(
    minWidth,
    Math.round(Math.min((maxWidth - 2 * spacing) * 0.4, h * 取(ratios, 1)))
  );
  const w2 = Math.round(
    Math.max(
      Math.max(minWidth, (maxWidth - 2 * spacing) * 0.33),
      h * 取(ratios, 3)
    )
  );
  const w1 = w - w0 - w2 - 2 * spacing;
  const h1 = Math.min(maxHeight - h0 - spacing, h);
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width: w, height: h0 },
      { x: 0, y: h0 + spacing, width: w0, height: h1 },
      { x: w0 + spacing, y: h0 + spacing, width: w1, height: h1 },
      { x: w0 + spacing + w1 + spacing, y: h0 + spacing, width: w2, height: h1 },
    ],
    maxWidth
  );
}

/** 四张：左列满高 + 右列三张叠放 */
function 四张左加右三叠(
  ratios: number[],
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const h = maxHeight;
  const w0 = Math.round(
    Math.min(h * 取(ratios, 0), (maxWidth - spacing) * 0.6)
  );
  const w = Math.round(
    (maxHeight - 2 * spacing) /
      (1 / 取(ratios, 1) + 1 / 取(ratios, 2) + 1 / 取(ratios, 3))
  );
  const h0 = Math.round(w / 取(ratios, 1));
  const h1 = Math.round(w / 取(ratios, 2));
  const h2 = h - h0 - h1 - 2 * spacing;
  const w1 = Math.max(minWidth, Math.min(maxWidth - w0 - spacing, w));
  return 转换为拼贴结果(
    [
      { x: 0, y: 0, width: w0, height: h },
      { x: w0 + spacing, y: 0, width: w1, height: h0 },
      { x: w0 + spacing, y: h0 + spacing, width: w1, height: h1 },
      { x: w0 + spacing, y: h0 + h1 + 2 * spacing, width: w1, height: h2 },
    ],
    maxWidth
  );
}

/* ── 复杂布局（5+ 张）── */

/**
 * 暴力搜索最优行分配方案（Telegram ComplexLayouter）：
 * 枚举所有 2-4 行的分法，每行内按 ratio 等比分宽，
 * 选总高最接近 maxHeight 的方案。
 */
function 复杂布局(
  rawRatios: number[],
  averageRatio: number,
  maxWidth: number,
  minWidth: number,
  spacing: number,
  maxHeight: number
): 拼贴结果 {
  const count = rawRatios.length;

  /* 先裁剪极端比例，Telegram 的做法 */
  const maxRatio = 2.75;
  const minRatio = 0.6667;
  const ratios = rawRatios.map((r) =>
    averageRatio > 1.1 ? 夹紧(r, 1, maxRatio) : 夹紧(r, minRatio, 1)
  );

  /** 计算一行内多个媒体的行高 */
  const 计算行高 = (offset: number, lineCount: number): number => {
    const slice = ratios.slice(offset, offset + lineCount);
    const sum = 累加(slice, 0);
    return (maxWidth - (lineCount - 1) * spacing) / sum;
  };

  /* 枚举所有行分配方案 */
  interface 方案 {
    lineCounts: number[];
    heights: number[];
  }
  const 候选方案: 方案[] = [];

  const 添加方案 = (lineCounts: number[]): void => {
    const heights: number[] = [];
    let offset = 0;
    for (const lc of lineCounts) {
      heights.push(计算行高(offset, lc));
      offset += lc;
    }
    候选方案.push({ lineCounts, heights });
  };

  /* 2 行分法 */
  for (let first = 1; first < count; first++) {
    const second = count - first;
    if (first > 3 || second > 3) continue;
    添加方案([first, second]);
  }

  /* 3 行分法 */
  for (let first = 1; first < count - 1; first++) {
    for (let second = 1; second < count - first; second++) {
      const third = count - first - second;
      if (first > 3 || second > (averageRatio < 0.85 ? 4 : 3) || third > 3) continue;
      添加方案([first, second, third]);
    }
  }

  /* 4 行分法 */
  for (let first = 1; first < count - 2; first++) {
    for (let second = 1; second < count - first - 1; second++) {
      for (let third = 1; third < count - first - second; third++) {
        const fourth = count - first - second - third;
        if (first > 3 || second > 3 || third > 3 || fourth > 3) continue;
        添加方案([first, second, third, fourth]);
      }
    }
  }

  /* 选最优方案：总高最接近 maxHeight */
  let 最优方案: 方案 | null = null;
  let 最优差值 = Infinity;

  for (const attempt of 候选方案) {
    const { heights, lineCounts: counts } = attempt;
    const lineCount = counts.length;
    const totalHeight = 累加(heights, 0) + spacing * (lineCount - 1);
    const minLineHeight = Math.min(...heights);
    /* 惩罚因子：行高过小或行数递减都扣分 */
    const bad1 = minLineHeight < minWidth ? 1.5 : 1;
    let bad2 = 1;
    for (let line = 1; line < lineCount; line++) {
      if ((counts[line - 1] ?? 0) > (counts[line] ?? 0)) {
        bad2 = 1.5;
        break;
      }
    }
    const diff = Math.abs(totalHeight - maxHeight) * bad1 * bad2;
    if (!最优方案 || diff < 最优差值) {
      最优方案 = attempt;
      最优差值 = diff;
    }
  }

  /* 如果没有找到任何方案（理论上不会），fallback 为等宽排列 */
  if (!最优方案) {
    return 均分兜底(rawRatios, maxWidth, spacing);
  }

  /* 按最优方案计算每个卡片的绝对坐标 */
  const 最优行数组 = 最优方案.lineCounts;
  const 最优行高组 = 最优方案.heights;
  const rowCount = 最优行数组.length;

  const geometries: Array<{ x: number; y: number; width: number; height: number }> = [];
  let index = 0;
  let y = 0;

  for (let row = 0; row < rowCount; row++) {
    const colCount = 最优行数组[row] ?? 1;
    const lineHeight = 最优行高组[row] ?? 0;
    const height = Math.round(lineHeight);

    let x = 0;
    for (let col = 0; col < colCount; col++) {
      const ratio = 取(ratios, index);
      /* 最后一列吃掉剩余宽度，消除取整误差 */
      const width =
        col === colCount - 1
          ? maxWidth - x
          : Math.round(ratio * lineHeight);
      geometries.push({ x, y, width, height });
      x += width + spacing;
      index++;
    }
    y += height + spacing;
  }

  return 转换为拼贴结果(geometries, maxWidth);
}

/** 兜底布局：全部等宽两列排列 */
function 均分兜底(
  ratios: number[],
  maxWidth: number,
  spacing: number
): 拼贴结果 {
  const cols = 2;
  const cellWidth = (maxWidth - spacing) / cols;
  const cellHeight = cellWidth; // 1:1
  const geometries: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let i = 0; i < ratios.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    geometries.push({
      x: col * (cellWidth + spacing),
      y: row * (cellHeight + spacing),
      width: cellWidth,
      height: cellHeight,
    });
  }
  return 转换为拼贴结果(geometries, maxWidth);
}
