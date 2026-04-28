import type { 媒体会话状态 } from "./媒体会话.js";
import type { 媒体播放结果 } from "./媒体播放.js";

export type 信息流视频预算层级 =
  | "heavy_playback"
  | "warm_preview"
  | "cold_expression"
  | "light_help";

export type 信息流视频预算原因 =
  | "viewer_owner"
  | "inline_autoplay_owner"
  | "window_preview"
  | "autoplay_candidate"
  | "retained_media_session"
  | "inactive";

export type 信息流视频预算事实 = {
  attachmentId: string;
  playback: 媒体播放结果 | null;
  inlineAutoplayPlayback: 媒体播放结果 | null;
  viewerCanonicalVideoSrc: string | null;
  previewVideoSrc: string | null;
  inMediaWindow: boolean;
  isAutoplayCandidate: boolean;
  isInlineAutoplayOwner: boolean;
  isViewerOwner: boolean;
  sessionStatus: 媒体会话状态 | null;
  locallyComplete: boolean;
};

export type 信息流视频预算投影 = {
  attachmentId: string;
  tier: 信息流视频预算层级;
  reason: 信息流视频预算原因;
  canonicalVideoSrc: string | null;
  previewVideoSrc: string | null;
  allowInlineCanonical: boolean;
  allowPreviewVideo: boolean;
};

const 读取视频正式播放源 = (playback: 媒体播放结果 | null): string | null =>
  playback?.kind === "video" && playback.mode === "swarm" ? playback.src : null;

const 会话仍有轻帮助价值 = (
  sessionStatus: 媒体会话状态 | null,
  locallyComplete: boolean
): boolean => {
  if (locallyComplete) {
    return true;
  }
  return (
    sessionStatus === "backfilling" ||
    sessionStatus === "recovering" ||
    sessionStatus === "locally_complete" ||
    sessionStatus === "seeding" ||
    sessionStatus === "waiting_for_peer_or_network"
  );
};

/**
 * 信息流视频预算只回答一件事：当前这条附件在浏览器前台应该背多重。
 *
 * 设计约束：
 * 1. 它不创造第二份播放真相，只消费已有的 playback / viewer / autoplay / session 事实；
 * 2. 它只产出“这一刻前台该怎么表达”，不直接触发播放器、副作用或网络动作；
 * 3. 房间消息窗、预算快照、烟测探针都必须读同一份投影，避免再出现各自拼布尔值的双真相。
 */
export const 投影信息流视频预算 = (
  facts: 信息流视频预算事实
): 信息流视频预算投影 => {
  const previewVideoSrc = facts.previewVideoSrc?.trim() || null;
  const inlineAutoplayCanonicalSrc = 读取视频正式播放源(facts.inlineAutoplayPlayback);
  const sessionCanonicalSrc = 读取视频正式播放源(facts.playback);
  const viewerCanonicalSrc = facts.viewerCanonicalVideoSrc?.trim() || null;

  if (facts.isViewerOwner) {
    const canonicalVideoSrc =
      viewerCanonicalSrc ??
      inlineAutoplayCanonicalSrc ??
      sessionCanonicalSrc ??
      previewVideoSrc;
    return {
      attachmentId: facts.attachmentId,
      tier: "heavy_playback",
      reason: "viewer_owner",
      canonicalVideoSrc,
      previewVideoSrc,
      allowInlineCanonical: false,
      allowPreviewVideo: false,
    };
  }

  if (facts.isInlineAutoplayOwner) {
    const canonicalVideoSrc =
      inlineAutoplayCanonicalSrc ?? sessionCanonicalSrc ?? previewVideoSrc;
    return {
      attachmentId: facts.attachmentId,
      tier: "heavy_playback",
      reason: "inline_autoplay_owner",
      canonicalVideoSrc,
      previewVideoSrc,
      allowInlineCanonical: Boolean(canonicalVideoSrc),
      /**
       * owner 卡片仍允许保留 preview 底板：
       * 1. canonical player 进入前需要它兜住像素连续性；
       * 2. viewer/fullscreen 返回时也要复用同一条底板桥；
       * 3. 但它只是 bridge，不再自己声明第二颗正式 player。
       */
      allowPreviewVideo: Boolean(previewVideoSrc),
    };
  }

  if (previewVideoSrc && facts.inMediaWindow) {
    return {
      attachmentId: facts.attachmentId,
      tier: "warm_preview",
      reason: "window_preview",
      canonicalVideoSrc: null,
      previewVideoSrc,
      allowInlineCanonical: false,
      allowPreviewVideo: true,
    };
  }

  if (previewVideoSrc && facts.isAutoplayCandidate) {
    return {
      attachmentId: facts.attachmentId,
      tier: "warm_preview",
      reason: "autoplay_candidate",
      canonicalVideoSrc: null,
      previewVideoSrc,
      allowInlineCanonical: false,
      allowPreviewVideo: true,
    };
  }

  if (会话仍有轻帮助价值(facts.sessionStatus, facts.locallyComplete)) {
    return {
      attachmentId: facts.attachmentId,
      tier: "light_help",
      reason: "retained_media_session",
      canonicalVideoSrc: null,
      previewVideoSrc: null,
      allowInlineCanonical: false,
      allowPreviewVideo: false,
    };
  }

  return {
    attachmentId: facts.attachmentId,
    tier: "cold_expression",
    reason: "inactive",
    canonicalVideoSrc: null,
    previewVideoSrc: null,
    allowInlineCanonical: false,
    allowPreviewVideo: false,
  };
};

export const 提取重点信息流视频预算 = (
  budgets: Record<string, 信息流视频预算投影>
): 信息流视频预算投影[] =>
  Object.values(budgets).filter(
    (budget) => budget.tier !== "cold_expression" || budget.allowPreviewVideo
  );
