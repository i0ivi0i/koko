import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { 媒体定位结果 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../媒体/媒体协作分发.js";
import {
  创建资产协作分发运行时,
  type 资产协作分发事件,
  type 资产协作分发运行时端口,
} from "../媒体/资产协作分发运行时.js";

let 资产协作分发运行时: 资产协作分发运行时端口;

const 解析协作分发源 = (
  ...args: Parameters<资产协作分发运行时端口["解析协作分发源"]>
): ReturnType<资产协作分发运行时端口["解析协作分发源"]> =>
  资产协作分发运行时.解析协作分发源(...args);

const 发送资产协作分发事件 = (event: 资产协作分发事件): void => {
  资产协作分发运行时.send(event);
};

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

const 读取资产协作分发预算 = () => 资产协作分发运行时.读取预算();

function 准备好的定位结果(
  attachmentId: string,
  swarmId = `swarm-${attachmentId}`
): 媒体定位结果 {
  return {
    attachment_id: attachmentId,
    kind: "video",
    status: "ready" as const,
    thumbnail_url: null,
    distribution: {
      content_id: `content_${attachmentId}`,
      content_hash: `hash-${attachmentId}`,
      swarm_id: swarmId,
      web_seed_until: "1775942400",
      torrent_url: `http://media.local/torrent-${attachmentId}`,
      torrent_info_hash: `torrent-info-hash-${attachmentId}`,
      announce_urls: ["ws://127.0.0.1:7072"],
      web_seed_url: `http://media.local/web-seed-${attachmentId}`,
      join_ticket: null,
      ticket_expires_at: null,
      media_state: {
        code: "MEDIA_READY" as const,
        retry_after_ms: null,
      },
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
    warning: [],
    wire: [],
    noPeers: [],
    done: [],
  };
  const select = vi.fn();
  const deselect = vi.fn();
  const critical = vi.fn();
  const selectPieces = vi.fn();
  const destroy = vi.fn();
  const torrent = {
    files: [
      {
        streamURL,
        select,
        deselect,
      },
    ],
    critical,
    select: selectPieces,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
    destroy,
  } as unknown as WebTorrent种子;

  return {
    torrent,
    select,
    deselect,
    critical,
    selectPieces,
    destroy,
    emit(event: "error" | "warning" | "wire" | "noPeers" | "done", ...args: unknown[]) {
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

describe("资产协作分发运行时", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    资产协作分发运行时 = 创建资产协作分发运行时();
    重置协作分发浏览器运行时();
  });

  afterEach(() => {
    资产协作分发运行时.销毁();
    重置协作分发浏览器运行时();
    vi.useRealTimers();
  });

  it("inline autoplay 命中冷视频时也会冷启动 whole-file 会话，不再受 reuseOnly 保守门槛限制", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-inline-1");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-inline-cold-1",
      kind: "video",
      locator: 准备好的定位结果("att-inline-cold-1"),
      consumerId: "inline_autoplay:att-inline-cold-1",
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-inline-1",
      hint: "正在补块",
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(读取协作分发会话状态("swarm-att-inline-cold-1")).toMatchObject({
      refs: 1,
      consumers: ["inline_autoplay:att-inline-cold-1"],
      eagerCompleting: true,
    });
  });

  it("不支持 OPFS 的浏览器必须显式使用 IndexedDB chunk store，避免刷新后退回内存缓存", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    vi.stubGlobal("navigator", {
      storage: {
        persist: vi.fn(async () => true),
      },
    });
    vi.stubGlobal("FileSystemFileHandle", undefined);
    vi.stubGlobal("indexedDB", {});
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-idb-cache-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-idb-cache-1",
      kind: "video",
      locator: 准备好的定位结果("att-idb-cache-1"),
      consumerId: "inline_autoplay:att-idb-cache-1",
    });

    const options = add.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(options?.destroyStoreOnDestroy).toBe(false);
    expect(options?.store).toEqual(expect.any(Function));
  });

  it("协作分发 session 会按唯一 owner 流转并在退出重播放后降为轻帮助", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-owner-flow"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-owner-flow",
      kind: "video",
      locator: 准备好的定位结果("att-owner-flow"),
      consumerId: "inline_autoplay:att-owner-flow",
    });

    expect(source?.formalByteSource).toBe("webtorrent_official_stream");
    expect(读取协作分发会话状态("swarm-att-owner-flow")).toMatchObject({
      lifecycle: {
        state: "heavy_playback",
        activeReaderCount: 1,
      },
    });

    释放协作分发消费者({
      attachmentId: "att-owner-flow",
      consumerId: "inline_autoplay:att-owner-flow",
    });

    expect(读取协作分发会话状态("swarm-att-owner-flow")).toMatchObject({
      refs: 0,
      lifecycle: {
        state: "light_help",
        activeReaderCount: 0,
      },
    });
    expect(读取资产协作分发预算()).toMatchObject({
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
      zeroRefWholeFileReaderCount: 0,
    });
  });

  it("backfill 补齐不会冒充前台播放 reader", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-backfill-reader"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-backfill-reader",
      kind: "video",
      locator: 准备好的定位结果("att-backfill-reader"),
      consumerId: "backfill:att-backfill-reader",
      eagerCompleting: true,
    });

    expect(读取协作分发会话状态("swarm-att-backfill-reader")).toMatchObject({
      lifecycle: {
        state: "source_ready",
        activeReaderCount: 0,
      },
    });
  });

  it("torrent done 不会把仍在播放的 owner 降成非重播放态", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-owner-done"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-owner-done",
      kind: "video",
      locator: 准备好的定位结果("att-owner-done"),
      consumerId: "inline_autoplay:att-owner-done",
    });

    emit("done");

    expect(读取协作分发会话状态("swarm-att-owner-done")).toMatchObject({
      locallyComplete: true,
      lifecycle: {
        state: "heavy_playback",
        activeReaderCount: 1,
      },
    });
  });

  it("tracker 拒绝 join_ticket 后会记录终止原因且不会生成第二播放来源", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-ticket-reason"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-ticket-reason",
      kind: "video",
      locator: 准备好的定位结果("att-ticket-reason"),
      consumerId: "viewer:att-ticket-reason",
    });

    emit("error", new Error("join_ticket_invalid"));
    await Promise.resolve();
    await Promise.resolve();

    expect(读取协作分发会话状态("swarm-att-ticket-reason")).toBeNull();
    expect(资产协作分发运行时.snapshot().context).toMatchObject({
      lastDroppedReason: "ticket_invalid",
    });
    expect(
      "fallbackByteSource" in
        (资产协作分发运行时.snapshot().context as unknown as Record<string, unknown>)
    ).toBe(false);
  });

  it("普通 session consumer 只建立轻会话，不会默认推进 whole-file backfill", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent("blob:http://media.local/swarm-att-session-light-1");
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const source = await 解析协作分发源({
      attachmentId: "att-session-light-1",
      kind: "video",
      locator: 准备好的定位结果("att-session-light-1"),
      consumerId: "session:att-session-light-1",
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-session-light-1",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(读取协作分发会话状态("swarm-att-session-light-1")).toMatchObject({
      refs: 1,
      consumers: ["session:att-session-light-1"],
      eagerCompleting: false,
    });
    expect(torrentHandle.select).not.toHaveBeenCalled();
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 0,
      zeroRefWholeFileReaderCount: 0,
    });
  });

  it("只靠 webSeed 补齐完成时不会伪装成真实群友协作完成", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-webseed-only-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);
    const 事件记录: string[] = [];

    const source = await 解析协作分发源({
      attachmentId: "att-webseed-only-1",
      kind: "video",
      locator: 准备好的定位结果("att-webseed-only-1"),
      consumerId: "viewer:att-webseed-only-1",
      eagerCompleting: true,
      onSessionEvent: (event) => {
        事件记录.push(event.type);
      },
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-webseed-only-1",
      hint: "正在补块",
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });

    torrentHandle.emit("wire", { type: "webSeed" });
    torrentHandle.emit("done");

    expect(读取协作分发会话状态("swarm-att-webseed-only-1")).toMatchObject({
      refs: 1,
      eagerCompleting: false,
      locallyComplete: true,
      hint: null,
    });
    expect(事件记录).not.toContain("SWARM_ACTIVE");
    expect(事件记录).toContain("ASSET_COMPLETE");
  });

  it("同一 swarm 复用已有会话时会刷新 join_ticket 而不是继续拿旧票 announce", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-ticket-renew"
    );
    let getAnnounceOpts!: () => Record<string, string | undefined>;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      getAnnounceOpts = options.getAnnounceOpts!;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstLocator = 准备好的定位结果("att-ticket-a", "swarm-ticket-renew");
    if (!firstLocator.distribution) {
      throw new Error("测试前提失败：第一个 locator 缺少 distribution");
    }
    firstLocator.distribution.join_ticket = "ticket-old";
    firstLocator.distribution.torrent_info_hash = "torrent-info-same";

    const secondLocator = 准备好的定位结果("att-ticket-b", "swarm-ticket-renew");
    if (!secondLocator.distribution) {
      throw new Error("测试前提失败：第二个 locator 缺少 distribution");
    }
    secondLocator.distribution.join_ticket = "ticket-new";
    secondLocator.distribution.torrent_info_hash = "torrent-info-same";

    await 解析协作分发源({
      attachmentId: "att-ticket-a",
      kind: "video",
      locator: firstLocator,
      consumerId: "session:att-ticket-a",
    });
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });

    await 解析协作分发源({
      attachmentId: "att-ticket-b",
      kind: "video",
      locator: secondLocator,
      consumerId: "session:att-ticket-b",
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
    expect(读取协作分发会话状态("swarm-ticket-renew")).toMatchObject({
      refs: 2,
      consumers: ["session:att-ticket-a", "session:att-ticket-b"],
    });
  });

  it("长生命周期 swarm 会话会在 join_ticket 过期前主动重签 locator 并刷新 announce 票据", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-ticket-proactive-renew"
    );
    let getAnnounceOpts!: () => Record<string, string | undefined>;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      getAnnounceOpts = options.getAnnounceOpts!;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstLocator = 准备好的定位结果(
      "att-ticket-proactive",
      "swarm-ticket-proactive-renew"
    );
    if (!firstLocator.distribution) {
      throw new Error("测试前提失败：初始 locator 缺少 distribution");
    }
    firstLocator.distribution.join_ticket = "ticket-old";
    firstLocator.distribution.ticket_expires_at = "2026-04-24T00:00:30.000Z";
    firstLocator.distribution.torrent_info_hash = "torrent-info-proactive-same";

    const refreshedLocator = 准备好的定位结果(
      "att-ticket-proactive",
      "swarm-ticket-proactive-renew"
    );
    if (!refreshedLocator.distribution) {
      throw new Error("测试前提失败：续签 locator 缺少 distribution");
    }
    refreshedLocator.distribution.join_ticket = "ticket-new";
    refreshedLocator.distribution.ticket_expires_at = "2026-04-24T00:01:00.000Z";
    refreshedLocator.distribution.torrent_info_hash = "torrent-info-proactive-same";
    const refreshJoinTicket = vi.fn(async () => refreshedLocator);

    await 解析协作分发源({
      attachmentId: "att-ticket-proactive",
      kind: "video",
      locator: firstLocator,
      consumerId: "session:att-ticket-proactive",
      refreshJoinTicket,
    });

    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });

    await vi.advanceTimersByTimeAsync(26_000);

    expect(refreshJoinTicket).toHaveBeenCalledTimes(1);
    expect(refreshJoinTicket).toHaveBeenCalledWith({
      attachmentId: "att-ticket-proactive",
      swarmId: "swarm-ticket-proactive-renew",
      torrentInfoHash: "torrent-info-proactive-same",
    });
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("续租 locator 暂时缺少 join_ticket 时不会把活跃会话降成无票 announce，而是等待下一次重签", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-ticket-refresh-missing"
    );
    let getAnnounceOpts!: () => Record<string, string | undefined>;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      getAnnounceOpts = options.getAnnounceOpts!;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstLocator = 准备好的定位结果(
      "att-ticket-refresh-missing",
      "swarm-ticket-refresh-missing"
    );
    if (!firstLocator.distribution) {
      throw new Error("测试前提失败：初始 locator 缺少 distribution");
    }
    firstLocator.distribution.join_ticket = "ticket-old";
    firstLocator.distribution.ticket_expires_at = "2026-04-24T00:00:30.000Z";
    firstLocator.distribution.torrent_info_hash = "torrent-info-refresh-missing";
    firstLocator.distribution.announce_urls = ["wss://im.example.com/api/swarm/announce"];

    const missingTicketLocator = 准备好的定位结果(
      "att-ticket-refresh-missing",
      "swarm-ticket-refresh-missing"
    );
    if (!missingTicketLocator.distribution) {
      throw new Error("测试前提失败：缺票 locator 缺少 distribution");
    }
    missingTicketLocator.distribution.join_ticket = null;
    missingTicketLocator.distribution.ticket_expires_at = null;
    missingTicketLocator.distribution.torrent_info_hash = "torrent-info-refresh-missing";
    missingTicketLocator.distribution.announce_urls = ["wss://im.example.com/api/swarm/announce"];

    const refreshedLocator = 准备好的定位结果(
      "att-ticket-refresh-missing",
      "swarm-ticket-refresh-missing"
    );
    if (!refreshedLocator.distribution) {
      throw new Error("测试前提失败：续签 locator 缺少 distribution");
    }
    refreshedLocator.distribution.join_ticket = "ticket-new";
    refreshedLocator.distribution.ticket_expires_at = "2026-04-24T00:01:00.000Z";
    refreshedLocator.distribution.torrent_info_hash = "torrent-info-refresh-missing";
    refreshedLocator.distribution.announce_urls = ["wss://im.example.com/api/swarm/announce"];

    const refreshJoinTicket = vi
      .fn(async () => missingTicketLocator)
      .mockResolvedValueOnce(missingTicketLocator)
      .mockResolvedValueOnce(refreshedLocator);

    await 解析协作分发源({
      attachmentId: "att-ticket-refresh-missing",
      kind: "video",
      locator: firstLocator,
      consumerId: "session:att-ticket-refresh-missing",
      refreshJoinTicket,
    });

    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });

    await vi.advanceTimersByTimeAsync(26_000);
    expect(refreshJoinTicket).toHaveBeenCalledTimes(1);
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refreshJoinTicket).toHaveBeenCalledTimes(2);
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("同一 swarm 被新附件复用后会用最新附件引用续租 join_ticket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-ticket-renew-anchor"
    );
    let getAnnounceOpts!: () => Record<string, string | undefined>;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      getAnnounceOpts = options.getAnnounceOpts!;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstLocator = 准备好的定位结果(
      "att-ticket-anchor-a",
      "swarm-ticket-renew-anchor"
    );
    if (!firstLocator.distribution) {
      throw new Error("测试前提失败：初始 locator 缺少 distribution");
    }
    firstLocator.distribution.join_ticket = "ticket-a";
    firstLocator.distribution.ticket_expires_at = "2026-04-24T00:00:30.000Z";
    firstLocator.distribution.torrent_info_hash = "torrent-info-anchor-same";

    const secondLocator = 准备好的定位结果(
      "att-ticket-anchor-b",
      "swarm-ticket-renew-anchor"
    );
    if (!secondLocator.distribution) {
      throw new Error("测试前提失败：复用 locator 缺少 distribution");
    }
    secondLocator.distribution.join_ticket = "ticket-b";
    secondLocator.distribution.ticket_expires_at = "2026-04-24T00:00:30.000Z";
    secondLocator.distribution.torrent_info_hash = "torrent-info-anchor-same";

    const renewedSecondLocator = 准备好的定位结果(
      "att-ticket-anchor-b",
      "swarm-ticket-renew-anchor"
    );
    if (!renewedSecondLocator.distribution) {
      throw new Error("测试前提失败：续租 locator 缺少 distribution");
    }
    renewedSecondLocator.distribution.join_ticket = "ticket-b-renewed";
    renewedSecondLocator.distribution.ticket_expires_at = "2026-04-24T00:01:00.000Z";
    renewedSecondLocator.distribution.torrent_info_hash = "torrent-info-anchor-same";
    const refreshFirstJoinTicket = vi.fn(async () => firstLocator);
    const refreshSecondJoinTicket = vi.fn(async () => renewedSecondLocator);

    await 解析协作分发源({
      attachmentId: "att-ticket-anchor-a",
      kind: "video",
      locator: firstLocator,
      consumerId: "session:att-ticket-anchor-a",
      refreshJoinTicket: refreshFirstJoinTicket,
    });
    await 解析协作分发源({
      attachmentId: "att-ticket-anchor-b",
      kind: "video",
      locator: secondLocator,
      consumerId: "session:att-ticket-anchor-b",
      refreshJoinTicket: refreshSecondJoinTicket,
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-b" });

    await vi.advanceTimersByTimeAsync(26_000);

    expect(refreshFirstJoinTicket).not.toHaveBeenCalled();
    expect(refreshSecondJoinTicket).toHaveBeenCalledWith({
      attachmentId: "att-ticket-anchor-b",
      swarmId: "swarm-ticket-renew-anchor",
      torrentInfoHash: "torrent-info-anchor-same",
    });
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-b-renewed" });
  });

  it("最新附件引用释放后 join_ticket 续租锚点会退回仍在使用的附件", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-ticket-release-anchor"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const firstLocator = 准备好的定位结果(
      "att-ticket-release-a",
      "swarm-ticket-release-anchor"
    );
    const secondLocator = 准备好的定位结果(
      "att-ticket-release-b",
      "swarm-ticket-release-anchor"
    );
    for (const locator of [firstLocator, secondLocator]) {
      if (!locator.distribution) {
        throw new Error("测试前提失败：locator 缺少 distribution");
      }
      locator.distribution.ticket_expires_at = "2026-04-24T00:00:30.000Z";
      locator.distribution.torrent_info_hash = "torrent-info-release-same";
    }
    firstLocator.distribution!.join_ticket = "ticket-release-a";
    secondLocator.distribution!.join_ticket = "ticket-release-b";

    const renewedLocator = 准备好的定位结果(
      "att-ticket-release-a",
      "swarm-ticket-release-anchor"
    );
    if (!renewedLocator.distribution) {
      throw new Error("测试前提失败：续租 locator 缺少 distribution");
    }
    renewedLocator.distribution.join_ticket = "ticket-release-a-renewed";
    renewedLocator.distribution.ticket_expires_at = "2026-04-24T00:01:00.000Z";
    renewedLocator.distribution.torrent_info_hash = "torrent-info-release-same";
    const refreshJoinTicket = vi.fn(async () => renewedLocator);

    await 解析协作分发源({
      attachmentId: "att-ticket-release-a",
      kind: "video",
      locator: firstLocator,
      consumerId: "session:att-ticket-release-a",
      refreshJoinTicket,
    });
    await 解析协作分发源({
      attachmentId: "att-ticket-release-b",
      kind: "video",
      locator: secondLocator,
      consumerId: "session:att-ticket-release-b",
      refreshJoinTicket,
    });

    释放协作分发消费者({
      attachmentId: "att-ticket-release-b",
      consumerId: "session:att-ticket-release-b",
    });

    await vi.advanceTimersByTimeAsync(26_000);

    expect(refreshJoinTicket).toHaveBeenCalledWith({
      attachmentId: "att-ticket-release-a",
      swarmId: "swarm-ticket-release-anchor",
      torrentInfoHash: "torrent-info-release-same",
    });
  });

  it("视频进入 backfill 时会先抬 preview 关键片段优先级，再继续整附件补齐", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-preview-priority-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-preview-priority-1",
      kind: "video",
      locator: 准备好的定位结果("att-preview-priority-1"),
      consumerId: "session:att-preview-priority-1",
      eagerCompleting: true,
    });

    expect(torrentHandle.critical).toHaveBeenCalled();
    expect(torrentHandle.selectPieces).toHaveBeenCalledWith(0, 4, 0);
    expect(torrentHandle.select).toHaveBeenCalledWith(1);
    const 预览关键片段顺序 = torrentHandle.critical.mock.invocationCallOrder[0];
    const 预览选片顺序 = torrentHandle.selectPieces.mock.invocationCallOrder[0];
    const 整附件补齐顺序 = torrentHandle.select.mock.invocationCallOrder[0];
    /**
     * 权威顺序是 preview-first，而不是 preview-only：
     * 1. 先把首眼/首播关键字节提到最高优先级；
     * 2. 然后立刻接上 whole-file backfill；
     * 3. 这样既不牺牲第一眼，也不会把“继续补完整文件”拖到更晚的 wire 才开始。
     */
    expect(预览关键片段顺序).toBeDefined();
    expect(预览选片顺序).toBeDefined();
    expect(整附件补齐顺序).toBeDefined();
    expect(预览关键片段顺序!).toBeLessThan(整附件补齐顺序!);
    expect(预览选片顺序!).toBeLessThan(整附件补齐顺序!);
  });

  it("最后一个 consumer 释放后，未补齐会话会退到轻帮助态，而不是立刻从运行时摘除", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, destroy, deselect } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-release-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-release-1",
      kind: "video",
      locator: 准备好的定位结果("att-release-1"),
      consumerId: "session:att-release-1",
      eagerCompleting: true,
    });

    expect(读取协作分发会话状态("swarm-att-release-1")).toMatchObject({
      refs: 1,
    });

    释放协作分发消费者({
      attachmentId: "att-release-1",
      consumerId: "session:att-release-1",
    });
    await Promise.resolve();

    expect(读取协作分发会话状态("swarm-att-release-1")).toMatchObject({
      refs: 0,
      eagerCompleting: true,
      hint: "正在补块",
    });
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 0,
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
      zeroRefWholeFileReaderCount: 0,
    });
    expect(deselect).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("底层 file 已失效时，退出整附件补齐不能让 deselect 异常打断释放链", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-release-stale-file"
    );
    const brokenDeselect = vi.fn(() => {
      throw new TypeError("Cannot read properties of null (reading 'deselect')");
    });
    (
      torrent as unknown as {
        files: Array<{ deselect: () => void }>;
      }
    ).files[0]!.deselect = brokenDeselect;
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-release-stale-file",
      kind: "video",
      locator: 准备好的定位结果("att-release-stale-file"),
      consumerId: "session:att-release-stale-file",
      eagerCompleting: true,
    });

    expect(() =>
      释放协作分发消费者({
        attachmentId: "att-release-stale-file",
        consumerId: "session:att-release-stale-file",
      })
    ).not.toThrow();

    expect(brokenDeselect).toHaveBeenCalledTimes(1);
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 0,
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
      zeroRefWholeFileReaderCount: 0,
    });
  });

  it("locallyComplete 的资源可被同页重开直接复用，不需要重新冷启动", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-reopen-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-reopen-1",
      kind: "video",
      locator: 准备好的定位结果("att-reopen-1"),
      consumerId: "session:att-reopen-1",
    });
    torrentHandle.emit("done");

    释放协作分发消费者({
      attachmentId: "att-reopen-1",
      consumerId: "session:att-reopen-1",
    });

    expect(读取协作分发会话状态("swarm-att-reopen-1")).toMatchObject({
      refs: 0,
    });

    const reopened = await 解析协作分发源({
      attachmentId: "att-reopen-1",
      kind: "video",
      locator: 准备好的定位结果("att-reopen-1"),
      consumerId: "viewer:att-reopen-1",
    });

    expect(reopened).toMatchObject({
      src: "blob:http://media.local/swarm-att-reopen-1",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(读取协作分发会话状态("swarm-att-reopen-1")).toMatchObject({
      refs: 1,
      consumers: ["viewer:att-reopen-1"],
    });
  });

  it("已交付播放源只在零引用重开时由会话 owner 合并探测，避免多消费者并发打 streamURL", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const fetchMock = vi.mocked(globalThis.fetch);
    const torrentHandle = 创建可观测假Torrent(
      "https://127.0.0.1/webtorrent/source-probe-owner/content.mp4"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);
    const locator = 准备好的定位结果("att-source-probe-owner");

    await 解析协作分发源({
      attachmentId: "att-source-probe-owner",
      kind: "video",
      locator,
      consumerId: "session:att-source-probe-owner",
    });
    fetchMock.mockClear();

    await Promise.all([
      解析协作分发源({
        attachmentId: "att-source-probe-owner",
        kind: "video",
        locator,
        consumerId: "preview:att-source-probe-owner",
      }),
      解析协作分发源({
        attachmentId: "att-source-probe-owner",
        kind: "video",
        locator,
        consumerId: "inline_autoplay:att-source-probe-owner",
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    torrentHandle.emit("done");
    for (const consumerId of [
      "session:att-source-probe-owner",
      "preview:att-source-probe-owner",
      "inline_autoplay:att-source-probe-owner",
    ]) {
      释放协作分发消费者({
        attachmentId: "att-source-probe-owner",
        consumerId,
      });
    }
    expect(读取协作分发会话状态("swarm-att-source-probe-owner")).toMatchObject({
      refs: 0,
    });

    fetchMock.mockClear();
    await Promise.all([
      解析协作分发源({
        attachmentId: "att-source-probe-owner",
        kind: "video",
        locator,
        consumerId: "viewer:att-source-probe-owner",
      }),
      解析协作分发源({
        attachmentId: "att-source-probe-owner",
        kind: "video",
        locator,
        consumerId: "inline_autoplay:att-source-probe-owner",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tracker 拒绝 join_ticket 后会立即丢弃运行时会话，并在短排水窗口后通过官方 remove 收尾", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, emit } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-ticket-invalid"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);
    const 事件记录: Array<{ type: string; attachmentId: string; swarmId: string }> = [];

    const source = await 解析协作分发源({
      attachmentId: "att-ticket-invalid",
      kind: "video",
      locator: 准备好的定位结果("att-ticket-invalid"),
      consumerId: "session:att-ticket-invalid",
      onSessionEvent: (event) => {
        事件记录.push(event);
      },
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-ticket-invalid",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });

    emit("error", new Error("join_ticket_invalid"));
    await Promise.resolve();
    await Promise.resolve();

    expect(事件记录).toContainEqual({
      type: "SWARM_TICKET_INVALID",
      attachmentId: "att-ticket-invalid",
      swarmId: "swarm-att-ticket-invalid",
    });
    expect(读取协作分发会话状态("swarm-att-ticket-invalid")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    /**
     * 运行时真相必须立即摘掉脏会话，但底层 `/webtorrent/...` 路由会故意留一个极短排水窗口，
     * 让浏览器已经飞出去的 range/content 请求自然停掉，避免旧视频尾波直接撞成 404。
     */
    await vi.advanceTimersByTimeAsync(2_000);
    expect(remove).toHaveBeenCalledWith("torrent-info-hash-att-ticket-invalid", {
      destroyStore: false,
    });
  });

  it("查看器关闭释放最后一个未完成补齐消费者时，会立即从运行时摘掉重型 swarm，并在短排水窗口后 remove", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-viewer-close-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor, remove } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-viewer-close-1",
      kind: "video",
      locator: 准备好的定位结果("att-viewer-close-1"),
      consumerId: "session:att-viewer-close-1",
      eagerCompleting: true,
    });

    expect(读取协作分发会话状态("swarm-att-viewer-close-1")).toMatchObject({
      refs: 1,
      eagerCompleting: true,
    });

    释放协作分发消费者({
      attachmentId: "att-viewer-close-1",
      consumerId: "session:att-viewer-close-1",
      丢弃未完成补齐: true,
    });

    expect(读取协作分发会话状态("swarm-att-viewer-close-1")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("零消费者的 eagerCompleting 会话在后台策略变化时仍保留，不会被当成冷会话清掉", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, deselect } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-hidden-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-hidden-1",
      kind: "video",
      locator: 准备好的定位结果("att-hidden-1"),
      consumerId: "backfill:att-hidden-1",
      eagerCompleting: true,
    });

    释放协作分发消费者({
      attachmentId: "att-hidden-1",
      consumerId: "backfill:att-hidden-1",
    });
    expect(读取协作分发会话状态("swarm-att-hidden-1")).toMatchObject({
      refs: 0,
      eagerCompleting: true,
    });

    发送资产协作分发事件({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "suspended",
    });

    expect(读取协作分发会话状态("swarm-att-hidden-1")).toMatchObject({
      refs: 0,
      eagerCompleting: true,
    });
    expect(读取资产协作分发预算()).toMatchObject({
      activeSwarmCount: 1,
      hiddenHeavyTaskCount: 0,
      wholeFileHeavySessionCount: 0,
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
      zeroRefWholeFileReaderCount: 0,
    });
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it("零引用 eagerCompleting 会话在后台只保留轻帮助态，不再继续占着 whole-file heavy 预算", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, deselect } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-light-help-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-light-help-1",
      kind: "video",
      locator: 准备好的定位结果("att-light-help-1"),
      consumerId: "backfill:att-light-help-1",
      eagerCompleting: true,
    });

    释放协作分发消费者({
      attachmentId: "att-light-help-1",
      consumerId: "backfill:att-light-help-1",
    });
    发送资产协作分发事件({
      type: "LIFECYCLE_POLICY_CHANGED",
      heavyWorkPolicy: "suspended",
    });

    expect(读取资产协作分发预算()).toMatchObject({
      activeSwarmCount: 1,
      wholeFileHeavySessionCount: 0,
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
      zeroRefWholeFileReaderCount: 0,
    });
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it("零引用轻帮助态重新被前台 consumer 接管时，会恢复 whole-file 重补齐而不是新建第二条 swarm", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-revive-heavy-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-revive-heavy-1",
      kind: "video",
      locator: 准备好的定位结果("att-revive-heavy-1"),
      consumerId: "session:att-revive-heavy-1",
      eagerCompleting: true,
    });

    释放协作分发消费者({
      attachmentId: "att-revive-heavy-1",
      consumerId: "session:att-revive-heavy-1",
    });
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 1,
    });

    await 解析协作分发源({
      attachmentId: "att-revive-heavy-1",
      kind: "video",
      locator: 准备好的定位结果("att-revive-heavy-1"),
      consumerId: "viewer:att-revive-heavy-1",
      eagerCompleting: true,
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(torrentHandle.select).toHaveBeenCalledTimes(2);
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 1,
      zeroRefHeavySessionCount: 0,
      zeroRefLightHelpSessionCount: 0,
    });
  });

  it("媒体协作分发模块不再自己维护协作分发会话表", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../媒体/媒体协作分发.ts"),
      "utf8"
    );

    expect(source).toContain("获取或创建协作分发浏览器运行时");
    expect(source).not.toContain("const 协作分发会话表");
  });
});
