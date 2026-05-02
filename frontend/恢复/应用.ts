import type { 房间快照, 消息事件 } from "../聊天共享/契约.js";
import type { 房间内核事件 } from "../房间/运行时.js";
import type { 房间时间线事件 } from "../时间线/运行时.js";
import type { 前端存储端口, 首页房间历史条目 } from "../平台/存储.js";
import type { 聊天状态 } from "../总装/聊天状态.js";

type 恢复失败 = Error & {
  status?: number;
  code?: string;
};

type 房间内核端口 = {
  send(event: 房间内核事件): void;
};

type 房间滚动器端口 = {
  安排首屏定位(): void;
  取消挂起滚动副作用(): void;
};

type 房间快照恢复状态 = Pick<
  聊天状态,
  | "roomId"
  | "sessionId"
  | "homeSessionItems"
  | "hasUserScrollIntent"
>;

type 房间快照恢复状态补丁 = Partial<
  Pick<
    聊天状态,
    | "homeSessionItems"
    | "roomCodeInput"
    | "lastReadEventPosition"
    | "firstUnreadEventPosition"
    | "initialUnreadSettled"
    | "scrollPhase"
    | "hasUserScrollIntent"
    | "pendingReadAnchorPosition"
    | "pending"
    | "historyLoading"
    | "historyLoadThrottleUntil"
    | "historyErrorCode"
  >
>;

type 增量事件快照 = {
  latest_event_position: number;
  events: 消息事件[];
};

export interface 房间快照恢复协作依赖 {
  读取恢复状态(): 房间快照恢复状态;
  写入恢复状态(patch: 房间快照恢复状态补丁): void;
  接收时间线事实(event: 房间时间线事件): void;
  storage: 前端存储端口;
  roomKernel: 房间内核端口;
  roomScroller: 房间滚动器端口;
  cancelPendingReadAnchorFlush(): void;
  cancelPendingFollowLatestReadSample(): void;
  exitCurrentRoomView(opts: { keepRoomCodeCache: boolean }): void;
  写入恢复补锚标记(value: boolean): void;
  ensureRealtimeSocket(sessionId: string): void;
  subscribeRoom(from: number): void;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  loadRoomEvents(roomId: string, sessionId: string, from: number): Promise<增量事件快照>;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
}

export interface 房间快照恢复协作 {
  同步首页房间历史(): void;
  读取当前房间恢复快照(
    roomIdHint?: string
  ): { roomCode: string; snapshot: 房间快照 } | null;
  进入房间快照(
    snapshot: 房间快照,
    roomCodeForDisplay?: string,
    primeReadAnchorAfterInitialSettle?: boolean,
    latestEventPositionOverride?: number
  ): void;
  从房间快照恢复(roomId: string): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
}

export type 恢复应用依赖 = 房间快照恢复协作依赖;
export type 恢复应用端口 = 房间快照恢复协作;

function asRecoveryFailure(error: unknown): 恢复失败 {
  return error as 恢复失败;
}

function isHardRoomFailure(error: { code?: string; status?: number }): boolean {
  return (
    error.code === "room_not_found" ||
    error.code === "membership_required" ||
    error.status === 403 ||
    error.status === 404
  );
}

/**
 * 恢复应用拥有“本地恢复体验如何围绕权威房间快照复位”这条真相：
 * 1. 快照成立后如何回写本地恢复记忆；
 * 2. 失败时如何降级、退场、保留短码；
 * 3. 快照 + 增量补洞怎样重建首屏体验。
 *
 * 它不拥有业务权限、成员合法性或房间存在性；这些只来自后端快照与错误码。
 */
export function 创建恢复应用(deps: 恢复应用依赖): 恢复应用端口 {
  function 同步首页房间历史(): void {
    deps.写入恢复状态({
      homeSessionItems: deps.storage.读取首页房间历史(),
    });
  }

  function 尝试写入本地恢复记忆(write: () => void, onFailed?: () => void): void {
    try {
      write();
    } catch {
      try {
        onFailed?.();
      } catch {
        // 本地恢复记忆只是体验缓存；写入或清理失败都不能反向推翻已经拿到的权威房间快照。
      }
    }
  }

  function 读取当前房间恢复快照(
    roomIdHint = ""
  ): { roomCode: string; snapshot: 房间快照 } | null {
    const cached = deps.storage.读取当前房间恢复快照();
    if (!cached) {
      return null;
    }
    const roomId = roomIdHint.trim() || deps.storage.读取当前房间标识();
    if (!roomId || cached.snapshot.room_id !== roomId) {
      return null;
    }
    return cached;
  }

  function pruneHomeSessionIfRoomMissing(code: string | undefined, roomIdHint = ""): void {
    if (code !== "room_not_found") {
      return;
    }
    const roomId =
      roomIdHint.trim() || deps.读取恢复状态().roomId || deps.storage.读取当前房间标识();
    if (!roomId) {
      return;
    }
    deps.storage.按房间标识删除首页房间历史条目(roomId);
    同步首页房间历史();
  }

  /**
   * 硬失败退出房间时，首页仍然需要保住最后一次短码输入，
   * 否则 `room_not_found` 这类真实退场会把用户直接扔回空白首页。
   */
  function resolveFallbackRoomCode(roomIdHint = ""): string {
    const cachedRoomCode = deps.storage.读取当前房间短码().trim();
    if (cachedRoomCode) {
      return cachedRoomCode;
    }
    const roomId =
      roomIdHint.trim() || deps.读取恢复状态().roomId || deps.storage.读取当前房间标识();
    if (!roomId) {
      return "";
    }
    const matched = deps.读取恢复状态().homeSessionItems.find((item) => item.roomId === roomId);
    return matched?.roomCode.trim() ?? "";
  }

  function resolveRoomDisplayTitle(roomCodeForDisplay?: string): string {
    const trimmedRoomCode = roomCodeForDisplay?.trim() ?? "";
    if (trimmedRoomCode) {
      尝试写入本地恢复记忆(() => deps.storage.写入当前房间短码(trimmedRoomCode));
      return trimmedRoomCode;
    }
    return deps.storage.读取当前房间短码() || "群聊房间";
  }

  function recordHomeSession(roomId: string, roomCode: string): void {
    const trimmedRoomId = roomId.trim();
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomId || !trimmedRoomCode) {
      return;
    }
    const nextItem: 首页房间历史条目 = {
      roomId: trimmedRoomId,
      roomCode: trimmedRoomCode,
      lastEnteredAt: Date.now(),
    };
    尝试写入本地恢复记忆(() => {
      deps.storage.写入或更新首页房间历史条目(nextItem);
      同步首页房间历史();
    });
  }

  /**
   * 房间快照一旦成立，就从这里统一回填：
   * - room kernel 的房间基线；
   * - 本地恢复锚点；
   * - snapshot 自带的第一屏权威消息。
   */
  function 进入房间快照(
    snapshot: 房间快照,
    roomCodeForDisplay?: string,
    primeReadAnchorAfterInitialSettle = false,
    latestEventPositionOverride?: number
  ): void {
    deps.cancelPendingReadAnchorFlush();
    deps.cancelPendingFollowLatestReadSample();
    deps.roomScroller.取消挂起滚动副作用();
    deps.写入恢复补锚标记(primeReadAnchorAfterInitialSettle);
    const roomDisplayTitle = resolveRoomDisplayTitle(roomCodeForDisplay);
    const persistedRoomCode =
      roomCodeForDisplay?.trim() || deps.storage.读取当前房间短码().trim();
    尝试写入本地恢复记忆(() => deps.storage.写入当前房间标识(snapshot.room_id));
    尝试写入本地恢复记忆(
      () =>
        deps.storage.写入当前房间恢复快照({
          roomCode: persistedRoomCode,
          snapshot,
        }),
      () => deps.storage.清除当前房间恢复快照()
    );
    recordHomeSession(snapshot.room_id, persistedRoomCode);
    deps.roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: snapshot.room_id,
      roomDisplayTitle,
      latestEventPosition: latestEventPositionOverride ?? snapshot.latest_event_position,
    });
    deps.写入恢复状态({
      lastReadEventPosition: snapshot.last_read_event_position,
      firstUnreadEventPosition: snapshot.first_unread_event_position,
      initialUnreadSettled: false,
      scrollPhase:
        snapshot.first_unread_event_position === null ? "idle" : "restoring_unread",
      hasUserScrollIntent: false,
      pendingReadAnchorPosition: null,
      pending: false,
      historyLoading: false,
      historyLoadThrottleUntil: 0,
      historyErrorCode: "",
    });
    deps.接收时间线事实({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      messages: snapshot.snapshot_messages,
      latestEventPosition: snapshot.latest_event_position,
      hasMoreBefore: snapshot.has_more_before,
    });
    deps.roomScroller.安排首屏定位();
  }

  function 处理恢复失败(error: unknown, keepRoomVisible: boolean): void {
    const failure = asRecoveryFailure(error);
    if (isHardRoomFailure(failure)) {
      const failedRoomId = deps.读取恢复状态().roomId || deps.storage.读取当前房间标识();
      const fallbackRoomCode = resolveFallbackRoomCode(failedRoomId);
      pruneHomeSessionIfRoomMissing(failure.code, failedRoomId);
      deps.storage.清除当前房间恢复快照();
      deps.roomKernel.send({
        type: "RECOVERY_FAILED",
        code: failure.code ?? "",
        keepRoomVisible: false,
        roomInvalidated: true,
      });
      deps.exitCurrentRoomView({
        keepRoomCodeCache: failure.code === "room_not_found" && fallbackRoomCode.length > 0,
      });
      if (fallbackRoomCode) {
        deps.写入恢复状态({ roomCodeInput: fallbackRoomCode });
      }
      return;
    }

    deps.roomKernel.send({
      type: "RECOVERY_FAILED",
      code: failure.code ?? "system_error",
      keepRoomVisible,
      roomInvalidated: false,
    });
    deps.写入恢复状态({
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: keepRoomVisible ? deps.读取恢复状态().hasUserScrollIntent : false,
    });
    deps.roomScroller.取消挂起滚动副作用();
  }

  /**
   * 当 realtime 补洞锚点失效时，恢复链退回 HTTP 快照 + 增量补洞重建房间基线。
   * 这条路径仍只认一套权威事实：快照先建基线，增量只叠加在其后。
   */
  async function 从房间快照恢复(roomId: string): Promise<void> {
    const state = deps.读取恢复状态();
    if (!state.roomId || roomId !== state.roomId) {
      return;
    }
    try {
      deps.roomScroller.取消挂起滚动副作用();
      deps.ensureRealtimeSocket(state.sessionId);
      const snapshot = await deps.withSessionRefreshOnInvalid((sessionId) =>
        deps.loadRoomSnapshot(roomId, sessionId)
      );
      const delta = await deps.withSessionRefreshOnInvalid((sessionId) =>
        deps.loadRoomEvents(roomId, sessionId, snapshot.latest_event_position)
      );
      const latestEventPosition = Math.max(
        snapshot.latest_event_position,
        delta.latest_event_position
      );
      进入房间快照(snapshot, undefined, true, latestEventPosition);
      if (delta.events.length > 0) {
        deps.接收时间线事实({
          type: "REALTIME_EVENTS_RECEIVED",
          messages: delta.events,
          latestEventPosition,
        });
      }
      deps.subscribeRoom(latestEventPosition);
    } catch (error) {
      const cached = 读取当前房间恢复快照(roomId);
      if (cached) {
        进入房间快照(cached.snapshot, cached.roomCode, true);
        return;
      }
      处理恢复失败(error, true);
    }
  }

  return {
    同步首页房间历史,
    读取当前房间恢复快照,
    进入房间快照,
    从房间快照恢复,
    处理恢复失败,
  };
}
