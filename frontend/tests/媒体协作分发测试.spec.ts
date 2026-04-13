import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { 媒体定位结果 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  解析协作分发源,
  读取协作分发定位片段,
  读取协作分发会话状态,
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../媒体/媒体协作分发";

function 准备好的定位结果(attachmentId: string): 媒体定位结果 {
  return {
    attachment_id: attachmentId,
    kind: "video" as const,
    status: "ready" as const,
    original_url: `http://media.local/original-${attachmentId}`,
    thumbnail_url: null,
    distribution: {
      content_id: `content_${attachmentId}`,
      content_hash: `hash-${attachmentId}`,
      swarm_id: `swarm-${attachmentId}`,
      web_seed_until: "1775942400",
      torrent_url: `http://media.local/torrent-${attachmentId}`,
      torrent_info_hash: `torrent-info-hash-${attachmentId}`,
      announce_urls: ["ws://127.0.0.1:7072"],
      web_seed_url: `http://media.local/web-seed-${attachmentId}`,
      join_ticket: null,
      ticket_expires_at: null,
      availability: "available" as const,
    },
  };
}

function 准备已激活媒体ServiceWorker注册() {
  const registration = {
    active: {
      state: "activated",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
  return registration;
}

function 创建可观测假Torrent(streamURL: string) {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {
    error: [],
    wire: [],
    noPeers: [],
    done: [],
  };
  const select = vi.fn();
  const torrent = {
    files: [
      {
        streamURL,
        select,
      },
    ],
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
  } as unknown as WebTorrent种子;

  return {
    torrent,
    select,
    emit(event: "error" | "wire" | "noPeers" | "done", ...args: unknown[]) {
      const eventHandlers = handlers[event] ?? [];
      for (const handler of eventHandlers) {
        handler(...args);
      }
    },
  };
}

function 创建假WebTorrent构造器(add: WebTorrent浏览器客户端["add"]) {
  const createServer = vi.fn().mockReturnValue({ close: vi.fn() });
  class FakeWebTorrent {
    createServer = createServer;

    add = add;
  }
  return {
    ctor: FakeWebTorrent as unknown as new () => WebTorrent浏览器客户端,
    createServer,
  };
}

describe("媒体协作分发", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
    重置协作分发浏览器运行时();
  });

  afterEach(() => {
    重置协作分发浏览器运行时();
    vi.useRealTimers();
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
    };
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
      async () => fakeCtor,
      async () => registration
    );
    const second = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      async () => registration
    );

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith({ controller: registration });
    expect(first).toBe(second);
  });

  it("同一 attachment 在同一页面被再次打开时会复用同一个 torrent 会话", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-1");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-1");
    const first = await 解析协作分发源({
      attachmentId: "att-1",
      kind: "video",
      locator,
    });
    const second = await 解析协作分发源({
      attachmentId: "att-1",
      kind: "video",
      locator,
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("开始查看后会继续补齐整个附件，并用官方事件更新运行态提示", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, select, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-2"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-2",
      kind: "video",
      locator: 准备好的定位结果("att-2"),
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-2",
      hint: "正在补块",
    });
    expect(select).toHaveBeenCalledWith(1);
    expect(读取协作分发会话状态("swarm-att-2")).toMatchObject({
      eagerCompleting: true,
      hint: "正在补块",
    });

    emit("wire", { type: "peer" });
    expect(读取协作分发会话状态("swarm-att-2")?.hint).toBe("正在协作分发");

    emit("noPeers");
    expect(读取协作分发会话状态("swarm-att-2")?.hint).toBe("正在补块");

    emit("done");
    expect(读取协作分发会话状态("swarm-att-2")).toMatchObject({
      eagerCompleting: false,
      hint: "正在协作分发",
    });
  });

  it("开始协作分发后会按 presence_url 周期上报存活，而不是前端自己裁决 expired", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-3");
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-3")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-3/presence");
      expect(init?.method).toBe("POST");
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-3");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url = "/api/media/att-3/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-3",
      kind: "video",
      locator,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
