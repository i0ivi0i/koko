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
});
