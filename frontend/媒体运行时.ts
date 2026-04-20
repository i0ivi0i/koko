import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type {
  媒体会话信号,
  媒体查看器打开请求,
  消息视频自动播候选,
  媒体播放结果,
} from "./媒体/index.js";
import { 选择消息视频自动播Owner } from "./媒体/index.js";

const 长任务阈值毫秒 = 100;
const 自动播空观测释放阈值 = 2;

export interface 媒体运行时上下文 {
  currentViewerRequest: 媒体查看器打开请求 | null;
  viewerOpen: boolean;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPendingAttachmentId: string | null;
  inlineAutoplayPlayback: 媒体播放结果 | null;
  inlineAutoplayConsecutiveEmptyObservedCount: number;
  lastInlineAutoplayCandidates: 消息视频自动播候选[];
  heavyWorkPolicy: "normal" | "reduced" | "suspended";
  inflightLocatorCount: number;
  inflightManifestOrRangeCount: number;
  longTaskCount: number;
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
      type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED";
      attachmentId: string;
      playback: 媒体播放结果;
    }
  | {
      type: "INLINE_AUTOPLAY_PLAYBACK_FAILED";
      attachmentId: string;
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
    }
  | {
      type: "LOCATOR_REQUEST_STARTED";
    }
  | {
      type: "LOCATOR_REQUEST_FINISHED";
      durationMs: number;
    }
  | {
      type: "PLAYBACK_REQUEST_STARTED";
    }
  | {
      type: "PLAYBACK_REQUEST_FINISHED";
      durationMs: number;
    };

const 初始媒体运行时上下文: 媒体运行时上下文 = {
  currentViewerRequest: null,
  viewerOpen: false,
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
  inlineAutoplayPlayback: null,
  inlineAutoplayConsecutiveEmptyObservedCount: 0,
  lastInlineAutoplayCandidates: [],
  heavyWorkPolicy: "normal",
  inflightLocatorCount: 0,
  inflightManifestOrRangeCount: 0,
  longTaskCount: 0,
};

const 克隆查看器请求 = (request: 媒体查看器打开请求): 媒体查看器打开请求 => ({
  startAttachmentId: request.startAttachmentId,
  items: request.items.map((item) => ({ ...item })),
});

const 清空自动播Owner补丁 = () => ({
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
  inlineAutoplayPlayback: null,
  inlineAutoplayConsecutiveEmptyObservedCount: 0,
});

/**
 * 查看器打开或生命周期降载时，时间线不一定会立刻重新派发一次可见候选。
 * 这里缓存最后一帧观测结果，让抑制条件解除后仍能沿用同一条 pending -> owner 链恢复自动播。
 */
const 克隆自动播候选 = (
  candidates: 消息视频自动播候选[]
): 消息视频自动播候选[] => candidates.map((candidate) => ({ ...candidate }));

const 重算自动播候选补丁 = (
  context: Pick<
    媒体运行时上下文,
    | "currentViewerRequest"
    | "heavyWorkPolicy"
    | "inlineAutoplayConsecutiveEmptyObservedCount"
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
  >,
  candidates: 消息视频自动播候选[]
): Partial<
  Pick<
    媒体运行时上下文,
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
    | "inlineAutoplayPlayback"
    | "inlineAutoplayConsecutiveEmptyObservedCount"
  >
> => {
  if (context.heavyWorkPolicy !== "normal" || context.currentViewerRequest !== null) {
    return 清空自动播Owner补丁();
  }
  const nextOwnerAttachmentId = 选择消息视频自动播Owner(
    candidates,
    undefined,
    context.inlineAutoplayPendingAttachmentId ?? context.inlineAutoplayOwnerAttachmentId
  );
  if (!nextOwnerAttachmentId) {
    /**
     * IntersectionObserver 与虚拟列表重排会偶发一帧“候选暂时清空”。
     * 这里直接清 owner 会让时间线在 `<video>/<img poster>` 之间抖动闪烁，
     * 同时触发无意义的播放源重解析。连续空观测达到阈值才真正释放。
     */
    if (
      context.inlineAutoplayOwnerAttachmentId &&
      context.inlineAutoplayPendingAttachmentId === null
    ) {
      const nextEmptyObservedCount = context.inlineAutoplayConsecutiveEmptyObservedCount + 1;
      if (nextEmptyObservedCount < 自动播空观测释放阈值) {
        return {
          inlineAutoplayConsecutiveEmptyObservedCount: nextEmptyObservedCount,
        };
      }
    }
    return 清空自动播Owner补丁();
  }
  if (nextOwnerAttachmentId === context.inlineAutoplayOwnerAttachmentId) {
    return {
      inlineAutoplayPendingAttachmentId: null,
      inlineAutoplayConsecutiveEmptyObservedCount: 0,
    };
  }
  if (nextOwnerAttachmentId === context.inlineAutoplayPendingAttachmentId) {
    return {
      inlineAutoplayConsecutiveEmptyObservedCount: 0,
    };
  }
  return {
    inlineAutoplayPendingAttachmentId: nextOwnerAttachmentId,
    inlineAutoplayConsecutiveEmptyObservedCount: 0,
  };
};

const 可投影为自动播播放结果 = (playback: 媒体播放结果): boolean =>
  playback.mode === "anchor" || playback.mode === "swarm" || playback.mode === "blob";

const 累加长任务计数补丁 = (
  current: 媒体运行时上下文,
  durationMs: number
): Pick<媒体运行时上下文, "longTaskCount"> => ({
  longTaskCount:
    durationMs >= 长任务阈值毫秒 ? current.longTaskCount + 1 : current.longTaskCount,
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
          INLINE_AUTOPLAY_PLAYBACK_RESOLVED: {
            actions: "记录自动播播放结果",
          },
          INLINE_AUTOPLAY_PLAYBACK_FAILED: {
            actions: "清理自动播播放结果",
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
          LOCATOR_REQUEST_STARTED: {
            actions: "登记定位请求开始",
          },
          LOCATOR_REQUEST_FINISHED: {
            actions: "登记定位请求结束",
          },
          PLAYBACK_REQUEST_STARTED: {
            actions: "登记播放请求开始",
          },
          PLAYBACK_REQUEST_FINISHED: {
            actions: "登记播放请求结束",
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
          /**
           * 查看器已打开时再次点开另一条同类媒体，应该继续留在同一会话里同步 source。
           * 这里只有在“当前根本没有已打开查看器”时，才把会话重置回待打开态。
           */
          viewerOpen: context.viewerOpen && context.currentViewerRequest !== null,
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
      关闭查看器: assign(({ context }) => {
        const nextContext = {
          ...context,
          currentViewerRequest: null,
          viewerOpen: false,
        };
        return {
          currentViewerRequest: null,
          viewerOpen: false,
          ...重算自动播候选补丁(nextContext, context.lastInlineAutoplayCandidates),
        };
      }),
      裁决自动播候选: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_CANDIDATES_OBSERVED") {
          return {};
        }
        return {
          lastInlineAutoplayCandidates: 克隆自动播候选(event.candidates),
          ...重算自动播候选补丁(context, event.candidates),
        };
      }),
      提升稳定自动播Owner: assign(({ context }) => {
        if (!context.inlineAutoplayPendingAttachmentId) {
          return {};
        }
        return {
          inlineAutoplayOwnerAttachmentId: context.inlineAutoplayPendingAttachmentId,
          inlineAutoplayPendingAttachmentId: null,
          inlineAutoplayPlayback: null,
        };
      }),
      释放自动播Owner: assign(() => 清空自动播Owner补丁()),
      记录自动播播放结果: assign(({ event, context }) => {
        if (
          event.type !== "INLINE_AUTOPLAY_PLAYBACK_RESOLVED" ||
          event.attachmentId !== context.inlineAutoplayOwnerAttachmentId
        ) {
          return {};
        }
        return {
          inlineAutoplayPlayback: 可投影为自动播播放结果(event.playback)
            ? { ...event.playback }
            : null,
        };
      }),
      清理自动播播放结果: assign(({ event, context }) => {
        if (
          event.type !== "INLINE_AUTOPLAY_PLAYBACK_FAILED" ||
          event.attachmentId !== context.inlineAutoplayOwnerAttachmentId
        ) {
          return {};
        }
        return {
          inlineAutoplayPlayback: null,
        };
      }),
      同步存活附件集合: assign(({ event, context }) => {
        if (event.type !== "MESSAGE_ATTACHMENTS_SYNCED") {
          return {};
        }
        const activeAttachmentIds = new Set(event.attachmentIds);
        const nextInlineAutoplayCandidates = context.lastInlineAutoplayCandidates.filter(
          (candidate) => activeAttachmentIds.has(candidate.attachmentId)
        );
        const ownerAlive =
          !context.inlineAutoplayOwnerAttachmentId ||
          activeAttachmentIds.has(context.inlineAutoplayOwnerAttachmentId);
        const pendingAlive =
          !context.inlineAutoplayPendingAttachmentId ||
          activeAttachmentIds.has(context.inlineAutoplayPendingAttachmentId);
        const candidatesChanged =
          nextInlineAutoplayCandidates.length !== context.lastInlineAutoplayCandidates.length;
        if (ownerAlive && pendingAlive && !candidatesChanged) {
          return {};
        }
        const nextContext = {
          ...context,
          inlineAutoplayOwnerAttachmentId: ownerAlive
            ? context.inlineAutoplayOwnerAttachmentId
            : null,
          inlineAutoplayPendingAttachmentId: pendingAlive
            ? context.inlineAutoplayPendingAttachmentId
            : null,
        };
        return {
          lastInlineAutoplayCandidates: nextInlineAutoplayCandidates,
          ...(!ownerAlive || !pendingAlive
            ? 重算自动播候选补丁(nextContext, nextInlineAutoplayCandidates)
            : {
                inlineAutoplayOwnerAttachmentId: context.inlineAutoplayOwnerAttachmentId,
                inlineAutoplayPendingAttachmentId: context.inlineAutoplayPendingAttachmentId,
              }),
          inlineAutoplayPlayback:
            ownerAlive && pendingAlive ? context.inlineAutoplayPlayback : null,
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
          const nextContext = {
            ...context,
            heavyWorkPolicy: "normal" as const,
          };
          return {
            heavyWorkPolicy: "normal" as const,
            ...重算自动播候选补丁(nextContext, context.lastInlineAutoplayCandidates),
          };
        }
        return {
          ...context,
          heavyWorkPolicy: event.heavyWorkPolicy,
          ...清空自动播Owner补丁(),
        };
      }),
      登记定位请求开始: assign(({ context }) => ({
        inflightLocatorCount: context.inflightLocatorCount + 1,
      })),
      登记定位请求结束: assign(({ event, context }) => {
        if (event.type !== "LOCATOR_REQUEST_FINISHED") {
          return {};
        }
        return {
          inflightLocatorCount: Math.max(0, context.inflightLocatorCount - 1),
          ...累加长任务计数补丁(context, event.durationMs),
        };
      }),
      登记播放请求开始: assign(({ context }) => ({
        inflightManifestOrRangeCount: context.inflightManifestOrRangeCount + 1,
      })),
      登记播放请求结束: assign(({ event, context }) => {
        if (event.type !== "PLAYBACK_REQUEST_FINISHED") {
          return {};
        }
        return {
          inflightManifestOrRangeCount: Math.max(
            0,
            context.inflightManifestOrRangeCount - 1
          ),
          ...累加长任务计数补丁(context, event.durationMs),
        };
      }),
    },
  }
);

export type 媒体运行时快照 = SnapshotFrom<typeof 媒体运行时机>;

const 当前查看器占用视频 = (context: 媒体运行时上下文): number => {
  if (!context.viewerOpen || !context.currentViewerRequest) {
    return 0;
  }
  const startItem = context.currentViewerRequest.items.find(
    (item) => item.attachmentId === context.currentViewerRequest?.startAttachmentId
  );
  return startItem?.kind === "video" ? 1 : 0;
};

export function 投影媒体运行时预算(snapshot: 媒体运行时快照) {
  const { context } = snapshot;
  const autoplayOwnerCount = context.inlineAutoplayOwnerAttachmentId ? 1 : 0;
  return {
    activeVideoCount: 当前查看器占用视频(context) + autoplayOwnerCount,
    autoplayOwnerCount,
    inflightLocatorCount: context.inflightLocatorCount,
    inflightManifestOrRangeCount: context.inflightManifestOrRangeCount,
    longTaskCount: context.longTaskCount,
  };
}

export function 创建媒体运行时Actor() {
  return createActor(媒体运行时机).start();
}
