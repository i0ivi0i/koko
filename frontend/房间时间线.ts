import type { 消息事件 } from "./契约.js";

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
 * 房间时间线是消息合流唯一 owner：
 * - snapshot / history / realtime / reconnect 都只给它消息事实；
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
  switch (input.type) {
    case "SNAPSHOT":
      return 合并房间时间线消息(input.messages);
    case "HISTORY":
      return 合并房间时间线消息([...input.messages, ...current]);
    case "REALTIME":
      return 合并房间时间线消息([...current, ...input.events]);
    case "OPTIMISTIC":
      return 合并房间时间线消息([...current, input.message]);
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
    body: input.text,
    attachments: [],
    event_position: input.latestEventPosition + 1,
  };
}
