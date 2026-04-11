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
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-1",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
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
      hint: null,
    });
  });

  it("协作分发可用时会返回 swarm 播放结果和运行态提示", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-3",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-3",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-3",
        content_hash: "hash-video-3",
        swarm_id: "swarm-hash-video-3",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-3",
        torrent_info_hash: "torrent-info-hash-video-3",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-3",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
      },
    }));
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => ({
        src: "blob:http://media.local/swarm-video-3",
        hint: "正在协作分发" as const,
      }),
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-3",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-3",
      kind: "video",
      src: "blob:http://media.local/swarm-video-3",
      thumbnailUrl: null,
      hint: "正在协作分发",
    });
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("协作分发仍在后台补齐整附件时，不把内部补块状态透给视图层", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-4",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-4",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-4",
        content_hash: "hash-video-4",
        swarm_id: "swarm-hash-video-4",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-4",
        torrent_info_hash: "torrent-info-hash-video-4",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-4",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
      },
    }));
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => ({
        src: "blob:http://media.local/swarm-video-4",
        hint: "正在补块" as const,
      }),
      probeAnchor: async () => undefined,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-4",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-4",
      kind: "video",
      src: "blob:http://media.local/swarm-video-4",
      thumbnailUrl: null,
      hint: null,
    });
  });

  it("后端裁决 expired 时会直接返回内容已过期", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-expired",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-expired",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-expired",
        content_hash: "hash-video-expired",
        swarm_id: "swarm-hash-video-expired",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-expired",
        torrent_info_hash: "torrent-info-hash-video-expired",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-expired",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "expired" as const,
      },
    }));
    const resolveSwarmSource = vi.fn();
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-expired",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "expired",
      attachmentId: "att-video-expired",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      hint: "内容已过期",
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
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
      hint: "附件当前不可获取",
    });
  });
});
