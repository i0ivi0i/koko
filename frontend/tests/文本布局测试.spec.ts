import { beforeEach, describe, expect, it } from "vitest";
import { 创建文本布局器 } from "../文本布局";

/**
 * Pretext 在 Node 下要求 OffscreenCanvas 或 DOM canvas context。
 * 当前 Vitest 默认环境没有可用的测量上下文，所以这里显式补一个最小测试 shim：
 * 1. 只覆盖 Pretext 真正会调用到的 `font` 与 `measureText()`；
 * 2. 目标是让我们验证“封装契约与数据流”，不是在测试里重写字体引擎；
 * 3. 这个 shim 只存在测试进程，不会进入运行时代码。
 */
function 安装测试测量画布(): void {
  class 假二维上下文 {
    font = "16px Microsoft YaHei";

    measureText(text: string): { width: number } {
      const px = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
      return { width: text.length * px * 0.58 };
    }
  }

  class 假OffscreenCanvas {
    getContext(kind: string): 假二维上下文 | null {
      if (kind !== "2d") {
        return null;
      }
      return new 假二维上下文();
    }
  }

  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: 假OffscreenCanvas,
    configurable: true,
    writable: true,
  });
}

describe("文本布局器", () => {
  beforeEach(() => {
    安装测试测量画布();
  });

  it("会为同一段文本返回稳定的行数和高度", () => {
    const 布局器 = 创建文本布局器();
    const 结果 = 布局器.布局纯文本({
      text: "hello hello hello",
      width: 120,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
    });

    // 这条红测先只锁最小契约：
    // 1. 外层必须存在一个唯一的文本布局器入口；
    // 2. 它必须能基于统一布局环境返回稳定几何结果。
    expect(结果.lineCount).toBeGreaterThan(0);
    expect(结果.height).toBeGreaterThan(0);
    expect(结果.naturalWidth).toBeGreaterThan(0);
    expect(结果.lines.length).toBe(结果.lineCount);
    expect(结果.lines[0]?.segments[0]).toEqual({
      kind: "text",
      text: expect.any(String),
    });
  });

  it("会在同一段文本的不同宽度下返回可复用的布局结果", () => {
    const 布局器 = 创建文本布局器();
    const 宽布局 = 布局器.布局纯文本({
      text: "hello hello hello hello hello",
      width: 220,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
    });
    const 窄布局 = 布局器.布局纯文本({
      text: "hello hello hello hello hello",
      width: 90,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
    });

    // 这里要锁住“同一 prepare 结果可重复布局”的外部行为：
    // 宽度变窄后，行数只能持平或变多，自然宽度不该跟着目标宽度漂移。
    expect(窄布局.lineCount).toBeGreaterThanOrEqual(宽布局.lineCount);
    expect(窄布局.naturalWidth).toBe(宽布局.naturalWidth);
  });

  it("会为 rich inline 返回带片段种类的逐行结果", () => {
    const 布局器 = 创建文本布局器();
    const 结果 = 布局器.布局富文本({
      width: 110,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
      segments: [
        { kind: "text", text: "Ship " },
        { kind: "chip", text: "@maya", break: "never", extraWidth: 24 },
        { kind: "code", text: " note" },
      ],
    });

    expect(结果.lineCount).toBeGreaterThan(0);
    expect(结果.lines.length).toBe(结果.lineCount);
    expect(
      结果.lines.some((line) => line.segments.some((segment) => segment.kind === "chip"))
    ).toBe(true);
  });
});
