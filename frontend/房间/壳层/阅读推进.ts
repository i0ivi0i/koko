import type { 房间时间线事件 } from "../../时间线/运行时.js";
import type { 历史补偿上下文 } from "../../时间线/滚动器.js";
import type { 聊天状态 } from "../../应用根/聊天状态.js";
import type { 聊天房间传输端口 } from "../../聊天共享/适配/聊天房间传输端口.js";
import type { 消息事件 } from "../../聊天共享/契约.js";
import type { 消息仓库端口 } from "../../聊天本地缓存/消息仓库端口.js";

const 阅读推进节流毫秒 = 400;

/**
 * 历史分页默认页大小。
 *
 * 55 与服务端 `loadRoomHistory` 默认页大小一致（spec §8）。
 * 全局常量，需要调整时只改一处。
 */
const 历史分页默认页大小 = 55;

type 房间滚动器端口 = {
  读取当前可见阅读锚点(): number | null;
  读取历史补偿上下文(): 历史补偿上下文;
  应用历史补偿(补偿上下文: 历史补偿上下文, 插入了消息: boolean): Promise<void>;
};

export interface 阅读推进编排依赖 {
  读取阅读状态(): 阅读推进状态;
  写入阅读状态(patch: Partial<阅读推进状态>): void;
  接收时间线事实(event: 房间时间线事件): void;
  transport: 聊天房间传输端口;
  roomScroller: 房间滚动器端口;
  上报历史前插开始?(): void;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
  等待壳渲染完成(): Promise<void>;
  滚到最新位置(): Promise<void>;
  /**
   * 消息仓库（application port）：历史前插优先级入口。
   * 命中跳服务端，miss 走服务端 后异步回写。
   */
  消息仓库: 消息仓库端口;
}

export interface 阅读推进编排端口 {
  接收候选已读位置(position: number): void;
  接收首屏稳定完成(): void;
  请求加载更早历史(): Promise<void>;
  请求跳到最新(): Promise<void>;
  接收Realtime追加后跟随(): Promise<void>;
  取消待刷新已读锚点(): void;
  取消待跟随最新采样(): void;
  dispose(): void;
}

/**
 * 阅读推进编排只回答三类问题：
 * 1. 什么时候候选已读可以升级成正式待提交；
 * 2. 什么时候需要跳到最新并在贴底后补读；
 * 3. 顶部加载历史时如何守住当前视口。
 *
 * 它属于房间壳层 owner：
 * - 对外只消费房间时间线事实、滚动器补偿和聊天房间窄传输口；
 * - 不直接做 DOM 查询，也不自己掌握房间恢复语义；
 * - 这样应用根和聊天内核都只依赖稳定端口，不再继续抱着根目录旧结构。
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
   *
   * 分层缓存路径（spec §8）：
   * 1. 先查本地仓库的严格小于上界 N 条；
   * 2. 命中 ≥ N 条时直接前插内存，不发服务端请求，hasMoreBefore=true（极限下一页可能还有）；
   * 3. 未命中或不足 N 条走服务端取得权威页，服务端返回后异步回写仓库。
   *
   * IDB 异常一律被 catch 为 cache miss（返回空数组），不会阅报错业务路径。
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
    const 上界位置 = oldestMessage.event_position;

    deps.写入阅读状态({
      historyLoading: true,
      historyErrorCode: "",
    });

    try {
      // 第一步：先查本地仓库。IDB 异常被看作 cache miss 而非业务错误。
      const 缓存命中 = await deps.消息仓库
        .读取窗口(state.roomId, {
          上界event_position: 上界位置,
          数量: 历史分页默认页大小,
        })
        .catch(() => [] as 消息事件[]);

      // 本地命中 ≥ 页大小：跳过服务端，直接前插内存。hasMoreBefore 仍为 true，
      // 让下一次上滑可以继续查 IDB / fallback 服务端。
      if (缓存命中.length >= 历史分页默认页大小) {
        deps.接收时间线事实({
          type: "HISTORY_PAGE_APPENDED",
          messages: 缓存命中,
          hasMoreBefore: true,
        });
        deps.写入阅读状态({ historyLoading: false, historyErrorCode: "" });
        if (缓存命中.length > 0) {
          deps.上报历史前插开始?.();
        }
        await deps.roomScroller.应用历史补偿(补偿上下文, 缓存命中.length > 0);
        return;
      }

      // 第二步：未命中或不足走服务端取得权威历史页。
      const page = await deps.withSessionRefreshOnInvalid((sessionId) =>
        deps.transport.loadRoomHistory(
          state.roomId,
          sessionId,
          上界位置,
          历史分页默认页大小
        )
      );
      deps.接收时间线事实({
        type: "HISTORY_PAGE_APPENDED",
        messages: page.messages,
        hasMoreBefore: page.messages.length > 0,
      });
      // 服务端页异步回写 IDB，下次同位置上滑可直接命中。
      if (page.messages.length > 0) {
        const 需回写的页 = page.messages;
        const 需回写的房间 = state.roomId;
        queueMicrotask(() => {
          // 防御：测试/热重载场景下 deps 可能已被回收，跳过即可。
          if (!deps.消息仓库) return;
          void deps.消息仓库.写入(需回写的房间, 需回写的页).catch((错误) => {
            console.warn(
              "[消息分层缓存] HISTORY 回写本地缓存失败（不影响业务）",
              错误
            );
          });
        });
      }
      deps.写入阅读状态({
        historyLoading: false,
        historyErrorCode: "",
      });
      // 历史页是往列表顶部前插的，但守视口不能再只靠 scrollHeight 差值。
      // 新策略优先围绕旧锚点恢复；只有锚点彻底找不回时，才退回高度差值兌底。
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
    取消待刷新已读锚点: cancelPendingReadAnchorFlush,
    取消待跟随最新采样: cancelPendingFollowLatestReadSample,
    dispose,
  };
}
