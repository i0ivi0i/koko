import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type { 媒体会话信号 } from "./媒体会话.js";
import type { 媒体查看器打开请求 } from "./媒体查看器.js";
import type { 媒体播放结果, 媒体播放位置 } from "./媒体播放.js";
import type { 消息视频自动播候选 } from "./消息视频自动播编排.js";
import {
  删除稳定表面附件集合,
  自动播播放位置需要更新,
  写入稳定表面附件集合,
  可投影为自动播播放结果,
  归一化附件标识列表,
  克隆自动播候选,
  清空自动播Owner补丁,
  累加长任务计数补丁,
  裁剪自动播播放位置表,
  读取待提交自动播Owner补丁,
  读取有效自动播播放位置,
  读取自动播位置保留附件集合,
  重算自动播候选补丁,
  附件标识列表相同,
} from "./自动播运行时裁决.js";

/**
 * 媒体运行时 owner 只拥有查看器、自动播与媒体预算这条前端体验真相。
 * 字节分发、视频预览与播放副作用协作都只通过窄事件/快照与它协作。
 */

export interface 媒体运行时上下文 {
  currentViewerRequest: 媒体查看器打开请求 | null;
  viewerOpen: boolean;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPendingAttachmentId: string | null;
  /**
   * pending 附件的正式播放结果必须先暂存，等稳定表面 ready 后再原子切成 owner：
   * 1. 这样可以避免“owner 已切过去，但 playback 还是 null”；
   * 2. 也避免旧 owner 还没退稳时，新 owner 提前裸露黑壳；
   * 3. 真正对外可读的 autoplay playback 仍只属于当前 owner。
   */
  inlineAutoplayPendingPlayback: 媒体播放结果 | null;
  inlineAutoplayPlayback: 媒体播放结果 | null;
  /**
   * 这里记录“哪条附件已经握有可接续的稳定表面”：
   * - 当前实现先收口 preview/runtime bridge；
   * - 后续如果 live visible frame 也要参与晋升门禁，可以继续沿这条 owner 事实扩展；
   * - runtime 只认附件级 ready 事实，不去猜 DOM 细节。
   */
  inlineAutoplayStableSurfaceAttachmentIds: string[];
  /**
   * 当前重资源媒体窗口，只负责 owner / pending / 候选和会话预算，不负责裁掉续播位置。
   */
  inlineAutoplayActiveAttachmentIds: string[] | null;
  /**
   * 自动播位置的保留集合必须按“房间消息是否仍存在”裁剪，不能按当前活跃窗口裁剪。
   * A 刚离屏、B 正在播放时，A 不再是重资源窗口成员，但它仍然需要保留续播时间戳。
   */
  inlineAutoplayPositionRetentionAttachmentIds: string[] | null;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
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
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_READY";
      attachmentId: string;
      surface: "bridge" | "live";
    }
  | {
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_INVALIDATED";
      attachmentId: string;
    }
  | {
      type: "PLAYBACK_POSITION_CHANGED";
      attachmentId: string;
      position: 媒体播放位置;
    }
  | {
      type: "MESSAGE_ATTACHMENTS_SYNCED";
      attachmentIds: string[];
      positionRetentionAttachmentIds?: string[];
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
  inlineAutoplayPendingPlayback: null,
  inlineAutoplayPlayback: null,
  inlineAutoplayStableSurfaceAttachmentIds: [],
  inlineAutoplayActiveAttachmentIds: null,
  inlineAutoplayPositionRetentionAttachmentIds: null,
  inlineAutoplayPositionByAttachmentId: {},
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
          INLINE_AUTOPLAY_STABLE_SURFACE_READY: {
            actions: "记录自动播稳定表面",
          },
          INLINE_AUTOPLAY_STABLE_SURFACE_INVALIDATED: {
            actions: "清理自动播稳定表面",
          },
          PLAYBACK_POSITION_CHANGED: {
            actions: "记录自动播播放位置",
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
        return 读取待提交自动播Owner补丁(context);
      }),
      释放自动播Owner: assign(() => 清空自动播Owner补丁()),
      记录自动播播放结果: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_PLAYBACK_RESOLVED") {
          return {};
        }
        const playback = 可投影为自动播播放结果(event.playback)
          ? { ...event.playback }
          : null;
        if (event.attachmentId === context.inlineAutoplayOwnerAttachmentId) {
          return {
            inlineAutoplayPlayback: playback,
          };
        }
        if (event.attachmentId === context.inlineAutoplayPendingAttachmentId) {
          const nextContext: 媒体运行时上下文 = {
            ...context,
            inlineAutoplayPendingPlayback: playback,
          };
          return {
            inlineAutoplayPendingPlayback: playback,
            ...读取待提交自动播Owner补丁(nextContext),
          };
        }
        return {};
      }),
      记录自动播稳定表面: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_STABLE_SURFACE_READY") {
          return {};
        }
        const nextStableSurfaceAttachmentIds = 写入稳定表面附件集合(
          context.inlineAutoplayStableSurfaceAttachmentIds,
          event.attachmentId
        );
        const nextContext: 媒体运行时上下文 = {
          ...context,
          inlineAutoplayStableSurfaceAttachmentIds: nextStableSurfaceAttachmentIds,
        };
        return {
          inlineAutoplayStableSurfaceAttachmentIds: nextStableSurfaceAttachmentIds,
          ...读取待提交自动播Owner补丁(nextContext),
        };
      }),
      清理自动播稳定表面: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_STABLE_SURFACE_INVALIDATED") {
          return {};
        }
        return {
          inlineAutoplayStableSurfaceAttachmentIds: 删除稳定表面附件集合(
            context.inlineAutoplayStableSurfaceAttachmentIds,
            event.attachmentId
          ),
        };
      }),
      清理自动播播放结果: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_PLAYBACK_FAILED") {
          return {};
        }
        if (event.attachmentId === context.inlineAutoplayPendingAttachmentId) {
          return {
            inlineAutoplayPendingAttachmentId: null,
            inlineAutoplayPendingPlayback: null,
          };
        }
        if (event.attachmentId !== context.inlineAutoplayOwnerAttachmentId) {
          return {};
        }
        return {
          inlineAutoplayPlayback: null,
        };
      }),
      记录自动播播放位置: assign(({ event, context }) => {
        if (event.type !== "PLAYBACK_POSITION_CHANGED") {
          return {};
        }
        const nextPosition = 读取有效自动播播放位置(event.position);
        if (!event.attachmentId || !nextPosition) {
          return {};
        }
        const currentPosition =
          context.inlineAutoplayPositionByAttachmentId[event.attachmentId];
        if (!自动播播放位置需要更新(currentPosition, nextPosition)) {
          return {};
        }
        /**
         * 自动播播放位置是浏览器壳本地体验态，不是 DOM 节点私有状态。
         * 这里按当前房间消息集合保留；记录事件本身也临时保留一次，避免消息同步与 timeupdate
         * 的微小时序差把正在播放的视频时间戳提前裁掉。
         */
        return {
          inlineAutoplayPositionByAttachmentId: 裁剪自动播播放位置表(
            {
              ...context.inlineAutoplayPositionByAttachmentId,
              [event.attachmentId]: nextPosition,
            },
            读取自动播位置保留附件集合(
              context.inlineAutoplayPositionRetentionAttachmentIds,
              event.attachmentId
            )
          ),
        };
      }),
      同步存活附件集合: assign(({ event, context }) => {
        if (event.type !== "MESSAGE_ATTACHMENTS_SYNCED") {
          return {};
        }
        const nextInlineAutoplayActiveAttachmentIds = 归一化附件标识列表(
          event.attachmentIds
        );
        const activeAttachmentIds = new Set(nextInlineAutoplayActiveAttachmentIds);
        const nextInlineAutoplayPositionRetentionAttachmentIds = 归一化附件标识列表(
          event.positionRetentionAttachmentIds ?? event.attachmentIds
        );
        const positionRetentionAttachmentIds = new Set(
          nextInlineAutoplayPositionRetentionAttachmentIds
        );
        const nextInlineAutoplayPositionByAttachmentId = 裁剪自动播播放位置表(
          context.inlineAutoplayPositionByAttachmentId,
          positionRetentionAttachmentIds
        );
        const nextInlineAutoplayStableSurfaceAttachmentIds =
          context.inlineAutoplayStableSurfaceAttachmentIds.filter((attachmentId) =>
            activeAttachmentIds.has(attachmentId)
          );
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
        const positionsChanged =
          nextInlineAutoplayPositionByAttachmentId !==
          context.inlineAutoplayPositionByAttachmentId;
        const activeAttachmentIdsChanged = !附件标识列表相同(
          context.inlineAutoplayActiveAttachmentIds,
          nextInlineAutoplayActiveAttachmentIds
        );
        const positionRetentionAttachmentIdsChanged = !附件标识列表相同(
          context.inlineAutoplayPositionRetentionAttachmentIds,
          nextInlineAutoplayPositionRetentionAttachmentIds
        );
        const stableSurfaceAttachmentIdsChanged = !附件标识列表相同(
          context.inlineAutoplayStableSurfaceAttachmentIds,
          nextInlineAutoplayStableSurfaceAttachmentIds
        );
        if (
          ownerAlive &&
          pendingAlive &&
          !candidatesChanged &&
          !positionsChanged &&
          !stableSurfaceAttachmentIdsChanged &&
          !activeAttachmentIdsChanged &&
          !positionRetentionAttachmentIdsChanged
        ) {
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
          inlineAutoplayPendingPlayback:
            pendingAlive ? context.inlineAutoplayPendingPlayback : null,
        };
        return {
          inlineAutoplayStableSurfaceAttachmentIds: nextInlineAutoplayStableSurfaceAttachmentIds,
          inlineAutoplayActiveAttachmentIds: nextInlineAutoplayActiveAttachmentIds,
          inlineAutoplayPositionRetentionAttachmentIds:
            nextInlineAutoplayPositionRetentionAttachmentIds,
          lastInlineAutoplayCandidates: nextInlineAutoplayCandidates,
          ...(!ownerAlive || !pendingAlive
            ? 重算自动播候选补丁(nextContext, nextInlineAutoplayCandidates)
            : {
                inlineAutoplayOwnerAttachmentId: context.inlineAutoplayOwnerAttachmentId,
                inlineAutoplayPendingAttachmentId: context.inlineAutoplayPendingAttachmentId,
              }),
          inlineAutoplayPlayback:
            ownerAlive && pendingAlive ? context.inlineAutoplayPlayback : null,
          inlineAutoplayPendingPlayback:
            pendingAlive &&
            context.inlineAutoplayPendingAttachmentId ===
              nextContext.inlineAutoplayPendingAttachmentId
              ? context.inlineAutoplayPendingPlayback
              : null,
          inlineAutoplayPositionByAttachmentId: nextInlineAutoplayPositionByAttachmentId,
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
  /**
   * 正式播放器预算只回答“当前有没有那颗 canonical formal player 在前台工作”：
   * 1. 查看器与 inline autoplay 共享同一颗正式播放器；
   * 2. 因此这里永远投影成 0/1，而不是把查看器和自动播各算一颗；
   * 3. `activeVideoCount` 继续保留给旧调用方，但 owner 真相已经显式落成 `activeFormalPlayerCount`。
   */
  const autoplayOwnerCount = context.inlineAutoplayOwnerAttachmentId ? 1 : 0;
  const activeFormalPlayerCount =
    当前查看器占用视频(context) > 0 || autoplayOwnerCount > 0 ? 1 : 0;
  return {
    activeVideoCount: 当前查看器占用视频(context) + autoplayOwnerCount,
    activeFormalPlayerCount,
    autoplayOwnerCount,
    inflightLocatorCount: context.inflightLocatorCount,
    inflightManifestOrRangeCount: context.inflightManifestOrRangeCount,
    longTaskCount: context.longTaskCount,
  };
}

export function 创建媒体运行时Actor() {
  return createActor(媒体运行时机).start();
}
