import type { 消息事件 } from "./契约.js";

export interface 消息展示项 {
  id: string;
  owner: "mine" | "other";
  body: string;
  senderDisplayAlias: string;
  showAlias: boolean;
}

/**
 * 壳层只基于稳定事实派生展示模型：
 * - sender_session_id 是否等于当前 session_id，决定左右分边；
 * - event_position 继续留在同步层，不进入普通聊天主视图。
 */
export function 派生消息展示项(
  event: 消息事件,
  currentSessionId: string
): 消息展示项 {
  const isMine = event.sender_session_id === currentSessionId;
  return {
    id: event.message_id,
    owner: isMine ? "mine" : "other",
    body: event.body,
    senderDisplayAlias: event.sender_display_alias,
    showAlias: !isMine,
  };
}

export function 格式化后台概览(roomCount: number, messageCount: number): string {
  return `房间 ${roomCount} / 消息 ${messageCount}`;
}
