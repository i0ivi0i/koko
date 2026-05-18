import { describe, expect, it, vi } from "vitest";
import {
  获取或创建协作分发浏览器运行时,
  清理协作分发底层会话,
  协作分发JoinTicket失效错误,
  重置协作分发浏览器运行时,
  type 协作分发会话事件,
  type WebTorrent浏览器客户端,
} from "../../媒体/媒体协作分发";
import {
  创建假Storage,
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册媒体协作分发测试基线,
  解析协作分发源,
  读取协作分发会话状态,
  释放协作分发消费者,
  重置资产协作分发运行时,
} from "./测试支撑";

const 创建可读探测响应 = (): Response =>
  new Response(Uint8Array.from([1, 2]), {
    status: 206,
  });

describe("媒体协作分发 / 会话复用与流探测", () => {
  注册媒体协作分发测试基线();
  it("client.remove 可用时只走官方移除链，不会再同步二次 destroy 同一 torrent", async () => {
    vi.useFakeTimers();
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

    try {
      清理协作分发底层会话(session, runtime);
      expect(remove).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);

      expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-1", {
        destroyStore: false,
      });
      expect(destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("client.remove 异步失败时会降级 destroy 当前 torrent，而不是把 reject 泄到外面", async () => {
    vi.useFakeTimers();
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

    try {
      清理协作分发底层会话(session, runtime);
      expect(remove).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-2", {
        destroyStore: false,
      });
      expect(destroy).toHaveBeenCalledWith({
        destroyStore: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一个会话被重复清理时只会走一次 remove，不会把第二次清理变成新的 reject 源", async () => {
    vi.useFakeTimers();
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

    try {
      清理协作分发底层会话(session, runtime);
      清理协作分发底层会话(session, runtime);
      expect(remove).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("torrent-info-hash-cleanup-3", {
        destroyStore: false,
      });
      expect(destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    expect(sessionSource).toEqual({
      src: "blob:http://media.local/swarm-att-multi-1",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(autoplaySource).toEqual({
      src: "blob:http://media.local/swarm-att-multi-1",
      hint: "正在补块",
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(读取协作分发会话状态("swarm-att-multi-1")).toMatchObject({
      refs: 2,
      consumers: ["session:att-multi-1", "inline_autoplay:att-multi-1"],
      eagerCompleting: true,
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

  it("inline_autoplay 命中冷附件时也会冷启动同一条 swarm 会话，不再保留 reuseOnly 保守门槛", async () => {
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
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-autoplay-cold",
      hint: "正在补块",
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(读取协作分发会话状态("swarm-att-autoplay-cold")).toMatchObject({
      refs: 1,
      consumers: ["inline_autoplay:att-autoplay-cold"],
      eagerCompleting: true,
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
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(select).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-image-1")).toMatchObject({
      attachmentId: "att-image-1",
      refs: 1,
      eagerCompleting: false,
      hint: null,
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
      formalByteSource: "webtorrent_official_stream",
    });
    expect(select).toHaveBeenCalledWith(1);
    expect(读取协作分发会话状态("swarm-att-2")).toMatchObject({
      eagerCompleting: true,
      hint: "正在补块",
    });

    emit("wire", { type: "peer" });
    expect(读取协作分发会话状态("swarm-att-2")?.hint).toBe("正在补块");
    emit("download", 128);
    expect(读取协作分发会话状态("swarm-att-2")?.hint).toBe("正在协作分发");

    emit("noPeers");
    expect(读取协作分发会话状态("swarm-att-2")?.hint).toBe("正在补块");

    emit("done");
    expect(读取协作分发会话状态("swarm-att-2")).toMatchObject({
      eagerCompleting: false,
      hint: "正在协作分发",
    });
  });

  it("首次接入协作分发时默认只建轻会话，不会立刻推进 whole-file eager completing", async () => {
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
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(select).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-lazy-backfill-1")).toMatchObject({
      eagerCompleting: false,
      hint: null,
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

  it("已解析的 streamURL 后续不可读时，会丢弃旧 swarm 而不是继续返回坏播放源", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    let streamReadable = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-stale-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-stale-1.mp4")) {
          return streamReadable
            ? 创建可读探测响应()
            : {
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
    const { torrent } = 创建可观测假Torrent("/webtorrent/stream-stale-1.mp4");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstSource = await 解析协作分发源({
      attachmentId: "att-stream-stale-1",
      kind: "video",
      locator: 准备好的定位结果("att-stream-stale-1"),
    });
    streamReadable = false;

    await expect(
      解析协作分发源({
        attachmentId: "att-stream-stale-1",
        kind: "video",
        locator: 准备好的定位结果("att-stream-stale-1"),
      })
    ).rejects.toThrow(/404/);

    expect(firstSource).toEqual({
      src: "/webtorrent/stream-stale-1.mp4",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(读取协作分发会话状态("swarm-att-stream-stale-1")).toBeNull();
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
          return 创建可读探测响应();
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
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
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
          return 创建可读探测响应();
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
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
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

  it("streamURL 探测期间若 tracker 通过 warning 返回 join_ticket_invalid，也会抛出 ticket 失效语义", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    let emittedTicketInvalid = false;
    const { torrent, emit } = 创建可观测假Torrent(
      "/webtorrent/stream-probe-ticket-warning-invalid-1.mp4"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-stream-probe-ticket-warning-invalid-1")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/stream-probe-ticket-warning-invalid-1.mp4")) {
          if (!emittedTicketInvalid) {
            emittedTicketInvalid = true;
            emit("warning", new Error("join_ticket_invalid"));
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
        attachmentId: "att-stream-probe-ticket-warning-invalid-1",
        kind: "video",
        locator: 准备好的定位结果("att-stream-probe-ticket-warning-invalid-1"),
      })
    ).rejects.toBeInstanceOf(协作分发JoinTicket失效错误);
    expect(读取协作分发会话状态("swarm-att-stream-probe-ticket-warning-invalid-1")).toBeNull();
  });

  it("会话已连上群友后收到 warning=join_ticket_invalid 不会立刻销毁会话并触发恢复风暴", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    const 事件记录: Array<协作分发会话事件["type"]> = [];
    const { torrent, emit } = 创建可观测假Torrent("/webtorrent/warning-after-wire.mp4");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/torrent-att-warning-after-wire")) {
          return {
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }
        if (url.includes("/webtorrent/warning-after-wire.mp4")) {
          return 创建可读探测响应();
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

    const source = await 解析协作分发源({
      attachmentId: "att-warning-after-wire",
      kind: "video",
      locator: 准备好的定位结果("att-warning-after-wire"),
      onSessionEvent: (event) => {
        事件记录.push(event.type);
      },
    });
    expect(source).toMatchObject({
      src: "/webtorrent/warning-after-wire.mp4",
    });
    expect(读取协作分发会话状态("swarm-att-warning-after-wire")).not.toBeNull();

    // 先标记会话已经连上群友，再注入 warning 级 ticket-invalid。
    emit("wire", { type: "webSeed" });
    emit("warning", new Error("join_ticket_invalid"));
    await Promise.resolve();
    await Promise.resolve();

    expect(事件记录).not.toContain("SWARM_TICKET_INVALID");
    expect(读取协作分发会话状态("swarm-att-warning-after-wire")).not.toBeNull();
  });

  it("受控 torrent 首次拉到后会缓存元数据，后端临时离线重开时仍能复用本地 swarm 描述", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    vi.stubGlobal("window", {
      // 协作分发缓存必须走浏览器窗口存储；Node 的 global localStorage
      // 会制造测试专属第二入口，并触发 `--localstorage-file` warning。
      localStorage: 创建假Storage(),
      location: { origin: "http://test.local" },
      addEventListener: vi.fn(),
    });
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
        return 创建可读探测响应();
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
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.torrent_url =
      "http://media.local/torrent-att-offline-reopen?session_id=s-test";
    locator.distribution.presence_url =
      "/api/media/att-offline-reopen/presence?session_id=s-test";
    const firstSource = await 解析协作分发源({
      attachmentId: "att-offline-reopen",
      kind: "video",
      locator,
    });

    expect(firstSource).toEqual({
      src: "/webtorrent/offline-reopen.mp4",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
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
      hint: "正在补块",
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(secondAdd).toHaveBeenCalledWith(
      new Uint8Array([7, 8, 9]),
      expect.any(Object),
      expect.any(Function)
    );
  });

});
