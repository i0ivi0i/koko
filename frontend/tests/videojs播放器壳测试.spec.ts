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
