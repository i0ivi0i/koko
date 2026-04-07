import type { 消息事件 } from "./契约.js";

export interface 聊天状态 {
  /** Web 壳本地持久化的设备入口凭证。它不是最终身份真相。 */
  deviceAnonymousToken: string;
  /** 后端权威维护的匿名内部身份。未来注册只允许链接到它。 */
  anonymousIdentityId: string;
  /** 当前展示给用户和其他成员看的花名。 */
  displayAlias: string;
  /** 当前 bootstrap 返回的权威会话锚点。恢复流程只能使用这一份。 */
  sessionId: string;
  /** 当前壳层记住的房间恢复锚点。它不是成员资格真相。 */
  roomId: string;
  roomCodeInput: string;
  messageInput: string;
  latestEventPosition: number;
  /** 当前身份上次已读到的事件位置；`null` 表示还没有阅读锚点。 */
  lastReadEventPosition: number | null;
  /** 当前首屏里的第一条未读位置；用于后续未读分隔条与首屏定位。 */
  firstUnreadEventPosition: number | null;
  /** 首屏上方是否仍然存在更早历史。 */
  hasMoreBefore: boolean;
  /** 首屏未读定位是否已经稳定完成，避免恢复早期误推进已读。 */
  initialUnreadSettled: boolean;
  /**
   * 当前滚动来源只属于壳层瞬时编排：
   * - `restoring_unread` 表示程序正在把首屏落到第一条未读附近；
   * - `compensating_history` 表示程序正在为顶部前插历史补偿视口；
   * - `idle` 才允许把滚动解释成用户真实阅读。
   */
  scrollPhase: "idle" | "restoring_unread" | "compensating_history";
  /** 等待节流上报的阅读位置；只属于壳层瞬时状态。 */
  pendingReadAnchorPosition: number | null;
  /** 顶部补历史节流截止时间戳。 */
  historyLoadThrottleUntil: number;
  messages: 消息事件[];
  pending: boolean;
  /** 是否正在加载当前最老消息之前的历史页。 */
  historyLoading: boolean;
  /** 最近一次历史分页失败的稳定错误码。 */
  historyErrorCode: string;
  /** 恢复相关的临时状态，只服务壳层交互，不是共享契约事实。 */
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  /** 最近一次恢复/订阅失败的稳定错误码，供壳层决定提示文案。 */
  lastRecoveryErrorCode: string;
}

export const 初始聊天状态: 聊天状态 = {
  deviceAnonymousToken: "",
  anonymousIdentityId: "",
  displayAlias: "",
  sessionId: "",
  roomId: "",
  roomCodeInput: "",
  messageInput: "",
  latestEventPosition: 0,
  lastReadEventPosition: null,
  firstUnreadEventPosition: null,
  hasMoreBefore: false,
  initialUnreadSettled: true,
  scrollPhase: "idle",
  pendingReadAnchorPosition: null,
  historyLoadThrottleUntil: 0,
  messages: [],
  pending: false,
  historyLoading: false,
  historyErrorCode: "",
  recoveryState: "idle",
  lastRecoveryErrorCode: "",
};
