import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";

export type 房间阶段 =
  | "引导中"
  | "大厅中"
  | "入房中"
  | "恢复中"
  | "房间就绪"
  | "订阅中"
  | "在线会话中"
  | "重连中"
  | "可重试失败"
  | "已离房";

/**
 * 房间内核只保存“房间会话编排基线”。
 *
 * 它负责回答：
 * - 当前引导 / 入房 / 恢复 / 重连处在哪个阶段；
 * - 当前壳层应该拿哪一个房间基线去恢复；
 * - 当前恢复错误码是什么。
 *
 * 它明确不再承载视口、滚动、未读候选这类浏览器运行时真相，
 * 那些裁决已经收口到 RoomViewportActor。
 */
export interface 房间内核上下文 {
  sessionId: string;
  displayAlias: string;
  roomId: string;
  roomDisplayTitle: string;
  latestEventPosition: number;
  lastRecoveryErrorCode: string;
}

export type 房间内核事件 =
  | {
      type: "BOOTSTRAP_SUCCEEDED";
      sessionId: string;
      displayAlias: string;
      roomId: string;
    }
  | {
      type: "BOOTSTRAP_FAILED";
      code: string;
    }
  | {
      type: "SESSION_REFRESHED";
      sessionId: string;
      displayAlias: string;
    }
  | {
      type: "JOIN_REQUESTED";
    }
  | {
      type: "SNAPSHOT_LOADED";
      roomId: string;
      roomDisplayTitle: string;
      latestEventPosition: number;
    }
  | {
      type: "LATEST_EVENT_ADVANCED";
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
      type: "RECONNECTING_STARTED";
      code: string;
    }
  | {
      type: "RECOVERY_FAILED";
      code: string;
      keepRoomVisible: boolean;
    }
  | {
      type: "SOFT_LEAVE_REQUESTED";
    };

const 房间编排机 = createMachine(
  {
    types: {} as {
      context: 房间内核上下文;
      events: 房间内核事件;
    },
    id: "房间编排机",
    initial: "引导中",
    context: {
      sessionId: "",
      displayAlias: "",
      roomId: "",
      roomDisplayTitle: "",
      latestEventPosition: 0,
      lastRecoveryErrorCode: "",
    },
    states: {
      引导中: {
        on: {
          BOOTSTRAP_SUCCEEDED: [
            {
              guard: ({ event }) => event.roomId.trim().length > 0,
              target: "恢复中",
              actions: "写入引导结果",
            },
            {
              target: "大厅中",
              actions: "写入引导结果",
            },
          ],
          BOOTSTRAP_FAILED: {
            target: "可重试失败",
            actions: "记录引导失败",
          },
        },
      },
      大厅中: {
        on: {
          JOIN_REQUESTED: {
            target: "入房中",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      入房中: {
        on: {
          SNAPSHOT_LOADED: {
            target: "房间就绪",
            actions: "写入房间快照",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      恢复中: {
        on: {
          SNAPSHOT_LOADED: {
            target: "房间就绪",
            actions: "写入房间快照",
          },
          RECONNECTING_STARTED: {
            target: "重连中",
            actions: "标记重连中",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      房间就绪: {
        on: {
          LATEST_EVENT_ADVANCED: {
            actions: "推进最新事件位置",
          },
          SUBSCRIPTION_STARTED: {
            target: "订阅中",
          },
          RECONNECTING_STARTED: {
            target: "重连中",
            actions: "标记重连中",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SOFT_LEAVE_REQUESTED: {
            target: "已离房",
            actions: "清空当前房间",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      订阅中: {
        on: {
          LATEST_EVENT_ADVANCED: {
            actions: "推进最新事件位置",
          },
          SUBSCRIPTION_ESTABLISHED: {
            target: "在线会话中",
            actions: "记录订阅已建立",
          },
          RECONNECTING_STARTED: {
            target: "重连中",
            actions: "标记重连中",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SOFT_LEAVE_REQUESTED: {
            target: "已离房",
            actions: "清空当前房间",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      在线会话中: {
        on: {
          LATEST_EVENT_ADVANCED: {
            actions: "推进最新事件位置",
          },
          RECONNECTING_STARTED: {
            target: "重连中",
            actions: "标记重连中",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SOFT_LEAVE_REQUESTED: {
            target: "已离房",
            actions: "清空当前房间",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      重连中: {
        on: {
          LATEST_EVENT_ADVANCED: {
            actions: "推进最新事件位置",
          },
          SNAPSHOT_LOADED: {
            target: "房间就绪",
            actions: "写入房间快照",
          },
          SUBSCRIPTION_ESTABLISHED: {
            target: "在线会话中",
            actions: "记录订阅已建立",
          },
          RECOVERY_FAILED: [
            {
              guard: ({ event }) => event.keepRoomVisible,
              target: "可重试失败",
              actions: "保留房间并记录失败",
            },
            {
              target: "可重试失败",
              actions: "清空房间并记录失败",
            },
          ],
          SOFT_LEAVE_REQUESTED: {
            target: "已离房",
            actions: "清空当前房间",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      可重试失败: {
        on: {
          LATEST_EVENT_ADVANCED: {
            actions: "推进最新事件位置",
          },
          JOIN_REQUESTED: {
            target: "入房中",
          },
          RECONNECTING_STARTED: {
            target: "重连中",
            actions: "标记重连中",
          },
          SNAPSHOT_LOADED: {
            target: "房间就绪",
            actions: "写入房间快照",
          },
          SOFT_LEAVE_REQUESTED: {
            target: "已离房",
            actions: "清空当前房间",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
        },
      },
      已离房: {
        on: {
          JOIN_REQUESTED: {
            target: "入房中",
          },
          SESSION_REFRESHED: {
            actions: "写入刷新身份",
          },
          BOOTSTRAP_SUCCEEDED: [
            {
              guard: ({ event }) => event.roomId.trim().length > 0,
              target: "恢复中",
              actions: "写入引导结果",
            },
            {
              target: "大厅中",
              actions: "写入引导结果",
            },
          ],
        },
      },
    },
  },
  {
    actions: {
      写入引导结果: assign(({ event, context }) => {
        if (event.type !== "BOOTSTRAP_SUCCEEDED") {
          return {};
        }
        return {
          sessionId: event.sessionId,
          displayAlias: event.displayAlias,
          roomId: event.roomId,
          roomDisplayTitle:
            event.roomId.trim().length > 0 ? context.roomDisplayTitle : "",
          latestEventPosition:
            event.roomId.trim().length > 0 ? context.latestEventPosition : 0,
          lastRecoveryErrorCode: "",
        };
      }),
      记录引导失败: assign(({ event }) => {
        if (event.type !== "BOOTSTRAP_FAILED") {
          return {};
        }
        return {
          roomId: "",
          roomDisplayTitle: "",
          latestEventPosition: 0,
          lastRecoveryErrorCode: event.code,
        };
      }),
      写入刷新身份: assign(({ event }) => {
        if (event.type !== "SESSION_REFRESHED") {
          return {};
        }
        return {
          sessionId: event.sessionId,
          displayAlias: event.displayAlias,
        };
      }),
      写入房间快照: assign(({ event }) => {
        if (event.type !== "SNAPSHOT_LOADED") {
          return {};
        }
        return {
          roomId: event.roomId,
          roomDisplayTitle: event.roomDisplayTitle,
          latestEventPosition: event.latestEventPosition,
          lastRecoveryErrorCode: "",
        };
      }),
      记录订阅已建立: assign(({ event }) => {
        if (event.type !== "SUBSCRIPTION_ESTABLISHED") {
          return {};
        }
        return {
          latestEventPosition: event.latestEventPosition,
          lastRecoveryErrorCode: "",
        };
      }),
      推进最新事件位置: assign(({ event, context }) => {
        if (event.type !== "LATEST_EVENT_ADVANCED") {
          return {};
        }
        return {
          latestEventPosition: Math.max(
            context.latestEventPosition,
            event.latestEventPosition
          ),
          lastRecoveryErrorCode: "",
        };
      }),
      标记重连中: assign(({ event }) => {
        if (event.type !== "RECONNECTING_STARTED") {
          return {};
        }
        return {
          lastRecoveryErrorCode: event.code,
        };
      }),
      保留房间并记录失败: assign(({ event }) => {
        if (event.type !== "RECOVERY_FAILED") {
          return {};
        }
        return {
          lastRecoveryErrorCode: event.code,
        };
      }),
      清空房间并记录失败: assign(({ event }) => {
        if (event.type !== "RECOVERY_FAILED") {
          return {};
        }
        return {
          roomId: "",
          roomDisplayTitle: "",
          latestEventPosition: 0,
          lastRecoveryErrorCode: event.code,
        };
      }),
      清空当前房间: assign(() => ({
        roomId: "",
        roomDisplayTitle: "",
        latestEventPosition: 0,
        lastRecoveryErrorCode: "",
      })),
    },
  }
);

export type 房间内核快照 = SnapshotFrom<typeof 房间编排机>;

export interface 房间壳外观 {
  bootstrapState: "booting" | "ready";
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  sessionId: string;
  displayAlias: string;
  roomId: string;
  roomDisplayTitle: string;
  latestEventPosition: number;
  lastRecoveryErrorCode: string;
}

/**
 * 壳层只读取这个稳定外观：
 * 房间阶段和恢复语义可以继续演进，但房间壳补丁的消费面保持窄而稳。
 */
export function 派生房间壳外观(snapshot: 房间内核快照): 房间壳外观 {
  const phase = snapshot.value as 房间阶段;
  return {
    bootstrapState: phase === "引导中" ? "booting" : "ready",
    recoveryState:
      phase === "重连中"
        ? "reconnecting"
        : phase === "可重试失败"
          ? "retryable_failure"
          : "idle",
    sessionId: snapshot.context.sessionId,
    displayAlias: snapshot.context.displayAlias,
    roomId: snapshot.context.roomId,
    roomDisplayTitle: snapshot.context.roomDisplayTitle,
    latestEventPosition: snapshot.context.latestEventPosition,
    lastRecoveryErrorCode: snapshot.context.lastRecoveryErrorCode,
  };
}

export function 创建房间内核() {
  return createActor(房间编排机).start();
}
