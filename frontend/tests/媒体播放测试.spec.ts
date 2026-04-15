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
    const 释放协作分发源 = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => ({
        src: "blob:http://media.local/swarm-video-3",
        hint: "正在协作分发" as const,
      }),
      releaseSwarmSource: 释放协作分发源,
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
    expect(释放协作分发源).not.toHaveBeenCalled();
  });

  it("协作分发主链成立时，会把 consumerId 透传给 swarm resolver", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-consumer-1",
      hint: "正在协作分发" as const,
    }));
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-consumer-1",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-video-consumer-1",
        thumbnail_url: null,
        distribution: {
          content_id: "content_att-video-consumer-1",
          content_hash: "hash-video-consumer-1",
          swarm_id: "swarm-hash-video-consumer-1",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-consumer-1",
          torrent_info_hash: "torrent-info-hash-video-consumer-1",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-consumer-1",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
        },
      }),
      resolveSwarmSource,
      probeAnchor: async () => undefined,
    });

    await 播放器.解析播放结果({
      attachmentId: "att-video-consumer-1",
      kind: "video",
      consumerId: "session:att-video-consumer-1",
    });

    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-consumer-1",
        consumerId: "session:att-video-consumer-1",
      })
    );
  });

  it("最后裁决改走锚点时会释放旧的 swarm 协作分发占用", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-release-1",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-release-1",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-release-1",
        content_hash: "hash-video-release-1",
        swarm_id: "swarm-hash-video-release-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-release-1",
        torrent_info_hash: "torrent-info-hash-video-release-1",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-release-1",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
      },
    }));
    const 释放协作分发源 = vi.fn();
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => null,
      releaseSwarmSource: 释放协作分发源,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-release-1",
      kind: "video",
      consumerId: "session:att-video-release-1",
    });

    expect(result).toMatchObject({
      mode: "anchor",
      src: "http://media.local/original-video-release-1",
    });
    expect(释放协作分发源).toHaveBeenCalledWith({
      attachmentId: "att-video-release-1",
      consumerId: "session:att-video-release-1",
    });
  });

  it("streaming_asset 只有冷源过渡面时，会优先读取共享资产里的 origin", async () => {
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-transition",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original",
        thumbnail_url: null,
        distribution: null,
        streaming_asset: {
          asset_id: "att-video-transition",
          content_hash: "hash-video-transition",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: null,
            dash_mpd_url: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-transition",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-transition",
            join_ticket: null,
          },
          origin: {
            original_url: "http://media.local/cold-origin-transition",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      }),
      resolveSwarmSource: async () => null,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-transition",
      kind: "video",
    });

    expect(probeAnchor).toHaveBeenCalledWith(
      "http://media.local/cold-origin-transition"
    );
    expect(result).toEqual({
      mode: "anchor",
      attachmentId: "att-video-transition",
      kind: "video",
      src: "http://media.local/cold-origin-transition",
      thumbnailUrl: null,
      hint: null,
    });
  });

  it("视频存在 HLS manifest 时，会优先返回标准流媒体主链而不是继续抱着原始附件冷源", async () => {
    const resolveSwarmSource = vi.fn();
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-hls",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-video-hls",
        thumbnail_url: "http://media.local/poster-video-hls",
        distribution: {
          content_id: "content_att-video-hls",
          content_hash: "hash-video-hls",
          swarm_id: "swarm-hash-video-hls",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-hls",
          torrent_info_hash: "torrent-info-hash-video-hls",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
        },
        streaming_asset: {
          asset_id: "att-video-hls",
          content_hash: "hash-video-hls",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-hls/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-hls/stream.mpd",
          },
          distribution: {
            swarm_id: "swarm-hash-video-hls",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls",
            join_ticket: null,
          },
          origin: {
            original_url: "http://media.local/cold-origin-video-hls",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      }),
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-hls",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "manifest",
      attachmentId: "att-video-hls",
      kind: "video",
      src: "http://media.local/stream/att-video-hls/master.m3u8",
      thumbnailUrl: "http://media.local/poster-video-hls",
      streamingDistribution: {
        swarm_id: "swarm-hash-video-hls",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-hls",
        join_ticket: null,
      },
      hint: null,
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("inline_autoplay surface 会复用同一个 resolver，但 manifest 视频优先走浏览器原生可播锚点", async () => {
    const resolveSwarmSource = vi.fn();
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-inline-hls",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-video-inline-hls",
        thumbnail_url: "http://media.local/poster-video-inline-hls",
        distribution: {
          content_id: "content_att-video-inline-hls",
          content_hash: "hash-video-inline-hls",
          swarm_id: "swarm-hash-video-inline-hls",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-inline-hls",
          torrent_info_hash: "torrent-info-hash-video-inline-hls",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-inline-hls",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
        },
        streaming_asset: {
          asset_id: "att-video-inline-hls",
          content_hash: "hash-video-inline-hls",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-inline-hls/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-inline-hls/stream.mpd",
          },
          distribution: {
            swarm_id: "swarm-hash-video-inline-hls",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-inline-hls",
            join_ticket: null,
          },
          origin: {
            original_url: "http://media.local/cold-origin-video-inline-hls",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      }),
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-inline-hls",
      kind: "video",
      surface: "inline_autoplay",
    });

    expect(result).toEqual({
      mode: "anchor",
      attachmentId: "att-video-inline-hls",
      kind: "video",
      src: "http://media.local/cold-origin-video-inline-hls",
      thumbnailUrl: "http://media.local/poster-video-inline-hls",
      hint: null,
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).toHaveBeenCalledWith("http://media.local/cold-origin-video-inline-hls");
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
