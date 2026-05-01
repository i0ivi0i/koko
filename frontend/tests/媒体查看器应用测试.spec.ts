import { describe, expect, it, vi } from "vitest";

import { 创建媒体查看器应用 } from "../媒体/查看器/应用.js";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器.js";

const 构造查看器请求 = (
  attachmentId = "att-video-1"
): 媒体查看器打开请求 => ({
  startAttachmentId: attachmentId,
  items: [
    {
      kind: "video",
      attachmentId,
      src: `swarm://${attachmentId}`,
      posterSrc: `${attachmentId}.webp`,
      width: 1280,
      height: 720,
    },
  ],
});

describe("媒体查看器应用", () => {
  it("冷启动视频查看器时，会先补起始附件会话，再把查看器请求投影到当前播放真相", () => {
    const session = {
      snapshot: vi.fn(() => ({ playback: null })),
      启动: vi.fn(),
      send: vi.fn(),
    };
    const 投影后请求 = 构造查看器请求("att-video-1");
    const 投影查看器请求到当前播放真相 = vi.fn(() => 投影后请求);
    const 触发视频预览收敛 = vi.fn();
    const 接收媒体运行时事实 = vi.fn();
    const app = 创建媒体查看器应用({
      读取附件条目: (attachmentId) =>
        attachmentId === "att-video-1" ? { attachmentId, kind: "video" } : null,
      读取或创建媒体会话: () => session,
      读取媒体运行时上下文: () => ({
        inlineAutoplayOwnerAttachmentId: null,
        inlineAutoplayPlayback: null,
      }),
      投影查看器请求到当前播放真相,
      触发视频预览收敛,
      接收媒体运行时事实,
    });

    const request = 构造查看器请求("att-video-1");
    app.打开查看器(request);

    expect(session.启动).toHaveBeenCalledTimes(1);
    expect(session.send).not.toHaveBeenCalled();
    expect(投影查看器请求到当前播放真相).toHaveBeenCalledWith({
      startAttachmentId: "att-video-1",
      items: [
        expect.objectContaining({
          attachmentId: "att-video-1",
          kind: "video",
          src: "swarm://att-video-1",
        }),
      ],
    });
    expect(触发视频预览收敛).toHaveBeenCalledWith("att-video-1");
    expect(接收媒体运行时事实).toHaveBeenCalledWith({
      type: "VIEWER_OPEN_REQUESTED",
      request: 投影后请求,
    });
  });

  it("命中热自动播主链时，不会先把同一视频打回 recovering", () => {
    const session = {
      snapshot: vi.fn(() => ({
        playback: {
          attachmentId: "att-video-1",
          mode: "swarm" as const,
          src: "swarm://att-video-1",
        },
      })),
      启动: vi.fn(),
      send: vi.fn(),
    };
    const 接收媒体运行时事实 = vi.fn();
    const app = 创建媒体查看器应用({
      读取附件条目: (attachmentId) =>
        attachmentId === "att-video-1" ? { attachmentId, kind: "video" } : null,
      读取或创建媒体会话: () => session,
      读取媒体运行时上下文: () => ({
        inlineAutoplayOwnerAttachmentId: "att-video-1",
        inlineAutoplayPlayback: {
          attachmentId: "att-video-1",
          mode: "swarm" as const,
          src: "swarm://att-video-1",
        },
      }),
      投影查看器请求到当前播放真相: (request) => request,
      触发视频预览收敛: vi.fn(),
      接收媒体运行时事实,
    });

    app.打开查看器(构造查看器请求("att-video-1"));

    expect(session.send).not.toHaveBeenCalled();
    expect(session.启动).not.toHaveBeenCalled();
    expect(接收媒体运行时事实).toHaveBeenCalledWith({
      type: "VIEWER_OPEN_REQUESTED",
      request: expect.objectContaining({ startAttachmentId: "att-video-1" }),
    });
  });

  it("自动播热链和正式播放真相冲突时，会回到显式 viewer recovering 裁决", () => {
    const session = {
      snapshot: vi.fn(() => ({
        playback: {
          attachmentId: "att-video-1",
          mode: "swarm" as const,
          src: "swarm://stable-source",
        },
      })),
      启动: vi.fn(),
      send: vi.fn(),
    };
    const app = 创建媒体查看器应用({
      读取附件条目: (attachmentId) =>
        attachmentId === "att-video-1" ? { attachmentId, kind: "video" } : null,
      读取或创建媒体会话: () => session,
      读取媒体运行时上下文: () => ({
        inlineAutoplayOwnerAttachmentId: "att-video-1",
        inlineAutoplayPlayback: {
          attachmentId: "att-video-1",
          mode: "swarm" as const,
          src: "swarm://other-source",
        },
      }),
      投影查看器请求到当前播放真相: (request) => request,
      触发视频预览收敛: vi.fn(),
      接收媒体运行时事实: vi.fn(),
    });

    app.打开查看器(构造查看器请求("att-video-1"));

    expect(session.send).toHaveBeenCalledWith({ type: "ENTER_RECOVERING" });
    expect(session.启动).not.toHaveBeenCalled();
  });

  it("图片查看器请求不会误触视频预览收敛或视频会话重裁，但仍保留既有图片会话启动行为", () => {
    const session = {
      snapshot: vi.fn(() => ({ playback: null })),
      启动: vi.fn(),
      send: vi.fn(),
    };
    const 触发视频预览收敛 = vi.fn();
    const 接收媒体运行时事实 = vi.fn();
    const app = 创建媒体查看器应用({
      读取附件条目: (attachmentId) =>
        attachmentId === "att-image-1" ? { attachmentId, kind: "image" } : null,
      读取或创建媒体会话: () => session,
      读取媒体运行时上下文: () => ({
        inlineAutoplayOwnerAttachmentId: null,
        inlineAutoplayPlayback: null,
      }),
      投影查看器请求到当前播放真相: (request) => request,
      触发视频预览收敛,
      接收媒体运行时事实,
    });

    app.打开查看器({
      startAttachmentId: "att-image-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "blob:image",
          alt: "image",
          width: 800,
          height: 600,
        },
      ],
    });

    expect(session.启动).toHaveBeenCalledTimes(1);
    expect(session.send).not.toHaveBeenCalled();
    expect(触发视频预览收敛).not.toHaveBeenCalled();
    expect(接收媒体运行时事实).toHaveBeenCalledWith({
      type: "VIEWER_OPEN_REQUESTED",
      request: expect.objectContaining({ startAttachmentId: "att-image-1" }),
    });
  });
});
