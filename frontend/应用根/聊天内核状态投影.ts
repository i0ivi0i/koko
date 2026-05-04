import type { 房间壳外观 } from "../房间/运行时.js";
import type { 房间恢复编排依赖 } from "../恢复/壳层/房间恢复编排.js";
import type { 房间实时编排依赖 } from "../实时/应用.js";
import type { 阅读推进编排依赖 } from "../房间/壳层/阅读推进.js";
import {
  初始聊天运行时预算状态,
  type 聊天会话状态,
  type 聊天时间线状态,
  type 聊天流程状态,
  type 聊天运行时预算状态,
  type 聊天运行时状态,
  type 聊天视口状态,
  type 聊天输入状态,
} from "./聊天状态.js";
import type { 媒体播放会话应用端口 } from "../媒体/播放会话/应用.js";

export type 房间壳补丁 = Pick<
  房间壳外观,
  | "bootstrapState"
  | "sessionId"
  | "displayAlias"
  | "roomId"
  | "roomDisplayTitle"
  | "latestEventPosition"
  | "recoveryState"
  | "lastRecoveryErrorCode"
>;

type 聊天内核状态切片 = {
  会话状态: 聊天会话状态;
  输入状态: 聊天输入状态;
  时间线状态: 聊天时间线状态;
  视口状态: 聊天视口状态;
  流程状态: 聊天流程状态;
};

/**
 * 聊天内核状态投影只做纯数据拼装：
 * 1. 不触发传输、滚动、媒体或平台副作用；
 * 2. 不重算房间权限、成员、消息成立这类后端真相；
 * 3. 只把各 owner 已经给出的快照翻译给恢复、实时、阅读推进等应用端口。
 */
export function 投影房间壳补丁(roomShell: 房间壳外观): 房间壳补丁 {
  return {
    bootstrapState: roomShell.bootstrapState,
    sessionId: roomShell.sessionId,
    displayAlias: roomShell.displayAlias,
    roomId: roomShell.roomId,
    roomDisplayTitle: roomShell.roomDisplayTitle,
    latestEventPosition: roomShell.latestEventPosition,
    recoveryState: roomShell.recoveryState,
    lastRecoveryErrorCode: roomShell.lastRecoveryErrorCode,
  };
}

export function 投影聊天运行时预算(input: {
  运行时状态: 聊天运行时状态;
  媒体预算: ReturnType<媒体播放会话应用端口["读取预算"]>;
  updatePendingDurationMs: number;
}): 聊天运行时预算状态 {
  return {
    ...初始聊天运行时预算状态,
    ...input.运行时状态.runtimeBudget,
    ...input.媒体预算,
    updatePendingDurationMs: input.updatePendingDurationMs,
  };
}

export function 投影聊天基础快照(input: 聊天内核状态切片 & {
  运行时状态: 聊天运行时状态;
  runtimeBudget: 聊天运行时预算状态;
  房间壳: 房间壳补丁;
}) {
  return {
    ...input.会话状态,
    ...input.输入状态,
    ...input.时间线状态,
    ...input.视口状态,
    ...input.流程状态,
    ...input.运行时状态,
    runtimeBudget: input.runtimeBudget,
    ...input.房间壳,
  };
}

export function 投影恢复编排状态(
  input: 聊天内核状态切片 & { 房间壳: 房间壳补丁 }
): ReturnType<房间恢复编排依赖["读取恢复状态"]> {
  return {
    deviceAnonymousToken: input.会话状态.deviceAnonymousToken,
    displayAlias: input.房间壳.displayAlias,
    sessionId: input.房间壳.sessionId,
    roomId: input.房间壳.roomId,
    roomCodeInput: input.输入状态.roomCodeInput,
    lastReadEventPosition: input.视口状态.lastReadEventPosition,
    firstUnreadEventPosition: input.视口状态.firstUnreadEventPosition,
    hasMoreBefore: input.时间线状态.hasMoreBefore,
    initialUnreadSettled: input.视口状态.initialUnreadSettled,
    scrollPhase: input.视口状态.scrollPhase,
    hasUserScrollIntent: input.视口状态.hasUserScrollIntent,
    pendingReadAnchorPosition: input.视口状态.pendingReadAnchorPosition,
    historyLoadThrottleUntil: input.视口状态.historyLoadThrottleUntil,
    pending: input.流程状态.pending,
    historyLoading: input.时间线状态.historyLoading,
    historyErrorCode: input.时间线状态.historyErrorCode,
    homeSessionItems: input.会话状态.homeSessionItems,
  };
}

export function 投影实时编排状态(
  input: 聊天内核状态切片 & { 房间壳: 房间壳补丁 }
): ReturnType<房间实时编排依赖["读取实时状态"]> {
  return {
    displayAlias: input.房间壳.displayAlias,
    sessionId: input.房间壳.sessionId,
    roomId: input.房间壳.roomId,
    latestEventPosition: input.房间壳.latestEventPosition,
    viewportMode: input.视口状态.viewportMode,
    messageInput: input.输入状态.messageInput,
    composerMediaDrafts: input.输入状态.composerMediaDrafts,
    mediaSelectionPendingCount: input.输入状态.mediaSelectionPendingCount,
    pending: input.流程状态.pending,
  };
}

export function 投影阅读推进状态(
  input: Pick<聊天内核状态切片, "时间线状态" | "视口状态"> & {
    房间壳: 房间壳补丁;
  }
): ReturnType<阅读推进编排依赖["读取阅读状态"]> {
  return {
    roomId: input.房间壳.roomId,
    sessionId: input.房间壳.sessionId,
    latestEventPosition: input.房间壳.latestEventPosition,
    viewportMode: input.视口状态.viewportMode,
    candidateReadAnchorPosition: input.视口状态.candidateReadAnchorPosition,
    messages: input.时间线状态.messages,
    hasMoreBefore: input.时间线状态.hasMoreBefore,
    historyLoading: input.时间线状态.historyLoading,
    historyErrorCode: input.时间线状态.historyErrorCode,
    lastReadEventPosition: input.视口状态.lastReadEventPosition,
    firstUnreadEventPosition: input.视口状态.firstUnreadEventPosition,
    initialUnreadSettled: input.视口状态.initialUnreadSettled,
    scrollPhase: input.视口状态.scrollPhase,
    pendingReadAnchorPosition: input.视口状态.pendingReadAnchorPosition,
  };
}
