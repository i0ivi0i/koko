import { describe, expect, it } from "vitest";
import { 创建内存预览缓存 } from "../媒体/预览缓存.js";

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
});
