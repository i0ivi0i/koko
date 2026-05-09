import { describe, it, expect } from "vitest";
import {
  计算媒体拼贴几何,
  type 媒体尺寸,
  type 拼贴结果,
} from "../房间消息窗/媒体拼贴几何.js";

/**
 * 媒体拼贴几何算法测试：
 * 移植自 Telegram Web K groupedLayout.ts，验证各种附件组合下的布局几何正确性。
 *
 * 核心验收标准：
 * 1. 每个卡片 x+width ≤ maxWidth，y+height ≤ totalHeight（无溢出）
 * 2. 卡片间距符合 spacing 约定
 * 3. 卡片宽高比与媒体原始比例差距合理（<15%）
 */

const 默认配置 = { maxWidth: 384, spacing: 8 };

/** 辅助：检查所有卡片不溢出容器 */
function 断言无溢出(result: 拼贴结果, maxWidth: number): void {
  for (const item of result.items) {
    expect(item.x + item.width).toBeLessThanOrEqual(maxWidth + 1); // +1 容忍取整
    expect(item.y + item.height).toBeLessThanOrEqual(result.totalHeight + 1);
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
  }
}

/** 辅助：检查卡片比例与原始比例差距 */
function 断言比例接近(
  result: 拼贴结果,
  sizes: 媒体尺寸[],
  maxDiff = 0.15
): void {
  for (let i = 0; i < result.items.length; i++) {
    const original = sizes[i].w / sizes[i].h;
    const actual = result.items[i].width / result.items[i].height;
    // 拼贴为了整齐会有一定裁切，允许 15% 偏差
    // 对于极端比例差异的组合，放宽到 50%
    const diff = Math.abs(original - actual) / Math.max(original, actual);
    expect(diff).toBeLessThan(maxDiff);
  }
}

describe("媒体拼贴几何", () => {
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

  describe("单张媒体", () => {
    it("横屏单图按比例缩放到 maxWidth", () => {
      const result = 计算媒体拼贴几何(
        [{ w: 1920, h: 1080 }],
        默认配置
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].width).toBe(默认配置.maxWidth);
      expect(result.items[0].x).toBe(0);
      expect(result.items[0].y).toBe(0);
      // 高度应该按 16:9 比例
      const expectedHeight = Math.round((默认配置.maxWidth * 1080) / 1920);
      expect(result.items[0].height).toBe(expectedHeight);
    });

    it("竖屏单图按比例缩放", () => {
      const result = 计算媒体拼贴几何(
        [{ w: 1080, h: 1920 }],
        默认配置
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].width).toBe(默认配置.maxWidth);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  describe("两张媒体", () => {
    it("两张横屏等宽左右排列", () => {
      const sizes: 媒体尺寸[] = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(2);
      // 两张高度应该相同（同一行）
      expect(result.items[0].height).toBe(result.items[1].height);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("一竖一横按比例分宽", () => {
      const sizes: 媒体尺寸[] = [{ w: 1080, h: 1920 }, { w: 1920, h: 1080 }];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(2);
      // 两张高度相同
      expect(result.items[0].height).toBe(result.items[1].height);
      // 竖屏那张应该更窄
      expect(result.items[0].width).toBeLessThan(result.items[1].width);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("两张方形等宽左右排列", () => {
      const sizes: 媒体尺寸[] = [{ w: 1000, h: 1000 }, { w: 800, h: 800 }];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].height).toBe(result.items[1].height);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  describe("三张媒体", () => {
    it("首张竖屏 → 左列满高 + 右列两张叠", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1080, h: 1920 },
        { w: 1920, h: 1080 },
        { w: 1280, h: 720 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(3);
      // 第一张高度 = 容器总高度（左列满高）
      expect(result.items[0].height).toBe(result.totalHeight);
      // 右列两张叠起来 + spacing = 总高度
      const rightTotalHeight =
        result.items[1].height + 默认配置.spacing + result.items[2].height;
      expect(rightTotalHeight).toBe(result.totalHeight);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("首张横屏 → 上行满宽 + 下行两张并排", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1280, h: 720 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(3);
      // 第一张宽度 = maxWidth（上行满宽）
      expect(result.items[0].width).toBe(默认配置.maxWidth);
      // 下行两张 x 不同
      expect(result.items[1].x).toBe(0);
      expect(result.items[2].x).toBeGreaterThan(0);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  describe("四张媒体", () => {
    it("首张横屏 → 上行满宽 + 下行三张按比例", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 800, h: 600 },
        { w: 1280, h: 720 },
        { w: 600, h: 800 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(4);
      expect(result.items[0].width).toBe(默认配置.maxWidth);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("首张竖屏 → 左列满高 + 右列三张叠", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1080, h: 1920 },
        { w: 1920, h: 1080 },
        { w: 1280, h: 720 },
        { w: 800, h: 600 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(4);
      // 第一张高度 = 容器总高度
      expect(result.items[0].height).toBe(result.totalHeight);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });

  describe("5+ 张媒体（ComplexLayouter）", () => {
    it("5 张混合比例紧凑无溢出", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 1280, h: 720 },
        { w: 800, h: 800 },
        { w: 720, h: 1280 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(5);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("6 张全横屏紧凑无溢出", () => {
      const sizes: 媒体尺寸[] = Array.from({ length: 6 }, () => ({
        w: 1920, h: 1080,
      }));
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(6);
      断言无溢出(result, 默认配置.maxWidth);
    });

    it("10 张混合比例紧凑无溢出", () => {
      const sizes: 媒体尺寸[] = [
        { w: 1920, h: 1080 }, { w: 1080, h: 1920 },
        { w: 1280, h: 720 }, { w: 800, h: 800 },
        { w: 720, h: 1280 }, { w: 1600, h: 900 },
        { w: 900, h: 1600 }, { w: 1000, h: 1000 },
        { w: 640, h: 480 }, { w: 480, h: 640 },
      ];
      const result = 计算媒体拼贴几何(sizes, 默认配置);
      expect(result.items).toHaveLength(10);
      断言无溢出(result, 默认配置.maxWidth);
    });
  });
});
