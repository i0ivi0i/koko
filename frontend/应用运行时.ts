import type { 媒体查看器打开请求 } from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 应用事件 =
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED"; request: 媒体查看器打开请求 };

export interface 应用运行时依赖 {
  /**
   * runtime 不再知道聊天内核里有哪些 owner。
   * 它只认几个明确的应用入口，把浏览器事件翻成应用命令后交出去。
   */
  标记用户滚动意图(): void;
  处理聊天视口滚动(scrollContainer: HTMLElement): void;
  请求跳到最新(): Promise<void>;
  登记程序滚动来源(source: 程序滚动来源): void;
  打开媒体(request: 媒体查看器打开请求): void;
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
      switch (event.type) {
        case "ROOM_SCROLL_INTENT":
          deps.标记用户滚动意图();
          return;
        case "ROOM_SCROLL_OBSERVED":
          deps.处理聊天视口滚动(event.scrollContainer);
          return;
        case "ROOM_JUMP_TO_LATEST_REQUESTED":
          void deps.请求跳到最新();
          return;
        case "MEDIA_OPEN_REQUESTED":
          deps.登记程序滚动来源("media_viewer_open");
          deps.打开媒体(event.request);
          return;
      }
    },
  };
}
