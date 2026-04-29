import { describe, expect, it, vi } from "vitest";
import { 刷新已有做种会话 } from "../dev-seeder.mjs";

describe("dev-seeder 做种续租", () => {
  it("做种 sidecar 默认允许高活跃群聊同时维护多 torrent 监听器", async () => {
    const { 读取做种监听器预算 } = (await import("../dev-seeder.mjs")) as unknown as {
      读取做种监听器预算(raw?: string): number;
    };

    expect(读取做种监听器预算()).toBeGreaterThanOrEqual(64);
    expect(读取做种监听器预算("96")).toBe(96);
    expect(读取做种监听器预算("0")).toBeGreaterThanOrEqual(64);
    expect(读取做种监听器预算("not-a-number")).toBeGreaterThanOrEqual(64);
  });

  it("同 infohash 的 start 即使 source URL 变化也只刷新 ticket 不重建会话", () => {
    const existing = {
      infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "http://127.0.0.1:8080/api/media/att-old/torrent?session_id=s-1",
      joinTicket: "ticket-old",
      announceTicketRef: { value: "ticket-old" },
      torrent: { destroy: vi.fn() },
      addedAt: new Date().toISOString(),
    };

    const result = 刷新已有做种会话(existing, {
      source: "http://127.0.0.1:8080/api/media/att-new/torrent?session_id=s-1",
      joinTicket: "ticket-new",
    });

    expect(result).toEqual({
      created: false,
      refreshedTicket: true,
      restarted: false,
      sourceChanged: true,
    });
    expect(existing.joinTicket).toBe("ticket-new");
    expect(existing.announceTicketRef.value).toBe("ticket-new");
    expect(existing.source).toContain("att-new");
  });

  it("同 infohash 续租请求缺少 join ticket 时不会清空旧票据", () => {
    const existing = {
      infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "http://127.0.0.1:8080/api/media/att-old/torrent?session_id=s-1",
      joinTicket: "ticket-old",
      announceTicketRef: { value: "ticket-old" },
      torrent: { destroy: vi.fn() },
      addedAt: new Date().toISOString(),
    };

    const result = 刷新已有做种会话(existing, {
      source: "http://127.0.0.1:8080/api/media/att-new/torrent?session_id=s-1",
      joinTicket: null,
    });

    expect(result).toEqual({
      created: false,
      refreshedTicket: false,
      restarted: false,
      sourceChanged: true,
    });
    expect(existing.joinTicket).toBe("ticket-old");
    expect(existing.announceTicketRef.value).toBe("ticket-old");
    expect(existing.source).toContain("att-new");
  });

  it("新做种会话缺少 join ticket 时直接拒绝启动，不允许无票 announce", async () => {
    const module = (await import("../dev-seeder.mjs")) as unknown as {
      启动做种会话?: (payload: unknown) => Promise<unknown>;
    };

    expect(typeof module.启动做种会话).toBe("function");
    await expect(
      module.启动做种会话?.({
        infoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        announceUrls: ["ws://127.0.0.1:18080/api/swarm/announce"],
        torrentUrl: "http://127.0.0.1:8080/api/media/att/torrent?session_id=s-1",
        joinTicket: null,
      })
    ).rejects.toThrow("缺少 join ticket");
  });
});
