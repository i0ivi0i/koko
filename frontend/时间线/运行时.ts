import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type { 消息事件 } from "../聊天共享/契约.js";
import { 推进房间时间线 } from "./领域.js";
import type { 聊天时间线状态 } from "../应用根/聊天状态.js";

export interface 房间时间线上下文 {
  messages: 消息事件[];
  latestEventPosition: number;
  hasMoreBefore: boolean;
}

export type 房间时间线事件 =
  | {
      type: "AUTHORITATIVE_SNAPSHOT_LOADED";
      messages: 消息事件[];
      latestEventPosition: number;
      hasMoreBefore: boolean;
    }
  | {
      type: "HISTORY_PAGE_APPENDED";
      messages: 消息事件[];
      hasMoreBefore: boolean;
    }
  | {
      type: "REALTIME_EVENTS_RECEIVED";
      messages: 消息事件[];
      latestEventPosition: number;
    }
  | {
      type: "OPTIMISTIC_MESSAGE_ADDED";
      message: 消息事件;
    }
  | {
      type: "ROOM_SOFT_RESET";
    };

const 初始房间时间线上下文: 房间时间线上下文 = {
  messages: [],
  latestEventPosition: 0,
  hasMoreBefore: false,
};

/**
 * 时间线运行时 owner 归时间线模块：
 * 1. 这里只维护时间线合流后的事实投影；
 * 2. 真正的合流规则继续复用 `时间线/领域.ts`；
 * 3. 旧根文件已删除，避免时间线状态机继续散落在 frontend 根目录。
 */
const 房间时间线机 = createMachine(
  {
    types: {} as {
      context: 房间时间线上下文;
      events: 房间时间线事件;
    },
    id: "房间时间线机",
    initial: "活跃",
    context: 初始房间时间线上下文,
    states: {
      活跃: {
        on: {
          AUTHORITATIVE_SNAPSHOT_LOADED: {
            actions: "写入权威快照基线",
          },
          HISTORY_PAGE_APPENDED: {
            actions: "前插历史页",
          },
          REALTIME_EVENTS_RECEIVED: {
            actions: "追加权威实时事件",
          },
          OPTIMISTIC_MESSAGE_ADDED: {
            actions: "追加本地乐观消息",
          },
          ROOM_SOFT_RESET: {
            actions: "重置时间线",
          },
        },
      },
    },
  },
  {
    actions: {
      写入权威快照基线: assign(({ event }) => {
        if (event.type !== "AUTHORITATIVE_SNAPSHOT_LOADED") {
          return {};
        }
        return {
          messages: 推进房间时间线([], {
            type: "SNAPSHOT",
            messages: event.messages,
          }),
          latestEventPosition: event.latestEventPosition,
          hasMoreBefore: event.hasMoreBefore,
        };
      }),
      前插历史页: assign(({ event, context }) => {
        if (event.type !== "HISTORY_PAGE_APPENDED") {
          return {};
        }
        return {
          messages: 推进房间时间线(context.messages, {
            type: "HISTORY",
            messages: event.messages,
          }),
          latestEventPosition: context.latestEventPosition,
          hasMoreBefore: event.hasMoreBefore,
        };
      }),
      追加权威实时事件: assign(({ event, context }) => {
        if (event.type !== "REALTIME_EVENTS_RECEIVED") {
          return {};
        }
        return {
          messages: 推进房间时间线(context.messages, {
            type: "REALTIME",
            events: event.messages,
          }),
          latestEventPosition: Math.max(
            context.latestEventPosition,
            event.latestEventPosition
          ),
          hasMoreBefore: context.hasMoreBefore,
        };
      }),
      追加本地乐观消息: assign(({ event, context }) => {
        if (event.type !== "OPTIMISTIC_MESSAGE_ADDED") {
          return {};
        }
        return {
          messages: 推进房间时间线(context.messages, {
            type: "OPTIMISTIC",
            message: event.message,
          }),
        };
      }),
      重置时间线: assign(() => 初始房间时间线上下文),
    },
  }
);

export type 房间时间线快照 = SnapshotFrom<typeof 房间时间线机>;

export type 房间时间线投影 = Pick<聊天时间线状态, "messages" | "hasMoreBefore">;

export function 投影时间线快照到聊天时间线状态(
  snapshot: 房间时间线快照 | 房间时间线上下文
): 房间时间线投影 {
  const context = "context" in snapshot ? snapshot.context : snapshot;
  return {
    messages: context.messages,
    hasMoreBefore: context.hasMoreBefore,
  };
}

export function 创建房间时间线Actor() {
  return createActor(房间时间线机).start();
}
