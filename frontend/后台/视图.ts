/**
 * 后台展示 owner 只负责后台概览与详情文案格式化。
 * 它不接手聊天时间线 presenter，也不反向持有房间消息窗展示语义。
 */
export function 格式化后台概览(roomCount: number, messageCount: number): string {
  return `房间 ${roomCount} / 消息 ${messageCount}`;
}

export function 格式化后台房间详情(
  detail:
    | {
        room_id: string;
        latest_event_position: number;
        message_count: number;
      }
    | null
): string {
  if (!detail) {
    return "-";
  }
  return `房间 ${detail.room_id}，位置 ${detail.latest_event_position}，消息 ${detail.message_count}`;
}
