import type { 消息事件 } from "./契约.js";
import type { 首页房间历史条目 } from "./存储.js";
import type { 媒体附件草稿 } from "./媒体/媒体草稿.js";

/** 房间视口模式只属于前端壳层同步编排，不是后端领域真相。 */
export type 房间视口模式 = "围绕未读阅读" | "贴底跟随" | "离底浏览";

/**
 * 会话 slice 只保存浏览器端自己必须长期记住、但又不属于房间时间线的事实。
 * 这里故意不重复保存 `roomId/sessionId/displayAlias` 这类已经由 room kernel 派生的字段。
 */
export interface 聊天会话状态 {
  /** Web 壳本地持久化的设备入口凭证。它不是最终身份真相。 */
  deviceAnonymousToken: string;
  /** 后端权威维护的匿名内部身份。未来注册只允许链接到它。 */
  anonymousIdentityId: string;
  /** 首页只保留本地恢复出来的历史房间锚点，不冒充任何后端会话真相。 */
  homeSessionItems: 首页房间历史条目[];
}

/**
 * 输入 slice 只保存壳层当前可编辑的本地体验态。
 * 它不负责房间是否存在，也不负责消息是否最终成立。
 */
export interface 聊天输入状态 {
  roomCodeInput: string;
  messageInput: string;
  /** 发送区当前暂存的媒体草稿，是壳层唯一允许持有的附件体验态。 */
  composerMediaDrafts: 媒体附件草稿[];
}

/**
 * 时间线 slice 只保存房间消息本身和历史分页相关的本地状态。
 * 任何 snapshot / history / realtime 合流都必须经由这一块收口。
 */
export interface 聊天时间线状态 {
  messages: 消息事件[];
  /** 首屏上方是否仍然存在更早历史。 */
  hasMoreBefore: boolean;
  /** 是否正在加载当前最老消息之前的历史页。 */
  historyLoading: boolean;
  /** 最近一次历史分页失败的稳定错误码。 */
  historyErrorCode: string;
}

/**
 * 阅读 / 视口 slice 只保存滚动与已读推进协作需要的本地状态。
 * DOM 观测仍然来自滚动器，但真正的阅读推进节奏只在这里落地。
 */
export interface 聊天视口状态 {
  /** 当前身份上次已读到的事件位置；`null` 表示还没有阅读锚点。 */
  lastReadEventPosition: number | null;
  /** 当前首屏里的第一条未读位置；用于后续未读分隔条与首屏定位。 */
  firstUnreadEventPosition: number | null;
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
  /** 顶部补历史节流截止时间戳。 */
  historyLoadThrottleUntil: number;
}

/**
 * 流程 slice 只保存“当前房间动作是否进行中”这类短生命周期流程位。
 * 它不表达业务成功，只表达壳层需要展示的临时忙闲状态。
 */
export interface 聊天流程状态 {
  pending: boolean;
}

/**
 * `聊天状态` 现在只保留给壳层快照和测试支架使用。
 * 真正的 owner 不应再拿整份大对象直接共写，而是只消费自己负责的 slice。
 */
export interface 聊天状态
  extends 聊天会话状态,
    聊天输入状态,
    聊天时间线状态,
    聊天视口状态,
    聊天流程状态 {
  /** 当前展示给用户和其他成员看的花名。 */
  displayAlias: string;
  /** 当前 bootstrap 返回的权威会话锚点；其来源已统一收口到房间编排内核。 */
  sessionId: string;
  /** 当前壳层记住的房间恢复锚点；字段本身仍给壳层消费，但来源改由房间编排内核驱动。 */
  roomId: string;
  /** 当前房间标题只服务壳层展示，具体值统一由房间编排内核外观派生。 */
  roomDisplayTitle: string;
  latestEventPosition: number;
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
  /** 恢复相关的临时状态，只服务壳层交互，且已改为由房间编排内核统一回填。 */
  recoveryState: "idle" | "retryable_failure" | "reconnecting";
  /** 最近一次恢复/订阅失败的稳定错误码，供壳层决定提示文案，来源同样收口到房间编排内核。 */
  lastRecoveryErrorCode: string;
}

export const 初始聊天会话状态: 聊天会话状态 = {
  deviceAnonymousToken: "",
  anonymousIdentityId: "",
  homeSessionItems: [],
};

export const 初始聊天输入状态: 聊天输入状态 = {
  roomCodeInput: "",
  messageInput: "",
  composerMediaDrafts: [],
};

export const 初始聊天时间线状态: 聊天时间线状态 = {
  messages: [],
  hasMoreBefore: false,
  historyLoading: false,
  historyErrorCode: "",
};

export const 初始聊天视口状态: 聊天视口状态 = {
  lastReadEventPosition: null,
  firstUnreadEventPosition: null,
  initialUnreadSettled: true,
  scrollPhase: "idle",
  hasUserScrollIntent: false,
  pendingReadAnchorPosition: null,
  historyLoadThrottleUntil: 0,
};

export const 初始聊天流程状态: 聊天流程状态 = {
  pending: false,
};

export const 初始聊天状态: 聊天状态 = {
  ...初始聊天会话状态,
  ...初始聊天输入状态,
  ...初始聊天时间线状态,
  ...初始聊天视口状态,
  ...初始聊天流程状态,
  displayAlias: "",
  sessionId: "",
  roomId: "",
  roomDisplayTitle: "",
  latestEventPosition: 0,
  viewportMode: "离底浏览",
  candidateReadAnchorPosition: null,
  hasUnreadNewerMessages: false,
  recoveryState: "idle",
  lastRecoveryErrorCode: "",
};
