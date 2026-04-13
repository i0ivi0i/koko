import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器 } from "../媒体/媒体播放";

describe("Blob 媒体资产", () => {
  it("图片定位结果返回 blob_asset 时，会先给 preview，再把查看器主链指向 full", async () => {
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-image-blob-1",
        kind: "image" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-image-blob-1",
        thumbnail_url: "http://media.local/legacy-thumb-image-blob-1",
        distribution: null,
        streaming_asset: null,
        blob_asset: {
          asset_id: "att-image-blob-1",
          content_hash: "hash-image-blob-1",
          kind: "blob_image" as const,
          preview: {
            id: "preview",
            mime_type: "image/webp",
            url: "http://media.local/blob/att-image-blob-1/preview.webp",
            width: 320,
            height: 213,
          },
          full: {
            id: "full",
            mime_type: "image/webp",
            url: "http://media.local/blob/att-image-blob-1/full.webp",
            width: 1200,
            height: 800,
          },
          original: {
            id: "original",
            mime_type: "image/png",
            url: "http://media.local/blob/att-image-blob-1/original.png",
            width: 1200,
            height: 800,
          },
          distribution: {
            swarm_id: "swarm-hash-image-blob-1",
            announce_urls: ["wss://tracker.koko.local/announce"],
            web_seed_url: "http://media.local/blob/att-image-blob-1/original.png",
            join_ticket: null,
          },
          origin: {
            original_url: "http://media.local/legacy-original-image-blob-1",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
      }),
      resolveSwarmSource: async () => null,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-image-blob-1",
      kind: "image",
    });

    expect(result).toEqual({
      mode: "blob",
      attachmentId: "att-image-blob-1",
      kind: "image",
      src: "http://media.local/blob/att-image-blob-1/preview.webp",
      viewerSrc: "http://media.local/blob/att-image-blob-1/full.webp",
      thumbnailUrl: "http://media.local/blob/att-image-blob-1/preview.webp",
      hint: null,
    });
    expect(probeAnchor).not.toHaveBeenCalled();
  });
});
