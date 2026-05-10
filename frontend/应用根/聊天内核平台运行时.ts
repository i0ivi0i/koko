import type { 生命周期快照, 缓存更新快照 } from "../平台/index.js";
import type { 实时会话事件 } from "../实时/会话运行时.js";
import type { 聊天本地状态补丁 } from "./聊天本地状态折叠.js";
import type { 媒体播放会话应用端口 } from "../媒体/播放会话/应用.js";

export type 平台桥接命令 =
  | { type: "PLATFORM_LIFECYCLE_CHANGED"; snapshot: 生命周期快照 }
  | { type: "PLATFORM_SERVICE_WORKER_UPDATE_READY"; scope: "app" | "media" }
  | { type: "PLATFORM_SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "PLATFORM_CACHE_UPDATE_CHANGED"; snapshot: 缓存更新快照 }
  | { type: "PLATFORM_BACKGROUND_DRAIN_REQUESTED" }
  | { type: "PLATFORM_OFFLINE_STATUS_CHANGED"; online: boolean };

type 平台运行时媒体端口 = Pick<
  媒体播放会话应用端口,
  "处理应用生命周期" | "释放消息流自动播Owner" | "处理平台在线状态变化"
>;

type 应用生命周期命令 =
  | { type: "LIFECYCLE_SNAPSHOT_CHANGED"; snapshot: 生命周期快照 }
  | { type: "SERVICE_WORKER_UPDATE_READY"; scope: "app" | "media" }
  | { type: "SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "OFFLINE_STATUS_CHANGED"; online: boolean };

type 应用生命周期快照 = Pick<生命周期快照, "visibility" | "phase"> & {
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  updateState: "idle" | "waiting_refresh";
  updatePendingDurationMs: number;
  online: boolean;
};

interface 应用生命周期端口 {
  send(event: 应用生命周期命令): void;
  snapshot(): 应用生命周期快照;
}

interface 聊天内核平台运行时依赖 {
  appLifecycle: 应用生命周期端口;
  媒体编排: 平台运行时媒体端口;
  读取运行时预算(): 聊天本地状态补丁["runtimeBudget"];
  写入本地状态(patch: 聊天本地状态补丁): void;
  接收实时会话事实(event: 实时会话事件): void;
  /** 页面隐藏 / 冻结时主动刷消息仓库缓冲（Task 9）；走平台 lifecycle 路径以守住应用 owner 不听浏览器事件的边界。 */
  flush消息仓库?: () => void;
}

const 同步应用生命周期快照并执行副作用 = (
  deps: 聊天内核平台运行时依赖
): void => {
  const snapshot = deps.appLifecycle.snapshot();
  deps.写入本地状态({
    lifecycleVisibility: snapshot.visibility,
    lifecyclePhase: snapshot.phase,
    heavyWorkPolicy: snapshot.heavyWorkPolicy,
    swUpdateState: snapshot.updateState,
    online: snapshot.online,
    runtimeBudget: {
      ...deps.读取运行时预算(),
      updatePendingDurationMs: snapshot.updatePendingDurationMs,
    },
  });
  deps.媒体编排.处理应用生命周期({
    visibility: snapshot.visibility,
    phase: snapshot.phase,
    heavyWorkPolicy: snapshot.heavyWorkPolicy,
  });
};

/**
 * 平台运行时 owner 只消费浏览器平台事实：
 * 1. 生命周期、Service Worker、离线状态只更新运行时预算和实时会话事实；
 * 2. 媒体侧只接收“降载/在线变化”信号，不在这里决定播放真相；
 * 3. 缓存驱逐只影响加速层状态，禁止推断消息或房间业务事实。
 */
export async function 处理聊天内核平台桥接命令(
  command: 平台桥接命令,
  deps: 聊天内核平台运行时依赖
): Promise<void> {
  switch (command.type) {
    case "PLATFORM_LIFECYCLE_CHANGED": {
      deps.appLifecycle.send({ type: "LIFECYCLE_SNAPSHOT_CHANGED", snapshot: command.snapshot });
      同步应用生命周期快照并执行副作用(deps);
      const heavyWorkPolicy = deps.appLifecycle.snapshot().heavyWorkPolicy;
      deps.接收实时会话事实({ type: "LIFECYCLE_POLICY_CHANGED", heavyWorkPolicy });
      // 页面隐藏/冻结时主动刷仓库 buffer，避免关 tab 丢失最近 100ms 未落盘 REALTIME。
      if (command.snapshot.phase === "page_hidden" || command.snapshot.phase === "frozen") deps.flush消息仓库?.();
      return;
    }
    case "PLATFORM_SERVICE_WORKER_UPDATE_READY":
      deps.appLifecycle.send({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: command.scope,
      });
      同步应用生命周期快照并执行副作用(deps);
      return;
    case "PLATFORM_BACKGROUND_DRAIN_REQUESTED":
      deps.媒体编排.释放消息流自动播Owner();
      deps.接收实时会话事实({ type: "BACKGROUND_DRAIN_REQUESTED" });
      return;
    case "PLATFORM_SERVICE_WORKER_CONTROLLER_READY":
      deps.appLifecycle.send({ type: "SERVICE_WORKER_CONTROLLER_READY" });
      同步应用生命周期快照并执行副作用(deps);
      deps.接收实时会话事实({ type: "BACKGROUND_DRAIN_REQUESTED" });
      return;
    case "PLATFORM_CACHE_UPDATE_CHANGED":
      deps.写入本地状态({
        accelerationState: command.snapshot.accelerationState,
      });
      return;
    case "PLATFORM_OFFLINE_STATUS_CHANGED":
      deps.appLifecycle.send({
        type: "OFFLINE_STATUS_CHANGED",
        online: command.online,
      });
      同步应用生命周期快照并执行副作用(deps);
      deps.媒体编排.处理平台在线状态变化(command.online);
      deps.接收实时会话事实({
        type: "OFFLINE_STATUS_CHANGED",
        online: command.online,
      });
      return;
  }
}
