import type { 消息事件 } from "../聊天共享/契约.js";

/**
 * 内存窗口上限：任意写入合流后，messages 数组长度不允许超过此值。
 *
 * 设计来由（spec §9，分层缓存的内存恒定承诺）：
 * - 24h 单房间持续推送下，messages 数组若无上限会无界增长，是当前
 *   项目唯一被识别出的资源累积点（heap / GC / scroll jank 的根因）；
 * - viewport 中心 ±1500 是 IM 业务上对"前后文连续性"的最大期望，
 *   取 3000 作保留尾部，足以覆盖跳到最新后向上回滚 1500 屏的体验；
 * - 余量 500 给短暂越界（如多条历史前插一帧合流、多事件同帧到达）
 *   提供缓冲，避免每拍都做 slice。
 */
export const 内存窗口上限 = 3500;

/**
 * 触发裁剪后保留的尾部消息条数。
 *
 * 一律保留尾部（最新 N 条）而非中间或头部，因为：
 * - IM 默认 viewport 锚定在底部（业务热区）；
 * - 头部历史在 IndexedDB 持久化，用户上滑可重新拉；
 * - 中间裁剪会破坏可见连续性，不可取。
 */
export const 内存窗口保留尾部 = 3000;

/**
 * 应用内存窗口裁剪到时间线段。
 *
 * 仅在 messages.length 超过 `内存窗口上限` 时才动数组（slice 是 O(K)）。
 * 没越界时直接返回原引用，对热路径不产生额外拷贝成本。
 */
function 应用内存窗口裁剪(messages: 消息事件[]): 消息事件[] {
  if (messages.length <= 内存窗口上限) {
    return messages;
  }
  return messages.slice(messages.length - 内存窗口保留尾部);
}

export type 创建乐观房间消息输入 = {
  roomId: string;
  sessionId: string;
  displayAlias: string;
  clientMessageId: string;
  text: string;
  latestEventPosition: number;
};

const 是本地乐观消息 = (message: 消息事件): boolean =>
  message.message_id.startsWith("local-");

const 选择更可信消息 = (current: 消息事件, candidate: 消息事件): 消息事件 => {
  const currentIsOptimistic = 是本地乐观消息(current);
  const candidateIsOptimistic = 是本地乐观消息(candidate);
  if (currentIsOptimistic !== candidateIsOptimistic) {
    return currentIsOptimistic ? candidate : current;
  }
  if (current.event_position !== candidate.event_position) {
    return current.event_position > candidate.event_position ? current : candidate;
  }
  return candidate;
};

export type 时间线输入 =
  | { type: "SNAPSHOT"; messages: 消息事件[] }
  | { type: "HISTORY"; messages: 消息事件[] }
  | { type: "REALTIME"; events: 消息事件[] }
  | { type: "OPTIMISTIC"; message: 消息事件 };

/**
 * 时间线领域 owner 只承接消息事实合流：
 * - snapshot / history / realtime / optimistic 都只给它消息事实；
 * - 它只按 client_message_id、message_id 和 event_position 收敛；
 * - 它不认识 socket、DOM、虚拟列表或房间恢复流程。
 */
function 合并房间时间线消息(messages: 消息事件[]): 消息事件[] {
  const sorted = [...messages].sort((left, right) => left.event_position - right.event_position);
  const byClientMessageId = new Map<string, 消息事件>();
  const authoritativeByMessageId = new Map<string, 消息事件>();

  // 第一层按 client_message_id 收敛，本地乐观态会在权威消息回来时被替换。
  for (const message of sorted) {
    const existing = byClientMessageId.get(message.client_message_id);
    byClientMessageId.set(
      message.client_message_id,
      existing ? 选择更可信消息(existing, message) : message
    );
  }

  // 第二层按权威 message_id 收敛，处理快照、历史页、实时增量重复送同一条消息。
  for (const message of byClientMessageId.values()) {
    if (是本地乐观消息(message)) {
      continue;
    }
    const existing = authoritativeByMessageId.get(message.message_id);
    authoritativeByMessageId.set(
      message.message_id,
      existing ? 选择更可信消息(existing, message) : message
    );
  }

  const out: 消息事件[] = [];
  const seenMessageIds = new Set<string>();
  for (const message of byClientMessageId.values()) {
    if (是本地乐观消息(message)) {
      out.push(message);
      continue;
    }
    if (seenMessageIds.has(message.message_id)) {
      continue;
    }
    seenMessageIds.add(message.message_id);
    out.push(authoritativeByMessageId.get(message.message_id)!);
  }

  return out.sort((left, right) => left.event_position - right.event_position);
}

/**
 * 时间线 owner 对外只接收“事实输入”：
 * - SNAPSHOT：权威首屏基线，重建当前时间线
 * - HISTORY：更早历史页，向前补齐
 * - REALTIME：权威实时事件，向后合流
 * - OPTIMISTIC：本地待确认消息，占位但不伪造权威事实
 *
 * 外层模块不再直接拼 `state.messages`，这样恢复、实时、历史分页都只负责上报事实。
 */
export function 推进房间时间线(
  current: 消息事件[],
  input: 时间线输入
): 消息事件[] {
  // 先按各分支语义合流，再统一过裁剪闸门：
  // 1. 任何写路径合流后都会被 `应用内存窗口裁剪` 收口，保证 messages.length ≤ 上限；
  // 2. 没越界时裁剪是 O(1) 直通（直接 return 原数组）；
  // 3. 越界时 slice 保留尾部 3000 条，是 O(K) 一次性成本。
  switch (input.type) {
    case "SNAPSHOT":
      return 应用内存窗口裁剪(合并房间时间线消息(input.messages));
    case "HISTORY":
      return 应用内存窗口裁剪(合并房间时间线消息([...input.messages, ...current]));
    case "REALTIME":
      return 应用内存窗口裁剪(合并房间时间线消息([...current, ...input.events]));
    case "OPTIMISTIC":
      return 应用内存窗口裁剪(合并房间时间线消息([...current, input.message]));
  }
}

export function 创建乐观房间消息(input: 创建乐观房间消息输入): 消息事件 {
  return {
    type: "message_created",
    room_id: input.roomId,
    message_id: `local-${input.clientMessageId}`,
    client_message_id: input.clientMessageId,
    sender_session_id: input.sessionId,
    sender_display_alias: input.displayAlias,
    text: input.text,
    attachments: [],
    event_position: input.latestEventPosition + 1,
  };
}
