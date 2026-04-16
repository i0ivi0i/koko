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
            url: "http://media.local/api/media/att-image-blob-1/blob/preview?session_id=s-1",
            width: 320,
            height: 213,
          },
          full: {
            id: "full",
            mime_type: "image/webp",
            url: "http://media.local/api/media/att-image-blob-1/blob/full?session_id=s-1",
            width: 1200,
            height: 800,
          },
          original: {
            id: "original",
            mime_type: "image/png",
            url: "http://media.local/api/media/att-image-blob-1/blob/original?session_id=s-1",
            width: 1200,
            height: 800,
          },
          distribution: {
            swarm_id: "swarm-hash-image-blob-1",
            announce_urls: ["wss://tracker.koko.local/announce"],
            web_seed_url: "http://media.local/blob/att-image-blob-1/original.png",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
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
      src: "http://media.local/api/media/att-image-blob-1/blob/preview?session_id=s-1",
      viewerSrc: "http://media.local/api/media/att-image-blob-1/blob/full?session_id=s-1",
      thumbnailUrl: "http://media.local/api/media/att-image-blob-1/blob/preview?session_id=s-1",
      contentHash: "hash-image-blob-1",
      distribution: {
        swarm_id: "swarm-hash-image-blob-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/blob/att-image-blob-1/original.png",
        join_ticket: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    });
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("图片进入 backfilling 时，会激活 blob_asset 绑定的协作分发 runtime", async () => {
    const locator = {
      attachment_id: "att-image-blob-2",
      kind: "image" as const,
      status: "ready" as const,
      original_url: "http://media.local/legacy-original-image-blob-2",
      thumbnail_url: "http://media.local/legacy-thumb-image-blob-2",
      distribution: {
        content_id: "content_att-image-blob-2",
        content_hash: "hash-image-blob-2",
        swarm_id: "swarm-hash-image-blob-2",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-image-blob-2",
        torrent_info_hash: "torrent-info-hash-image-blob-2",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/blob/att-image-blob-2/original.png",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
        survival_mode: "server_assisted" as const,
      },
      streaming_asset: null,
      blob_asset: {
        asset_id: "att-image-blob-2",
        content_hash: "hash-image-blob-2",
        kind: "blob_image" as const,
        preview: {
          id: "preview",
          mime_type: "image/webp",
          url: "http://media.local/api/media/att-image-blob-2/blob/preview?session_id=s-1",
          width: 320,
          height: 213,
        },
        full: {
          id: "full",
          mime_type: "image/webp",
          url: "http://media.local/api/media/att-image-blob-2/blob/full?session_id=s-1",
          width: 1200,
          height: 800,
        },
        original: {
          id: "original",
          mime_type: "image/png",
          url: "http://media.local/api/media/att-image-blob-2/blob/original?session_id=s-1",
          width: 1200,
          height: 800,
        },
        distribution: {
          swarm_id: "swarm-hash-image-blob-2",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-blob-2/original.png",
          join_ticket: null,
          survival_mode: "server_assisted" as const,
        },
        origin: {
          original_url: "http://media.local/legacy-original-image-blob-2",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only" as const,
        },
      },
    };
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-att-image-blob-2",
      hint: "正在补块" as const,
    }));
    const 播放器 = 创建媒体播放器({
      locate: async () => locator,
      resolveSwarmSource,
      probeAnchor: vi.fn(async () => undefined),
    });

    await 播放器.激活协作补齐({
      attachmentId: "att-image-blob-2",
      kind: "image",
    });

    expect(resolveSwarmSource).toHaveBeenCalledWith({
      attachmentId: "att-image-blob-2",
      eagerCompleting: true,
      kind: "image",
      locator,
    });
  });
});
