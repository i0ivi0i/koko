// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建VideoJs播放器壳 } from "../媒体/videojs播放器壳.js";

const 创建假播放器根 = () => {
  const provider = document.createElement("video-player");
  const skin = document.createElement("video-skin");
  const container = document.createElement("media-container");
  const video = document.createElement("video");

  provider.append(skin);
  skin.append(container);
  container.append(video);
  document.body.append(provider);

  return {
    provider,
    container,
    video,
    destroy() {
      provider.remove();
    },
  };
};

const 安装可写媒体状态 = (
  video: HTMLVideoElement,
  state: {
    currentSrc?: string;
    currentTime?: number;
    duration?: number;
    ended?: boolean;
    paused?: boolean;
    readyState?: number;
    seeking?: boolean;
  } = {}
) => {
  let currentTime = state.currentTime ?? 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    },
  });
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => state.duration ?? 60,
  });
  Object.defineProperty(video, "paused", {
    configurable: true,
    get: () => state.paused ?? false,
  });
  Object.defineProperty(video, "ended", {
    configurable: true,
    get: () => state.ended ?? false,
  });
  Object.defineProperty(video, "seeking", {
    configurable: true,
    get: () => state.seeking ?? false,
  });
  Object.defineProperty(video, "readyState", {
    configurable: true,
    get: () => state.readyState ?? HTMLMediaElement.HAVE_ENOUGH_DATA,
  });
  Object.defineProperty(video, "currentSrc", {
    configurable: true,
    get: () => state.currentSrc ?? "blob:http://media.local/current.mp4",
  });
  return {
    读取当前时间: () => currentTime,
  };
};

const 派发指针事件 = (target: Element, type: string, clientX: number): void => {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  }) as PointerEvent;
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  });
  target.dispatchEvent(event);
};

describe("Video.js 播放器壳", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("源码不再保留 hls.js / kind:hls / fallbackSrc / P2P HLS 增强入口", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../媒体/videojs播放器壳.ts"), "utf8");

    expect(source).not.toContain('kind: "hls"');
    expect(source).not.toContain("hls.js");
    expect(source).not.toContain("fallbackSrc");
    expect(source).not.toContain("挂接P2PHls增强层");
    expect(source).not.toContain("@videojs/html");
  });

  it("消息流 inline 表面不显示播放器壳 buffering 圆圈，等待态由隐藏预热和暂停帧承接", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../媒体/videojs播放器皮肤.ts"), "utf8");

    expect(source).toContain(':host([data-presentation="inline"]) media-buffering-indicator');
  });

  it("file/blob 首播不会请求第二播放器实现，也不会尝试加载 HLS provider", async () => {
    const createPlayer = vi.fn(() => 创建假播放器根());

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-file-lazy-1",
        posterSrc: "http://media.local/poster-file-lazy-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer,
        registerVideoJsElements: async () => undefined,
      }
    );

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();
  });

  it("移动端沉浸全屏里的横屏视频按视口宽度等比适配，不会被满高撑出窗口", async () => {
    const mount = document.createElement("div");
    mount.dataset.mediaViewerImmersive = "true";
    Object.defineProperty(mount, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 844,
        height: 844,
        left: 0,
        right: 390,
        top: 0,
        width: 390,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }),
    });
    document.body.append(mount);

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-immersive-landscape-1",
        posterSrc: null,
        width: 1920,
        height: 1080,
      },
      {
        mountTarget: mount,
        registerVideoJsElements: async () => undefined,
      }
    );
    const provider = mount.querySelector<HTMLElement>("video-player[data-player-shell='videojs']");
    const container = shell.读取容器元素();
    const video = shell.读取视频元素();

    expect(provider?.style.width).toBe("390px");
    expect(provider?.style.height).toBe("219.375px");
    expect(container.style.width).toBe("390px");
    expect(container.style.height).toBe("219.375px");
    expect(video.style.objectFit).toBe("contain");

    shell.destroy();
  });

  it("移动端沉浸全屏里的竖屏视频按视口高度等比适配，不会横向溢出", async () => {
    const mount = document.createElement("div");
    mount.dataset.mediaViewerImmersive = "true";
    Object.defineProperty(mount, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 390,
        height: 390,
        left: 0,
        right: 844,
        top: 0,
        width: 844,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }),
    });
    document.body.append(mount);

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-immersive-portrait-1",
        posterSrc: null,
        width: 1080,
        height: 1920,
      },
      {
        mountTarget: mount,
        registerVideoJsElements: async () => undefined,
      }
    );
    const provider = mount.querySelector<HTMLElement>("video-player[data-player-shell='videojs']");
    const container = shell.读取容器元素();

    expect(provider?.style.width).toBe("219.375px");
    expect(provider?.style.height).toBe("390px");
    expect(container.style.width).toBe("219.375px");
    expect(container.style.height).toBe("390px");

    shell.destroy();
  });

  it("同一个壳实例在两个 file 源之间同步时，不会重建第二套 overlay", async () => {
    const createPlayer = vi.fn(() => 创建假播放器根());
    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-file-1",
        posterSrc: "http://media.local/poster-file-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer,
        registerVideoJsElements: async () => undefined,
      }
    );

    shell.同步({
      kind: "file",
      src: "blob:http://media.local/videojs-file-2",
      posterSrc: "http://media.local/poster-file-2.jpg",
      width: 1280,
      height: 720,
    });

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();
  });

  it("唯一 Video.js 壳里的真实 video 默认启用循环播放", async () => {
    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-loop-1",
        posterSrc: "http://media.local/poster-loop-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => 创建假播放器根(),
        registerVideoJsElements: async () => undefined,
      }
    );

    expect(shell.读取视频元素().loop).toBe(true);

    shell.destroy();
  });

  it("播放器壳迁移后会重新绑定真实 video 事件，不让全屏 loading 圆圈卡成第二真相", async () => {
    const firstMount = document.createElement("div");
    const nextMount = document.createElement("div");
    document.body.append(firstMount, nextMount);

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-reconnect-1",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
      {
        mountTarget: firstMount,
        registerVideoJsElements: async () => undefined,
      }
    );
    const provider = firstMount.querySelector<HTMLElement>("video-player[data-player-shell='videojs']");
    const skin = provider?.querySelector<HTMLElement>("koko-video-skin");
    const shadowRoot = skin?.shadowRoot;
    const indicator = shadowRoot?.querySelector<HTMLElement>("media-buffering-indicator");
    const currentLabel = shadowRoot?.querySelector<HTMLElement>('media-time[type="current"]');
    const slider = shadowRoot?.querySelector<HTMLElement>("media-time-slider");
    expect(provider).not.toBeNull();
    expect(skin).not.toBeNull();
    expect(indicator).not.toBeNull();
    expect(currentLabel).not.toBeNull();
    expect(slider).not.toBeNull();

    const video = shell.读取视频元素();
    安装可写媒体状态(video, {
      currentTime: 12,
      duration: 60,
      paused: false,
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
    });
    indicator!.setAttribute("data-visible", "");

    provider!.remove();
    nextMount.append(provider!);
    video.dispatchEvent(new Event("timeupdate"));

    expect(currentLabel?.textContent).toBe("0:12");
    expect(slider?.style.getPropertyValue("--media-slider-fill")).toBe("20%");
    expect(indicator?.hasAttribute("data-visible")).toBe(false);

    shell.destroy();
  });

  it("全屏进度条支持按住拖拽连续 seek，而不是只能点击跳转", async () => {
    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-drag-seek-1",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
      {
        registerVideoJsElements: async () => undefined,
      }
    );
    const slider = document
      .querySelector("koko-video-skin")
      ?.shadowRoot?.querySelector<HTMLElement>("media-time-slider");
    expect(slider).not.toBeNull();
    Object.defineProperty(slider, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 244,
        height: 44,
        left: 100,
        right: 300,
        top: 200,
        width: 200,
        x: 100,
        y: 200,
        toJSON: () => undefined,
      }),
    });
    const state = 安装可写媒体状态(shell.读取视频元素(), {
      currentTime: 0,
      duration: 100,
      paused: false,
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
    });

    派发指针事件(slider!, "pointerdown", 125);
    派发指针事件(slider!, "pointermove", 250);
    派发指针事件(slider!, "pointerup", 250);

    expect(state.读取当前时间()).toBe(75);
    expect(slider?.style.getPropertyValue("--media-slider-fill")).toBe("75%");

    shell.destroy();
  });

  it("同一 swarm 相对路径重复同步时，不会因为 video.src 被浏览器绝对化而反复触发新 load", async () => {
    const root = 创建假播放器根();
    const 写入记录: string[] = [];
    let 当前原始地址 = "";
    Object.defineProperty(root.video, "src", {
      configurable: true,
      get() {
        return 当前原始地址
          ? new URL(当前原始地址, "http://127.0.0.1:8080/").href
          : "";
      },
      set(value: string) {
        当前原始地址 = value;
        写入记录.push(value);
      },
    });

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "/webtorrent/swarm-relative-1/content.bin",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => root,
        registerVideoJsElements: async () => undefined,
      }
    );

    shell.同步({
      kind: "file",
      src: "/webtorrent/swarm-relative-1/content.bin",
      posterSrc: null,
      width: 1280,
      height: 720,
    });

    expect(写入记录).toEqual(["/webtorrent/swarm-relative-1/content.bin"]);
    expect(root.video.src).toBe("http://127.0.0.1:8080/webtorrent/swarm-relative-1/content.bin");

    shell.destroy();
  });

  it("销毁播放器壳时会清空真实 video 的媒体源，让浏览器释放网络和解码资源", async () => {
    const root = 创建假播放器根();
    const pause = vi.fn();
    const load = vi.fn();
    Object.defineProperty(root.video, "pause", {
      configurable: true,
      value: pause,
    });
    Object.defineProperty(root.video, "load", {
      configurable: true,
      value: load,
    });

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-destroy-release-1",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => root,
        registerVideoJsElements: async () => undefined,
      }
    );

    shell.destroy();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(root.video.hasAttribute("src")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
