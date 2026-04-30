import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("聊天媒体编排 - 架构边界", () => {
  it("聊天媒体编排当前通过 runtime / player / viewer / distribution seam 协调媒体，不直接手搓底层浏览器能力", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain("创建媒体运行时Actor");
    expect(source).toContain("创建媒体播放器");
    expect(source).toContain("创建媒体查看器");
    expect(source).toContain("创建资产协作分发运行时");
    expect(source).not.toContain("new WebTorrent");
    expect(source).not.toContain("navigator.serviceWorker");
    expect(source).not.toContain("createServer(");
    expect(source).not.toContain("window.localStorage");
  });

  it("聊天媒体编排不再直接内联查看器打开/同步/关闭协作", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/查看器会话协作.js"');
    expect(source).toContain("创建查看器会话协作(");
    expect(source).not.toContain("const 投影查看器请求到当前播放真相 =");
    expect(source).not.toContain("const 是否应等待本地完整视频会话真相 =");
    expect(source).not.toContain("const 正式打开查看器 =");
    expect(source).not.toContain("const 同步当前查看器请求 =");
  });

  it("聊天媒体编排不再直接内联自动播稳定等待与播放结果解析", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/自动播协作.js"');
    expect(source).toContain("创建自动播协作(");
    expect(source).not.toContain("let inlineAutoplay启动定时器");
    expect(source).not.toContain("let inlineAutoplay解析代次");
    expect(source).not.toContain("const 读取自动播播放结果表 =");
    expect(source).not.toContain("const 清空自动播播放结果 =");
    expect(source).not.toContain("const 解析自动播播放结果 =");
    expect(source).not.toContain("const 调度自动播播放结果解析 =");
  });

  it("聊天媒体编排不再直接内联视频预览缺源阻断与缓存重试", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/视频预览协作.js"');
    expect(source).toContain("创建视频预览协作(");
    expect(source).not.toContain("const 视频预览状态表 =");
    expect(source).not.toContain("const 视频预览解析代次表 =");
    expect(source).not.toContain("const 视频预览缺源阻断版本表 =");
    expect(source).not.toContain("const 读取当前视频预览播放源 =");
    expect(source).not.toContain("const 读取视频canonical冷源地址 =");
    expect(source).not.toContain("const 解析视频预览 =");
  });

  it("聊天媒体编排不再直接内联协作补齐恢复与帮助链集合", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain('from "./媒体/壳层/协作补齐协作.js"');
    expect(source).toContain("创建协作补齐协作(");
    expect(source).not.toContain("const 已进入帮助链附件 =");
    expect(source).not.toContain("const 已恢复帮助任务附件 =");
    expect(source).not.toContain("const 处理协作分发事件 =");
    expect(source).not.toContain("const 激活附件协作补齐 =");
    expect(source).not.toContain("const 恢复当前房间缓存帮助任务 =");
  });

  it("聊天媒体编排统一复用附件释放和关停 helper，不再在多处复制销毁序列", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");

    expect(source).toContain("const 释放媒体附件会话 =");
    expect(source).toContain("const 执行媒体编排关停 =");
    expect(source).toMatch(/清空\(\): void \{\s+执行媒体编排关停\(\{/);
    expect(source).toMatch(/销毁\(\): void \{\s+执行媒体编排关停\(\{/);
  });
});
