// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { 媒体查看器依赖 } from "../../媒体/媒体查看器";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  安装全屏DOM模拟,
  安装延迟退出全屏模拟,
  等待查询查看器关闭按钮,
  创建测试VideoJs进入全屏,
  创建测试VideoJs播放器壳,
  等待查询元素,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 会话重入与竞态收口", () => {
  afterEach(清理媒体查看器测试环境);

  it("移动端关闭上一条视频后，下一条视频仍沿同一真全屏链路打开", async () => {
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
    const { requestFullscreen } = 安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const closeButton = await 等待查询查看器关闭按钮();
    closeButton?.click();
    await 等待查看器任务完成(6);

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
    expect(创建VideoJs播放器壳).toHaveBeenCalledTimes(2);

    延迟壳解析器.at(1)?.();
    await 等待查看器任务完成(6);
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[aria-label="视频查看器"]')).not.toBeNull();
  });

  it("移动端上一条真全屏会话关闭后，下一条首击不会退化成等待后二次点击", async () => {
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
        return Promise.resolve({
          ...创建测试VideoJs播放器壳({
            video,
            container,
            mountTarget: deps?.mountTarget ?? document.body,
            进入全屏: 创建测试VideoJs进入全屏(container),
          }),
        });
      }
    );
    vi.doMock("../../媒体/videojs播放器壳", () => ({
      创建VideoJs播放器壳,
      预热默认VideoJs元素: vi.fn(() => Promise.resolve()),
    }));
    const { 创建媒体查看器 } = await import("../../媒体/媒体查看器");
    const { requestFullscreen, exitFullscreen, 完成退出 } = 安装延迟退出全屏模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="关闭视频查看器"]')
      ?.click();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);

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
    await 等待查看器任务完成();

    expect(创建VideoJs播放器壳).toHaveBeenCalledTimes(2);
    expect(document.body.querySelectorAll('[aria-label="视频查看器"]')).toHaveLength(1);
    /**
     * 移动端恢复 Video.js container-first 真全屏后，上一条的退出可能仍在 pending。
     * 下一条首击仍必须打开新的查看器会话，不能要求用户再点第二次。
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

  it("异步接管中的同 renderer 视频请求不会重复创建第二个查看器会话", async () => {
    const 延迟壳解析器: Array<() => void> = [];
    const 同步 = vi.fn();
    const 销毁 = vi.fn();
    type 测试视频壳工厂 = NonNullable<媒体查看器依赖["createVideoJsPlayerShell"]>;
    const createVideoJsPlayerShell: 测试视频壳工厂 = vi.fn(
      (_source, _deps) =>
        new Promise<Awaited<ReturnType<测试视频壳工厂>>>((resolve) => {
          延迟壳解析器.push(() =>
            resolve(
              创建测试VideoJs播放器壳({
                destroy: 销毁,
                同步,
              })
            )
          );
        })
    );
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成(6);

    expect(同步).toHaveBeenCalledTimes(2);
    expect(同步).toHaveBeenLastCalledWith({
      kind: "file",
      src: "blob:http://media.local/pending-open-video-1-updated",
      posterSrc: "http://media.local/poster-pending-open-1-updated",
      width: 1280,
      height: 720,
    });
    expect(销毁).not.toHaveBeenCalled();
  });

  it("关闭视频查看器后，再打开另一条视频时会重新创建同一套查看器壳，而不是复用已销毁实例", async () => {
    安装全屏DOM模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await 等待查看器任务完成();

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
    await 等待查看器任务完成();
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
