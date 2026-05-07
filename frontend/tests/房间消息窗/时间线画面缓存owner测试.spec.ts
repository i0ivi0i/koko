// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放位置 } from "../../媒体/媒体播放";
import { 时间线画面缓存Owner } from "../../房间消息窗/时间线画面缓存";

const 创建Owner = () => {
  const 请求刷新 = vi.fn();
  const owner = new 时间线画面缓存Owner({
    读取视频当前播放源: (video) => video.currentSrc || video.getAttribute("src"),
    归一化时间线视频播放源: (src) =>
      src ? new URL(src, "http://media.local/room/").href : null,
    读取预览状态: () => null,
    请求刷新,
  });
  return { owner, 请求刷新 };
};

describe("时间线画面缓存Owner", () => {
  it("首帧 ready 只按附件和归一化同源 src 命中", () => {
    const { owner, 请求刷新 } = 创建Owner();

    owner.标记首帧已就绪("att-1", "/swarm/video.mp4");

    expect(owner.读取首帧是否就绪("att-1", "http://media.local/swarm/video.mp4")).toBe(
      true
    );
    expect(owner.读取首帧是否就绪("att-1", "/swarm/other.mp4")).toBe(false);
    expect(owner.读取已就绪首帧预览源("att-1")).toBe(
      "http://media.local/swarm/video.mp4"
    );
    expect(请求刷新).toHaveBeenCalledOnce();
  });

  it("同源同位置冻结帧才能承接时间线预览", () => {
    const { owner } = 创建Owner();
    const position: 媒体播放位置 = {
      src: "http://media.local/swarm/video.mp4",
      currentTime: 12,
      updatedAt: 1,
    };

    (
      owner as unknown as {
        时间线自动播冻结帧: Map<
          string,
          { src: string; currentTime: number; dataUrl: string; updatedAt: number }
        >;
      }
    ).时间线自动播冻结帧.set("att-1", {
      src: "/swarm/video.mp4",
      currentTime: 12.2,
      dataUrl: "data:image/webp;base64,freeze",
      updatedAt: 2,
    });

    expect(
      owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", position)?.dataUrl
    ).toBe("data:image/webp;base64,freeze");
    expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
      ...position,
      currentTime: 20,
    })).toBeNull();
    expect(owner.读取自动播冻结帧("att-1", "/swarm/other.mp4", position)).toBeNull();
  });

  it("无续播位置时，最近同源冻结帧仍可短暂承接进入 owner 的连续表面", () => {
    const { owner } = 创建Owner();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));

      (
        owner as unknown as {
          时间线自动播冻结帧: Map<
            string,
            { src: string; currentTime: number; dataUrl: string; updatedAt: number }
          >;
        }
      ).时间线自动播冻结帧.set("att-1", {
        src: "/swarm/video.mp4",
        currentTime: 12.2,
        dataUrl: "data:image/webp;base64,freeze",
        updatedAt: Date.now() - 1_000,
      });

      expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", null)?.dataUrl).toBe(
        "data:image/webp;base64,freeze"
      );

      vi.setSystemTime(new Date("2026-05-07T12:00:06.000Z"));
      expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", null)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("预热冻结帧会等到 requestVideoFrameCallback 确认已合成那一帧后再写入缓存", async () => {
    const { owner } = 创建Owner();
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["freeze"], { type: "image/webp" }));
    });
    const callbacks: Array<() => void> = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob,
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

    class 假FileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(): void {
        this.result = "data:image/webp;base64,warm-freeze";
        queueMicrotask(() =>
          this.onload?.(undefined as unknown as ProgressEvent<FileReader>)
        );
      }
    }

    const video = {
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      currentTime: 18.5,
      currentSrc: "http://media.local/swarm/video.mp4",
      getAttribute: (name: string) => (name === "src" ? "http://media.local/swarm/video.mp4" : null),
      requestVideoFrameCallback: ((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }) as unknown as HTMLVideoElement["requestVideoFrameCallback"],
    } as unknown as HTMLVideoElement;

    vi.stubGlobal("FileReader", 假FileReader);

    try {
      owner.捕获自动播冻结帧("att-1", video, { 预热已合成帧: true });
      expect(drawImage).not.toHaveBeenCalled();
      expect(callbacks).toHaveLength(1);

      callbacks[0]!();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(
        owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
          src: "http://media.local/swarm/video.mp4",
          currentTime: 18.5,
          updatedAt: 1,
        })
      ).toMatchObject({
        dataUrl: "data:image/webp;base64,warm-freeze",
      });
    } finally {
      createElement.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
