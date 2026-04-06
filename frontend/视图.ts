import type { 消息事件 } from "./契约.js";

export function 格式化消息(event: 消息事件): string {
  return `[${event.event_position}] ${event.sender_display_alias}: ${event.body}`;
}

export function 格式化后台概览(roomCount: number, messageCount: number): string {
  return `房间 ${roomCount} / 消息 ${messageCount}`;
}
