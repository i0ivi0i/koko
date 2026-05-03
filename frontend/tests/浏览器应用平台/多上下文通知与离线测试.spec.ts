import { describe, expect, it, vi } from "vitest";
import { 创建浏览器应用平台 } from "../../平台/浏览器应用平台";
import type { 生命周期快照 } from "../../平台/生命周期运行时";
import { 创建假传输运行时 } from "./测试支撑";

describe("浏览器端应用平台化基线 / 多上下文通知与离线", () => {
  it("平台会把多上下文、通知、离线能力收进统一快照与命令入口，而不是让壳层自己直连浏览器 API", async () => {
    const lifecycleListeners: Array<(snapshot: 生命周期快照) => void> = [];
    const transportLifecycleCalls: 生命周期快照[] = [];
    const startupSteps: string[] = [];
    const showNotification = vi.fn(async () => true);
    const setBadge = vi.fn(async () => {});
    const clearBadge = vi.fn(async () => {});
    const appRegistration = {
      sync: {
        register: async () => {},
      },
    };
    const mediaRegistration = {};
    const offlineReady = vi.fn(async (input?: { 已注册服务工作线程?: Array<unknown> }) => {
      startupSteps.push(`offline:${Boolean((input?.已注册服务工作线程 ?? []).at(0))}`);
    });
    const startServiceWorker = vi.fn(async () => {
      startupSteps.push("serviceWorker");
    });
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
        读取注册: () => appRegistration ?? mediaRegistration,
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => true,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: (snapshot) => {
          transportLifecycleCalls.push(snapshot);
        },
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: declarePrimary,
        请求聚焦当前上下文: () => {},
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
        订阅点击: () => () => {},
      },
      offline: {
        就绪: offlineReady,
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
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
    expect(startupSteps).toEqual(["serviceWorker", "offline:true"]);
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
      serviceWorker: {
        controllerAttached: true,
        workerWaiting: false,
        lastMessageType: null,
      },
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

  it("离线运行时在线状态变化会被平台转成稳定事件，而不是要求业务层自己轮询平台快照", async () => {
    let 离线快照监听器: ((snapshot: { online: boolean }) => void) | null = null;
    const 事件记录: Array<{ type: string; online?: boolean }> = [];

    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-a",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标: async () => {},
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
        订阅: (listener: (snapshot: { online: boolean }) => void) => {
          离线快照监听器 = listener;
          return () => {
            离线快照监听器 = null;
          };
        },
      } as never,
    });
    platform.订阅事件?.((event) => {
      事件记录.push(event as { type: string; online?: boolean });
    });

    const 触发离线快照 = 离线快照监听器 as ((snapshot: { online: boolean }) => void) | null;
    if (typeof 触发离线快照 === "function") {
      触发离线快照({ online: false });
      触发离线快照({ online: true });
    }

    expect(事件记录).toEqual([
      { type: "OFFLINE_STATUS_CHANGED", online: false },
      { type: "OFFLINE_STATUS_CHANGED", online: true },
    ]);
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
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
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
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
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
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-b",
          isPrimaryContext: false,
          lastPrimaryContextId: "tab-a",
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文: () => {},
        请求聚焦当前上下文: () => {},
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
        订阅点击: () => () => {},
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
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

  it("通知点击后会由平台统一触发当前上下文聚焦、主上下文声明和 badge 清理", async () => {
    const 聚焦当前上下文 = vi.fn();
    const 声明主上下文 = vi.fn();
    const 清除角标 = vi.fn(async () => {});
    let 点击监听器: ((notificationId: string) => void) | null = null;

    创建浏览器应用平台({
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
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-click",
          isPrimaryContext: false,
          lastPrimaryContextId: null,
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文,
        请求聚焦当前上下文: 聚焦当前上下文,
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 3,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标,
        订阅点击: (listener) => {
          点击监听器 = listener;
          return () => {
            点击监听器 = null;
          };
        },
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    // TypeScript 不会追踪闭包里对可空变量的赋值，这里先拷贝到局部常量再做函数类型收窄。
    const 已注册点击监听器 = 点击监听器 as ((notificationId: string) => void) | null;
    if (typeof 已注册点击监听器 === "function") {
      已注册点击监听器("msg-click");
    }
    // 点击链路里包含异步前台恢复与 badge 清理，这里等待微任务完成后再断言。
    await Promise.resolve();
    await Promise.resolve();

    expect(聚焦当前上下文).toHaveBeenCalledTimes(1);
    expect(声明主上下文).toHaveBeenCalledTimes(1);
    expect(清除角标).toHaveBeenCalledTimes(1);
  });

  it("通知点击时如果多上下文运行时提供前台恢复能力，平台会优先调用它", async () => {
    const 请求回到应用前台 = vi.fn(async () => true);
    const 声明主上下文 = vi.fn();
    const 聚焦当前上下文 = vi.fn();
    const 清除角标 = vi.fn(async () => {});
    let 点击监听器: ((notificationId: string) => void) | null = null;

    创建浏览器应用平台({
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
        读取注册: () => null,
        snapshot: () => ({
          workerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: 创建假传输运行时({
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      }),
      multiContext: {
        snapshot: () => ({
          contextId: "tab-click",
          isPrimaryContext: false,
          lastPrimaryContextId: null,
          lastFocusedContextId: null,
          deliveredNotificationIds: [],
        }),
        声明主上下文,
        请求聚焦当前上下文: 聚焦当前上下文,
        请求回到应用前台,
        通知已展示: () => false,
        登记通知已展示: () => true,
      },
      notification: {
        snapshot: () => ({
          permission: "granted" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "granted" as const,
        显示通知: async () => true,
        设置角标: async () => {},
        清除角标,
        订阅点击: (listener) => {
          点击监听器 = listener;
          return () => {
            点击监听器 = null;
          };
        },
      },
      offline: {
        就绪: async () => {},
        snapshot: () => ({
          online: true,
          backgroundSyncSupported: false,
          queuedTaskCapability: "none" as const,
        }),
      },
    });

    const 已注册点击监听器 = 点击监听器 as ((notificationId: string) => void) | null;
    if (typeof 已注册点击监听器 === "function") {
      已注册点击监听器("msg-click");
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(请求回到应用前台).toHaveBeenCalledTimes(1);
    expect(聚焦当前上下文).not.toHaveBeenCalled();
    expect(声明主上下文).toHaveBeenCalledTimes(1);
    expect(清除角标).toHaveBeenCalledTimes(1);
  });

});
