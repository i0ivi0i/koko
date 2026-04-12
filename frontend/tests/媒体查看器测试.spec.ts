// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../媒体/媒体查看器";

describe("媒体查看器适配器", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
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
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const play = vi.fn(() => Promise.resolve());
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = createElement(tagName, options);
        if (tagName.toLowerCase() === "video") {
          Object.assign(element, { requestFullscreen, play });
        }
        return element;
      }) as typeof document.createElement
    );
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
