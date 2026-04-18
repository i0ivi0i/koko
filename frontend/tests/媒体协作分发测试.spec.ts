import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { 媒体定位结果 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  读取协作分发定位片段,
  重置协作分发浏览器运行时,
  清理协作分发底层会话,
  协作分发JoinTicket失效错误,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../媒体/媒体协作分发";
import {
  创建资产协作分发运行时,
  type 资产协作分发运行时端口,
} from "../媒体/资产协作分发运行时.js";

let 资产协作分发运行时: 资产协作分发运行时端口;

const 解析协作分发源 = (
  ...args: Parameters<资产协作分发运行时端口["解析协作分发源"]>
): ReturnType<资产协作分发运行时端口["解析协作分发源"]> =>
  资产协作分发运行时.解析协作分发源(...args);

const 释放协作分发消费者 = (
  ...args: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>
): void => {
  资产协作分发运行时.释放协作分发消费者(...args);
};

const 读取协作分发会话状态 = (swarmId: string) =>
  资产协作分发运行时.读取会话状态(swarmId);

const 重置资产协作分发运行时 = (): void => {
  资产协作分发运行时.重置();
};

function 创建假Storage(): Storage {
  const records = new Map<string, string>();
  return {
    get length() {
      return records.size;
    },
    clear() {
      records.clear();
    },
    getItem(key: string) {
      return records.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(records.keys())[index] ?? null;
    },
    removeItem(key: string) {
      records.delete(key);
    },
    setItem(key: string, value: string) {
      records.set(key, value);
    },
  };
}

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
    资产协作分发运行时 = 创建资产协作分发运行时();
    重置资产协作分发运行时();
    重置资产协作分发运行时();
    重置资产协作分发运行时();
    重置协作分发浏览器运行时();
  });

  afterEach(() => {
    资产协作分发运行时.销毁();
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

  it("首次初始化失败后不会把 rejected promise 永久缓存，后续条件恢复时会重新尝试并成功创建运行时", async () => {
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
    let firstAttempt = true;
    const readRegistration = vi.fn(async () => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("sw not ready");
      }
      return registration;
    });

    await expect(
      获取或创建协作分发浏览器运行时(async () => fakeCtor, readRegistration)
    ).rejects.toThrow("sw not ready");

    const runtime = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      readRegistration
    );

    expect(runtime).toBeDefined();
    expect(readRegistration).toHaveBeenCalledTimes(2);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledTimes(1);
  });

  it("join_ticket 存在时会通过 getAnnounceOpts 传给 tracker，而不是前端自己拼第二套 announce URL", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-ticket-opts");
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      expect(options.getAnnounceOpts?.()).toEqual({
        ticket: "ticket-att-ticket-opts",
      });
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-ticket-opts");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.join_ticket = "ticket-att-ticket-opts";

    const source = await 解析协作分发源({
      attachmentId: "att-ticket-opts",
      kind: "video",
      locator,
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-ticket-opts",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("当前页还没被根 service worker 接管时，会先请求 active worker 主动 claim 再继续初始化", async () => {
    vi.resetModules();
    let controllerAttached = false;
    const registration = {
      active: {
        state: "activated",
        postMessage: vi.fn((payload: unknown) => {
          if (
            typeof payload === "object" &&
            payload !== null &&
            "type" in payload &&
            (payload as { type?: unknown }).type === "CLAIM_CLIENTS"
          ) {
            controllerAttached = true;
          }
        }),
      },
    };
    const platform = {
      启动: vi.fn(async () => undefined),
      snapshot: () => ({
        serviceWorker: {
          controllerAttached,
        },
      }),
      serviceWorker: {
        读取注册: () => registration,
      },
    };
    vi.doMock("../平台/index.js", () => ({
      获取默认浏览器应用平台: () => platform,
    }));
    const ctorSpy = vi.fn();
    const createServer = vi.fn(() => ({
      close: vi.fn(),
    }));
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = vi.fn();
      destroy = vi.fn();
      remove = vi.fn();
    }
    const mod = await import("../媒体/媒体协作分发");

    const runtime = await mod.获取或创建协作分发浏览器运行时(
      async () => FakeWebTorrent as never
    );

    expect(platform.启动).toHaveBeenCalledTimes(1);
    expect(runtime).toBeDefined();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(registration.active.postMessage).toHaveBeenCalledWith({
      type: "CLAIM_CLIENTS",
    });
    expect(createServer).toHaveBeenCalledWith({
      controller: registration,
    });

    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../平台/index.js");
  });

  it("active worker 请求 claim 后仍未接管页面时，会中止 browser server 初始化并返回明确错误", async () => {
    vi.resetModules();
    const registration = {
      active: {
        state: "activated",
        postMessage: vi.fn(),
      },
    };
    const platform = {
      启动: vi.fn(async () => undefined),
      snapshot: () => ({
        serviceWorker: {
          controllerAttached: false,
        },
      }),
      serviceWorker: {
        读取注册: () => registration,
      },
    };
    vi.doMock("../平台/index.js", () => ({
      获取默认浏览器应用平台: () => platform,
    }));
    const ctorSpy = vi.fn();
    const createServer = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = vi.fn();
      destroy = vi.fn();
      remove = vi.fn();
    }
    const mod = await import("../媒体/媒体协作分发");

    await expect(
      mod.获取或创建协作分发浏览器运行时(async () => FakeWebTorrent as never)
    ).rejects.toThrow("service worker 尚未接管当前页面");

    expect(registration.active.postMessage).toHaveBeenCalledWith({
      type: "CLAIM_CLIENTS",
    });
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(createServer).not.toHaveBeenCalled();
    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../平台/index.js");
  });

  it("client.remove 可用时只走官方移除链，不会再同步二次 destroy 同一 torrent", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn();
    const session = {
      torrentInfoHash: "torrent-info-hash-cleanup-1",
      torrent: {
        destroy,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[0];
    const runtime = {
      client: {
        remove,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[1];

    清理协作分发底层会话(session, runtime);
    await Promise.resolve();

    expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-1", {
      destroyStore: false,
    });
    expect(destroy).not.toHaveBeenCalled();
  });

  it("client.remove 异步失败时会降级 destroy 当前 torrent，而不是把 reject 泄到外面", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("remove failed"));
    const destroy = vi.fn();
    const session = {
      torrentInfoHash: "torrent-info-hash-cleanup-2",
      torrent: {
        destroy,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[0];
    const runtime = {
      client: {
        remove,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[1];

    清理协作分发底层会话(session, runtime);
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-2", {
      destroyStore: false,
    });
    expect(destroy).toHaveBeenCalledWith({
      destroyStore: false,
    });
  });

  it("同一个会话被重复清理时只会走一次 remove，不会把第二次清理变成新的 reject 源", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn();
    const session = {
      torrentInfoHash: "torrent-info-hash-cleanup-3",
      cleanupStarted: false,
      torrent: {
        destroy,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[0];
    const runtime = {
      client: {
        remove,
      },
    } as unknown as Parameters<typeof 清理协作分发底层会话>[1];

    清理协作分发底层会话(session, runtime);
    清理协作分发底层会话(session, runtime);
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-3", {
      destroyStore: false,
    });
    expect(destroy).not.toHaveBeenCalled();
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
      reuseOnly: true,
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

  it("reuseOnly 的 inline_autoplay 不会为冷附件新开 torrent 会话", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-autoplay-cold");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-autoplay-cold",
      kind: "video",
      locator: 准备好的定位结果("att-autoplay-cold"),
      consumerId: "inline_autoplay:att-autoplay-cold",
      reuseOnly: true,
    });

    expect(source).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-autoplay-cold")).toBeNull();
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
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(select).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-image-1")).toMatchObject({
      attachmentId: "att-image-1",
      refs: 1,
      eagerCompleting: false,
      hint: "正在协作分发",
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
      eagerCompleting: true,
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-2",
      hint: "正在补块",
      locallyComplete: false,
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

  it("首次接入协作分发时默认只保当前可播，不立即 whole-file eager 补齐", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, select } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-lazy-backfill-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-lazy-backfill-1",
      kind: "video",
      locator: 准备好的定位结果("att-lazy-backfill-1"),
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-lazy-backfill-1",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(select).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-lazy-backfill-1")).toMatchObject({
      eagerCompleting: false,
      hint: "正在协作分发",
    });
  });

  it("streamURL 当前不可读时，不会把 404 的 webtorrent 地址提前暴露给上层", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-probe-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-probe-1.mp4")) {
          return {
            ok: false,
            status: 404,
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      })
    );
    const { torrent } = 创建可观测假Torrent("/webtorrent/stream-probe-1.mp4");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await expect(
      解析协作分发源({
        attachmentId: "att-stream-probe-1",
        kind: "video",
        locator: 准备好的定位结果("att-stream-probe-1"),
      })
    ).rejects.toThrow(/404/);

    expect(读取协作分发会话状态("swarm-att-stream-probe-1")).toBeNull();
  });

  it("streamURL 首次探测 404 但短时间后可读时，会在同一轮解析内继续返回 swarm 源", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    let probeCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-probe-retry-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-probe-retry-1.mp4")) {
          probeCount += 1;
          if (probeCount === 1) {
            return {
              ok: false,
              status: 404,
            };
          }
          return {
            ok: true,
            status: 206,
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      })
    );
    const { torrent } = 创建可观测假Torrent("/webtorrent/stream-probe-retry-1.mp4");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-stream-probe-retry-1",
      kind: "video",
      locator: 准备好的定位结果("att-stream-probe-retry-1"),
    });

    expect(source).toEqual({
      src: "/webtorrent/stream-probe-retry-1.mp4",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(probeCount).toBe(2);
    expect(读取协作分发会话状态("swarm-att-stream-probe-retry-1")).toMatchObject({
      refs: 1,
    });
  });

  it("streamURL 挂载窗口较长时，会在预算内持续重试而不是过早回退锚点", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    let probeCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-probe-retry-long-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-probe-retry-long-1.mp4")) {
          probeCount += 1;
          if (probeCount <= 10) {
            return {
              ok: false,
              status: 404,
            };
          }
          return {
            ok: true,
            status: 206,
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      })
    );
    const { torrent } = 创建可观测假Torrent("/webtorrent/stream-probe-retry-long-1.mp4");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-stream-probe-retry-long-1",
      kind: "video",
      locator: 准备好的定位结果("att-stream-probe-retry-long-1"),
    });

    expect(source).toEqual({
      src: "/webtorrent/stream-probe-retry-long-1.mp4",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(probeCount).toBe(11);
    expect(读取协作分发会话状态("swarm-att-stream-probe-retry-long-1")).toMatchObject({
      refs: 1,
    });
  });

  it("streamURL 探测期间收到 join_ticket_invalid 时，会优先抛出 ticket 失效语义而不是 404", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    let emittedTicketInvalid = false;
    const { torrent, emit } = 创建可观测假Torrent(
      "/webtorrent/stream-probe-ticket-invalid-1.mp4"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-probe-ticket-invalid-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-probe-ticket-invalid-1.mp4")) {
          if (!emittedTicketInvalid) {
            emittedTicketInvalid = true;
            emit("error", new Error("join_ticket_invalid"));
          }
          return {
            ok: false,
            status: 404,
          };
        }
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      })
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await expect(
      解析协作分发源({
        attachmentId: "att-stream-probe-ticket-invalid-1",
        kind: "video",
        locator: 准备好的定位结果("att-stream-probe-ticket-invalid-1"),
      })
    ).rejects.toBeInstanceOf(协作分发JoinTicket失效错误);
    expect(读取协作分发会话状态("swarm-att-stream-probe-ticket-invalid-1")).toBeNull();
  });

  it("受控 torrent 首次拉到后会缓存元数据，后端临时离线重开时仍能复用本地 swarm 描述", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    vi.stubGlobal("localStorage", 创建假Storage());
    let 在线可拉取Torrent = true;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/torrent-att-offline-reopen")) {
        if (!在线可拉取Torrent) {
          throw new Error("backend offline");
        }
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
        };
      }
      if (url.includes("/webtorrent/offline-reopen.mp4")) {
        return {
          ok: true,
          status: 206,
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const firstTorrent = 创建可观测假Torrent("/webtorrent/offline-reopen.mp4");
    const firstAdd = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(firstTorrent.torrent);
      return firstTorrent.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const firstCtor = 创建假WebTorrent构造器(firstAdd);
    await 获取或创建协作分发浏览器运行时(
      async () => firstCtor.ctor,
      async () => registration
    );

    const locator = 准备好的定位结果("att-offline-reopen");
    const firstSource = await 解析协作分发源({
      attachmentId: "att-offline-reopen",
      kind: "video",
      locator,
    });

    expect(firstSource).toEqual({
      src: "/webtorrent/offline-reopen.mp4",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(firstAdd).toHaveBeenCalledWith(
      new Uint8Array([7, 8, 9]),
      expect.any(Object),
      expect.any(Function)
    );

    重置资产协作分发运行时();
    重置协作分发浏览器运行时();
    在线可拉取Torrent = false;

    const secondTorrent = 创建可观测假Torrent("/webtorrent/offline-reopen.mp4");
    const secondAdd = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(secondTorrent.torrent);
      return secondTorrent.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const secondCtor = 创建假WebTorrent构造器(secondAdd);
    await 获取或创建协作分发浏览器运行时(
      async () => secondCtor.ctor,
      async () => registration
    );

    const reopenedSource = await 解析协作分发源({
      attachmentId: "att-offline-reopen",
      kind: "video",
      locator,
      consumerId: "viewer:att-offline-reopen:reopen",
    });

    expect(reopenedSource).toEqual({
      src: "/webtorrent/offline-reopen.mp4",
      hint: "正在协作分发",
      locallyComplete: false,
    });
    expect(secondAdd).toHaveBeenCalledWith(
      new Uint8Array([7, 8, 9]),
      expect.any(Object),
      expect.any(Function)
    );
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
      hint: "正在协作分发",
      locallyComplete: false,
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

  it("释放最后一个协作分发消费者后会停止 presence 上报，但继续保留补齐中的 swarm 会话", async () => {
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
      eagerCompleting: true,
    });

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    释放协作分发消费者("att-release");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(读取协作分发会话状态("swarm-att-release")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: true,
      hint: "正在补块",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
  });

  it("完整 swarm 在释放最后一个消费者后仍会保留，以便后端退场后继续重开", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-retain-complete"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-retain-complete");
    await 解析协作分发源({
      attachmentId: "att-retain-complete",
      kind: "video",
      locator,
      consumerId: "viewer:att-retain-complete",
    });
    emit("done");

    释放协作分发消费者({
      attachmentId: "att-retain-complete",
      consumerId: "viewer:att-retain-complete",
    });

    expect(读取协作分发会话状态("swarm-att-retain-complete")).toMatchObject({
      refs: 0,
      consumers: [],
      eagerCompleting: false,
      hint: "正在协作分发",
    });
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

  it("只释放其中一个消费者时不会提前 destroy，但未完整的最后一个消费者释放后会清理 swarm", async () => {
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
    expect(读取协作分发会话状态("swarm-att-partial-release")).toBeNull();
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
