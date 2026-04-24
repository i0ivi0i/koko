// @vitest-environment happy-dom

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

describe("Video.js 播放器壳", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("file/blob 首播不会提前初始化 hls.js，只有切到 HLS 主链时才会加载 provider", async () => {
    const loadHlsConstructor = vi.fn(async () => {
      throw new Error("file 首播阶段不该提前加载 hls.js");
    });
    const 挂接P2PHls增强层 = vi.fn();

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-file-lazy-1",
        posterSrc: "http://media.local/poster-file-lazy-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => 创建假播放器根(),
        registerVideoJsElements: async () => undefined,
        loadHlsConstructor,
        挂接P2PHls增强层,
      }
    );

    expect(loadHlsConstructor).not.toHaveBeenCalled();
    expect(挂接P2PHls增强层).not.toHaveBeenCalled();

    shell.destroy();
  });

  it("同一个壳实例会按 source descriptor 在 file 与 HLS 之间同步，而不是重建第二套 overlay", async () => {
    const attachMedia = vi.fn();
    const loadSource = vi.fn();
    const destroyHls = vi.fn();

    class 假Hls构造器 {
      static isSupported() {
        return true;
      }

      attachMedia = attachMedia;
      loadSource = loadSource;
      destroy = destroyHls;
    }

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
        loadHlsConstructor: async () => 假Hls构造器 as never,
      }
    );

    shell.同步({
      kind: "hls",
      src: "http://media.local/stream/videojs-shell-1/master.m3u8",
      posterSrc: "http://media.local/poster-hls-1.jpg",
      width: 1280,
      height: 720,
    });
    await Promise.resolve();

    expect(attachMedia).toHaveBeenCalledTimes(1);
    expect(loadSource).toHaveBeenCalledWith(
      "http://media.local/stream/videojs-shell-1/master.m3u8"
    );
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();

    expect(destroyHls).toHaveBeenCalledTimes(1);
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

  it("同一壳实例 file 与 hls 之间同步时不会丢循环语义", async () => {
    const attachMedia = vi.fn();
    const loadSource = vi.fn();

    class 假Hls构造器 {
      static isSupported() {
        return true;
      }

      attachMedia = attachMedia;
      loadSource = loadSource;
      destroy = vi.fn();
    }

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-loop-sync-1",
        posterSrc: "http://media.local/poster-loop-sync-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => 创建假播放器根(),
        registerVideoJsElements: async () => undefined,
        loadHlsConstructor: async () => 假Hls构造器 as never,
      }
    );

    shell.同步({
      kind: "hls",
      src: "http://media.local/stream/videojs-loop-sync-1/master.m3u8",
      posterSrc: "http://media.local/poster-loop-sync-hls-1.jpg",
      width: 1280,
      height: 720,
    });
    await Promise.resolve();

    expect(shell.读取视频元素().loop).toBe(true);

    shell.destroy();
  });

  it("HLS 出现致命错误时会回退到 manifest 提供的文件冷源，且同源同步不会反复重试", async () => {
    const root = 创建假播放器根();
    const attachMedia = vi.fn();
    const loadSource = vi.fn();
    const destroyHls = vi.fn();

    class 假Hls构造器 {
      static Events = {
        ERROR: "error",
      } as const;
      static 最近实例: 假Hls构造器 | null = null;

      static isSupported() {
        return true;
      }

      private listeners = new Map<string, Array<(event: string, data: unknown) => void>>();
      attachMedia = attachMedia;
      loadSource = loadSource;
      destroy = destroyHls;

      constructor() {
        假Hls构造器.最近实例 = this;
      }

      on(event: string, handler: (event: string, data: unknown) => void): void {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
      }

      触发(event: string, data: unknown): void {
        for (const handler of this.listeners.get(event) ?? []) {
          handler(event, data);
        }
      }
    }

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "hls",
        src: "http://media.local/stream/videojs-fallback-1/master.m3u8",
        fallbackSrc: "http://media.local/original/videojs-fallback-1.mp4",
        posterSrc: "http://media.local/poster-videojs-fallback-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => root,
        registerVideoJsElements: async () => undefined,
        loadHlsConstructor: async () => 假Hls构造器 as never,
      }
    );

    await Promise.resolve();
    const 实例 = 假Hls构造器.最近实例;
    expect(实例).not.toBeNull();

    实例?.触发("error", {
      fatal: true,
      details: "manifestIncompatibleCodecsError",
    });

    expect(root.video.src).toBe("http://media.local/original/videojs-fallback-1.mp4");
    expect(destroyHls).toHaveBeenCalledTimes(1);

    shell.同步({
      kind: "hls",
      src: "http://media.local/stream/videojs-fallback-1/master.m3u8",
      fallbackSrc: "http://media.local/original/videojs-fallback-1.mp4",
      posterSrc: "http://media.local/poster-videojs-fallback-1.jpg",
      width: 1280,
      height: 720,
    });
    await Promise.resolve();

    expect(loadSource).toHaveBeenCalledTimes(1);
    expect(destroyHls).toHaveBeenCalledTimes(1);

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

  it("p2p-media-loader-hlsjs 只能作为壳外增强挂到 HLS provider，不进入 file/blob 首播必经路径", async () => {
    const attachMedia = vi.fn();
    const loadSource = vi.fn();
    const 挂接P2PHls增强层 = vi.fn();

    class 假Hls构造器 {
      static isSupported() {
        return true;
      }

      attachMedia = attachMedia;
      loadSource = loadSource;
      destroy = vi.fn();
    }

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-p2p-file-1",
        posterSrc: "http://media.local/poster-p2p-file-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => 创建假播放器根(),
        registerVideoJsElements: async () => undefined,
        loadHlsConstructor: async () => 假Hls构造器 as never,
        挂接P2PHls增强层,
      }
    );

    expect(挂接P2PHls增强层).not.toHaveBeenCalled();

    shell.同步({
      kind: "hls",
      src: "http://media.local/stream/videojs-p2p-1/master.m3u8",
      posterSrc: "http://media.local/poster-p2p-1.jpg",
      width: 1280,
      height: 720,
    });
    await Promise.resolve();

    expect(attachMedia).toHaveBeenCalledTimes(1);
    expect(loadSource).toHaveBeenCalledWith("http://media.local/stream/videojs-p2p-1/master.m3u8");
    expect(挂接P2PHls增强层).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();
  });

  it("壳外 P2P HLS 增强挂接失败时，HLS 首播仍然要继续，不允许把增强层变成必经主链", async () => {
    const attachMedia = vi.fn();
    const loadSource = vi.fn();
    const 挂接P2PHls增强层 = vi.fn(async () => {
      throw new Error("p2p enhancer should not block startup");
    });

    class 假Hls构造器 {
      static isSupported() {
        return true;
      }

      attachMedia = attachMedia;
      loadSource = loadSource;
      destroy = vi.fn();
    }

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "hls",
        src: "http://media.local/stream/videojs-p2p-startup-1/master.m3u8",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
      {
        createPlayer: () => 创建假播放器根(),
        registerVideoJsElements: async () => undefined,
        loadHlsConstructor: async () => 假Hls构造器 as never,
        挂接P2PHls增强层,
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(attachMedia).toHaveBeenCalledTimes(1);
    expect(loadSource).toHaveBeenCalledWith(
      "http://media.local/stream/videojs-p2p-startup-1/master.m3u8"
    );
    expect(挂接P2PHls增强层).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[koko:videojs-shell:p2p-enhancer]",
      expect.objectContaining({
        src: "http://media.local/stream/videojs-p2p-startup-1/master.m3u8",
      }),
      expect.any(Error)
    );
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();
  });

  it("native fullscreen 只是同一壳实例的展示策略，不创建第二个 video 元素", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const createPlayer = vi.fn(() => {
      const root = 创建假播放器根();
      Object.assign(root.container, { requestFullscreen });
      return root;
    });
    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-fullscreen-1",
        posterSrc: "http://media.local/poster-fullscreen-1.jpg",
        width: 720,
        height: 1280,
      },
      {
        createPlayer,
        registerVideoJsElements: async () => undefined,
      }
    );

    await shell.进入全屏();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);
  });

  it("缺少标准 Fullscreen API 时，播放器壳会退回 video 原生 webkit fullscreen", async () => {
    const createPlayer = vi.fn(() => {
      const root = 创建假播放器根();
      Object.assign(root.video, {
        webkitEnterFullscreen: vi.fn(),
      });
      return root;
    });
    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-overlay-only-1",
        posterSrc: "http://media.local/poster-overlay-only-1.jpg",
        width: 720,
        height: 1280,
      },
      {
        createPlayer,
        registerVideoJsElements: async () => undefined,
      }
    );

    await shell.进入全屏();

    const root = createPlayer.mock.results[0]?.value;
    expect(root?.video.webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll("video")).toHaveLength(1);

    shell.destroy();
  });

  it("默认根节点只从挂载盒子继承宽度，不在 provider 上再养第二套尺寸真相", async () => {
    const mountTarget = document.createElement("div");
    document.body.append(mountTarget);

    const shell = await 创建VideoJs播放器壳(
      {
        kind: "file",
        src: "blob:http://media.local/videojs-layout-1",
        posterSrc: "http://media.local/poster-layout-1.jpg",
        width: 1280,
        height: 720,
      },
      {
        mountTarget,
        registerVideoJsElements: async () => undefined,
      }
    );

    const provider = mountTarget.querySelector<HTMLElement>("video-player[data-player-shell='videojs']");
    expect(provider).not.toBeNull();
    expect(provider?.style.width).toBe("100%");
    expect(provider?.style.maxWidth).toBe("100%");
    expect(shell.读取容器元素().style.width).toBe("100%");
    expect(shell.读取容器元素().style.aspectRatio).toBe("1280 / 720");

    shell.destroy();
  });

  it("默认根节点使用 Koko 最小皮肤，不渲染快进快退与倍速控件", async () => {
    const shell = await 创建VideoJs播放器壳({
      kind: "file",
      src: "blob:http://media.local/videojs-koko-skin-1",
      posterSrc: "http://media.local/poster-koko-skin-1.jpg",
      width: 1280,
      height: 720,
    });

    const skin = document.body.querySelector<HTMLElement>("koko-video-skin");
    const shadowRoot = skin?.shadowRoot;
    const hotkeyActions = Array.from(shadowRoot?.querySelectorAll("media-hotkey") ?? []).map(
      (hotkey) => hotkey.getAttribute("action")
    );

    expect(skin).not.toBeNull();
    expect(shadowRoot?.querySelector("media-play-button")).not.toBeNull();
    expect(shadowRoot?.querySelector("media-time-slider")).not.toBeNull();
    expect(shadowRoot?.querySelector("media-mute-button")).not.toBeNull();
    expect(shadowRoot?.querySelector("media-fullscreen-button")).not.toBeNull();
    expect(shadowRoot?.querySelector("media-seek-button")).toBeNull();
    expect(shadowRoot?.querySelector("media-playback-rate-button")).toBeNull();
    expect(hotkeyActions).not.toContain("seekStep");
    expect(hotkeyActions).not.toContain("speedUp");
    expect(hotkeyActions).not.toContain("speedDown");

    shell.destroy();
  });

  it("默认 Video.js 根节点在 RemotePlayback 只给出非 Promise cancel 接口时，销毁也不能炸掉整个播放器会话", async () => {
    const shell = await 创建VideoJs播放器壳({
      kind: "file",
      src: "blob:http://media.local/videojs-remote-playback-compat-1",
      posterSrc: "http://media.local/poster-remote-playback-compat-1.jpg",
      width: 1280,
      height: 720,
    });

    expect(() => shell.destroy()).not.toThrow();
  });
});
