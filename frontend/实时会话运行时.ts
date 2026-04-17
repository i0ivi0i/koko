import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";

export type 实时连接状态 =
  | "idle"
  | "active"
  | "reduced"
  | "suspended"
  | "subscribing"
  | "reconnecting";

export interface 实时会话上下文 {
  roomId: string;
  sessionId: string;
  latestEventPosition: number;
  online: boolean;
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  connectionState: 实时连接状态;
  needsResubscribe: boolean;
  backgroundDrainPending: boolean;
  lastDisconnectCode: string;
}

export type 实时会话事件 =
  | {
      type: "CONNECT_REQUESTED";
      roomId: string;
      sessionId: string;
      latestEventPosition: number;
    }
  | {
      type: "SUBSCRIPTION_STARTED";
    }
  | {
      type: "SUBSCRIPTION_ESTABLISHED";
      latestEventPosition: number;
    }
  | {
      type: "SOCKET_DISCONNECTED";
      code: string;
    }
  | {
      type: "OFFLINE_STATUS_CHANGED";
      online: boolean;
    }
  | {
      type: "LIFECYCLE_POLICY_CHANGED";
      heavyWorkPolicy: "normal" | "reduced" | "suspended";
    }
  | {
      type: "BACKGROUND_DRAIN_REQUESTED";
    }
  | {
      type: "BACKGROUND_DRAIN_FINISHED";
    }
  | {
      type: "ROOM_VIEW_EXITED";
    };

const 初始实时会话上下文: 实时会话上下文 = {
  roomId: "",
  sessionId: "",
  latestEventPosition: 0,
  online: true,
  heavyWorkPolicy: "normal",
  connectionState: "idle",
  needsResubscribe: false,
  backgroundDrainPending: false,
  lastDisconnectCode: "",
};

const 房间已绑定 = (context: 实时会话上下文): boolean =>
  context.roomId.trim().length > 0 && context.sessionId.trim().length > 0;

const 推导静态连接状态 = (
  context: Pick<实时会话上下文, "roomId" | "sessionId" | "online" | "heavyWorkPolicy">
): 实时连接状态 => {
  if (!房间已绑定(context as 实时会话上下文)) {
    return "idle";
  }
  if (context.heavyWorkPolicy === "suspended") {
    return "suspended";
  }
  if (!context.online) {
    return "reconnecting";
  }
  if (context.heavyWorkPolicy === "reduced") {
    return "reduced";
  }
  return "active";
};

/**
 * RealtimeSessionActor 只拥有“连接会话真相”：
 * - 当前房间/会话的 realtime 绑定是否已经建立；
 * - 生命周期与在线状态是否要求它降载、挂起或重连；
 * - 当前后台排空请求是否仍然待处理。
 *
 * 它不直接碰 socket，也不自己恢复房间快照。
 */
const 实时会话机 = createMachine(
  {
    types: {} as {
      context: 实时会话上下文;
      events: 实时会话事件;
    },
    id: "实时会话机",
    initial: "活跃",
    context: 初始实时会话上下文,
    states: {
      活跃: {
        on: {
          CONNECT_REQUESTED: {
            actions: "接管房间会话基线",
          },
          SUBSCRIPTION_STARTED: {
            actions: "标记订阅进行中",
          },
          SUBSCRIPTION_ESTABLISHED: {
            actions: "记录订阅已建立",
          },
          SOCKET_DISCONNECTED: {
            actions: "标记等待重连",
          },
          OFFLINE_STATUS_CHANGED: {
            actions: "同步在线状态",
          },
          LIFECYCLE_POLICY_CHANGED: {
            actions: "同步生命周期策略",
          },
          BACKGROUND_DRAIN_REQUESTED: {
            actions: "挂起后台排空请求",
          },
          BACKGROUND_DRAIN_FINISHED: {
            actions: "清掉后台排空请求",
          },
          ROOM_VIEW_EXITED: {
            actions: "清空会话绑定",
          },
        },
      },
    },
  },
  {
    actions: {
      接管房间会话基线: assign(({ event, context }) => {
        if (event.type !== "CONNECT_REQUESTED") {
          return {};
        }
        const nextContext: 实时会话上下文 = {
          ...context,
          roomId: event.roomId,
          sessionId: event.sessionId,
          latestEventPosition: event.latestEventPosition,
          needsResubscribe: false,
          lastDisconnectCode: "",
        };
        return {
          ...nextContext,
          connectionState: 推导静态连接状态(nextContext),
        };
      }),
      标记订阅进行中: assign(({ context }) => {
        if (!房间已绑定(context)) {
          return {};
        }
        return {
          connectionState: context.heavyWorkPolicy === "suspended" ? "suspended" : "subscribing",
          needsResubscribe: false,
        };
      }),
      记录订阅已建立: assign(({ event, context }) => {
        if (event.type !== "SUBSCRIPTION_ESTABLISHED") {
          return {};
        }
        const nextContext: 实时会话上下文 = {
          ...context,
          latestEventPosition: Math.max(
            context.latestEventPosition,
            event.latestEventPosition
          ),
          needsResubscribe: false,
          lastDisconnectCode: "",
        };
        return {
          ...nextContext,
          connectionState: 推导静态连接状态(nextContext),
        };
      }),
      标记等待重连: assign(({ event, context }) => {
        if (event.type !== "SOCKET_DISCONNECTED") {
          return {};
        }
        if (!房间已绑定(context)) {
          return {
            lastDisconnectCode: event.code,
          };
        }
        return {
          connectionState: context.heavyWorkPolicy === "suspended" ? "suspended" : "reconnecting",
          needsResubscribe: context.online && context.heavyWorkPolicy !== "suspended",
          lastDisconnectCode: event.code,
        };
      }),
      同步在线状态: assign(({ event, context }) => {
        if (event.type !== "OFFLINE_STATUS_CHANGED") {
          return {};
        }
        const nextContext: 实时会话上下文 = {
          ...context,
          online: event.online,
        };
        if (!房间已绑定(nextContext)) {
          return {
            online: event.online,
            connectionState: "idle" as const,
            needsResubscribe: false,
          };
        }
        if (!event.online) {
          return {
            online: false,
            connectionState:
              nextContext.heavyWorkPolicy === "suspended" ? "suspended" : "reconnecting",
            needsResubscribe: false,
          };
        }
        return {
          online: true,
          connectionState:
            nextContext.heavyWorkPolicy === "suspended" ? "suspended" : "reconnecting",
          needsResubscribe: nextContext.heavyWorkPolicy !== "suspended",
        };
      }),
      同步生命周期策略: assign(({ event, context }) => {
        if (event.type !== "LIFECYCLE_POLICY_CHANGED") {
          return {};
        }
        const nextContext: 实时会话上下文 = {
          ...context,
          heavyWorkPolicy: event.heavyWorkPolicy,
        };
        if (!房间已绑定(nextContext)) {
          return {
            heavyWorkPolicy: event.heavyWorkPolicy,
            connectionState: "idle" as const,
            needsResubscribe: false,
          };
        }
        if (event.heavyWorkPolicy === "suspended") {
          return {
            heavyWorkPolicy: "suspended" as const,
            connectionState: "suspended" as const,
            needsResubscribe: false,
          };
        }
        if (event.heavyWorkPolicy === "reduced") {
          return {
            heavyWorkPolicy: "reduced" as const,
            connectionState: "reduced" as const,
            needsResubscribe: false,
          };
        }
        return {
          heavyWorkPolicy: "normal" as const,
          connectionState: context.connectionState === "active" ? "active" : "reconnecting",
          needsResubscribe: context.connectionState === "active" ? false : context.online,
        };
      }),
      挂起后台排空请求: assign(() => ({
        backgroundDrainPending: true,
      })),
      清掉后台排空请求: assign(() => ({
        backgroundDrainPending: false,
      })),
      清空会话绑定: assign(() => 初始实时会话上下文),
    },
  }
);

export type 实时会话快照 = SnapshotFrom<typeof 实时会话机>;

export function 创建实时会话Actor() {
  return createActor(实时会话机).start();
}
