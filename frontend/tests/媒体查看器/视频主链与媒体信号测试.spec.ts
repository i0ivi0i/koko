// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { 媒体查看器依赖 } from "../../媒体/媒体查看器";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  创建测试VideoJs进入全屏,
  创建测试VideoJs播放器壳,
  等待查询元素,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - Video.js 主链与媒体信号", () => {
  afterEach(清理媒体查看器测试环境);

  it("公开主链只剩单一 Video.js 壳，视频打开不会再分叉成第二套正式实现", async () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVideoJsPlayerShell = vi.fn(() => 创建测试VideoJs播放器壳());
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell,
    });

    viewer.打开({
      startAttachmentId: "att-video-single-shell-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-single-shell-1",
          src: "http://media.local/stream/att-video-single-shell-1/master.m3u8",
          posterSrc: "http://media.local/poster-single-shell-1",
          width: 1280,
          height: 720,
        },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(createVideoJsPlayerShell).toHaveBeenCalledTimes(1);
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
  });

  it("视频查看器冷开时会用时间线传入的同源保存位置续播", async () => {
    const video = document.createElement("video");
    Object.assign(video, {
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
    });
    const viewer = 创建媒体查看器({
      createVideoJsPlayerShell: vi.fn((source, deps = {}) =>
        创建测试VideoJs播放器壳({
          初始源: source,
          mountTarget: deps.mountTarget ?? undefined,
          video,
        })
      ),
    });

    viewer.打开({
      startAttachmentId: "att-video-viewer-resume-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-viewer-resume-1",
          src: "/webtorrent/viewer-resume/content.mp4",
          posterSrc: "http://media.local/poster-viewer-resume-1",
          width: 1280,
          height: 720,
          resumePosition: {
            src: new URL("/webtorrent/viewer-resume/content.mp4", window.location.href).href,
            currentTime: 42.5,
            updatedAt: 1,
          },
        },
      ],
    });
    await 等待查看器任务完成(6);

    expect(video.currentTime).toBeCloseTo(42.5, 2);
  });

  it("正式视频查看器里的唯一 video 默认循环播放", async () => {
    const viewer = 创建媒体查看器({
    });

    viewer.打开({
      startAttachmentId: "att-video-loop-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-loop-1",
          src: "blob:http://media.local/video-loop-1",
          posterSrc: "http://media.local/poster-loop-1",
          width: 1280,
          height: 720,
        },
      ],
    });

    const video = await 等待查询元素<HTMLVideoElement>("video");
    expect(video?.loop).toBe(true);
  });

  it("manifest 视频也会进入同一个 Video.js 壳，不再单独拉起 HLS overlay", async () => {
    const createVideoJsPlayerShell = vi.fn<NonNullable<媒体查看器依赖["createVideoJsPlayerShell"]>>(
      (_source, _deps) => 创建测试VideoJs播放器壳()
    );
    const viewer = 创建媒体查看器({
      createVideoJsPlayerShell,
    });

    viewer.打开({
      startAttachmentId: "att-video-manifest-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-manifest-1",
          src: "http://media.local/stream/att-video-manifest-1/master.m3u8",
          posterSrc: "http://media.local/poster-manifest-1",
          width: 1280,
          height: 720,
        },
      ],
    });

    expect(createVideoJsPlayerShell).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "file",
        src: "http://media.local/stream/att-video-manifest-1/master.m3u8",
      }),
      expect.objectContaining({
        mountTarget: expect.any(HTMLElement),
      })
    );
    expect(createVideoJsPlayerShell.mock.calls[0]?.[1]).toEqual(
      expect.not.objectContaining({
        挂接P2PHls增强层: expect.anything(),
      })
    );
  });

  it("默认视频查看器不再给 Video.js 壳注入 HLS/P2P HLS 增强入口", async () => {
    vi.resetModules();
    const 创建VideoJs播放器壳 = vi.fn(async (_source?: unknown, _deps?: Record<string, unknown>) => {
      const video = document.createElement("video");
      const container = document.createElement("div");
      return 创建测试VideoJs播放器壳({
        video,
        container,
        进入全屏: 创建测试VideoJs进入全屏(container),
      });
    });
    vi.doMock("../../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器: 创建默认媒体查看器 } = await import("../../媒体/媒体查看器");
      const viewer = 创建默认媒体查看器({
      });

      viewer.打开({
        startAttachmentId: "att-video-default-p2p-hls-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-default-p2p-hls-1",
            src: "http://media.local/stream/att-video-default-p2p-hls-1/master.m3u8",
            posterSrc: "http://media.local/poster-default-p2p-hls-1",
            width: 1280,
            height: 720,
          },
        ],
      });
      await Promise.resolve();

      expect(创建VideoJs播放器壳).toHaveBeenCalledTimes(1);
      expect(创建VideoJs播放器壳.mock.calls[0]?.[1]).toEqual(
        expect.not.objectContaining({
          挂接P2PHls增强层: expect.anything(),
        })
      );

      viewer.销毁();
    } finally {
      vi.doUnmock("../../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });

  it("媒体查看器源码不再动态 import p2p-media-loader-hlsjs，也不再把 .m3u8 特判成 HLS", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../媒体/媒体查看器.ts"), "utf8");

    expect(source).not.toContain("p2p-media-loader-hlsjs");
    expect(source).not.toContain('kind: "hls"');
    expect(source).not.toContain("HlsJsP2PEngine");
    expect(source).not.toContain("/\\.m3u8(?:$|\\?)/");
  });

  it("视频壳会把 waiting 信号回抛给媒体会话，并允许后续同步新的播放源", async () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const viewer = 创建媒体查看器({
      onMediaSessionSignal: (attachmentId, signal) => {
        信号记录.push({ attachmentId, signal });
      },
    });

    viewer.打开({
      startAttachmentId: "att-video-sync-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-sync-1",
          src: "blob:http://media.local/video-sync-old",
          posterSrc: "http://media.local/poster-sync-old",
          width: 720,
          height: 1280,
        },
      ],
    });
    const video = await 等待查询元素<HTMLVideoElement>("video");
    await 等待查看器任务完成();
    expect(video).not.toBeNull();

    video?.dispatchEvent(new Event("waiting"));
    expect(信号记录.at(-1)).toEqual({
      attachmentId: "att-video-sync-1",
      signal: { type: "PLAYER_WAITING" },
    });

    viewer.同步({
      startAttachmentId: "att-video-sync-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-sync-1",
          src: "blob:http://media.local/video-sync-new",
          posterSrc: "http://media.local/poster-sync-new",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查看器任务完成();

    expect(video?.src).toBe("blob:http://media.local/video-sync-new");
    expect(video?.poster).toBe("http://media.local/poster-sync-new");
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("查看器切到另一条视频时会复用同一颗 Video.js 壳，并把媒体信号归属切到新附件", async () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const viewer = 创建媒体查看器({
      onMediaSessionSignal: (attachmentId, signal) => {
        信号记录.push({ attachmentId, signal });
      },
    });

    viewer.打开({
      startAttachmentId: "att-video-switch-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-switch-1",
          src: "http://media.local/stream/att-video-switch-1/master.m3u8",
          posterSrc: "http://media.local/poster-switch-1",
          width: 1280,
          height: 720,
        },
        {
          kind: "video",
          attachmentId: "att-video-switch-2",
          src: "blob:http://media.local/video-switch-2",
          posterSrc: "http://media.local/poster-switch-2",
          width: 1920,
          height: 1080,
        },
      ],
    });
    const 初始壳 = await 等待查询元素<HTMLElement>("video-player[data-player-shell='videojs']");
    const 初始视频 = await 等待查询元素<HTMLVideoElement>("video");

    expect(初始壳).not.toBeNull();
    expect(初始视频).not.toBeNull();

    viewer.同步({
      startAttachmentId: "att-video-switch-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-switch-1",
          src: "http://media.local/stream/att-video-switch-1/master.m3u8",
          posterSrc: "http://media.local/poster-switch-1",
          width: 1280,
          height: 720,
        },
        {
          kind: "video",
          attachmentId: "att-video-switch-2",
          src: "blob:http://media.local/video-switch-2",
          posterSrc: "http://media.local/poster-switch-2",
          width: 1920,
          height: 1080,
        },
      ],
    });
    await Promise.resolve();

    const 当前壳 = document.body.querySelector<HTMLElement>("video-player[data-player-shell='videojs']");
    const 当前视频 = document.body.querySelector<HTMLVideoElement>("video");

    expect(当前壳).toBe(初始壳);
    expect(当前视频).toBe(初始视频);
    expect(当前视频?.src).toBe("blob:http://media.local/video-switch-2");
    expect(当前视频?.poster).toBe("http://media.local/poster-switch-2");
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    当前视频?.dispatchEvent(new Event("waiting"));
    expect(信号记录.at(-1)).toEqual({
      attachmentId: "att-video-switch-2",
      signal: { type: "PLAYER_WAITING" },
    });
  });
});
