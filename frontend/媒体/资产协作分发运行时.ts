import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type { 媒体定位结果, 媒体种类 } from "../契约.js";
import {
  获取或创建协作分发浏览器运行时,
  启动协作分发存活上报,
  停止协作分发存活上报,
  探测协作分发媒体源可读性,
  接入协作分发种子,
  清理协作分发底层会话,
  读取协作分发定位片段,
  读取可用协作分发片段,
  读取首个可播放文件,
  请求协作分发持久化存储,
  type 协作分发会话事件,
  type 协作分发媒体源,
  type WebTorrent文件,
  type WebTorrent种子,
} from "./媒体协作分发.js";

type 协作分发消费者模式 =
  | "viewer"
  | "inline_autoplay"
  | "backfill"
  | "session";

type 协作分发消费者绑定 = {
  consumerId: string;
  attachmentId: string;
  mode: 协作分发消费者模式;
  onSessionEvent: ((event: 协作分发会话事件) => void) | null;
};

type 底层协作分发会话 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
  contentHash: string;
  sourcePromise: Promise<{ src: string } | null>;
  eagerCompleting: boolean;
  locallyComplete: boolean;
  hint: 协作分发媒体源["hint"] | null;
  presenceIntervalId: ReturnType<typeof setInterval> | null;
  torrent: WebTorrent种子 | null;
  file: WebTorrent文件 | null;
  consumerBindings: Map<string, 协作分发消费者绑定>;
};

export type 资产协作分发会话快照 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
  contentHash: string;
  consumers: string[];
  consumerAttachmentIds: Record<string, string>;
  consumerModes: Record<string, 协作分发消费者模式>;
  eagerCompleting: boolean;
  locallyComplete: boolean;
  hint: 协作分发媒体源["hint"] | null;
};

interface 资产协作分发上下文 {
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  sessions: Record<string, 资产协作分发会话快照>;
}

export type 资产协作分发事件 =
  | {
      type: "ACQUIRE_REQUESTED";
      attachmentId: string;
      swarmId: string;
      torrentInfoHash: string;
      contentHash: string;
      consumerId: string;
      mode: 协作分发消费者模式;
    }
  | {
      type: "BACKFILL_REQUESTED";
      swarmId: string;
    }
  | {
      type: "SWARM_ACTIVE";
      swarmId: string;
      hint: 协作分发媒体源["hint"];
    }
  | {
      type: "SWARM_NO_PEERS";
      swarmId: string;
    }
  | {
      type: "TORRENT_DONE";
      swarmId: string;
      contentHash: string;
    }
  | {
      type: "CONSUMER_RELEASED";
      swarmId: string;
      attachmentId: string;
      consumerId: string;
    }
  | {
      type: "SESSION_DROPPED";
      swarmId: string;
    }
  | {
      type: "LIFECYCLE_POLICY_CHANGED";
      heavyWorkPolicy: "normal" | "reduced" | "suspended";
    }
  | {
      type: "RESET";
    };

const 初始资产协作分发上下文: 资产协作分发上下文 = {
  heavyWorkPolicy: "normal",
  sessions: {},
};

const 复制会话表 = (
  sessions: Record<string, 资产协作分发会话快照>
): Record<string, 资产协作分发会话快照> => ({ ...sessions });

const 推导主附件标识 = (consumerAttachmentIds: Record<string, string>): string => {
  return Object.values(consumerAttachmentIds)[0] ?? "";
};

const 是否为零消费者冷协作分发会话 = (session: 底层协作分发会话): boolean =>
  session.consumerBindings.size === 0 && !session.locallyComplete;

/**
 * AssetDistributionActor 只拥有“哪一个 swarm 会话当前还活着、被谁占用、是否可复用”的真相。
 * WebTorrent client / stream server / torrent 接线仍留在浏览器 adapter，不在这里复制第二套底层实现。
 */
const 资产协作分发机 = createMachine(
  {
    types: {} as {
      context: 资产协作分发上下文;
      events: 资产协作分发事件;
    },
    id: "资产协作分发机",
    initial: "活跃",
    context: 初始资产协作分发上下文,
    states: {
      活跃: {
        on: {
          ACQUIRE_REQUESTED: {
            actions: "登记消费者占用",
          },
          BACKFILL_REQUESTED: {
            actions: "标记整附件补齐",
          },
          SWARM_ACTIVE: {
            actions: "标记协作分发活跃",
          },
          SWARM_NO_PEERS: {
            actions: "标记当前缺少群友",
          },
          TORRENT_DONE: {
            actions: "标记本地已完整",
          },
          CONSUMER_RELEASED: {
            actions: "释放消费者占用",
          },
          SESSION_DROPPED: {
            actions: "删除失效会话",
          },
          LIFECYCLE_POLICY_CHANGED: {
            actions: "同步生命周期策略",
          },
          RESET: {
            actions: "重置全部会话",
          },
        },
      },
    },
  },
  {
    actions: {
      登记消费者占用: assign(({ context, event }) => {
        if (event.type !== "ACQUIRE_REQUESTED") {
          return {};
        }
        const nextSessions = 复制会话表(context.sessions);
        const current = nextSessions[event.swarmId];
        const consumerAttachmentIds = {
          ...(current?.consumerAttachmentIds ?? {}),
          [event.consumerId]: event.attachmentId,
        };
        const consumerModes = {
          ...(current?.consumerModes ?? {}),
          [event.consumerId]: event.mode,
        };
        nextSessions[event.swarmId] = {
          attachmentId: 推导主附件标识(consumerAttachmentIds) || event.attachmentId,
          swarmId: event.swarmId,
          torrentInfoHash: event.torrentInfoHash,
          contentHash: event.contentHash,
          consumers: Object.keys(consumerModes),
          consumerAttachmentIds,
          consumerModes,
          eagerCompleting:
            (current?.eagerCompleting ?? false) || event.mode === "backfill",
          locallyComplete: current?.locallyComplete ?? false,
          hint: current?.hint ?? null,
        };
        return {
          sessions: nextSessions,
        };
      }),
      标记整附件补齐: assign(({ context, event }) => {
        if (event.type !== "BACKFILL_REQUESTED") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              eagerCompleting: true,
              hint: current.hint ?? "正在补块",
            },
          },
        };
      }),
      标记协作分发活跃: assign(({ context, event }) => {
        if (event.type !== "SWARM_ACTIVE") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              hint: event.hint,
            },
          },
        };
      }),
      标记当前缺少群友: assign(({ context, event }) => {
        if (event.type !== "SWARM_NO_PEERS") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              hint: "正在补块",
            },
          },
        };
      }),
      标记本地已完整: assign(({ context, event }) => {
        if (event.type !== "TORRENT_DONE") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              contentHash: event.contentHash,
              eagerCompleting: false,
              locallyComplete: true,
              hint: "正在协作分发",
            },
          },
        };
      }),
      释放消费者占用: assign(({ context, event }) => {
        if (event.type !== "CONSUMER_RELEASED") {
          return {};
        }
        const current = context.sessions[event.swarmId];
        if (!current) {
          return {};
        }
        const consumerAttachmentIds = { ...current.consumerAttachmentIds };
        const consumerModes = { ...current.consumerModes };
        delete consumerAttachmentIds[event.consumerId];
        delete consumerModes[event.consumerId];
        const nextConsumers = Object.keys(consumerModes);
        if (
          nextConsumers.length === 0 &&
          !current.eagerCompleting &&
          !current.locallyComplete
        ) {
          const nextSessions = 复制会话表(context.sessions);
          delete nextSessions[event.swarmId];
          return {
            sessions: nextSessions,
          };
        }
        return {
          sessions: {
            ...context.sessions,
            [event.swarmId]: {
              ...current,
              attachmentId:
                推导主附件标识(consumerAttachmentIds) || current.attachmentId,
              consumers: nextConsumers,
              consumerAttachmentIds,
              consumerModes,
            },
          },
        };
      }),
      删除失效会话: assign(({ context, event }) => {
        if (event.type !== "SESSION_DROPPED") {
          return {};
        }
        const nextSessions = 复制会话表(context.sessions);
        delete nextSessions[event.swarmId];
        return {
          sessions: nextSessions,
        };
      }),
      同步生命周期策略: assign(({ event }) => {
        if (event.type !== "LIFECYCLE_POLICY_CHANGED") {
          return {};
        }
        return {
          heavyWorkPolicy: event.heavyWorkPolicy,
        };
      }),
      重置全部会话: assign(() => 初始资产协作分发上下文),
    },
  }
);

export type 资产协作分发快照 = SnapshotFrom<typeof 资产协作分发机>;

export function 创建资产协作分发Actor() {
  return createActor(资产协作分发机).start();
}

let 资产协作分发Actor实例 = 创建资产协作分发Actor();
const 底层协作分发会话表 = new Map<string, 底层协作分发会话>();

const 按生命周期策略清理协作分发会话 = (
  heavyWorkPolicy: 资产协作分发上下文["heavyWorkPolicy"]
): void => {
  if (heavyWorkPolicy === "normal") {
    return;
  }
  for (const [swarmId, session] of 底层协作分发会话表) {
    if (!是否为零消费者冷协作分发会话(session)) {
      continue;
    }
    停止协作分发存活上报(session);
    底层协作分发会话表.delete(swarmId);
    清理协作分发底层会话(session);
    资产协作分发Actor实例.send({
      type: "SESSION_DROPPED",
      swarmId,
    });
  }
};

export const 发送资产协作分发事件 = (event: 资产协作分发事件): void => {
  资产协作分发Actor实例.send(event);
  if (event.type === "LIFECYCLE_POLICY_CHANGED") {
    按生命周期策略清理协作分发会话(event.heavyWorkPolicy);
  }
};

const 推导协作分发提示 = (session: 底层协作分发会话): 协作分发媒体源["hint"] => {
  if (session.hint) {
    return session.hint;
  }
  return session.eagerCompleting ? "正在补块" : "正在协作分发";
};

const 推导消费者模式 = (input: {
  consumerId?: string;
  eagerCompleting?: boolean;
}): 协作分发消费者模式 => {
  if (input.eagerCompleting) {
    return "backfill";
  }
  if (input.consumerId?.startsWith("inline_autoplay:")) {
    return "inline_autoplay";
  }
  if (input.consumerId?.startsWith("viewer:")) {
    return "viewer";
  }
  return "session";
};

function 归一化协作分发消费者(input: {
  attachmentId: string;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
}): 协作分发消费者绑定 {
  return {
    consumerId: input.consumerId ?? input.attachmentId,
    attachmentId: input.attachmentId,
    mode: 推导消费者模式(input),
    onSessionEvent: input.onSessionEvent ?? null,
  };
}

function 更新协作分发会话主附件(session: 底层协作分发会话): void {
  const nextBinding = session.consumerBindings.values().next().value;
  if (nextBinding && typeof nextBinding.attachmentId === "string") {
    session.attachmentId = nextBinding.attachmentId;
  }
}

function 发布协作分发会话事件(
  session: 底层协作分发会话,
  type: 协作分发会话事件["type"]
) {
  for (const binding of session.consumerBindings.values()) {
    if (!binding.onSessionEvent) {
      continue;
    }
    const event: 协作分发会话事件 =
      type === "ASSET_COMPLETE"
        ? {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
            contentHash: session.contentHash,
          }
        : {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
          };
    binding.onSessionEvent(event);
  }
}

function 绑定协作分发会话事件(
  session: 底层协作分发会话,
  torrent: WebTorrent种子
) {
  torrent.on("wire", (wire) => {
    session.hint = wire.type === "webSeed" ? "正在补块" : "正在协作分发";
    发送资产协作分发事件({
      type: "SWARM_ACTIVE",
      swarmId: session.swarmId,
      hint: session.hint,
    });
    发布协作分发会话事件(session, "SWARM_ACTIVE");
  });
  torrent.on("noPeers", () => {
    session.hint = "正在补块";
    发送资产协作分发事件({
      type: "SWARM_NO_PEERS",
      swarmId: session.swarmId,
    });
    发布协作分发会话事件(session, "SWARM_NO_PEERS");
  });
  torrent.on("done", () => {
    session.eagerCompleting = false;
    session.locallyComplete = true;
    session.hint = "正在协作分发";
    发送资产协作分发事件({
      type: "TORRENT_DONE",
      swarmId: session.swarmId,
      contentHash: session.contentHash,
    });
    发布协作分发会话事件(session, "ASSET_COMPLETE");
  });
}

function 激活整附件补齐(session: 底层协作分发会话): void {
  if (session.eagerCompleting) {
    return;
  }
  session.eagerCompleting = true;
  发送资产协作分发事件({
    type: "BACKFILL_REQUESTED",
    swarmId: session.swarmId,
  });
  session.file?.select(1);
}

function 协作分发会话可在零引用后保留(session: 底层协作分发会话): boolean {
  return session.eagerCompleting || session.locallyComplete;
}

async function 确保协作分发会话(input: {
  attachmentId: string;
  kind: 媒体种类;
  distribution: NonNullable<ReturnType<typeof 读取协作分发定位片段>>;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
  reuseOnly?: boolean;
}): Promise<底层协作分发会话 | null> {
  const consumerBinding = 归一化协作分发消费者(input);
  let session = 底层协作分发会话表.get(input.distribution.swarm_id);
  if (session) {
    session.consumerBindings.set(consumerBinding.consumerId, consumerBinding);
    发送资产协作分发事件({
      type: "ACQUIRE_REQUESTED",
      attachmentId: consumerBinding.attachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
      contentHash: session.contentHash,
      consumerId: consumerBinding.consumerId,
      mode: consumerBinding.mode,
    });
    if (input.eagerCompleting) {
      激活整附件补齐(session);
    }
    更新协作分发会话主附件(session);
    启动协作分发存活上报(session, input.distribution);
    return session;
  }

  if (input.reuseOnly) {
    return null;
  }

  session = {
    attachmentId: input.attachmentId,
    swarmId: input.distribution.swarm_id,
    torrentInfoHash: input.distribution.torrent_info_hash!,
    contentHash: input.distribution.content_hash,
    sourcePromise: Promise.resolve(null),
    eagerCompleting: Boolean(input.eagerCompleting),
    locallyComplete: false,
    hint: null,
    presenceIntervalId: null,
    torrent: null,
    file: null,
    consumerBindings: new Map([[consumerBinding.consumerId, consumerBinding]]),
  };
  底层协作分发会话表.set(input.distribution.swarm_id, session);
  发送资产协作分发事件({
    type: "ACQUIRE_REQUESTED",
    attachmentId: consumerBinding.attachmentId,
    swarmId: session.swarmId,
    torrentInfoHash: session.torrentInfoHash,
    contentHash: session.contentHash,
    consumerId: consumerBinding.consumerId,
    mode: consumerBinding.mode,
  });
  if (session.eagerCompleting) {
    发送资产协作分发事件({
      type: "BACKFILL_REQUESTED",
      swarmId: session.swarmId,
    });
  }
  启动协作分发存活上报(session, input.distribution);
  void 请求协作分发持久化存储();

  session.sourcePromise = (async () => {
    const runtime = await 获取或创建协作分发浏览器运行时();
    const torrent = await 接入协作分发种子(runtime, input.distribution);
    session.torrent = torrent;
    if (底层协作分发会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, runtime);
      return null;
    }
    绑定协作分发会话事件(session, torrent);
    const file = 读取首个可播放文件(torrent, input.attachmentId, input.kind);
    session.file = file;
    if (session.eagerCompleting) {
      file.select(1);
    }
    await 探测协作分发媒体源可读性(file.streamURL);
    if (底层协作分发会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, runtime);
      return null;
    }
    return {
      src: file.streamURL,
    };
  })().catch((error) => {
    停止协作分发存活上报(session);
    if (底层协作分发会话表.get(input.distribution.swarm_id) === session) {
      底层协作分发会话表.delete(input.distribution.swarm_id);
      发送资产协作分发事件({
        type: "SESSION_DROPPED",
        swarmId: input.distribution.swarm_id,
      });
    }
    throw error;
  });

  return session;
}

export function 读取协作分发会话状态(swarmId: string) {
  const session = 资产协作分发Actor实例.getSnapshot().context.sessions[swarmId];
  if (!session) {
    return null;
  }
  return {
    attachmentId: session.attachmentId,
    swarmId: session.swarmId,
    refs: session.consumers.length,
    consumers: session.consumers,
    eagerCompleting: session.eagerCompleting,
    locallyComplete: session.locallyComplete,
    hint: session.hint ?? (session.eagerCompleting ? "正在补块" : "正在协作分发"),
  };
}

export function 投影资产协作分发预算(
  snapshot: 资产协作分发快照 = 资产协作分发Actor实例.getSnapshot()
) {
  const sessions = Object.values(snapshot.context.sessions);
  return {
    activeSwarmCount: sessions.length,
    hiddenHeavyTaskCount:
      snapshot.context.heavyWorkPolicy === "normal" ? 0 : sessions.length,
  };
}

export async function 解析协作分发源(input: {
  attachmentId: string;
  kind: 媒体种类;
  locator: 媒体定位结果;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
  reuseOnly?: boolean;
}): Promise<协作分发媒体源 | null> {
  const distribution = 读取可用协作分发片段(input.locator);
  if (!distribution) {
    return null;
  }
  const session = await 确保协作分发会话({
    attachmentId: input.attachmentId,
    kind: input.kind,
    distribution,
    ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
    ...(input.eagerCompleting ? { eagerCompleting: true } : {}),
    ...(input.reuseOnly ? { reuseOnly: true } : {}),
  });
  if (!session) {
    return null;
  }
  const source = await session.sourcePromise;
  if (!source) {
    return null;
  }
  return {
    src: source.src,
    hint: 推导协作分发提示(session),
  };
}

export function 释放协作分发消费者(
  input: string | { attachmentId: string; consumerId?: string }
): void {
  const consumerBinding =
    typeof input === "string"
      ? 归一化协作分发消费者({ attachmentId: input })
      : 归一化协作分发消费者(input);
  for (const [swarmId, session] of 底层协作分发会话表) {
    const binding = session.consumerBindings.get(consumerBinding.consumerId);
    if (!binding || binding.attachmentId !== consumerBinding.attachmentId) {
      continue;
    }
    session.consumerBindings.delete(consumerBinding.consumerId);
    发送资产协作分发事件({
      type: "CONSUMER_RELEASED",
      swarmId,
      attachmentId: binding.attachmentId,
      consumerId: consumerBinding.consumerId,
    });
    if (session.attachmentId === binding.attachmentId) {
      更新协作分发会话主附件(session);
    }
    if (session.consumerBindings.size > 0) {
      continue;
    }
    停止协作分发存活上报(session);
    if (协作分发会话可在零引用后保留(session)) {
      continue;
    }
    底层协作分发会话表.delete(swarmId);
    清理协作分发底层会话(session);
  }
}

export function 重置资产协作分发运行时(): void {
  for (const session of 底层协作分发会话表.values()) {
    停止协作分发存活上报(session);
    清理协作分发底层会话(session);
  }
  底层协作分发会话表.clear();
  资产协作分发Actor实例.stop();
  资产协作分发Actor实例 = 创建资产协作分发Actor();
}
