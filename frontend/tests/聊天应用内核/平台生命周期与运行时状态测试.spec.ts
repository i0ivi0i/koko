import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../存储";
import { createFakeStorage, 假传输 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试 } from "../common/聊天应用内核支架";
import type { 浏览器应用平台快照 } from "../../平台/浏览器应用平台";

describe("聊天应用内核 - 平台生命周期与运行时状态", () => {
  it("frozen/page_hidden 会把重型工作意图降到 suspended，并投影到运行时快照", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({
      type: "PLATFORM_LIFECYCLE_CHANGED",
      snapshot: { visibility: "hidden", phase: "frozen" },
    });

    expect(kernel.snapshot()).toMatchObject({
      lifecycleVisibility: "hidden",
      lifecyclePhase: "frozen",
      heavyWorkPolicy: "suspended",
    });
  });

  it("service worker update ready 会进入 waiting_refresh，而 controller ready 会清掉状态并尝试排空后台补发", async () => {
    const transport = new 假传输();
    const 排空到期任务 = vi.fn(async () => {});
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
      platform: {
        lifecycle: {} as never,
        storage: {} as never,
        serviceWorker: {} as never,
        transport: { transport: () => transport } as never,
        multiContext: {} as never,
        notification: {} as never,
        offline: {
          snapshot: () => ({
            online: true,
            backgroundSyncSupported: true,
            queuedTaskCapability: "background-sync" as const,
          }),
          就绪: async () => {},
          排空到期任务,
        } as never,
        启动: async () => {},
        snapshot: () =>
          ({
            lifecycle: { visibility: "visible", phase: "active" },
            serviceWorker: {
              workerRegistered: true,
              persistentStorageRequested: true,
              controllerAttached: false,
              workerWaiting: false,
              lastMessageType: null,
              lastMessage: null,
            },
            transport: {
              lastLifecycle: { visibility: "visible", phase: "active" },
              realtimePolicy: {
                intent: "resume",
                reconnection: true,
                reason: "active",
              },
            },
            multiContext: {
              contextId: "tab-a",
              isPrimaryContext: true,
              lastPrimaryContextId: "tab-a",
              lastFocusedContextId: null,
              deliveredNotificationIds: [],
            },
            notification: {
              permission: "granted",
              lastClickedNotificationId: null,
              badgeCount: 0,
            },
            offline: {
              online: true,
              backgroundSyncSupported: true,
              queuedTaskCapability: "background-sync",
            },
          }) as 浏览器应用平台快照,
        dispatch: async () => true,
      },
    });

    await kernel.dispatch({
      type: "PLATFORM_SERVICE_WORKER_UPDATE_READY",
      scope: "app",
    });
    expect(kernel.snapshot().swUpdateState).toBe("waiting_refresh");

    await kernel.dispatch({ type: "PLATFORM_SERVICE_WORKER_CONTROLLER_READY" });

    expect(kernel.snapshot().swUpdateState).toBe("idle");
    expect(排空到期任务).toHaveBeenCalledTimes(1);
  });

  it("storage eviction 只会降级加速层状态，不会伪装成业务消息缺失", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 原消息快照 = kernel.snapshot().messages;

    await kernel.dispatch({
      type: "PLATFORM_CACHE_UPDATE_CHANGED",
      snapshot: {
        updateState: "idle",
        waitingScope: null,
        primaryContextId: "tab-a",
        controllerReadyPending: false,
        controllerReadyContextId: "tab-a",
        accelerationState: "acceleration_loss",
      },
    });

    expect(kernel.snapshot().accelerationState).toBe("acceleration_loss");
    expect(kernel.snapshot().messages).toBe(原消息快照);
  });

  it("同值本地补丁不会重复 requestUpdate，也不会把同引用消息重新同步给媒体层", () => {
    const deps = 创建内核依赖();
    const kernel = 创建聊天应用内核({
      ...deps,
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 当前消息 = kernel.snapshot().messages;
    const 媒体编排 = 读取媒体编排供测试(kernel) as unknown as {
      同步消息附件播放结果(): void;
    };
    const 同步消息附件播放结果 = vi.spyOn(媒体编排, "同步消息附件播放结果");
    const 应用本地状态补丁 = (
      kernel as unknown as {
        应用本地状态补丁(patch: Record<string, unknown>): boolean;
      }
    ).应用本地状态补丁.bind(kernel);

    expect(应用本地状态补丁({ historyLoading: false })).toBe(false);
    expect(应用本地状态补丁({ messages: 当前消息 })).toBe(false);
    expect(deps.滚动宿主.requestUpdate).not.toHaveBeenCalled();
    expect(同步消息附件播放结果).not.toHaveBeenCalled();
  });

  it("更新 pending 期间会累计持续时间，并显示为统一运行时预算项", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
      platform: {
        lifecycle: {} as never,
        storage: {} as never,
        serviceWorker: {} as never,
        transport: { transport: () => transport } as never,
        multiContext: {} as never,
        notification: {} as never,
        offline: {
          snapshot: () => ({
            online: true,
            backgroundSyncSupported: true,
            queuedTaskCapability: "background-sync" as const,
          }),
          就绪: async () => {},
          排空到期任务: vi.fn(async () => {}),
        } as never,
        启动: async () => {},
        snapshot: () =>
          ({
            lifecycle: { visibility: "visible", phase: "active" },
            serviceWorker: {
              workerRegistered: true,
              persistentStorageRequested: true,
              controllerAttached: false,
              workerWaiting: false,
              lastMessageType: null,
              lastMessage: null,
            },
            transport: {
              lastLifecycle: { visibility: "visible", phase: "active" },
              realtimePolicy: {
                intent: "resume",
                reconnection: true,
                reason: "active",
              },
            },
            multiContext: {
              contextId: "tab-a",
              isPrimaryContext: true,
              lastPrimaryContextId: "tab-a",
              lastFocusedContextId: null,
              deliveredNotificationIds: [],
            },
            notification: {
              permission: "granted",
              lastClickedNotificationId: null,
              badgeCount: 0,
            },
            offline: {
              online: true,
              backgroundSyncSupported: true,
              queuedTaskCapability: "background-sync",
            },
          }) as 浏览器应用平台快照,
        dispatch: async () => true,
      },
    });

    try {
      await kernel.dispatch({
        type: "PLATFORM_SERVICE_WORKER_UPDATE_READY",
        scope: "media",
      });
      await vi.advanceTimersByTimeAsync(1_250);
      await kernel.dispatch({
        type: "PLATFORM_LIFECYCLE_CHANGED",
        snapshot: { visibility: "visible", phase: "active" },
      });

      expect(kernel.snapshot().runtimeBudget).toMatchObject({
        updatePendingDurationMs: 1_250,
        activeVideoCount: 0,
        autoplayOwnerCount: 0,
        activeSwarmCount: 0,
        inflightLocatorCount: 0,
        inflightManifestOrRangeCount: 0,
        hiddenHeavyTaskCount: 0,
        longTaskCount: 0,
      });
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });
});
