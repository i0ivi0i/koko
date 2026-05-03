// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../../媒体/媒体查看器";
import {
  安装方向模拟,
  安装全屏DOM模拟,
  读取VideoJs媒体容器,
  等待查询查看器关闭按钮,
  等待查询元素,
  等待查看器任务完成,
  清理媒体查看器测试环境,
} from "../common/媒体查看器支架";

describe("媒体查看器适配器 - 移动端原生全屏与返回", () => {
  afterEach(清理媒体查看器测试环境);

  it("移动端缺少标准 Fullscreen API 时，回退到 media element 原生真全屏", async () => {
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
    await 等待查看器任务完成();

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-media-viewer-mount='video']")).not.toBeNull();
    expect(
      document.body.querySelector<HTMLElement>('[aria-label="视频查看器"]')?.dataset
        .mediaViewerFullscreenPhase
    ).toBe("active");
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("移动端 media element 原生真全屏退出时，会回收同一查看器会话", async () => {
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
    await 等待查看器任务完成();
    const 已打开视频 = document.body.querySelector<HTMLVideoElement>("video");

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(已打开视频).not.toBeNull();

    已打开视频?.dispatchEvent(new Event("webkitendfullscreen"));
    await Promise.resolve();

    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
    expect(pause).toHaveBeenCalled();
  });

  it("移动端关闭 media element 原生真全屏查看器时，只退出同一颗播放器会话", async () => {
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
    await 等待查看器任务完成();

    ;(await 等待查询查看器关闭按钮())?.click();
    await Promise.resolve();

    expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(webkitExitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[aria-label="视频查看器"]')).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();
    expect(pause).toHaveBeenCalled();
  });

  it("竖屏视频进入移动端全屏时锁定 portrait，并在元数据更可信时纠正方向", async () => {
    安装全屏DOM模拟();
    const { lock } = 安装方向模拟();
    const viewer = 创建媒体查看器({
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
    await 等待查看器任务完成();

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
    await 等待查看器任务完成();
    expect(document.body.querySelector("video")).not.toBeNull();

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await Promise.resolve();

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ __kokoMediaFullscreenSession: expect.any(String) }),
      "",
      expect.any(String)
    );
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    expect(document.body.querySelector("video")).toBeNull();
  });
});
