// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器, type 媒体查看器依赖 } from "../媒体/媒体查看器";

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

const 安装严格瞬时激活全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  let 当前存在瞬时激活 = false;
  const 激活快照: boolean[] = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    激活快照.push(当前存在瞬时激活);
    if (!当前存在瞬时激活) {
      return Promise.reject(new Error("Fullscreen requires transient activation"));
    }
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

  return {
    requestFullscreen,
    exitFullscreen,
    激活快照,
    以瞬时激活执行<T>(action: () => T): T {
      当前存在瞬时激活 = true;
      try {
        return action();
      } finally {
        当前存在瞬时激活 = false;
      }
    },
  };
};

const 安装延迟退出全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  let 待完成退出: (() => void) | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        待完成退出 = resolve;
      })
  );
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  return {
    requestFullscreen,
    exitFullscreen,
    完成退出(): void {
      fullscreenElement = null;
      待完成退出?.();
      待完成退出 = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
};

const 安装手动进入全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  const 待完成进入请求: Array<{
    target: Element;
    resolve: () => void;
    reject: (error?: unknown) => void;
  }> = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    return new Promise<void>((resolve, reject) => {
      待完成进入请求.push({
        target: this,
        resolve: () => {
          fullscreenElement = this;
          document.dispatchEvent(new Event("fullscreenchange"));
          resolve();
        },
        reject: (error?: unknown) => {
          reject(error);
        },
      });
    });
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
  return {
    requestFullscreen,
    exitFullscreen,
    play,
    pause,
    待完成进入请求,
    完成进入(index = 0): void {
      待完成进入请求[index]?.resolve();
    },
    拒绝进入(index = 0, error: unknown = new Error("Fullscreen request rejected")): void {
      待完成进入请求[index]?.reject(error);
    },
  };
};

const 安装可回退全屏堆栈模拟 = () => {
  const stack: Element[] = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => stack.at(-1) ?? null,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    stack.push(this);
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    stack.pop();
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
  return { requestFullscreen, exitFullscreen };
};

const 安装ShadowHost全屏DOM模拟 = () => {
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    const root = this.getRootNode?.();
    if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
      fullscreenElement = root.host;
    } else {
      fullscreenElement = this;
    }
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
  const skin = document.body.querySelector("koko-video-skin, video-skin");
  return skin?.shadowRoot?.querySelector("media-container") ?? null;
};

const 创建测试VideoJs进入全屏 = (container: HTMLElement) =>
  vi.fn(async () => {
    if (typeof container.requestFullscreen === "function") {
      await container.requestFullscreen({ navigationUI: "hide" });
      return "standard" as const;
    }
    return "unsupported" as const;
  });

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
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
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

  it("桌面端显式打开视频时，会直接进入真全屏查看器而不是停在放大卡片", async () => {
    const { requestFullscreen } = 安装全屏DOM模拟();
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
    const overlay = document.body.querySelector<HTMLElement>('[aria-label="视频查看器"]');
    const mount = document.body.querySelector<HTMLElement>("[data-media-viewer-mount='video']");
    const mediaContainer = 读取VideoJs媒体容器();

    expect(provider).not.toBeNull();
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(mediaContainer).not.toBeNull();
    expect(document.fullscreenElement).toBe(mediaContainer);
    expect(document.fullscreenElement).not.toBe(overlay);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances.at(0)).toBe(mediaContainer);
    expect(overlay?.dataset.mediaViewerPresentation).toBe("immersive");
    expect(mount).not.toBeNull();
    expect(mount?.style.width).toBe("100%");
    expect(mount?.style.maxWidth).toBe("100%");
    expect(mount?.dataset.mediaViewerImmersive).toBe("true");
    expect(provider?.style.width).toBe("100%");
    expect(读取VideoJs媒体容器()?.style.width).toBe("100%");
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("显式打开视频时，会把系统全屏进入动作委托给 Video.js 播放器壳", async () => {
    vi.resetModules();
    const { requestFullscreen } = 安装全屏DOM模拟();
    let container!: HTMLElement;
    let 进入全屏!: ReturnType<typeof 创建测试VideoJs进入全屏>;
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) => {
        const video = document.createElement("video");
        Object.assign(video, {
          play: vi.fn(() => Promise.resolve()),
          pause: vi.fn(),
        });
        container = document.createElement("div");
        container.className = "fake-videojs-container";
        (deps?.mountTarget ?? document.body).append(container, video);
        进入全屏 = 创建测试VideoJs进入全屏(container);
        return {
          destroy: vi.fn(),
          同步: vi.fn(),
          读取视频元素: () => video,
          读取容器元素: () => container,
          进入全屏,
        };
      }
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
      const viewer = 创建媒体查看器({
        isMobileViewport: () => false,
      });

      viewer.打开({
        startAttachmentId: "att-video-videojs-fullscreen-owner-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-videojs-fullscreen-owner-1",
            src: "blob:http://media.local/videojs-fullscreen-owner-1",
            posterSrc: "http://media.local/poster-videojs-fullscreen-owner-1",
            width: 1280,
            height: 720,
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(进入全屏).toHaveBeenCalledTimes(1);
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      expect(requestFullscreen.mock.instances.at(0)).toBe(container);
    } finally {
      vi.doUnmock("../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });

  it("标准系统全屏请求挂起时，沉浸查看器不会提前亮起或暴露关闭按钮", async () => {
    vi.resetModules();
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) => {
        const video = document.createElement("video");
        Object.assign(video, {
          play: vi.fn(() => Promise.resolve()),
          pause: vi.fn(),
        });
        const container = document.createElement("div");
        container.className = "fake-desktop-container";
        (deps?.mountTarget ?? document.body).append(container, video);
        return {
          destroy: vi.fn(),
          同步: vi.fn(),
          读取视频元素: () => video,
          读取容器元素: () => container,
          进入全屏: 创建测试VideoJs进入全屏(container),
        };
      }
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
      const { 待完成进入请求, 完成进入 } = 安装手动进入全屏模拟();
      const viewer = 创建媒体查看器({
        isMobileViewport: () => false,
      });

      viewer.打开({
        startAttachmentId: "att-video-fullscreen-pending-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-fullscreen-pending-1",
            src: "blob:http://media.local/video-fullscreen-pending-1",
            posterSrc: "http://media.local/poster-fullscreen-pending-1",
            width: 1280,
            height: 720,
          },
        ],
      });

      const overlay = await 等待查询元素<HTMLElement>('[aria-label="视频查看器"]');
      const container = await 等待查询元素<HTMLElement>(".fake-desktop-container");

      expect(container).not.toBeNull();
      expect(待完成进入请求).toHaveLength(1);
      expect(待完成进入请求[0]?.target).toBe(container);
      const closeButton = overlay?.querySelector<HTMLButtonElement>(
        'button[aria-label="关闭视频查看器"]'
      );
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("pending");
      expect(overlay?.style.opacity).toBe("0");
      expect(overlay?.style.pointerEvents).toBe("none");
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
      expect(closeButton).toBeNull();

      完成进入(0);
      await Promise.resolve();

      const activeCloseButton = overlay?.querySelector<HTMLButtonElement>(
        'button[aria-label="关闭视频查看器"]'
      );
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("active");
      expect(overlay?.style.opacity).toBe("1");
      expect(overlay?.style.pointerEvents).toBe("auto");
      expect(overlay?.getAttribute("aria-hidden")).toBeNull();
      expect(activeCloseButton).not.toBeNull();
      expect(activeCloseButton?.style.opacity).toBe("1");
      expect(activeCloseButton?.style.pointerEvents).toBe("auto");

      viewer.销毁();
    } finally {
      vi.doUnmock("../媒体/videojs播放器壳");
      vi.resetModules();
    }
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
    const 创建VideoJs播放器壳 = vi.fn(async (_source?: unknown, _deps?: Record<string, unknown>) => {
      const video = document.createElement("video");
      const container = document.createElement("div");
      return {
        destroy: vi.fn(),
        同步: vi.fn(),
        读取视频元素: () => video,
        读取容器元素: () => container,
        进入全屏: 创建测试VideoJs进入全屏(container),
      };
    });
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
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

  it("默认视频查看器挂接 HLS P2P 引擎时，会显式带上 announceTrackers 与正式时间窗参数", async () => {
    vi.resetModules();
    const 创建VideoJs播放器壳 = vi.fn(async (_source?: unknown, _deps?: Record<string, unknown>) => {
      const video = document.createElement("video");
      const container = document.createElement("div");
      return {
        destroy: vi.fn(),
        同步: vi.fn(),
        读取视频元素: () => video,
        读取容器元素: () => container,
        进入全屏: 创建测试VideoJs进入全屏(container),
      };
    });
    const bindHls = vi.fn();
    const HlsJsP2PEngine = vi.fn(
      class {
        bindHls = bindHls;
      }
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    vi.doMock("p2p-media-loader-hlsjs", () => ({
      HlsJsP2PEngine,
    }));

    try {
      const { 创建媒体查看器: 创建默认媒体查看器 } = await import("../媒体/媒体查看器");
      const viewer = 创建默认媒体查看器({
        isMobileViewport: () => false,
      });

      viewer.打开({
        startAttachmentId: "att-video-default-p2p-hls-config-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-default-p2p-hls-config-1",
            src: "http://media.local/stream/att-video-default-p2p-hls-config-1/master.m3u8",
            posterSrc: "http://media.local/poster-default-p2p-hls-config-1",
            streamingDistribution: {
              swarm_id: "swarm-default-p2p-hls-config-1",
              announce_urls: ["wss://tracker-1.koko.local/announce", "wss://tracker-2.koko.local/announce"],
              web_seed_url: "http://media.local/web-seed-default-p2p-hls-config-1",
              join_ticket: "ticket-default-p2p-hls-config-1",
              ticket_expires_at: null,
              survival_mode: "server_assisted",
            },
            width: 1280,
            height: 720,
          },
        ],
      });
      await Promise.resolve();

      const deps = 创建VideoJs播放器壳.mock.calls[0]?.[1] as
        | { 挂接P2PHls增强层?: (input: { hls: object }) => Promise<void> }
        | undefined;
      expect(deps?.挂接P2PHls增强层).toEqual(expect.any(Function));

      const fakeHls = {};
      await deps?.挂接P2PHls增强层?.({ hls: fakeHls });

      expect(HlsJsP2PEngine).toHaveBeenCalledWith({
        core: {
          announceTrackers: [
            "wss://tracker-1.koko.local/announce",
            "wss://tracker-2.koko.local/announce",
          ],
          simultaneousHttpDownloads: 2,
          simultaneousP2PDownloads: 3,
          highDemandTimeWindow: 15,
          httpDownloadTimeWindow: 3000,
          p2pDownloadTimeWindow: 6000,
        },
      });
      expect(bindHls).toHaveBeenCalledWith(fakeHls);

      viewer.销毁();
    } finally {
      vi.doUnmock("../媒体/videojs播放器壳");
      vi.doUnmock("p2p-media-loader-hlsjs");
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

    expect(video?.src).toBe("blob:http://media.local/video-sync-new");
    expect(video?.poster).toBe("http://media.local/poster-sync-new");
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("查看器切到另一条视频时会复用同一颗 Video.js 壳，并把媒体信号归属切到新附件", async () => {
    const 信号记录: Array<{ attachmentId: string; signal: { type: string } }> = [];
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
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
    const mediaContainer = 读取VideoJs媒体容器();
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBe(mediaContainer);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
  });

  it("移动端沉浸查看器会占满应用视口，不再保留桌面模态内边距", async () => {
    安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-immersive-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-immersive-1",
          src: "blob:http://media.local/mobile-immersive-video-1",
          posterSrc: "http://media.local/poster-mobile-immersive-1",
          width: 720,
          height: 1280,
        },
      ],
    });

    const overlay = await 等待查询元素<HTMLElement>('[aria-label="视频查看器"]');
    const mount = document.body.querySelector<HTMLElement>('[data-media-viewer-mount="video"]');

    expect(overlay?.style.padding).toBe("0px");
    expect(mount?.dataset.mediaViewerImmersive).toBe("true");
    expect(mount?.style.height).toBe("100%");
  });

  it("移动端异步壳场景下，全屏请求只会在容器就绪后触发一次", async () => {
    vi.resetModules();
    const 延迟壳解析器: Array<() => void> = [];
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) =>
        new Promise((resolve) => {
          延迟壳解析器.push(() => {
            const video = document.createElement("video");
            Object.assign(video, {
              play: vi.fn(() => Promise.resolve()),
              pause: vi.fn(),
            });
            const container = document.createElement("div");
            container.className = "fake-mobile-container";
            (deps?.mountTarget ?? document.body).append(container, video);
            resolve({
              destroy: vi.fn(),
              同步: vi.fn(),
              读取视频元素: () => video,
              读取容器元素: () => container,
              进入全屏: 创建测试VideoJs进入全屏(container),
            });
          });
        })
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
    const { requestFullscreen, 激活快照, 以瞬时激活执行 } = 安装严格瞬时激活全屏模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    以瞬时激活执行(() =>
      viewer.打开({
        startAttachmentId: "att-video-mobile-activation-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-mobile-activation-1",
            src: "blob:http://media.local/mobile-activation-video-1",
            posterSrc: "http://media.local/poster-mobile-activation-1",
            width: 720,
            height: 1280,
          },
        ],
      })
    );

    expect(requestFullscreen).toHaveBeenCalledTimes(0);
    expect(激活快照).toEqual([]);
    expect(创建VideoJs播放器壳).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-media-viewer-mount='video']")).not.toBeNull();

    延迟壳解析器.at(0)?.();
    await Promise.resolve();
    await Promise.resolve();

    const container = document.body.querySelector<HTMLElement>(".fake-mobile-container");
    expect(container).not.toBeNull();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances.at(0)).toBe(container);
    expect(激活快照).toEqual([false]);

    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
  });

  it("异步壳就绪前不会触发 overlay 预请求，且就绪后只会对容器发起一次全屏请求", async () => {
    vi.resetModules();
    const 延迟壳解析器: Array<() => void> = [];
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) =>
        new Promise((resolve) => {
          延迟壳解析器.push(() => {
            const video = document.createElement("video");
            Object.assign(video, {
              play: vi.fn(() => Promise.resolve()),
              pause: vi.fn(),
            });
            const container = document.createElement("div");
            container.className = "fake-mobile-container";
            (deps?.mountTarget ?? document.body).append(container, video);
            resolve({
              destroy: vi.fn(),
              同步: vi.fn(),
              读取视频元素: () => video,
              读取容器元素: () => container,
              进入全屏: 创建测试VideoJs进入全屏(container),
            });
          });
        })
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
      const { 待完成进入请求, 完成进入 } = 安装手动进入全屏模拟();
      const viewer = 创建媒体查看器({
        isMobileViewport: () => true,
      });

      viewer.打开({
        startAttachmentId: "att-video-mobile-overlay-hidden-1",
        items: [
          {
            kind: "video",
            attachmentId: "att-video-mobile-overlay-hidden-1",
            src: "blob:http://media.local/mobile-overlay-hidden-video-1",
            posterSrc: "http://media.local/poster-mobile-overlay-hidden-1",
            width: 720,
            height: 1280,
          },
        ],
      });

      const overlay = await 等待查询元素<HTMLElement>('[aria-label="视频查看器"]');
      expect(overlay).not.toBeNull();
      expect(待完成进入请求).toHaveLength(0);
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("pending");
      expect(overlay?.style.opacity).toBe("0");
      expect(overlay?.style.pointerEvents).toBe("none");
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
      expect(
        overlay?.querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ).toBeNull();

      延迟壳解析器.at(0)?.();
      await Promise.resolve();
      await Promise.resolve();

      const container = document.body.querySelector<HTMLElement>(".fake-mobile-container");
      expect(container).not.toBeNull();

      expect(待完成进入请求).toHaveLength(1);
      expect(待完成进入请求[0]?.target).toBe(container);
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("pending");
      expect(overlay?.style.opacity).toBe("0");
      expect(overlay?.style.pointerEvents).toBe("none");
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
      expect(
        overlay?.querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ).toBeNull();

      完成进入(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(overlay?.dataset.mediaViewerPresentation).toBe("immersive");
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("active");
      expect(overlay?.style.opacity).toBe("1");
      expect(overlay?.style.pointerEvents).toBe("auto");
      expect(overlay?.getAttribute("aria-hidden")).toBeNull();
      expect(
        overlay?.querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ).not.toBeNull();

      viewer.销毁();
    } finally {
      vi.doUnmock("../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });

  it("移动端缺少标准 Fullscreen API 时，会退回 video 原生 webkit fullscreen 真全屏", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const webkitEnterFullscreen = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName.toLowerCase() === "video") {
          Object.assign(element, {
            play,
            pause,
            webkitEnterFullscreen,
          });
        }
        return element;
      }) as typeof document.createElement
    );

    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-overlay-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-overlay-1",
          src: "blob:http://media.local/mobile-overlay-video-1",
          posterSrc: "http://media.local/poster-mobile-overlay-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-media-viewer-mount='video']")).not.toBeNull();
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("移动端原生 webkit 全屏退出时，会沿同一条关闭链回收查看器", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const webkitEnterFullscreen = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName.toLowerCase() === "video") {
          Object.assign(element, {
            play,
            pause,
            webkitEnterFullscreen,
          });
        }
        return element;
      }) as typeof document.createElement
    );

    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-native-close-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-native-close-1",
          src: "blob:http://media.local/mobile-native-close-video-1",
          posterSrc: "http://media.local/poster-mobile-native-close-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");
    const 已打开视频 = document.body.querySelector<HTMLVideoElement>("video");

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(已打开视频).not.toBeNull();

    已打开视频?.dispatchEvent(new Event("webkitendfullscreen"));
    await Promise.resolve();

    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
    expect(pause).toHaveBeenCalled();
  });

  it("移动端原生 webkit 全屏活跃时，关闭请求会先退出原生全屏再回收查看器", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const webkitEnterFullscreen = vi.fn(function (this: HTMLVideoElement) {
      this.dispatchEvent(new Event("webkitbeginfullscreen"));
    });
    const webkitExitFullscreen = vi.fn(function (this: HTMLVideoElement) {
      this.dispatchEvent(new Event("webkitendfullscreen"));
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName.toLowerCase() === "video") {
          Object.assign(element, {
            play,
            pause,
            webkitEnterFullscreen,
            webkitExitFullscreen,
          });
        }
        return element;
      }) as typeof document.createElement
    );

    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-native-close-button-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-native-close-button-1",
          src: "blob:http://media.local/mobile-native-close-button-video-1",
          posterSrc: "http://media.local/poster-mobile-native-close-button-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ?.click();
    await Promise.resolve();

    expect(webkitExitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
    expect(pause).toHaveBeenCalled();
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

  it("系统全屏元素落到 shadow host 时，一次系统退出也会直接回到群聊", async () => {
    const { requestFullscreen, exitFullscreen } = 安装ShadowHost全屏DOM模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-shadow-host-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-shadow-host-1",
          src: "blob:http://media.local/mobile-shadow-host-video-1",
          posterSrc: "http://media.local/poster-mobile-shadow-host-1",
          width: 720,
          height: 1280,
        },
      ],
    });

    await 等待查询元素("video-player[data-player-shell='videojs']");

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement?.tagName).toBe("KOKO-VIDEO-SKIN");
    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();

    await document.exitFullscreen?.();
    await Promise.resolve();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
  });

  it("移动端关闭上一条视频后，下一条视频仍沿同一容器链一次触发全屏请求", async () => {
    vi.resetModules();
    const 延迟壳解析器: Array<() => void> = [];
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) =>
        new Promise((resolve) => {
          延迟壳解析器.push(() => {
            const video = document.createElement("video");
            Object.assign(video, {
              play: vi.fn(() => Promise.resolve()),
              pause: vi.fn(),
            });
            const container = document.createElement("div");
            container.className = "fake-mobile-container";
            (deps?.mountTarget ?? document.body).append(container, video);
            resolve({
              destroy: vi.fn(),
              同步: vi.fn(),
              读取视频元素: () => video,
              读取容器元素: () => container,
              进入全屏: 创建测试VideoJs进入全屏(container),
            });
          });
        })
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-reopen-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-reopen-1",
          src: "blob:http://media.local/mobile-reopen-video-1",
          posterSrc: "http://media.local/poster-mobile-reopen-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(0);
    延迟壳解析器.at(0)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ?.click();
    await Promise.resolve();
    await Promise.resolve();

    viewer.打开({
      startAttachmentId: "att-video-mobile-reopen-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-reopen-2",
          src: "blob:http://media.local/mobile-reopen-video-2",
          posterSrc: "http://media.local/poster-mobile-reopen-2",
          width: 1280,
          height: 720,
        },
      ],
    });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    延迟壳解析器.at(1)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
  });

  it("移动端上一条视频仍在退出系统全屏时，下一条视频首击也不会退化成等待后二次点击", async () => {
    vi.resetModules();
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) => {
        const video = document.createElement("video");
        Object.assign(video, {
          play: vi.fn(() => Promise.resolve()),
          pause: vi.fn(),
        });
        const container = document.createElement("div");
        container.className = "fake-mobile-container";
        (deps?.mountTarget ?? document.body).append(container, video);
        return Promise.resolve({
          destroy: vi.fn(),
          同步: vi.fn(),
          读取视频元素: () => video,
          读取容器元素: () => container,
          进入全屏: 创建测试VideoJs进入全屏(container),
        });
      }
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
    const { requestFullscreen, exitFullscreen, 完成退出 } = 安装延迟退出全屏模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-close-pending-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-close-pending-1",
          src: "blob:http://media.local/mobile-close-pending-video-1",
          posterSrc: "http://media.local/poster-mobile-close-pending-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ?.click();
    expect(exitFullscreen).toHaveBeenCalled();

    viewer.打开({
      startAttachmentId: "att-video-mobile-close-pending-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-close-pending-2",
          src: "blob:http://media.local/mobile-close-pending-video-2",
          posterSrc: "http://media.local/poster-mobile-close-pending-2",
          width: 1280,
          height: 720,
        },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(创建VideoJs播放器壳).toHaveBeenCalledTimes(2);
    expect(document.body.querySelectorAll('[aria-label="视频查看器"]')).toHaveLength(1);
    /**
     * 即使上一会话 exitFullscreen 仍在 pending，新会话首击也必须继续尝试系统全屏。
     * 否则移动端就会退化成“第一次点只进假全屏，第二次再点才真全屏”。
     */
    expect(requestFullscreen).toHaveBeenCalledTimes(2);

    完成退出();
    await Promise.resolve();

    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
  });

  it("移动端新会话在自己尚未真正接管系统全屏前，不会被迟到的空 fullscreenchange 误关掉", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
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

    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-stale-exit-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-stale-exit-2",
          src: "blob:http://media.local/mobile-stale-exit-video-2",
          posterSrc: "http://media.local/poster-mobile-stale-exit-2",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    document.dispatchEvent(new Event("fullscreenchange"));
    await Promise.resolve();

    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
    expect(document.body.querySelector("video")).toBeInstanceOf(HTMLVideoElement);
  });

  it("异步壳路径不会形成 overlay/container 双层全屏栈，一次退出就直接回到群聊", async () => {
    vi.resetModules();
    const 延迟壳解析器: Array<() => void> = [];
    const 创建VideoJs播放器壳 = vi.fn(
      (_source?: unknown, deps?: { mountTarget?: HTMLElement | null }) =>
        new Promise((resolve) => {
          延迟壳解析器.push(() => {
            const video = document.createElement("video");
            Object.assign(video, {
              play: vi.fn(() => Promise.resolve()),
              pause: vi.fn(),
            });
            const container = document.createElement("div");
            container.className = "fake-mobile-container";
            (deps?.mountTarget ?? document.body).append(container, video);
            resolve({
              destroy: vi.fn(),
              同步: vi.fn(),
              读取视频元素: () => video,
              读取容器元素: () => container,
              进入全屏: 创建测试VideoJs进入全屏(container),
            });
          });
        })
    );
    vi.doMock("../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../媒体/媒体查看器");
    const { requestFullscreen, exitFullscreen } = 安装可回退全屏堆栈模拟();
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-fallback-close-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-fallback-close-1",
          src: "blob:http://media.local/mobile-fallback-close-video-1",
          posterSrc: "http://media.local/poster-mobile-fallback-close-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(0);
    延迟壳解析器.at(0)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    // 单 owner 下只会退出一次 container，全屏不会回落到第二层 overlay。
    await document.exitFullscreen?.();
    await Promise.resolve();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
  });

  it("异步接管中的同 renderer 视频请求不会重复创建第二个查看器会话", async () => {
    const 延迟壳解析器: Array<() => void> = [];
    const 同步 = vi.fn();
    const 销毁 = vi.fn();
    type 测试视频壳工厂 = NonNullable<媒体查看器依赖["createVideoJsPlayerShell"]>;
    const createVideoJsPlayerShell: 测试视频壳工厂 = vi.fn(
      (_item, _lifecycle, _hooks) =>
        new Promise<Awaited<ReturnType<测试视频壳工厂>>>((resolve) => {
          延迟壳解析器.push(() =>
            resolve({
              destroy: 销毁,
              同步,
            })
          );
        })
    );
    const viewer = 创建媒体查看器({
      isMobileViewport: () => true,
      createVideoJsPlayerShell,
    });

    viewer.打开({
      startAttachmentId: "att-video-pending-open-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-pending-open-1",
          src: "blob:http://media.local/pending-open-video-1",
          posterSrc: "http://media.local/poster-pending-open-1",
          width: 1280,
          height: 720,
        },
      ],
    });
    viewer.打开({
      startAttachmentId: "att-video-pending-open-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-pending-open-1",
          src: "blob:http://media.local/pending-open-video-1-updated",
          posterSrc: "http://media.local/poster-pending-open-1-updated",
          width: 1280,
          height: 720,
        },
      ],
    });

    expect(createVideoJsPlayerShell).toHaveBeenCalledTimes(1);

    延迟壳解析器.at(0)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(同步).toHaveBeenCalledWith({
      kind: "video",
      attachmentId: "att-video-pending-open-1",
      src: "blob:http://media.local/pending-open-video-1-updated",
      posterSrc: "http://media.local/poster-pending-open-1-updated",
      width: 1280,
      height: 720,
    });
    expect(销毁).not.toHaveBeenCalled();
  });

  it("关闭视频查看器后，再打开另一条视频时会重新创建同一套查看器壳，而不是复用已销毁实例", async () => {
    const viewer = 创建媒体查看器({
      isMobileViewport: () => false,
    });

    viewer.打开({
      startAttachmentId: "att-video-reopen-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-reopen-1",
          src: "blob:http://media.local/reopen-video-1",
          posterSrc: "http://media.local/poster-reopen-1",
          width: 1280,
          height: 720,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭视频查看器"]'
    );
    expect(closeButton).not.toBeNull();

    closeButton?.click();
    await Promise.resolve();

    expect(document.body.querySelector("video-player[data-player-shell='videojs']")).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();

    viewer.打开({
      startAttachmentId: "att-video-reopen-2",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-reopen-2",
          src: "blob:http://media.local/reopen-video-2",
          posterSrc: "http://media.local/poster-reopen-2",
          width: 720,
          height: 1280,
        },
      ],
    });
    const reopenedShell = await 等待查询元素<HTMLElement>("video-player[data-player-shell='videojs']");
    const reopenedVideo = document.body.querySelector<HTMLVideoElement>("video");

    expect(reopenedShell).not.toBeNull();
    expect(reopenedVideo).not.toBeNull();
    expect(reopenedVideo?.poster).toBe("http://media.local/poster-reopen-2");
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });
});
