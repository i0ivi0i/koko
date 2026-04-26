import type { 聊天应用命令 } from "./聊天应用内核.js";
import type { 浏览器应用平台事件 } from "./平台/index.js";

type 应用运行时命令 = Extract<
  聊天应用命令,
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement }
  | { type: "ROOM_MEDIA_WINDOW_OBSERVED"; attachmentIds: string[] }
  | { type: "MEDIA_INLINE_AUTOPLAY_OBSERVED" }
  | { type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED" }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED" }
  | { type: "MEDIA_SESSION_SIGNALLED"; attachmentId: string; signal: import("./媒体/媒体会话.js").媒体会话信号 }
>;

type 平台桥接命令 = Extract<
  聊天应用命令,
  | { type: "PLATFORM_LIFECYCLE_CHANGED" }
  | { type: "PLATFORM_SERVICE_WORKER_UPDATE_READY" }
  | { type: "PLATFORM_SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "PLATFORM_CACHE_UPDATE_CHANGED" }
  | { type: "PLATFORM_BACKGROUND_DRAIN_REQUESTED" }
  | { type: "PLATFORM_OFFLINE_STATUS_CHANGED" }
>;

export type 应用事件 = 应用运行时命令;

export interface 应用运行时依赖 {
  /**
   * AppRuntime 只负责把浏览器信号翻成聊天内核 command。
   * 它不再知道滚动 owner / 媒体 owner 的具体方法名。
   */
  dispatch(command: 应用运行时命令 | 平台桥接命令): Promise<void> | void;
  /**
   * 平台事件订阅也统一收进 AppRuntime。
   * 这样聊天内核以后只处理稳定 command，不再自己碰浏览器平台事件源。
   */
  subscribePlatformEvents?(listener: (event: 浏览器应用平台事件) => void): () => void;
}

export interface 应用运行时端口 {
  dispatch(event: 应用事件): void;
  start(): void;
  dispose(): void;
}

const 翻译平台事件为内核命令 = (event: 浏览器应用平台事件): 平台桥接命令 | null => {
  switch (event.type) {
    case "LIFECYCLE_CHANGED":
      return {
        type: "PLATFORM_LIFECYCLE_CHANGED",
        snapshot: event.snapshot,
      };
    case "SERVICE_WORKER_UPDATE_READY":
      return {
        type: "PLATFORM_SERVICE_WORKER_UPDATE_READY",
        scope: event.scope,
      };
    case "SERVICE_WORKER_CONTROLLER_READY":
      return { type: "PLATFORM_SERVICE_WORKER_CONTROLLER_READY" };
    case "CACHE_UPDATE_CHANGED":
      return {
        type: "PLATFORM_CACHE_UPDATE_CHANGED",
        snapshot: event.snapshot,
      };
    case "BACKGROUND_DRAIN_REQUESTED":
      return { type: "PLATFORM_BACKGROUND_DRAIN_REQUESTED" };
    case "OFFLINE_STATUS_CHANGED":
      return {
        type: "PLATFORM_OFFLINE_STATUS_CHANGED",
        online: event.online,
      };
    case "PRIMARY_CONTEXT_FOCUSED":
      return null;
  }
};

/**
 * AppRuntime 现在只负责浏览器信号桥接：
 * - 浏览器事件先被翻成应用事件；
 * - runtime 只负责把事件转交给内核/壳层已有入口；
 * - 它不再知道 roomScroller / 阅读推进端口这些具体 owner 名字。
 */
export function 创建应用运行时(deps: 应用运行时依赖): 应用运行时端口 {
  let 解除平台订阅: (() => void) | null = null;

  return {
    dispatch(event): void {
      const command: 应用运行时命令 =
        event.type === "ROOM_SCROLL_OBSERVED" ||
        event.type === "ROOM_MEDIA_WINDOW_OBSERVED" ||
        event.type === "MEDIA_INLINE_AUTOPLAY_OBSERVED" ||
        event.type === "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED" ||
        event.type === "MEDIA_OPEN_REQUESTED" ||
        event.type === "MEDIA_SESSION_SIGNALLED"
          ? { ...event }
          : { type: event.type };

      switch (event.type) {
        case "ROOM_SCROLL_INTENT":
        case "ROOM_SCROLL_OBSERVED":
        case "ROOM_MEDIA_WINDOW_OBSERVED":
        case "MEDIA_INLINE_AUTOPLAY_OBSERVED":
        case "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED":
        case "ROOM_JUMP_TO_LATEST_REQUESTED":
        case "MEDIA_OPEN_REQUESTED":
        case "MEDIA_SESSION_SIGNALLED":
          void deps.dispatch(command);
          return;
      }
    },

    start(): void {
      if (解除平台订阅 || typeof deps.subscribePlatformEvents !== "function") {
        return;
      }
      /**
       * 平台事件进入应用后，先在这里翻成稳定 command。
       * 这样后续换平台运行时实现时，聊天内核边界不会再跟着抖动。
       */
      解除平台订阅 = deps.subscribePlatformEvents((event) => {
        const command = 翻译平台事件为内核命令(event);
        if (!command) {
          return;
        }
        void deps.dispatch(command);
      });
    },

    dispose(): void {
      解除平台订阅?.();
      解除平台订阅 = null;
    },
  };
}
