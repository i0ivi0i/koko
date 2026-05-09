import { describe, it, expect } from "vitest";
import {
  计算媒体拼贴几何,
  type 媒体尺寸,
  type 拼贴结果,
} from "../房间消息窗/媒体拼贴几何.js";

/**
 * 媒体拼贴统一网格布局测试
 *
 * 核心验收标准：
 * 1. 单张保持原始比例缩放（行为不变）
 * 2. 多张（≥2）统一 2 列网格，卡片比例 2:3（宽:高）
 * 3. 奇数尾行单张拉满宽度，行高与正常行一致
 * 4. 所有卡片 x+width ≤ maxWidth, y+height ≤ totalHeight（无溢出）
 *
 * 设计决策详见 docs/specs/2025-05-09-媒体拼贴统一网格布局.md
 */

const 默认配置 = { maxWidth: 384, spacing: 8 };

/**
 * 默认配置下的网格单元尺寸：
 * cellWidth  = (384 - 8) / 2 = 188
 * cellHeight = 188 * 3 / 2   = 282
 */
const 单元宽 = 188;
const 单元高 = 282;

/** 辅助：检查所有卡片不溢出容器 */
function 断言无溢出(result: 拼贴结果, maxWidth: number): void {
  for (const item of result.items) {
    expect(item.x + item.width).toBeLessThanOrEqual(maxWidth + 1);
    expect(item.y + item.height).toBeLessThanOrEqual(result.totalHeight + 1);
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
  }
}

/**
 * 辅助：检查正常行卡片（非尾行单张）的宽高比接近 2:3。
 * 尾行只有 1 张时该卡片是拉满全宽的，比例不是 2:3，跳过。
 */
function 断言卡片比例为2比3(result: 拼贴结果, count: number): void {
  const cols = 2;
  const lastRowCols = count % cols === 0 ? cols : count % cols;
  const lastRowStartIndex = count - lastRowCols;

  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i]!;
    /* 尾行单张拉满，比例不是 2:3，跳过 */
    if (lastRowCols === 1 && i === lastRowStartIndex) continue;
    const ratio = item.width / item.height;
    /* 2:3 ≈ 0.6667，容忍取整 ±0.01 */
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.69);
  }
}

describe("媒体拼贴几何", () => {
  /* ── 边界 ── */

  describe("空输入与边界", () => {
    it("空数组返回空结果", () => {
      const result = 计算媒体拼贴几何([], 默认配置);
      expect(result.items).toHaveLength(0);
      expect(result.totalHeight).toBe(0);
    });

    it("附件尺寸为 0 时 fallback 为 1:1", () => {
      const result = 计算媒体拼贴几何(
        [{ w: 0, h: 0 }, { w: 100, h: 200 }],
        默认配置
      );
      expect(result.items).toHaveLength(2);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("超过 10 张截断为前 10 张", () => {
      const sizes = Array.from({ length: 12 }, () => ({ w: 100, h: 100 }));
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(10);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  /* ── 单张（保持原始行为） ── */

  describe("单张媒体（保持原始行为）", () => {
    it("横屏单图按比例缩放到 maxWidth", () => {
      const result = 计算媒体拼贴几何(
        [{ w: 1920, h: 1080 }],
        默认配置
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.width).toBe(默认配置.maxWidth);
      expect(result.items[0]!.x).toBe(0);
      expect(result.items[0]!.y).toBe(0);
      const expectedHeight = Math.round((默认配置.maxWidth * 1080) / 1920);
      expect(result.items[0]!.height).toBe(expectedHeight);
    });

    it("竖屏单图按比例缩放", () => {
      const result = 计算媒体拼贴几何(
        [{ w: 1080, h: 1920 }],
        默认配置
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.width).toBe(默认配置.maxWidth);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  /* ── 统一网格（≥2 张） ── */

  describe("统一网格布局（≥2 张）", () => {
    it("2 张 → 1 行 2 列，等宽等高 2:3", () => {
      const sizes: 媒体尺寸[] = [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.width).toBe(单元宽);
      expect(result.items[0]!.height).toBe(单元高);
      expect(result.items[1]!.width).toBe(单元宽);
      expect(result.items[1]!.height).toBe(单元高);
      expect(result.items[1]!.x).toBe(单元宽 + 默认配置.spacing);
      expect(result.totalHeight).toBe(单元高);
      断言无溢出(result, 默认配置.maxWidth);
      断言卡片比例为2比3(result, 2);
    });

    it("3 张 → 2+1，尾行单张拉满宽度同行高", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1280, h: 720 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(3);
      /* 前两张 2:3 */
      expect(result.items[0]!.width).toBe(单元宽);
      expect(result.items[0]!.height).toBe(单元高);
      expect(result.items[1]!.width).toBe(单元宽);
      /* 第三张拉满整行 */
      expect(result.items[2]!.width).toBe(默认配置.maxWidth);
      expect(result.items[2]!.height).toBe(单元高);
      expect(result.items[2]!.x).toBe(0);
      expect(result.items[2]!.y).toBe(单元高 + 默认配置.spacing);
      /* totalHeight = 2 行 */
      expect(result.totalHeight).toBe(单元高 * 2 + 默认配置.spacing);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("4 张 → 2+2，四张全等 2:3", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1280, h: 720 },
        { w: 800, h: 600 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(4);
      for (const item of result.items) {
        expect(item.width).toBe(单元宽);
        expect(item.height).toBe(单元高);
      }
      expect(result.items[2]!.y).toBe(单元高 + 默认配置.spacing);
      expect(result.totalHeight).toBe(单元高 * 2 + 默认配置.spacing);
      断言无溢出(result, 默认配置.maxWidth);
      断言卡片比例为2比3(result, 4);
    });

    it("5 张 → 2+2+1，尾行单张拉满", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1280, h: 720 },
        { w: 800, h: 800 },
        { w: 720, h: 1280 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(5);
      for (let i = 0; i < 4; i++) {
        expect(result.items[i]!.width).toBe(单元宽);
        expect(result.items[i]!.height).toBe(单元高);
      }
      expect(result.items[4]!.width).toBe(默认配置.maxWidth);
      expect(result.items[4]!.height).toBe(单元高);
      expect(result.items[4]!.y).toBe((单元高 + 默认配置.spacing) * 2);
      expect(result.totalHeight).toBe(单元高 * 3 + 默认配置.spacing * 2);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("6 张 → 2+2+2，六张全等 2:3", () => {
      const sizes: 媒体尺寸[] = Array.from({ length: 6 }, () => ({
        w: 1920, h: 1080,
      }));
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(6);
      for (const item of result.items) {
        expect(item.width).toBe(单元宽);
        expect(item.height).toBe(单元高);
      }
      expect(result.totalHeight).toBe(单元高 * 3 + 默认配置.spacing * 2);
      断言无溢出(result, 默认配置.maxWidth);
      断言卡片比例为2比3(result, 6);
    });

    it("10 张 → 5×2，全等 2:3", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 }, { w: 1080, h: 1920 },
        { w: 1280, h: 720 }, { w: 800, h: 800 },
        { w: 720, h: 1280 }, { w: 1600, h: 900 },
        { w: 900, h: 1600 }, { w: 1000, h: 1000 },
        { w: 640, h: 480 }, { w: 480, h: 640 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(10);
      for (const item of result.items) {
        expect(item.width).toBe(单元宽);
        expect(item.height).toBe(单元高);
      }
      expect(result.totalHeight).toBe(单元高 * 5 + 默认配置.spacing * 4);
      断言无溢出(result, 默认配置.maxWidth);
      断言卡片比例为2比3(result, 10);
    });

    it("混合横竖屏不影响卡片几何（统一网格无视原始比例）", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1000, h: 1000 },
        { w: 3840, h: 2160 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(4);
      for (const item of result.items) {
        expect(item.width).toBe(单元宽);
        expect(item.height).toBe(单元高);
      }
      断言卡片比例为2比3(result, 4);
    });

    it("contentWidth 始终返回 maxWidth", () => {
      const sizes: 媒体尺寸[] = [{ w: 100, h: 200 }, { w: 300, h: 400 }];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.contentWidth).toBe(默认配置.maxWidth);
    });
  });
});
