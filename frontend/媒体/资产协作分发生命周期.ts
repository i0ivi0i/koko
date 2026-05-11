import {
  停止协作分发存活上报,
  清理协作分发底层会话,
} from "./媒体协作分发.js";
import {
  是否为零消费者冷协作分发会话,
  读取协作分发会话活动Reader数量,
  读取协作分发会话生命周期,
} from "./资产协作分发状态机.js";
import type {
  WebTorrentSessionLifecycleState,
  WebTorrentSessionTerminalReason,
  底层协作分发会话,
  资产协作分发上下文,
  资产协作分发运行时内部,
} from "./资产协作分发运行时.js";

const ZERO_REF_PEER_COMPLETION_GRACE_MS = 30_000;

/**
 * 零引用 locallyComplete 保留会话的 LRU 上限。
 *
 * 每个保留会话 = 一个活跃种子 + 60 秒心跳定时器 + torrent metadata 内存。
 * 256 个会话 ≈ 每秒 ~4 次 tracker 心跳，可 24 小时持续运行。
 * 超限时淘汰最早进入零引用态的会话——最久没被前台引用的视频。
 * 有消费者的会话和正在补齐的会话不计入此配额。
 */
export const 零引用完成会话保留上限 = 256;

export const 同步协作分发会话生命周期 = (
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void => {
  if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
    return;
  }
  runtime.actor.send({
    type: "SESSION_LIFECYCLE_CHANGED",
    swarmId: session.swarmId,
    lifecycle: 读取协作分发会话生命周期(session),
  });
};

export const 设置协作分发会话生命周期 = (
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  state: WebTorrentSessionLifecycleState,
  reason?: WebTorrentSessionTerminalReason
): void => {
  session.lifecycleState = state;
  if (reason) {
    session.terminalReason = reason;
  } else {
    delete session.terminalReason;
  }
  同步协作分发会话生命周期(runtime, session);
};

export const 推导协作分发会话当前生命周期 = (
  session: 底层协作分发会话
): WebTorrentSessionLifecycleState => {
  if (读取协作分发会话活动Reader数量(session) > 0) {
    return "heavy_playback";
  }
  if (session.locallyComplete) {
    return "locally_complete";
  }
  if (session.consumerBindings.size === 0 && 协作分发会话可在零引用后保留(session)) {
    return "light_help";
  }
  if (session.file) {
    return "source_ready";
  }
  if (session.torrent) {
    return "swarm_active";
  }
  return session.lifecycleState;
};

export function 协作分发会话可在零引用后保留(session: 底层协作分发会话): boolean {
  return session.eagerCompleting || session.locallyComplete;
}

export function 清除协作分发会话票据续租(session: 底层协作分发会话): void {
  if (!session.joinTicketRefreshTimerId) {
    return;
  }
  clearTimeout(session.joinTicketRefreshTimerId);
  session.joinTicketRefreshTimerId = null;
}

export const 删除底层协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  swarmId: string,
  session: 底层协作分发会话
): void => {
  清除协作分发会话票据续租(session);
  清除零引用补齐保活计时器(session);
  停止协作分发存活上报(session);
  runtime.底层会话表.delete(swarmId);
  清理协作分发底层会话(session);
};

export const 退掉整附件重补齐 = (session: 底层协作分发会话): void => {
  /**
   * zero-ref 轻帮助态不是删会话，而是撤掉 whole-file 重下载链：
   * swarm 身份、join ticket 续租和 presence 可保留，后台重 reader 必须立即退掉。
   */
  session.wholeFileBackfillEnabled = false;
  if (!session.wholeFileSelectApplied) {
    return;
  }
  session.wholeFileSelectApplied = false;
  try {
    session.file?.deselect?.();
  } catch {
    // WebTorrent file 可能已被底层 remove/destroy 置为失效；释放链不能被第三方清理异常打断。
  }
};

export const 清除零引用补齐保活计时器 = (session: 底层协作分发会话): void => {
  if (session.zeroRefCompletionGraceTimerId === null) {
    return;
  }
  clearTimeout(session.zeroRefCompletionGraceTimerId);
  session.zeroRefCompletionGraceTimerId = null;
};

const 零引用未完成会话允许短时保活整附件补齐 = (
  session: 底层协作分发会话
): boolean =>
  session.consumerBindings.size === 0 &&
  !session.locallyComplete &&
  session.eagerCompleting &&
  session.曾收到真实群友字节;

const 安排零引用补齐保活降级 = (
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void => {
  清除零引用补齐保活计时器(session);
  if (!零引用未完成会话允许短时保活整附件补齐(session)) {
    return;
  }
  session.zeroRefCompletionGraceTimerId = setTimeout(() => {
    session.zeroRefCompletionGraceTimerId = null;
    if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
      return;
    }
    if (session.consumerBindings.size > 0 || session.locallyComplete) {
      return;
    }
    退掉整附件重补齐(session);
    停止协作分发存活上报(session);
    session.hint = null;
    session.lifecycleState = 推导协作分发会话当前生命周期(session);
    同步协作分发会话生命周期(runtime, session);
  }, ZERO_REF_PEER_COMPLETION_GRACE_MS);
};

export const 让零引用会话降到轻帮助态 = (
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  options: { allowCompletionGrace?: boolean } = {}
): void => {
  if (!协作分发会话可在零引用后保留(session)) {
    return;
  }
  if (options.allowCompletionGrace && 零引用未完成会话允许短时保活整附件补齐(session)) {
    安排零引用补齐保活降级(runtime, session);
    return;
  }
  清除零引用补齐保活计时器(session);
  退掉整附件重补齐(session);
  if (!session.locallyComplete) {
    停止协作分发存活上报(session);
    session.hint = null;
  }
};

/**
 * 当零引用 locallyComplete 会话数超过 LRU 上限时，淘汰最旧的。
 *
 * "最旧"按 Map 迭代顺序裁决（即插入顺序 = 最早创建的会话）。
 * 只淘汰零消费者且已完成的会话；正在补齐中或有消费者的会话不动。
 * 这条链路保证：最近被用户引用过的视频继续满血做种帮助群友。
 */
export const 淘汰超限零引用完成会话 = (
  runtime: 资产协作分发运行时内部
): void => {
  /** 先收集符合淘汰条件的 swarmId（按 Map 插入序 = 最旧在前）。 */
  const candidates: string[] = [];
  for (const [swarmId, session] of runtime.底层会话表) {
    if (
      session.consumerBindings.size === 0 &&
      session.locallyComplete
    ) {
      candidates.push(swarmId);
    }
  }
  if (candidates.length <= 零引用完成会话保留上限) {
    return;
  }
  /** 只淘汰超出部分，从最旧开始。 */
  const excess = candidates.length - 零引用完成会话保留上限;
  for (let i = 0; i < excess; i++) {
    const swarmId = candidates[i]!;
    const session = runtime.底层会话表.get(swarmId);
    if (!session) {
      continue;
    }
    删除底层协作分发会话(runtime, swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId,
      });
    }
  }
};

export const 按生命周期策略清理协作分发会话 = (
  runtime: 资产协作分发运行时内部,
  heavyWorkPolicy: 资产协作分发上下文["heavyWorkPolicy"]
): void => {
  if (heavyWorkPolicy === "normal") {
    return;
  }
  for (const [swarmId, session] of runtime.底层会话表) {
    if (session.consumerBindings.size === 0) {
      让零引用会话降到轻帮助态(runtime, session, {
        allowCompletionGrace: false,
      });
    }
    if (!是否为零消费者冷协作分发会话(session)) {
      continue;
    }
    删除底层协作分发会话(runtime, swarmId, session);
    if (!runtime.已销毁) {
      runtime.actor.send({
        type: "SESSION_DROPPED",
        swarmId,
      });
    }
  }
};
