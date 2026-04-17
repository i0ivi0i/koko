import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器, 媒体是否默认循环播放 } from "../媒体/媒体播放";

describe("媒体播放器", () => {
  it("视频默认启用循环播放，而图片不会被纳入这条策略", () => {
    expect(媒体是否默认循环播放("video")).toBe(true);
    expect(媒体是否默认循环播放("image")).toBe(false);
  });

  it("图片首开仍优先 preview/full blob 主链，不会因为多消费者改造而强行切到 WebTorrent", async () => {
    const resolveSwarmSource = vi.fn();
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-image-blob-1",
        kind: "image" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-image-blob-1",
        thumbnail_url: "http://media.local/poster-image-blob-1",
        distribution: {
          content_id: "content_att-image-blob-1",
          content_hash: "hash-image-blob-1",
          swarm_id: "swarm-hash-image-blob-1",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-image-blob-1",
          torrent_info_hash: "torrent-info-hash-image-blob-1",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-image-blob-1",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
          survival_mode: "server_assisted" as const,
        },
        preview_asset: {
          still_url: "http://media.local/preview-image-blob-1.jpg",
          width: 1200,
          height: 800,
        },
        blob_asset: {
          asset_id: "att-image-blob-1",
          content_hash: "hash-image-blob-1",
          kind: "blob_image" as const,
          preview: {
            id: "att-image-blob-1:preview",
            url: "http://media.local/blob/att-image-blob-1/preview.webp",
            mime_type: "image/webp",
            width: 480,
            height: 320,
            bytes: 1024,
          },
          full: {
            id: "att-image-blob-1:full",
            url: "http://media.local/blob/att-image-blob-1/full.webp",
            mime_type: "image/webp",
            width: 1200,
            height: 800,
            bytes: 2048,
          },
          original: {
            id: "att-image-blob-1:original",
            url: "http://media.local/blob/att-image-blob-1/original.png",
            mime_type: "image/png",
            width: 1200,
            height: 800,
            bytes: 4096,
          },
          distribution: {
            swarm_id: "swarm-hash-image-blob-1",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-image-blob-1",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/blob/att-image-blob-1/original.png",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        streaming_asset: null,
      }),
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-image-blob-1",
      kind: "image",
      consumerId: "session:att-image-blob-1",
    });

    expect(result).toEqual({
      mode: "blob",
      attachmentId: "att-image-blob-1",
      kind: "image",
      src: "http://media.local/blob/att-image-blob-1/preview.webp",
      viewerSrc: "http://media.local/blob/att-image-blob-1/full.webp",
      thumbnailUrl: "http://media.local/blob/att-image-blob-1/preview.webp",
      contentHash: "hash-image-blob-1",
      distribution: {
        swarm_id: "swarm-hash-image-blob-1",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-image-blob-1",
        join_ticket: null,
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("图片进入 backfill 时，仍复用同一个协作分发 resolver 并透传 consumerId", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-image-backfill-1",
      hint: "正在协作分发" as const,
    }));
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-image-backfill-1",
        kind: "image" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-image-backfill-1",
        thumbnail_url: "http://media.local/poster-image-backfill-1",
        distribution: {
          content_id: "content_att-image-backfill-1",
          content_hash: "hash-image-backfill-1",
          swarm_id: "swarm-hash-image-backfill-1",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-image-backfill-1",
          torrent_info_hash: "torrent-info-hash-image-backfill-1",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-image-backfill-1",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
          survival_mode: "server_assisted" as const,
        },
        preview_asset: {
          still_url: "http://media.local/preview-image-backfill-1.jpg",
          width: 1200,
          height: 800,
        },
        blob_asset: {
          asset_id: "att-image-backfill-1",
          content_hash: "hash-image-backfill-1",
          kind: "blob_image" as const,
          preview: {
            id: "att-image-backfill-1:preview",
            url: "http://media.local/blob/att-image-backfill-1/preview.webp",
            mime_type: "image/webp",
            width: 480,
            height: 320,
            bytes: 1024,
          },
          full: {
            id: "att-image-backfill-1:full",
            url: "http://media.local/blob/att-image-backfill-1/full.webp",
            mime_type: "image/webp",
            width: 1200,
            height: 800,
            bytes: 2048,
          },
          original: {
            id: "att-image-backfill-1:original",
            url: "http://media.local/blob/att-image-backfill-1/original.png",
            mime_type: "image/png",
            width: 1200,
            height: 800,
            bytes: 4096,
          },
          distribution: {
            swarm_id: "swarm-hash-image-backfill-1",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-image-backfill-1",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/blob/att-image-backfill-1/original.png",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        streaming_asset: null,
      }),
      resolveSwarmSource,
    });

    await 播放器.激活协作补齐({
      attachmentId: "att-image-backfill-1",
      kind: "image",
      consumerId: "session:att-image-backfill-1",
      onSessionEvent: vi.fn(),
    });

    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-image-backfill-1",
        kind: "image",
        consumerId: "session:att-image-backfill-1",
      })
    );
  });

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
        survival_mode: "server_assisted" as const,
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
        survival_mode: "server_assisted" as const,
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
          survival_mode: "server_assisted" as const,
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
        survival_mode: "server_assisted" as const,
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
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-transition",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-transition",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
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

  it("0-24 小时内 viewer 打开时会并行预热 swarm 与 HLS；swarm 在短预算内可播时由 swarm 赢下首播", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-hls-fast",
      hint: "正在协作分发" as const,
    }));
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
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-hls",
          content_hash: "hash-video-hls",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-hls/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-hls/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-hls",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
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
      consumerId: "session:att-video-hls",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-hls",
      kind: "video",
      src: "blob:http://media.local/swarm-video-hls-fast",
      thumbnailUrl: "http://media.local/poster-video-hls",
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-hls",
        consumerId: "session:att-video-hls",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("0-24 小时内 viewer 打开时只给 swarm 很短预算；超时后立即落到 HLS，但后台预热继续保留", async () => {
    const resolveSwarmSource = vi.fn(
      () =>
        new Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>(
          (resolve) => {
            setTimeout(() => resolve(null), 300);
          }
        )
    );
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
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-hls",
          content_hash: "hash-video-hls",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-hls/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-hls/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-hls",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
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
        survival_mode: "server_assisted" as const,
      },
      hint: null,
    });
    expect(resolveSwarmSource).toHaveBeenCalledTimes(1);
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("视频查看器已经稳定在 HLS 时，激活协作补齐只升级已预热 swarm，不会再冷启第二条 raw whole-file 主链", async () => {
    const resolveSwarmSource = vi.fn<
      (input: {
        attachmentId: string;
        kind: "image" | "video";
        locator: unknown;
        consumerId?: string;
        onSessionEvent?: unknown;
        eagerCompleting?: boolean;
        reuseOnly?: boolean;
      }) => Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>
    >(async () => ({
      src: "blob:http://media.local/swarm-video-hls-backfill",
      hint: "正在补块" as const,
    }));
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-hls-backfill",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-video-hls-backfill",
        thumbnail_url: "http://media.local/poster-video-hls-backfill",
        distribution: {
          content_id: "content_att-video-hls-backfill",
          content_hash: "hash-video-hls-backfill",
          swarm_id: "swarm-hash-video-hls-backfill",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-hls-backfill",
          torrent_info_hash: "torrent-info-hash-video-hls-backfill",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls-backfill",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-hls-backfill",
          content_hash: "hash-video-hls-backfill",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-hls-backfill/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-hls-backfill/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-hls-backfill",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls-backfill",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-video-hls-backfill",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      }),
      resolveSwarmSource,
    });

    await 播放器.激活协作补齐({
      attachmentId: "att-video-hls-backfill",
      kind: "video",
      consumerId: "session:att-video-hls-backfill",
      onSessionEvent: vi.fn(),
    });

    expect(resolveSwarmSource).toHaveBeenCalledTimes(1);
    const 调用参数 = resolveSwarmSource.mock.calls[0]![0] as {
      attachmentId: string;
      kind: "video";
      consumerId?: string;
      eagerCompleting?: boolean;
      reuseOnly?: boolean;
      locator: {
        attachment_id: string;
      };
      onSessionEvent?: unknown;
    };
    expect(调用参数).toMatchObject({
      attachmentId: "att-video-hls-backfill",
      kind: "video",
      consumerId: "session:att-video-hls-backfill",
      eagerCompleting: true,
      reuseOnly: true,
    });
    expect(调用参数?.locator).toMatchObject({
      attachment_id: "att-video-hls-backfill",
    });
    expect(调用参数?.onSessionEvent).toEqual(expect.any(Function));
  });

  it("inline_autoplay surface 会先尝试复用已热 swarm/web seed，而不是直接 probe anchor", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-inline-hls",
      hint: "正在协作分发" as const,
    }));
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
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-inline-hls",
          content_hash: "hash-video-inline-hls",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-inline-hls/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-inline-hls/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-inline-hls",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-inline-hls",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
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
      consumerId: "inline_autoplay:att-video-inline-hls",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-inline-hls",
      kind: "video",
      src: "blob:http://media.local/swarm-video-inline-hls",
      thumbnailUrl: "http://media.local/poster-video-inline-hls",
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-inline-hls",
        consumerId: "inline_autoplay:att-video-inline-hls",
        reuseOnly: true,
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("inline_autoplay 在没有可复用 swarm 时，才会回退到锚点冷源", async () => {
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-inline-fallback",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-inline-fallback",
        thumbnail_url: "http://media.local/poster-inline-fallback",
        distribution: {
          content_id: "content_att-video-inline-fallback",
          content_hash: "hash-video-inline-fallback",
          swarm_id: "swarm-hash-video-inline-fallback",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-inline-fallback",
          torrent_info_hash: "torrent-info-hash-inline-fallback",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-inline-fallback",
          join_ticket: null,
          ticket_expires_at: null,
          availability: "available" as const,
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-inline-fallback",
          content_hash: "hash-video-inline-fallback",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-inline-fallback/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-inline-fallback/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-inline-fallback",
            announce_urls: ["http://media.local/announce"],
            web_seed_url: "http://media.local/web-seed-inline-fallback",
            join_ticket: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-inline-fallback",
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
      attachmentId: "att-video-inline-fallback",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-video-inline-fallback",
    });

    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-inline-fallback",
        consumerId: "inline_autoplay:att-video-inline-fallback",
        reuseOnly: true,
      })
    );
    expect(probeAnchor).toHaveBeenCalledWith("http://media.local/cold-origin-inline-fallback");
    expect(result).toMatchObject({
      mode: "anchor",
      src: "http://media.local/cold-origin-inline-fallback",
      thumbnailUrl: "http://media.local/poster-inline-fallback",
    });
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
        survival_mode: "server_assisted" as const,
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
        survival_mode: "server_assisted" as const,
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

  it("24 小时后就算旧 locator 还带着 manifest，也不会偷偷继续走 HLS 主链", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-streaming-expired",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-streaming-expired",
      thumbnail_url: "http://media.local/poster-video-streaming-expired",
      distribution: {
        content_id: "content_att-video-streaming-expired",
        content_hash: "hash-video-streaming-expired",
        swarm_id: "swarm-hash-video-streaming-expired",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-streaming-expired",
        torrent_info_hash: "torrent-info-hash-video-streaming-expired",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-streaming-expired",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "expired" as const,
        survival_mode: "peer_only_after_expiry" as const,
      },
      streaming_asset: {
        asset_id: "att-video-streaming-expired",
        content_hash: "hash-video-streaming-expired",
        kind: "streaming_video" as const,
        manifest: {
          hls_master_url:
            "http://media.local/stream/att-video-streaming-expired/master.m3u8",
          dash_mpd_url: "http://media.local/stream/att-video-streaming-expired/stream.mpd",
        },
        lifecycle: {
          streaming_expires_at: "1",
          streaming_deleted_at: "2",
        },
        distribution: {
          swarm_id: "swarm-hash-video-streaming-expired",
          announce_urls: ["http://media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-streaming-expired",
          join_ticket: null,
          survival_mode: "peer_only_after_expiry" as const,
        },
        origin: {
          original_url: "http://media.local/original-video-streaming-expired",
          expires_at_epoch_seconds: 1,
          available: false,
          role: "cold_backup_only" as const,
        },
      },
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn();
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-streaming-expired",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "expired",
      attachmentId: "att-video-streaming-expired",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-streaming-expired",
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
