import type { 消息事件 } from "./契约.js";
import type { 房间视口模式 } from "./状态.js";

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

export interface 房间提示文案输入 {
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  roomId: string;
  displayAlias: string;
  historyLoading: boolean;
  historyErrorCode: string;
}

/**
 * 房间头部文案完全属于 presenter：
 * - 优先展示当前最重要的异常或恢复提示；
 * - 没有异常时，再退回到身份辅助信息；
 * - 不把这些优先级规则散落在壳组件里。
 */
export function 派生房间提示文案(input: 房间提示文案输入): {
  recoveryHint: string;
  historyHint: string;
  subtitle: string;
} {
  const recoveryHint = 派生恢复提示文案(input.recoveryState, input.roomId);
  const historyHint = 派生历史提示文案(input.historyLoading, input.historyErrorCode);

  if (recoveryHint) {
    return { recoveryHint, historyHint, subtitle: recoveryHint };
  }
  if (historyHint) {
    return { recoveryHint, historyHint, subtitle: historyHint };
  }
  return {
    recoveryHint,
    historyHint,
    subtitle: input.displayAlias ? `当前匿名身份：${input.displayAlias}` : "群聊房间",
  };
}

function 派生恢复提示文案(
  recoveryState: 房间提示文案输入["recoveryState"],
  roomId: string
): string {
  if (recoveryState === "reconnecting") {
    return "会话已刷新，正在重新恢复";
  }
  if (recoveryState !== "retryable_failure") {
    return "";
  }
  return roomId ? "实时连接暂不可用，可稍后重试" : "恢复失败，可稍后重试";
}

function 派生历史提示文案(historyLoading: boolean, historyErrorCode: string): string {
  if (historyLoading) {
    return "正在加载更早消息";
  }
  if (historyErrorCode) {
    return "更早消息加载失败，可继续上滑重试";
  }
  return "";
}

/**
 * “跳到最新”入口只属于壳层浮动动作。
 * 它的存在条件完全来自前端当前视口语义，不回写任何后端真相。
 */
export function 派生跳到最新入口文案(input: {
  viewportMode: 房间视口模式;
  hasUnreadNewerMessages: boolean;
}): string {
  if (!input.hasUnreadNewerMessages) {
    return "";
  }
  if (input.viewportMode === "贴底跟随") {
    return "";
  }
  return "有新消息，跳到最新";
}
