// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  安装全屏DOM模拟,
  安装手动进入全屏模拟,
  安装可回退全屏堆栈模拟,
  安装ShadowHost全屏DOM模拟,
  读取VideoJs媒体容器,
  等待查询查看器关闭按钮,
  创建测试VideoJs进入全屏,
  创建测试VideoJs播放器壳,
  等待查询元素,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 桌面全屏与显示阶段", () => {
  afterEach(清理媒体查看器测试环境);

  it("桌面端显式打开视频时，会直接进入真全屏查看器而不是停在放大卡片", async () => {
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();
    const video = document.body.querySelector("video");
    const overlay = document.body.querySelector<HTMLElement>('[aria-label="视频查看器"]');
    const mount = document.body.querySelector<HTMLElement>("[data-media-viewer-mount='video']");
    const mediaContainer = 读取VideoJs媒体容器();
    const closeButton = await 等待查询查看器关闭按钮();

    expect(provider).not.toBeNull();
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(mediaContainer).not.toBeNull();
    expect(closeButton).not.toBeNull();
    expect(document.fullscreenElement).toBe(mediaContainer);
    expect(document.fullscreenElement).not.toBe(overlay);
    expect(document.fullscreenElement?.contains(closeButton!)).toBe(true);
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
        进入全屏 = 创建测试VideoJs进入全屏(container);
        return 创建测试VideoJs播放器壳({
          video,
          container,
          mountTarget: deps?.mountTarget ?? document.body,
          进入全屏,
        });
      }
    );
    vi.doMock("../../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器 } = await import("../../媒体/媒体查看器");
      const viewer = 创建媒体查看器({
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
      vi.doUnmock("../../媒体/videojs播放器壳");
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
        return 创建测试VideoJs播放器壳({
          video,
          container,
          mountTarget: deps?.mountTarget ?? document.body,
          进入全屏: 创建测试VideoJs进入全屏(container),
        });
      }
    );
    vi.doMock("../../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));

    try {
      const { 创建媒体查看器 } = await import("../../媒体/媒体查看器");
      const { 待完成进入请求, 完成进入 } = 安装手动进入全屏模拟();
      const viewer = 创建媒体查看器({
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
      vi.doUnmock("../../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });

  it("桌面端系统全屏元素落到 shadow host 时，一次系统退出也会直接回到群聊", async () => {
    const { requestFullscreen, exitFullscreen } = 安装ShadowHost全屏DOM模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

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

  it("桌面端异步壳路径不会形成 overlay/container 双层全屏栈，一次退出就直接回到群聊", async () => {
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
            resolve({
              ...创建测试VideoJs播放器壳({
                video,
                container,
                mountTarget: deps?.mountTarget ?? document.body,
                进入全屏: 创建测试VideoJs进入全屏(container),
              }),
            });
          });
        })
    );
    vi.doMock("../../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../../媒体/媒体查看器");
    const { requestFullscreen, exitFullscreen } = 安装可回退全屏堆栈模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    // 单 owner 下只会退出一次 container，全屏不会回落到第二层 overlay。
    await document.exitFullscreen?.();
    await Promise.resolve();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    // overlay 使用延迟移除（防全屏退出黑闪），需等 rAF + setTimeout(200) 完成
    await new Promise((r) => setTimeout(r, 250));
    expect(document.body.querySelector("video")).toBeNull();
  });
});
