import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type { 媒体会话信号, 媒体查看器打开请求, 消息视频自动播候选 } from "./媒体/index.js";
import { 选择消息视频自动播Owner } from "./媒体/index.js";

export interface 媒体运行时上下文 {
  currentViewerRequest: 媒体查看器打开请求 | null;
  viewerOpen: boolean;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPendingAttachmentId: string | null;
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
}

export type 媒体运行时事件 =
  | {
      type: "VIEWER_OPEN_REQUESTED";
      request: 媒体查看器打开请求;
    }
  | {
      type: "VIEWER_REQUEST_SYNCED";
      request: 媒体查看器打开请求;
    }
  | {
      type: "VIEWER_OPEN_CONFIRMED";
    }
  | {
      type: "VIEWER_CLOSED";
    }
  | {
      type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED";
      candidates: 消息视频自动播候选[];
    }
  | {
      type: "INLINE_AUTOPLAY_SETTLE_ELAPSED";
    }
  | {
      type: "INLINE_AUTOPLAY_RELEASE_REQUESTED";
    }
  | {
      type: "MESSAGE_ATTACHMENTS_SYNCED";
      attachmentIds: string[];
    }
  | {
      type: "MEDIA_SESSION_SIGNALLED";
      attachmentId: string;
      signal: 媒体会话信号;
    }
  | {
      type: "LIFECYCLE_POLICY_CHANGED";
      heavyWorkPolicy: "normal" | "reduced" | "suspended";
    };

const 初始媒体运行时上下文: 媒体运行时上下文 = {
  currentViewerRequest: null,
  viewerOpen: false,
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
  heavyWorkPolicy: "normal",
};

const 克隆查看器请求 = (request: 媒体查看器打开请求): 媒体查看器打开请求 => ({
  startAttachmentId: request.startAttachmentId,
  items: request.items.map((item) => ({ ...item })),
});

const 清空自动播Owner补丁 = () => ({
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
});

/**
 * 媒体运行时只拥有“查看器/自动播”这条前端体验真相：
 * - 哪个附件当前占住正式查看器；
 * - 哪个附件正在等待成为自动播 owner；
 * - 当前生命周期策略是否允许继续保留自动播 owner。
 *
 * 它不自己解析播放源，也不直接碰 WebTorrent/browser 运行时。
 */
const 媒体运行时机 = createMachine(
  {
    types: {} as {
      context: 媒体运行时上下文;
      events: 媒体运行时事件;
    },
    id: "媒体运行时机",
    initial: "活跃",
    context: 初始媒体运行时上下文,
    states: {
      活跃: {
        on: {
          VIEWER_OPEN_REQUESTED: {
            actions: "接管查看器请求",
          },
          VIEWER_REQUEST_SYNCED: {
            actions: "同步查看器请求",
          },
          VIEWER_OPEN_CONFIRMED: {
            actions: "确认查看器已打开",
          },
          VIEWER_CLOSED: {
            actions: "关闭查看器",
          },
          INLINE_AUTOPLAY_CANDIDATES_OBSERVED: {
            actions: "裁决自动播候选",
          },
          INLINE_AUTOPLAY_SETTLE_ELAPSED: {
            actions: "提升稳定自动播Owner",
          },
          INLINE_AUTOPLAY_RELEASE_REQUESTED: {
            actions: "释放自动播Owner",
          },
          MESSAGE_ATTACHMENTS_SYNCED: {
            actions: "同步存活附件集合",
          },
          MEDIA_SESSION_SIGNALLED: {
            actions: "保留媒体信号占位",
          },
          LIFECYCLE_POLICY_CHANGED: {
            actions: "同步生命周期策略",
          },
        },
      },
    },
  },
  {
    actions: {
      接管查看器请求: assign(({ event, context }) => {
        if (event.type !== "VIEWER_OPEN_REQUESTED") {
          return {};
        }
        return {
          ...context,
          currentViewerRequest: 克隆查看器请求(event.request),
          viewerOpen: false,
          ...清空自动播Owner补丁(),
        };
      }),
      同步查看器请求: assign(({ event, context }) => {
        if (event.type !== "VIEWER_REQUEST_SYNCED" || !context.currentViewerRequest) {
          return {};
        }
        return {
          currentViewerRequest: 克隆查看器请求(event.request),
        };
      }),
      确认查看器已打开: assign(({ context }) => {
        if (!context.currentViewerRequest) {
          return {};
        }
        return {
          viewerOpen: true,
        };
      }),
      关闭查看器: assign(() => ({
        currentViewerRequest: null,
        viewerOpen: false,
      })),
      裁决自动播候选: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_CANDIDATES_OBSERVED") {
          return {};
        }
        if (
          context.heavyWorkPolicy !== "normal" ||
          context.currentViewerRequest !== null
        ) {
          return 清空自动播Owner补丁();
        }
        const nextOwnerAttachmentId = 选择消息视频自动播Owner(
          event.candidates,
          undefined,
          context.inlineAutoplayPendingAttachmentId ?? context.inlineAutoplayOwnerAttachmentId
        );
        if (!nextOwnerAttachmentId) {
          return 清空自动播Owner补丁();
        }
        if (nextOwnerAttachmentId === context.inlineAutoplayOwnerAttachmentId) {
          return {
            inlineAutoplayPendingAttachmentId: null,
          };
        }
        if (nextOwnerAttachmentId === context.inlineAutoplayPendingAttachmentId) {
          return {};
        }
        return {
          inlineAutoplayPendingAttachmentId: nextOwnerAttachmentId,
        };
      }),
      提升稳定自动播Owner: assign(({ context }) => {
        if (!context.inlineAutoplayPendingAttachmentId) {
          return {};
        }
        return {
          inlineAutoplayOwnerAttachmentId: context.inlineAutoplayPendingAttachmentId,
          inlineAutoplayPendingAttachmentId: null,
        };
      }),
      释放自动播Owner: assign(() => 清空自动播Owner补丁()),
      同步存活附件集合: assign(({ event, context }) => {
        if (event.type !== "MESSAGE_ATTACHMENTS_SYNCED") {
          return {};
        }
        const activeAttachmentIds = new Set(event.attachmentIds);
        const ownerAlive =
          !context.inlineAutoplayOwnerAttachmentId ||
          activeAttachmentIds.has(context.inlineAutoplayOwnerAttachmentId);
        const pendingAlive =
          !context.inlineAutoplayPendingAttachmentId ||
          activeAttachmentIds.has(context.inlineAutoplayPendingAttachmentId);
        if (ownerAlive && pendingAlive) {
          return {};
        }
        return {
          inlineAutoplayOwnerAttachmentId: ownerAlive
            ? context.inlineAutoplayOwnerAttachmentId
            : null,
          inlineAutoplayPendingAttachmentId: pendingAlive
            ? context.inlineAutoplayPendingAttachmentId
            : null,
        };
      }),
      保留媒体信号占位: assign(() => {
        // 正式查看器/自动播 owner 只是媒体会话信号的消费者；
        // 这里先显式保留事件入口，后续预算治理再把更多恢复/降载规则接进来。
        return {};
      }),
      同步生命周期策略: assign(({ event, context }) => {
        if (event.type !== "LIFECYCLE_POLICY_CHANGED") {
          return {};
        }
        if (event.heavyWorkPolicy === "normal") {
          return {
            heavyWorkPolicy: "normal" as const,
          };
        }
        return {
          ...context,
          heavyWorkPolicy: event.heavyWorkPolicy,
          ...清空自动播Owner补丁(),
        };
      }),
    },
  }
);

export type 媒体运行时快照 = SnapshotFrom<typeof 媒体运行时机>;

export function 创建媒体运行时Actor() {
  return createActor(媒体运行时机).start();
}
