import type { 媒体定位结果, 媒体种类 } from "../契约.js";
import {
  读取协作分发定位片段,
  type 协作分发会话事件,
} from "./媒体协作分发.js";

type 媒体播放输入 = {
  attachmentId: string;
  kind: 媒体种类;
  onSessionEvent?: (event: 协作分发会话事件) => void;
};

type 媒体播放结果 =
  | {
      mode: "swarm" | "anchor";
      attachmentId: string;
      kind: 媒体种类;
      src: string;
      thumbnailUrl: string | null;
      hint: "正在协作分发" | null;
    }
  | {
      mode: "expired";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      hint: "内容已过期";
    }
  | {
      mode: "degraded";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable";
      hint: "附件当前不可获取";
    };

type 媒体播放器依赖 = {
  locate(attachmentId: string, options?: { forceRefresh?: boolean }): Promise<媒体定位结果>;
  resolveSwarmSource?(input: {
    attachmentId: string;
    kind: 媒体种类;
    locator: 媒体定位结果;
    onSessionEvent?: (event: 协作分发会话事件) => void;
  }): Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>;
  probeAnchor?(url: string): Promise<void>;
};

const 过滤可播放媒体提示 = (
  hint: "正在协作分发" | "正在补块" | null
): "正在协作分发" | null => {
  // “正在补块”只说明协作分发还在后台补齐文件块；只要已有可播放 src，就不是用户可见故障。
  return hint === "正在补块" ? null : hint;
};

/**
 * 播放器编排只回答“当前这一条媒体该从哪里读”：
 * 1. 先看 locator 是否 ready；
 * 2. 如果有 swarm 能力就优先尝试；
 * 3. swarm 不足或当前没有 swarm 定位符时，退回锚点；
 * 4. 锚点失效时强制重签一次，再决定是否 degraded。
 *
 * 当前后端 locator 还没有暴露 magnet/infohash，所以默认 `resolveSwarmSource`
 * 会返回 `null`。这不是偷懒，而是不伪造不存在的 P2P 真相。
 */
export function 创建媒体播放器(deps: 媒体播放器依赖) {
  const resolveSwarmSource =
    deps.resolveSwarmSource ??
    (async () => {
      return null;
    });
  const probeAnchor =
    deps.probeAnchor ??
    (async () => {
      return;
    });

  /**
   * 过渡阶段优先读共享资产里的冷源描述：
   * 1. 它已经明确声明原始附件只是 cold_backup_only；
   * 2. 后续顶层 original_url 退场时，这里不用再回头大改播放入口；
   * 3. 仍保留旧字段兜底，保证第一批后端过渡面上线时不打爆旧 locator。
   */
  const 读取锚点地址 = (locator: 媒体定位结果): string =>
    locator.streaming_asset?.origin.original_url ?? locator.original_url;

  const 创建降级结果 = (
    input: 媒体播放输入,
    locator: 媒体定位结果 | null,
    reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable"
  ): 媒体播放结果 => ({
    mode: "degraded",
    attachmentId: input.attachmentId,
    kind: input.kind,
    src: "",
    thumbnailUrl: locator?.thumbnail_url ?? null,
    reason,
    hint: "附件当前不可获取",
  });

  const 尝试锚点 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    allowRefresh: boolean
  ): Promise<媒体播放结果> => {
    const anchorUrl = 读取锚点地址(locator);
    try {
      await probeAnchor(anchorUrl);
      return {
        mode: "anchor",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: anchorUrl,
        thumbnailUrl: locator.thumbnail_url,
        hint: null,
      };
    } catch {
      if (!allowRefresh) {
        return 创建降级结果(input, locator, "anchor_unavailable");
      }
      const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
      if (refreshedLocator.status !== "ready") {
        return 创建降级结果(input, refreshedLocator, "attachment_not_ready");
      }
      const refreshedAnchorUrl = 读取锚点地址(refreshedLocator);
      try {
        await probeAnchor(refreshedAnchorUrl);
        return {
          mode: "anchor",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: refreshedAnchorUrl,
          thumbnailUrl: refreshedLocator.thumbnail_url,
          hint: null,
        };
      } catch {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
    }
  };

  const 解析播放结果 = async (input: 媒体播放输入): Promise<媒体播放结果> => {
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      return 创建降级结果(input, null, "locator_unavailable");
    }
    if (locator.status !== "ready") {
      return 创建降级结果(input, locator, "attachment_not_ready");
    }
    const distribution = 读取协作分发定位片段(locator);
    if (distribution?.availability === "expired") {
      return {
        mode: "expired",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: "",
        thumbnailUrl: locator.thumbnail_url,
        hint: "内容已过期",
      };
    }
    if (!distribution) {
      return 尝试锚点(input, locator, true);
    }
    try {
      const swarmSource = await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      });
      if (swarmSource) {
        return {
          mode: "swarm",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: swarmSource.src,
          thumbnailUrl: locator.thumbnail_url,
          hint: 过滤可播放媒体提示(swarmSource.hint),
        };
      }
    } catch {
      // swarm 只是热分发层；失败后必须回到锚点，不允许把热路径波动升级成业务失败。
    }
    return 尝试锚点(input, locator, true);
  };

  return {
    解析播放结果,
  };
}

export type { 媒体播放输入, 媒体播放结果 };
