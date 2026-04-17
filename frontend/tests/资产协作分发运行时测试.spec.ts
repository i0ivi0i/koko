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
    original_url: `http://media.local/original-${attachmentId}`,
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
  const destroy = vi.fn();
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
    destroy,
  } as unknown as WebTorrent种子;

  return {
    torrent,
    select,
    destroy,
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

  it("inline autoplay 只允许复用已热 swarm，不会为冷视频新开 whole-file 会话", async () => {
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
      reuseOnly: true,
    });

    expect(source).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(读取协作分发会话状态("swarm-att-inline-cold-1")).toBeNull();
  });

  it("最后一个 consumer 释放后，未补齐且未完成的冷 swarm 会立即从运行时摘除，并交给 client.remove 清理", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent, destroy } = 创建可观测假Torrent(
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
    });

    expect(读取协作分发会话状态("swarm-att-release-1")).toMatchObject({
      refs: 1,
    });

    释放协作分发消费者({
      attachmentId: "att-release-1",
      consumerId: "session:att-release-1",
    });
    await Promise.resolve();

    expect(读取协作分发会话状态("swarm-att-release-1")).toBeNull();
    expect(remove).toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
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

  it("查看器关闭释放最后一个未完成补齐消费者时，会立即销毁重型 swarm", async () => {
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
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("hidden 后会把 heavyWorkPolicy 变成 suspended，并释放无 consumer 的冷 swarm", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-hidden-1");
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

    expect(读取协作分发会话状态("swarm-att-hidden-1")).toBeNull();
    expect(读取资产协作分发预算()).toMatchObject({
      activeSwarmCount: 0,
      hiddenHeavyTaskCount: 0,
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
