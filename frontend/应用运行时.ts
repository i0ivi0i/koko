import type { 聊天应用命令 } from "./聊天应用内核.js";

type 应用运行时命令 = Extract<
  聊天应用命令,
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement }
  | { type: "MEDIA_INLINE_AUTOPLAY_OBSERVED" }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED" }
  | { type: "MEDIA_SESSION_SIGNALLED"; attachmentId: string; signal: import("./媒体/媒体会话.js").媒体会话信号 }
>;

export type 应用事件 = 应用运行时命令;

export interface 应用运行时依赖 {
  /**
   * AppRuntime 只负责把浏览器信号翻成聊天内核 command。
   * 它不再知道滚动 owner / 媒体 owner 的具体方法名。
   */
  dispatch(command: 应用运行时命令): Promise<void> | void;
}

export interface 应用运行时端口 {
  dispatch(event: 应用事件): void;
}

/**
 * AppRuntime 现在只负责浏览器信号桥接：
 * - 浏览器事件先被翻成应用事件；
 * - runtime 只负责把事件转交给内核/壳层已有入口；
 * - 它不再知道 roomScroller / 阅读推进端口这些具体 owner 名字。
 */
export function 创建应用运行时(deps: 应用运行时依赖): 应用运行时端口 {
  return {
    dispatch(event): void {
      const command: 应用运行时命令 =
        event.type === "ROOM_SCROLL_OBSERVED" ||
        event.type === "MEDIA_INLINE_AUTOPLAY_OBSERVED" ||
        event.type === "MEDIA_OPEN_REQUESTED" ||
        event.type === "MEDIA_SESSION_SIGNALLED"
          ? { ...event }
          : { type: event.type };

      switch (event.type) {
        case "ROOM_SCROLL_INTENT":
        case "ROOM_SCROLL_OBSERVED":
        case "MEDIA_INLINE_AUTOPLAY_OBSERVED":
        case "ROOM_JUMP_TO_LATEST_REQUESTED":
        case "MEDIA_OPEN_REQUESTED":
        case "MEDIA_SESSION_SIGNALLED":
          void deps.dispatch(command);
          return;
      }
    },
  };
}
