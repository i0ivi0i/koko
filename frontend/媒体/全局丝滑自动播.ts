export type 播放连续性表面 = "timeline" | "viewer" | "fullscreen";

export type 播放连续性阶段 =
  | "coldPlaceholder"
  | "hiddenHandoff"
  | "visible"
  | "pausedFrame"
  | "viewerHandoff"
  | "fullscreenHandoff"
  | "retired";

export type 播放连续性帧证据 =
  | { kind: "none" }
  | { kind: "preview_dom" | "frozen_frame" | "canonical_frame"; src: string; currentTime: number };

export interface 播放连续性输入 {
  attachmentId: string;
  ownerAttachmentId: string | null;
  surface: 播放连续性表面;
  source: { src: string | null };
  savedPosition: { src: string; currentTime: number; updatedAt: number } | null;
  dom: { previewReadyState: number; canonicalReadyState: number; sourceMatches: boolean };
  host: { exists: boolean; hasStableFrame: boolean };
  frameEvidence: 播放连续性帧证据;
  intent: { viewerOpen: boolean; fullscreen: boolean; retire?: boolean };
}

export type 播放连续性决策 =
  | {
      phase: "coldPlaceholder";
      kind: "cold_placeholder";
      reason: "no_source" | "no_position" | "host_missing";
    }
  | {
      phase: "pausedFrame";
      kind: "hold_frame";
      src: string | null;
      targetCurrentTime: number;
    }
  | { phase: "hiddenHandoff"; kind: "hidden_handoff"; targetCurrentTime: number }
  | { phase: "visible"; kind: "visible_canonical"; targetCurrentTime: number }
  | { phase: "viewerHandoff"; kind: "viewer_handoff"; targetCurrentTime: number }
  | { phase: "fullscreenHandoff"; kind: "fullscreen_handoff"; targetCurrentTime: number }
  | { phase: "retired"; kind: "retire" };

const 暂停帧允许时间偏差秒 = 0.75;

const 读取同源保存位置 = (input: 播放连续性输入): 播放连续性输入["savedPosition"] => {
  if (!input.source.src || !input.savedPosition) {
    return null;
  }
  /**
   * WebTorrent runtime 常保留 `/webtorrent/...` 相对地址，而浏览器事件会把
   * `currentSrc` 回报成绝对地址。状态机不直接碰 `window`，只消费上层已经归一化过的
   * `sourceMatches` 事实，避免把 URL 解析这类壳层细节塞进全局播放连续性领域模型。
   */
  const isSameSource = input.savedPosition.src === input.source.src || input.dom.sourceMatches;
  if (!isSameSource) {
    return null;
  }
  if (
    !Number.isFinite(input.savedPosition.currentTime) ||
    !Number.isFinite(input.savedPosition.updatedAt)
  ) {
    return null;
  }
  return input.savedPosition;
};

const 读取可用帧证据 = (
  input: 播放连续性输入,
  savedPosition: 播放连续性输入["savedPosition"]
): Exclude<播放连续性帧证据, { kind: "none" }> | null => {
  if (!input.source.src || input.frameEvidence.kind === "none") {
    return null;
  }
  const isSameSource =
    input.frameEvidence.src === input.source.src || input.dom.sourceMatches;
  if (!isSameSource || !Number.isFinite(input.frameEvidence.currentTime)) {
    return null;
  }
  if (
    savedPosition &&
    Math.abs(input.frameEvidence.currentTime - savedPosition.currentTime) >
      暂停帧允许时间偏差秒
  ) {
    return null;
  }
  return input.frameEvidence;
};

const 读取冷占位理由 = (
  input: 播放连续性输入
): "no_source" | "no_position" | "host_missing" => {
  if (!input.source.src) {
    return "no_source";
  }
  if (!input.host.exists) {
    return "host_missing";
  }
  return "no_position";
};

export const 播放连续性机 = Object.freeze({
  id: "globalSmoothAutoplay",
  transitions: [
    "retired",
    "coldPlaceholder",
    "fullscreenHandoff",
    "viewerHandoff",
    "visible",
    "pausedFrame",
    "hiddenHandoff",
  ] satisfies 播放连续性阶段[],
});

export const 判定播放连续性表面 = (input: 播放连续性输入): 播放连续性决策 => {
  const savedPosition = 读取同源保存位置(input);
  const targetCurrentTime = savedPosition?.currentTime ?? 0;
  const frameEvidence = 读取可用帧证据(input, savedPosition);
  const hasContinuityEvidence =
    Boolean(savedPosition) ||
    Boolean(frameEvidence) ||
    (input.dom.sourceMatches && input.host.hasStableFrame);
  if (input.intent.retire === true) {
    return { phase: "retired", kind: "retire" };
  }
  if (!input.source.src || !input.host.exists || !hasContinuityEvidence) {
    return {
      phase: "coldPlaceholder",
      kind: "cold_placeholder",
      reason: 读取冷占位理由(input),
    };
  }
  if (input.intent.fullscreen) {
    return { phase: "fullscreenHandoff", kind: "fullscreen_handoff", targetCurrentTime };
  }
  if (input.intent.viewerOpen) {
    return { phase: "viewerHandoff", kind: "viewer_handoff", targetCurrentTime };
  }
  if (input.dom.sourceMatches && input.dom.canonicalReadyState >= 2) {
    return { phase: "visible", kind: "visible_canonical", targetCurrentTime };
  }
  if (
    Boolean(frameEvidence) &&
    input.host.hasStableFrame &&
    input.dom.sourceMatches &&
    input.dom.previewReadyState >= 2
  ) {
    /**
     * `hold_frame` 不是“随便有一帧就行”，而是“当前这张稳定帧是在为哪一个续播时间点兜底”。
     * 后续渲染层和唯一播放器都要靠这个时间事实判断能不能无闪烁接回同一条会话。
     */
    return {
      phase: "pausedFrame",
      kind: "hold_frame",
      src: input.source.src,
      targetCurrentTime,
    };
  }
  return { phase: "hiddenHandoff", kind: "hidden_handoff", targetCurrentTime };
};
