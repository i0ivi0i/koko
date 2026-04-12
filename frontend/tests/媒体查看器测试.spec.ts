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

describe("媒体查看器适配器", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("会把已解析的媒体 source 映射给 GLightbox，并从指定附件打开", () => {
    const openAt = vi.fn();
    const destroy = vi.fn();
    const createLightbox = vi.fn(() => ({
      openAt,
      destroy,
    }));
    const viewer = 创建媒体查看器({ createLightbox });

    viewer.打开({
      startAttachmentId: "att-video-1",
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
      ],
    });

    expect(createLightbox).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: null,
        touchNavigation: true,
        keyboardNavigation: true,
        autoplayVideos: true,
        loop: false,
        elements: [
          {
            href: "http://media.local/original-image-1",
            type: "image",
            alt: "图片附件原图",
            width: "1200px",
            height: "800px",
          },
          {
            href: "blob:http://media.local/webtorrent-video-1",
            type: "video",
            source: "local",
            width: "1280px",
            height: "720px",
            poster: "http://media.local/poster-video-1",
          },
        ],
      })
    );
    expect(openAt).toHaveBeenCalledWith(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("移动触屏端点击视频会优先进入原生全屏播放，不再打开 lightbox", () => {
    const createLightbox = vi.fn(() => ({
      openAt: vi.fn(),
      destroy: vi.fn(),
    }));
    const openNativeVideoFullscreen = vi.fn(() => true);
    const viewer = 创建媒体查看器({
      createLightbox,
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
      })
    );
    expect(createLightbox).not.toHaveBeenCalled();
  });

  it("默认原生全屏路径创建可见的全屏视频元素，不能把真正播放层藏成 1px", () => {
    const openAt = vi.fn();
    const destroy = vi.fn();
    const createLightbox = vi.fn(() => ({
      openAt,
      destroy,
    }));
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
      createLightbox,
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
    expect(createLightbox).not.toHaveBeenCalled();
  });

  it("竖屏视频进入移动端全屏时锁定 portrait，不再沿用浏览器默认横屏策略", async () => {
    const createLightbox = vi.fn(() => ({
      openAt: vi.fn(),
      destroy: vi.fn(),
    }));
    const { requestFullscreen } = 安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createLightbox,
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
    expect(createLightbox).not.toHaveBeenCalled();
  });

  it("移动端视频会用浏览器元数据纠正后端旧横屏宽高，避免竖拍视频继续锁横屏", async () => {
    const createLightbox = vi.fn(() => ({
      openAt: vi.fn(),
      destroy: vi.fn(),
    }));
    安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createLightbox,
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
    expect(createLightbox).not.toHaveBeenCalled();
  });

  it("手机返回键触发 popstate 时只退出媒体全屏会话，并清理方向锁回到聊天界面", async () => {
    const createLightbox = vi.fn(() => ({
      openAt: vi.fn(),
      destroy: vi.fn(),
    }));
    const pushState = vi.spyOn(history, "pushState");
    const { exitFullscreen, pause } = 安装全屏DOM模拟();
    const { unlock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
      createLightbox,
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
    expect(createLightbox).not.toHaveBeenCalled();
  });

  it("竖屏视频在 lightbox 回退路径里也使用真实视频比例，不再固定 16:9", () => {
    const createLightbox = vi.fn(() => ({
      openAt: vi.fn(),
      destroy: vi.fn(),
    }));
    const viewer = 创建媒体查看器({
      createLightbox,
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

    expect(createLightbox).toHaveBeenCalledWith(
      expect.objectContaining({
        plyr: {
          config: expect.objectContaining({
            ratio: "720:1280",
          }),
        },
      })
    );
  });
});
