import {
  HttpRealtime传输,
  type 后台会话传输端口,
  type 后台查询传输端口,
  type 媒体传输端口,
  type 聊天实时连接端口,
  type 聊天房间传输端口,
  type 前端传输端口,
  type 实时连接运行时策略,
} from "../传输.js";
import type { 生命周期快照 } from "./生命周期运行时.js";

export interface 传输运行时快照 {
  lastLifecycle: 生命周期快照 | null;
  realtimePolicy: 实时连接运行时策略;
}

export interface 传输运行时依赖 {
  /**
   * 传输运行时只关心“浏览器这一侧把请求打到哪里”。
   * 这里是平台运行时环境，不携带房间、未读、恢复之类的聊天业务语义。
   */
  baseUrl?: string;
  createTransport?: (baseUrl: string) => 前端传输端口;
}

export interface 传输运行时 {
  /**
   * 平台层统一拥有 transport 实例，避免聊天壳和后台壳继续各自 new 一份。
   * 这样后面接生命周期、网络、离线等浏览器能力时，入口仍然只有这一处。
   */
  transport(): 前端传输端口;
  /**
   * 下面这些 getter 都是“同一实例上的窄视角”：
   * 它们不创建第二个 transport，只帮助上层停止依赖整张大表。
   */
  聊天房间传输(): 聊天房间传输端口;
  聊天实时连接(): 聊天实时连接端口;
  媒体传输(): 媒体传输端口;
  后台查询传输(): 后台查询传输端口;
  后台会话传输(): 后台会话传输端口;
  /**
   * 这里只记录最近一次浏览器生命周期快照。
   * 它故意不解释聊天业务该做什么，业务语义仍由各自 owner 裁决。
   */
  接收生命周期变化(snapshot: 生命周期快照): void;
  snapshot(): 传输运行时快照;
}

const 读取默认基地址 = (): string =>
  typeof window !== "undefined" ? window.location.origin : "http://localhost";

const 推导实时连接运行时策略 = (
  snapshot: 生命周期快照 | null
): 实时连接运行时策略 => {
  if (!snapshot) {
    return {
      intent: "resume",
      reconnection: true,
      reason: "active",
    };
  }
  if (snapshot.phase === "page_hidden" || snapshot.phase === "frozen") {
    return {
      intent: "suspend",
      reconnection: false,
      reason: "page_hidden",
    };
  }
  if (snapshot.visibility === "hidden" || snapshot.phase === "background") {
    return {
      intent: "resume",
      reconnection: false,
      reason: "background",
    };
  }
  return {
    intent: "resume",
    reconnection: true,
    reason: "active",
  };
};

export function 创建传输运行时(
  deps: 传输运行时依赖 = {}
): 传输运行时 {
  const baseUrl = deps.baseUrl ?? 读取默认基地址();
  const createTransport =
    deps.createTransport ?? ((resolvedBaseUrl: string) => new HttpRealtime传输(resolvedBaseUrl));

  let current: 传输运行时快照 = {
    lastLifecycle: null,
    realtimePolicy: 推导实时连接运行时策略(null),
  };
  let transportPort: 前端传输端口 | null = null;
  const 读取组合根传输 = (): 前端传输端口 => {
    if (!transportPort) {
      transportPort = createTransport(baseUrl);
    }
    return transportPort;
  };

  return {
    transport: 读取组合根传输,

    聊天房间传输(): 聊天房间传输端口 {
      return 读取组合根传输();
    },

    聊天实时连接(): 聊天实时连接端口 {
      return 读取组合根传输();
    },

    媒体传输(): 媒体传输端口 {
      return 读取组合根传输();
    },

    后台查询传输(): 后台查询传输端口 {
      return 读取组合根传输();
    },

    后台会话传输(): 后台会话传输端口 {
      return 读取组合根传输();
    },

    接收生命周期变化(snapshot: 生命周期快照): void {
      const realtimePolicy = 推导实时连接运行时策略(snapshot);
      current = {
        lastLifecycle: { ...snapshot },
        realtimePolicy,
      };
      读取组合根传输().接收运行时策略?.(realtimePolicy);
    },

    snapshot(): 传输运行时快照 {
      return {
        lastLifecycle: current.lastLifecycle ? { ...current.lastLifecycle } : null,
        realtimePolicy: { ...current.realtimePolicy },
      };
    },
  };
}
