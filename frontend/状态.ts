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
};
