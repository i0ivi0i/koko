import { describe, expect, it, vi } from "vitest";
import { 创建浏览器预览缓存, 创建内存预览缓存 } from "../媒体/预览缓存.js";

describe("预览缓存", () => {
  it("以 content_hash 为主键复用，不因 attachmentId 变化重复派生", async () => {
    const cache = 创建内存预览缓存();

    await cache.写入附件索引("att-video-1", "hash-preview-1");
    await cache.保存({
      contentHash: "hash-preview-1",
      objectUrl: "blob:preview-hash-1",
      source: "early_frame",
      width: 320,
      height: 180,
      updatedAt: 1,
    });
    await cache.写入附件索引("att-video-2", "hash-preview-1");

    expect(await cache.按内容读取("hash-preview-1")).toMatchObject({
      objectUrl: "blob:preview-hash-1",
    });
    expect(await cache.按附件读取("att-video-2")).toMatchObject({
      contentHash: "hash-preview-1",
      objectUrl: "blob:preview-hash-1",
    });
  });

  it("浏览器预览缓存会复用已解析快照，避免滚动时反复解析巨大 dataURL", async () => {
    const records = JSON.stringify({
      "hash-preview-1": {
        objectUrl: `data:image/webp;base64,${"a".repeat(8192)}`,
        source: "early_frame",
        width: 960,
        height: 540,
        updatedAt: 1,
      },
    });
    const getItem = vi.fn((key: string) =>
      key === "koko_video_preview_records" ? records : null
    );
    const setItem = vi.fn();
    const cache = 创建浏览器预览缓存({ getItem, setItem });

    expect(await cache.按内容读取("hash-preview-1")).toMatchObject({
      objectUrl: expect.stringContaining("data:image/webp"),
    });
    expect(await cache.按内容读取("hash-preview-1")).toMatchObject({
      width: 960,
      height: 540,
    });

    expect(getItem).toHaveBeenCalledTimes(1);
  });
});
