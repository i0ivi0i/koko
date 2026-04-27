import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器, 媒体是否默认循环播放 } from "../媒体/媒体播放";
import {
  协作分发JoinTicket失效错误,
  协作分发运行时环境不支持错误,
} from "../媒体/媒体协作分发";
import { Http接口错误 } from "../传输";

describe("媒体播放器", () => {
  it("媒体播放模块不应继续保留旧 streaming_asset 兼容叙事", () => {
    const source = readFileSync(new URL("../媒体/媒体播放.ts", import.meta.url), "utf-8");
    expect(source.includes("旧 streaming_asset 只继续作为")).toBe(false);
  });

  it("视频默认启用循环播放，而图片不会被纳入这条策略", () => {
    expect(媒体是否默认循环播放("video")).toBe(true);
    expect(媒体是否默认循环播放("image")).toBe(false);
  });

  it("同一附件在 inline_autoplay 与 viewer 使用同一 content_hash", async () => {
    const locator = {
      attachment_id: "att-file-video-1",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/api/attachments/att-file-video-1/content?variant=original",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-file-video-1",
        content_hash: "hash-file-video-1",
        swarm_id: "swarm-hash-file-video-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-file-video-1",
        torrent_info_hash: "torrent-info-hash-file-video-1",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-file-video-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
      preview_asset: null,
      file_asset: {
        asset_id: "att-file-video-1",
        content_hash: "hash-file-video-1",
        kind: "file_video" as const,
        variants: {
          canonical: {
            id: "canonical",
            url: "http://media.local/api/attachments/att-file-video-1/content?variant=original",
            mime_type: "video/mp4",
            width: 1280,
            height: 720,
          },
        },
        manifest: null,
        lifecycle: null,
        distribution: {
          swarm_id: "swarm-hash-file-video-1",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-file-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        origin: {
          original_url: "http://media.local/api/attachments/att-file-video-1/content?variant=original",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only" as const,
        },
      },
      blob_asset: null,
      streaming_asset: null,
    };
    const 播放器 = 创建媒体播放器({
      locate: async () => locator,
      resolveSwarmSource: async () => ({
        src: "blob:http://media.local/swarm-file-video-1",
        hint: null,
      }),
      probeAnchor: vi.fn(async () => undefined),
    });

    const auto = await 播放器.解析播放结果({
      attachmentId: "att-file-video-1",
      kind: "video",
      surface: "inline_autoplay",
    });
    const view = await 播放器.解析播放结果({
      attachmentId: "att-file-video-1",
      kind: "video",
      surface: "viewer",
    });

    if (auto.mode === "expired" || auto.mode === "degraded" || view.mode === "expired" || view.mode === "degraded") {
      throw new Error("单文件视频 locator 应该解析成可播放结果");
    }
    expect(auto.contentHash).toBe("hash-file-video-1");
    expect(view.contentHash).toBe("hash-file-video-1");
    expect(auto.src).toBe(view.src);
  });

  it("新代际图片首开优先走 WebTorrent 主链，不再把 blob canonical 当正式播放链", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-image-blob-1",
      hint: "正在协作分发" as const,
    }));
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-image-blob-1",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "peer_only_after_expiry" as const,
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
          variants: {
            canonical: {
              id: "att-image-blob-1:canonical",
              url: "http://media.local/blob/att-image-blob-1/canonical.webp",
              mime_type: "image/webp",
              width: 1200,
              height: 800,
              bytes: 2048,
            },
          },
          distribution: {
            swarm_id: "swarm-hash-image-blob-1",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-image-blob-1",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "peer_only_after_expiry" as const,
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
      mode: "swarm",
      attachmentId: "att-image-blob-1",
      kind: "image",
      src: "blob:http://media.local/swarm-image-blob-1",
      thumbnailUrl: "http://media.local/preview-image-blob-1.jpg",
      contentHash: "hash-image-blob-1",
      distribution: {
        swarm_id: "swarm-hash-image-blob-1",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-image-blob-1",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "peer_only_after_expiry" as const,
      },
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledTimes(1);
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-image-backfill-1",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
          variants: {
            canonical: {
              id: "att-image-backfill-1:canonical",
              url: "http://media.local/blob/att-image-backfill-1/canonical.webp",
              mime_type: "image/webp",
              width: 1200,
              height: 800,
              bytes: 2048,
            },
          },
          distribution: {
            swarm_id: "swarm-hash-image-backfill-1",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-image-backfill-1",
            join_ticket: null,
            ticket_expires_at: null,
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

  it("swarm 不足时会返回不可用降级态，不再回退原始锚点", async () => {
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
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
      mode: "degraded",
      attachmentId: "att-video-1",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-3",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
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
        locallyComplete: true,
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
      locallyComplete: true,
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-consumer-1",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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

  it("viewer 命中未补齐的 server-assisted swarm 时仍保持协作分发主链，不回退锚点冷源", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-consumer-incomplete",
      hint: "正在协作分发" as const,
      locallyComplete: false,
    }));
    const releaseSwarmSource = vi.fn();
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-consumer-incomplete",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/original-video-consumer-incomplete",
        thumbnail_url: "http://media.local/poster-video-consumer-incomplete",
        distribution: {
          content_id: "content_att-video-consumer-incomplete",
          content_hash: "hash-video-consumer-incomplete",
          swarm_id: "swarm-hash-video-consumer-incomplete",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-consumer-incomplete",
          torrent_info_hash: "torrent-info-hash-video-consumer-incomplete",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-consumer-incomplete",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: null,
        blob_asset: null,
      }),
      resolveSwarmSource,
      releaseSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-consumer-incomplete",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-consumer-incomplete",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-consumer-incomplete",
      kind: "video",
      src: "blob:http://media.local/swarm-video-consumer-incomplete",
      thumbnailUrl: "http://media.local/poster-video-consumer-incomplete",
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-consumer-incomplete",
        consumerId: "session:att-video-consumer-incomplete",
      })
    );
    expect(releaseSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-release-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
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
      mode: "degraded",
      src: "",
      reason: "anchor_unavailable",
    });
    expect(释放协作分发源).toHaveBeenCalledWith({
      attachmentId: "att-video-release-1",
      consumerId: "session:att-video-release-1",
    });
  });

  it("streaming_asset 只有冷源过渡面时，若 swarm 不可用则保持降级态，不回退 origin", async () => {
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-transition",
            join_ticket: null,
            ticket_expires_at: null,
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

    expect(probeAnchor).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-transition",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
  });

  it("viewer 首次打开命中旧 manifest locator 时，仍会强制刷新 locator，主链不再回到 manifest", async () => {
    const locate = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att-video-viewer-race",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-viewer-race",
        thumbnail_url: "http://media.local/poster-viewer-race",
        distribution: {
          content_id: "content_att-video-viewer-race",
          content_hash: "hash-video-viewer-race",
          swarm_id: "swarm-hash-video-viewer-race",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-viewer-race",
          torrent_info_hash: "torrent-info-hash-viewer-race",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-viewer-race",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-viewer-race",
          content_hash: "hash-video-viewer-race",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-viewer-race/stale-master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-viewer-race/stale-stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-viewer-race",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-viewer-race",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-viewer-race",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      })
      .mockResolvedValueOnce({
        attachment_id: "att-video-viewer-race",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-viewer-race",
        thumbnail_url: "http://media.local/poster-viewer-race",
        distribution: {
          content_id: "content_att-video-viewer-race",
          content_hash: "hash-video-viewer-race",
          swarm_id: "swarm-hash-video-viewer-race",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-viewer-race",
          torrent_info_hash: "torrent-info-hash-viewer-race",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-viewer-race",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-viewer-race",
          content_hash: "hash-video-viewer-race",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-viewer-race/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-viewer-race/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-viewer-race",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-viewer-race",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-viewer-race",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only" as const,
          },
        },
        blob_asset: null,
      });
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-viewer-race",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-viewer-race",
    });

    expect(locate).toHaveBeenNthCalledWith(1, "att-video-viewer-race");
    expect(locate).toHaveBeenNthCalledWith(2, "att-video-viewer-race", { forceRefresh: true });
    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-viewer-race",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-viewer-race",
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-viewer-race",
        consumerId: "session:att-video-viewer-race",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("viewer 短时间内重复打开同一视频时，不会每次都 forceRefresh locator", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-viewer-refresh-budget",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/legacy-original-viewer-refresh-budget",
      thumbnail_url: "http://media.local/poster-viewer-refresh-budget",
      distribution: {
        content_id: "content_att-video-viewer-refresh-budget",
        content_hash: "hash-video-viewer-refresh-budget",
        swarm_id: "swarm-hash-video-viewer-refresh-budget",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-viewer-refresh-budget",
        torrent_info_hash: "torrent-info-hash-viewer-refresh-budget",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-viewer-refresh-budget",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
      streaming_asset: {
        asset_id: "att-video-viewer-refresh-budget",
        content_hash: "hash-video-viewer-refresh-budget",
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
          swarm_id: "swarm-hash-video-viewer-refresh-budget",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-viewer-refresh-budget",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        origin: {
          original_url: "http://media.local/cold-origin-viewer-refresh-budget",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only" as const,
        },
      },
      file_asset: null,
      blob_asset: null,
      preview_asset: null,
    }));
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => null,
      probeAnchor: vi.fn(async () => undefined),
    });

    await 播放器.解析播放结果({
      attachmentId: "att-video-viewer-refresh-budget",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-viewer-refresh-budget",
    });
    await 播放器.解析播放结果({
      attachmentId: "att-video-viewer-refresh-budget",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-viewer-refresh-budget",
    });

    const forceRefreshCalls = (
      locate.mock.calls as unknown as Array<[string, { forceRefresh?: boolean }?]>
    ).reduce((count, [, options]) => {
      return count + (options?.forceRefresh ? 1 : 0);
    }, 0);
    expect(locate).toHaveBeenCalledTimes(3);
    expect(forceRefreshCalls).toBe(1);
  });

  it("0-24 小时内 viewer 打开时命中已热完整 swarm，会直接复用 swarm 主链", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-hls-fast",
      hint: "正在协作分发" as const,
      locallyComplete: true,
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls",
            join_ticket: null,
            ticket_expires_at: null,
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

  it("viewer 命中未本地完整的已热 swarm 时，仍保持 swarm 主链并直接播放", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-hls-incomplete",
      hint: "正在协作分发" as const,
      locallyComplete: false,
    }));
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-hls-incomplete",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-video-hls-incomplete",
        thumbnail_url: "http://media.local/poster-video-hls-incomplete",
        distribution: {
          content_id: "content_att-video-hls-incomplete",
          content_hash: "hash-video-hls-incomplete",
          swarm_id: "swarm-hash-video-hls-incomplete",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-hls-incomplete",
          torrent_info_hash: "torrent-info-hash-video-hls-incomplete",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls-incomplete",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-hls-incomplete",
          content_hash: "hash-video-hls-incomplete",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-hls-incomplete/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-hls-incomplete/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-hls-incomplete",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls-incomplete",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-video-hls-incomplete",
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
      attachmentId: "att-video-hls-incomplete",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-hls-incomplete",
    });

    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-hls-incomplete",
      kind: "video",
      src: "blob:http://media.local/swarm-video-hls-incomplete",
      thumbnailUrl: "http://media.local/poster-video-hls-incomplete",
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-hls-incomplete",
        consumerId: "session:att-video-hls-incomplete",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("inline_autoplay 抢 swarm 时如果 join_ticket 已失效，会强制刷新 locator 一次并重试同一条主链", async () => {
    const 初始定位结果 = {
      attachment_id: "att-video-ticket-refresh",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-ticket-stale",
      thumbnail_url: "http://media.local/poster-ticket-refresh",
      distribution: {
        content_id: "content_att-video-ticket-refresh",
        content_hash: "hash-video-ticket-refresh",
        swarm_id: "swarm-hash-video-ticket-refresh",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-ticket-stale",
        torrent_info_hash: "torrent-info-hash-ticket-refresh",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-ticket-stale",
        join_ticket: "ticket-stale",
        ticket_expires_at: "2026-04-18T10:00:00Z",
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
      streaming_asset: {
        asset_id: "att-video-ticket-refresh",
        content_hash: "hash-video-ticket-refresh",
        kind: "streaming_video" as const,
        manifest: {
          hls_master_url: "http://media.local/stream/att-video-ticket-refresh/master.m3u8",
          dash_mpd_url: "http://media.local/stream/att-video-ticket-refresh/stream.mpd",
        },
        lifecycle: {
          streaming_expires_at: "1775942400",
          streaming_deleted_at: null,
        },
        distribution: {
          swarm_id: "swarm-hash-video-ticket-refresh",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-ticket-stale",
          join_ticket: "ticket-stale",
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        origin: {
          original_url: "http://media.local/cold-origin-ticket-stale",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only" as const,
        },
      },
      blob_asset: null,
    };
    const 刷新后定位结果 = {
      ...初始定位结果,
      original_url: "http://media.local/original-ticket-refresh",
      distribution: {
        ...初始定位结果.distribution,
        torrent_url: "http://media.local/torrent-ticket-refresh",
        web_seed_url: "http://media.local/web-seed-ticket-refresh",
        join_ticket: "ticket-refresh",
        ticket_expires_at: "2026-04-18T10:02:00Z",
      },
      streaming_asset: {
        ...初始定位结果.streaming_asset,
        distribution: {
          ...初始定位结果.streaming_asset.distribution,
          web_seed_url: "http://media.local/web-seed-ticket-refresh",
          join_ticket: "ticket-refresh",
        },
        origin: {
          ...初始定位结果.streaming_asset.origin,
          original_url: "http://media.local/cold-origin-ticket-refresh",
        },
      },
    };
    const locate = vi
      .fn()
      .mockResolvedValueOnce(初始定位结果)
      .mockResolvedValueOnce(刷新后定位结果);
    const resolveSwarmSource = vi
      .fn()
      .mockRejectedValueOnce(new 协作分发JoinTicket失效错误())
      .mockResolvedValueOnce({
        src: "blob:http://media.local/swarm-ticket-refresh",
        hint: "正在协作分发" as const,
        locallyComplete: true,
      });
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-ticket-refresh",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-video-ticket-refresh",
    });

    expect(locate).toHaveBeenNthCalledWith(1, "att-video-ticket-refresh");
    expect(locate).toHaveBeenNthCalledWith(2, "att-video-ticket-refresh", {
      forceRefresh: true,
    });
    expect(resolveSwarmSource).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attachmentId: "att-video-ticket-refresh",
        locator: 初始定位结果,
      })
    );
    expect(resolveSwarmSource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attachmentId: "att-video-ticket-refresh",
        locator: 刷新后定位结果,
      })
    );
    expect(result).toEqual({
      mode: "swarm",
      attachmentId: "att-video-ticket-refresh",
      kind: "video",
      src: "blob:http://media.local/swarm-ticket-refresh",
      thumbnailUrl: "http://media.local/poster-ticket-refresh",
      hint: "正在协作分发",
    });
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("0-24 小时内 viewer 打开时没有可用 swarm 会直接降级，不再回退锚点冷源", async () => {
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls",
            join_ticket: null,
            ticket_expires_at: null,
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
      mode: "degraded",
      attachmentId: "att-video-hls",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-hls",
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledTimes(1);
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-hls",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("viewer 与 inline_autoplay 在同一定位输入下，会裁决到同一条 swarm 首播真相", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-shared-truth",
      hint: "正在协作分发" as const,
      locallyComplete: true,
    }));
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-shared-truth",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-shared-truth",
        thumbnail_url: "http://media.local/poster-shared-truth",
        distribution: {
          content_id: "content_att-video-shared-truth",
          content_hash: "hash-video-shared-truth",
          swarm_id: "swarm-hash-video-shared-truth",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-shared-truth",
          torrent_info_hash: "torrent-info-hash-video-shared-truth",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-shared-truth",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-shared-truth",
          content_hash: "hash-video-shared-truth",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-shared-truth/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-shared-truth/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-shared-truth",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-shared-truth",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-video-shared-truth",
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

    const viewerResult = await 播放器.解析播放结果({
      attachmentId: "att-video-shared-truth",
      kind: "video",
      surface: "viewer",
      consumerId: "session:att-video-shared-truth",
    });
    const inlineResult = await 播放器.解析播放结果({
      attachmentId: "att-video-shared-truth",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-video-shared-truth",
    });

    expect(viewerResult).toEqual({
      mode: "swarm",
      attachmentId: "att-video-shared-truth",
      kind: "video",
      src: "blob:http://media.local/swarm-video-shared-truth",
      thumbnailUrl: "http://media.local/poster-shared-truth",
      hint: "正在协作分发",
    });
    expect(inlineResult).toEqual({
      mode: "swarm",
      attachmentId: "att-video-shared-truth",
      kind: "video",
      src: "blob:http://media.local/swarm-video-shared-truth",
      thumbnailUrl: "http://media.local/poster-shared-truth",
      hint: "正在协作分发",
    });
    expect(resolveSwarmSource).toHaveBeenCalledTimes(2);
    const calls = resolveSwarmSource.mock.calls as unknown as Array<
      Array<{
        eagerCompleting?: boolean;
      } & Record<string, unknown>>
    >;
    const viewerCall = calls[0]?.[0];
    const inlineCall = calls[1]?.[0];
    expect(viewerCall?.eagerCompleting).toBe(inlineCall?.eagerCompleting);
    expect(viewerCall).not.toHaveProperty("reuseOnly");
    expect(inlineCall).not.toHaveProperty("reuseOnly");
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("视频查看器已经稳定在 HLS 时，激活协作补齐会允许冷启动协作分发，而不是强制 reuseOnly", async () => {
    const resolveSwarmSource = vi.fn<
      (input: {
        attachmentId: string;
        kind: "image" | "video";
        locator: unknown;
        consumerId?: string;
        onSessionEvent?: unknown;
        eagerCompleting?: boolean;
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-hls-backfill",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-hls-backfill",
            join_ticket: null,
            ticket_expires_at: null,
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
    });
    expect(调用参数).not.toHaveProperty("reuseOnly");
    expect(调用参数?.locator).toMatchObject({
      attachment_id: "att-video-hls-backfill",
    });
    expect(调用参数?.onSessionEvent).toEqual(expect.any(Function));
  });

  it("单文件 canonical 视频进入查看器后，激活协作补齐也会允许冷启动 swarm，而不是继续强制 reuseOnly", async () => {
    const resolveSwarmSource = vi.fn<
      (input: {
        attachmentId: string;
        kind: "image" | "video";
        locator: unknown;
        consumerId?: string;
        onSessionEvent?: unknown;
        eagerCompleting?: boolean;
      }) => Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>
    >(async () => ({
      src: "blob:http://media.local/swarm-video-canonical-backfill",
      hint: "正在补块" as const,
    }));
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-canonical-backfill",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/cold-origin-video-canonical-backfill",
        thumbnail_url: "http://media.local/poster-video-canonical-backfill",
        distribution: {
          content_id: "content_att-video-canonical-backfill",
          content_hash: "hash-video-canonical-backfill",
          swarm_id: "swarm-hash-video-canonical-backfill",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-video-canonical-backfill",
          torrent_info_hash: "torrent-info-hash-video-canonical-backfill",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-canonical-backfill",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        // 单文件主链场景不再提供 streaming_asset manifest。
        streaming_asset: null,
        blob_asset: null,
      }),
      resolveSwarmSource,
    });

    await 播放器.激活协作补齐({
      attachmentId: "att-video-canonical-backfill",
      kind: "video",
      consumerId: "session:att-video-canonical-backfill",
      onSessionEvent: vi.fn(),
    });

    expect(resolveSwarmSource).toHaveBeenCalledTimes(1);
    const 调用参数 = resolveSwarmSource.mock.calls[0]![0] as {
      attachmentId: string;
      kind: "video";
      consumerId?: string;
      eagerCompleting?: boolean;
      locator: {
        attachment_id: string;
      };
      onSessionEvent?: unknown;
    };
    expect(调用参数).toMatchObject({
      attachmentId: "att-video-canonical-backfill",
      kind: "video",
      consumerId: "session:att-video-canonical-backfill",
      eagerCompleting: true,
    });
    expect(调用参数).not.toHaveProperty("reuseOnly");
    expect(调用参数?.locator).toMatchObject({
      attachment_id: "att-video-canonical-backfill",
    });
    expect(调用参数?.onSessionEvent).toEqual(expect.any(Function));
  });

  it("inline_autoplay surface 只有在 swarm 已本地完整时才直接复用文件源，而不是把半成品 blob 塞给消息卡片", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-inline-hls",
      hint: "正在协作分发" as const,
      locallyComplete: true,
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-inline-hls",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-video-inline-hls",
            join_ticket: null,
            ticket_expires_at: null,
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
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("inline_autoplay 命中未补齐完成的 swarm 文件源时，仍保持 swarm 主链并复用同一来源", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-inline-partial",
      hint: "正在协作分发" as const,
      locallyComplete: false,
    }));
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate: async () => ({
        attachment_id: "att-video-inline-partial",
        kind: "video" as const,
        status: "ready" as const,
        original_url: "http://media.local/legacy-original-inline-partial",
        thumbnail_url: "http://media.local/poster-inline-partial",
        distribution: {
          content_id: "content_att-video-inline-partial",
          content_hash: "hash-video-inline-partial",
          swarm_id: "swarm-hash-video-inline-partial",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-inline-partial",
          torrent_info_hash: "torrent-info-hash-inline-partial",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-inline-partial",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
        streaming_asset: {
          asset_id: "att-video-inline-partial",
          content_hash: "hash-video-inline-partial",
          kind: "streaming_video" as const,
          manifest: {
            hls_master_url: "http://media.local/stream/att-video-inline-partial/master.m3u8",
            dash_mpd_url: "http://media.local/stream/att-video-inline-partial/stream.mpd",
          },
          lifecycle: {
            streaming_expires_at: "1775942400",
            streaming_deleted_at: null,
          },
          distribution: {
            swarm_id: "swarm-hash-video-inline-partial",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-inline-partial",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted" as const,
          },
          origin: {
            original_url: "http://media.local/cold-origin-inline-partial",
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
      attachmentId: "att-video-inline-partial",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-video-inline-partial",
    });

    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-inline-partial",
        consumerId: "inline_autoplay:att-video-inline-partial",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: "swarm",
      src: "blob:http://media.local/swarm-video-inline-partial",
      thumbnailUrl: "http://media.local/poster-inline-partial",
      hint: "正在协作分发",
    });
  });

  it("inline_autoplay 在没有可复用 swarm 时，会保持降级态而不是回退锚点冷源", async () => {
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-inline-fallback",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
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
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-inline-fallback",
            join_ticket: null,
            ticket_expires_at: null,
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
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: "degraded",
      src: "",
      reason: "anchor_unavailable",
      thumbnailUrl: "http://media.local/poster-inline-fallback",
      hint: "附件当前不可获取",
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-4",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    }));
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => ({
        src: "blob:http://media.local/swarm-video-4",
        hint: "正在补块" as const,
        locallyComplete: true,
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

  it("media_state=MEDIA_CONNECTING_TO_PEERS 且 swarm 暂不可用时，会给出连接群友提示而不是回退锚点", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-connecting",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-connecting",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-connecting",
        content_hash: "hash-video-connecting",
        swarm_id: "swarm-hash-video-connecting",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-connecting",
        torrent_info_hash: "torrent-info-hash-video-connecting",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_CONNECTING_TO_PEERS" as const,
          retry_after_ms: 2000,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-connecting",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-connecting",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "connecting_to_peers",
      hint: "正在尝试连接群友",
    });
    expect(resolveSwarmSource).toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("media_state=MEDIA_NO_ONLINE_SEED 时会先进入连接群友窗口，预算耗尽后再进入无在线种子", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-no-seed",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-no-seed",
      thumbnail_url: "http://media.local/poster-video-no-seed",
      distribution: {
        content_id: "content_att-video-no-seed",
        content_hash: "hash-video-no-seed",
        swarm_id: "swarm-hash-video-no-seed",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-no-seed",
        torrent_info_hash: "torrent-info-hash-video-no-seed",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_NO_ONLINE_SEED" as const,
          retry_after_ms: 15000,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
    try {
      const 第一次结果 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed",
        kind: "video",
      });
      expect(第一次结果).toEqual({
        mode: "degraded",
        attachmentId: "att-video-no-seed",
        kind: "video",
        src: "",
        thumbnailUrl: "http://media.local/poster-video-no-seed",
        reason: "connecting_to_peers",
        hint: "正在尝试连接群友",
      });

      vi.advanceTimersByTime(2_000);
      const 第二次结果 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed",
        kind: "video",
      });
      expect(第二次结果).toEqual({
        mode: "degraded",
        attachmentId: "att-video-no-seed",
        kind: "video",
        src: "",
        thumbnailUrl: "http://media.local/poster-video-no-seed",
        reason: "connecting_to_peers",
        hint: "正在尝试连接群友",
      });

      vi.advanceTimersByTime(6_001);
      const 预算耗尽结果 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed",
        kind: "video",
      });
      expect(预算耗尽结果).toEqual({
        mode: "degraded",
        attachmentId: "att-video-no-seed",
        kind: "video",
        src: "",
        thumbnailUrl: "http://media.local/poster-video-no-seed",
        reason: "no_online_seed",
        hint: "当前没有在线种子，等待群友上线",
      });
    } finally {
      vi.useRealTimers();
    }
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("MEDIA_NO_ONLINE_SEED 进入终态后，达到 retry_after_ms 会重新开启下一轮连接群友窗口", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-no-seed-retry-cycle",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-no-seed-retry-cycle",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-no-seed-retry-cycle",
        content_hash: "hash-video-no-seed-retry-cycle",
        swarm_id: "swarm-hash-video-no-seed-retry-cycle",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-no-seed-retry-cycle",
        torrent_info_hash: "torrent-info-hash-video-no-seed-retry-cycle",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_NO_ONLINE_SEED" as const,
          retry_after_ms: 15000,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
    }));
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource: async () => null,
      probeAnchor: async () => undefined,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
    try {
      // 第一轮：8 秒连接预算耗尽后进入 no seed
      await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed-retry-cycle",
        kind: "video",
      });
      vi.advanceTimersByTime(8_001);
      const 第一轮终态 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed-retry-cycle",
        kind: "video",
      });
      expect(第一轮终态).toMatchObject({
        mode: "degraded",
        reason: "no_online_seed",
      });

      // 终态期间不到 15 秒，仍然保持 no seed，不应提前重开连接窗口
      vi.advanceTimersByTime(14_999);
      const 终态保持结果 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed-retry-cycle",
        kind: "video",
      });
      expect(终态保持结果).toMatchObject({
        mode: "degraded",
        reason: "no_online_seed",
      });

      // 到达 retry_after_ms 后，下一轮应重新回到 connecting_to_peers
      vi.advanceTimersByTime(1);
      const 下一轮连接结果 = await 播放器.解析播放结果({
        attachmentId: "att-video-no-seed-retry-cycle",
        kind: "video",
      });
      expect(下一轮连接结果).toMatchObject({
        mode: "degraded",
        reason: "connecting_to_peers",
        hint: "正在尝试连接群友",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("media_state=MEDIA_DELETED 时会直接落删除终态提示", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-deleted",
      kind: "video" as const,
      status: "ready" as const,
      original_url: "http://media.local/original-video-deleted",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-deleted",
        content_hash: "hash-video-deleted",
        swarm_id: "swarm-hash-video-deleted",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-deleted",
        torrent_info_hash: "torrent-info-hash-video-deleted",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_DELETED" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-deleted",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-deleted",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "media_deleted",
      hint: "内容已删除",
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("locator 返回 attachment_not_found 时，会落删除终态而不是普通不可用", async () => {
    const locate = vi.fn(async () => {
      throw new Http接口错误(404, "attachment_not_found", "附件不存在");
    });
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-attachment-not-found",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-attachment-not-found",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "media_deleted",
      hint: "内容已删除",
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("locator.status=deleted 时，会直接落删除终态而不是 attachment_not_ready", async () => {
    const locate = vi.fn(async () => ({
      attachment_id: "att-video-status-deleted",
      kind: "video" as const,
      status: "deleted" as const,
      original_url: "http://media.local/original-video-status-deleted",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-video-status-deleted",
        content_hash: "hash-video-status-deleted",
        swarm_id: "swarm-hash-video-status-deleted",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-video-status-deleted",
        torrent_info_hash: "torrent-info-hash-video-status-deleted",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_DELETED" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
      preview_asset: null,
      file_asset: null,
      blob_asset: null,
      streaming_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({
      locate,
      resolveSwarmSource,
      probeAnchor,
    });

    const result = await 播放器.解析播放结果({
      attachmentId: "att-video-status-deleted",
      kind: "video",
    });

    expect(result).toEqual({
      mode: "degraded",
      attachmentId: "att-video-status-deleted",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "media_deleted",
      hint: "内容已删除",
    });
    expect(resolveSwarmSource).not.toHaveBeenCalled();
    expect(probeAnchor).not.toHaveBeenCalled();
  });

  it("没有可播放锚点时，会回到统一的 anchor_unavailable 降级结果", async () => {
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-expired",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
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
      mode: "degraded",
      attachmentId: "att-video-expired",
      kind: "video",
      src: "",
      thumbnailUrl: null,
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-expired",
        kind: "video",
      })
    );
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
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-video-streaming-expired",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
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
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-streaming-expired",
          join_ticket: null,
          ticket_expires_at: null,
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
      mode: "degraded",
      attachmentId: "att-video-streaming-expired",
      kind: "video",
      src: "",
      thumbnailUrl: "http://media.local/poster-video-streaming-expired",
      reason: "anchor_unavailable",
      hint: "附件当前不可获取",
    });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-streaming-expired",
        kind: "video",
      })
    );
    expect(probeAnchor).not.toHaveBeenCalled();
  });

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
      streaming_asset: null,
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({
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
      streaming_asset: null,
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => {
      throw new 协作分发运行时环境不支持错误();
    });
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({
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
      streaming_asset: null,
      blob_asset: null,
    }));
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const releaseSwarmSource = vi.fn();
    const 播放器 = 创建媒体播放器({
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
