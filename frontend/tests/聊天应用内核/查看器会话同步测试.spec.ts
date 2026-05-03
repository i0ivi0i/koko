import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../应用根/聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试 } from "../common/聊天应用内核支架";

describe("聊天应用内核 - 查看器会话同步", () => {
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
          mode: "anchor",
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
          src: "",
          posterSrc: "http://media.local/poster-att-video-hls",
          width: 1280,
          height: 720,
        },
      ],
    });
  });

  it("视频会话还没把唯一正式源投给查看器时，打开查看器会先清空旧 originalSrc 等待后续同步", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-open-manifest",
            client_message_id: "c-video-open-manifest",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-open-manifest",
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
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-open-manifest",
        kind: "video",
        src: "http://media.local/stream/att-video-open-manifest/master.m3u8",
        thumbnailUrl: "http://media.local/poster-att-video-open-manifest",
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
        startAttachmentId: "att-video-open-manifest",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-open-manifest",
            src: "http://media.local/original-att-video-open-manifest",
            posterSrc: null,
            width: 1280,
            height: 720,
          },
        ],
      },
    });

    expect(fake查看器.打开).toHaveBeenCalledWith({
      startAttachmentId: "att-video-open-manifest",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-open-manifest",
          src: "",
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });
  });
});
