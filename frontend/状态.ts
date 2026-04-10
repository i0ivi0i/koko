import type { 消息事件 } from "./契约.js";
import type { 首页房间历史条目 } from "./存储.js";
import type { 媒体附件草稿 as 图片附件草稿 } from "./媒体/媒体草稿.js";

/** 房间视口模式只属于前端壳层同步编排，不是后端领域真相。 */
export type 房间视口模式 = "围绕未读阅读" | "贴底跟随" | "离底浏览";

export interface 聊天状态 {
  /** Web 壳本地持久化的设备入口凭证。它不是最终身份真相。 */
  deviceAnonymousToken: string;
  /** 后端权威维护的匿名内部身份。未来注册只允许链接到它。 */
  anonymousIdentityId: string;
  /** 当前展示给用户和其他成员看的花名。 */
  displayAlias: string;
  /** 当前 bootstrap 返回的权威会话锚点；其来源已统一收口到房间编排内核。 */
  sessionId: string;
  /** 当前壳层记住的房间恢复锚点；字段本身仍给壳层消费，但来源改由房间编排内核驱动。 */
  roomId: string;
  /** 当前房间标题只服务壳层展示，具体值统一由房间编排内核外观派生。 */
  roomDisplayTitle: string;
  roomCodeInput: string;
  messageInput: string;
  /** 发送区当前暂存的媒体草稿；当前主链仍先承接图片。 */
  composerImageDrafts: 图片附件草稿[];
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
  /** 当前房间里用户是否已经明确开始过滚动交互。 */
  hasUserScrollIntent: boolean;
  /** 已经通过壳层裁决、等待节流正式提交给后端的阅读位置。 */
  pendingReadAnchorPosition: number | null;
  /**
   * 当前视口模式只回答“壳层现在该怎么解释新消息和滚动”：
   * - `围绕未读阅读`：用户正在从上次未读继续读；
   * - `贴底跟随`：用户已经贴近底部，允许新消息自然跟随；
   * - `离底浏览`：用户在中段浏览历史，新消息不能抢视角。
   */
  viewportMode: 房间视口模式;
  /** 当前壳层观测到的候选已读锚点；真正提交仍要再经过内核裁决。 */
  candidateReadAnchorPosition: number | null;
  /** 用户不在底部时，后续新消息是否已经在当前阅读位置之后继续累积。 */
  hasUnreadNewerMessages: boolean;
  /** 顶部补历史节流截止时间戳。 */
  historyLoadThrottleUntil: number;
  messages: 消息事件[];
  pending: boolean;
  /** 是否正在加载当前最老消息之前的历史页。 */
  historyLoading: boolean;
  /** 最近一次历史分页失败的稳定错误码。 */
  historyErrorCode: string;
  /** 恢复相关的临时状态，只服务壳层交互，且已改为由房间编排内核统一回填。 */
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  /** 最近一次恢复/订阅失败的稳定错误码，供壳层决定提示文案，来源同样收口到房间编排内核。 */
  lastRecoveryErrorCode: string;
  /** 首页只保留本地恢复出来的历史房间锚点，不冒充任何后端会话真相。 */
  homeSessionItems: 首页房间历史条目[];
}

export const 初始聊天状态: 聊天状态 = {
  deviceAnonymousToken: "",
  anonymousIdentityId: "",
  displayAlias: "",
  sessionId: "",
  roomId: "",
  roomDisplayTitle: "",
  roomCodeInput: "",
  messageInput: "",
  composerImageDrafts: [],
  latestEventPosition: 0,
  lastReadEventPosition: null,
  firstUnreadEventPosition: null,
  hasMoreBefore: false,
  initialUnreadSettled: true,
  scrollPhase: "idle",
  hasUserScrollIntent: false,
  pendingReadAnchorPosition: null,
  viewportMode: "离底浏览",
  candidateReadAnchorPosition: null,
  hasUnreadNewerMessages: false,
  historyLoadThrottleUntil: 0,
  messages: [],
  pending: false,
  historyLoading: false,
  historyErrorCode: "",
  recoveryState: "idle",
  lastRecoveryErrorCode: "",
  homeSessionItems: [],
};
