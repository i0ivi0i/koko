import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { createFakeStorage, 假传输, 创建房间快照 } from "../common/聊天测试支架";
import { 创建聊天应用内核 } from "../../应用根/聊天应用内核";
import { 创建内核依赖, 读取媒体编排供测试 } from "../common/聊天应用内核支架";
import type { 媒体播放结果 } from "../../媒体/媒体播放";

describe("聊天应用内核 - 媒体 owner 链与查看器关闭", () => {
  it("正式查看器、inline autoplay、协作分发预算变化都必须来自同一条媒体 owner 链，而不是聊天媒体编排自己补状态", () => {
    const source = readFileSync(resolve(process.cwd(), "媒体/播放会话/应用.ts"), "utf8");

    expect(source).not.toContain("inlineAutoplayPlaybackByAttachmentId =");
    expect(source).not.toContain("发送资产协作分发事件(");
    expect(source).not.toContain("投影资产协作分发预算(");
  });

  it("background/hidden 不会误清正式查看器会话真相", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-viewer-1",
            client_message_id: "c-video-viewer-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-viewer-1",
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
    读取媒体编排供测试(kernel).设置媒体查看器供测试({
      打开: 打开查看器,
      销毁: vi.fn(),
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-viewer-1",
        kind: "video",
        src: "http://media.local/original-att-video-viewer-1",
        thumbnailUrl: "http://media.local/poster-att-video-viewer-1",
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
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-viewer-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-viewer-1",
            src: "http://media.local/original-att-video-viewer-1",
            posterSrc: "http://media.local/poster-att-video-viewer-1",
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(打开查看器).toHaveBeenCalledTimes(1);

    await kernel.dispatch({
      type: "PLATFORM_LIFECYCLE_CHANGED",
      snapshot: { visibility: "hidden", phase: "background" },
    });

    expect(释放附件播放资源).not.toHaveBeenCalledWith({
      attachmentId: "att-video-viewer-1",
      consumerId: "session:att-video-viewer-1",
    });
  });

  it("正式查看器已打开时切到另一条视频，会走同步而不是重新打开第二个查看器会话", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-1",
            client_message_id: "c-video-switch-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-switch-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-2",
            client_message_id: "c-video-switch-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-switch-2",
                width: 1920,
                height: 1080,
              },
            ],
            event_position: 2,
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
      解析播放结果: vi.fn(async ({ attachmentId, kind }) => ({
        mode: "anchor",
        attachmentId,
        kind,
        src: `http://media.local/original-${attachmentId}`,
        thumbnailUrl: `http://media.local/poster-${attachmentId}`,
        hint: null,
      }) satisfies 媒体播放结果),
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-switch-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-switch-1",
            src: "http://media.local/original-att-video-switch-1",
            posterSrc: "http://media.local/poster-att-video-switch-1",
            width: 1280,
            height: 720,
          },
          {
            kind: "video",
            attachmentId: "att-video-switch-2",
            src: "http://media.local/original-att-video-switch-2",
            posterSrc: "http://media.local/poster-att-video-switch-2",
            width: 1920,
            height: 1080,
          },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake查看器.打开).toHaveBeenCalledTimes(1);
    const 首次打开后的同步次数 = fake查看器.同步.mock.calls.length;

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-switch-2",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-switch-1",
            src: "http://media.local/original-att-video-switch-1",
            posterSrc: "http://media.local/poster-att-video-switch-1",
            width: 1280,
            height: 720,
          },
          {
            kind: "video",
            attachmentId: "att-video-switch-2",
            src: "http://media.local/original-att-video-switch-2",
            posterSrc: "http://media.local/poster-att-video-switch-2",
            width: 1920,
            height: 1080,
          },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake查看器.打开).toHaveBeenCalledTimes(1);
    expect(fake查看器.同步.mock.calls.length).toBeGreaterThan(首次打开后的同步次数);
    expect(fake查看器.同步).toHaveBeenLastCalledWith({
      startAttachmentId: "att-video-switch-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-switch-1",
          src: "",
          posterSrc: "http://media.local/poster-att-video-switch-1",
          width: 1280,
          height: 720,
        },
        {
          kind: "video",
          attachmentId: "att-video-switch-2",
          src: "",
          posterSrc: "http://media.local/poster-att-video-switch-2",
          width: 1920,
          height: 1080,
        },
      ],
    });
  });

  it("正式查看器关闭时会释放播放 consumer，并把时间线会话降回无 playback 状态", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-viewer-close-1",
            client_message_id: "c-video-viewer-close-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-viewer-close-1",
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
    const 激活协作补齐 = vi.fn(async () => {});
    读取媒体编排供测试(kernel).设置媒体查看器供测试({
      打开: vi.fn(),
      销毁: vi.fn(),
    });
    读取媒体编排供测试(kernel).设置媒体播放器供测试({
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "anchor",
        attachmentId: "att-video-viewer-close-1",
        kind: "video",
        src: "http://media.local/stream/att-video-viewer-close-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-att-video-viewer-close-1",
        hint: null,
      }),
      激活协作补齐,
      释放附件播放资源,
    });

    await kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
    await kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: "ROOM01" });
    await kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
    await Promise.resolve();
    await Promise.resolve();

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-viewer-close-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-viewer-close-1",
            src: "http://media.local/stream/att-video-viewer-close-1/master.m3u8",
            posterSrc: "http://media.local/poster-att-video-viewer-close-1",
            width: 1280,
            height: 720,
          },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    读取媒体编排供测试(kernel).处理媒体会话信号("att-video-viewer-close-1", {
      type: "PLAYER_PLAYING",
    });
    expect(激活协作补齐).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-viewer-close-1",
        consumerId: "backfill:att-video-viewer-close-1",
      })
    );

    读取媒体编排供测试(kernel).关闭媒体查看器供测试();

    expect(释放附件播放资源).toHaveBeenCalledWith({
      attachmentId: "att-video-viewer-close-1",
      consumerId: "session:att-video-viewer-close-1",
    });
    expect(
      kernel.snapshot().media.sessionByAttachmentId["att-video-viewer-close-1"]
    ).toMatchObject({
      attachmentId: "att-video-viewer-close-1",
      playback: null,
    });
    expect(
      kernel.snapshot().media.playbackByAttachmentId["att-video-viewer-close-1"]
    ).toBeUndefined();
  });
});
