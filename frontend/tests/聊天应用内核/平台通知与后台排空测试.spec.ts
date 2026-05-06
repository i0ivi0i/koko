import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../应用根/聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试, 观察媒体窗口 } from "../common/聊天应用内核支架";
import type { 浏览器应用平台命令, 浏览器应用平台快照 } from "../../平台/浏览器应用平台";

describe("聊天应用内核 - 平台通知与后台排空", () => {
  it("后台收到别人的权威新消息时，会由聊天内核向平台发通知和 badge 命令，而不是壳层自己猜浏览器 API", async () => {
    const transport = new 假传输();
    const 平台命令记录: 浏览器应用平台命令[] = [];
    const 平台快照: 浏览器应用平台快照 = {
      lifecycle: { visibility: "hidden", phase: "background" },
      serviceWorker: {
        workerRegistered: true,
        persistentStorageRequested: true,
        controllerAttached: false,
        workerWaiting: false,
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
      attachments: [],
      event_position: 2,
    });

    expect(平台命令记录).toEqual([]);
  });

  it("平台发出 online 恢复事件后，等待中的媒体会话会自动重跑解析并恢复首个可播源", async () => {
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
              online: false,
              backgroundSyncSupported: false,
              queuedTaskCapability: "none",
            },
          }) as 浏览器应用平台快照,
        dispatch: async () => true,
      },
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi
        .fn()
        .mockResolvedValue({
          mode: "legacy_anchor",
          attachmentId: "att-video-1",
          kind: "video",
          src: "http://media.local/original-att-video-1",
          thumbnailUrl: null,
          hint: null,
        }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-video-1"]);

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

    await kernel.dispatch({ type: "PLATFORM_OFFLINE_STATUS_CHANGED", online: true });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const playback = kernel.snapshot().media.playbackByAttachmentId["att-video-1"];
      if (playback) {
        break;
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(kernel.snapshot().media.playbackByAttachmentId["att-video-1"]).toMatchObject({
      src: "http://media.local/original-att-video-1",
      mode: "legacy_anchor",
    });
  });

  it("平台发出 BACKGROUND_DRAIN_REQUESTED 时，聊天内核会触发离线队列排空", async () => {
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

    await kernel.dispatch({ type: "PLATFORM_BACKGROUND_DRAIN_REQUESTED" });
    await Promise.resolve();

    expect(排空到期任务).toHaveBeenCalledTimes(1);
    kernel.dispose();
  });

  it("内核销毁时会释放仍在占用的 swarm 播放资源，而不是只销毁外层会话对象", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-release-1",
            client_message_id: "c-video-release-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-release-1",
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
    const 释放附件播放资源 = vi.fn();
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-release-1",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-release-1",
        thumbnailUrl: null,
        hint: "正在协作分发",
      }),
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-video-release-1"]);

    kernel.dispose();

    expect(释放附件播放资源).toHaveBeenCalledWith({
      attachmentId: "att-video-release-1",
      consumerId: "session:att-video-release-1",
    });
  });
});
