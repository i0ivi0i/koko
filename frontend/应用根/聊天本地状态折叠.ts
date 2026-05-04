import type {
  聊天会话状态,
  聊天输入状态,
  聊天时间线状态,
  聊天视口状态,
  聊天流程状态,
  聊天运行时状态,
  聊天运行时预算状态,
} from "./聊天状态.js";

/**
 * 本地状态补丁只允许覆盖聊天内核自己拥有的浏览器端 slice：
 * - room kernel 派生字段仍由房间 owner 回填；
 * - 这里不碰 bootstrap/session/roomDisplay 等房间外观字段；
 * - runtimeBudget 允许局部覆盖，避免调用方反复整包重建预算对象。
 */
export type 聊天本地状态补丁 = Partial<
  聊天会话状态 &
    聊天输入状态 &
    聊天时间线状态 &
    聊天视口状态 &
    聊天流程状态 &
    Omit<聊天运行时状态, "runtimeBudget">
> & {
  runtimeBudget?: Partial<聊天运行时预算状态>;
};

type 聊天本地状态折叠输入 = {
  会话状态: 聊天会话状态;
  输入状态: 聊天输入状态;
  时间线状态: 聊天时间线状态;
  视口状态: 聊天视口状态;
  流程状态: 聊天流程状态;
  运行时状态: 聊天运行时状态;
};

type 聊天本地状态折叠结果 = {
  写入了本地补丁: boolean;
  消息列表发生变化: boolean;
  会话状态?: 聊天会话状态;
  输入状态?: 聊天输入状态;
  时间线状态?: 聊天时间线状态;
  视口状态?: 聊天视口状态;
  流程状态?: 聊天流程状态;
  运行时状态?: 聊天运行时状态;
};

function 记录有变化字段<T extends object, K extends keyof T>(
  currentState: T,
  nextPatch: Partial<T>,
  key: K,
  nextValue: T[K],
  onChange?: () => void
): void {
  if (Object.is(currentState[key], nextValue)) {
    return;
  }
  nextPatch[key] = nextValue;
  onChange?.();
}

function 浅比较对象<T extends object>(left: T, right: T): boolean {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left) as Array<keyof T>;
  const rightKeys = Object.keys(right) as Array<keyof T>;
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key])
  );
}

/**
 * 这条纯函数只做一件事：把聊天内核拥有的本地 slice 折叠成下一帧状态。
 * 它不 requestUpdate、不同步媒体、不读 DOM，只返回“哪些 slice 真变了”。
 */
export function 应用聊天本地状态折叠(
  当前状态: 聊天本地状态折叠输入,
  patch: 聊天本地状态补丁
): 聊天本地状态折叠结果 {
  let 消息列表发生变化 = false;
  const 会话补丁: Partial<聊天会话状态> = {};
  const 输入补丁: Partial<聊天输入状态> = {};
  const 时间线补丁: Partial<聊天时间线状态> = {};
  const 视口补丁: Partial<聊天视口状态> = {};
  const 流程补丁: Partial<聊天流程状态> = {};
  const 运行时补丁: Partial<聊天运行时状态> = {};

  if (Object.hasOwn(patch, "deviceAnonymousToken")) {
    记录有变化字段(
      当前状态.会话状态,
      会话补丁,
      "deviceAnonymousToken",
      patch.deviceAnonymousToken ?? ""
    );
  }
  if (Object.hasOwn(patch, "homeSessionItems")) {
    记录有变化字段(
      当前状态.会话状态,
      会话补丁,
      "homeSessionItems",
      patch.homeSessionItems ?? []
    );
  }
  if (Object.hasOwn(patch, "roomCodeInput")) {
    记录有变化字段(当前状态.输入状态, 输入补丁, "roomCodeInput", patch.roomCodeInput ?? "");
  }
  if (Object.hasOwn(patch, "messageInput")) {
    记录有变化字段(当前状态.输入状态, 输入补丁, "messageInput", patch.messageInput ?? "");
  }
  if (Object.hasOwn(patch, "composerMediaDrafts")) {
    记录有变化字段(
      当前状态.输入状态,
      输入补丁,
      "composerMediaDrafts",
      patch.composerMediaDrafts ?? []
    );
  }
  if (Object.hasOwn(patch, "mediaSelectionPendingCount")) {
    记录有变化字段(
      当前状态.输入状态,
      输入补丁,
      "mediaSelectionPendingCount",
      patch.mediaSelectionPendingCount ?? 0
    );
  }
  if (Object.hasOwn(patch, "messages")) {
    记录有变化字段(当前状态.时间线状态, 时间线补丁, "messages", patch.messages ?? [], () => {
      消息列表发生变化 = true;
    });
  }
  if (Object.hasOwn(patch, "hasMoreBefore")) {
    记录有变化字段(
      当前状态.时间线状态,
      时间线补丁,
      "hasMoreBefore",
      patch.hasMoreBefore ?? false
    );
  }
  if (Object.hasOwn(patch, "historyLoading")) {
    记录有变化字段(
      当前状态.时间线状态,
      时间线补丁,
      "historyLoading",
      patch.historyLoading ?? false
    );
  }
  if (Object.hasOwn(patch, "historyErrorCode")) {
    记录有变化字段(
      当前状态.时间线状态,
      时间线补丁,
      "historyErrorCode",
      patch.historyErrorCode ?? ""
    );
  }
  if (Object.hasOwn(patch, "viewportMode")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "viewportMode",
      patch.viewportMode ?? "离底浏览"
    );
  }
  if (Object.hasOwn(patch, "candidateReadAnchorPosition")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "candidateReadAnchorPosition",
      patch.candidateReadAnchorPosition ?? null
    );
  }
  if (Object.hasOwn(patch, "hasUnreadNewerMessages")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "hasUnreadNewerMessages",
      patch.hasUnreadNewerMessages ?? false
    );
  }
  if (Object.hasOwn(patch, "lastReadEventPosition")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "lastReadEventPosition",
      patch.lastReadEventPosition ?? null
    );
  }
  if (Object.hasOwn(patch, "firstUnreadEventPosition")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "firstUnreadEventPosition",
      patch.firstUnreadEventPosition ?? null
    );
  }
  if (Object.hasOwn(patch, "initialUnreadSettled")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "initialUnreadSettled",
      patch.initialUnreadSettled ?? false
    );
  }
  if (Object.hasOwn(patch, "scrollPhase")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "scrollPhase",
      patch.scrollPhase ?? "idle"
    );
  }
  if (Object.hasOwn(patch, "hasUserScrollIntent")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "hasUserScrollIntent",
      patch.hasUserScrollIntent ?? false
    );
  }
  if (Object.hasOwn(patch, "pendingReadAnchorPosition")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "pendingReadAnchorPosition",
      patch.pendingReadAnchorPosition ?? null
    );
  }
  if (Object.hasOwn(patch, "historyLoadThrottleUntil")) {
    记录有变化字段(
      当前状态.视口状态,
      视口补丁,
      "historyLoadThrottleUntil",
      patch.historyLoadThrottleUntil ?? 0
    );
  }
  if (Object.hasOwn(patch, "pending")) {
    记录有变化字段(当前状态.流程状态, 流程补丁, "pending", patch.pending ?? false);
  }
  if (Object.hasOwn(patch, "lifecycleVisibility")) {
    记录有变化字段(
      当前状态.运行时状态,
      运行时补丁,
      "lifecycleVisibility",
      patch.lifecycleVisibility ?? "visible"
    );
  }
  if (Object.hasOwn(patch, "lifecyclePhase")) {
    记录有变化字段(
      当前状态.运行时状态,
      运行时补丁,
      "lifecyclePhase",
      patch.lifecyclePhase ?? "active"
    );
  }
  if (Object.hasOwn(patch, "heavyWorkPolicy")) {
    记录有变化字段(
      当前状态.运行时状态,
      运行时补丁,
      "heavyWorkPolicy",
      patch.heavyWorkPolicy ?? "normal"
    );
  }
  if (Object.hasOwn(patch, "swUpdateState")) {
    记录有变化字段(
      当前状态.运行时状态,
      运行时补丁,
      "swUpdateState",
      patch.swUpdateState ?? "idle"
    );
  }
  if (Object.hasOwn(patch, "accelerationState")) {
    记录有变化字段(
      当前状态.运行时状态,
      运行时补丁,
      "accelerationState",
      patch.accelerationState ?? "best_effort"
    );
  }
  if (Object.hasOwn(patch, "online")) {
    记录有变化字段(当前状态.运行时状态, 运行时补丁, "online", patch.online ?? true);
  }
  if (Object.hasOwn(patch, "runtimeBudget")) {
    const nextRuntimeBudget = {
      ...当前状态.运行时状态.runtimeBudget,
      ...patch.runtimeBudget,
    };
    if (!浅比较对象(当前状态.运行时状态.runtimeBudget, nextRuntimeBudget)) {
      运行时补丁.runtimeBudget = nextRuntimeBudget;
    }
  }

  const 会话状态 =
    Object.keys(会话补丁).length > 0
      ? { ...当前状态.会话状态, ...会话补丁 }
      : undefined;
  const 输入状态 =
    Object.keys(输入补丁).length > 0
      ? { ...当前状态.输入状态, ...输入补丁 }
      : undefined;
  const 时间线状态 =
    Object.keys(时间线补丁).length > 0
      ? { ...当前状态.时间线状态, ...时间线补丁 }
      : undefined;
  const 视口状态 =
    Object.keys(视口补丁).length > 0
      ? { ...当前状态.视口状态, ...视口补丁 }
      : undefined;
  const 流程状态 =
    Object.keys(流程补丁).length > 0
      ? { ...当前状态.流程状态, ...流程补丁 }
      : undefined;
  const 运行时状态 =
    Object.keys(运行时补丁).length > 0
      ? { ...当前状态.运行时状态, ...运行时补丁 }
      : undefined;

  const 结果: 聊天本地状态折叠结果 = {
    写入了本地补丁:
      会话状态 !== undefined ||
      输入状态 !== undefined ||
      时间线状态 !== undefined ||
      视口状态 !== undefined ||
      流程状态 !== undefined ||
      运行时状态 !== undefined,
    消息列表发生变化,
  };
  if (会话状态) {
    结果.会话状态 = 会话状态;
  }
  if (输入状态) {
    结果.输入状态 = 输入状态;
  }
  if (时间线状态) {
    结果.时间线状态 = 时间线状态;
  }
  if (视口状态) {
    结果.视口状态 = 视口状态;
  }
  if (流程状态) {
    结果.流程状态 = 流程状态;
  }
  if (运行时状态) {
    结果.运行时状态 = 运行时状态;
  }
  return 结果;
}
