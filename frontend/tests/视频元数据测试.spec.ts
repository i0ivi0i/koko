import { describe, expect, it, vi } from "vitest";
import {
  可选择视频文件类型,
  读取视频文件元数据,
  解析视频元数据失败代码,
  视频附件上传上限字节数,
} from "../媒体/视频元数据";

type 假视频探针 = {
  preload: string;
  src: string;
  videoWidth: number;
  videoHeight: number;
  duration: number;
  onloadedmetadata: null | (() => void);
  onerror: null | (() => void);
  load(): void;
};

function 创建成功探针(): 假视频探针 {
  return {
    preload: "",
    src: "",
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 12.5,
    onloadedmetadata: null,
    onerror: null,
    load() {
      this.onloadedmetadata?.();
    },
  };
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
      videoWidth: 0,
      videoHeight: 0,
      duration: 0,
      onloadedmetadata: null,
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

  it("导出的视频 accept 类型保持稳定", () => {
    expect(可选择视频文件类型).toEqual(["video/*"]);
  });

  it("导出的视频大小上限保持 200MB", () => {
    expect(视频附件上传上限字节数).toBe(200 * 1024 * 1024);
  });
});
