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
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      Object.assign(element, { requestFullscreen });
      if (tagName.toLowerCase() === "video") {
        Object.assign(element, { play, pause });
      }
      return element;
    }) as typeof document.createElement
  );
  return { requestFullscreen, exitFullscreen, play, pause };
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
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
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
          src: "blob:http://media.local/webtorrent-video-1",
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
    expect(destroy).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
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
      createVidstackVideoOverlay: vi.fn(() => ({ destroy: vi.fn() })),
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
      createVidstackVideoOverlay: vi.fn(() => ({ destroy: vi.fn() })),
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

  it("移动触屏端点击视频会优先进入原生全屏播放，不再打开桌面查看器", () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const openNativeVideoFullscreen = vi.fn(() => true);
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
      isMobileViewport: () => true,
      openNativeVideoFullscreen,
    });

    viewer.打开({
      startAttachmentId: "att-video-vertical-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-vertical-1",
          src: "blob:http://media.local/webtorrent-vertical-video-1",
          posterSrc: null,
          width: 720,
          height: 1280,
        },
      ],
    });

    expect(openNativeVideoFullscreen).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-vertical-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-vertical-video-1",
        width: 720,
        height: 1280,
      }),
      expect.objectContaining({
        开始视口占用: expect.any(Function),
        结束视口占用: expect.any(Function),
      }),
      expect.objectContaining({
        发出媒体会话信号: expect.any(Function),
      })
    );
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
  });

  it("默认原生全屏路径创建可见的全屏视频元素，不能把真正播放层藏成 1px", () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
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

    const video = document.body.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(video?.style.width).toBe("100vw");
    expect(video?.style.height).toBe("100vh");
    expect(video?.style.opacity).not.toBe("0");
    expect(video?.style.objectFit).toBe("contain");
    expect(requestFullscreen).toHaveBeenCalled();
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
  });

  it("竖屏视频进入移动端全屏时锁定 portrait，不再沿用浏览器默认横屏策略", async () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const { requestFullscreen } = 安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
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
    await Promise.resolve();

    expect(requestFullscreen).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith("portrait");
    expect(document.body.querySelector("[data-video-orientation='portrait']")).not.toBeNull();
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
  });

  it("移动端视频会用浏览器元数据纠正后端旧横屏宽高，避免竖拍视频继续锁横屏", async () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-legacy-rotated-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-legacy-rotated-1",
          src: "blob:http://media.local/legacy-rotated-video-1",
          posterSrc: null,
          width: 1920,
          height: 1080,
        },
      ],
    });
    await Promise.resolve();

    const video = document.body.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1080 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1920 });
    video?.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();

    expect(lock).toHaveBeenLastCalledWith("portrait");
    expect(document.body.querySelector("[data-video-orientation='portrait']")).not.toBeNull();
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
  });

  it("手机返回键触发 popstate 时只退出媒体全屏会话，并清理方向锁回到聊天界面", async () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const pushState = vi.spyOn(history, "pushState");
    const { exitFullscreen, pause } = 安装全屏DOM模拟();
    const { unlock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
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
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).not.toHaveBeenCalled();
  });

  it("桌面端视频交给 Vidstack 播放层，并保留真实宽高给播放器布局", () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const vidstackDestroy = vi.fn();
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vidstackDestroy }));
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
      isMobileViewport: () => false,
    });

    viewer.打开({
      startAttachmentId: "att-video-vertical-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-vertical-1",
          src: "blob:http://media.local/webtorrent-vertical-video-1",
          posterSrc: null,
          width: 720,
          height: 1280,
        },
      ],
    });

    expect(createVidstackVideoOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-vertical-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-vertical-video-1",
        width: 720,
        height: 1280,
      }),
      expect.objectContaining({
        开始视口占用: expect.any(Function),
        结束视口占用: expect.any(Function),
      }),
      expect.objectContaining({
        发出媒体会话信号: expect.any(Function),
      })
    );
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
    expect(vidstackDestroy).not.toHaveBeenCalled();
  });

  it("桌面 HLS 视频会给 Vidstack HLS provider 注入本地 hls.js loader 和分片级 P2P 配置", async () => {
    vi.resetModules();
    const 注入P2P混入 = vi.fn((Hls: unknown) => Hls);
    vi.doMock("p2p-media-loader-hlsjs", () => ({
      HlsJsP2PEngine: {
        injectMixin: 注入P2P混入,
      },
    }));

    try {
      const { 创建媒体查看器: 创建隔离媒体查看器 } = await import("../媒体/媒体查看器");
      const viewer = 创建隔离媒体查看器({
        isMobileViewport: () => false,
      });

      viewer.打开({
        startAttachmentId: "att-video-hls-provider-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-hls-provider-1",
            src: "http://media.local/stream/att-video-hls-provider-1/master.m3u8",
            posterSrc: "http://media.local/poster-hls-provider-1",
            streamingDistribution: {
              swarm_id: "swarm-hash-att-video-hls-provider-1",
              announce_urls: [
                "wss://tracker.koko.local/announce",
                "wss://tracker.backup.koko.local/announce",
              ],
              web_seed_url: "http://media.local/stream/att-video-hls-provider-1/master.m3u8",
              join_ticket: null,
            },
            width: 720,
            height: 1280,
          },
        ],
      });
      const player = await 等待查询元素<HTMLElement>(
        "media-player[data-media-viewer-player='video']"
      );
      expect(player).not.toBeNull();

      const provider: {
        type: string;
        library?: unknown;
        config?: Record<string, unknown>;
      } = { type: "hls" };
      player?.dispatchEvent(new CustomEvent("provider-change", { detail: provider }));

      expect(typeof provider.library).toBe("function");
      const hlsConstructor = await (provider.library as () => Promise<unknown>)();
      expect(hlsConstructor).toBeTruthy();
      expect(注入P2P混入).toHaveBeenCalledTimes(1);
      expect(provider.config).toMatchObject({
        p2p: {
          core: {
            swarmId: "swarm-hash-att-video-hls-provider-1",
            announceTrackers: [
              "wss://tracker.koko.local/announce",
              "wss://tracker.backup.koko.local/announce",
            ],
          },
        },
      });
    } finally {
      vi.doUnmock("p2p-media-loader-hlsjs");
      vi.resetModules();
      document.body.replaceChildren();
    }
  });

  it("P2P mixin 加载失败时也必须回退到纯 hls.js 主链，而不是让查看器直接黑屏转圈", async () => {
    vi.resetModules();
    vi.doMock("p2p-media-loader-hlsjs", () => {
      throw new Error("模拟 P2P loader 在真实浏览器里加载失败");
    });

    try {
      const { 创建媒体查看器: 创建隔离媒体查看器 } = await import("../媒体/媒体查看器");
      const viewer = 创建隔离媒体查看器({
        isMobileViewport: () => false,
      });

      viewer.打开({
        startAttachmentId: "att-video-hls-provider-fallback-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-hls-provider-fallback-1",
            src: "http://media.local/stream/att-video-hls-provider-fallback-1/master.m3u8",
            posterSrc: "http://media.local/poster-hls-provider-fallback-1",
            streamingDistribution: {
              swarm_id: "swarm-hash-att-video-hls-provider-fallback-1",
              announce_urls: ["wss://tracker.koko.local/announce"],
              web_seed_url:
                "http://media.local/stream/att-video-hls-provider-fallback-1/master.m3u8",
              join_ticket: null,
            },
            width: 720,
            height: 1280,
          },
        ],
      });

      const player = await 等待查询元素<HTMLElement>(
        "media-player[data-media-viewer-player='video']"
      );
      expect(player).not.toBeNull();

      const provider: {
        type: string;
        library?: unknown;
        config?: Record<string, unknown>;
      } = { type: "hls" };
      player?.dispatchEvent(new CustomEvent("provider-change", { detail: provider }));

      expect(typeof provider.library).toBe("function");
      await expect((provider.library as () => Promise<unknown>)()).resolves.toBeTruthy();
    } finally {
      vi.doUnmock("p2p-media-loader-hlsjs");
      vi.resetModules();
      document.body.replaceChildren();
    }
  });

  it("移动端遇到 HLS manifest 时不走原生全屏，而是回退到支持 hls.js 的 Vidstack 覆盖层", () => {
    const createPhotoSwipeLightbox = vi.fn(() => ({
      init: vi.fn(),
      loadAndOpen: vi.fn(),
      destroy: vi.fn(),
    }));
    const createVidstackVideoOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const openNativeVideoFullscreen = vi.fn(() => true);
    const viewer = 创建媒体查看器({
      createPhotoSwipeLightbox,
      createVidstackVideoOverlay,
      isMobileViewport: () => true,
      openNativeVideoFullscreen,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-hls-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-hls-1",
          src: "http://media.local/stream/att-video-mobile-hls-1/master.m3u8",
          posterSrc: "http://media.local/poster-mobile-hls-1",
          width: 720,
          height: 1280,
        },
      ],
    });

    expect(openNativeVideoFullscreen).not.toHaveBeenCalled();
    expect(createVidstackVideoOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-mobile-hls-1",
        src: "http://media.local/stream/att-video-mobile-hls-1/master.m3u8",
      }),
      expect.objectContaining({
        开始视口占用: expect.any(Function),
        结束视口占用: expect.any(Function),
      }),
      expect.objectContaining({
        发出媒体会话信号: expect.any(Function),
      })
    );
    expect(createPhotoSwipeLightbox).not.toHaveBeenCalled();
  });

  it("默认桌面视频路径会创建 Vidstack 播放元素，并在销毁时释放覆盖层", async () => {
    const onViewportCaptureStart = vi.fn();
    const onViewportCaptureEnd = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
      onViewportCaptureStart,
      onViewportCaptureEnd,
    });

    viewer.打开({
      startAttachmentId: "att-video-default-vidstack-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-default-vidstack-1",
          src: "blob:http://media.local/default-vidstack-video-1",
          posterSrc: "http://media.local/default-vidstack-poster-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    const player = await 等待查询元素<HTMLElement>(
      "media-player[data-media-viewer-player='video']"
    );
    expect(consoleError).not.toHaveBeenCalled();
    expect(player).not.toBeNull();
    expect(player?.getAttribute("src")).toBe(
      "blob:http://media.local/default-vidstack-video-1"
    );
    expect(player?.getAttribute("poster")).toBe(
      "http://media.local/default-vidstack-poster-1"
    );
    expect(player?.getAttribute("aspect-ratio")).toBe("720/1280");
    expect(onViewportCaptureStart).toHaveBeenCalledTimes(1);

    viewer.销毁();

    expect(
      document.body.querySelector("media-player[data-media-viewer-player='video']")
    ).toBeNull();
    expect(onViewportCaptureEnd).toHaveBeenCalledTimes(1);
  });

  it("桌面视频覆盖层会把 waiting 信号回抛给媒体会话，并允许后续同步新的播放源", async () => {
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
    const player = await 等待查询元素<HTMLElement>(
      "media-player[data-media-viewer-player='video']"
    );
    expect(player).not.toBeNull();

    player?.dispatchEvent(new Event("waiting"));
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

    expect(player?.getAttribute("src")).toBe("blob:http://media.local/video-sync-new");
    expect(player?.getAttribute("poster")).toBe("http://media.local/poster-sync-new");
  });

  it("移动端原生全屏视频也会把播放器信号回抛，并在同步时切到新的播放源", async () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
      onMediaSessionSignal: (attachmentId, signal) => {
        信号记录.push({ attachmentId, signal });
      },
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-sync-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-sync-1",
          src: "blob:http://media.local/mobile-sync-old",
          posterSrc: "http://media.local/mobile-poster-old",
          width: 720,
          height: 1280,
        },
      ],
    });
    await Promise.resolve();

    const video = document.body.querySelector<HTMLVideoElement>("video");
    expect(video).not.toBeNull();

    video?.dispatchEvent(new Event("stalled"));
    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-mobile-sync-1",
        signal: { type: "PLAYER_STALLED" },
      },
    ]);

    viewer.同步({
      startAttachmentId: "att-video-mobile-sync-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-sync-1",
          src: "blob:http://media.local/mobile-sync-new",
          posterSrc: "http://media.local/mobile-poster-new",
          width: 720,
          height: 1280,
        },
      ],
    });

    expect(video?.src).toBe("blob:http://media.local/mobile-sync-new");
    expect(video?.poster).toBe("http://media.local/mobile-poster-new");
  });
});
