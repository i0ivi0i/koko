/**
 * 媒体拼贴几何算法 — 统一网格布局
 *
 * 核心思想：
 * 1. 单张按原始比例缩放到 maxWidth；
 * 2. 多张（≥2）采用固定 2 列、2:3 卡片比例的均匀网格；
 * 3. 奇数尾行单张拉满宽度，行高与正常行一致；
 * 4. 视频/图片通过 object-fit: cover 裁切适配卡片。
 *
 * 设计决策：放弃 Telegram Web K 的智能比例保持算法，
 * 改用均匀网格以确保混合横竖屏时视觉重量一致。
 * 详见 docs/specs/2025-05-09-媒体拼贴统一网格布局.md
 *
 * 性能：纯数学计算，O(n) 级别，适合万人群聊高频消息流。
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

/**
 * 将几何列表转为公开的拼贴结果。
 * 取整每个卡片的坐标和尺寸，并计算容器总高度。
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

  /* 多张（≥2）走统一网格：固定 2 列、2:3 卡片比例 */
  return 统一网格布局(count, maxWidth, spacing);
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

/* ── 统一网格布局（≥2 张） ── */

/**
 * 统一 2 列、2:3（宽:高）卡片比例的均匀网格。
 *
 * 设计决策：放弃 Telegram 的「保持原始比例智能拼贴」，改用均匀网格，
 * 确保混合横竖屏时每张卡片视觉重量一致，奇数也整齐。
 * 视频/图片内容通过 object-fit: cover 裁切适配卡片。
 *
 * 奇数尾行单张拉满宽度，行高与正常行一致。
 */
function 统一网格布局(
  count: number,
  maxWidth: number,
  spacing: number
): 拼贴结果 {
  const cols = 2;
  /** 每个网格单元的宽度：两列平分可用宽度 */
  const cellWidth = Math.round((maxWidth - spacing) / cols);
  /** 每个网格单元的高度：2:3 比例（宽:高） */
  const cellHeight = Math.round((cellWidth * 3) / 2);
  /** 总行数 */
  const rows = Math.ceil(count / cols);
  /** 最后一行的实际列数（偶数=2，奇数=1） */
  const lastRowCols = count - (rows - 1) * cols;

  const geometries: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const isLastRow = row === rows - 1;
    /** 尾行只有 1 张时拉满整行宽度 */
    const isLastRowSingle = isLastRow && lastRowCols === 1;

    geometries.push({
      x: isLastRowSingle ? 0 : col * (cellWidth + spacing),
      y: row * (cellHeight + spacing),
      width: isLastRowSingle ? maxWidth : cellWidth,
      height: cellHeight,
    });
  }

  return 转换为拼贴结果(geometries, maxWidth);
}
