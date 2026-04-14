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
      }
    );

    expect(loadHlsConstructor).not.toHaveBeenCalled();

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
});
