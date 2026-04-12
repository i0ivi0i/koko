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

/**
 * 房间时间线是消息合流唯一 owner：
 * - snapshot / history / realtime / reconnect 都只给它消息事实；
 * - 它只按 client_message_id、message_id 和 event_position 收敛；
 * - 它不认识 socket、DOM、虚拟列表或房间恢复流程。
 */
export function 合并房间时间线消息(messages: 消息事件[]): 消息事件[] {
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
