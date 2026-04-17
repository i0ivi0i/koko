import type { 房间时间线事件 } from "./房间时间线运行时.js";
import type { 历史补偿上下文 } from "./房间滚动器.js";
import type { 聊天状态 } from "./状态.js";
import type { 前端传输端口 } from "./传输.js";

const 阅读推进节流毫秒 = 400;

type 房间滚动器端口 = {
  读取当前可见阅读锚点(): number | null;
  读取历史补偿上下文(): 历史补偿上下文;
  应用历史补偿(补偿上下文: 历史补偿上下文, 插入了消息: boolean): Promise<void>;
};

export interface 阅读推进编排依赖 {
  读取阅读状态(): 阅读推进状态;
  写入阅读状态(patch: Partial<阅读推进状态>): void;
  接收时间线事实(event: 房间时间线事件): void;
  transport: 前端传输端口;
  roomScroller: 房间滚动器端口;
  上报历史前插开始?(): void;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
  等待壳渲染完成(): Promise<void>;
  滚到最新位置(): Promise<void>;
}

export interface 阅读推进编排端口 {
  接收候选已读位置(position: number): void;
  接收首屏稳定完成(): void;
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
type 阅读推进状态 = Pick<
  聊天状态,
  | "roomId"
  | "sessionId"
  | "latestEventPosition"
  | "viewportMode"
  | "candidateReadAnchorPosition"
  | "messages"
  | "hasMoreBefore"
  | "historyLoading"
  | "historyErrorCode"
  | "lastReadEventPosition"
  | "firstUnreadEventPosition"
  | "initialUnreadSettled"
  | "scrollPhase"
  | "pendingReadAnchorPosition"
>;

export function 创建阅读推进编排(deps: 阅读推进编排依赖): 阅读推进编排端口 {
  let readAnchorFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let followLatestReadSampleTimer: ReturnType<typeof setTimeout> | null = null;

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
    deps.写入阅读状态({
      candidateReadAnchorPosition: nextPosition,
    });
    promoteCandidateReadAnchorToPending();
  }

  /**
   * 候选已读锚点和“正式待提交”必须分两层：
   * - 候选只代表壳层观测到“用户大概率已经看到这里”；
   * - 只有当前房间已经处于稳定阅读阶段，才允许它进入真正的提交队列。
   */
  function promoteCandidateReadAnchorToPending(): void {
    const state = deps.读取阅读状态();
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
    deps.写入阅读状态({
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
    const state = deps.读取阅读状态();
    const nextPosition = state.pendingReadAnchorPosition;
    if (!state.roomId || nextPosition === null) {
      return;
    }
    if (nextPosition <= (state.lastReadEventPosition ?? 0)) {
      deps.写入阅读状态({ pendingReadAnchorPosition: null });
      return;
    }
    try {
      await deps.transport.updateRoomReadAnchor(state.roomId, state.sessionId, nextPosition);
      deps.写入阅读状态({
        lastReadEventPosition: nextPosition,
        pendingReadAnchorPosition: null,
        firstUnreadEventPosition:
          state.firstUnreadEventPosition !== null && nextPosition >= state.firstUnreadEventPosition
            ? null
            : state.firstUnreadEventPosition,
      });
    } catch {
      // 阅读推进失败不应破坏当前房间内容；丢掉这次 pending，等待后续滚动再重试即可。
      deps.写入阅读状态({ pendingReadAnchorPosition: null });
    }
  }

  /**
   * 首屏稳定完成必须显式回灌给视口 owner，而不是只在壳层里改一个布尔值。
   * 这样以后换模板、换滚动实现时，阅读推进仍然只消费“视口已经稳定”的领域事实，
   * 不会再次退化成由某个 DOM 控件临时宣布已读语义。
   */
  function 接收首屏稳定完成(): void {
    if (deps.读取阅读状态().initialUnreadSettled) {
      return;
    }
    deps.写入阅读状态({
      initialUnreadSettled: true,
    });
    promoteCandidateReadAnchorToPending();
  }

  /**
   * 历史分页只负责“向更早方向补页”：
   * - 以当前最老消息的 event_position 作为锚点；
   * - 只往顶部追加，不动已经可见的消息；
   * - 与 snapshot / realtime 共用同一套合流逻辑，避免重复和乱序。
   */
  async function 请求加载更早历史(): Promise<void> {
    const state = deps.读取阅读状态();
    if (!state.roomId || state.historyLoading || !state.hasMoreBefore) {
      return;
    }

    const oldestMessage = state.messages[0];
    if (!oldestMessage) {
      return;
    }
    const 补偿上下文 = deps.roomScroller.读取历史补偿上下文();

    deps.写入阅读状态({
      historyLoading: true,
      historyErrorCode: "",
    });

    try {
      const page = await deps.withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomHistory(state.roomId, sessionId, oldestMessage.event_position, 55)
      );
      deps.接收时间线事实({
        type: "HISTORY_PAGE_APPENDED",
        messages: page.messages,
        hasMoreBefore: page.messages.length > 0,
      });
      deps.写入阅读状态({
        historyLoading: false,
        historyErrorCode: "",
      });
      // 历史页是往列表顶部前插的，但守视口不能再只靠 scrollHeight 差值。
      // 新策略优先围绕旧锚点恢复；只有锚点彻底找不回时，才退回高度差值兜底。
      if (page.messages.length > 0) {
        deps.上报历史前插开始?.();
      }
      await deps.roomScroller.应用历史补偿(补偿上下文, page.messages.length > 0);
    } catch (error) {
      const code =
        typeof (error as { code?: unknown })?.code === "string"
          ? ((error as { code: string }).code || "system_error")
          : "system_error";
      deps.写入阅读状态({
        historyLoading: false,
        historyErrorCode: code,
      });
    }
  }

  async function scrollToLatestAndEnterFollowMode(): Promise<void> {
    await deps.等待壳渲染完成();
    await deps.滚到最新位置();
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
    请求加载更早历史,
    请求跳到最新,
    接收Realtime追加后跟随,
    dispose,
  };
}
