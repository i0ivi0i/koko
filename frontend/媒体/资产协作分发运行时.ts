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
  重置协作分发浏览器运行时,
  type 协作分发底层会话,
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

type 底层协作分发会话 = Omit<协作分发底层会话, "consumerBindings"> & {
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

export interface 资产协作分发运行时端口 {
  send(event: 资产协作分发事件): void;
  snapshot(): 资产协作分发快照;
  读取会话状态(swarmId: string): {
    attachmentId: string;
    swarmId: string;
    refs: number;
    consumers: string[];
    eagerCompleting: boolean;
    locallyComplete: boolean;
    hint: 协作分发媒体源["hint"];
  } | null;
  读取预算(
    snapshot?: 资产协作分发快照
  ): {
    activeSwarmCount: number;
    hiddenHeavyTaskCount: number;
  };
  解析协作分发源(input: {
    attachmentId: string;
    kind: 媒体种类;
    locator: 媒体定位结果;
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
    eagerCompleting?: boolean;
    reuseOnly?: boolean;
  }): Promise<协作分发媒体源 | null>;
  释放协作分发消费者(
    input:
      | string
      | {
          attachmentId: string;
          consumerId?: string;
          丢弃未完成补齐?: boolean;
        }
  ): void;
  重置(): void;
  销毁(): void;
}

const 初始资产协作分发上下文: 资产协作分发上下文 = {
  heavyWorkPolicy: "normal",
  sessions: {},
};

const 复制会话表 = (
  sessions: Record<string, 资产协作分发会话快照>
): Record<string, 资产协作分发会话快照> => ({ ...sessions });

const 推导主附件标识 = (consumerAttachmentIds: Record<string, string>): string =>
  Object.values(consumerAttachmentIds)[0] ?? "";

const 是否为零消费者冷协作分发会话 = (session: 底层协作分发会话): boolean =>
  session.consumerBindings.size === 0 && !session.locallyComplete;

/**
 * AssetDistributionActor 只回答 swarm 会话是否存活、被谁占用、是否已经完整。
 * 浏览器里的 WebTorrent / stream server / 可读性探测仍由 adapter 负责，
 * 这里不复制第二套底层基础设施。
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

const 创建资产协作分发Actor = () => createActor(资产协作分发机).start();

type 资产协作分发Actor = ReturnType<typeof 创建资产协作分发Actor>;

type 资产协作分发运行时内部 = {
  actor: 资产协作分发Actor;
  底层会话表: Map<string, 底层协作分发会话>;
  已销毁: boolean;
};

let 活跃资产协作分发运行时实例数 = 0;

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

const 发送事件 = (
  runtime: 资产协作分发运行时内部,
  event: 资产协作分发事件
): void => {
  if (runtime.已销毁) {
    return;
  }
  runtime.actor.send(event);
  if (event.type === "LIFECYCLE_POLICY_CHANGED") {
    按生命周期策略清理协作分发会话(runtime, event.heavyWorkPolicy);
  }
};

const 删除底层协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  swarmId: string,
  session: 底层协作分发会话
): void => {
  停止协作分发存活上报(session);
  runtime.底层会话表.delete(swarmId);
  清理协作分发底层会话(session);
};

const 按生命周期策略清理协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  heavyWorkPolicy: 资产协作分发上下文["heavyWorkPolicy"]
): void => {
  if (heavyWorkPolicy === "normal") {
    return;
  }
  for (const [swarmId, session] of runtime.底层会话表) {
    if (!是否为零消费者冷协作分发会话(session)) {
      continue;
    }
    删除底层协作分发会话(runtime, swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId,
      });
    }
  }
};

function 绑定协作分发会话事件(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  torrent: WebTorrent种子
) {
  torrent.on("wire", (wire) => {
    session.hint = wire.type === "webSeed" ? "正在补块" : "正在协作分发";
    发送事件(runtime, {
      type: "SWARM_ACTIVE",
      swarmId: session.swarmId,
      hint: session.hint,
    });
    发布协作分发会话事件(session, "SWARM_ACTIVE");
  });
  torrent.on("noPeers", () => {
    session.hint = "正在补块";
    发送事件(runtime, {
      type: "SWARM_NO_PEERS",
      swarmId: session.swarmId,
    });
    发布协作分发会话事件(session, "SWARM_NO_PEERS");
  });
  torrent.on("done", () => {
    session.eagerCompleting = false;
    session.locallyComplete = true;
    session.hint = "正在协作分发";
    发送事件(runtime, {
      type: "TORRENT_DONE",
      swarmId: session.swarmId,
      contentHash: session.contentHash,
    });
    发布协作分发会话事件(session, "ASSET_COMPLETE");
  });
}

function 激活整附件补齐(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void {
  if (session.eagerCompleting) {
    return;
  }
  session.eagerCompleting = true;
  发送事件(runtime, {
    type: "BACKFILL_REQUESTED",
    swarmId: session.swarmId,
  });
  session.file?.select(1);
}

function 协作分发会话可在零引用后保留(session: 底层协作分发会话): boolean {
  return session.eagerCompleting || session.locallyComplete;
}

const 是否应强制丢弃未完成补齐 = (
  input: Parameters<资产协作分发运行时端口["释放协作分发消费者"]>[0],
  session: 底层协作分发会话
): boolean =>
  typeof input !== "string" &&
  input.丢弃未完成补齐 === true &&
  !session.locallyComplete;

async function 确保协作分发会话(
  runtime: 资产协作分发运行时内部,
  input: {
    attachmentId: string;
    kind: 媒体种类;
    distribution: NonNullable<ReturnType<typeof 读取协作分发定位片段>>;
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
    eagerCompleting?: boolean;
    reuseOnly?: boolean;
  }
): Promise<底层协作分发会话 | null> {
  if (runtime.已销毁) {
    return null;
  }
  const consumerBinding = 归一化协作分发消费者(input);
  let session = runtime.底层会话表.get(input.distribution.swarm_id);
  if (session) {
    session.consumerBindings.set(consumerBinding.consumerId, consumerBinding);
    发送事件(runtime, {
      type: "ACQUIRE_REQUESTED",
      attachmentId: consumerBinding.attachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
      contentHash: session.contentHash,
      consumerId: consumerBinding.consumerId,
      mode: consumerBinding.mode,
    });
    if (input.eagerCompleting) {
      激活整附件补齐(runtime, session);
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
    cleanupStarted: false,
    consumerBindings: new Map([[consumerBinding.consumerId, consumerBinding]]),
  };
  runtime.底层会话表.set(input.distribution.swarm_id, session);
  发送事件(runtime, {
    type: "ACQUIRE_REQUESTED",
    attachmentId: consumerBinding.attachmentId,
    swarmId: session.swarmId,
    torrentInfoHash: session.torrentInfoHash,
    contentHash: session.contentHash,
    consumerId: consumerBinding.consumerId,
    mode: consumerBinding.mode,
  });
  if (session.eagerCompleting) {
    发送事件(runtime, {
      type: "BACKFILL_REQUESTED",
      swarmId: session.swarmId,
    });
  }
  启动协作分发存活上报(session, input.distribution);
  void 请求协作分发持久化存储();

  session.sourcePromise = (async () => {
    const browserRuntime = await 获取或创建协作分发浏览器运行时();
    const torrent = await 接入协作分发种子(browserRuntime, input.distribution);
    session.torrent = torrent;
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    绑定协作分发会话事件(runtime, session, torrent);
    const file = 读取首个可播放文件(torrent, input.attachmentId, input.kind);
    session.file = file;
    if (session.eagerCompleting) {
      file.select(1);
    }
    await 探测协作分发媒体源可读性(file.streamURL);
    if (runtime.底层会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, browserRuntime);
      return null;
    }
    return {
      src: file.streamURL,
    };
  })().catch((error) => {
    停止协作分发存活上报(session);
    if (runtime.底层会话表.get(input.distribution.swarm_id) === session) {
      runtime.底层会话表.delete(input.distribution.swarm_id);
      if (!runtime.已销毁) {
        runtime.actor.send({
          type: "SESSION_DROPPED",
          swarmId: input.distribution.swarm_id,
        });
      }
    }
    throw error;
  });

  return session;
}

const 读取会话状态 = (
  runtime: 资产协作分发运行时内部,
  swarmId: string
) => {
  const session = runtime.actor.getSnapshot().context.sessions[swarmId];
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
};

const 读取资产协作分发预算 = (
  runtime: 资产协作分发运行时内部,
  snapshot: 资产协作分发快照 = runtime.actor.getSnapshot()
) => {
  const sessions = Object.values(snapshot.context.sessions);
  return {
    activeSwarmCount: sessions.length,
    hiddenHeavyTaskCount:
      snapshot.context.heavyWorkPolicy === "normal" ? 0 : sessions.length,
  };
};

const 重置运行时 = (runtime: 资产协作分发运行时内部): void => {
  for (const [swarmId, session] of runtime.底层会话表) {
    删除底层协作分发会话(runtime, swarmId, session);
  }
  runtime.actor.send({ type: "RESET" });
};

/**
 * 协作分发运行时现在是可装配实例：
 * - 每个聊天内核/测试都显式持有自己的端口；
 * - 生命周期降载、预算投影、会话清理都沿着这条装配链走；
 * - 不再靠模块级 singleton 把浏览器真相泄漏到别的上下文。
 */
export function 创建资产协作分发运行时(): 资产协作分发运行时端口 {
  活跃资产协作分发运行时实例数 += 1;
  const runtime: 资产协作分发运行时内部 = {
    actor: 创建资产协作分发Actor(),
    底层会话表: new Map<string, 底层协作分发会话>(),
    已销毁: false,
  };

  return {
    send(event): void {
      发送事件(runtime, event);
    },

    snapshot(): 资产协作分发快照 {
      return runtime.actor.getSnapshot();
    },

    读取会话状态(swarmId: string) {
      return 读取会话状态(runtime, swarmId);
    },

    读取预算(snapshot = runtime.actor.getSnapshot()) {
      return 读取资产协作分发预算(runtime, snapshot);
    },

    async 解析协作分发源(input) {
      const distribution = 读取可用协作分发片段(input.locator);
      if (!distribution) {
        return null;
      }
      const session = await 确保协作分发会话(runtime, {
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
        locallyComplete: session.locallyComplete,
      };
    },

    释放协作分发消费者(input): void {
      if (runtime.已销毁) {
        return;
      }
      const consumerBinding =
        typeof input === "string"
          ? 归一化协作分发消费者({ attachmentId: input })
          : 归一化协作分发消费者(input);
      for (const [swarmId, session] of runtime.底层会话表) {
        const binding = session.consumerBindings.get(consumerBinding.consumerId);
        if (!binding || binding.attachmentId !== consumerBinding.attachmentId) {
          continue;
        }
        session.consumerBindings.delete(consumerBinding.consumerId);
        发送事件(runtime, {
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
        if (是否应强制丢弃未完成补齐(input, session)) {
          删除底层协作分发会话(runtime, swarmId, session);
          if (!runtime.已销毁) {
            runtime.actor.send({
              type: "SESSION_DROPPED",
              swarmId,
            });
          }
          continue;
        }
        if (协作分发会话可在零引用后保留(session)) {
          continue;
        }
        删除底层协作分发会话(runtime, swarmId, session);
      }
    },

    重置(): void {
      if (runtime.已销毁) {
        return;
      }
      重置运行时(runtime);
    },

    销毁(): void {
      if (runtime.已销毁) {
        return;
      }
      重置运行时(runtime);
      runtime.已销毁 = true;
      runtime.actor.stop();
      活跃资产协作分发运行时实例数 = Math.max(
        0,
        活跃资产协作分发运行时实例数 - 1
      );
      /**
       * 协作分发浏览器 adapter 仍然是全局共享基础设施。
       * 当最后一个资产运行时实例退场时，一并把它回收掉，
       * 避免测试和多轮会话之间残留旧的 WebTorrent client / stream server。
       */
      if (活跃资产协作分发运行时实例数 === 0) {
        重置协作分发浏览器运行时();
      }
    },
  };
}
