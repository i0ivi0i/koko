import type { 房间快照 } from "./契约.js";
import type { 房间内核事件 } from "./房间内核.js";
import { 合并房间时间线消息 } from "./房间时间线.js";
import type { 前端存储端口, 首页房间历史条目 } from "./存储.js";
import { Http接口错误, type 前端传输端口 } from "./传输.js";
import type { 聊天状态 } from "./状态.js";

export type Transport异常 =
  | {
      kind: "invalid_session";
      roomId?: string;
      keepRoomVisible?: boolean;
    }
  | {
      kind: "need_snapshot_reload";
      roomId: string;
    };

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

export interface 房间恢复编排依赖 {
  读取状态(): 聊天状态;
  更新状态(patch: Partial<聊天状态>): void;
  transport: 前端传输端口;
  storage: 前端存储端口;
  roomKernel: 房间内核端口;
  roomShellPatch(): Partial<聊天状态>;
  roomScroller: 房间滚动器端口;
  ensureRealtimeSocket(sessionId: string): void;
  subscribeRoom(from: number): void;
  cancelPendingReadAnchorFlush(): void;
  cancelPendingFollowLatestReadSample(): void;
  exitCurrentRoomView(opts?: { keepRoomCodeCache: boolean }): void;
  disconnectRealtime(): void;
  写入恢复补锚标记(value: boolean): void;
  等待壳渲染完成(): Promise<void>;
}

export interface 房间恢复编排端口 {
  bootstrap(): Promise<void>;
  joinRoom(): Promise<void>;
  restoreCurrentRoomIfNeeded(): Promise<void>;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
  接收Transport异常(error: Transport异常): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
}

/**
 * 房间恢复编排专门承接“房间如何建立、如何恢复、失败后如何收场”。
 *
 * 这里不直接碰 DOM，也不解释 realtime 控制面的细节；
 * 它只负责：
 * 1. bootstrap / join / restore / snapshot reload 的顺序；
 * 2. invalid_session / need_snapshot_reload 的恢复语义；
 * 3. 硬失败与可重试失败的房间收场边界。
 */
export function 创建房间恢复编排(deps: 房间恢复编排依赖): 房间恢复编排端口 {
  let invalidSessionRecoveryTask: Promise<void> | null = null;

  function 读取状态(): 聊天状态 {
    return deps.读取状态();
  }

  function 更新状态(patch: Partial<聊天状态>): void {
    deps.更新状态(patch);
  }

  function 回填房间外观(): void {
    更新状态(deps.roomShellPatch());
  }

  /**
   * 首页历史只是一份壳层本地记忆。
   * 恢复编排只表达“该同步首页历史了”，不让 UI 再自己推导一份第二真相。
   */
  function 同步首页房间历史(): void {
    更新状态({
      homeSessionItems: deps.storage.读取首页房间历史(),
    });
  }

  function 应用引导身份(
    deviceAnonymousToken: string,
    identity: {
      anonymous_identity_id: string;
      display_alias: string;
      session_id: string;
    }
  ): void {
    更新状态({
      deviceAnonymousToken,
      anonymousIdentityId: identity.anonymous_identity_id,
    });
  }

  function asRecoveryFailure(error: unknown): 恢复失败 {
    if (error instanceof Http接口错误) {
      return error;
    }
    return error as 恢复失败;
  }

  function recoveryCodeOf(error: unknown): string | undefined {
    const failure = asRecoveryFailure(error);
    if (typeof failure.code === "string" && failure.code.trim()) {
      return failure.code;
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return undefined;
  }

  function isInvalidSessionError(error: unknown): boolean {
    return recoveryCodeOf(error) === "invalid_session";
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
   * 首页历史删除边界必须非常窄：
   * - 只有明确的 `room_not_found`，才说明这条历史锚点已经失效；
   * - `membership_required` 仍然可能是有价值的历史房间，只是当前身份暂时进不去。
   */
  function pruneHomeSessionIfRoomMissing(code: string | undefined, roomIdHint = ""): void {
    if (code !== "room_not_found") {
      return;
    }
    const roomId =
      roomIdHint.trim() || 读取状态().roomId || deps.storage.读取当前房间标识();
    if (!roomId) {
      return;
    }
    deps.storage.按房间标识删除首页房间历史条目(roomId);
    同步首页房间历史();
  }

  /**
   * 硬失败要清 room 锚点并退出房间；临时失败则保留锚点，让用户还能重试。
   */
  function 处理恢复失败(error: unknown, keepRoomVisible: boolean): void {
    const failure = asRecoveryFailure(error);
    if (isHardRoomFailure(failure)) {
      pruneHomeSessionIfRoomMissing(failure.code);
      deps.roomKernel.send({
        type: "RECOVERY_FAILED",
        code: failure.code ?? "",
        keepRoomVisible: false,
      });
      deps.exitCurrentRoomView({ keepRoomCodeCache: false });
      回填房间外观();
      return;
    }

    deps.roomKernel.send({
      type: "RECOVERY_FAILED",
      code: failure.code ?? "system_error",
      keepRoomVisible,
    });
    更新状态({
      ...deps.roomShellPatch(),
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: keepRoomVisible ? 读取状态().hasUserScrollIntent : false,
    });
    deps.roomScroller.取消挂起滚动副作用();
  }

  /**
   * 房间标题当前优先来自用户实际输入过的短码缓存。
   * 后端还没有回房间标题前，只允许这里决定展示回退值。
   */
  function resolveRoomDisplayTitle(roomCodeForDisplay?: string): string {
    const trimmedRoomCode = roomCodeForDisplay?.trim() ?? "";
    if (trimmedRoomCode) {
      deps.storage.写入当前房间短码(trimmedRoomCode);
      return trimmedRoomCode;
    }
    return deps.storage.读取当前房间短码() || "群聊房间";
  }

  /**
   * 只在房间基线成功成立后，才把它记进首页历史。
   * 这样软离房不会删历史，硬失败也不会留下半成品条目。
   */
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
    deps.storage.写入或更新首页房间历史条目(nextItem);
    同步首页房间历史();
  }

  /**
   * 房间基线一旦成立，就统一从这里更新壳层状态与本地恢复锚点。
   * 这样 join / 刷新恢复 两条入口不会各自漂出一套写状态逻辑。
   */
  function enterRoomFromSnapshot(
    snapshot: 房间快照,
    roomCodeForDisplay?: string,
    primeReadAnchorAfterInitialSettle = false
  ): void {
    deps.cancelPendingReadAnchorFlush();
    deps.cancelPendingFollowLatestReadSample();
    deps.roomScroller.取消挂起滚动副作用();
    deps.写入恢复补锚标记(primeReadAnchorAfterInitialSettle);
    deps.storage.写入当前房间标识(snapshot.room_id);
    const roomDisplayTitle = resolveRoomDisplayTitle(roomCodeForDisplay);
    recordHomeSession(
      snapshot.room_id,
      roomCodeForDisplay?.trim() || deps.storage.读取当前房间短码()
    );
    deps.roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: snapshot.room_id,
      roomDisplayTitle,
      latestEventPosition: snapshot.latest_event_position,
      viewportMode:
        snapshot.first_unread_event_position === null ? "贴底跟随" : "围绕未读阅读",
    });
    更新状态({
      ...deps.roomShellPatch(),
      lastReadEventPosition: snapshot.last_read_event_position,
      firstUnreadEventPosition: snapshot.first_unread_event_position,
      hasMoreBefore: snapshot.has_more_before,
      initialUnreadSettled: false,
      // 只有带着首条未读恢复时，壳层才进入程序性恢复阶段；否则滚动语义直接保持 idle。
      scrollPhase:
        snapshot.first_unread_event_position === null ? "idle" : "restoring_unread",
      hasUserScrollIntent: false,
      pendingReadAnchorPosition: null,
      // snapshot_messages 是后端给出的权威房间基线，不是前端自己残留的缓存。
      // 只要快照成立，房间第一屏就应该直接可读，而不是先清空再等待未来增量。
      messages: 合并房间时间线消息(snapshot.snapshot_messages),
      pending: false,
      historyLoading: false,
      historyLoadThrottleUntil: 0,
      historyErrorCode: "",
    });
    deps.roomScroller.安排首屏定位();
  }

  /**
   * invalid_session 不是永久房间失效，而是“当前 session 失效，需要重新 bootstrap”。
   * 刷新后的新 session 建好后，再重试当前恢复步骤一次。
   */
  async function withSessionRefreshOnInvalid<T>(
    operation: (sessionId: string) => Promise<T>
  ): Promise<T> {
    try {
      return await operation(读取状态().sessionId);
    } catch (error) {
      if (!isInvalidSessionError(error)) {
        throw error;
      }
      deps.roomKernel.send({
        type: "RECONNECTING_STARTED",
        code: "invalid_session",
      });
      回填房间外观();
      const sessionId = await bootstrapFreshSession();
      return operation(sessionId);
    }
  }

  async function bootstrapFreshSession(): Promise<string> {
    const deviceAnonymousToken =
      读取状态().deviceAnonymousToken || deps.storage.读取或创建设备匿名凭证();
    const identity = await deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
    deps.disconnectRealtime();
    应用引导身份(deviceAnonymousToken, identity);
    deps.roomKernel.send({
      type: "SESSION_REFRESHED",
      sessionId: identity.session_id,
      displayAlias: identity.display_alias,
    });
    回填房间外观();
    deps.ensureRealtimeSocket(identity.session_id);
    return identity.session_id;
  }

  /**
   * 当 realtime 锚点闭合不了时，退回 HTTP 快照 + 增量补洞重建基线。
   * 这里继续沿用同一条权威锚点语义：`from = snapshot.latest_event_position`。
   */
  async function reloadRoomFromSnapshot(roomId: string): Promise<void> {
    const state = 读取状态();
    if (!state.roomId || roomId !== state.roomId) {
      return;
    }
    try {
      deps.roomScroller.取消挂起滚动副作用();
      deps.ensureRealtimeSocket(state.sessionId);
      const snapshot = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomSnapshot(roomId, sessionId)
      );
      const delta = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomEvents(roomId, sessionId, snapshot.latest_event_position)
      );
      const latestEventPosition = Math.max(
        snapshot.latest_event_position,
        delta.latest_event_position
      );
      const roomDisplayTitle = deps.storage.读取当前房间短码() || "群聊房间";
      deps.roomKernel.send({
        type: "SNAPSHOT_LOADED",
        roomId,
        roomDisplayTitle,
        latestEventPosition,
      });
      deps.写入恢复补锚标记(true);
      更新状态({
        ...deps.roomShellPatch(),
        lastReadEventPosition: snapshot.last_read_event_position,
        firstUnreadEventPosition: snapshot.first_unread_event_position,
        hasMoreBefore: snapshot.has_more_before,
        initialUnreadSettled: false,
        scrollPhase:
          snapshot.first_unread_event_position === null ? "idle" : "restoring_unread",
        hasUserScrollIntent: false,
        pendingReadAnchorPosition: null,
        // 重拉快照时，必须先回到快照自带的权威首屏，再叠加其后的增量。
        // 否则一旦同步链重建，房间又会退化成“只有未来消息、没有最近历史”的假空房。
        messages: 合并房间时间线消息([...snapshot.snapshot_messages, ...delta.events]),
        pending: false,
        historyLoading: false,
        historyLoadThrottleUntil: 0,
        historyErrorCode: "",
      });
      deps.roomScroller.安排首屏定位();
      deps.subscribeRoom(latestEventPosition);
    } catch (error) {
      处理恢复失败(error, true);
    }
  }

  /**
   * transport 异常在恢复编排里只有这一条统一入口。
   *
   * 这样 `connect_error`、`control_result invalid_session`、
   * `need_snapshot_reload` 都不会继续各自复制恢复代码。
   */
  async function handleTransport异常(error: Transport异常): Promise<void> {
    if (error.kind === "need_snapshot_reload") {
      await reloadRoomFromSnapshot(error.roomId);
      return;
    }
    await handleInvalidSessionTransport异常(
      error.roomId ?? 读取状态().roomId,
      error.keepRoomVisible ?? Boolean(error.roomId ?? 读取状态().roomId)
    );
  }

  /**
   * invalid_session 不区分来自握手阶段还是控制面阶段，
   * 都必须收口到同一个门闩里，避免重复 bootstrap / 重拉快照。
   */
  async function handleInvalidSessionTransport异常(
    roomId: string,
    keepRoomVisible: boolean
  ): Promise<void> {
    if (invalidSessionRecoveryTask) {
      await invalidSessionRecoveryTask;
      return;
    }
    const targetRoomId = roomId.trim();
    invalidSessionRecoveryTask = (async () => {
      try {
        deps.roomKernel.send({
          type: "RECONNECTING_STARTED",
          code: "invalid_session",
        });
        回填房间外观();
        await bootstrapFreshSession();
        if (targetRoomId) {
          await reloadRoomFromSnapshot(targetRoomId);
        }
      } catch (recoveryError) {
        if (keepRoomVisible) {
          处理恢复失败(recoveryError, true);
        } else {
          deps.roomKernel.send({
            type: "BOOTSTRAP_FAILED",
            code: recoveryCodeOf(recoveryError) ?? "system_error",
          });
          回填房间外观();
        }
      } finally {
        invalidSessionRecoveryTask = null;
      }
    })();
    await invalidSessionRecoveryTask;
  }

  async function bootstrap(): Promise<void> {
    try {
      const deviceAnonymousToken = deps.storage.读取或创建设备匿名凭证();
      const roomId = deps.storage.读取当前房间标识();
      同步首页房间历史();
      const identity = await deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
      应用引导身份(deviceAnonymousToken, identity);
      deps.roomKernel.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: identity.session_id,
        displayAlias: identity.display_alias,
        roomId,
      });
      回填房间外观();
      deps.ensureRealtimeSocket(identity.session_id);
      await restoreCurrentRoomIfNeeded();
    } catch (error) {
      deps.roomKernel.send({
        type: "BOOTSTRAP_FAILED",
        code: asRecoveryFailure(error).code ?? "system_error",
      });
      同步首页房间历史();
      回填房间外观();
    } finally {
      await deps.等待壳渲染完成();
      // 刷新恢复房间时，快照状态可能早于 roomView 真正渲染完成。
      // 因此 bootstrap 解锁后必须再补一次首屏定位调度，避免先对 bootView 做了无效定位。
      if (读取状态().roomId && !读取状态().initialUnreadSettled) {
        deps.roomScroller.安排首屏定位();
      }
    }
  }

  async function joinRoom(): Promise<void> {
    const roomCode = 读取状态().roomCodeInput.trim();
    if (!roomCode) {
      return;
    }
    try {
      deps.roomKernel.send({ type: "JOIN_REQUESTED" });
      deps.ensureRealtimeSocket(读取状态().sessionId);
      const snapshot = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.joinOrCreateRoom(sessionId, roomCode)
      );
      // join-or-create 现在已经返回权威房间快照：
      // 这里直接消费 snapshot_messages，避免进房后再额外打一枪 snapshot，
      // 否则不仅浪费一次请求，还会人为拉大“进房成功”和“首屏可读”之间的竞态窗口。
      enterRoomFromSnapshot(snapshot, roomCode, false);
      deps.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      处理恢复失败(error, false);
    }
  }

  /**
   * 启动恢复顺序必须固定：
   * 1. bootstrap 拿到当前权威 session；
   * 2. 读取壳层记住的 room_id；
   * 3. 用当前 session 拉快照恢复。
   */
  async function restoreCurrentRoomIfNeeded(): Promise<void> {
    const roomId = deps.storage.读取当前房间标识();
    if (!roomId) {
      return;
    }
    try {
      deps.ensureRealtimeSocket(读取状态().sessionId);
      const snapshot = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomSnapshot(roomId, sessionId)
      );
      enterRoomFromSnapshot(snapshot, undefined, true);
      deps.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      处理恢复失败(error, false);
    }
  }

  return {
    bootstrap,
    joinRoom,
    restoreCurrentRoomIfNeeded,
    withSessionRefreshOnInvalid,
    接收Transport异常: handleTransport异常,
    处理恢复失败,
  };
}
