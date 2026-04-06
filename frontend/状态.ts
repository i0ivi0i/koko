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
  messages: 消息事件[];
  pending: boolean;
  /** 是否正在加载当前最老消息之前的历史页。 */
  historyLoading: boolean;
  /** 是否已经明确没有更早历史了。 */
  historyReachedStart: boolean;
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
  messages: [],
  pending: false,
  historyLoading: false,
  historyReachedStart: false,
  historyErrorCode: "",
  recoveryState: "idle",
  lastRecoveryErrorCode: "",
};
