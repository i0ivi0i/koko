import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器, 媒体是否默认循环播放 } from "../../媒体/媒体播放";
import { 协作分发JoinTicket失效错误 } from "../../媒体/媒体协作分发";

describe("媒体播放器 / 主链与 swarm 裁决", () => {
  it("媒体播放模块不应继续保留第二链旧叙事", () => {
    const source = readFileSync(new URL("../../媒体/媒体播放.ts", import.meta.url), "utf-8");
    expect(source.includes("streaming_asset")).toBe(false);
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
      formalByteSource: "webtorrent_official_stream",
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
      formalByteSource: "webtorrent_official_stream",
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
      formalByteSource: "webtorrent_official_stream",
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
      formalByteSource: "webtorrent_official_stream",
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
      formalByteSource: "webtorrent_official_stream",
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
      formalByteSource: "webtorrent_official_stream",
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

});
