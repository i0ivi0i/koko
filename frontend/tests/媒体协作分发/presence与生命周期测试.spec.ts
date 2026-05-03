import { describe, expect, it, vi } from "vitest";
import { 获取或创建协作分发浏览器运行时, 重置协作分发浏览器运行时, type WebTorrent浏览器客户端 } from "../../媒体/媒体协作分发";
import {
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册媒体协作分发测试基线,
  解析协作分发源,
  读取协作分发会话状态,
  释放协作分发消费者,
} from "./测试支撑";

describe("媒体协作分发 / presence 与生命周期", () => {
  注册媒体协作分发测试基线();
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
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
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
      eagerCompleting: true,
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

  it("真正进入帮助链的 backfill 会话只有拿到真实群友字节后才会上报 partial_peer", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-3");
    const presenceBodies: string[] = [];
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
      presenceBodies.push(String(init?.body ?? ""));
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
      eagerCompleting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenceBodies).toEqual([]);
    emit("download", 128);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(presenceBodies).toEqual([expect.stringContaining("partial_peer")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(presenceBodies).toEqual([
      expect.stringContaining("partial_peer"),
      expect.stringContaining("partial_peer"),
    ]);
  });

  it("preview consumer 就算连上真实群友，也不能冒充帮助者上报 partial_peer", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-preview-silent");
    const presenceBodies: string[] = [];
    const 事件记录: Array<{ type: string; attachmentId: string; swarmId: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-preview-silent")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-preview-silent/presence");
      expect(init?.method).toBe("POST");
      presenceBodies.push(String(init?.body ?? ""));
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

    const locator = 准备好的定位结果("att-preview-silent");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-preview-silent/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-preview-silent",
      kind: "video",
      locator,
      consumerId: "preview:att-preview-silent",
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenceBodies).toEqual([]);
    expect(事件记录).toEqual([]);
  });

  it("普通 session consumer 就算连上真实群友，也不能在真正自动播前晋升帮助资格", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-session-silent");
    const presenceBodies: string[] = [];
    const 事件记录: Array<{ type: string; attachmentId: string; swarmId: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-session-silent")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-session-silent/presence");
      expect(init?.method).toBe("POST");
      presenceBodies.push(String(init?.body ?? ""));
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

    const locator = 准备好的定位结果("att-session-silent");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-session-silent/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-session-silent",
      kind: "video",
      locator,
      consumerId: "session:att-session-silent",
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenceBodies).toEqual([]);
    expect(事件记录).toEqual([
      {
        type: "ASSET_COMPLETE",
        attachmentId: "att-session-silent",
        swarmId: "swarm-att-session-silent",
        contentHash: "hash-att-session-silent",
      },
    ]);
  });

  it("webSeed 只说明冷源可读，不会上报 partial_peer 或触发 SWARM_ACTIVE", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-webseed-only");
    const presenceBodies: string[] = [];
    const 事件记录: Array<{ type: string; attachmentId: string; swarmId: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-webseed-only")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-webseed-only/presence");
      expect(init?.method).toBe("POST");
      presenceBodies.push(String(init?.body ?? ""));
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

    const locator = 准备好的定位结果("att-webseed-only");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-webseed-only/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-webseed-only",
      kind: "video",
      locator,
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "webSeed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenceBodies).toEqual([]);
    expect(事件记录).toEqual([]);
    expect(读取协作分发会话状态("swarm-att-webseed-only")).toMatchObject({
      locallyComplete: false,
      hint: null,
    });
  });

  it("真正进入帮助链的 backfill 会话在 done 后会把 presence 从 partial_peer 升级为 complete_peer", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-presence-upgrade");
    const presenceBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-presence-upgrade")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-presence-upgrade/presence");
      expect(init?.method).toBe("POST");
      presenceBodies.push(String(init?.body ?? ""));
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

    const locator = 准备好的定位结果("att-presence-upgrade");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-presence-upgrade/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-presence-upgrade",
      kind: "video",
      locator,
      eagerCompleting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    emit("download", 128);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    emit("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(presenceBodies).toEqual([
      expect.stringContaining("partial_peer"),
      expect.stringContaining("complete_peer"),
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(presenceBodies).toEqual([
      expect.stringContaining("partial_peer"),
      expect.stringContaining("complete_peer"),
      expect.stringContaining("complete_peer"),
    ]);
  });

  it("帮助链会话在没有真实 peer 证据时，done 也只代表本地完整，不能升级成 complete_peer", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-done-without-peer");
    const presenceBodies: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-done-without-peer")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-done-without-peer/presence");
      expect(init?.method).toBe("POST");
      presenceBodies.push(String(init?.body ?? ""));
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

    const locator = 准备好的定位结果("att-done-without-peer");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-done-without-peer/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-done-without-peer",
      kind: "video",
      locator,
      consumerId: "session:att-done-without-peer",
      eagerCompleting: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "webSeed" });
    emit("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenceBodies).toEqual([]);
    expect(读取协作分发会话状态("swarm-att-done-without-peer")).toMatchObject({
      locallyComplete: true,
      hint: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("释放最后一个协作分发消费者后，已拿到群友字节的未完成 swarm 只会短时保活 partial_peer，随后降回轻帮助态", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent("blob:http://media.local/swarm-att-release");
    const presenceBodies: string[] = [];
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
      presenceBodies.push(String(init?.body ?? ""));
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
      eagerCompleting: true,
    });

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    emit("download", 128);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    释放协作分发消费者("att-release");
    await vi.advanceTimersByTimeAsync(29_000);

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: true,
      hint: "正在协作分发",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: true,
      hint: "正在补块",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(presenceBodies).toEqual([expect.stringContaining("partial_peer")]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("完整 swarm 在释放最后一个消费者后仍会保留，并继续上报 complete_peer heartbeat", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-retain-complete"
    );
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/torrent-att-retain-complete")) {
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      }
      expect(url).toContain("/api/media/att-retain-complete/presence");
      expect(init?.method).toBe("POST");
      expect(String(init?.body ?? "")).toContain("complete_peer");
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

    const locator = 准备好的定位结果("att-retain-complete");
    expect(locator.distribution).not.toBeNull();
    locator.distribution!.presence_url =
      "/api/media/att-retain-complete/presence?session_id=s-test";
    await 解析协作分发源({
      attachmentId: "att-retain-complete",
      kind: "video",
      locator,
      consumerId: "viewer:att-retain-complete",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit("wire", { type: "peer" });
    emit("download", 128);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    emit("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    释放协作分发消费者({
      attachmentId: "att-retain-complete",
      consumerId: "viewer:att-retain-complete",
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(读取协作分发会话状态("swarm-att-retain-complete")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: false,
      hint: "正在协作分发",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(remove).not.toHaveBeenCalled();

    await 解析协作分发源({
      attachmentId: "att-retain-complete",
      kind: "video",
      locator,
      consumerId: "viewer:att-retain-complete-reopen",
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(读取协作分发会话状态("swarm-att-retain-complete")).toMatchObject({
      refs: 1,
      consumers: ["viewer:att-retain-complete-reopen"],
      eagerCompleting: false,
    });
  });

  it("只释放其中一个消费者时不会提前 destroy，未完整的最后一个消费者释放后也会保留补齐中的 swarm", async () => {
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

    expect(remove).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-partial-release")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: true,
      hint: "正在补块",
    });
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
