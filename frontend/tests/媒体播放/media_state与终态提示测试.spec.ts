import { describe, expect, it, vi } from "vitest";
import { 创建媒体播放器 } from "../../媒体/媒体播放";
import { Http接口错误 } from "../../平台/传输";

describe("媒体播放器 / media_state 与终态提示", () => {
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

});
