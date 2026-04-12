import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器应用平台 } from "../平台/浏览器应用平台";
import type { 生命周期快照 } from "../平台/生命周期运行时";

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
    expect(kernelSource).toContain("deps.platform ?? 获取默认浏览器应用平台()");
    expect(kernelSource).toContain("this.platform.transport.transport()");

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

  it("平台会把多上下文、通知、离线能力收进统一快照与命令入口，而不是让壳层自己直连浏览器 API", async () => {
    const lifecycleListeners: Array<(snapshot: 生命周期快照) => void> = [];
    const transportLifecycleCalls: 生命周期快照[] = [];
    const showNotification = vi.fn(async () => true);
    const setBadge = vi.fn(async () => {});
    const clearBadge = vi.fn(async () => {});
    const offlineReady = vi.fn(async () => {});
    const startServiceWorker = vi.fn(async () => {});
    const declarePrimary = vi.fn(() => {});
    const dedupeNotification = vi.fn(() => true);
    const hasShownNotification = vi.fn(() => false);

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: (listener) => {
          lifecycleListeners.push(listener);
          return () => {};
        },
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: startServiceWorker,
        snapshot: () => ({
          appShellRegistered: true,
          mediaWorkerRegistered: true,
          persistentStorageRequested: true,
        }),
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: (snapshot) => {
          transportLifecycleCalls.push(snapshot);
        },
        snapshot: () => ({ lastLifecycle: { visibility: "visible" as const, phase: "active" as const } }),
      },
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          deliveredNotificationIds: [],
        }),
        声明主上下文: declarePrimary,
        通知已展示: hasShownNotification,
        登记通知已展示: dedupeNotification,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: setBadge,
        清除角标: clearBadge,
      },
      offline: {
        就绪: offlineReady,
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: true,
        }),
      },
    });

    await platform.启动();
    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-1",
      title: "新消息",
      body: "hello",
      tag: "room-1",
    });
    await platform.dispatch({ type: "SET_BADGE", count: 3 });
    lifecycleListeners[0]?.({ visibility: "visible", phase: "active" });

    expect(declarePrimary).toHaveBeenCalledTimes(2);
    expect(offlineReady).toHaveBeenCalledTimes(1);
    expect(startServiceWorker).toHaveBeenCalledTimes(1);
    expect(transportLifecycleCalls).toEqual([
      { visibility: "visible", phase: "active" },
      { visibility: "visible", phase: "active" },
    ]);
    expect(showNotification).toHaveBeenCalledWith({
      id: "msg-1",
      title: "新消息",
      body: "hello",
      tag: "room-1",
    });
    expect(setBadge).toHaveBeenCalledWith(3);
    expect(clearBadge).toHaveBeenCalledTimes(1);
    expect(platform.snapshot()).toMatchObject({
      multiContext: {
        contextId: "tab-a",
        isPrimaryContext: true,
      },
      notification: {
        permission: "granted",
      },
      offline: {
        online: true,
        backgroundSyncSupported: true,
      },
    });
  });

  it("平台显示通知前会先走多上下文去重，同一条通知不会跨标签重复弹两次", async () => {
    const showNotification = vi.fn(async () => true);
    const hasShownNotification = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const dedupeNotification = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValueOnce(true);

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        snapshot: () => ({
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
        }),
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null }),
      },
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        通知已展示: hasShownNotification,
        登记通知已展示: dedupeNotification,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: async () => {},
        清除角标: async () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
        }),
      },
    });

    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-dup",
      title: "重复消息",
    });
    await platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: "msg-dup",
      title: "重复消息",
    });

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(hasShownNotification).toHaveBeenCalledTimes(2);
    expect(dedupeNotification).toHaveBeenCalledTimes(1);
  });

  it("通知展示失败时不会提前占掉跨标签去重名额，后续上下文还能继续尝试", async () => {
    const showNotification = vi
      .fn<(...args: Array<unknown>) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const hasShown = vi
      .fn<(...args: [string]) => boolean>()
      .mockReturnValue(false);
    const markShown = vi.fn();

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "hidden" as const, phase: "background" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        snapshot: () => ({
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
        }),
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null }),
      },
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        通知已展示: hasShown,
        登记通知已展示: markShown,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: showNotification,
        设置角标: async () => {},
        清除角标: async () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
        }),
      },
    });

    expect(
      await platform.dispatch({
        type: "SHOW_NOTIFICATION",
        id: "msg-retry",
        title: "第一次失败",
      })
    ).toBe(false);
    expect(
      await platform.dispatch({
        type: "SHOW_NOTIFICATION",
        id: "msg-retry",
        title: "第二次成功",
      })
    ).toBe(true);

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(markShown).toHaveBeenCalledTimes(1);
  });
});
