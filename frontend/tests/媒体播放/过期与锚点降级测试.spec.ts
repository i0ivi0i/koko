import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器 } from "../../媒体/媒体播放";
import { 协作分发运行时环境不支持错误 } from "../../媒体/媒体协作分发";

describe("媒体播放器 / 过期与锚点降级", () => {
  it("peer_only_after_expiry 且 swarm 暂不可用时，viewer 不会回退锚点冷源，而是保持协作分发唯一主链语义", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-peer-only-viewer",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-peer-only-viewer",
      thumbnail_url: "http://media.local/poster-video-peer-only-viewer",
      distribution: {
        content_id: "content_att-video-peer-only-viewer",
        content_hash: "hash-video-peer-only-viewer",
        swarm_id: "swarm-hash-video-peer-only-viewer",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-peer-only-viewer",
        torrent_info_hash: "torrent-info-hash-video-peer-only-viewer",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource,
      probeAnchor,
      releaseSwarmSource,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-peer-only-viewer",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-peer-only-viewer",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-peer-only-viewer",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-peer-only-viewer",
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-peer-only-viewer",
        consumerId: "session:att-video-peer-only-viewer",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
    expect(releaseSwarmSource).toHaveBeenCalledWith({
      attachmentId: "att-video-peer-only-viewer",
      consumerId: "session:att-video-peer-only-viewer",
    });
  });

  it("peer_only_after_expiry 在非安全上下文触发 runtime 不支持时，会返回明确诊断而不是笼统不可获取", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-peer-only-insecure-context",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-peer-only-insecure-context",
      thumbnail_url: "http://media.local/poster-video-peer-only-insecure-context",
      distribution: {
        content_id: "content_att-video-peer-only-insecure-context",
        content_hash: "hash-video-peer-only-insecure-context",
        swarm_id: "swarm-hash-video-peer-only-insecure-context",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-peer-only-insecure-context",
        torrent_info_hash: "torrent-info-hash-video-peer-only-insecure-context",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => {
      throw new 协作分发运行时环境不支持错误();
    });
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource,
      probeAnchor,
      releaseSwarmSource,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-peer-only-insecure-context",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-peer-only-insecure-context",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-peer-only-insecure-context",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-peer-only-insecure-context",
      reason: "swarm_runtime_unsupported",
      hint: "当前环境不支持 WebTorrent 主链（请使用 HTTPS 或 localhost）",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-peer-only-insecure-context",
        consumerId: "session:att-video-peer-only-insecure-context",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
    expect(releaseSwarmSource).toHaveBeenCalledWith({
      attachmentId: "att-video-peer-only-insecure-context",
      consumerId: "session:att-video-peer-only-insecure-context",
    });
  });

  it("peer_only_after_expiry 且 swarm 暂不可用时，inline_autoplay 也不会偷偷回退锚点", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-peer-only-inline",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-peer-only-inline",
      thumbnail_url: "http://media.local/poster-video-peer-only-inline",
      distribution: {
        content_id: "content_att-video-peer-only-inline",
        content_hash: "hash-video-peer-only-inline",
        swarm_id: "swarm-hash-video-peer-only-inline",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-peer-only-inline",
        torrent_info_hash: "torrent-info-hash-video-peer-only-inline",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource,
      probeAnchor,
      releaseSwarmSource,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-peer-only-inline",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-video-peer-only-inline",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-peer-only-inline",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-peer-only-inline",
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-peer-only-inline",
        consumerId: "inline_autoplay:att-video-peer-only-inline",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
    expect(releaseSwarmSource).toHaveBeenCalledWith({
      attachmentId: "att-video-peer-only-inline",
      consumerId: "inline_autoplay:att-video-peer-only-inline",
    });
  });

  it("locator 过期时会强制重签后再回退锚点", async () => {
    const locate = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att-image-1",
        kind: "image" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: null,
        blob_asset: {
          asset_id: "att-image-1",
          content_hash: "hash-image-stale",
          kind: "blob_image" as const,
          variants: {
            canonical: {
              id: "canonical",
              url: "http://media.local/canonical-stale",
              mime_type: "image/webp",
              width: 1200,
              height: 800,
            },
          },
          origin: {
            original_url: "http://media.local/original-stale",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
      })
      .mockResolvedValueOnce({
        attachment_id: "att-image-1",
        kind: "image" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: null,
        blob_asset: {
          asset_id: "att-image-1",
          content_hash: "hash-image-refresh",
          kind: "blob_image" as const,
          variants: {
            canonical: {
              id: "canonical",
              url: "http://media.local/canonical-refresh",
              mime_type: "image/webp",
              width: 1200,
              height: 800,
            },
          },
          origin: {
            original_url: "http://media.local/original-refresh",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
      });
    const probeAnchor = vi
      .fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce(undefined);
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource: async () => null,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-image-1",
      kind: "image",
    });

    expect(locate).toHaveBeenNthCalledWith(1, "att-image-1");
    expect(locate).toHaveBeenNthCalledWith(2, "att-image-1", { forceRefresh: true });
    expect(result).toEqual({
      mode: "legacy_anchor",
      attachmentId: "att-image-1",
      kind: "image",
      src: "http://media.local/canonical-refresh",
      thumbnailUrl: null,
      contentHash: "hash-image-refresh",
      hint: null,
    });
  });

  it("锚点不可用时消息仍在，但媒体展示 degraded", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-2",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-down",
      thumbnail_url: null,
      distribution: null,
    }));
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource: async () => null,
      probeAnchor: async () => {
        throw new Error("down");
      },
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-2",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-2",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
  });
});
