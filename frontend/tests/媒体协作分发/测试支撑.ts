import { afterEach, beforeEach, vi } from "vitest";
import type { 媒体定位结果 } from "../../聊天共享/契约.js";
import {
  创建资产协作分发运行时,
  type 资产协作分发运行时端口,
} from "../../媒体/资产协作分发运行时.js";
import {
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../../媒体/媒体协作分发";

let 资产协作分发运行时: 资产协作分发运行时端口;

export const 解析协作分发源 = (
  ...args: Parameters<资产协作分发运行时端口["解析协作分发源"]>
): ReturnType<资产协作分发运行时端口["解析协作分发源"]> =>
  资产协作分发运行时.解析协作分发源(...args);

export const 释放协作分发消费者 = (
  ...args: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>
): void => {
  资产协作分发运行时.释放协作分发消费者(...args);
};

export const 读取协作分发会话状态 = (swarmId: string) =>
  资产协作分发运行时.读取会话状态(swarmId);

export const 重置资产协作分发运行时 = (): void => {
  资产协作分发运行时.重置();
};

export function 注册媒体协作分发测试基线(): void {
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
}

export function 创建假Storage(): Storage {
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

export function 准备好的定位结果(
  attachmentId: string,
  kind: 媒体定位结果["kind"] = "video"
): 媒体定位结果 {
  return {
    attachment_id: attachmentId,
    kind,
    status: "ready" as const,
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
      media_state: {
        code: "MEDIA_READY" as const,
        retry_after_ms: null,
      },
      survival_mode: "server_assisted" as const,
    },
  };
}

export function 准备已激活媒体ServiceWorker注册() {
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

export function 创建可观测假Torrent(streamURL: string) {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {
    download: [],
    error: [],
    warning: [],
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
    emit(
      event: "download" | "error" | "warning" | "wire" | "noPeers" | "done",
      ...args: unknown[]
    ) {
      const eventHandlers = handlers[event] ?? [];
      for (const handler of eventHandlers) {
        handler(...args);
      }
    },
  };
}

export function 创建假WebTorrent构造器(add: WebTorrent浏览器客户端["add"]) {
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
