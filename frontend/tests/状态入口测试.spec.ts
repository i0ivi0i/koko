import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("前端聊天状态 owner", () => {
  it("总装聊天状态已经成为唯一 owner，旧根入口已删除", () => {
    const ownerSource = 读取前端源码("总装/聊天状态.ts");
    const shellSource = 读取前端源码("总装/聊天壳.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const viewportSource = 读取前端源码("时间线/视口运行时.ts");
    const scrollSource = 读取前端源码("时间线/滚动器.ts");
    const presenterSource = 读取前端源码("房间消息窗/视图.ts");
    const assemblySource = 读取前端源码("总装/应用装配.ts");
    const fitnessSource = 读取前端源码("../scripts/check-frontend-architecture-fitness.mjs");

    expect(existsSync(resolve(process.cwd(), "状态.ts"))).toBe(false);
    expect(ownerSource).toContain("export interface 聊天状态");
    expect(ownerSource).toContain("export const 初始聊天状态");
    expect(ownerSource).toContain("export interface 聊天运行时预算状态");

    expect(shellSource).toContain('from "./聊天状态.js"');
    expect(shellSource).not.toContain('from "./状态.js"');
    expect(kernelSource).toContain('from "./聊天状态.js"');
    expect(kernelSource).not.toContain('from "./状态.js"');
    expect(viewportSource).toContain('from "../总装/聊天状态.js"');
    expect(viewportSource).not.toContain('from "../状态.js"');
    expect(scrollSource).toContain('from "../总装/聊天状态.js"');
    expect(scrollSource).not.toContain('from "../状态.js"');
    expect(presenterSource).toContain('from "../总装/聊天状态.js"');
    expect(presenterSource).not.toContain('from "../状态.js"');
    expect(assemblySource).toContain('from "./聊天状态.js"');
    expect(assemblySource).not.toContain('from "../状态.js"');

    expect(fitnessSource).toContain('path: "frontend/状态.ts"');
    expect(fitnessSource).toContain('ownerPath: "frontend/总装/聊天状态.ts"');
  });
});
