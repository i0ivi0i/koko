import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器应用平台 } from "../平台/浏览器应用平台";
import type { 生命周期快照 } from "../平台/生命周期运行时";
import type { 服务工作线程运行时事件 } from "../平台/服务工作线程运行时";

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
    expect(source).not.toContain("private get chatState()");
    expect(source).not.toContain("private set chatState(");
    expect(source).not.toContain("get roomScroller()");
    expect(source).not.toContain("get 恢复编排端口()");
    expect(source).not.toContain("get 阅读推进编排端口()");
    expect(source).not.toContain("get shouldPrimeReadAnchorAfterInitialSettle()");
    expect(source).not.toContain("set shouldPrimeReadAnchorAfterInitialSettle(");
    expect(source).not.toContain("this.kernel.transportPort()");
    expect(source).not.toContain("this.kernel.roomScrollerPort()");
    expect(source).not.toContain("this.kernel.recoveryPort()");
    expect(source).not.toContain("this.kernel.readPort()");
    expect(source).not.toContain("this.kernel.replaceSnapshot(");
  });

  it("聊天主链编排不再共写一个 shared chatState，而是只消费各自显式 state slice", () => {
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const recoverySource = 读取前端源码("房间恢复编排.ts");
    const realtimeSource = 读取前端源码("房间实时编排.ts");
    const readSource = 读取前端源码("阅读推进编排.ts");
    const scrollerSource = 读取前端源码("房间滚动器.ts");

    expect(kernelSource).not.toContain("private chatState:");

    expect(recoverySource).not.toContain("读取状态(): 聊天状态");
    expect(recoverySource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(recoverySource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(realtimeSource).not.toContain("读取状态(): 聊天状态");
    expect(realtimeSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(realtimeSource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(readSource).not.toContain("读取状态(): 聊天状态");
    expect(readSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
    expect(readSource).not.toContain("roomShellPatch(): Partial<聊天状态>");

    expect(scrollerSource).not.toContain("更新状态(patch: Partial<聊天状态>)");
  });

  it("聊天壳当前已把滚动和媒体信号先交给应用运行时，而不是在模板里直接裁决", () => {
    const source = 读取前端源码("聊天壳.ts");

    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_INTENT"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_SCROLL_OBSERVED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"ROOM_JUMP_TO_LATEST_REQUESTED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_OPEN_REQUESTED"/);
    expect(source).toMatch(/this\.应用运行时\.dispatch\(\{\s*type:\s*"MEDIA_SESSION_SIGNALLED"/);
    expect(source).not.toContain("this.kernel.处理选择媒体文件(");
    expect(source).not.toContain("this.kernel.移除媒体草稿(");
    expect(source).not.toContain("this.kernel.重试媒体草稿(");
  });

  it("聊天壳渲染路径只读快照，不再在模板里直接摸内核 helper 或转发媒体测试 setter", () => {
    const shellSource = 读取前端源码("聊天壳.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const swarmSource = 读取前端源码("媒体/媒体协作分发.ts");
    const testHarnessSource = 读取前端源码("tests/common/聊天测试支架.ts");

    expect(shellSource).not.toContain("this.kernel.构建附件内容地址(");
    expect(shellSource).not.toContain("setMediaPlayerForTest(");
    expect(shellSource).not.toContain("setMediaViewerForTest(");
    expect(shellSource).not.toContain("setMediaPublisherForTest(");
    expect(shellSource).not.toContain("host: this,");

    expect(kernelSource).not.toContain("构建附件内容地址(attachmentId: string");
    expect(kernelSource).not.toContain("设置媒体播放器供测试(");
    expect(kernelSource).not.toContain("设置媒体查看器供测试(");
    expect(kernelSource).not.toContain("设置媒体发布器供测试(");
    expect(kernelSource).not.toContain("export interface 聊天应用内核宿主");
    expect(kernelSource).not.toContain("deps.host.updateComplete");
    expect(kernelSource).not.toContain("deps.host.requestUpdate()");
    expect(kernelSource).not.toContain("注入快照补丁供测试(");
    expect(testHarnessSource).not.toContain("注入聊天快照补丁供测试(");
    expect(swarmSource).not.toContain("navigator.serviceWorker.ready");
  });

  it("应用运行时只负责把浏览器事件翻成内核 command，不再知道具体 owner 动词", () => {
    const source = 读取前端源码("应用运行时.ts");

    expect(source).toContain("dispatch(command)");
    expect(source).not.toContain("标记用户滚动意图(): void");
    expect(source).not.toContain("处理聊天视口滚动(scrollContainer: HTMLElement): void");
    expect(source).not.toContain("请求跳到最新(): Promise<void>");
    expect(source).not.toContain("登记程序滚动来源(source:");
    expect(source).not.toContain("打开媒体(request:");
  });

  it("聊天壳和后台壳都通过各自应用内核间接拿 transport，而不是壳层自己 new HttpRealtime传输", () => {
    const chatSource = 读取前端源码("聊天壳.ts");
    const kernelSource = 读取前端源码("聊天应用内核.ts");
    const adminSource = 读取前端源码("后台壳.ts");
    const adminKernelSource = 读取前端源码("后台应用内核.ts");

    expect(chatSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(kernelSource).toContain('from "./平台/index.js"');
    expect(kernelSource).toContain("deps.platform ?? 获取默认浏览器应用平台()");
    expect(kernelSource).toContain("this.platform.transport.transport()");

    expect(adminSource).toContain('from "./后台应用内核.js"');
    expect(adminSource).not.toContain('from "./平台/index.js"');
    expect(adminSource).not.toContain("private transport:");
    expect(adminSource).not.toContain("new HttpRealtime传输(window.location.origin)");
    expect(adminKernelSource).toContain('from "./平台/index.js"');
    expect(adminKernelSource).toContain("deps.platform ?? 获取默认浏览器应用平台()");
    expect(adminKernelSource).toContain("this.platform.transport.transport()");
    expect(adminKernelSource).not.toContain("overviewText:");
    expect(adminKernelSource).not.toContain("detailText:");
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
        读取注册: (kind: "app" | "media") =>
          kind === "app" ? appRegistration : mediaRegistration,
        snapshot: () => ({
          appShellRegistered: true,
          mediaWorkerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => true,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
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
      },
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
        appShellWaiting: false,
        mediaWorkerWaiting: false,
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
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: { visibility: "visible" as const, phase: "active" as const },
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: true,
            reason: "active" as const,
          },
        }),
      },
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
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      },
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
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      },
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
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      },
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
          appShellRegistered: false,
          mediaWorkerRegistered: false,
          persistentStorageRequested: false,
          controllerAttached: false,
          appShellWaiting: false,
          mediaWorkerWaiting: false,
          lastMessageType: null,
          lastMessage: null,
        }),
        发送消息: () => false,
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({ lastLifecycle: null, realtimePolicy: null as never }),
      },
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
        appShellRegistered: true,
        mediaWorkerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: true,
        appShellWaiting: false,
        mediaWorkerWaiting: false,
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
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      },
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
          appShellRegistered: true,
          mediaWorkerRegistered: true,
          persistentStorageRequested: true,
          controllerAttached: true,
          appShellWaiting: true,
          mediaWorkerWaiting: false,
          lastMessageType: "SW_UPDATED",
          lastMessage: { type: "SW_UPDATED", scope: "app" },
        }),
      },
      transport: {
        transport: () => {
          throw new Error("not used");
        },
        接收生命周期变化: () => {},
        snapshot: () => ({
          lastLifecycle: null,
          realtimePolicy: {
            intent: "resume" as const,
            reconnection: false,
            reason: "background" as const,
          },
        }),
      },
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
      appShellRegistered: true,
      mediaWorkerRegistered: true,
      persistentStorageRequested: true,
      controllerAttached: true,
      appShellWaiting: true,
      mediaWorkerWaiting: false,
      lastMessageType: "SW_UPDATED",
      lastMessage: { type: "SW_UPDATED", scope: "app" },
    });
  });
});
