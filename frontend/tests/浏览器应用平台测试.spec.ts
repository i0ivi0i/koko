import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

describe("浏览器端应用平台化基线", () => {
  it("聊天壳当前仍保留 shared patch 总线和房间壳投影入口，后续内核化必须显式消灭它们", () => {
    const source = 读取前端源码("聊天壳.ts");

    // 这里故意把当前高风险中心点锁成 characterization：
    // 后续如果它们被删除，说明平台化已经开始真正压缩旧复杂度，此时应同步更新这组基线测试。
    expect(source).toContain("private updateChat(patch: Partial<聊天状态>): void");
    expect(source).toContain("this.chatState = { ...this.chatState, ...patch };");
    expect(source).toContain("private roomShellState()");
    expect(source).toContain("return 派生房间壳外观(this.roomKernel.getSnapshot());");
    expect(source).toContain("private exitCurrentRoomView(");
    expect(source).toContain("this.updateChat({");
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
    const adminSource = 读取前端源码("后台壳.ts");

    expect(chatSource).toContain('from "./平台/index.js"');
    expect(chatSource).toContain("获取默认浏览器应用平台().transport.transport()");
    expect(chatSource).not.toContain("new HttpRealtime传输(window.location.origin)");

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
