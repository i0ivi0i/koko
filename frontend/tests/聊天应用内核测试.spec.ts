import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import { createFakeStorage, 假传输 } from "./common/聊天测试支架";
import { 创建聊天应用内核 } from "../聊天应用内核";
import type {
  浏览器应用平台事件,
  浏览器应用平台命令,
  浏览器应用平台快照,
} from "../平台/浏览器应用平台";

const 创建内核宿主 = () => ({
  addController: vi.fn(),
  removeController: vi.fn(),
  requestUpdate: vi.fn(),
  updateComplete: Promise.resolve(true),
});

const 创建内核依赖 = () => {
  const 滚动宿主 = 创建内核宿主();
  return {
    滚动宿主,
    渲染桥: {
      请求重渲染: () => {
        滚动宿主.requestUpdate();
      },
      等待壳渲染完成: async () => {
        await 滚动宿主.updateComplete;
      },
    },
  };
};

type 聊天媒体测试端口 = {
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    重试草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  设置媒体查看器供测试(viewer: { 打开(input: { startAttachmentId: string; items: unknown[] }): void; 销毁(): void }): void;
};

const 读取媒体编排供测试 = (kernel: unknown): 聊天媒体测试端口 =>
  (kernel as { 媒体编排: 聊天媒体测试端口 }).媒体编排;

describe("聊天应用内核", () => {
  it("不再暴露 transportPort / replaceSnapshot 这类兼容旧壳层的旁路入口", () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    expect(typeof kernel.snapshot).toBe("function");
    expect(typeof kernel.dispatch).toBe("function");
    expect(typeof kernel.dispose).toBe("function");
    expect("transportPort" in kernel).toBe(false);
    expect("roomScrollerPort" in kernel).toBe(false);
    expect("recoveryPort" in kernel).toBe(false);
    expect("readPort" in kernel).toBe(false);
    expect("replaceSnapshot" in kernel).toBe(false);
    expect("readRecoveryPrimeFlag" in kernel).toBe(false);
    expect("writeRecoveryPrimeFlag" in kernel).toBe(false);
  });

  it("只通过 dispatch / snapshot 暴露聊天业务入口，壳层不再自己拼 join/send/leave 过程", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });

    const snapshot = kernel.snapshot();

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(snapshot.roomId).toBe("r-test");
    expect(snapshot.roomDisplayTitle).toBe("ROOM01");
  });

  it("发送命令也通过内核 dispatch 统一进入，而不是壳层自己保留 sendCurrentMessage 业务入口", async () => {
    const transport = new 假传输();
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await kernel.dispatch({ type: "MESSAGE_INPUT_CHANGED", value: "hello kernel" });
    await kernel.dispatch({ type: "SEND_MESSAGE_REQUESTED" });

    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) => event === "create_message" && payload.text === "hello kernel"
      )
    ).toBe(true);
  });

  it("壳层媒体动作也只通过 dispatch 进入内核，不再直接摸媒体编排对象", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const imageFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });
    const fake媒体发布器 = {
      处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
      移除草稿: vi.fn(),
      重试草稿: vi.fn().mockResolvedValue(undefined),
      清空: vi.fn(),
      销毁: vi.fn(),
    };
    const fake查看器 = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };

    读取媒体编排供测试(kernel).设置媒体发布器供测试(fake媒体发布器);
    读取媒体编排供测试(kernel).设置媒体查看器供测试(fake查看器);

    await kernel.dispatch({ type: "MEDIA_FILES_SELECTED", files: [imageFile] });
    await kernel.dispatch({ type: "MEDIA_DRAFT_RETRY_REQUESTED", localId: "draft-1" });
    await kernel.dispatch({ type: "MEDIA_DRAFT_REMOVE_REQUESTED", localId: "draft-2" });
    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-1",
        items: [],
      },
    });

    expect(fake媒体发布器.处理选择媒体文件).toHaveBeenCalledWith([imageFile]);
    expect(fake媒体发布器.重试草稿).toHaveBeenCalledWith("draft-1");
    expect(fake媒体发布器.移除草稿).toHaveBeenCalledWith("draft-2");
    expect(fake查看器.打开).toHaveBeenCalledWith({
      startAttachmentId: "att-1",
      items: [],
    });
  });

  it("后台收到别人的权威新消息时，会由聊天内核向平台发通知和 badge 命令，而不是壳层自己猜浏览器 API", async () => {
    const transport = new 假传输();
    const 平台命令记录: 浏览器应用平台命令[] = [];
    const 平台快照: 浏览器应用平台快照 = {
      lifecycle: { visibility: "hidden", phase: "background" },
      serviceWorker: {
        appShellRegistered: true,
        mediaWorkerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: false,
        appShellWaiting: false,
        mediaWorkerWaiting: false,
        lastMessageType: null,
        lastMessage: null,
      },
      transport: {
        lastLifecycle: { visibility: "hidden", phase: "background" },
        realtimePolicy: {
          intent: "resume",
          reconnection: false,
          reason: "background",
        },
      },
      multiContext: {
        contextId: "tab-b",
        isPrimaryContext: false,
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
    };
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
        offline: {} as never,
        启动: async () => {},
        snapshot: () => 平台快照,
        dispatch: async (command: 浏览器应用平台命令) => {
          平台命令记录.push(command);
          return true;
        },
      },
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-foreign",
      client_message_id: "c-foreign",
      sender_session_id: "s-other",
      sender_display_alias: "隔壁老王",
      text: "有人说话了",
      body: "有人说话了",
      attachments: [],
      event_position: 2,
    });

    expect(平台命令记录).toEqual([
      {
        type: "SET_BADGE",
        count: 1,
      },
      {
        type: "SHOW_NOTIFICATION",
        id: "m-foreign",
        title: "隔壁老王",
        body: "有人说话了",
        tag: "r-test",
      },
    ]);
  });

  it("当前台主窗口正在活跃时，聊天内核不会再让平台重复弹系统通知", async () => {
    const transport = new 假传输();
    const 平台命令记录: 浏览器应用平台命令[] = [];
    const 平台快照: 浏览器应用平台快照 = {
      lifecycle: { visibility: "visible", phase: "active" },
      serviceWorker: {
        appShellRegistered: true,
        mediaWorkerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: false,
        appShellWaiting: false,
        mediaWorkerWaiting: false,
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
        badgeCount: 2,
      },
      offline: {
        online: true,
        backgroundSyncSupported: true,
        queuedTaskCapability: "background-sync",
      },
    };
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
        offline: {} as never,
        启动: async () => {},
        snapshot: () => 平台快照,
        dispatch: async (command: 浏览器应用平台命令) => {
          平台命令记录.push(command);
          return true;
        },
      },
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-active",
      client_message_id: "c-active",
      sender_session_id: "s-other",
      sender_display_alias: "隔壁老王",
      text: "我还在前台",
      body: "我还在前台",
      attachments: [],
      event_position: 2,
    });

    expect(平台命令记录).toEqual([]);
  });

  it("平台发出 BACKGROUND_DRAIN_REQUESTED 时，聊天内核会触发离线队列排空", async () => {
    const transport = new 假传输();
    const 排空到期任务 = vi.fn(async () => {});
    let 平台事件监听器: ((event: 浏览器应用平台事件) => void) | null = null;
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
              appShellRegistered: true,
              mediaWorkerRegistered: true,
              persistentStorageRequested: true,
              controllerAttached: false,
              appShellWaiting: false,
              mediaWorkerWaiting: false,
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
        订阅事件: (listener: (event: 浏览器应用平台事件) => void) => {
          平台事件监听器 = listener;
          return () => {
            平台事件监听器 = null;
          };
        },
      },
    });

    const 已注册事件监听器 =
      平台事件监听器 as ((event: 浏览器应用平台事件) => void) | null;
    if (typeof 已注册事件监听器 === "function") {
      已注册事件监听器({ type: "BACKGROUND_DRAIN_REQUESTED" });
    }
    await Promise.resolve();

    expect(排空到期任务).toHaveBeenCalledTimes(1);
    kernel.dispose();
  });
});
