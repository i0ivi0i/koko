import { describe, expect, it, vi } from "vitest";
import { 从媒体源抓取视频预览, 派生视频预览 } from "../媒体/视频预览.js";

type 视频探针桩配置 = {
  // true 时模拟 RVFC 挂起（已注册但永不回调），用于复现黑框超时问题。
  rvfc永不回调?: boolean;
  // true 时模拟 RVFC 正常回调，用来验证修复后不会误伤原有快路径。
  rvfc立即回调?: boolean;
};

const 创建视频探针桩 = (配置: 视频探针桩配置 = {}): HTMLVideoElement => {
  let currentTime = 0;
  const probe = {
    preload: "",
    muted: false,
    playsInline: false,
    readyState: 4,
    duration: 8,
    videoWidth: 1280,
    videoHeight: 720,
    onloadedmetadata: null as (() => void) | null,
    onloadeddata: null as (() => void) | null,
    onseeked: null as (() => void) | null,
    onerror: null as (() => void) | null,
    src: "",
    load: () => {
      setTimeout(() => {
        probe.onloadedmetadata?.();
        probe.onloadeddata?.();
      }, 0);
    },
    requestVideoFrameCallback: ((callback: () => void) => {
      if (配置.rvfc立即回调) {
        setTimeout(() => callback(), 0);
      }
      return 1;
    }) as unknown as HTMLVideoElement["requestVideoFrameCallback"],
  };

  Object.defineProperty(probe, "currentTime", {
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      setTimeout(() => {
        probe.onseeked?.();
      }, 0);
    },
    configurable: true,
  });

  return probe as unknown as HTMLVideoElement;
};

const 创建画布桩 = (): HTMLCanvasElement =>
  ({
    width: 0,
    height: 0,
    getContext: () =>
      ({
        drawImage: () => undefined,
      }) as unknown as CanvasRenderingContext2D,
    toDataURL: () => "data:image/webp;base64,preview",
  }) as unknown as HTMLCanvasElement;

describe("视频预览", () => {
  it("命中 embedded hint 时会立刻返回 preview，不再等待 playback owner", async () => {
    const deriveEarlyFrame = vi.fn(async () => null);
    const captureDecodedFrame = vi.fn(async () => null);

    const result = await 派生视频预览({
      attachmentId: "att-video-preview-1",
      contentHash: "hash-video-preview-1",
      embeddedHint: {
        objectUrl: "blob:embedded-preview-1",
        width: 320,
        height: 180,
      },
      canDecode: async () => true,
      deriveEarlyFrame,
      captureDecodedFrame,
    });

    expect(result).toMatchObject({
      source: "embedded_hint",
      objectUrl: "blob:embedded-preview-1",
      width: 320,
      height: 180,
    });
    expect(deriveEarlyFrame).not.toHaveBeenCalled();
    expect(captureDecodedFrame).not.toHaveBeenCalled();
  });

  it("没有任何 source bytes 时会明确返回 none，而不是偷读 original", async () => {
    const result = await 派生视频预览({
      attachmentId: "att-video-preview-2",
      contentHash: "hash-video-preview-2",
      embeddedHint: null,
      canDecode: async () => false,
      deriveEarlyFrame: vi.fn(async () => null),
      captureDecodedFrame: vi.fn(async () => null),
    });

    expect(result).toMatchObject({
      source: "none",
      objectUrl: null,
    });
  });

  it("RVFC 不回调时会自动降级为 early_frame，而不是超时返回 none", async () => {
    const result = await 从媒体源抓取视频预览({
      src: "blob:video-preview-fallback",
      timeoutMs: 500,
      createProbeElement: () => 创建视频探针桩({ rvfc永不回调: true }),
      createCanvasElement: 创建画布桩,
    });

    expect(result.source).toBe("early_frame");
    expect(result.objectUrl).toContain("data:image/webp");
  });

  it("RVFC 正常回调时仍优先走 rvfc 路径", async () => {
    const result = await 从媒体源抓取视频预览({
      src: "blob:video-preview-rvfc",
      timeoutMs: 500,
      createProbeElement: () => 创建视频探针桩({ rvfc立即回调: true }),
      createCanvasElement: 创建画布桩,
    });

    expect(result.source).toBe("rvfc");
    expect(result.objectUrl).toContain("data:image/webp");
  });

  it("附件退场中止隐藏抓帧探针时，会主动 pause + remove src + load 释放旧源", async () => {
    const abortController = new AbortController();
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const load = vi.fn();
    const probe = {
      preload: "",
      muted: false,
      playsInline: false,
      readyState: 0,
      duration: 0,
      videoWidth: 0,
      videoHeight: 0,
      onloadedmetadata: null as (() => void) | null,
      onloadeddata: null as (() => void) | null,
      onseeked: null as (() => void) | null,
      onerror: null as (() => void) | null,
      src: "",
      pause,
      removeAttribute,
      load,
    } as unknown as HTMLVideoElement;

    const resultPromise = 从媒体源抓取视频预览({
      src: "blob:video-preview-abort",
      signal: abortController.signal,
      timeoutMs: 500,
      createProbeElement: () => probe,
    });

    abortController.abort();
    const result = await resultPromise;

    expect(result).toEqual({
      objectUrl: null,
      source: "none",
      width: null,
      height: null,
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(removeAttribute).toHaveBeenCalledWith("src");
    /**
     * 第一次 `load()` 是真正开始抓帧，第二次 `load()` 是退场清理时显式要求浏览器放弃旧源。
     */
    expect(load).toHaveBeenCalledTimes(2);
  });
});
