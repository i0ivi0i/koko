// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  安装全屏DOM模拟,
  安装严格瞬时激活全屏模拟,
  安装手动进入全屏模拟,
  读取VideoJs媒体容器,
  创建测试VideoJs进入全屏,
  创建测试VideoJs播放器壳,
  等待查询元素,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 移动端容器全屏", () => {
  afterEach(清理媒体查看器测试环境);

  it("移动端真全屏策略仍复用同一个播放器会话，不会额外创建第二颗 video", async () => {
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

    const video = document.body.querySelector("video");
    const mediaContainer = 读取VideoJs媒体容器();
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(mediaContainer).not.toBeNull();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBe(mediaContainer);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );
  });

  it("移动端查看器默认优先走 Video.js container-first 真全屏", async () => {
    const pushState = vi.spyOn(history, "pushState");
    const { requestFullscreen, exitFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
    });

    viewer.打开({
      startAttachmentId: "att-video-mobile-app-fullscreen-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-mobile-app-fullscreen-1",
          src: "blob:http://media.local/mobile-app-fullscreen-video-1",
          posterSrc: "http://media.local/poster-mobile-app-fullscreen-1",
          width: 720,
          height: 1280,
        },
      ],
    });
    await 等待查询元素("video-player[data-player-shell='videojs']");
    await 等待查看器任务完成();

    const overlay = document.body.querySelector<HTMLElement>('[aria-label="视频查看器"]');
    const mount = document.body.querySelector<HTMLElement>('[data-media-viewer-mount="video"]');
    const video = document.body.querySelector("video");
    const mediaContainer = 读取VideoJs媒体容器();

    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(overlay?.dataset.mediaViewerPresentation).toBe("immersive");
    expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("active");
    expect(mount?.dataset.mediaViewerSystemFullscreen).toBe("true");
    expect(document.fullscreenElement).toBe(mediaContainer);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances.at(0)).toBe(mediaContainer);
    expect(exitFullscreen).toHaveBeenCalledTimes(0);
    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ __kokoMediaFullscreenSession: expect.any(String) }),
      "",
      expect.any(String)
    );
  });

  it("移动端沉浸查看器会占满应用视口，不再保留桌面模态内边距", async () => {
    安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
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

  it("移动端异步壳场景下，会等容器就绪后优先请求 Video.js 容器真全屏", async () => {
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
    const { requestFullscreen, 激活快照, 以瞬时激活执行 } = 安装严格瞬时激活全屏模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

    const container = document.body.querySelector<HTMLElement>(".fake-mobile-container");
    expect(container).not.toBeNull();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances).toContain(container);
    expect(激活快照).toEqual([false]);

    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
  });

  it("移动端异步壳就绪前不亮空黑层，真全屏接管后才露出沉浸层", async () => {
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

    try {
      const { 创建媒体查看器 } = await import("../../媒体/媒体查看器");
      const { 待完成进入请求 } = 安装手动进入全屏模拟();
      const viewer = 创建媒体查看器({
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
      await 等待查看器任务完成();

      const container = document.body.querySelector<HTMLElement>(".fake-mobile-container");
      expect(container).not.toBeNull();

      expect(待完成进入请求).toHaveLength(1);
      expect(待完成进入请求.at(0)?.target).toBe(container);
      expect(overlay?.dataset.mediaViewerFullscreenPhase).toBe("pending");
      expect(overlay?.style.opacity).toBe("0");
      expect(overlay?.style.pointerEvents).toBe("none");
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");

      待完成进入请求.at(0)?.resolve();
      await 等待查看器任务完成();

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
      vi.doUnmock("../../媒体/videojs播放器壳");
      vi.resetModules();
    }
  });
});
