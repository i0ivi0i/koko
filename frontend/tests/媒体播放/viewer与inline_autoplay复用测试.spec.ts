import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器 } from "../../媒体/媒体播放";

describe("媒体播放器 / viewer 与 inline_autoplay 复用", () => {
  it("viewer 与 inline_autoplay 在同一定位输入下，会裁决到同一条 swarm 首播真相", async () => {
    const resolveSwarmSource = vi.fn(async () => ({
      src: "blob:http://media.local/swarm-video-shared-truth",
      hint: "正在协作分发" as const,
      locallyComplete: true,
    }));
    const probeAnchor = vi.fn();
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
      formalByteSource: "webtorrent_official_stream",
    });
    expect(inlineResult).toEqual({
      mode: "swarm",
      attachmentId: "att-video-shared-truth",
      kind: "video",
      src: "blob:http://media.local/swarm-video-shared-truth",
      thumbnailUrl: "http://media.local/poster-shared-truth",
      hint: "正在协作分发",
      formalByteSource: "webtorrent_official_stream",
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
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
        // 单文件主链场景不再带任何第二链兼容字段。
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
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
      formalByteSource: "webtorrent_official_stream",
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
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
      formalByteSource: "webtorrent_official_stream",
    });
  });

  it("inline_autoplay 在没有可复用 swarm 时，会保持降级态而不是回退锚点冷源", async () => {
    const resolveSwarmSource = vi.fn(async () => null);
    const probeAnchor = vi.fn(async () => undefined);
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
    const 播放器 = 创建媒体播放器({ degradedRetryDelays: [],
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
      formalByteSource: "webtorrent_official_stream",
    });
  });

});
