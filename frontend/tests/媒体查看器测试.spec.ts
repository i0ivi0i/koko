// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../媒体/媒体查看器";

const 安装方向模拟 = () => {
  const lock = vi.fn(() => Promise.resolve());
  const unlock = vi.fn();
  Object.defineProperty(globalThis.screen, "orientation", {
    configurable: true,
    value: { lock, unlock, type: "portrait-primary" },
  });
  return { lock, unlock };
};

const 安装全屏DOM模拟 = () => {
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        Object.assign(element, { play, pause });
      }
      return element;
    }) as typeof document.createElement
  );
  return { requestFullscreen, exitFullscreen, play, pause };
};

const 读取VideoJs媒体容器 = (): HTMLElement | null => {
  const skin = document.body.querySelector("video-skin");
  return skin?.shadowRoot?.querySelector("media-container") ?? null;
};

const 等待查询元素 = async <T extends Element>(
  selector: string,
  maxAttempts = 30
): Promise<T | null> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const element = document.body.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return document.body.querySelector<T>(selector);
};

describe("媒体查看器适配器", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("会把图片附件映射给 PhotoSwipe 数据源，并从指定图片打开", () => {
    const init = vi.fn();
    const loadAndOpen = vi.fn();
    const destroy = vi.fn();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init,
      loadAndOpen,
      destroy,
    }));
    const createVideoJsPlayerShell = vi.fn(() => ({ destroy: vi.fn(), 同步: vi.fn() }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell,
    });

    viewer.打开({
      startAttachmentId: "att-image-2",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "http://media.local/original-image-1",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "blob:http://media.local/video-1",
          posterSrc: "http://media.local/poster-video-1",
          width: 1280,
          height: 720,
        },
        {
          kind: "image",
          attachmentId: "att-image-2",
          src: "http://media.local/original-image-2",
          alt: "第二张图片附件原图",
          width: 900,
          height: 1200,
        },
      ],
    });

    expect(createPhotoSwipeLightbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: [
          {
            src: "http://media.local/original-image-1",
            alt: "图片附件原图",
            width: 1200,
            height: 800,
          },
          {
            src: "http://media.local/original-image-2",
            alt: "第二张图片附件原图",
            width: 900,
            height: 1200,
          },
        ],
      })
    );
    expect(init).toHaveBeenCalled();
    expect(loadAndOpen).toHaveBeenCalledWith(1);
    expect(createVideoJsPlayerShell).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("图片查看器打开完整图片时会先进入 backfilling，加载完成后再标记 complete", () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const 事件监听器 = new Map<string, (payload?: unknown) => void>();
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(() => true),
      destroy: vi.fn(),
      on: vi.fn((eventName: string, callback: (payload?: unknown) => void) => {
        事件监听器.set(eventName, callback);
      }),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell: vi.fn(() => ({ destroy: vi.fn(), 同步: vi.fn() })),
      onMediaSessionSignal: (attachmentId, signal) => {
        信号记录.push({ attachmentId, signal });
      },
    });

    viewer.打开({
      startAttachmentId: "att-image-complete-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-complete-1",
          src: "http://media.local/blob/att-image-complete-1/full.webp",
          contentHash: "hash-image-complete-1",
          distribution: {
            swarm_id: "swarm-image-complete-1",
            announce_urls: ["wss://tracker.koko.local/announce"],
            web_seed_url: "http://media.local/blob/att-image-complete-1/original.png",
            join_ticket: null,
          },
          alt: "图片附件原图",
          width: 1600,
          height: 900,
        },
      ],
    });

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_BACKFILLING" },
      },
    ]);

    事件监听器.get("loadComplete")?.({
      slide: { index: 0 },
      content: {},
    });

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_BACKFILLING" },
      },
      {
        attachmentId: "att-image-complete-1",
        signal: { type: "ASSET_COMPLETE" },
      },
    ]);
  });

  it("图片查看器创建失败时会释放聊天视口占用，不让滚动 owner 卡死", async () => {
    const error = new Error("photoswipe 创建失败");
    const onViewportCaptureStart = vi.fn();
    const onViewportCaptureEnd = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox: () => {
        throw error;
      },
      createVideoJsPlayerShell: vi.fn(() => ({ destroy: vi.fn(), 同步: vi.fn() })),
      onViewportCaptureStart,
      onViewportCaptureEnd,
    });

    expect(() =>
      viewer.打开({
        startAttachmentId: "att-image-error-1",
        items: [
          {
            kind: "image",
            attachmentId: "att-image-error-1",
            src: "http://media.local/error-image-1",
            alt: "失败图片附件",
            width: 1200,
            height: 800,
          },
        ],
      })
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(onViewportCaptureStart).toHaveBeenCalledTimes(1);
    expect(onViewportCaptureEnd).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("打开媒体查看器失败", error);
  });

  it("公开主链只剩单一 Video.js 壳，视频打开不会再分叉成第二套正式实现", async () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVideoJsPlayerShell = vi.fn(() => ({
      destroy: vi.fn(),
      同步: vi.fn(),
    }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVideoJsPlayerShell,
      isMobileViewport: () => false,
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

  it("桌面端视频会进入同一个 Video.js 壳，而不是再分成多条正式实现", async () => {
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
    });

    viewer.打开({
      startAttachmentId: "att-video-desktop-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-desktop-1",
          src: "blob:http://media.local/video-desktop-1",
          posterSrc: "http://media.local/poster-desktop-1",
          width: 1280,
          height: 720,
        },
      ],
    });
    const provider = await 等待查询元素<HTMLElement>("video-player[data-player-shell='videojs']");
    const video = document.body.querySelector("video");
    const mount = document.body.querySelector<HTMLElement>("[data-media-viewer-mount='video']");

    expect(provider).not.toBeNull();
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(mount).not.toBeNull();
    expect(mount?.style.width).toBe("100%");
    expect(mount?.style.maxWidth).toBe("1120px");
    expect(provider?.style.width).toBe("100%");
    expect(读取VideoJs媒体容器()?.style.width).toBe("100%");
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("正式视频查看器里的唯一 video 默认循环播放", async () => {
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
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
    const createVideoJsPlayerShell = vi.fn(() => ({
      destroy: vi.fn(),
      同步: vi.fn(),
    }));
    const viewer = 创建媒体查看器({
      createVideoJsPlayerShell,
      isMobileViewport: () => false,
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
        attachmentId: "att-video-manifest-1",
        src: "http://media.local/stream/att-video-manifest-1/master.m3u8",
      }),
      expect.objectContaining({
        开始视口占用: expect.any(Function),
        结束视口占用: expect.any(Function),
      }),
      expect.objectContaining({
        发出媒体会话信号: expect.any(Function),
      })
    );
  });

  it("默认视频查看器会把 HLS P2P 增强挂接函数交给 Video.js 壳，而不是让 provider 裸跑", async () => {
    vi.resetModules();
    const 创建VideoJs播放器壳 = vi.fn(async () => ({
      destroy: vi.fn(),
      同步: vi.fn(),
      读取视频元素: () => document.createElement("video"),
      读取容器元素: () => document.createElement("div"),
      进入全屏: vi.fn(),
    }));
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
    }));

    try {
      const { 创建媒体查看器: 创建默认媒体查看器 } = await import("../媒体/媒体查看器");
      const viewer = 创建默认媒体查看器({
        isMobileViewport: () => false,
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
        expect.objectContaining({
          挂接P2PHls增强层: expect.any(Function),
        })
      );

      viewer.销毁();
    } finally {
      vi.doUnmock("../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });

  it("视频壳会把 waiting 信号回抛给媒体会话，并允许后续同步新的播放源", async () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
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
    expect(video).not.toBeNull();

    video?.dispatchEvent(new Event("waiting"));
    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-sync-1",
        signal: { type: "PLAYER_WAITING" },
      },
    ]);

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

    expect(video?.src).toBe("blob:http://media.local/video-sync-new");
    expect(video?.poster).toBe("http://media.local/poster-sync-new");
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("移动端全屏策略仍复用同一个播放器会话，不会额外创建第二颗 video", async () => {
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-visible-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-visible-1",
          src: "blob:http://media.local/mobile-visible-video-1",
          posterSrc: "http://media.local/poster-mobile-visible-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    const video = document.body.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
  });

  it("竖屏视频进入移动端全屏时锁定 portrait，并在元数据更可信时纠正方向", async () => {
    安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-portrait-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-portrait-1",
          src: "blob:http://media.local/portrait-video-1",
          posterSrc: null,
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    const container = 读取VideoJs媒体容器();
    expect(container).not.toBeNull();
    expect(container?.dataset.videoOrientation).toBe("portrait");
    expect(lock).toHaveBeenCalledWith("portrait");

    const video = document.body.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1080 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1920 });
    video?.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();

    expect(lock).toHaveBeenLastCalledWith("portrait");
  });

  it("手机返回键触发 popstate 时只退出同一播放器会话，并清理方向锁回到聊天界面", async () => {
    const pushState = vi.spyOn(history, "pushState");
    const { exitFullscreen, pause } = 安装全屏DOM模拟();
    const { unlock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-back-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-back-1",
          src: "blob:http://media.local/back-video-1",
          posterSrc: null,
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");
    await Promise.resolve();
    expect(document.body.querySelector("video")).not.toBeNull();

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await Promise.resolve();

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ __kokoMediaFullscreenSession: expect.any(String) }),
      "",
      expect.any(String)
    );
    expect(exitFullscreen).toHaveBeenCalled();
    expect(unlock).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    expect(document.body.querySelector("video")).toBeNull();
  });
});
