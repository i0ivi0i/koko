import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "./common/聊天测试支架";
import { 创建聊天应用内核 } from "../聊天应用内核";
import type {
  浏览器应用平台事件,
  浏览器应用平台命令,
  浏览器应用平台快照,
} from "../平台/浏览器应用平台";
import type { 媒体播放结果 } from "../媒体/媒体播放";
import type { 媒体会话信号 } from "../媒体/媒体会话";

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
  设置媒体查看器供测试(viewer: {
    打开(input: { startAttachmentId: string; items: unknown[] }): void;
    同步?(input: { startAttachmentId: string; items: unknown[] }): void;
    销毁(): void;
  }): void;
  设置媒体播放器供测试(player: {
    解析播放结果(input: { attachmentId: string; kind: "image" | "video" }): Promise<媒体播放结果>;
  }): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
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

  it("消息列表不变时，媒体运行时信号也会刷新 media snapshot", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-1",
            client_message_id: "c-video-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            body: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 第二次解析挂起 = new Promise<媒体播放结果>(() => {});
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValueOnce({
          mode: "anchor",
          attachmentId: "att-video-1",
          kind: "video",
          src: "http://media.local/original-att-video-1",
          thumbnailUrl: null,
          hint: null,
        })
        .mockImplementationOnce(() => 第二次解析挂起),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal: {
        type: "PLAYER_PLAYING",
      },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal: {
        type: "PLAYER_WAITING",
      },
    });

    expect(kernel.snapshot().media.sessionByAttachmentId["att-video-1"]).toMatchObject({
      status: "recovering",
    });
  });

  it("图片预览源加载失败后也会触发会话恢复，并切到新的播放源", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-image-1",
            client_message_id: "c-image-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            body: "",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValueOnce({
          mode: "anchor",
          attachmentId: "att-image-1",
          kind: "image",
          src: "http://media.local/original-att-image-1",
          thumbnailUrl: "http://media.local/thumb-att-image-1",
          hint: null,
        })
        .mockResolvedValueOnce({
          mode: "swarm",
          attachmentId: "att-image-1",
          kind: "image",
          src: "blob:http://media.local/swarm-att-image-1",
          thumbnailUrl: "http://media.local/thumb-att-image-1",
          hint: "正在协作分发",
        }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    expect(kernel.snapshot().media.playbackByAttachmentId["att-image-1"]).toMatchObject({
      src: "http://media.local/original-att-image-1",
      mode: "anchor",
    });

    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-image-1",
      signal: {
        type: "PLAYER_ERROR",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(kernel.snapshot().media.playbackByAttachmentId["att-image-1"]).toMatchObject({
      src: "blob:http://media.local/swarm-att-image-1",
      mode: "swarm",
    });
  });

  it("打开中的媒体查看器会跟随会话恢复结果同步新播放源，而不是继续抱着旧 src", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-1",
            client_message_id: "c-video-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            body: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const fake查看器 = {
      打开: vi.fn(),
      同步: vi.fn(),
      销毁: vi.fn(),
    };
    读取媒体编排供测试(kernel).设置媒体查看器供测试(fake查看器);
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValueOnce({
          mode: "anchor",
          attachmentId: "att-video-1",
          kind: "video",
          src: "http://media.local/original-att-video-1",
          thumbnailUrl: null,
          hint: null,
        })
        .mockResolvedValueOnce({
          mode: "swarm",
          attachmentId: "att-video-1",
          kind: "video",
          src: "blob:http://media.local/swarm-att-video-1",
          thumbnailUrl: null,
          hint: "正在协作分发",
        }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            src: "http://media.local/original-att-video-1",
            posterSrc: null,
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal: {
        type: "PLAYER_WAITING",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake查看器.同步).toHaveBeenCalledWith({
      startAttachmentId: "att-video-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "blob:http://media.local/swarm-att-video-1",
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });
  });

  it("打开中的视频查看器在会话重裁决到 HLS manifest 后，也会同步到标准流媒体主链", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-hls",
            client_message_id: "c-video-hls",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            body: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-hls",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const fake查看器 = {
      打开: vi.fn(),
      同步: vi.fn(),
      销毁: vi.fn(),
    };
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体查看器供测试(fake查看器);
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValueOnce({
          mode: "anchor",
          attachmentId: "att-video-hls",
          kind: "video",
          src: "http://media.local/original-att-video-hls",
          thumbnailUrl: "http://media.local/poster-att-video-hls",
          hint: null,
        })
        .mockResolvedValueOnce({
          mode: "manifest",
          attachmentId: "att-video-hls",
          kind: "video",
          src: "http://media.local/stream/att-video-hls/master.m3u8",
          thumbnailUrl: "http://media.local/poster-att-video-hls",
          hint: null,
        }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-hls",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-hls",
            src: "http://media.local/original-att-video-hls",
            posterSrc: "http://media.local/poster-att-video-hls",
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-hls",
      signal: {
        type: "PLAYER_WAITING",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake查看器.同步).toHaveBeenCalledWith({
      startAttachmentId: "att-video-hls",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-hls",
          src: "http://media.local/stream/att-video-hls/master.m3u8",
          posterSrc: "http://media.local/poster-att-video-hls",
          width: 1280,
          height: 720,
        },
      ],
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

  it("平台发出 online 恢复事件后，等待中的媒体会话会自动重新解析播放源", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-1",
            client_message_id: "c-video-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            body: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
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
            online: false,
            backgroundSyncSupported: false,
            queuedTaskCapability: "none" as const,
          }),
          就绪: async () => {},
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
              online: false,
              backgroundSyncSupported: false,
              queuedTaskCapability: "none",
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
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValueOnce({
          mode: "anchor",
          attachmentId: "att-video-1",
          kind: "video",
          src: "http://media.local/original-att-video-1",
          thumbnailUrl: null,
          hint: null,
        })
        .mockResolvedValueOnce({
          mode: "swarm",
          attachmentId: "att-video-1",
          kind: "video",
          src: "blob:http://media.local/recovered-att-video-1",
          thumbnailUrl: null,
          hint: "正在协作分发",
        }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal: { type: "SWARM_NO_PEERS" },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-1",
      signal: { type: "ORIGIN_UNAVAILABLE" },
    });

    expect(kernel.snapshot().media.sessionByAttachmentId["att-video-1"]).toMatchObject({
      status: "waiting_for_peer_or_network",
    });

    const 触发平台事件 =
      平台事件监听器 as ((event: 浏览器应用平台事件) => void) | null;
    if (typeof 触发平台事件 === "function") {
      触发平台事件({ type: "OFFLINE_STATUS_CHANGED", online: true });
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(kernel.snapshot().media.playbackByAttachmentId["att-video-1"]).toMatchObject({
      src: "blob:http://media.local/recovered-att-video-1",
      mode: "swarm",
    });
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
