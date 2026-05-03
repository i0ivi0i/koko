import { describe, expect, it, vi } from "vitest";
import { 创建浏览器应用平台 } from "../../平台/浏览器应用平台";
import type { 浏览器应用平台事件 } from "../../平台/浏览器应用平台";
import type { 服务工作线程运行时事件 } from "../../平台/服务工作线程运行时";
import { 创建假传输运行时 } from "./测试支撑";

describe("浏览器端应用平台化基线 / Service Worker 与缓存更新", () => {
  it("平台会透传 service worker 事件，并提供显式接受更新命令", async () => {
    let sw事件监听器: ((event: 服务工作线程运行时事件) => void) | null = null;
    const 接受更新 = vi.fn(() => true);
    const serviceWorker = {
      启动: async () => {},
      读取注册: () => null,
      发送消息: () => true,
      订阅事件: (listener: (event: 服务工作线程运行时事件) => void) => {
        sw事件监听器 = listener;
        return () => {
          sw事件监听器 = null;
        };
      },
      接受更新,
      snapshot: () => ({
        workerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: true,
        workerWaiting: false,
        lastMessageType: null,
        lastMessage: null,
      }),
    };

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
      serviceWorker,
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
          contextId: "tab-event",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-event",
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
      },
    });

    const 扩展平台 = platform as unknown as {
      订阅事件?(listener: (event: unknown) => void): () => void;
      dispatch(command: { type: "ACCEPT_SERVICE_WORKER_UPDATE" }): Promise<boolean | void>;
    };
    const 捕获事件: unknown[] = [];

    扩展平台.订阅事件?.((event) => {
      捕获事件.push(event);
    });
    const 已注册监听器 = sw事件监听器;
    if (typeof 已注册监听器 === "function") {
      (已注册监听器 as (event: 服务工作线程运行时事件) => void)({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: "app",
      });
    }
    const dispatch结果 = await 扩展平台.dispatch({ type: "ACCEPT_SERVICE_WORKER_UPDATE" });

    expect(dispatch结果).toBe(true);
    expect(接受更新).toHaveBeenCalledTimes(1);
    expect(捕获事件).toEqual(
      expect.arrayContaining([{ type: "SERVICE_WORKER_UPDATE_READY", scope: "app" }])
    );
  });

  it("平台快照会继续暴露 service worker runtime 的 controller / waiting / message 状态", () => {
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
        发送消息: () => true,
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          workerWaiting: true,
          lastMessageType: "SW_UPDATED",
          lastMessage: { type: "SW_UPDATED", scope: "app" },
        }),
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
          contextId: "tab-c",
          isPrimaryContext: true,
          lastPrimaryContextId: "tab-c",
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
          permission: "default" as const,
          lastClickedNotificationId: null,
          badgeCount: 0,
        }),
        请求权限: async () => "default" as const,
        显示通知: async () => false,
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

    expect(platform.snapshot().serviceWorker).toEqual({
      workerRegistered: true,
      persistentStorageRequested: true,
      controllerAttached: true,
      workerWaiting: true,
      lastMessageType: "SW_UPDATED",
      lastMessage: { type: "SW_UPDATED", scope: "app" },
    });
  });

  it("controllerchange 后只有主上下文允许推进应用刷新完成态", async () => {
    let 服务工作线程事件监听器: ((event: 服务工作线程运行时事件) => void) | null = null;
    let 多上下文事件监听器:
      | ((event: {
          type: "PRIMARY_CONTEXT_CHANGED";
          contextId: string;
          isPrimaryContext: boolean;
        }) => void)
      | null = null;
    const 平台事件记录: Array<{ type: string; scope?: "app" | "media" }> = [];
    const 多上下文快照 = {
      contextId: "tab-a",
      isPrimaryContext: false,
      lastPrimaryContextId: null as string | null,
      lastFocusedContextId: null,
      deliveredNotificationIds: [],
    };

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
        订阅事件: (listener) => {
          服务工作线程事件监听器 = listener;
          return () => {
            服务工作线程事件监听器 = null;
          };
        },
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: false,
          controllerAttached: false,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
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
        snapshot: () => ({ ...多上下文快照 }),
        订阅事件: (listener) => {
          多上下文事件监听器 = listener;
          return () => {
            多上下文事件监听器 = null;
          };
        },
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
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
        }),
      },
    });
    platform.订阅事件?.((event) => {
      平台事件记录.push(event);
    });

    await platform.启动();
    const 派发服务工作线程事件 =
      服务工作线程事件监听器 as
        | ((event: 服务工作线程运行时事件) => void)
        | null;
    if (派发服务工作线程事件) {
      派发服务工作线程事件({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: "app",
      });
      派发服务工作线程事件({
        type: "SERVICE_WORKER_CONTROLLER_READY",
      });
    }

    expect(平台事件记录).toContainEqual({
      type: "SERVICE_WORKER_UPDATE_READY",
      scope: "app",
    });
    expect(平台事件记录).not.toContainEqual({
      type: "SERVICE_WORKER_CONTROLLER_READY",
    });
    expect(platform.snapshot().cacheUpdate).toMatchObject({
      updateState: "waiting_refresh",
      controllerReadyPending: true,
      controllerReadyContextId: null,
    });

    多上下文快照.isPrimaryContext = true;
    多上下文快照.lastPrimaryContextId = "tab-a";
    const 派发多上下文事件 =
      多上下文事件监听器 as
        | ((event: {
            type: "PRIMARY_CONTEXT_CHANGED";
            contextId: string;
            isPrimaryContext: boolean;
          }) => void)
        | null;
    if (派发多上下文事件) {
      派发多上下文事件({
        type: "PRIMARY_CONTEXT_CHANGED",
        contextId: "tab-a",
        isPrimaryContext: true,
      });
    }

    expect(平台事件记录).toContainEqual({
      type: "SERVICE_WORKER_CONTROLLER_READY",
    });
    expect(platform.snapshot().cacheUpdate).toMatchObject({
      updateState: "idle",
      controllerReadyContextId: "tab-a",
    });
  });

  it("存储驱逐只通过稳定缓存更新事件发布 acceleration loss，不直接 patch 壳层", async () => {
    let 存储事件监听器:
      | ((event: { type: "STORAGE_EVICTION_DETECTED" }) => void)
      | null = null;
    const 平台事件记录: 浏览器应用平台事件[] = [];
    const platform = 创建浏览器应用平台({
      lifecycle: {
        snapshot: () => ({ visibility: "visible" as const, phase: "active" as const }),
        订阅: () => () => {},
      },
      storage: {
        壳层记忆: () => {
          throw new Error("not used");
        },
        订阅事件: (listener) => {
          存储事件监听器 = listener as typeof 存储事件监听器;
          return () => {
            存储事件监听器 = null;
          };
        },
      },
      serviceWorker: {
        启动: async () => {},
        读取注册: () => null,
        订阅事件: () => () => {},
        snapshot: () => ({
          workerRegistered: true,
          persistentStorageRequested: false,
          controllerAttached: true,
          workerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
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
        订阅事件: () => () => {},
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
          backgroundSyncSupported: true,
          queuedTaskCapability: "background-sync" as const,
        }),
      },
    });
    platform.订阅事件?.((event) => {
      平台事件记录.push(event);
    });

    const 派发存储事件 = 存储事件监听器 as
      | ((event: { type: "STORAGE_EVICTION_DETECTED" }) => void)
      | null;
    派发存储事件?.({ type: "STORAGE_EVICTION_DETECTED" });

    expect(platform.snapshot().cacheUpdate).toMatchObject({
      accelerationState: "acceleration_loss",
    });
    expect(平台事件记录).toContainEqual({
      type: "CACHE_UPDATE_CHANGED",
      snapshot: expect.objectContaining({
        accelerationState: "acceleration_loss",
      }),
    });
  });
});
