import { afterEach, beforeEach, vi } from "vitest";
import type { 媒体定位结果 } from "../../聊天共享/契约.js";
import {
  重置协作分发浏览器运行时,
  type WebTorrent浏览器客户端,
  type WebTorrent种子,
} from "../../媒体/媒体协作分发.js";
import {
  创建资产协作分发运行时,
  type 资产协作分发事件,
  type 资产协作分发运行时端口,
} from "../../媒体/资产协作分发运行时.js";

let 资产协作分发运行时: 资产协作分发运行时端口;

export const 解析协作分发源 = (
  ...args: Parameters<资产协作分发运行时端口["解析协作分发源"]>
): ReturnType<资产协作分发运行时端口["解析协作分发源"]> =>
  资产协作分发运行时.解析协作分发源(...args);

export const 发送资产协作分发事件 = (event: 资产协作分发事件): void => {
  资产协作分发运行时.send(event);
};

export const 释放协作分发消费者 = (
  ...args: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>
): void => {
  资产协作分发运行时.释放协作分发消费者(...args);
};

export const 读取协作分发会话状态 = (swarmId: string) =>
  资产协作分发运行时.读取会话状态(swarmId);

export const 读取资产协作分发预算 = () => 资产协作分发运行时.读取预算();

export const 读取资产协作分发快照 = () => 资产协作分发运行时.snapshot();

export function 注册资产协作分发测试基线(): void {
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
}

export function 准备好的定位结果(
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

export function 创建可观测假Torrent(
  streamURL: string,
  options?: {
    fileOffset?: number;
    fileLength?: number;
    pieceLength?: number;
  }
) {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {
    download: [],
    error: [],
    warning: [],
    wire: [],
    noPeers: [],
    done: [],
  };
  const fileOffset = options?.fileOffset ?? 0;
  const fileLength = options?.fileLength ?? 5_120;
  const pieceLength = options?.pieceLength ?? 1_024;
  const select = vi.fn();
  const deselect = vi.fn();
  const critical = vi.fn();
  const selectPieces = vi.fn();
  const destroy = vi.fn();
  const torrent = {
    files: [
      {
        streamURL,
        offset: fileOffset,
        length: fileLength,
        select,
        deselect,
      },
    ],
    pieceLength,
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

  /** 最近一次被 new 出来的实例，用于测试构造器参数和运行时属性 */
  let _lastInstance: InstanceType<typeof FakeWebTorrent> | null = null;

  class FakeWebTorrent {
    /** 构造器接收到的选项——测试用来断言 maxConns 等参数 */
    _opts: Record<string, unknown> | undefined;
    createServer = createServer;
    add = add;
    destroy = destroy;
    remove = remove;
    /** 模拟 WebTorrent 的 tracker 属性，供 ICE 配置注入测试使用 */
    tracker: Record<string, unknown> | undefined;

    constructor(opts?: Record<string, unknown>) {
      this._opts = opts;
      _lastInstance = this;
    }
  }

  return {
    ctor: FakeWebTorrent as unknown as new (
      opts?: Record<string, unknown>
    ) => WebTorrent浏览器客户端,
    /** 返回最近一次 new FakeWebTorrent() 产生的实例 */
    lastInstance: () => _lastInstance,
    createServer,
    closeServer,
    destroy,
    remove,
  };
}
