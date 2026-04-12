import type { 媒体查看器打开请求 } from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 应用事件 =
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED"; request: 媒体查看器打开请求 };

export interface 应用运行时依赖 {
  roomScroller: {
    标记用户滚动意图(): void;
    处理滚动事件(scrollContainer: HTMLElement): boolean;
    登记程序滚动来源(source: 程序滚动来源): void;
  };
  阅读推进编排端口: {
    接收视口滚动(): void;
    请求跳到最新(): Promise<void>;
  };
  mediaViewer: {
    打开(input: 媒体查看器打开请求): void;
  };
}

export interface 应用运行时端口 {
  dispatch(event: 应用事件): void;
}

/**
 * AppRuntime 是浏览器壳层进入应用行为的薄入口。
 * 它只做事件分派和 owner 协调：浏览器事件已经在壳层被翻译成应用事件，
 * 真正的滚动、阅读推进和媒体查看裁决仍然留在各自已有 owner 里。
 */
export function 创建应用运行时(deps: 应用运行时依赖): 应用运行时端口 {
  return {
    dispatch(event): void {
      switch (event.type) {
        case "ROOM_SCROLL_INTENT":
          deps.roomScroller.标记用户滚动意图();
          return;
        case "ROOM_SCROLL_OBSERVED": {
          // 历史补偿、程序性滚动尾波和顶部分页都由视口 owner 裁决；
          // runtime 只在它确认“这次滚动仍可观察”后，才通知阅读推进编排。
          const 应继续观察视口 = deps.roomScroller.处理滚动事件(event.scrollContainer);
          if (应继续观察视口) {
            deps.阅读推进编排端口.接收视口滚动();
          }
          return;
        }
        case "ROOM_JUMP_TO_LATEST_REQUESTED":
          void deps.阅读推进编排端口.请求跳到最新();
          return;
        case "MEDIA_OPEN_REQUESTED":
          deps.roomScroller.登记程序滚动来源("media_viewer_open");
          deps.mediaViewer.打开(event.request);
          return;
      }
    },
  };
}
