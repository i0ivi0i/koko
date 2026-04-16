import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { 媒体定位结果 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  解析协作分发源,
  释放协作分发消费者,
  读取协作分发定位片段,
  读取协作分发会话状态,
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../媒体/媒体协作分发";

function 准备好的定位结果(
  attachmentId: string,
  kind: 媒体定位结果["kind"] = "video"
): 媒体定位结果 {
  return {
    attachment_id: attachmentId,
    kind,
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
      survival_mode: "server_assisted" as const,
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
  const closeServer = vi.fn();
  const createServer = vi.fn().mockReturnValue({ close: closeServer });
  const destroy = vi.fn();
  const remove = vi.fn();
  class FakeWebTorrent {
    createServer = createServer;

    add = add;

    destroy = destroy;

    remove = remove;
  }
  return {
    ctor: FakeWebTorrent as unknown as new () => WebTorrent浏览器客户端,
    createServer,
    closeServer,
    destroy,
    remove,
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
        survival_mode: "server_assisted" as const,
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
      survival_mode: "server_assisted" as const,
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
    expect(读取协作分发会话状态("swarm-att-1")).toMatchObject({
      refs: 1,
    });
  });

  it("同一附件的时间线会话和 inline_autoplay 会共享同一个 torrent 会话，但互不误释放", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-multi-1");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-multi-1");
    const sessionSource = await 解析协作分发源({
      attachmentId: "att-multi-1",
      kind: "video",
      locator,
      consumerId: "session:att-multi-1",
    });
    const autoplaySource = await 解析协作分发源({
      attachmentId: "att-multi-1",
      kind: "video",
      locator,
      consumerId: "inline_autoplay:att-multi-1",
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(sessionSource).toEqual(autoplaySource);
    expect(读取协作分发会话状态("swarm-att-multi-1")).toMatchObject({
      refs: 2,
      consumers: ["session:att-multi-1", "inline_autoplay:att-multi-1"],
    });

    释放协作分发消费者({
      attachmentId: "att-multi-1",
      consumerId: "inline_autoplay:att-multi-1",
    });

    expect(读取协作分发会话状态("swarm-att-multi-1")).toMatchObject({
      refs: 1,
      consumers: ["session:att-multi-1"],
    });
  });

  it("图片也会复用同一套协作分发 runtime，而不是分叉第二套实现", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, select } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-image-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-image-1",
      kind: "image",
      locator: 准备好的定位结果("att-image-1", "image"),
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-image-1",
      hint: "正在补块",
    });
    expect(select).toHaveBeenCalledWith(1);
    expect(读取协作分发会话状态("swarm-att-image-1")).toMatchObject({
      attachmentId: "att-image-1",
      refs: 1,
      eagerCompleting: true,
      hint: "正在补块",
    });
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

  it("开始协作分发后会尝试请求 storage.persist，但失败不会中断 swarm 会话", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const persist = vi.fn(async () => {
      throw new Error("persist denied");
    });
    vi.stubGlobal("navigator", {
      storage: {
        persist,
      },
    });
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-persist");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-persist",
      kind: "video",
      locator: 准备好的定位结果("att-persist"),
    });
    await Promise.resolve();

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-persist",
      hint: "正在补块",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("torrent done 后会发出完整资产事件，而不只是改 hint", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-4");
    const 事件记录: Array<{
      type: string;
      attachmentId: string;
      swarmId: string;
      contentHash?: string;
    }> = [];
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-4",
      kind: "video",
      locator: 准备好的定位结果("att-4"),
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    emit("done");

    expect(事件记录).toContainEqual({
      type: "ASSET_COMPLETE",
      attachmentId: "att-4",
      swarmId: "swarm-att-4",
      contentHash: "hash-att-4",
    });
  });

  it("noPeers 后不会直接宣布失败，而是发出等待恢复信号", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-5");
    const 事件记录: Array<{ type: string; attachmentId: string; swarmId: string }> = [];
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-5",
      kind: "video",
      locator: 准备好的定位结果("att-5"),
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    emit("noPeers");

    expect(事件记录).toContainEqual({
      type: "SWARM_NO_PEERS",
      attachmentId: "att-5",
      swarmId: "swarm-att-5",
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

  it("释放最后一个协作分发消费者后会停止 presence 上报并清掉会话", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-release");
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-release")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-release/presence");
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
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-release");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url = "/api/media/att-release/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-release",
      kind: "video",
      locator,
    });

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    释放协作分发消费者("att-release");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(读取协作分发会话状态("swarm-att-release")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith("torrent-info-hash-att-release", {
      destroyStore: false,
    });
  });

  it("只释放其中一个消费者时，不会提前 destroy torrent/runtime", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-partial-release");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-partial-release");
    await 解析协作分发源({
      attachmentId: "att-partial-release",
      kind: "video",
      locator,
      consumerId: "session:att-partial-release",
    });
    await 解析协作分发源({
      attachmentId: "att-partial-release",
      kind: "video",
      locator,
      consumerId: "inline_autoplay:att-partial-release",
    });

    释放协作分发消费者({
      attachmentId: "att-partial-release",
      consumerId: "inline_autoplay:att-partial-release",
    });

    expect(remove).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-partial-release")).toMatchObject({
      refs: 1,
      consumers: ["session:att-partial-release"],
    });

    释放协作分发消费者({
      attachmentId: "att-partial-release",
      consumerId: "session:att-partial-release",
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("重置协作分发运行时时会关闭 stream server 并销毁 WebTorrent client", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const add = vi.fn((() => {
      throw new Error("test should not call add");
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, closeServer, destroy } = 创建假WebTorrent构造器(add);

    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);
    重置协作分发浏览器运行时();

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
