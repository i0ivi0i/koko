import { describe, expect, it, vi } from "vitest";
import {
  可选择视频文件类型,
  从视频探针导出静态预览图,
  读取视频文件元数据,
  解析视频元数据失败代码,
  视频附件上传上限字节数,
} from "../媒体/视频元数据";

type 假视频探针 = {
  preload: string;
  src: string;
  readyState?: number;
  videoWidth: number;
  videoHeight: number;
  duration: number;
  currentTime: number;
  onloadedmetadata: null | (() => void);
  onloadeddata?: null | (() => void);
  onseeked?: null | (() => void);
  onerror: null | (() => void);
  load(): void;
};

function 创建成功探针(): 假视频探针 {
  const probe: 假视频探针 = {
    preload: "",
    src: "",
    readyState: 1,
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 12.5,
    currentTime: 0,
    onloadedmetadata: null,
    onloadeddata: null,
    onseeked: null,
    onerror: null,
    load() {
      this.onloadedmetadata?.();
      this.readyState = 2;
      this.onloadeddata?.();
    },
  };
  let 内部当前时间 = 0;
  Object.defineProperty(probe, "currentTime", {
    configurable: true,
    get() {
      return 内部当前时间;
    },
    set(value: number) {
      内部当前时间 = value;
      probe.onseeked?.();
    },
  });
  return probe;
}

describe("视频元数据", () => {
  it("能从探针读取稳定的宽高和时长", async () => {
    const revokeObjectUrl = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    const result = await 读取视频文件元数据(file, {
      createObjectUrl: () => "blob:clip.mp4",
      revokeObjectUrl,
      createProbeElement: () => 创建成功探针() as unknown as HTMLVideoElement,
    });

    expect(result).toEqual({
      width: 1920,
      height: 1080,
      durationSeconds: 12.5,
      previewUrl: null,
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:clip.mp4");
  });

  it("探针失败时会归一成稳定错误码", () => {
    const errorCode = 解析视频元数据失败代码(new Error("NotSupportedError"));

    expect(errorCode).toBe("attachment_type_not_allowed");
  });

  it("探针长时间没有返回时会超时清理并归一成稳定失败", async () => {
    vi.useFakeTimers();
    const revokeObjectUrl = vi.fn();
    const file = new File([new Uint8Array([1, 2, 3])], "slow.mp4", {
      type: "video/mp4",
    });
    const pendingProbe: 假视频探针 = {
      preload: "",
      src: "",
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
      duration: 0,
      currentTime: 0,
      onloadedmetadata: null,
      onloadeddata: null,
      onseeked: null,
      onerror: null,
      load() {
        // 故意不回调，模拟某些浏览器/相册代理文件长时间挂住。
      },
    };
    try {
      const promise = 读取视频文件元数据(file, {
        createObjectUrl: () => "blob:slow.mp4",
        revokeObjectUrl,
        createProbeElement: () => pendingProbe as unknown as HTMLVideoElement,
        timeoutMs: 25,
      });
      const 失败断言 = expect(promise).rejects.toThrow("attachment_upload_failed");

      await vi.advanceTimersByTimeAsync(26);

      await 失败断言;
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:slow.mp4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("首帧预览会等待可解码画面并采样非零时间点，避免 0 秒黑帧直接当作发送封面", async () => {
    const revokeObjectUrl = vi.fn();
    const drawImage = vi.fn();
    const toDataUrl = vi.fn(() => "data:image/webp;base64,preview-frame");
    const file = new File([new Uint8Array([1, 2, 3])], "cover.mp4", {
      type: "video/mp4",
    });
    const probe = 创建成功探针();
    probe.readyState = 0;
    let 内部当前时间 = 0;
    Object.defineProperty(probe, "currentTime", {
      configurable: true,
      get() {
        return 内部当前时间;
      },
      set(value: number) {
        内部当前时间 = value;
        probe.onseeked?.();
      },
    });
    probe.load = function () {
      this.onloadedmetadata?.();
      this.readyState = 2;
      this.onloadeddata?.();
    };

    const result = await 读取视频文件元数据(file, {
      createObjectUrl: () => "blob:cover.mp4",
      revokeObjectUrl,
      createProbeElement: () => probe as unknown as HTMLVideoElement,
      createCanvasElement: () =>
        ({
          width: 0,
          height: 0,
          getContext: () =>
            ({
              drawImage,
            }) as unknown as CanvasRenderingContext2D,
          toDataURL: toDataUrl,
        }) as unknown as HTMLCanvasElement,
    });

    expect(result).toEqual({
      width: 1920,
      height: 1080,
      durationSeconds: 12.5,
      previewUrl: "data:image/webp;base64,preview-frame",
    });
    expect(内部当前时间).toBeGreaterThan(0);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(toDataUrl).toHaveBeenCalledWith("image/webp", 0.92);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:cover.mp4");
  });

  it("静态预览导出会按应用级封面尺寸降采样，避免 4K 帧转成巨大 dataURL 卡住消息流", () => {
    const drawImage = vi.fn();
    const toDataUrl = vi.fn(() => "data:image/webp;base64,preview-frame");
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        ({
          drawImage,
        }) as unknown as CanvasRenderingContext2D,
      toDataURL: toDataUrl,
    } as unknown as HTMLCanvasElement;

    const result = 从视频探针导出静态预览图(
      {
        videoWidth: 3840,
        videoHeight: 2160,
      } as HTMLVideoElement,
      {
        createCanvasElement: () => canvas,
      }
    );

    expect(result).toBe("data:image/webp;base64,preview-frame");
    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(540);
    expect(drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 960, 540);
  });

  it("浏览器不支持 WebP 导出时会返回空预览，避免回落成非 WebP 图片", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "fallback-format.mp4", {
      type: "video/mp4",
    });

    const result = await 读取视频文件元数据(file, {
      createObjectUrl: () => "blob:fallback-format.mp4",
      revokeObjectUrl: vi.fn(),
      createProbeElement: () => 创建成功探针() as unknown as HTMLVideoElement,
      createCanvasElement: () =>
        ({
          width: 0,
          height: 0,
          getContext: () =>
            ({
              drawImage: vi.fn(),
            }) as unknown as CanvasRenderingContext2D,
          // 模拟浏览器把 toDataURL('image/webp') 悄悄回退成 data:image/png。
          toDataURL: vi.fn(() => "data:image/png;base64,legacy-fallback"),
        }) as unknown as HTMLCanvasElement,
    });

    expect(result.previewUrl).toBeNull();
  });

  it("导出的视频 accept 类型保持稳定", () => {
    expect(可选择视频文件类型).toEqual(["video/*"]);
  });

  it("导出的视频大小上限保持 200MB", () => {
    expect(视频附件上传上限字节数).toBe(200 * 1024 * 1024);
  });
});
