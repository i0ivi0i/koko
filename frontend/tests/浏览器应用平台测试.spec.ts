import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

describe("浏览器端应用平台化基线", () => {
  it("聊天壳会把业务入口收进 ChatAppKernel，自身只保留 view + bridge", () => {
    const source = 读取前端源码("聊天壳.ts");

    expect(source).toContain('from "./聊天应用内核.js"');
    expect(source).toContain("private readonly kernel = 创建聊天应用内核(");
    expect(source).not.toContain("private transport:");
    expect(source).not.toContain("private storage:");
    expect(source).not.toContain("private roomKernel =");
    expect(source).not.toContain("private _恢复编排端口");
    expect(source).not.toContain("private _实时编排端口");
    expect(source).not.toContain("private _阅读推进编排端口");
    expect(source).not.toContain("private roomShellState()");
    expect(source).not.toContain("private joinHistoryRoom(");
    expect(source).not.toContain("private leaveCurrentRoomView(");
    expect(source).not.toContain("private sendCurrentMessage(");
  });

  it("聊天壳当前已把滚动和媒体信号先交给应用运行时，而不是在模板里直接裁决", () => {
    const source = 读取前端源码("聊天壳.ts");

    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_INTENT"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_OBSERVED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_JUMP_TO_LATEST_REQUESTED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_OPEN_REQUESTED"/);
  });

  it("聊天壳和后台壳都会从平台拿 transport，而不是各自 new HttpRealtime传输", () => {
    const chatSource = 读取前端源码("聊天壳.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const adminSource = 读取前端源码("后台壳.ts");

    expect(chatSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(kernelSource).toContain('from "./平台/index.js"');
    expect(kernelSource).toContain("获取默认浏览器应用平台().transport.transport()");

    expect(adminSource).toContain('from "./平台/index.js"');
    expect(adminSource).toContain("获取默认浏览器应用平台().transport.transport()");
    expect(adminSource).not.toContain("new HttpRealtime传输(window.location.origin)");
  });

  it("入口会把浏览器 API 启动职责交给平台骨架，不再自己直连 service worker 和持久化存储", () => {
    const source = 读取前端源码("入口.ts");

    expect(source).toContain('from "./平台/index.js"');
    expect(source).toContain("获取默认浏览器应用平台");
    expect(source).toContain("void 平台.启动()");
    expect(source).not.toContain("navigator.serviceWorker.register");
    expect(source).not.toContain("navigator.storage.persist()");
  });
});
