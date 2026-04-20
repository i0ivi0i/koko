import { describe, expect, it, vi } from "vitest";
import { 预处理待上传视频文件 } from "../媒体/视频预处理";

describe("视频预处理", () => {
  it("已经可直通的视频会原样作为 canonical 上传文件", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "ready.mp4", {
      type: "video/mp4",
    });
    const deps = {
      可直通: vi.fn(async () => true),
      Mediabunny可无损整理: vi.fn(async () => false),
      使用Mediabunny无损整理: vi.fn(),
      Mediabunny与WebCodecs可转码: vi.fn(async () => false),
      使用Mediabunny与WebCodecs转码: vi.fn(),
    };

    const result = await 预处理待上传视频文件(file, deps);

    expect(result).toEqual({ file, strategy: "passthrough" });
    expect(deps.Mediabunny可无损整理).not.toHaveBeenCalled();
  });

  it("不可直通时优先用 Mediabunny 无损整理而不是直接落到 ffmpeg.wasm", async () => {
    const source = new File([new Uint8Array([1, 2, 3])], "camera.mov", {
      type: "video/quicktime",
    });
    const canonical = new File([new Uint8Array([1, 2, 3])], "canonical.mp4", {
      type: "video/mp4",
    });
    const deps = {
      可直通: vi.fn(async () => false),
      Mediabunny可无损整理: vi.fn(async () => true),
      使用Mediabunny无损整理: vi.fn(async () => ({
        file: canonical,
        strategy: "mediabunny_remux" as const,
      })),
      Mediabunny与WebCodecs可转码: vi.fn(async () => true),
      使用Mediabunny与WebCodecs转码: vi.fn(),
    };

    const result = await 预处理待上传视频文件(source, deps);

    expect(result.file).toBe(canonical);
    expect(result.strategy).toBe("mediabunny_remux");
    expect(deps.使用Mediabunny与WebCodecs转码).not.toHaveBeenCalled();
  });

  it("Mediabunny 两条链都不可用时会直接失败，而不是继续探测未接线兜底", async () => {
    const source = new File([new Uint8Array([1, 2, 3])], "camera.mov", {
      type: "video/quicktime",
    });
    const deps = {
      可直通: vi.fn(async () => false),
      Mediabunny可无损整理: vi.fn(async () => false),
      使用Mediabunny无损整理: vi.fn(),
      Mediabunny与WebCodecs可转码: vi.fn(async () => false),
      使用Mediabunny与WebCodecs转码: vi.fn(),
    };

    await expect(预处理待上传视频文件(source, deps)).rejects.toThrow(
      "media_preprocess_failed"
    );
    expect(deps.使用Mediabunny无损整理).not.toHaveBeenCalled();
    expect(deps.使用Mediabunny与WebCodecs转码).not.toHaveBeenCalled();
  });
});
