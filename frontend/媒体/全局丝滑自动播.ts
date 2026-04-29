import { initialTransition, setup } from "xstate";

export type 播放连续性表面 = "timeline" | "viewer" | "fullscreen";

export type 播放连续性阶段 =
  | "coldPlaceholder"
  | "hiddenHandoff"
  | "visible"
  | "pausedFrame"
  | "viewerHandoff"
  | "fullscreenHandoff"
  | "retired";

export interface 播放连续性输入 {
  attachmentId: string;
  ownerAttachmentId: string | null;
  surface: 播放连续性表面;
  source: { src: string | null };
  savedPosition: { src: string; currentTime: number; updatedAt: number } | null;
  dom: { previewReadyState: number; canonicalReadyState: number; sourceMatches: boolean };
  host: { exists: boolean; hasStableFrame: boolean };
  intent: { viewerOpen: boolean; fullscreen: boolean; retire?: boolean };
}

export type 播放连续性决策 =
  | {
      phase: "coldPlaceholder";
      kind: "cold_placeholder";
      reason: "no_source" | "no_position" | "host_missing";
    }
  | { phase: "pausedFrame"; kind: "hold_frame"; src: string | null }
  | { phase: "hiddenHandoff"; kind: "hidden_handoff"; targetCurrentTime: number }
  | { phase: "visible"; kind: "visible_canonical"; targetCurrentTime: number }
  | { phase: "viewerHandoff"; kind: "viewer_handoff"; targetCurrentTime: number }
  | { phase: "fullscreenHandoff"; kind: "fullscreen_handoff"; targetCurrentTime: number }
  | { phase: "retired"; kind: "retire" };

interface 播放连续性上下文 {
  input: 播放连续性输入;
}

const 读取同源保存位置 = (input: 播放连续性输入): 播放连续性输入["savedPosition"] => {
  if (!input.source.src || !input.savedPosition) {
    return null;
  }
  if (input.savedPosition.src !== input.source.src) {
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

const 读取目标时间 = (input: 播放连续性输入): number =>
  读取同源保存位置(input)?.currentTime ?? 0;

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

export const 播放连续性机 = setup({
  types: {
    context: {} as 播放连续性上下文,
    input: {} as 播放连续性输入,
  },
  guards: {
    需要退场: ({ context }) => context.input.intent.retire === true,
    缺少正式源: ({ context }) => !context.input.source.src,
    宿主缺失: ({ context }) => !context.input.host.exists,
    缺少同源保存位置: ({ context }) => !读取同源保存位置(context.input),
    需要全屏接管: ({ context }) => context.input.intent.fullscreen,
    需要查看器接管: ({ context }) => context.input.intent.viewerOpen,
    可露出Canonical: ({ context }) =>
      context.input.dom.sourceMatches && context.input.dom.canonicalReadyState >= 2,
    可保持暂停帧: ({ context }) =>
      context.input.host.hasStableFrame &&
      context.input.dom.sourceMatches &&
      context.input.dom.previewReadyState >= 2,
  },
}).createMachine({
  id: "globalSmoothAutoplay",
  initial: "evaluating",
  context: ({ input }) => ({ input }),
  states: {
    evaluating: {
      always: [
        { guard: "需要退场", target: "retired" },
        { guard: "缺少正式源", target: "coldPlaceholder" },
        { guard: "宿主缺失", target: "coldPlaceholder" },
        { guard: "缺少同源保存位置", target: "coldPlaceholder" },
        { guard: "需要全屏接管", target: "fullscreenHandoff" },
        { guard: "需要查看器接管", target: "viewerHandoff" },
        { guard: "可露出Canonical", target: "visible" },
        { guard: "可保持暂停帧", target: "pausedFrame" },
        { target: "hiddenHandoff" },
      ],
    },
    coldPlaceholder: {},
    hiddenHandoff: {},
    visible: {},
    pausedFrame: {},
    viewerHandoff: {},
    fullscreenHandoff: {},
    retired: {},
  },
});

export const 判定播放连续性表面 = (input: 播放连续性输入): 播放连续性决策 => {
  const [snapshot] = initialTransition(播放连续性机, input);
  const phase = snapshot.value as 播放连续性阶段;
  switch (phase) {
    case "retired":
      return { phase, kind: "retire" };
    case "coldPlaceholder":
      return { phase, kind: "cold_placeholder", reason: 读取冷占位理由(input) };
    case "pausedFrame":
      return { phase, kind: "hold_frame", src: input.source.src };
    case "hiddenHandoff":
      return { phase, kind: "hidden_handoff", targetCurrentTime: 读取目标时间(input) };
    case "visible":
      return { phase, kind: "visible_canonical", targetCurrentTime: 读取目标时间(input) };
    case "viewerHandoff":
      return { phase, kind: "viewer_handoff", targetCurrentTime: 读取目标时间(input) };
    case "fullscreenHandoff":
      return { phase, kind: "fullscreen_handoff", targetCurrentTime: 读取目标时间(input) };
  }
};
