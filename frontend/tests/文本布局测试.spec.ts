import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { 安装测试文本测量画布 } from "./common/聊天测试支架";
import { 创建文本布局器 } from "../房间消息窗/文本布局";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("文本布局器", () => {
  beforeEach(() => {
    安装测试文本测量画布();
  });

  it("文本布局 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("房间消息窗/文本布局.ts");
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const shellConsoleViewSource = 读取前端源码("总装/聊天壳操作台视图.ts");
    const viewSource = 读取前端源码("房间消息窗/视图.ts");

    expect(existsSync(resolve(process.cwd(), "文本布局.ts"))).toBe(false);
    expect(ownerSource).toContain("export function 创建文本布局器()");
    expect(ownerSource).toContain("export const 默认文本布局器 = 创建文本布局器()");
    expect(shellSource).toContain('from "./聊天壳操作台视图.js"');
    expect(shellSource).not.toContain('from "./文本布局.js"');
    expect(shellConsoleViewSource).toContain('from "../房间消息窗/文本布局.js"');
    expect(viewSource).toContain('from "./文本布局.js"');
    expect(viewSource).not.toContain('from "../文本布局.js"');
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

  it("会按官方 bubbles 思路收窄到保持相同行数的最小气泡宽度", () => {
    const 布局器 = 创建文本布局器();
    const 普通布局 = 布局器.布局纯文本({
      text: "did you see the new library today",
      width: 140,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
    });
    const 紧凑布局 = 布局器.布局纯文本({
      text: "did you see the new library today",
      width: 140,
      fontFamily: "Microsoft YaHei",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 22,
      shrinkWrap: "same-line-count",
    });

    const 读取最宽行 = (lines: Array<{ width: number }>) =>
      lines.reduce((max, line) => Math.max(max, line.width), 0);

    // 官方 bubbles demo 的关键不是“少一行”，而是：
    // 在不增加行数的前提下，重新找一组更紧的断行，让气泡少浪费最后一行后的空白。
    expect(紧凑布局.lineCount).toBe(普通布局.lineCount);
    expect(读取最宽行(紧凑布局.lines)).toBeLessThan(读取最宽行(普通布局.lines));
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
