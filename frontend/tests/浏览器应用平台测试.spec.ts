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

  it("后台壳当前仍是网页式直连 transport，这条旧路要在后台应用内核阶段被替换", () => {
    const source = 读取前端源码("后台壳.ts");

    expect(source).toContain(
      'private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);'
    );
    expect(source).toContain("const out = await this.transport.adminLogin(this.username, this.password);");
    expect(source).toContain("const overview = await this.transport.loadAdminOverview(this.token);");
    expect(source).toContain("const rooms = await this.transport.adminRooms(this.token);");
    expect(source).toContain("const detail = await this.transport.adminRoomDetail(this.token, roomId);");
  });

  it("入口当前仍直接注册两个 service worker 并申请持久化存储，这条浏览器 API 直连会在平台骨架阶段退场", () => {
    const source = 读取前端源码("入口.ts");

    expect(source).toContain('navigator.serviceWorker.register("/app-sw.js", { scope: "/" })');
    expect(source).toContain('navigator.serviceWorker.register("/media-sw.js", { scope: "/" })');
    expect(source).toContain("navigator.storage.persist()");
  });
});
