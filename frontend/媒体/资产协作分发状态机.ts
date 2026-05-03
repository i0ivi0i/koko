import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type {
  WebTorrentSessionLifecycleSnapshot,
  协作分发消费者模式,
  底层协作分发会话,
  资产协作分发上下文,
  资产协作分发事件,
  资产协作分发会话快照,
} from "./资产协作分发运行时.js";
const 初始资产协作分发上下文: 资产协作分发上下文 = {
  heavyWorkPolicy: "normal",
  sessions: {},
  lastDroppedReason: null,
};

const 复制会话表 = (
  sessions: Record<string, 资产协作分发会话快照>
): Record<string, 资产协作分发会话快照> => ({ ...sessions });

/**
 * 壳层可以读取 actor 快照，但不能拿到可回写的内部 sessions 引用。
 * 这里保留原快照原型与字段形状，只把最容易被误改的 sessions 投影成副本，
 * 避免调用侧把“读模型”写成“第二套真相”。
 */
export const 投影公开资产协作分发快照 = (
  snapshot: 资产协作分发快照
): 资产协作分发快照 =>
  Object.create(Object.getPrototypeOf(snapshot), {
    ...Object.getOwnPropertyDescriptors(snapshot),
    context: {
      value: {
        ...snapshot.context,
        sessions: 复制会话表(snapshot.context.sessions),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    },
  }) as 资产协作分发快照;

const 推导主附件标识 = (consumerAttachmentIds: Record<string, string>): string =>
  Object.values(consumerAttachmentIds)[0] ?? "";

export const 是否为零消费者冷协作分发会话 = (session: 底层协作分发会话): boolean =>
  session.consumerBindings.size === 0 &&
  !session.eagerCompleting &&
  !session.locallyComplete;

export const 协作分发消费者持有前台播放Reader = (
  mode: 协作分发消费者模式
): boolean => mode === "viewer" || mode === "inline_autoplay";

export const 读取协作分发会话活动Reader数量 = (
  session: 底层协作分发会话
): number => {
  for (const binding of session.consumerBindings.values()) {
    if (协作分发消费者持有前台播放Reader(binding.mode)) {
      return 1;
    }
  }
  return 0;
};

export const 读取协作分发会话生命周期 = (
  session: 底层协作分发会话
): WebTorrentSessionLifecycleSnapshot => ({
  state: session.lifecycleState,
  generation: session.generation,
  ...(session.terminalReason ? { reason: session.terminalReason } : {}),
  activeReaderCount: 读取协作分发会话活动Reader数量(session),
  hasPresenceHeartbeat: session.presenceIntervalId !== null,
  hasJoinTicketRefresh:
    session.joinTicketRefreshTimerId !== null || session.joinTicketRefreshInFlight,
});

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
          SESSION_LIFECYCLE_CHANGED: {
            actions: "同步会话生命周期",
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
          lifecycle: event.lifecycle,
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
              hint: event.hint,
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
          ...(event.reason ? { lastDroppedReason: event.reason } : {}),
        };
      }),
      同步会话生命周期: assign(({ context, event }) => {
        if (event.type !== "SESSION_LIFECYCLE_CHANGED") {
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
              lifecycle: event.lifecycle,
            },
          },
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

export const 创建资产协作分发Actor = () => createActor(资产协作分发机).start();

export type 资产协作分发Actor = ReturnType<typeof 创建资产协作分发Actor>;
