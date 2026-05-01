import type { 房间快照 } from "../../聊天共享/契约.js";
import type { 房间内核事件 } from "../../房间/运行时.js";
import type { 房间时间线事件 } from "../../时间线/运行时.js";
import type { 前端存储端口, 首页房间历史条目 } from "../../存储.js";
import { 创建会话失效恢复协作 } from "../../聊天恢复/壳层/会话失效恢复.js";
import { 创建恢复应用 } from "../应用.js";
import type { 聊天房间传输端口 } from "../../聊天共享/适配/聊天房间传输端口.js";
import { Http接口错误 } from "../../传输.js";
import type { 聊天状态 } from "../../状态.js";

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

type 恢复编排状态 = Pick<
  聊天状态,
  | "deviceAnonymousToken"
  | "displayAlias"
  | "sessionId"
  | "roomId"
  | "roomCodeInput"
  | "lastReadEventPosition"
  | "firstUnreadEventPosition"
  | "hasMoreBefore"
  | "initialUnreadSettled"
  | "scrollPhase"
  | "hasUserScrollIntent"
  | "pendingReadAnchorPosition"
  | "historyLoadThrottleUntil"
  | "pending"
  | "historyLoading"
  | "historyErrorCode"
  | "homeSessionItems"
>;

export interface 房间恢复编排依赖 {
  读取恢复状态(): 恢复编排状态;
  写入恢复状态(patch: Partial<恢复编排状态>): void;
  接收时间线事实(event: 房间时间线事件): void;
  transport: 聊天房间传输端口;
  storage: 前端存储端口;
  roomKernel: 房间内核端口;
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
 * 它属于恢复壳层 owner：
 * 1. 只编排 bootstrap / join / restore / snapshot reload 的时序；
 * 2. 只消费恢复应用、会话失效恢复协作和房间窄传输端口；
 * 3. 不直接碰 DOM，也不解释 realtime 控制面细节。
 */
export function 创建房间恢复编排(deps: 房间恢复编排依赖): 房间恢复编排端口 {
  function 读取恢复状态(): 恢复编排状态 {
    return deps.读取恢复状态();
  }

  function 写入恢复状态(patch: Partial<恢复编排状态>): void {
    deps.写入恢复状态(patch);
  }

  function 接收时间线事实(event: 房间时间线事件): void {
    deps.接收时间线事实(event);
  }

  function 应用引导身份(
    deviceAnonymousToken: string,
    identity: {
      display_alias: string;
      session_id: string;
    }
  ): void {
    deps.storage.写入最近引导身份({
      sessionId: identity.session_id,
      displayAlias: identity.display_alias,
    });
    写入恢复状态({
      deviceAnonymousToken,
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

  /**
   * invalid_session 不是永久房间失效，而是“当前 session 失效，需要重新 bootstrap”。
   * 刷新后的新 session 建好后，再重试当前恢复步骤一次。
   */
  async function withSessionRefreshOnInvalid<T>(
    operation: (sessionId: string) => Promise<T>
  ): Promise<T> {
    try {
      return await operation(读取恢复状态().sessionId);
    } catch (error) {
      if (!isInvalidSessionError(error)) {
        throw error;
      }
      const sessionId = await 会话失效恢复.刷新会话();
      return operation(sessionId);
    }
  }

  const 房间快照恢复 = 创建恢复应用({
    读取恢复状态,
    写入恢复状态,
    接收时间线事实,
    storage: deps.storage,
    roomKernel: deps.roomKernel,
    roomScroller: deps.roomScroller,
    cancelPendingReadAnchorFlush: deps.cancelPendingReadAnchorFlush,
    cancelPendingFollowLatestReadSample: deps.cancelPendingFollowLatestReadSample,
    exitCurrentRoomView: (opts) => deps.exitCurrentRoomView(opts),
    写入恢复补锚标记: deps.写入恢复补锚标记,
    ensureRealtimeSocket: deps.ensureRealtimeSocket,
    subscribeRoom: deps.subscribeRoom,
    loadRoomSnapshot: (roomId, sessionId) => deps.transport.loadRoomSnapshot(roomId, sessionId),
    loadRoomEvents: (roomId, sessionId, from) =>
      deps.transport.loadRoomEvents(roomId, sessionId, from),
    withSessionRefreshOnInvalid,
  });

  const 会话失效恢复 = 创建会话失效恢复协作({
    读取恢复状态: () => ({
      deviceAnonymousToken: 读取恢复状态().deviceAnonymousToken,
      roomId: 读取恢复状态().roomId,
    }),
    读取或创建设备匿名凭证: () => deps.storage.读取或创建设备匿名凭证(),
    bootstrapAnonymousIdentity: (deviceAnonymousToken) =>
      deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken),
    disconnectRealtime: deps.disconnectRealtime,
    应用引导身份,
    广播会话已刷新: (identity) => {
      deps.roomKernel.send({
        type: "SESSION_REFRESHED",
        sessionId: identity.session_id,
        displayAlias: identity.display_alias,
      });
    },
    ensureRealtimeSocket: deps.ensureRealtimeSocket,
    从房间快照恢复: (roomId) => 房间快照恢复.从房间快照恢复(roomId),
    处理恢复失败: (error, keepRoomVisible) => {
      房间快照恢复.处理恢复失败(error, keepRoomVisible);
    },
    读取恢复失败代码: recoveryCodeOf,
    上报引导失败: (code) => {
      deps.roomKernel.send({
        type: "BOOTSTRAP_FAILED",
        code,
      });
    },
  });

  /**
   * transport 异常在恢复编排里只有这一条统一入口。
   *
   * 这样 `connect_error`、`control_result invalid_session`、
   * `need_snapshot_reload` 都不会继续各自复制恢复代码。
   */
  async function handleTransport异常(error: Transport异常): Promise<void> {
    if (error.kind === "need_snapshot_reload") {
      await 房间快照恢复.从房间快照恢复(error.roomId);
      return;
    }
    await 会话失效恢复.处理会话失效Transport异常(
      error.roomId ?? 读取恢复状态().roomId ?? "",
      error.keepRoomVisible ?? Boolean(error.roomId ?? 读取恢复状态().roomId)
    );
  }

  async function bootstrap(): Promise<void> {
    const deviceAnonymousToken = deps.storage.读取或创建设备匿名凭证();
    const roomId = deps.storage.读取当前房间标识();
    try {
      房间快照恢复.同步首页房间历史();
      const identity = await deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
      应用引导身份(deviceAnonymousToken, identity);
      deps.roomKernel.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: identity.session_id,
        displayAlias: identity.display_alias,
        roomId,
      });
      deps.ensureRealtimeSocket(identity.session_id);
      await restoreCurrentRoomIfNeeded();
    } catch (error) {
      const cachedIdentity = deps.storage.读取最近引导身份();
      const cachedRoom = 房间快照恢复.读取当前房间恢复快照(roomId);
      if (roomId && cachedIdentity && cachedRoom) {
        写入恢复状态({
          deviceAnonymousToken,
        });
        deps.roomKernel.send({
          type: "BOOTSTRAP_SUCCEEDED",
          sessionId: cachedIdentity.sessionId,
          displayAlias: cachedIdentity.displayAlias,
          roomId,
        });
        deps.ensureRealtimeSocket(cachedIdentity.sessionId);
        await restoreCurrentRoomIfNeeded();
      } else {
        deps.roomKernel.send({
          type: "BOOTSTRAP_FAILED",
          code: asRecoveryFailure(error).code ?? "system_error",
        });
      }
      房间快照恢复.同步首页房间历史();
    } finally {
      await deps.等待壳渲染完成();
      // 刷新恢复房间时，快照状态可能早于 roomView 真正渲染完成。
      // 因此 bootstrap 解锁后必须再补一次首屏定位调度，避免先对 bootView 做了无效定位。
      if (读取恢复状态().roomId && !读取恢复状态().initialUnreadSettled) {
        deps.roomScroller.安排首屏定位();
      }
    }
  }

  async function joinRoom(): Promise<void> {
    const roomCode = 读取恢复状态().roomCodeInput.trim();
    if (!roomCode) {
      return;
    }
    try {
      deps.roomKernel.send({ type: "JOIN_REQUESTED" });
      deps.ensureRealtimeSocket(读取恢复状态().sessionId);
      const snapshot = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.joinOrCreateRoom(sessionId, roomCode)
      );
      // join-or-create 现在已经返回权威房间快照：
      // 这里直接消费 snapshot_messages，避免进房后再额外打一枪 snapshot，
      // 否则不仅浪费一次请求，还会人为拉大“进房成功”和“首屏可读”之间的竞态窗口。
      房间快照恢复.进入房间快照(snapshot, roomCode, false);
      deps.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      房间快照恢复.处理恢复失败(error, false);
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
      deps.ensureRealtimeSocket(读取恢复状态().sessionId);
      const snapshot = await withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomSnapshot(roomId, sessionId)
      );
      房间快照恢复.进入房间快照(snapshot, undefined, true);
      deps.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      const cached = 房间快照恢复.读取当前房间恢复快照(roomId);
      if (cached) {
        房间快照恢复.进入房间快照(cached.snapshot, cached.roomCode, true);
        return;
      }
      房间快照恢复.处理恢复失败(error, false);
    }
  }

  return {
    bootstrap,
    joinRoom,
    restoreCurrentRoomIfNeeded,
    withSessionRefreshOnInvalid,
    接收Transport异常: handleTransport异常,
    处理恢复失败: (error, keepRoomVisible) => {
      房间快照恢复.处理恢复失败(error, keepRoomVisible);
    },
  };
}
