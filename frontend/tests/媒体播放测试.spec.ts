import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器 } from "../媒体/媒体播放";

describe("媒体播放器", () => {
  it("swarm 不足时会回退到锚点地址", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-1",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-1",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-1",
        content_hash: "hash-video-1",
        swarm_id: "swarm-hash-video-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-1",
        torrent_info_hash: "torrent-info-hash-video-1",
        join_ticket: null,
        ticket_expires_at: null,
      },
    }));
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => null,
      probeAnchor: async () => undefined,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-1",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "anchor",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/original-video-1",
      thumbnailUrl: null,
    });
  });

  it("locator 过期时会强制重签后再回退锚点", async () => {
    const locate = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att-image-1",
        kind: "image" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-stale",
        thumbnail_url: "http://media.local/thumb-stale",
        distribution: null,
      })
      .mockResolvedValueOnce({
        attachment_id: "att-image-1",
        kind: "image" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-refresh",
        thumbnail_url: "http://media.local/thumb-refresh",
        distribution: null,
      });
    const probeAnchor = vi
      .fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce(undefined);
    const 播放器 = 创建媒体播放器({
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
      mode: "anchor",
      attachmentId: "att-image-1",
      kind: "image",
      src: "http://media.local/original-refresh",
      thumbnailUrl: "http://media.local/thumb-refresh",
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
    const 播放器 = 创建媒体播放器({
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
    });
  });
});
