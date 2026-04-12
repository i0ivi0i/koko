import type { 房间内核事件 } from "./房间内核.js";
import type { 时间线输入 } from "./房间时间线.js";
import type { 历史补偿上下文 } from "./房间滚动器.js";
import type { 聊天状态 } from "./状态.js";
import type { 前端传输端口 } from "./传输.js";

const 阅读推进节流毫秒 = 400;

type 房间内核端口 = {
  send(event: 房间内核事件): void;
};

type 房间滚动器端口 = {
  读取当前可见阅读锚点(): number | null;
  读取当前是否接近底部(): boolean;
  读取历史补偿上下文(): 历史补偿上下文;
  应用历史补偿(补偿上下文: 历史补偿上下文, 插入了消息: boolean): Promise<void>;
};

export interface 阅读推进编排依赖 {
  读取状态(): 聊天状态;
  更新状态(patch: Partial<聊天状态>): void;
  推进时间线(input: 时间线输入): void;
  transport: 前端传输端口;
  roomKernel: 房间内核端口;
  roomShellPatch(): Partial<聊天状态>;
  roomScroller: 房间滚动器端口;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
  等待壳渲染完成(): Promise<void>;
  滚到最新位置(): Promise<void>;
}

export interface 阅读推进编排端口 {
  接收候选已读位置(position: number): void;
  接收首屏稳定完成(mode: 聊天状态["viewportMode"]): void;
  接收视口滚动(): void;
  请求加载更早历史(): Promise<void>;
  请求跳到最新(): Promise<void>;
  接收Realtime追加后跟随(): Promise<void>;
  dispose(): void;
}

/**
 * 阅读推进编排只回答三类问题：
 * 1. 什么时候候选已读可以升级成正式待提交；
 * 2. 什么时候需要跳到最新并在贴底后补读；
 * 3. 顶部加载历史时如何守住当前视口。
 *
 * 它不直接做 DOM 查询，也不自己掌握房间恢复语义；
 * DOM 可见性和补偿都通过滚动器读取/执行，恢复链则通过依赖注入复用。
 */
export function 创建阅读推进编排(deps: 阅读推进编排依赖): 阅读推进编排端口 {
  let readAnchorFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let followLatestReadSampleTimer: ReturnType<typeof setTimeout> | null = null;

  function 读取状态(): 聊天状态 {
    return deps.读取状态();
  }

  function 更新状态(patch: Partial<聊天状态>): void {
    deps.更新状态(patch);
  }

  function 推进时间线(input: 时间线输入): void {
    deps.推进时间线(input);
  }

  function cancelPendingReadAnchorFlush(): void {
    if (readAnchorFlushTimer === null) {
      return;
    }
    clearTimeout(readAnchorFlushTimer);
    readAnchorFlushTimer = null;
  }

  function cancelPendingFollowLatestReadSample(): void {
    if (followLatestReadSampleTimer === null) {
      return;
    }
    clearTimeout(followLatestReadSampleTimer);
    followLatestReadSampleTimer = null;
  }

  function 接收候选已读位置(nextPosition: number): void {
    deps.roomKernel.send({
      type: "VIEWPORT_OBSERVED",
      candidateReadAnchorPosition: nextPosition,
      isNearBottom: deps.roomScroller.读取当前是否接近底部(),
    });
    更新状态(deps.roomShellPatch());
    promoteCandidateReadAnchorToPending();
  }

  /**
   * 候选已读锚点和“正式待提交”必须分两层：
   * - 候选只代表壳层观测到“用户大概率已经看到这里”；
   * - 只有当前房间已经处于稳定阅读阶段，才允许它进入真正的提交队列。
   */
  function promoteCandidateReadAnchorToPending(): void {
    const state = 读取状态();
    if (!state.roomId || !state.initialUnreadSettled) {
      return;
    }
    if (state.scrollPhase !== "idle") {
      return;
    }
    const candidatePosition = state.candidateReadAnchorPosition;
    if (candidatePosition === null) {
      return;
    }
    const currentReadPosition = state.lastReadEventPosition ?? 0;
    const pendingPosition = state.pendingReadAnchorPosition ?? 0;
    const floor = Math.max(currentReadPosition, pendingPosition);
    if (candidatePosition <= floor) {
      return;
    }
    更新状态({
      pendingReadAnchorPosition: candidatePosition,
    });
    if (readAnchorFlushTimer !== null) {
      return;
    }
    readAnchorFlushTimer = setTimeout(() => {
      readAnchorFlushTimer = null;
      void flushReadAnchorUpdate();
    }, 阅读推进节流毫秒);
  }

  async function flushReadAnchorUpdate(): Promise<void> {
    const state = 读取状态();
    const nextPosition = state.pendingReadAnchorPosition;
    if (!state.roomId || nextPosition === null) {
      return;
    }
    if (nextPosition <= (state.lastReadEventPosition ?? 0)) {
      更新状态({ pendingReadAnchorPosition: null });
      return;
    }
    try {
      await deps.transport.updateRoomReadAnchor(state.roomId, state.sessionId, nextPosition);
      更新状态({
        lastReadEventPosition: nextPosition,
        pendingReadAnchorPosition: null,
        firstUnreadEventPosition:
          state.firstUnreadEventPosition !== null && nextPosition >= state.firstUnreadEventPosition
            ? null
            : state.firstUnreadEventPosition,
      });
    } catch {
      // 阅读推进失败不应破坏当前房间内容；丢掉这次 pending，等待后续滚动再重试即可。
      更新状态({ pendingReadAnchorPosition: null });
    }
  }

  /**
   * 首屏稳定完成必须显式回灌给房间内核，而不是只在壳层里改一个布尔值。
   * 这样以后换模板、换滚动实现时，内核仍然能明确知道：
   * “当前房间已经从恢复阶段进入了可解释阅读语义的稳定状态。”
   */
  function 接收首屏稳定完成(mode: 聊天状态["viewportMode"]): void {
    if (读取状态().initialUnreadSettled) {
      return;
    }
    deps.roomKernel.send({
      type: "INITIAL_SETTLE_COMPLETED",
      mode,
    });
    更新状态({
      ...deps.roomShellPatch(),
      initialUnreadSettled: true,
      scrollPhase: "idle",
    });
    promoteCandidateReadAnchorToPending();
  }

  function 接收视口滚动(): void {
    deps.roomKernel.send({
      type: "VIEWPORT_OBSERVED",
      candidateReadAnchorPosition: null,
      isNearBottom: deps.roomScroller.读取当前是否接近底部(),
    });
    更新状态(deps.roomShellPatch());
  }

  /**
   * 历史分页只负责“向更早方向补页”：
   * - 以当前最老消息的 event_position 作为锚点；
   * - 只往顶部追加，不动已经可见的消息；
   * - 与 snapshot / realtime 共用同一套合流逻辑，避免重复和乱序。
   */
  async function 请求加载更早历史(): Promise<void> {
    const state = 读取状态();
    if (!state.roomId || state.historyLoading || !state.hasMoreBefore) {
      return;
    }

    const oldestMessage = state.messages[0];
    if (!oldestMessage) {
      return;
    }
    const 补偿上下文 = deps.roomScroller.读取历史补偿上下文();

    更新状态({
      historyLoading: true,
      historyErrorCode: "",
    });

    try {
      const page = await deps.withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomHistory(state.roomId, sessionId, oldestMessage.event_position, 55)
      );
      推进时间线({
        type: "HISTORY",
        messages: page.messages,
      });
      更新状态({
        historyLoading: false,
        // 历史分页接口当前还只返回这一页消息本身：
        // 因此前端仍维持“拿到空页才确认到顶”的保守语义，不再额外猜首屏恢复真相。
        hasMoreBefore: page.messages.length > 0,
        historyErrorCode: "",
        scrollPhase: page.messages.length > 0 ? "compensating_history" : 读取状态().scrollPhase,
      });
      // 历史页是往列表顶部前插的，但守视口不能再只靠 scrollHeight 差值。
      // 新策略优先围绕旧锚点恢复；只有锚点彻底找不回时，才退回高度差值兜底。
      await deps.roomScroller.应用历史补偿(补偿上下文, page.messages.length > 0);
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? ((error as { code: string }).code || "system_error")
          : "system_error";
      更新状态({
        historyLoading: false,
        historyErrorCode: code,
        scrollPhase:
          读取状态().scrollPhase === "compensating_history" ? "idle" : 读取状态().scrollPhase,
      });
    }
  }

  async function scrollToLatestAndEnterFollowMode(): Promise<void> {
    await deps.等待壳渲染完成();
    await deps.滚到最新位置();
    deps.roomKernel.send({ type: "USER_JUMPED_TO_LATEST" });
    更新状态(deps.roomShellPatch());
    schedulePassiveReadAnchorAfterFollowLatest();
  }

  /**
   * 用户已经处在贴底跟随模式时，新消息进入视口本身就是一次真实阅读推进来源。
   * 这里额外等一个极短窗口，让 DOM 和布局先稳定，再复用滚动器的“稳定可读”采样。
   */
  function schedulePassiveReadAnchorAfterFollowLatest(): void {
    cancelPendingFollowLatestReadSample();
    followLatestReadSampleTimer = setTimeout(() => {
      followLatestReadSampleTimer = null;
      const nextReadPosition = deps.roomScroller.读取当前可见阅读锚点();
      if (nextReadPosition === null) {
        return;
      }
      接收候选已读位置(nextReadPosition);
    }, 0);
  }

  async function 请求跳到最新(): Promise<void> {
    await scrollToLatestAndEnterFollowMode();
  }

  async function 接收Realtime追加后跟随(): Promise<void> {
    await scrollToLatestAndEnterFollowMode();
  }

  function dispose(): void {
    cancelPendingReadAnchorFlush();
    cancelPendingFollowLatestReadSample();
  }

  return {
    接收候选已读位置,
    接收首屏稳定完成,
    接收视口滚动,
    请求加载更早历史,
    请求跳到最新,
    接收Realtime追加后跟随,
    dispose,
  };
}
