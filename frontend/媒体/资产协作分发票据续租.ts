import {
  协作分发定位片段需要JoinTicket,
  读取可用协作分发片段,
} from "./媒体协作分发.js";
import { 清除协作分发会话票据续租 } from "./资产协作分发生命周期.js";
import type {
  协作分发JoinTicket刷新器,
  协作分发定位片段,
  底层协作分发会话,
  资产协作分发运行时内部,
} from "./资产协作分发运行时.js";

const JOIN_TICKET_REFRESH_SAFETY_MS = 5_000;
const JOIN_TICKET_REFRESH_RETRY_MS = 5_000;
const JOIN_TICKET_REFRESH_MIN_DELAY_MS = 1_000;

function 读取JoinTicket过期时间(distribution: 协作分发定位片段): number | null {
  if (!distribution.join_ticket || !distribution.ticket_expires_at) {
    return null;
  }
  const expiresAt = Date.parse(distribution.ticket_expires_at);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function 安排协作分发会话票据续租重试(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): void {
  清除协作分发会话票据续租(session);
  if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
    return;
  }
  session.joinTicketRefreshTimerId = setTimeout(() => {
    session.joinTicketRefreshTimerId = null;
    void 执行协作分发会话票据续租(runtime, session);
  }, JOIN_TICKET_REFRESH_RETRY_MS);
}

export function 安排协作分发会话票据续租(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话,
  distribution: 协作分发定位片段
): void {
  清除协作分发会话票据续租(session);
  if (!session.refreshJoinTicket) {
    return;
  }
  const expiresAt = 读取JoinTicket过期时间(distribution);
  if (!expiresAt) {
    return;
  }
  /**
   * 续租计时器属于 WebTorrent 会话 owner：
   * 它只更新 tracker 门禁票据，不改变媒体资产身份，也不直接碰 transport。
   */
  const refreshDelayMs = Math.max(
    JOIN_TICKET_REFRESH_MIN_DELAY_MS,
    expiresAt - Date.now() - JOIN_TICKET_REFRESH_SAFETY_MS
  );
  session.joinTicketRefreshTimerId = setTimeout(() => {
    session.joinTicketRefreshTimerId = null;
    void 执行协作分发会话票据续租(runtime, session);
  }, refreshDelayMs);
}

export function 刷新协作分发会话票据(
  session: 底层协作分发会话,
  distribution: 协作分发定位片段
): boolean {
  if (协作分发定位片段需要JoinTicket(distribution) && !distribution.join_ticket) {
    /**
     * 缺票 locator 不能覆盖会话里仍可用的旧票；缺票只说明本次续租失败，应低频重试。
     */
    return false;
  }
  session.joinTicketRef.value = distribution.join_ticket ?? null;
  return true;
}

async function 执行协作分发会话票据续租(
  runtime: 资产协作分发运行时内部,
  session: 底层协作分发会话
): Promise<void> {
  if (
    runtime.已销毁 ||
    session.joinTicketRefreshInFlight ||
    runtime.底层会话表.get(session.swarmId) !== session
  ) {
    return;
  }
  const refreshJoinTicket = session.refreshJoinTicket;
  if (!refreshJoinTicket) {
    return;
  }
  session.joinTicketRefreshInFlight = true;
  try {
    const locator = await refreshJoinTicket({
      attachmentId: session.joinTicketAttachmentId,
      swarmId: session.swarmId,
      torrentInfoHash: session.torrentInfoHash,
    });
    if (runtime.已销毁 || runtime.底层会话表.get(session.swarmId) !== session) {
      return;
    }
    const distribution = locator ? 读取可用协作分发片段(locator) : null;
    if (
      !distribution ||
      distribution.swarm_id !== session.swarmId ||
      distribution.torrent_info_hash !== session.torrentInfoHash
    ) {
      安排协作分发会话票据续租重试(runtime, session);
      return;
    }
    if (刷新协作分发会话票据(session, distribution)) {
      安排协作分发会话票据续租(runtime, session, distribution);
    } else {
      安排协作分发会话票据续租重试(runtime, session);
    }
  } catch {
    if (!runtime.已销毁 && runtime.底层会话表.get(session.swarmId) === session) {
      安排协作分发会话票据续租重试(runtime, session);
    }
  } finally {
    session.joinTicketRefreshInFlight = false;
  }
}

export function 更新协作分发会话票据刷新器(
  session: 底层协作分发会话,
  refreshJoinTicket?: 协作分发JoinTicket刷新器
): void {
  if (refreshJoinTicket) {
    session.refreshJoinTicket = refreshJoinTicket;
  }
}
