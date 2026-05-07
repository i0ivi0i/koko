import type { 消息视频自动播候选 } from "./消息视频自动播编排.js";
import {
  选择消息视频自动播Owner,
  选择消息视频自动播连续Owner候选,
} from "./消息视频自动播编排.js";
import type { 媒体播放结果, 媒体播放位置 } from "./媒体播放.js";
import type { 媒体运行时上下文 } from "./运行时.js";

const 长任务阈值毫秒 = 100;
const 自动播空观测释放阈值 = 2;
const 自动播未知附件集合播放位置兜底上限 = 256;

/**
 * 这组函数只负责“自动播 owner 的纯裁决”：
 * 1. 不直接发送事件，也不触碰 XState action wiring；
 * 2. 输入是当前上下文快照，输出是下一步该写入的最小补丁；
 * 3. 这样 `运行时.ts` 只保留状态机本身，避免一个文件同时堆满纯函数和 action 编排。
 */

export const 清空自动播Owner补丁 = () => ({
  inlineAutoplayOwnerAttachmentId: null,
  inlineAutoplayPendingAttachmentId: null,
  inlineAutoplayPendingPlayback: null,
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

export const 自动播播放位置需要更新 = (
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

export const 归一化附件标识列表 = (attachmentIds: string[]): string[] =>
  Array.from(new Set(attachmentIds.filter((attachmentId) => attachmentId.length > 0)));

export const 附件标识列表相同 = (
  left: string[] | null,
  right: string[]
): boolean => {
  if (!left || left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((attachmentId) => rightSet.has(attachmentId));
};

export const 读取自动播位置保留附件集合 = (
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

export const 裁剪自动播播放位置表 = (
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
export const 克隆自动播候选 = (
  candidates: 消息视频自动播候选[]
): 消息视频自动播候选[] => candidates.map((candidate) => ({ ...candidate }));

export const 稳定表面附件集合包含 = (
  attachmentIds: string[],
  attachmentId: string | null | undefined
): boolean => Boolean(attachmentId && attachmentIds.includes(attachmentId));

export const 写入稳定表面附件集合 = (
  attachmentIds: string[],
  attachmentId: string
): string[] => (attachmentIds.includes(attachmentId) ? attachmentIds : [...attachmentIds, attachmentId]);

export const 删除稳定表面附件集合 = (
  attachmentIds: string[],
  attachmentId: string
): string[] => attachmentIds.filter((currentAttachmentId) => currentAttachmentId !== attachmentId);

export const 读取待提交自动播Owner补丁 = (
  context: Pick<
    媒体运行时上下文,
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
    | "inlineAutoplayPendingPlayback"
    | "inlineAutoplayStableSurfaceAttachmentIds"
  >
): Partial<
  Pick<
    媒体运行时上下文,
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
    | "inlineAutoplayPendingPlayback"
    | "inlineAutoplayPlayback"
    | "inlineAutoplayConsecutiveEmptyObservedCount"
  >
> => {
  const pendingAttachmentId = context.inlineAutoplayPendingAttachmentId;
  const pendingPlayback = context.inlineAutoplayPendingPlayback;
  if (!pendingAttachmentId) {
    return {};
  }
  if (!context.inlineAutoplayOwnerAttachmentId) {
    return {
      inlineAutoplayOwnerAttachmentId: pendingAttachmentId,
      inlineAutoplayPendingAttachmentId: null,
      inlineAutoplayPendingPlayback: null,
      inlineAutoplayPlayback: pendingPlayback,
      inlineAutoplayConsecutiveEmptyObservedCount: 0,
    };
  }
  if (!pendingPlayback) {
    return {};
  }
  /**
   * 旧 owner 正在退、新 owner 正在接时，最怕的是 runtime 只看到“playback 到了”，
   * 却没看到“这条卡已经至少有一张稳定 bridge 可以托住揭帘前空窗”：
   * 1. 首轮无旧 owner 的 autoplay 仍沿用现有语义，可以先挂 owner 再等 playback；
   * 2. 一旦屏幕上还有旧 owner，就必须先等 pending 至少握住稳定表面；
   * 3. 这样新 owner 的 reveal 才会是“bridge -> live”，而不是“黑一拍 -> live”。
   */
  if (
    !稳定表面附件集合包含(
      context.inlineAutoplayStableSurfaceAttachmentIds,
      pendingAttachmentId
    )
  ) {
    return {};
  }
  return {
    inlineAutoplayOwnerAttachmentId: pendingAttachmentId,
    inlineAutoplayPendingAttachmentId: null,
    inlineAutoplayPendingPlayback: null,
    inlineAutoplayPlayback: pendingPlayback,
    inlineAutoplayConsecutiveEmptyObservedCount: 0,
  };
};

export const 重算自动播候选补丁 = (
  context: Pick<
    媒体运行时上下文,
    | "currentViewerRequest"
    | "heavyWorkPolicy"
    | "inlineAutoplayActiveAttachmentIds"
    | "inlineAutoplayConsecutiveEmptyObservedCount"
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
    | "inlineAutoplayPendingPlayback"
  >,
  candidates: 消息视频自动播候选[]
): Partial<
  Pick<
    媒体运行时上下文,
    | "inlineAutoplayOwnerAttachmentId"
    | "inlineAutoplayPendingAttachmentId"
    | "inlineAutoplayPendingPlayback"
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
    const continuityOwnerAttachmentId = 选择消息视频自动播连续Owner候选(
      candidates,
      context.inlineAutoplayOwnerAttachmentId
    );
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
          inlineAutoplayPendingPlayback: null,
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
        inlineAutoplayPendingPlayback: null,
        inlineAutoplayPlayback: null,
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
      inlineAutoplayPendingPlayback: null,
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
    inlineAutoplayPendingPlayback: null,
    inlineAutoplayPlayback: null,
    inlineAutoplayConsecutiveEmptyObservedCount: 0,
  };
};

export const 可投影为自动播播放结果 = (playback: 媒体播放结果): boolean =>
  /**
   * 自动播 owner 的已裁决播放结果只缓存 swarm：
   * 1. runtime 允许继续记住 owner 附件是谁；
   * 2. 但不能再把 `anchor` 当成“这条卡片已经拿到正式字节”的事实缓存下来；
   * 3. 这样后续消息窗/查看器只能等待正式主链，而不会从 runtime 捞出第二入口。
   */
  playback.mode === "swarm";

export const 累加长任务计数补丁 = (
  context: Pick<媒体运行时上下文, "longTaskCount">,
  durationMs: number
) => {
  if (!Number.isFinite(durationMs) || durationMs < 长任务阈值毫秒) {
    return {};
  }
  return {
    longTaskCount: context.longTaskCount + 1,
  };
};

export { 读取有效自动播播放位置 };
