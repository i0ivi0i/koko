import { afterEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器媒体定位缓存仓库, 创建媒体定位器 } from "../媒体/媒体定位";

describe("媒体定位器", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("持久化 locator 只保留 nested asset 表面时，仍然可以恢复缓存", async () => {
    const storage = new Map<string, string>();
    const repo = 创建浏览器媒体定位缓存仓库({
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    });

    await repo.保存({
      attachmentId: "att-nested-only-1",
      sessionId: "s-test",
      stale: false,
      value: {
        attachment_id: "att-nested-only-1",
        kind: "video",
        status: "ready",
        thumbnail_url: null,
        file_asset: {
          asset_id: "att-nested-only-1",
          content_hash: "hash-nested-only-1",
          kind: "file_video",
          variants: {
            canonical: {
              id: "canonical",
              url: "http://media.local/canonical-nested-only-1.mp4",
              mime_type: "video/mp4",
              width: 1280,
              height: 720,
            },
          },
          distribution: {
            swarm_id: "swarm-hash-nested-only-1",
            announce_urls: ["wss://tracker.media.local/announce"],
            web_seed_url: "http://media.local/web-seed-nested-only-1",
            join_ticket: null,
            ticket_expires_at: null,
            survival_mode: "server_assisted",
          },
          origin: {
            original_url: "http://media.local/original-nested-only-1",
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only",
          },
        },
        blob_asset: null,
      } as never,
    });

    const restored = await repo.读取("att-nested-only-1");

    expect(restored?.value.attachment_id).toBe("att-nested-only-1");
    expect(restored?.value.file_asset?.origin.original_url).toBe(
      "http://media.local/original-nested-only-1"
    );
  });

  it("同一个 attachment 的 locator 会命中缓存，不重复请求后端", async () => {
    const loadMediaLocator = vi.fn(async () => ({
      attachment_id: "att-1",
      kind: "image" as const,
      status: "ready" as const,
      thumbnail_url: "http://media.local/thumb-1",
      distribution: {
        content_id: "content_att-1",
        content_hash: "hash-att-1",
        swarm_id: "swarm-hash-att-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-att-1",
        torrent_info_hash: "torrent-info-hash-att-1",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-att-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    }));
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    const first = await 定位器.获取定位("att-1");
    const second = await 定位器.获取定位("att-1");

    expect(first.thumbnail_url).toBe("http://media.local/thumb-1");
    expect(second.thumbnail_url).toBe("http://media.local/thumb-1");
    expect(second.distribution?.swarm_id).toBe("swarm-hash-att-1");
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
  });

  it("locator 被标记过期后会重新向后端重签", async () => {
    const loadMediaLocator = vi
      .fn()
      .mockResolvedValueOnce({
        attachment_id: "att-1",
        kind: "video" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: {
          content_id: "content_att-1",
          content_hash: "hash-stale",
          swarm_id: "swarm-hash-stale",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-stale",
          torrent_info_hash: "torrent-info-hash-stale",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-stale",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
      })
      .mockResolvedValueOnce({
        attachment_id: "att-1",
        kind: "video" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: {
          content_id: "content_att-1",
          content_hash: "hash-refresh",
          swarm_id: "swarm-hash-refresh",
          web_seed_until: "1776028800",
          torrent_url: "http://media.local/torrent-refresh",
          torrent_info_hash: "torrent-info-hash-refresh",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-refresh",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
      });
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    await 定位器.获取定位("att-1");
    定位器.标记过期("att-1");
    const refreshed = await 定位器.获取定位("att-1");

    expect(refreshed.distribution?.torrent_url).toBe("http://media.local/torrent-refresh");
    expect(refreshed.distribution?.content_hash).toBe("hash-refresh");
    expect(loadMediaLocator).toHaveBeenCalledTimes(2);
  });

  it("同一个 attachment 并发请求 locator 时会复用同一个 inflight promise", async () => {
    let resolveLocator!: (value: {
      attachment_id: string;
      kind: "video";
      status: "ready";
      thumbnail_url: string | null;
      distribution: {
        content_id: string;
        content_hash: string;
        swarm_id: string;
        web_seed_until: string;
        torrent_url: string;
        torrent_info_hash: string;
        announce_urls: string[];
        web_seed_url: string;
        join_ticket: null;
        ticket_expires_at: null;
        media_state: {
          code: "MEDIA_READY";
          retry_after_ms: null;
        };
        survival_mode: "server_assisted";
      };
    }) => void;
    const loadMediaLocator = vi.fn(
      () =>
        new Promise<{
          attachment_id: string;
          kind: "video";
          status: "ready";
          thumbnail_url: string | null;
          distribution: {
            content_id: string;
            content_hash: string;
            swarm_id: string;
            web_seed_until: string;
            torrent_url: string;
            torrent_info_hash: string;
            announce_urls: string[];
            web_seed_url: string;
            join_ticket: null;
            ticket_expires_at: null;
            media_state: {
              code: "MEDIA_READY";
              retry_after_ms: null;
            };
            survival_mode: "server_assisted";
          };
        }>((resolve) => {
          resolveLocator = resolve;
        })
    );
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    const firstPromise = 定位器.获取定位("att-concurrent-1");
    const secondPromise = 定位器.获取定位("att-concurrent-1");

    await new Promise((resolve) => setTimeout(resolve, 0));

    resolveLocator({
      attachment_id: "att-concurrent-1",
      kind: "video",
      status: "ready",
      thumbnail_url: "http://media.local/thumb-concurrent-1",
      distribution: {
        content_id: "content_att-concurrent-1",
        content_hash: "hash-concurrent-1",
        swarm_id: "swarm-hash-concurrent-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-concurrent-1",
        torrent_info_hash: "torrent-info-hash-concurrent-1",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-concurrent-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted",
      },
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.thumbnail_url).toBe("http://media.local/thumb-concurrent-1");
    expect(second.thumbnail_url).toBe("http://media.local/thumb-concurrent-1");
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
  });

  it("附件退场后会中止旧 locator 请求，并允许下一任 owner 重新发起请求", async () => {
    const 创建中止错误 = () => {
      const error = new Error("locator aborted");
      error.name = "AbortError";
      return error;
    };
    const 首轮定位 = {
      attachment_id: "att-abort-1",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: "http://media.local/thumb-old",
      distribution: {
        content_id: "content_att-abort-1-old",
        content_hash: "hash-abort-1-old",
        swarm_id: "swarm-hash-abort-1-old",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-abort-1-old",
        torrent_info_hash: "torrent-info-hash-abort-1-old",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-abort-1-old",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    };
    const 次轮定位 = {
      attachment_id: "att-abort-1",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: "http://media.local/thumb-new",
      distribution: {
        content_id: "content_att-abort-1-new",
        content_hash: "hash-abort-1-new",
        swarm_id: "swarm-hash-abort-1-new",
        web_seed_until: "1776028800",
        torrent_url: "http://media.local/torrent-abort-1-new",
        torrent_info_hash: "torrent-info-hash-abort-1-new",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-abort-1-new",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    };
    const loadMediaLocator = vi
      .fn<
        (sessionId: string, attachmentId: string, signal?: AbortSignal) => Promise<typeof 首轮定位>
      >()
      .mockImplementationOnce(
        async (_sessionId: string, _attachmentId: string, signal?: AbortSignal) =>
          await new Promise<typeof 首轮定位>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                reject(创建中止错误());
              },
              { once: true }
            );
          })
      )
      .mockResolvedValueOnce(次轮定位);
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
    });

    const staleRequest = 定位器.获取定位("att-abort-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    定位器.放弃未完成定位("att-abort-1");

    await expect(staleRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(定位器.读取缓存("att-abort-1")).toBeNull();

    const current = await 定位器.获取定位("att-abort-1");

    expect(current.thumbnail_url).toBe("http://media.local/thumb-new");
    expect(current.distribution?.content_hash).toBe("hash-abort-1-new");
    expect(loadMediaLocator).toHaveBeenCalledTimes(2);
  });

  it("重新创建定位器后会继续命中持久化 locator，而不是重开页面就重新请求后端", async () => {
    const records = new Map<string, unknown>();
    const repo = {
      async 读取(attachmentId: string) {
        return (
          records.get(attachmentId) as
            | { sessionId?: string; value: unknown; stale: boolean }
            | null
        ) ?? null;
      },
      async 保存(record: {
        attachmentId: string;
        sessionId?: string;
        value: unknown;
        stale: boolean;
      }) {
        records.set(record.attachmentId, record);
      },
    };
    const loadMediaLocator = vi.fn(async () => ({
      attachment_id: "att-1",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-1",
        content_hash: "hash-persisted",
        swarm_id: "swarm-hash-persisted",
        web_seed_until: "1776028800",
        torrent_url: "http://media.local/torrent-persisted",
        torrent_info_hash: "torrent-info-hash-persisted",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-persisted",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    }));

    const 首次定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
      repo,
    } as never);
    await 首次定位器.获取定位("att-1");

    const 重开后定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator: vi.fn(async () => {
        throw new Error("offline");
      }),
      repo,
    } as never);
    const restored = await 重开后定位器.获取定位("att-1");

    expect(restored.distribution?.torrent_url).toBe("http://media.local/torrent-persisted");
    expect(restored.distribution?.swarm_id).toBe("swarm-hash-persisted");
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
  });

  it("不同 session 不会复用旧 locator 持久化缓存，后端失败时必须说真话", async () => {
    const records = new Map<string, unknown>();
    const repo = {
      async 读取(attachmentId: string) {
        return (
          records.get(attachmentId) as
            | {
                attachmentId: string;
                sessionId?: string;
                value: unknown;
                stale: boolean;
              }
            | null
        ) ?? null;
      },
      async 保存(record: {
        attachmentId: string;
        sessionId?: string;
        value: unknown;
        stale: boolean;
      }) {
        records.set(record.attachmentId, record);
      },
    };
    const 首次定位器 = 创建媒体定位器({
      getSessionId: () => "s-old",
      loadMediaLocator: vi.fn(async () => ({
        attachment_id: "att-session-bound-1",
        kind: "video" as const,
        status: "ready" as const,
        thumbnail_url: null,
        distribution: {
          content_id: "content_att-session-bound-1",
          content_hash: "hash-session-bound-1",
          swarm_id: "swarm-hash-session-bound-1",
          web_seed_until: "1776028800",
          torrent_url: "http://media.local/torrent-session-bound-1",
          torrent_info_hash: "torrent-info-hash-session-bound-1",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-session-bound-1",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        },
      })),
      repo,
    } as never);
    await 首次定位器.获取定位("att-session-bound-1");

    const 新会话定位器 = 创建媒体定位器({
      getSessionId: () => "s-new",
      loadMediaLocator: vi.fn(async () => {
        throw new Error("offline");
      }),
      repo,
    } as never);

    await expect(新会话定位器.获取定位("att-session-bound-1")).rejects.toThrow("offline");
  });

  it("同 session 的 WebTorrent join ticket 已过期时，不能继续命中旧 locator", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T12:00:00.000Z"));

    const records = new Map<string, unknown>();
    const repo = {
      async 读取(attachmentId: string) {
        return (
          records.get(attachmentId) as
            | {
                attachmentId: string;
                sessionId?: string;
                value: unknown;
                stale: boolean;
              }
            | null
        ) ?? null;
      },
      async 保存(record: {
        attachmentId: string;
        sessionId?: string;
        value: unknown;
        stale: boolean;
      }) {
        records.set(record.attachmentId, record);
      },
    };
    records.set("att-expired-ticket-1", {
      attachmentId: "att-expired-ticket-1",
      sessionId: "s-test",
      stale: false,
      value: {
        attachment_id: "att-expired-ticket-1",
        kind: "video",
        status: "ready",
        thumbnail_url: null,
        distribution: {
          content_id: "content_att-expired-ticket-1",
          content_hash: "hash-expired",
          swarm_id: "swarm-hash-expired",
          web_seed_until: "1778150000",
          torrent_url: "http://media.local/torrent-expired",
          torrent_info_hash: "torrent-info-hash-expired",
          announce_urls: ["wss://tracker.media.local/announce"],
          web_seed_url: "http://media.local/web-seed-expired",
          join_ticket: "expired-ticket",
          ticket_expires_at: "2026-05-06T11:59:00.000Z",
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "peer_only_after_expiry" as const,
        },
      },
    });
    const loadMediaLocator = vi.fn(async () => ({
      attachment_id: "att-expired-ticket-1",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-expired-ticket-1",
        content_hash: "hash-fresh",
        swarm_id: "swarm-hash-fresh",
        web_seed_until: "1778150000",
        torrent_url: "http://media.local/torrent-fresh",
        torrent_info_hash: "torrent-info-hash-fresh",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-fresh",
        join_ticket: "fresh-ticket",
        ticket_expires_at: "2026-05-06T12:02:00.000Z",
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
    }));
    const 定位器 = 创建媒体定位器({
      getSessionId: () => "s-test",
      loadMediaLocator,
      repo,
    } as never);

    const locator = await 定位器.获取定位("att-expired-ticket-1");

    expect(locator.distribution?.join_ticket).toBe("fresh-ticket");
    expect(locator.distribution?.torrent_url).toBe("http://media.local/torrent-fresh");
    expect(loadMediaLocator).toHaveBeenCalledTimes(1);
  });
});
