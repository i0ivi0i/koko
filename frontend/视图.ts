import type { 消息事件 } from "./契约";

export function 格式化消息(event: 消息事件): string {
  return `[${event.event_position}] ${event.sender_session_id}: ${event.body}`;
}
