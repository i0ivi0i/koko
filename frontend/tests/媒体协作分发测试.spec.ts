import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  获取或创建协作分发浏览器运行时,
  读取协作分发定位片段,
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
} from "../媒体/媒体协作分发";

describe("媒体协作分发", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    重置协作分发浏览器运行时();
  });

  it("会从 locator 中读出稳定的协作分发片段", () => {
    const distribution = 读取协作分发定位片段({
      attachment_id: "att-1",
      kind: "video",
      status: "ready",
      original_url: "http://media.local/original-1",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-1",
        content_hash: "hash-1",
        swarm_id: "swarm-hash-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-1",
        torrent_info_hash: "torrent-info-hash-1",
        announce_urls: ["http://media.local/announce"],
        web_seed_url: "http://media.local/web-seed-1",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
      },
    });

    expect(distribution).toEqual({
      content_id: "content_att-1",
      content_hash: "hash-1",
      swarm_id: "swarm-hash-1",
      web_seed_until: "1775942400",
      torrent_url: "http://media.local/torrent-1",
      torrent_info_hash: "torrent-info-hash-1",
      announce_urls: ["http://media.local/announce"],
      web_seed_url: "http://media.local/web-seed-1",
      join_ticket: null,
      ticket_expires_at: null,
      availability: "available" as const,
    });
  });

  it("locator 没有协作分发片段时返回 null", () => {
    const distribution = 读取协作分发定位片段({
      attachment_id: "att-2",
      kind: "image",
      status: "ready",
      original_url: "http://media.local/original-2",
      thumbnail_url: "http://media.local/thumb-2",
      distribution: null,
    });

    expect(distribution).toBeNull();
  });

  it("浏览器协作分发运行时会复用同一个 WebTorrent client，并把已激活的 service worker registration 传给 createServer", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    } as ServiceWorkerRegistration;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          ready: Promise.resolve(registration),
        },
      },
      configurable: true,
    });
    const createServer = vi.fn().mockReturnValue({ close: vi.fn() });
    const ctorSpy = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;

      add = (() => {
        throw new Error("test should not call add");
      }) as WebTorrent浏览器客户端["add"];
    }
    const fakeCtor = FakeWebTorrent as unknown as new () => WebTorrent浏览器客户端;

    const first = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor
    );
    const second = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor
    );

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith({ controller: registration });
    expect(first).toBe(second);
  });
});
