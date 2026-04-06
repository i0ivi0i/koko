import type { 消息事件 } from "./契约.js";

export interface 消息展示项 {
  kind: "message";
  id: string;
  owner: "mine" | "other";
  body: string;
  senderDisplayAlias: string;
  showAlias: boolean;
  eventPosition: number;
}

export interface 未读分隔展示项 {
  kind: "unread-divider";
  id: "unread-divider";
  label: "未读消息";
}

export type 聊天列表展示项 = 消息展示项 | 未读分隔展示项;

const 未读分隔标识 = "unread-divider" as const;

/**
 * 壳层展示列表派生：
 * 1. 消息展示项仍然只来自权威事件；
 * 2. 未读分隔条只是本地展示项，不是领域事件；
 * 3. 分隔条位置由后端裁决的 `firstUnreadEventPosition` 驱动，前端不自己猜。
 */
export function 派生聊天列表展示项(
  messages: 消息事件[],
  currentSessionId: string,
  firstUnreadEventPosition: number | null
): 聊天列表展示项[] {
  const items: 聊天列表展示项[] = [];
  let unreadDividerInserted = false;

  for (const message of messages) {
    if (
      !unreadDividerInserted &&
      firstUnreadEventPosition !== null &&
      message.event_position === firstUnreadEventPosition
    ) {
      items.push({
        kind: "unread-divider",
        id: 未读分隔标识,
        label: "未读消息",
      });
      unreadDividerInserted = true;
    }
    items.push(派生消息展示项(message, currentSessionId));
  }

  return items;
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
    kind: "message",
    id: event.message_id,
    owner: isMine ? "mine" : "other",
    body: event.body,
    senderDisplayAlias: event.sender_display_alias,
    showAlias: !isMine,
    eventPosition: event.event_position,
  };
}

export function 格式化后台概览(roomCount: number, messageCount: number): string {
  return `房间 ${roomCount} / 消息 ${messageCount}`;
}
