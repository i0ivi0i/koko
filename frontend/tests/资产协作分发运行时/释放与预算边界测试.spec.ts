import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { 获取或创建协作分发浏览器运行时, type WebTorrent浏览器客户端 } from "../../媒体/媒体协作分发.js";
import {
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册资产协作分发测试基线,
  解析协作分发源,
  发送资产协作分发事件,
  释放协作分发消费者,
  读取协作分发会话状态,
  读取资产协作分发预算,
} from "./测试支撑";

describe("资产协作分发运行时 / 释放与预算边界", () => {
  注册资产协作分发测试基线();
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

  it("最后一个 consumer 释放后，已经拿到真实群友字节的未完成会话会短时保活重补齐，窗口到点后再降回轻帮助态", async () => {
    vi.useFakeTimers();
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandle = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-release-peer-grace"
    );
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrentHandle.torrent);
      return torrentHandle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-release-peer-grace",
      kind: "video",
      locator: 准备好的定位结果("att-release-peer-grace"),
      consumerId: "viewer:att-release-peer-grace",
      eagerCompleting: true,
    });
    torrentHandle.emit("wire", { type: "peer" });
    torrentHandle.emit("download", 128);

    释放协作分发消费者({
      attachmentId: "att-release-peer-grace",
      consumerId: "viewer:att-release-peer-grace",
    });

    expect(读取协作分发会话状态("swarm-att-release-peer-grace")).toMatchObject({
      refs: 0,
      eagerCompleting: true,
      hint: "正在协作分发",
    });
    expect(读取资产协作分发预算()).toMatchObject({
      wholeFileHeavySessionCount: 1,
      zeroRefHeavySessionCount: 1,
      zeroRefLightHelpSessionCount: 0,
      zeroRefWholeFileReaderCount: 1,
    });
    expect(torrentHandle.deselect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(31_000);

    expect(读取协作分发会话状态("swarm-att-release-peer-grace")).toMatchObject({
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
    expect(torrentHandle.deselect).toHaveBeenCalledTimes(1);
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

  it("locallyComplete 零引用保留会话超过 LRU 上限时，最旧的零引用会话被淘汰", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const torrentHandles: ReturnType<typeof 创建可观测假Torrent>[] = [];
    const add = vi.fn(((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
      const handle = 创建可观测假Torrent(
        `blob:http://media.local/swarm-att-lru-${torrentHandles.length}`
      );
      torrentHandles.push(handle);
      onTorrent(handle.torrent);
      return handle.torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    /**
     * 创建 LRU 上限 + 1 个 locallyComplete 零引用会话。
     * 从生命周期导出的常量来确保测试与实现同步。
     */
    const { 零引用完成会话保留上限 } = await import("../../媒体/资产协作分发生命周期.js");
    const totalSessions = 零引用完成会话保留上限 + 1;

    for (let i = 0; i < totalSessions; i++) {
      const attachmentId = `att-lru-${i}`;
      await 解析协作分发源({
        attachmentId,
        kind: "video",
        locator: 准备好的定位结果(attachmentId),
        consumerId: `session:${attachmentId}`,
        eagerCompleting: true,
      });
      // torrent done → locallyComplete
      torrentHandles[i]!.emit("done");
      // 释放消费者 → 进入零引用 light_help
      释放协作分发消费者({
        attachmentId,
        consumerId: `session:${attachmentId}`,
      });
      await Promise.resolve();
    }

    // 最旧的会话（att-lru-0）应该已经被 LRU 淘汰
    expect(读取协作分发会话状态("swarm-att-lru-0")).toBeNull();
    // 最新的会话（att-lru-{totalSessions-1}）应该仍然存在
    expect(
      读取协作分发会话状态(`swarm-att-lru-${totalSessions - 1}`)
    ).not.toBeNull();
    // 总保留数应等于上限
    expect(读取资产协作分发预算().zeroRefLightHelpSessionCount).toBe(
      零引用完成会话保留上限
    );
    // 第 2 个会话（swarm-att-lru-1）是存活的最旧会话，刚好在上限内
    expect(读取协作分发会话状态("swarm-att-lru-1")).not.toBeNull();
  });

  it("媒体协作分发模块不再自己维护协作分发会话表", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../媒体/媒体协作分发.ts"),
      "utf8"
    );

    expect(source).toContain("获取或创建协作分发浏览器运行时");
    expect(source).not.toContain("const 协作分发会话表");
  });
});
