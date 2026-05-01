import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试, 观察媒体窗口 } from "../common/聊天应用内核支架";
import type { 浏览器应用平台快照 } from "../../平台/浏览器应用平台";

describe("聊天应用内核 - 消息流自动播", () => {
  it("打开正式查看器前不会再预热正式媒体会话；owner 成立后才通过 inline_autoplay surface 解析轻量播放源", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-1",
            client_message_id: "c-video-inline-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-1",
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
    const 打开查看器 = vi.fn();
    const 释放附件播放资源 = vi.fn();
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-inline-1",
        kind: "video",
        src: "http://media.local/original-att-video-inline-1",
        thumbnailUrl: "http://media.local/poster-att-video-inline-1",
        hint: null,
      });
    读取媒体编排供测试(kernel).设置媒体查看器供测试({
      打开: 打开查看器,
      销毁: vi.fn(),
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 12,
        },
      ],
    });
    expect(解析播放结果).toHaveBeenCalledTimes(0);
    expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();

    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(解析播放结果).toHaveBeenCalledTimes(1);
      expect(解析播放结果).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        kind: "video",
        consumerId: "inline_autoplay:att-video-inline-1",
        surface: "inline_autoplay",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-1"
      );

      await kernel.dispatch({
        type: "MEDIA_OPEN_REQUESTED",
        request: {
          startAttachmentId: "att-video-inline-1",
          items: [
            {
              kind: "video",
              attachmentId: "att-video-inline-1",
              src: "http://media.local/original-att-video-inline-1",
              posterSrc: "http://media.local/poster-att-video-inline-1",
              width: 1280,
              height: 720,
            },
          ],
        },
      });

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        consumerId: "inline_autoplay:att-video-inline-1",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();
      expect(打开查看器).toHaveBeenCalledTimes(1);
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("关闭正式查看器后，会按最后一次可见候选重新建立消息流自动播 owner", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-restore",
            client_message_id: "c-video-inline-restore",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-restore",
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
    const 解析播放结果 = vi.fn().mockResolvedValue({
      mode: "anchor",
      attachmentId: "att-video-inline-restore",
      kind: "video",
      src: "http://media.local/original-att-video-inline-restore",
      thumbnailUrl: "http://media.local/poster-att-video-inline-restore",
      hint: null,
    });
    读取媒体编排供测试(kernel).设置媒体查看器供测试({
      打开: vi.fn(),
      销毁: vi.fn(),
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
      释放附件播放资源: vi.fn(),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-restore",
          visibilityRatio: 0.86,
          distanceToViewportCenter: 10,
        },
      ],
    });

    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-restore"
      );
      expect(解析播放结果).toHaveBeenCalledTimes(1);

      await kernel.dispatch({
        type: "MEDIA_OPEN_REQUESTED",
        request: {
          startAttachmentId: "att-video-inline-restore",
          items: [
            {
              kind: "video",
              attachmentId: "att-video-inline-restore",
              src: "http://media.local/original-att-video-inline-restore",
              posterSrc: "http://media.local/poster-att-video-inline-restore",
              width: 1280,
              height: 720,
            },
          ],
        },
      });

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();
      const 关闭查看器前解析次数 = 解析播放结果.mock.calls.length;

      读取媒体编排供测试(kernel).关闭媒体查看器供测试();
      await Promise.resolve();

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();

      await vi.advanceTimersByTimeAsync(121);
      await Promise.resolve();

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-restore"
      );
      expect(解析播放结果).toHaveBeenCalledTimes(关闭查看器前解析次数 + 1);
      expect(解析播放结果).toHaveBeenLastCalledWith({
        attachmentId: "att-video-inline-restore",
        kind: "video",
        consumerId: "inline_autoplay:att-video-inline-restore",
        surface: "inline_autoplay",
      });
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("单个视频已经完整进入视口时，真正自动播 owner 仍会在旧 120ms 稳定窗之前启动解析", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-fast",
            client_message_id: "c-video-inline-fast",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-fast",
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
    const 解析播放结果 = vi.fn().mockResolvedValue({
      mode: "anchor",
      attachmentId: "att-video-inline-fast",
      kind: "video",
      src: "http://media.local/original-att-video-inline-fast",
      thumbnailUrl: "http://media.local/poster-att-video-inline-fast",
      hint: null,
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
      释放附件播放资源: vi.fn(),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-fast",
          visibilityRatio: 1,
          distanceToViewportCenter: 0,
        },
      ],
    });
    expect(解析播放结果).toHaveBeenCalledTimes(0);

    try {
      await vi.advanceTimersByTimeAsync(81);

      expect(解析播放结果).toHaveBeenCalledTimes(1);
      expect(解析播放结果).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-fast",
        kind: "video",
        consumerId: "inline_autoplay:att-video-inline-fast",
        surface: "inline_autoplay",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-fast"
      );
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("inline autoplay 首轮只拿到 connecting_to_peers 时，会继续重试直到拿到真实 swarm", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-retry",
            client_message_id: "c-video-inline-retry",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-retry",
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
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValueOnce({
        mode: "degraded",
        attachmentId: "att-video-inline-retry",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        reason: "connecting_to_peers",
        hint: "正在尝试连接群友",
      })
      .mockResolvedValueOnce({
        mode: "degraded",
        attachmentId: "att-video-inline-retry",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        reason: "connecting_to_peers",
        hint: "正在尝试连接群友",
      })
      .mockResolvedValueOnce({
        mode: "swarm",
        attachmentId: "att-video-inline-retry",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-inline-retry",
        thumbnailUrl: null,
        hint: null,
      });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
      释放附件播放资源: vi.fn(),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-retry",
          visibilityRatio: 0.95,
          distanceToViewportCenter: 4,
        },
      ],
    });

    try {
      await vi.advanceTimersByTimeAsync(81);
      await Promise.resolve();

      expect(解析播放结果).toHaveBeenCalledTimes(2);
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-retry"
      );
      expect(
        kernel.snapshot().media.inlineAutoplayPlaybackByAttachmentId["att-video-inline-retry"]
      ).toBeUndefined();

      /**
       * 真实浏览器里这正是最容易卡成“只有占位图”的窗口：
       * 1. 第一轮 locator/torrent 只回 `connecting_to_peers` 很常见；
       * 2. 如果 inline autoplay 在这里不继续重试，owner 会挂着但永远没有 swarm playback；
       * 3. 因而 2 秒恢复窗之后，必须在 owner 仍有效时自动再试一次。
       */
      await vi.advanceTimersByTimeAsync(2001);
      await Promise.resolve();

      expect(解析播放结果).toHaveBeenCalledTimes(3);
      expect(
        kernel.snapshot().media.inlineAutoplayPlaybackByAttachmentId["att-video-inline-retry"]
      ).toMatchObject({
        mode: "swarm",
        attachmentId: "att-video-inline-retry",
        src: "blob:http://media.local/swarm-att-video-inline-retry",
      });
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("自动播候选在稳定前抖动时，只会为最终 owner 启动一次解析", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-1",
            client_message_id: "c-video-inline-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-2",
            client_message_id: "c-video-inline-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-2",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-3",
            client_message_id: "c-video-inline-3",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-3",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 3,
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
    const 解析播放结果 = vi.fn().mockResolvedValue({
      mode: "anchor",
      attachmentId: "att-video-inline-3",
      kind: "video",
      src: "http://media.local/original-att-video-inline-3",
      thumbnailUrl: "http://media.local/poster-att-video-inline-3",
      hint: null,
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
      释放附件播放资源: vi.fn(),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 24,
        },
      ],
    });
    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-2",
          visibilityRatio: 0.9,
          distanceToViewportCenter: 10,
        },
      ],
    });
    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-3",
          visibilityRatio: 0.95,
          distanceToViewportCenter: 6,
        },
      ],
    });

    expect(解析播放结果).toHaveBeenCalledTimes(0);
    expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();

    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(解析播放结果).toHaveBeenCalledTimes(1);
      expect(解析播放结果).toHaveBeenLastCalledWith({
        attachmentId: "att-video-inline-3",
        kind: "video",
        consumerId: "inline_autoplay:att-video-inline-3",
        surface: "inline_autoplay",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-3"
      );
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("加入房间后不会为时间线里的视频附件立即启动正式解析", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-lazy-1",
            client_message_id: "c-video-lazy-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-lazy-1",
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
    const 解析播放结果 = vi.fn().mockResolvedValue({
      mode: "anchor",
      attachmentId: "att-video-lazy-1",
      kind: "video",
      src: "http://media.local/original-att-video-lazy-1",
      thumbnailUrl: "http://media.local/poster-att-video-lazy-1",
      hint: null,
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-video-lazy-1"]);

    expect(解析播放结果).not.toHaveBeenCalled();
    expect(kernel.snapshot().media.playbackByAttachmentId["att-video-lazy-1"]).toBeUndefined();
    expect(kernel.snapshot().media.sessionByAttachmentId["att-video-lazy-1"]).toMatchObject({
      attachmentId: "att-video-lazy-1",
      playback: null,
      status: "bootstrapping",
    });
  });

  it("平台切到后台排空时，会释放当前消息流自动播 owner", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-1",
            client_message_id: "c-video-inline-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-1",
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
    const 释放附件播放资源 = vi.fn();
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-inline-1",
        kind: "video",
        src: "http://media.local/original-att-video-inline-1",
        thumbnailUrl: "http://media.local/poster-att-video-inline-1",
        hint: null,
      }),
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 12,
        },
      ],
    });
    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-1"
      );

      await kernel.dispatch({ type: "PLATFORM_BACKGROUND_DRAIN_REQUESTED" });
      await Promise.resolve();
      await Promise.resolve();

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        consumerId: "inline_autoplay:att-video-inline-1",
      });
      expect(释放附件播放资源).not.toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        consumerId: "session:att-video-inline-1",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });

  it("生命周期进入 hidden/background 时会释放消息流自动播 owner", async () => {
    vi.useFakeTimers();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-1",
            client_message_id: "c-video-inline-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-1",
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
    const 释放附件播放资源 = vi.fn();
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-inline-1",
        kind: "video",
        src: "http://media.local/inline-1",
        thumbnailUrl: null,
        hint: null,
      }),
      激活协作补齐: vi.fn(async () => {}),
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-inline-1",
          visibilityRatio: 0.82,
          distanceToViewportCenter: 12,
        },
      ],
    });

    try {
      await vi.advanceTimersByTimeAsync(121);

      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBe(
        "att-video-inline-1"
      );

      await kernel.dispatch({
        type: "PLATFORM_LIFECYCLE_CHANGED",
        snapshot: { visibility: "hidden", phase: "background" },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(释放附件播放资源).toHaveBeenCalledWith({
        attachmentId: "att-video-inline-1",
        consumerId: "inline_autoplay:att-video-inline-1",
      });
      expect(kernel.snapshot().media.inlineAutoplayOwnerAttachmentId).toBeNull();
    } finally {
      kernel.dispose();
      vi.useRealTimers();
    }
  });
});
