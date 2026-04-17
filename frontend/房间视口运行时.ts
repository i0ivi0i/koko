import { assign, createActor, createMachine } from "xstate";
import type { 聊天视口状态, 房间视口模式 } from "./状态.js";

const 历史分页顶部节流毫秒 = 180;

type 程序滚动原因 = "restore_unread" | "compensate_history" | "jump_to_latest";

export interface 房间视口上下文 {
  viewportMode: 房间视口模式;
  candidateReadAnchorPosition: number | null;
  hasUnreadNewerMessages: boolean;
  initialUnreadSettled: boolean;
  scrollPhase: 聊天视口状态["scrollPhase"];
  hasUserScrollIntent: boolean;
  historyLoadThrottleUntil: number;
  shouldLoadHistory: boolean;
}

export type 房间视口事件 =
  | { type: "SNAPSHOT_BASELINE_SYNCED"; firstUnreadEventPosition: number | null }
  | { type: "USER_SCROLL_INTENT_STARTED" }
  | {
      type: "SCROLL_OBSERVED";
      candidateReadAnchorPosition: number | null;
      isNearBottom: boolean;
      reachedTop: boolean;
      canLoadHistory: boolean;
      now: number;
    }
  | { type: "PROGRAMMATIC_SCROLL_STARTED"; reason: 程序滚动原因 }
  | { type: "PROGRAMMATIC_SCROLL_FINISHED"; reason: 程序滚动原因 }
  | { type: "INITIAL_UNREAD_SETTLED"; firstUnreadEventPosition: number | null }
  | { type: "AUTHORITATIVE_EVENTS_APPENDED" }
  | { type: "JUMP_TO_LATEST_REQUESTED" }
  | { type: "HISTORY_LOAD_CONSUMED" }
  | { type: "ROOM_VIEW_EXITED" };

export interface 房间视口Actor {
  send(event: 房间视口事件): void;
  snapshot(): 房间视口上下文;
  stop(): void;
}

const 初始房间视口上下文: 房间视口上下文 = {
  viewportMode: "离底浏览",
  candidateReadAnchorPosition: null,
  hasUnreadNewerMessages: false,
  initialUnreadSettled: true,
  scrollPhase: "idle",
  hasUserScrollIntent: false,
  historyLoadThrottleUntil: 0,
  shouldLoadHistory: false,
};

const 根据首屏未读派生视口模式 = (firstUnreadEventPosition: number | null): 房间视口模式 =>
  firstUnreadEventPosition === null ? "贴底跟随" : "围绕未读阅读";

/**
 * RoomViewportActor 是视口运行时唯一 owner：
 * - 用户滚动意图是否成立；
 * - 程序滚动当前处在哪个阶段；
 * - 当前处于围绕未读、贴底跟随还是离底浏览；
 * - 顶部触发是否允许真正发起历史分页。
 *
 * 它不直接操作 DOM，也不直接发网络请求；
 * DOM 观测和 IO 仍由 scroll adapter / 阅读推进编排执行。
 */
const 房间视口机 = createMachine(
  {
    types: {} as {
      context: 房间视口上下文;
      events: 房间视口事件;
    },
    id: "房间视口机",
    initial: "运行中",
    context: 初始房间视口上下文,
    states: {
      运行中: {
        on: {
          SNAPSHOT_BASELINE_SYNCED: {
            actions: "同步房间基线",
          },
          USER_SCROLL_INTENT_STARTED: {
            actions: "记录用户滚动意图",
          },
          SCROLL_OBSERVED: {
            actions: "处理视口观测",
          },
          PROGRAMMATIC_SCROLL_STARTED: {
            actions: "记录程序滚动开始",
          },
          PROGRAMMATIC_SCROLL_FINISHED: {
            actions: "记录程序滚动结束",
          },
          INITIAL_UNREAD_SETTLED: {
            actions: "记录首屏稳定完成",
          },
          AUTHORITATIVE_EVENTS_APPENDED: {
            actions: "记录权威新消息到达",
          },
          JUMP_TO_LATEST_REQUESTED: {
            actions: "切回贴底跟随",
          },
          HISTORY_LOAD_CONSUMED: {
            actions: "消费历史分页请求",
          },
          ROOM_VIEW_EXITED: {
            actions: "重置房间视口",
          },
        },
      },
    },
  },
  {
    actions: {
      同步房间基线: assign(({ event }) => {
        if (event.type !== "SNAPSHOT_BASELINE_SYNCED") {
          return {};
        }
        return {
          viewportMode: 根据首屏未读派生视口模式(event.firstUnreadEventPosition),
          candidateReadAnchorPosition: null,
          hasUnreadNewerMessages: false,
          initialUnreadSettled: false,
          scrollPhase:
            event.firstUnreadEventPosition === null ? "idle" : ("restoring_unread" as const),
          hasUserScrollIntent: false,
          historyLoadThrottleUntil: 0,
          shouldLoadHistory: false,
        };
      }),
      记录用户滚动意图: assign(() => ({
        hasUserScrollIntent: true,
      })),
      处理视口观测: assign(({ event, context }) => {
        if (event.type !== "SCROLL_OBSERVED") {
          return {};
        }
        if (context.scrollPhase !== "idle") {
          return {
            shouldLoadHistory: false,
          };
        }
        const 允许推进候选已读 =
          context.initialUnreadSettled &&
          context.hasUserScrollIntent &&
          event.candidateReadAnchorPosition !== null;
        const 观测候选位置 = event.candidateReadAnchorPosition;
        const nextCandidate = !允许推进候选已读
          ? context.candidateReadAnchorPosition
          : context.candidateReadAnchorPosition === null
            ? 观测候选位置
            : Math.max(context.candidateReadAnchorPosition, 观测候选位置!);
        const nextViewportMode = event.isNearBottom
          ? "贴底跟随"
          : context.viewportMode === "贴底跟随"
            ? "离底浏览"
            : context.viewportMode;
        const shouldLoadHistory =
          event.reachedTop &&
          event.canLoadHistory &&
          context.hasUserScrollIntent &&
          event.now >= context.historyLoadThrottleUntil;
        return {
          candidateReadAnchorPosition: nextCandidate,
          viewportMode: nextViewportMode,
          hasUnreadNewerMessages:
            nextViewportMode === "贴底跟随" ? false : context.hasUnreadNewerMessages,
          historyLoadThrottleUntil: shouldLoadHistory
            ? event.now + 历史分页顶部节流毫秒
            : context.historyLoadThrottleUntil,
          shouldLoadHistory,
        };
      }),
      记录程序滚动开始: assign(({ event }) => {
        if (event.type !== "PROGRAMMATIC_SCROLL_STARTED") {
          return {};
        }
        if (event.reason === "restore_unread") {
          return { scrollPhase: "restoring_unread" as const };
        }
        if (event.reason === "compensate_history") {
          return { scrollPhase: "compensating_history" as const };
        }
        return {};
      }),
      记录程序滚动结束: assign(({ event, context }) => {
        if (event.type !== "PROGRAMMATIC_SCROLL_FINISHED") {
          return {};
        }
        if (event.reason === "restore_unread") {
          return context.initialUnreadSettled ? { scrollPhase: "idle" as const } : {};
        }
        if (event.reason === "compensate_history") {
          return { scrollPhase: "idle" as const };
        }
        return {};
      }),
      记录首屏稳定完成: assign(({ event }) => {
        if (event.type !== "INITIAL_UNREAD_SETTLED") {
          return {};
        }
        return {
          viewportMode: 根据首屏未读派生视口模式(event.firstUnreadEventPosition),
          hasUnreadNewerMessages: false,
          initialUnreadSettled: true,
          scrollPhase: "idle" as const,
        };
      }),
      记录权威新消息到达: assign(({ context }) => ({
        hasUnreadNewerMessages: context.viewportMode === "贴底跟随" ? false : true,
      })),
      切回贴底跟随: assign(() => ({
        viewportMode: "贴底跟随" as const,
        hasUnreadNewerMessages: false,
        hasUserScrollIntent: true,
      })),
      消费历史分页请求: assign(() => ({
        shouldLoadHistory: false,
      })),
      重置房间视口: assign(() => 初始房间视口上下文),
    },
  }
);

export function 投影视口快照到聊天视口状态(
  snapshot: 房间视口上下文
): Pick<
  聊天视口状态,
  | "viewportMode"
  | "candidateReadAnchorPosition"
  | "hasUnreadNewerMessages"
  | "initialUnreadSettled"
  | "scrollPhase"
  | "hasUserScrollIntent"
  | "historyLoadThrottleUntil"
> {
  return {
    viewportMode: snapshot.viewportMode,
    candidateReadAnchorPosition: snapshot.candidateReadAnchorPosition,
    hasUnreadNewerMessages: snapshot.hasUnreadNewerMessages,
    initialUnreadSettled: snapshot.initialUnreadSettled,
    scrollPhase: snapshot.scrollPhase,
    hasUserScrollIntent: snapshot.hasUserScrollIntent,
    historyLoadThrottleUntil: snapshot.historyLoadThrottleUntil,
  };
}

export function 创建房间视口Actor(): 房间视口Actor {
  const actor = createActor(房间视口机).start();
  return {
    send(event): void {
      actor.send(event);
    },
    snapshot(): 房间视口上下文 {
      return { ...actor.getSnapshot().context };
    },
    stop(): void {
      actor.stop();
    },
  };
}
