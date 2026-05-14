import { describe, expect, it, vi } from "vitest";

import type { 媒体定位结果 } from "../聊天共享/契约.js";
import { 创建媒体播放器 } from "../媒体/媒体播放.js";

const 构造视频定位 = (webSeedUrl: string | null): 媒体定位结果 => ({
  attachment_id: "att-inline-refresh-1",
  kind: "video",
  status: "ready",
  thumbnail_url: null,
  distribution: {
    content_id: "content-att-inline-refresh-1",
    content_hash: "hash-att-inline-refresh-1",
    swarm_id: "swarm-att-inline-refresh-1",
    web_seed_until: "4102444800",
    torrent_url: "/api/media/att-inline-refresh-1/torrent?ticket=ticket-inline-refresh-1",
    torrent_info_hash: "torrent-info-hash-inline-refresh-1",
    announce_urls: ["wss://127.0.0.1/api/swarm/announce"],
    web_seed_url: webSeedUrl,
    join_ticket: "ticket-inline-refresh-1",
    ticket_expires_at: "2099-01-01T00:00:00Z",
    media_state: {
      code: "MEDIA_READY",
      retry_after_ms: null,
    },
    survival_mode: "peer_only_after_expiry",
    ice_servers: [],
  },
});

describe("媒体播放 locator 刷新", () => {
  it("inline autoplay 播放前会强刷广播 hint 缓存，拿到当前会话 web seed", async () => {
    const 广播定位 = 构造视频定位(null);
    const 权威定位 = 构造视频定位("https://media.local/original-att-inline-refresh-1");
    const locate = vi.fn(async (_attachmentId: string, options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 权威定位 : 广播定位
    );
    const resolveSwarmSource = vi.fn(async () => ({
      src: "/webtorrent/swarm-att-inline-refresh-1/video.mp4",
      hint: null,
      formalByteSource: "webtorrent_official_stream" as const,
    }));
    const player = 创建媒体播放器({ degradedRetryDelays: [],
      locate,
      resolveSwarmSource,
    });

    await player.解析播放结果({
      attachmentId: "att-inline-refresh-1",
      kind: "video",
      surface: "inline_autoplay",
      consumerId: "inline_autoplay:att-inline-refresh-1",
    });

    expect(locate).toHaveBeenCalledWith("att-inline-refresh-1", { forceRefresh: true });
    expect(resolveSwarmSource).toHaveBeenCalledWith(
      expect.objectContaining({
        locator: expect.objectContaining({
          distribution: expect.objectContaining({
            web_seed_url: "https://media.local/original-att-inline-refresh-1",
          }),
        }),
      })
    );
  });

  it("协作分发重试时 await 刷新 locator 获取 web_seed_url，而非 fire-and-forget", async () => {
    let locateCallCount = 0;
    // 第 1 次返回广播 hint 缓存（web_seed_url = null）；第 2 次返回 HTTP 刷新结果（有 web_seed）
    const locate = vi.fn(async (_aid: string, opts?: { forceRefresh?: boolean }) => {
      locateCallCount++;
      const hasWebSeed = opts?.forceRefresh && locateCallCount >= 2;
      return {
        attachment_id: "att-retry-ws",
        kind: "image" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: {
          content_id: "c-retry-ws",
          content_hash: "h-retry-ws",
          swarm_id: "s-retry-ws",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-retry-ws",
          torrent_info_hash: "ih-retry-ws",
          announce_urls: ["wss://tracker.local/announce"],
          web_seed_url: hasWebSeed ? "http://media.local/webseed/att-retry-ws" : null,
          join_ticket: null,
          ticket_expires_at: null,
          media_state: { code: "MEDIA_READY" as const, retry_after_ms: null },
          survival_mode: "server_assisted" as const,
        },
      };
    });
    let resolveCount = 0;
    // 第 1 次 null（广播缓存无 web seed）；第 2 次成功（HTTP 刷新后有 web seed）
    const resolveSwarmSource = vi.fn(async () => {
      resolveCount++;
      if (resolveCount <= 1) return null;
      return {
        src: "blob:http://localhost/retry-ws-blob",
        formalByteSource: "webtorrent_official_stream" as const,
        hint: null,
      };
    });
    const player = 创建媒体播放器({
      degradedRetryDelays: [0],
      swarmConnectingRetryDelays: [],
      locate,
      resolveSwarmSource,
    });

    const result = await player.解析播放结果({
      attachmentId: "att-retry-ws",
      kind: "image",
    });

    // 重试时应该 await locator 刷新（带 web_seed_url），resolveSwarmSource 拿到 web seed 后成功
    expect(result.mode).toBe("swarm");
    expect(result.src).toBe("blob:http://localhost/retry-ws-blob");
    // locate: 1 次初始 + 1 次 await 刷新 + 1 次递归重试里的初始（读刷新后的缓存）= 3 次
    expect(locate).toHaveBeenCalledTimes(3);
    // 第 2 次 locate 应带 forceRefresh: true（await 刷新）
    expect(locate).toHaveBeenNthCalledWith(2, "att-retry-ws", { forceRefresh: true });
  });
});
