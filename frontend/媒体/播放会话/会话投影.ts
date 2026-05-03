import type { 聊天运行时预算状态 } from "../../总装/聊天状态.js";
import type { 信息流视频预算投影 } from "../信息流视频预算.js";
import {
  投影媒体运行时预算,
  type 媒体运行时快照,
  type 媒体运行时上下文,
} from "../运行时.js";
import type { 媒体协作分发应用端口 } from "../协作分发/应用.js";
import type {
  媒体会话端口,
  媒体播放结果,
  媒体播放位置,
  视频预览状态,
} from "../index.js";
import type { 附件内容地址快照 } from "../壳层/快照投影协作.js";

export type 媒体播放会话快照 = {
  playbackByAttachmentId: Record<string, 媒体播放结果>;
  previewByAttachmentId: Record<string, 视频预览状态>;
  sessionByAttachmentId: Record<string, ReturnType<媒体会话端口["snapshot"]>>;
  contentUrlByAttachmentId: Record<string, 附件内容地址快照>;
  videoBudgetByAttachmentId: Record<string, 信息流视频预算投影>;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
};

export type 媒体播放会话预算快照 = Pick<
  聊天运行时预算状态,
  | "activeVideoCount"
  | "activeFormalPlayerCount"
  | "activeVideoSessionCount"
  | "activeMediaSessionCount"
  | "autoplayOwnerCount"
  | "activeSwarmCount"
  | "inflightLocatorCount"
  | "inflightManifestOrRangeCount"
  | "hiddenHeavyTaskCount"
  | "wholeFileHeavySessionCount"
  | "zeroRefHeavySessionCount"
  | "zeroRefLightHelpSessionCount"
  | "zeroRefWholeFileReaderCount"
  | "longTaskCount"
  | "focusedVideoBudget"
>;

interface 媒体快照投影端口 {
  读取媒体播放结果表(): 媒体播放会话快照["playbackByAttachmentId"];
  读取媒体会话快照表(): 媒体播放会话快照["sessionByAttachmentId"];
  读取附件内容地址表(): 媒体播放会话快照["contentUrlByAttachmentId"];
  读取信息流视频预算表(): 媒体播放会话快照["videoBudgetByAttachmentId"];
  缓存重点信息流视频预算(
    budgets: Record<string, 信息流视频预算投影>
  ): 聊天运行时预算状态["focusedVideoBudget"];
}

interface 自动播播放投影端口 {
  读取自动播播放结果表(): 媒体播放会话快照["inlineAutoplayPlaybackByAttachmentId"];
}

/**
 * 播放会话投影 owner 只把运行时、窗口会话和协作分发预算折成壳层快照。
 * 它不读 DOM、不创建播放器、不判断媒体字节是否成立。
 */
export function 投影媒体播放会话快照(input: {
  媒体快照投影协作: 媒体快照投影端口;
  视频预览状态表: Record<string, 视频预览状态>;
  自动播协作: 自动播播放投影端口;
  运行时上下文: 媒体运行时上下文;
}): 媒体播放会话快照 {
  return {
    playbackByAttachmentId: input.媒体快照投影协作.读取媒体播放结果表(),
    previewByAttachmentId: input.视频预览状态表,
    sessionByAttachmentId: input.媒体快照投影协作.读取媒体会话快照表(),
    contentUrlByAttachmentId: input.媒体快照投影协作.读取附件内容地址表(),
    videoBudgetByAttachmentId: input.媒体快照投影协作.读取信息流视频预算表(),
    inlineAutoplayOwnerAttachmentId: input.运行时上下文.inlineAutoplayOwnerAttachmentId,
    inlineAutoplayPlaybackByAttachmentId: input.自动播协作.读取自动播播放结果表(),
    inlineAutoplayPositionByAttachmentId: {
      ...input.运行时上下文.inlineAutoplayPositionByAttachmentId,
    },
  };
}

export function 投影媒体播放会话预算(input: {
  媒体会话表: Map<string, 媒体会话端口>;
  媒体运行时快照: 媒体运行时快照;
  协作分发应用: Pick<媒体协作分发应用端口, "读取预算">;
  媒体快照投影协作: 媒体快照投影端口;
}): 媒体播放会话预算快照 {
  const mediaSessions = Array.from(input.媒体会话表.values(), (session) =>
    session.snapshot()
  );
  const videoBudgets = input.媒体快照投影协作.读取信息流视频预算表();
  return {
    activeMediaSessionCount: mediaSessions.length,
    activeVideoSessionCount: mediaSessions.filter((session) => session.kind === "video").length,
    ...投影媒体运行时预算(input.媒体运行时快照),
    ...input.协作分发应用.读取预算(),
    focusedVideoBudget: input.媒体快照投影协作.缓存重点信息流视频预算(videoBudgets),
  };
}
