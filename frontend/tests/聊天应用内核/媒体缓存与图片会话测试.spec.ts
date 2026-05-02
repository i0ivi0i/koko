import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../聊天应用内核";
import { 创建浏览器应用平台 } from "../../平台/浏览器应用平台";
import { 创建存储运行时 } from "../../平台/存储运行时";
import { 创建内核依赖, 读取媒体编排供测试, 观察媒体窗口 } from "../common/聊天应用内核支架";
import type { 图片协作补齐激活请求 } from "../common/聊天应用内核支架";
import type { 媒体播放结果, 媒体播放位置 } from "../../媒体/媒体播放";

describe("聊天应用内核 - 媒体缓存与图片会话", () => {
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
    await 观察媒体窗口(kernel, ["att-video-1"]);
    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
      candidates: [
        {
          attachmentId: "att-video-1",
          visibilityRatio: 0.92,
          distanceToViewportCenter: 0,
        },
      ],
    });
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
      status: "bootstrapping",
    });
  });

  it("消息流自动播播放位置必须通过内核进入媒体运行时 owner，而不是留在壳层私有状态", async () => {
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const position: 媒体播放位置 = {
      src: "http://media.local/swarm-video-1",
      currentTime: 33.75,
      updatedAt: 1_000,
    };

    await kernel.dispatch({
      type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED",
      attachmentId: "att-video-1",
      position,
    } as never);

    expect(
      kernel.snapshot().media.inlineAutoplayPositionByAttachmentId["att-video-1"]
    ).toEqual(position);
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
    await 观察媒体窗口(kernel, ["att-image-1"]);

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

  it("图片查看器上报 ASSET_COMPLETE 后，会把 contentHash 写入缓存并在重开后恢复 locally_complete", async () => {
    const 创建图片消息传输 = () => {
      const transport = new 假传输();
      transport.joinQueue = [
        创建房间快照("r-test", 1, {
          snapshot_messages: [
            {
              type: "message_created",
              room_id: "r-test",
              message_id: "m-image-cache-1",
              client_message_id: "c-image-cache-1",
              sender_session_id: "s-other",
              sender_display_alias: "冷静的水獭",
              text: "",
              attachments: [
                {
                  kind: "image",
                  attachment_id: "att-image-cache-1",
                  width: 1200,
                  height: 800,
                },
              ],
              event_position: 1,
            },
          ],
        }),
      ];
      return transport;
    };
    const storageSource = createFakeStorage();
    const 创建共享平台 = () =>
      创建浏览器应用平台({
        storage: 创建存储运行时({ storage: storageSource }),
      });
    const fake查看器 = {
      打开: vi.fn(),
      同步: vi.fn(),
      销毁: vi.fn(),
    };
    const blob播放结果 = {
      mode: "anchor" as const,
      attachmentId: "att-image-cache-1",
      kind: "image" as const,
      src: "http://media.local/blob/att-image-cache-1/full.webp",
      thumbnailUrl: "http://media.local/blob/att-image-cache-1/preview.webp",
      contentHash: "hash-image-cache-1",
      distribution: {
        swarm_id: "swarm-image-cache-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/blob/att-image-cache-1/original.png",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    };

    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建图片消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体查看器供测试(fake查看器);
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue(blob播放结果),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-image-cache-1"]);

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-image-cache-1",
        items: [
          {
            kind: "image",
            attachmentId: "att-image-cache-1",
            src: "http://media.local/blob/att-image-cache-1/full.webp",
            contentHash: "hash-image-cache-1",
            distribution: {
              swarm_id: "swarm-image-cache-1",
              announce_urls: ["wss://tracker.koko.local/announce"],
              web_seed_url: "http://media.local/blob/att-image-cache-1/original.png",
              join_ticket: null,
              ticket_expires_at: null,
              survival_mode: "server_assisted" as const,
            },
            alt: "图片附件原图",
            width: 1200,
            height: 800,
          },
        ],
      },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-image-cache-1",
      signal: {
        type: "ASSET_COMPLETE",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      kernel.snapshot().media.sessionByAttachmentId["att-image-cache-1"]
    ).toMatchObject({
      status: "locally_complete",
      locallyComplete: true,
    });

    const reopenedKernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建图片消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(reopenedKernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue(blob播放结果),
    });

    await reopenedKernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await reopenedKernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await reopenedKernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await 观察媒体窗口(reopenedKernel, ["att-image-cache-1"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const session =
        reopenedKernel.snapshot().media.sessionByAttachmentId["att-image-cache-1"];
      if (session?.locallyComplete) {
        break;
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(
      reopenedKernel.snapshot().media.sessionByAttachmentId["att-image-cache-1"]
    ).toMatchObject({
      status: "locally_complete",
      locallyComplete: true,
    });
  });

  it("缓存完整的视频在刷新后重开查看器时，不会先回落到静态 HLS 请求", async () => {
    const 创建视频消息传输 = () => {
      const transport = new 假传输();
      transport.joinQueue = [
        创建房间快照("r-test", 1, {
          snapshot_messages: [
            {
              type: "message_created",
              room_id: "r-test",
              message_id: "m-video-cache-1",
              client_message_id: "c-video-cache-1",
              sender_session_id: "s-other",
              sender_display_alias: "冷静的水獭",
              text: "",
              attachments: [
                {
                  kind: "video",
                  attachment_id: "att-video-cache-1",
                  width: 1280,
                  height: 720,
                },
              ],
              event_position: 1,
            },
          ],
        }),
      ];
      return transport;
    };
    const storageSource = createFakeStorage();
    const 创建共享平台 = () =>
      创建浏览器应用平台({
        storage: 创建存储运行时({ storage: storageSource }),
      });
    const blob播放结果 = {
      mode: "swarm" as const,
      attachmentId: "att-video-cache-1",
      kind: "video" as const,
      src: "http://media.local/webtorrent/att-video-cache-1.mp4",
      thumbnailUrl: "http://media.local/poster-att-video-cache-1",
      contentHash: "hash-video-cache-1",
      distribution: {
        swarm_id: "swarm-video-cache-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/original-att-video-cache-1.mp4",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    };

    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建视频消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue(blob播放结果),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-video-cache-1"]);
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-cache-1",
      signal: {
        type: "ASSET_COMPLETE",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      kernel.snapshot().media.sessionByAttachmentId["att-video-cache-1"]
    ).toMatchObject({
      status: "locally_complete",
      locallyComplete: true,
    });

    let 恢复播放结果!: (playback: 媒体播放结果) => void;
    const 刷新后等待中的播放结果 = new Promise<媒体播放结果>((resolve) => {
      恢复播放结果 = resolve;
    });
    const fake查看器 = {
      打开: vi.fn(),
      同步: vi.fn(),
      销毁: vi.fn(),
    };
    const 恢复帮助任务 = vi.fn(async () => {});
    const reopenedKernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建视频消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(reopenedKernel).设置媒体查看器供测试(fake查看器);
    读取媒体编排供测试(reopenedKernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockImplementation(() => 刷新后等待中的播放结果),
      激活协作补齐: 恢复帮助任务,
    });

    await reopenedKernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await reopenedKernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await reopenedKernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await 观察媒体窗口(reopenedKernel, ["att-video-cache-1"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const session =
        reopenedKernel.snapshot().media.sessionByAttachmentId["att-video-cache-1"];
      if (session?.locallyComplete) {
        break;
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(
      reopenedKernel.snapshot().media.sessionByAttachmentId["att-video-cache-1"]
    ).toMatchObject({
      locallyComplete: true,
      playback: null,
    });
    expect(恢复帮助任务).toHaveBeenCalledWith({
      attachmentId: "att-video-cache-1",
      consumerId: "backfill:att-video-cache-1",
      kind: "video",
      onSessionEvent: expect.any(Function),
    });

    await reopenedKernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-cache-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-cache-1",
            src: "http://media.local/stream/att-video-cache-1/master.m3u8",
            posterSrc: null,
            width: 1280,
            height: 720,
          },
        ],
      },
    });

    expect(fake查看器.打开).not.toHaveBeenCalled();

    恢复播放结果(blob播放结果);
    await Promise.resolve();
    await Promise.resolve();

    expect(fake查看器.打开).toHaveBeenCalledWith({
      startAttachmentId: "att-video-cache-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-cache-1",
          src: "http://media.local/webtorrent/att-video-cache-1.mp4",
          posterSrc: "http://media.local/poster-att-video-cache-1",
          width: 1280,
          height: 720,
        },
      ],
    });
  });

  it("缓存里没有完整记录时，重开后不会凭空恢复当前房间的帮助任务", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-image-no-cache-1",
            client_message_id: "c-image-no-cache-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-no-cache-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const 激活协作补齐 = vi.fn(async () => {});
    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport,
      storage: 创建浏览器存储(createFakeStorage()),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-no-cache-1",
        kind: "image",
        src: "http://media.local/blob/att-image-no-cache-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-no-cache-1/preview.webp",
        contentHash: "hash-image-no-cache-1",
        distribution: {
          swarm_id: "swarm-image-no-cache-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-no-cache-1/original.png",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        hint: null,
      }),
      激活协作补齐,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    expect(激活协作补齐).not.toHaveBeenCalled();
  });

  it("本地完整视频已先落到旧 manifest 时，打开正式查看器会先触发一次会话重裁决，再决定是否继续等待唯一主链", async () => {
    const 创建视频消息传输 = () => {
      const transport = new 假传输();
      transport.joinQueue = [
        创建房间快照("r-test", 1, {
          snapshot_messages: [
            {
              type: "message_created",
              room_id: "r-test",
              message_id: "m-video-cache-manifest-1",
              client_message_id: "c-video-cache-manifest-1",
              sender_session_id: "s-other",
              sender_display_alias: "冷静的水獭",
              text: "",
              attachments: [
                {
                  kind: "video",
                  attachment_id: "att-video-cache-manifest-1",
                  width: 1280,
                  height: 720,
                },
              ],
              event_position: 1,
            },
          ],
        }),
      ];
      return transport;
    };
    const storageSource = createFakeStorage();
    const 创建共享平台 = () =>
      创建浏览器应用平台({
        storage: 创建存储运行时({ storage: storageSource }),
      });
    const blob播放结果 = {
      mode: "swarm" as const,
      attachmentId: "att-video-cache-manifest-1",
      kind: "video" as const,
      src: "http://media.local/webtorrent/att-video-cache-manifest-1.mp4",
      thumbnailUrl: "http://media.local/poster-att-video-cache-manifest-1",
      contentHash: "hash-video-cache-manifest-1",
      distribution: {
        swarm_id: "swarm-video-cache-manifest-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/original-att-video-cache-manifest-1.mp4",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    };
    const manifest播放结果 = {
      mode: "anchor" as const,
      attachmentId: "att-video-cache-manifest-1",
      kind: "video" as const,
      src: "http://media.local/stream/att-video-cache-manifest-1/master.m3u8",
      thumbnailUrl: "http://media.local/poster-att-video-cache-manifest-1",
      hint: null,
    };

    const kernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建视频消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue(blob播放结果),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-video-cache-manifest-1"]);
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-video-cache-manifest-1",
      signal: {
        type: "ASSET_COMPLETE",
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const fake查看器 = {
      打开: vi.fn(),
      同步: vi.fn(),
      销毁: vi.fn(),
    };
    const reopenedKernel = 创建聊天应用内核({
      ...创建内核依赖(),
      transport: 创建视频消息传输(),
      platform: 创建共享平台(),
      storage: 创建浏览器存储(storageSource),
      查询滚动容器: () => null,
      查询消息节点: () => [],
    });
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValueOnce(manifest播放结果)
      .mockResolvedValueOnce(blob播放结果);
    读取媒体编排供测试(reopenedKernel).设置媒体查看器供测试(fake查看器);
    读取媒体编排供测试(reopenedKernel).设置媒体播放器供测试({
      解析播放结果,
    });

    await reopenedKernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await reopenedKernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await reopenedKernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await 观察媒体窗口(reopenedKernel, ["att-video-cache-manifest-1"]);
    expect(
      reopenedKernel.snapshot().media.sessionByAttachmentId["att-video-cache-manifest-1"]
    ).toMatchObject({
      locallyComplete: true,
      playback: null,
    });

    await reopenedKernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-cache-manifest-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-cache-manifest-1",
            src: "http://media.local/stream/att-video-cache-manifest-1/master.m3u8",
            posterSrc: null,
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).toHaveBeenCalledTimes(2);
    expect(
      reopenedKernel.snapshot().media.playbackByAttachmentId["att-video-cache-manifest-1"]
    ).toMatchObject({
      mode: "swarm",
      src: "http://media.local/webtorrent/att-video-cache-manifest-1.mp4",
    });
    expect(fake查看器.打开).toHaveBeenCalledWith({
      startAttachmentId: "att-video-cache-manifest-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-cache-manifest-1",
          src: "http://media.local/webtorrent/att-video-cache-manifest-1.mp4",
          posterSrc: "http://media.local/poster-att-video-cache-manifest-1",
          width: 1280,
          height: 720,
        },
      ],
    });
  });

  it("媒体会话在 locally_complete 后收到 SEEDING_STARTED 会进入 seeding，而不丢失完整度真相", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-image-seeding-1",
            client_message_id: "c-image-seeding-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-seeding-1",
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
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-seeding-1",
        kind: "image",
        src: "http://media.local/blob/att-image-seeding-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-seeding-1/preview.webp",
        contentHash: "hash-image-seeding-1",
        distribution: {
          swarm_id: "swarm-image-seeding-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-seeding-1/original.png",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        hint: null,
      }),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-image-seeding-1"]);

    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-image-seeding-1",
      signal: {
        type: "ASSET_COMPLETE",
      },
    });
    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-image-seeding-1",
      signal: {
        type: "SEEDING_STARTED",
      },
    });

    expect(
      kernel.snapshot().media.sessionByAttachmentId["att-image-seeding-1"]
    ).toMatchObject({
      status: "seeding",
      locallyComplete: true,
      lastSignal: "SEEDING_STARTED",
    });
  });

  it("图片查看器上报 ASSET_BACKFILLING 后，会让播放器激活协作补齐而不是让壳层自己拼 swarm", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-image-backfill-1",
            client_message_id: "c-image-backfill-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-backfill-1",
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
    let 最近一次激活请求: 图片协作补齐激活请求 | null = null;
    const 激活协作补齐 = vi.fn(
      async (input: 图片协作补齐激活请求) => {
        最近一次激活请求 = input;
      }
    );
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-image-backfill-1",
        kind: "image",
        src: "http://media.local/blob/att-image-backfill-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-backfill-1/preview.webp",
        contentHash: "hash-image-backfill-1",
        distribution: {
          swarm_id: "swarm-image-backfill-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-backfill-1/original.png",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        hint: null,
      }),
      激活协作补齐,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();
    await 观察媒体窗口(kernel, ["att-image-backfill-1"]);

    await kernel.dispatch({
      type: "MEDIA_SESSION_SIGNALLED",
      attachmentId: "att-image-backfill-1",
      signal: {
        type: "ASSET_BACKFILLING",
      },
    });

    expect(激活协作补齐).toHaveBeenCalledWith({
      attachmentId: "att-image-backfill-1",
      consumerId: "backfill:att-image-backfill-1",
      kind: "image",
      onSessionEvent: expect.any(Function),
    });
    expect(最近一次激活请求).not.toBeNull();
    const 激活请求 = 最近一次激活请求 as unknown as 图片协作补齐激活请求;
    激活请求.onSessionEvent?.({
      type: "SWARM_NO_PEERS",
      attachmentId: "att-image-backfill-1",
      swarmId: "swarm-image-backfill-1",
    });

    expect(
      kernel.snapshot().media.sessionByAttachmentId["att-image-backfill-1"]
    ).toMatchObject({
      status: "backfilling",
      lastSignal: "SWARM_NO_PEERS",
    });
  });
});
