import { 创建房间内核, 派生房间壳外观 } from "../../房间/运行时";
import {
  创建房间时间线Actor,
  投影时间线快照到聊天时间线状态,
  type 房间时间线事件,
} from "../../时间线/运行时";
import type { 消息事件 } from "../../聊天共享/契约";
import type { 聊天状态 } from "../../总装/聊天状态";

export function 创建房间壳补丁(
  roomKernel: ReturnType<typeof 创建房间内核>
): Partial<聊天状态> {
  const roomShell = 派生房间壳外观(roomKernel.getSnapshot());
  return {
    sessionId: roomShell.sessionId,
    displayAlias: roomShell.displayAlias,
    roomId: roomShell.roomId,
    roomDisplayTitle: roomShell.roomDisplayTitle,
    latestEventPosition: roomShell.latestEventPosition,
    recoveryState: roomShell.recoveryState,
    lastRecoveryErrorCode: roomShell.lastRecoveryErrorCode,
  };
}

export function 创建会同步房间壳补丁的房间内核端口(
  roomKernel: ReturnType<typeof 创建房间内核>,
  同步房间壳补丁: () => void
): {
  send(event: Parameters<ReturnType<typeof 创建房间内核>["send"]>[0]): void;
} {
  return {
    send(event) {
      roomKernel.send(event);
      同步房间壳补丁();
    },
  };
}

export function 创建会同步时间线补丁的时间线端口(
  updateState: (patch: Partial<聊天状态>) => void,
  input: {
    messages?: 消息事件[];
    latestEventPosition?: number;
    hasMoreBefore?: boolean;
  } = {}
): {
  send(event: 房间时间线事件): void;
} {
  const actor = 创建房间时间线Actor();
  const 同步时间线补丁 = (): void => {
    const snapshot = actor.getSnapshot();
    updateState({
      ...投影时间线快照到聊天时间线状态(snapshot),
      latestEventPosition: snapshot.context.latestEventPosition,
    });
  };

  if (
    (input.messages?.length ?? 0) > 0 ||
    (input.latestEventPosition ?? 0) > 0 ||
    (input.hasMoreBefore ?? false)
  ) {
    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      messages: input.messages ?? [],
      latestEventPosition: input.latestEventPosition ?? 0,
      hasMoreBefore: input.hasMoreBefore ?? false,
    });
  }
  同步时间线补丁();

  return {
    send(event) {
      actor.send(event);
      同步时间线补丁();
    },
  };
}

export function 创建房间视图重置补丁(): Partial<聊天状态> {
  return {
    messageInput: "",
    lastReadEventPosition: null,
    firstUnreadEventPosition: null,
    hasMoreBefore: false,
    initialUnreadSettled: true,
    scrollPhase: "idle",
    hasUserScrollIntent: false,
    pendingReadAnchorPosition: null,
    viewportMode: "离底浏览",
    candidateReadAnchorPosition: null,
    hasUnreadNewerMessages: false,
    historyLoadThrottleUntil: 0,
    messages: [],
    pending: false,
    historyLoading: false,
    historyErrorCode: "",
  };
}
