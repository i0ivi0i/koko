import { assign, createActor, createMachine, type SnapshotFrom } from "xstate";
import type {
  媒体会话信号,
  媒体查看器打开请求,
  消息视频自动播候选,
  媒体播放结果,
  媒体播放位置,
} from "./index.js";
import {
  选择消息视频自动播Owner,
  选择消息视频自动播连续Owner候选,
} from "./index.js";

/**
 * 媒体运行时 owner 只拥有查看器、自动播与媒体预算这条前端体验真相。
 * 字节分发、视频预览与播放副作用协作都只通过窄事件/快照与它协作。
 */

const 长任务阈值毫秒 = 100;
const 自动播空观测释放阈值 = 2;
const 自动播未知附件集合播放位置兜底上限 = 256;

export interface 媒体运行时上下文 {
  currentViewerRequest: 媒体查看器打开请求 | null;
  viewerOpen: boolean;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPendingAttachmentId: string | null;
  inlineAutoplayPlayback: 媒体播放结果 | null;
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
  inlineAutoplayPlayback: null,
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

const 清空自动播Owner补丁 = () => ({
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
  inlineAutoplayPlayback: null,
  inlineAutoplayConsecutiveEmptyObservedCount: 0,
});

const 读取有效自动播播放位置 = (
  position: 媒体播放位置
): 媒体播放位置 | null => {
  if (
    typeof position.src !== "string" ||
    position.src.length === 0 ||
    !Number.isFinite(position.currentTime) ||
    !Number.isFinite(position.updatedAt)
  ) {
    return null;
  }
  return {
    src: position.src,
    currentTime: Math.max(0, position.currentTime),
    updatedAt: position.updatedAt,
  };
};

const 自动播播放位置相同 = (
  left: 媒体播放位置 | undefined,
  right: 媒体播放位置 | undefined
): boolean =>
  left?.src === right?.src &&
  left?.currentTime === right?.currentTime &&
  left?.updatedAt === right?.updatedAt;

const 自动播播放位置需要更新 = (
  current: 媒体播放位置 | undefined,
  next: 媒体播放位置
): boolean => {
  if (!current) {
    return true;
  }
  /**
   * `updatedAt` 是消息流续播位置的唯一排序锚点：
   * - 当前时间会因为自然 loop、seek 或热接管而回到更小的数值；
   * - 但更旧的 timeupdate 绝不能反过来覆盖更新的事实。
   *
   * 因此这里只接受“更晚”或“同一毫秒内的不同事实”。
   */
  if (next.updatedAt < current.updatedAt) {
    return false;
  }
  return !自动播播放位置相同(current, next);
};

const 自动播播放位置表相同 = (
  left: Record<string, 媒体播放位置>,
  right: Record<string, 媒体播放位置>
): boolean => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => 自动播播放位置相同(left[key], right[key]))
  );
};

const 归一化附件标识列表 = (attachmentIds: string[]): string[] =>
  Array.from(new Set(attachmentIds.filter((attachmentId) => attachmentId.length > 0)));

const 附件标识列表相同 = (
  left: string[] | null,
  right: string[]
): boolean => {
  if (!left || left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((attachmentId) => rightSet.has(attachmentId));
};

const 读取自动播位置保留附件集合 = (
  retentionAttachmentIds: string[] | null,
  reportingAttachmentId?: string
): Set<string> | undefined => {
  if (!retentionAttachmentIds) {
    return undefined;
  }
  const retainedAttachmentIds = new Set(retentionAttachmentIds);
  if (reportingAttachmentId) {
    retainedAttachmentIds.add(reportingAttachmentId);
  }
  return retainedAttachmentIds;
};

const 裁剪自动播播放位置表 = (
  positions: Record<string, 媒体播放位置>,
  retainedAttachmentIds?: Set<string>
): Record<string, 媒体播放位置> => {
  /**
   * 当前房间消息集合是续播体验的真实生命周期边界：
   * - 已知还属于当前房间的附件，哪怕超过 256 条也不能被固定上限裁掉；
   * - 只有还没拿到消息集合同步时，才用小上限兜底异常事件，防止无界增长。
   */
  const entries = retainedAttachmentIds
    ? Object.entries(positions).filter(([attachmentId]) =>
        retainedAttachmentIds.has(attachmentId)
      )
    : Object.entries(positions)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, 自动播未知附件集合播放位置兜底上限);
  const nextPositions = Object.fromEntries(entries);
  return 自动播播放位置表相同(positions, nextPositions) ? positions : nextPositions;
};

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
    | "inlineAutoplayActiveAttachmentIds"
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
    const continuityOwnerAttachmentId = 选择消息视频自动播连续Owner候选(candidates);
    if (continuityOwnerAttachmentId) {
      /**
       * 高竖视频在滚动交接区会天然掉进 `0.6` dead zone：
       * - 这不是观察器抖动，而是“卡片略高于视口”时，旧卡片和新卡片会同时只露半屏多一点；
       * - 如果这里直接把 owner 清空，消息窗会马上撤掉 canonical host，可见表面随即闪回 preview/poster；
       * - 正确语义是：正式 owner 门槛仍保留，但 dead zone 里继续给出一条连续性候选，
       *   让旧 owner 保活，或把更接近中心的新卡片挂成 pending，等待正常 settle。
       */
      if (continuityOwnerAttachmentId === context.inlineAutoplayOwnerAttachmentId) {
        return {
          inlineAutoplayPendingAttachmentId: null,
          inlineAutoplayConsecutiveEmptyObservedCount: 0,
        };
      }
      if (continuityOwnerAttachmentId === context.inlineAutoplayPendingAttachmentId) {
        return {
          inlineAutoplayConsecutiveEmptyObservedCount: 0,
        };
      }
      return {
        inlineAutoplayPendingAttachmentId: continuityOwnerAttachmentId,
        inlineAutoplayConsecutiveEmptyObservedCount: 0,
      };
    }
    const activeAttachmentIds = new Set(context.inlineAutoplayActiveAttachmentIds ?? []);
    const currentOwnerAttachmentId = context.inlineAutoplayOwnerAttachmentId;
    const currentPendingAttachmentId = context.inlineAutoplayPendingAttachmentId;
    const ownerStillInActiveWindow =
      currentOwnerAttachmentId !== null && activeAttachmentIds.has(currentOwnerAttachmentId);
    const pendingStillInActiveWindow =
      currentPendingAttachmentId !== null &&
      activeAttachmentIds.has(currentPendingAttachmentId);
    if (ownerStillInActiveWindow || pendingStillInActiveWindow) {
      /**
       * 候选观察是 DOM/IntersectionObserver 的瞬时投影；活媒体窗口才是虚拟列表同步后的
       * 生命周期真相。滚动重排时只要 owner/pending 仍在活窗口，就不能因为候选空帧拆掉
       * canonical owner，否则会在同一条视频上制造 null -> owner 的闪烁。
       */
      return {
        inlineAutoplayConsecutiveEmptyObservedCount: 0,
      };
    }
    /**
     * IntersectionObserver 与虚拟列表重排会偶发一帧“候选暂时清空”。
     * 这里直接清 owner 会让时间线在 `<video>/<img poster>` 之间抖动闪烁，
     * 同时触发无意义的播放源重解析。连续空观测达到阈值才真正释放。
     *
     * 注意这里不能把“正在交接的新 pending owner”当成例外：
     * - 旧 owner 还没正式退场，新 owner 也还没真正 settle；
     * - 如果只因为 pending 存在就提前清空当前 owner，唯一播放器会立刻收到 `null` surface；
     * - 后面哪怕新 owner 下一帧又回来了，也已经发生过一次 destroy/recreate，肉眼就会看到抽一下。
     *
     * 因此只要当前还有已裁决 owner，就继续沿用同一条“连续空观测达到阈值才释放”的规则。
     */
    if (context.inlineAutoplayOwnerAttachmentId) {
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
  playback.mode === "anchor" || playback.mode === "swarm";

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
          return {
            inlineAutoplayOwnerAttachmentId: event.attachmentId,
            inlineAutoplayPendingAttachmentId: null,
            inlineAutoplayPlayback: playback,
            inlineAutoplayConsecutiveEmptyObservedCount: 0,
          };
        }
        return {};
      }),
      清理自动播播放结果: assign(({ event, context }) => {
        if (event.type !== "INLINE_AUTOPLAY_PLAYBACK_FAILED") {
          return {};
        }
        if (event.attachmentId === context.inlineAutoplayPendingAttachmentId) {
          return {
            inlineAutoplayPendingAttachmentId: null,
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
        if (
          ownerAlive &&
          pendingAlive &&
          !candidatesChanged &&
          !positionsChanged &&
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
        };
        return {
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
