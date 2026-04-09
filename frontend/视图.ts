import type { 消息事件 } from "./契约.js";
import type { 首页房间历史条目 } from "./存储.js";
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
export type 壳主舞台模式 = "boot" | "home" | "room";
export type 控制台模式 = "hidden" | "join" | "message";

export interface 首页会话展示项 {
  roomId: string;
  roomCode: string;
  title: string;
  meta: string;
}

export interface 操作台槽位配置 {
  visible: boolean;
  disabled: boolean;
  label: string;
}

export interface 操作台主输入配置 {
  value: string;
  placeholder: string;
  enterKeyHint: "go" | "send" | "done";
  disabled: boolean;
}

/**
 * 这是壳层 presenter，不是新的业务真状态。
 * 它只回答一个问题：唯一操作台此刻该如何表现。
 */
export interface 壳级操作台状态 {
  mode: 控制台模式;
  statusText: string;
  statusAttention: boolean;
  auxSlot: 操作台槽位配置;
  primaryInput: 操作台主输入配置;
  primaryAction: 操作台槽位配置;
}

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

/**
 * 主舞台模式只由恢复阶段和当前房间锚点派生。
 * 它是壳层的只读语义，不允许回写成第二份真状态。
 */
export function 派生壳主舞台模式(input: {
  bootstrapState: "booting" | "ready";
  roomId: string;
}): 壳主舞台模式 {
  if (input.bootstrapState === "booting") {
    return "boot";
  }
  return input.roomId ? "room" : "home";
}

/**
 * 控制台模式同样只回答“当前应该展示哪种输入语义”，
 * 不能演化成和 `roomId/bootstrapState` 脱节的可写状态。
 */
export function 派生控制台模式(input: {
  bootstrapState: "booting" | "ready";
  roomId: string;
}): 控制台模式 {
  if (input.bootstrapState === "booting") {
    return "hidden";
  }
  return input.roomId ? "message" : "join";
}

/**
 * 唯一操作台的显示语义统一从这里派生：
 * - `hidden` 表示操作台实体常驻，但主输入和主动作暂时冻结；
 * - `join` / `message` 只切输入值来源、placeholder、主按钮文案与禁用态；
 * - 这层不拥有第二份真状态，只翻译壳层当前上下文。
 */
export function 派生壳级操作台状态(input: {
  consoleMode: 控制台模式;
  roomCodeInput: string;
  messageInput: string;
  pending: boolean;
  statusText: string;
  statusAttention?: boolean;
}): 壳级操作台状态 {
  const baseState = {
    statusText: input.statusText,
    statusAttention: Boolean(input.statusAttention),
    auxSlot: {
      visible: false,
      disabled: true,
      label: "",
    },
  } satisfies Pick<壳级操作台状态, "statusText" | "statusAttention" | "auxSlot">;

  if (input.consoleMode === "hidden") {
    return {
      mode: "hidden",
      ...baseState,
      primaryInput: {
        value: "",
        placeholder: "房间短码",
        enterKeyHint: "done",
        disabled: true,
      },
      primaryAction: {
        visible: true,
        disabled: true,
        label: "进房",
      },
    };
  }

  if (input.consoleMode === "message") {
    return {
      mode: "message",
      ...baseState,
      primaryInput: {
        value: input.messageInput,
        placeholder: "输入消息",
        enterKeyHint: "send",
        disabled: false,
      },
      primaryAction: {
        visible: true,
        disabled: input.pending,
        label: "发送",
      },
    };
  }

  return {
    mode: "join",
    ...baseState,
    primaryInput: {
      value: input.roomCodeInput,
      placeholder: "房间短码",
      enterKeyHint: "go",
      disabled: false,
    },
    primaryAction: {
      visible: true,
      disabled: false,
      label: "进房",
    },
  };
}

/**
 * 首页会话列表只是历史房间锚点的展示模型：
 * - `title` 收口主标题；
 * - `meta` 收口辅助时间文案；
 * - presenter 负责把原始条目翻译成模板真正消费的形状。
 */
export function 派生首页会话展示项(
  items: 首页房间历史条目[]
): 首页会话展示项[] {
  return items.map((item) => ({
    roomId: item.roomId,
    roomCode: item.roomCode,
    title: item.roomCode || item.roomId,
    meta: `最近进入: ${new Date(item.lastEnteredAt).toLocaleString("zh-CN")}`,
  }));
}

export interface 房间壳提示文案输入 {
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  roomId: string;
  displayAlias: string;
}

export interface 消息窗口提示文案输入 {
  historyLoading: boolean;
  historyErrorCode: string;
}

/**
 * 房间壳只承接“整个房间页都该知道”的稳定提示：
 * - 优先展示当前最重要的异常或恢复提示；
 * - 没有异常时，再退回到身份辅助信息。
 *
 * 历史分页只属于消息窗口局部体验，不允许继续从这里泄漏到头部或底部操作台。
 */
export function 派生房间壳提示文案(input: 房间壳提示文案输入): {
  recoveryHint: string;
  subtitle: string;
} {
  const recoveryHint = 派生恢复提示文案(input.recoveryState, input.roomId);
  if (recoveryHint) {
    return { recoveryHint, subtitle: recoveryHint };
  }
  return {
    recoveryHint,
    subtitle: input.displayAlias ? `当前匿名身份：${input.displayAlias}` : "群聊房间",
  };
}

/**
 * 历史分页提示严格收口在消息窗口内部：
 * - 这里只翻译局部“更早消息加载中/失败”文案；
 * - 不让调用方再把这类局部态抬升成整页级提示。
 */
export function 派生消息窗口提示文案(input: 消息窗口提示文案输入): {
  historyHint: string;
} {
  return {
    historyHint: 派生历史提示文案(input.historyLoading, input.historyErrorCode),
  };
}

function 派生恢复提示文案(
  recoveryState: 房间壳提示文案输入["recoveryState"],
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
