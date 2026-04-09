import { describe, expect, it } from "vitest";
import { 创建文本布局器 } from "../文本布局";

describe("文本布局器", () => {
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
  });
});
