// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放位置 } from "../../媒体/媒体播放";
import { 时间线画面缓存Owner } from "../../房间消息窗/时间线画面缓存";

const 创建Owner = (input: { scopeKey?: string } = {}) => {
  const 请求刷新 = vi.fn();
  const owner = new 时间线画面缓存Owner({
    读取视频当前播放源: (video) => video.currentSrc || video.getAttribute("src"),
    归一化时间线视频播放源: (src) =>
      src ? new URL(src, "http://media.local/room/").href : null,
    读取预览状态: () => null,
    读取暖状态范围键: () => input.scopeKey ?? null,
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
          {
            src: string;
            currentTime: number;
            bitmap: CanvasImageSource;
            width: number;
            height: number;
            updatedAt: number;
            dispose(): void;
          }
        >;
      }
    ).时间线自动播冻结帧.set("att-1", {
      src: "/swarm/video.mp4",
      currentTime: 12.2,
      bitmap: document.createElement("canvas"),
      width: 320,
      height: 180,
      updatedAt: 2,
      dispose: vi.fn(),
    });

    expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", position)?.width).toBe(320);
    expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
      ...position,
      currentTime: 20,
    })?.width).toBe(320);
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
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        }
      ).时间线自动播冻结帧.set("att-1", {
        src: "/swarm/video.mp4",
        currentTime: 12.2,
        bitmap: document.createElement("canvas"),
        width: 320,
        height: 180,
        updatedAt: Date.now() - 1_000,
        dispose: vi.fn(),
      });

      expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", null)?.width).toBe(320);

      vi.setSystemTime(new Date("2026-05-07T12:00:06.000Z"));
      expect(owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", null)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("预热冻结帧会等到 requestVideoFrameCallback 确认已合成那一帧后再写入缓存", async () => {
    const { owner } = 创建Owner();
    const drawImage = vi.fn();
    const callbacks: Array<() => void> = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn(),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

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

    try {
      owner.捕获自动播冻结帧("att-1", video, { 预热已合成帧: true });
      expect(drawImage).not.toHaveBeenCalled();
      expect(callbacks).toHaveLength(1);

      callbacks[0]!();

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(canvas.toBlob).not.toHaveBeenCalled();
      expect(canvas.toDataURL).not.toHaveBeenCalled();
      expect(
        owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
          src: "http://media.local/swarm/video.mp4",
          currentTime: 18.5,
          updatedAt: 1,
        })
      ).toMatchObject({
        bitmap: canvas,
      });
    } finally {
      createElement.mockRestore();
    }
  });

  it("退场即时冻结帧会同步写入内存桥接帧，不能再退回同步 dataUrl 编码", () => {
    const { owner, 请求刷新 } = 创建Owner();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn(),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });
    const video = {
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      currentTime: 22.25,
      currentSrc: "http://media.local/swarm/video.mp4",
      getAttribute: (name: string) => (name === "src" ? "http://media.local/swarm/video.mp4" : null),
    } as unknown as HTMLVideoElement;

    try {
      owner.捕获自动播冻结帧("att-1", video, { 立即提交: true });

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(canvas.toDataURL).not.toHaveBeenCalled();
      expect(canvas.toBlob).not.toHaveBeenCalled();
      expect(请求刷新).toHaveBeenCalledOnce();
      expect(
        owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
          src: "http://media.local/swarm/video.mp4",
          currentTime: 22.25,
          updatedAt: 1,
        })
      ).toMatchObject({
        bitmap: canvas,
      });
    } finally {
      createElement.mockRestore();
    }
  });

  it("预热路径会链式调度 rVFC，让 Map 持续追踪屏幕实际显示帧（消除退场跳帧）", () => {
    const { owner } = 创建Owner();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn(),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

    const callbacks: Array<() => void> = [];
    let currentTime = 10.0;
    const dataset = { attachmentId: "att-1" } as DOMStringMap;
    const video = {
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      isConnected: true,
      get currentTime() {
        return currentTime;
      },
      currentSrc: "http://media.local/swarm/video.mp4",
      getAttribute: (name: string) =>
        name === "src" ? "http://media.local/swarm/video.mp4" : null,
      dataset,
      requestVideoFrameCallback: ((cb: () => void) => {
        callbacks.push(cb);
        return callbacks.length;
      }) as unknown as HTMLVideoElement["requestVideoFrameCallback"],
    } as unknown as HTMLVideoElement;

    try {
      owner.捕获自动播冻结帧("att-1", video, { 预热已合成帧: true });
      expect(callbacks).toHaveLength(1);
      expect(drawImage).not.toHaveBeenCalled();

      // 第一帧 rVFC 触发：执行捕获 + 链式调度下一次 rVFC
      callbacks[0]!();
      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(callbacks).toHaveLength(2);

      // 第二帧推进
      currentTime = 10.0167;
      callbacks[1]!();
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(callbacks).toHaveLength(3);

      // video 暂停后链式应停止
      currentTime = 10.0334;
      (video as { paused: boolean }).paused = true;
      callbacks[2]!();
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(callbacks).toHaveLength(3);
    } finally {
      createElement.mockRestore();
    }
  });

  it("立即提交在 Map 已有最近同源帧时直接复用，不再 drawImage（避免退场 decoder buffer 偏移）", () => {
    const { owner, 请求刷新 } = 创建Owner();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn(),
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const 原始创建元素 = document.createElement.bind(document);
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return 原始创建元素(tagName);
    });

    const existingBitmap = document.createElement("canvas");
    (
      owner as unknown as {
        时间线自动播冻结帧: Map<
          string,
          {
            src: string;
            currentTime: number;
            bitmap: CanvasImageSource;
            width: number;
            height: number;
            updatedAt: number;
            dispose(): void;
          }
        >;
      }
    ).时间线自动播冻结帧.set("att-1", {
      src: "http://media.local/swarm/video.mp4",
      currentTime: 22.0,
      bitmap: existingBitmap,
      width: 320,
      height: 180,
      updatedAt: Date.now(),
      dispose: vi.fn(),
    });
    请求刷新.mockClear();

    const video = {
      readyState: HTMLMediaElement.HAVE_ENOUGH_DATA,
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      currentTime: 22.0167,
      currentSrc: "http://media.local/swarm/video.mp4",
      getAttribute: (name: string) =>
        name === "src" ? "http://media.local/swarm/video.mp4" : null,
    } as unknown as HTMLVideoElement;

    try {
      owner.捕获自动播冻结帧("att-1", video, { 立即提交: true });

      expect(drawImage).not.toHaveBeenCalled();
      expect(请求刷新).toHaveBeenCalledOnce();
      // Map 中仍是原 bitmap（未被覆盖）
      expect(
        owner.读取自动播冻结帧("att-1", "/swarm/video.mp4", {
          src: "http://media.local/swarm/video.mp4",
          currentTime: 22.0,
          updatedAt: 1,
        })?.bitmap
      ).toBe(existingBitmap);
    } finally {
      createElement.mockRestore();
    }
  });

  it("同源短时重进时，新实例仍能读到旧实例导出的首帧与冻结帧", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
      const { owner: oldOwner } = 创建Owner({ scopeKey: "room-retained-1" });
      const retainedBitmap = document.createElement("canvas");
      oldOwner.标记首帧已就绪("att-retained-1", "/swarm/retained.mp4");
      (
        oldOwner as unknown as {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        }
      ).时间线自动播冻结帧.set("att-retained-1", {
        src: "/swarm/retained.mp4",
        currentTime: 8.5,
        bitmap: retainedBitmap,
        width: 320,
        height: 180,
        updatedAt: Date.now(),
        dispose: vi.fn(),
      });

      oldOwner.清空();

      const { owner: newOwner } = 创建Owner({ scopeKey: "room-retained-1" });
      expect(
        newOwner.读取首帧是否就绪("att-retained-1", "http://media.local/swarm/retained.mp4")
      ).toBe(true);
      expect(newOwner.读取已就绪首帧预览源("att-retained-1")).toBeNull();
      expect(
        newOwner.读取自动播冻结帧("att-retained-1", "/swarm/retained.mp4", {
          src: "http://media.local/swarm/retained.mp4",
          currentTime: 8.6,
          updatedAt: Date.now(),
        })
      ).toMatchObject({
        bitmap: retainedBitmap,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("导出的短时冻结帧过期后会释放资源，新实例也不能继续复用", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
      const dispose = vi.fn();
      const { owner: oldOwner } = 创建Owner({ scopeKey: "room-retained-expired-1" });
      (
        oldOwner as unknown as {
          时间线自动播冻结帧: Map<
            string,
            {
              src: string;
              currentTime: number;
              bitmap: CanvasImageSource;
              width: number;
              height: number;
              updatedAt: number;
              dispose(): void;
            }
          >;
        }
      ).时间线自动播冻结帧.set("att-retained-expired-1", {
        src: "/swarm/retained-expired.mp4",
        currentTime: 5.5,
        bitmap: document.createElement("canvas"),
        width: 320,
        height: 180,
        updatedAt: Date.now(),
        dispose,
      });

      oldOwner.清空();
      vi.setSystemTime(new Date("2026-05-07T12:00:03.000Z"));
      const { owner: newOwner } = 创建Owner({ scopeKey: "room-retained-expired-1" });

      expect(
        newOwner.读取自动播冻结帧("att-retained-expired-1", "/swarm/retained-expired.mp4", null)
      ).toBeNull();
      expect(
        newOwner.读取首帧是否就绪(
          "att-retained-expired-1",
          "http://media.local/swarm/retained-expired.mp4"
        )
      ).toBe(false);
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
