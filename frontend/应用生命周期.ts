import { assign, createActor, createMachine } from "xstate";
import type { 生命周期快照 } from "./平台/index.js";

export interface 应用生命周期上下文 {
  visibility: 生命周期快照["visibility"];
  phase: 生命周期快照["phase"];
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  updateState: "idle" | "waiting_refresh";
  updatePendingStartedAtMs: number | null;
  updatePendingDurationMs: number;
  online: boolean;
}

export type 应用生命周期事件 =
  | { type: "LIFECYCLE_SNAPSHOT_CHANGED"; snapshot: 生命周期快照 }
  | { type: "SERVICE_WORKER_UPDATE_READY"; scope: "app" | "media" }
  | { type: "SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "OFFLINE_STATUS_CHANGED"; online: boolean };

export interface 应用生命周期Actor {
  send(event: 应用生命周期事件): void;
  snapshot(): 应用生命周期上下文;
  stop(): void;
}

const 初始应用生命周期上下文: 应用生命周期上下文 = {
  visibility: "visible",
  phase: "active",
  heavyWorkPolicy: "normal",
  updateState: "idle",
  updatePendingStartedAtMs: null,
  updatePendingDurationMs: 0,
  online: true,
};

const 派生重型工作策略 = (
  snapshot: 生命周期快照
): 应用生命周期上下文["heavyWorkPolicy"] => {
  if (snapshot.phase === "page_hidden" || snapshot.phase === "frozen") {
    return "suspended";
  }
  if (snapshot.visibility === "hidden" || snapshot.phase === "background") {
    return "reduced";
  }
  return "normal";
};

/**
 * 应用生命周期 actor 只拥有前端运行时真相：
 * - 浏览器可见性/阶段；
 * - 重型工作降载策略；
 * - 更新待接管状态；
 * - 在线状态。
 *
 * 它不碰聊天业务副作用，也不直接碰媒体/离线实现。
 */
const 应用生命周期机 = createMachine(
  {
    types: {} as {
      context: 应用生命周期上下文;
      events: 应用生命周期事件;
    },
    id: "应用生命周期机",
    initial: "运行中",
    context: 初始应用生命周期上下文,
    states: {
      运行中: {
        on: {
          LIFECYCLE_SNAPSHOT_CHANGED: {
            actions: "写入生命周期快照",
          },
          SERVICE_WORKER_UPDATE_READY: {
            actions: "标记等待刷新",
          },
          SERVICE_WORKER_CONTROLLER_READY: {
            actions: "清除等待刷新",
          },
          OFFLINE_STATUS_CHANGED: {
            actions: "写入在线状态",
          },
        },
      },
    },
  },
  {
    actions: {
      写入生命周期快照: assign(({ event, context }) => {
        if (event.type !== "LIFECYCLE_SNAPSHOT_CHANGED") {
          return {};
        }
        return {
          visibility: event.snapshot.visibility,
          phase: event.snapshot.phase,
          heavyWorkPolicy: 派生重型工作策略(event.snapshot),
          updatePendingDurationMs:
            context.updateState === "waiting_refresh" &&
            typeof context.updatePendingStartedAtMs === "number"
              ? Date.now() - context.updatePendingStartedAtMs
              : context.updatePendingDurationMs,
        };
      }),
      标记等待刷新: assign(({ event }) => {
        if (event.type !== "SERVICE_WORKER_UPDATE_READY") {
          return {};
        }
        void event.scope;
        return {
          updateState: "waiting_refresh" as const,
          updatePendingStartedAtMs: Date.now(),
          updatePendingDurationMs: 0,
        };
      }),
      清除等待刷新: assign(() => ({
        updateState: "idle" as const,
        updatePendingStartedAtMs: null,
        updatePendingDurationMs: 0,
      })),
      写入在线状态: assign(({ event }) => {
        if (event.type !== "OFFLINE_STATUS_CHANGED") {
          return {};
        }
        return {
          online: event.online,
        };
      }),
    },
  }
);

export function 创建应用生命周期Actor(): 应用生命周期Actor {
  const actor = createActor(应用生命周期机).start();
  return {
    send(event): void {
      actor.send(event);
    },

    snapshot(): 应用生命周期上下文 {
      const context = actor.getSnapshot().context;
      return {
        ...context,
        updatePendingDurationMs:
          context.updateState === "waiting_refresh" &&
          typeof context.updatePendingStartedAtMs === "number"
            ? Date.now() - context.updatePendingStartedAtMs
            : context.updatePendingDurationMs,
      };
    },

    stop(): void {
      actor.stop();
    },
  };
}
