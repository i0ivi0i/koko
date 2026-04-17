import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";

export type 缓存更新事件 =
  | { type: "SERVICE_WORKER_UPDATE_READY"; scope: "app" | "media" }
  | { type: "SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "STORAGE_PERSISTENCE_RESULT"; persisted: boolean }
  | { type: "STORAGE_EVICTION_DETECTED" }
  | { type: "PRIMARY_CONTEXT_CHANGED"; contextId: string };

export interface 缓存更新快照 {
  updateState: "idle" | "waiting_refresh";
  waitingScope: "app" | "media" | null;
  primaryContextId: string | null;
  controllerReadyPending: boolean;
  controllerReadyContextId: string | null;
  accelerationState: "best_effort" | "persistent" | "acceleration_loss";
}

export interface 缓存更新运行时 {
  send(event: 缓存更新事件): void;
  snapshot(): 缓存更新快照;
}

const 初始缓存更新快照: 缓存更新快照 = {
  updateState: "idle",
  waitingScope: null,
  primaryContextId: null,
  controllerReadyPending: false,
  controllerReadyContextId: null,
  accelerationState: "best_effort",
};

/**
 * 缓存更新运行时只拥有三件浏览器应用真相：
 * 1. 当前是否处于 update pending；
 * 2. 哪个主上下文有资格宣布 controller ready 真正完成；
 * 3. 本地缓存/持久化是否退化成 acceleration loss。
 *
 * 它不判断聊天业务是否缺失，也不决定具体 UI 文案。
 */
const 缓存更新机 = createMachine(
  {
    types: {} as {
      context: 缓存更新快照;
      events: 缓存更新事件;
    },
    id: "缓存更新机",
    initial: "运行中",
    context: 初始缓存更新快照,
    states: {
      运行中: {
        on: {
          SERVICE_WORKER_UPDATE_READY: {
            actions: "进入等待刷新",
          },
          SERVICE_WORKER_CONTROLLER_READY: {
            actions: "登记控制权已接管",
          },
          PRIMARY_CONTEXT_CHANGED: {
            actions: "同步主上下文",
          },
          STORAGE_PERSISTENCE_RESULT: {
            actions: "同步持久化状态",
          },
          STORAGE_EVICTION_DETECTED: {
            actions: "标记加速层丢失",
          },
        },
      },
    },
  },
  {
    actions: {
      进入等待刷新: assign(({ event }) => {
        if (event.type !== "SERVICE_WORKER_UPDATE_READY") {
          return {};
        }
        return {
          updateState: "waiting_refresh" as const,
          waitingScope: event.scope,
          controllerReadyPending: false,
          controllerReadyContextId: null,
        };
      }),
      登记控制权已接管: assign(({ context }) => {
        if (context.updateState !== "waiting_refresh") {
          return {};
        }
        if (context.primaryContextId) {
          return {
            updateState: "idle" as const,
            waitingScope: null,
            controllerReadyPending: false,
            controllerReadyContextId: context.primaryContextId,
          };
        }
        return {
          controllerReadyPending: true,
        };
      }),
      同步主上下文: assign(({ event, context }) => {
        if (event.type !== "PRIMARY_CONTEXT_CHANGED") {
          return {};
        }
        if (context.controllerReadyPending && context.updateState === "waiting_refresh") {
          return {
            primaryContextId: event.contextId,
            updateState: "idle" as const,
            waitingScope: null,
            controllerReadyPending: false,
            controllerReadyContextId: event.contextId,
          };
        }
        return {
          primaryContextId: event.contextId,
        };
      }),
      同步持久化状态: assign(({ event }) => {
        if (event.type !== "STORAGE_PERSISTENCE_RESULT") {
          return {};
        }
        return {
          accelerationState: event.persisted
            ? ("persistent" as const)
            : ("acceleration_loss" as const),
        };
      }),
      标记加速层丢失: assign(() => ({
        accelerationState: "acceleration_loss" as const,
      })),
    },
  }
);

export type 缓存更新运行时快照 = SnapshotFrom<typeof 缓存更新机>;

export function 创建缓存更新运行时(): 缓存更新运行时 {
  const actor = createActor(缓存更新机).start();
  return {
    send(event): void {
      actor.send(event);
    },

    snapshot(): 缓存更新快照 {
      return { ...actor.getSnapshot().context };
    },
  };
}
