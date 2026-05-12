import { describe, expect, it, vi } from "vitest";
import { 获取或创建协作分发浏览器运行时, type WebTorrent浏览器客户端 } from "../../媒体/媒体协作分发.js";
import {
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册资产协作分发测试基线,
  解析协作分发源,
  读取协作分发会话状态,
  读取资产协作分发快照,
  读取资产协作分发预算,
  释放协作分发消费者,
} from "./测试支撑";

describe("资产协作分发运行时 / 冷启动与续租", () => {
  注册资产协作分发测试基线();
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

  it("WebTorrent 使用内置 OPFS store，不再注入自定义 chunk store", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-opfs-1"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-opfs-1",
      kind: "video",
      locator: 准备好的定位结果("att-opfs-1"),
      consumerId: "inline_autoplay:att-opfs-1",
    });

    const options = add.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(options?.destroyStoreOnDestroy).toBe(false);
    // 不注入自定义 store，让 WebTorrent v2.5+ 使用内置 OPFS chunk store
    expect(options?.store).toBeUndefined();
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
    expect(读取资产协作分发快照().context).toMatchObject({
      lastDroppedReason: "ticket_invalid",
    });
    expect(
      "fallbackByteSource" in
        (读取资产协作分发快照().context as unknown as Record<string, unknown>)
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

  it("视频预热会同时抬起文件头尾关键片段，避免 moov 落在尾部时首帧长期卡占位", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-preview-tail-priority-1",
      {
        fileOffset: 2_048,
        fileLength: 12_288,
        pieceLength: 1_024,
      }
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-preview-tail-priority-1",
      kind: "video",
      locator: 准备好的定位结果("att-preview-tail-priority-1"),
      consumerId: "session:att-preview-tail-priority-1",
      eagerCompleting: true,
    });

    /**
     * 这条用例对应真实浏览器里的“有 /webtorrent/206，但视频 readyState 一直是 0”：
     * 1. 文件在 torrent 里不一定从 piece 0 开始；
     * 2. MP4 的可解码元数据也不一定在文件头；
     * 3. 预热若只抢头部 piece，浏览器可能一直等不到尾部 moov，界面就会长期停在占位。
     */
    expect(torrentHandle.critical.mock.calls).toEqual([
      [2, 6],
      [9, 13],
    ]);
    expect(torrentHandle.selectPieces.mock.calls).toEqual([
      [2, 6, 0],
      [9, 13, 0],
    ]);
    const 尾部预热顺序 = torrentHandle.selectPieces.mock.invocationCallOrder[1];
    const 整附件补齐顺序 = torrentHandle.select.mock.invocationCallOrder[0];
    expect(尾部预热顺序).toBeDefined();
    expect(整附件补齐顺序).toBeDefined();
    expect(尾部预热顺序!).toBeLessThan(整附件补齐顺序!);
  });

});
