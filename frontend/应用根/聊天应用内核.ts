import {
  创建房间内核,
  派生房间壳外观,
  type 房间内核事件,
  type 房间壳外观,
} from "../房间/运行时.js";
import {
  创建聊天内核平台桥接,
  type 聊天内核平台端口,
} from "./聊天应用编排桥接.js";
import { 聊天应用编排协调器 } from "./聊天应用编排协调器.js";
import {
  type 房间滚动观测,
  type 房间滚动器依赖,
  type 房间滚动器宿主,
} from "../时间线/滚动器.js";
import { 创建房间滚动应用 } from "../时间线/应用.js";
import {
  获取默认浏览器应用平台,
  type 浏览器应用平台,
} from "../平台/index.js";
import {
  type 媒体传输端口,
  type 聊天实时连接端口,
  type 聊天房间传输端口,
  type 前端传输端口,
} from "../平台/传输.js";
import type { 前端存储端口 } from "../平台/存储.js";
import {
  初始聊天运行时状态,
  初始聊天会话状态,
  初始聊天时间线状态,
  初始聊天流程状态,
  初始聊天视口状态,
  初始聊天输入状态,
  type 聊天会话状态,
  type 聊天时间线状态,
  type 聊天流程状态,
  type 聊天运行时预算状态,
  type 聊天运行时状态,
  type 聊天状态,
  type 聊天视口状态,
  type 聊天输入状态,
} from "./聊天状态.js";
import {
  投影房间壳补丁,
  投影聊天基础快照,
  投影聊天运行时预算,
  type 房间壳补丁,
} from "./聊天内核状态投影.js";
import {
  type 平台桥接命令,
} from "./聊天内核平台运行时.js";
import { 处理权威新消息平台副作用 } from "./聊天内核通知副作用.js";
import { 创建IndexedDB消息仓库 } from "../聊天本地缓存/IndexedDB消息仓库.js";
import type { 消息仓库端口 } from "../聊天本地缓存/消息仓库端口.js";
import type { 附件状态变更事件 } from "../聊天共享/契约.js";
import { 时间线事实派发到本地缓存 } from "./时间线事实派发到本地缓存.js";
import { 创建应用生命周期Actor } from "../平台/应用生命周期.js";
import {
  创建房间视口Actor,
  投影视口快照到聊天视口状态,
} from "../时间线/视口运行时.js";
import {
  创建房间时间线Actor,
  投影时间线快照到聊天时间线状态,
  type 房间时间线事件,
} from "../时间线/运行时.js";
import {
  创建实时会话Actor,
  type 实时会话事件,
  type 实时会话快照,
} from "../实时/会话运行时.js";
import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器.js";
import {
  type 媒体播放会话快照,
  type 媒体播放会话应用端口,
} from "../媒体/播放会话/应用.js";
import {
  创建聊天应用本地状态协调器,
  type 聊天应用本地状态协调器,
} from "./聊天应用本地状态协调器.js";
import { 创建聊天应用编排协调器依赖 } from "./聊天应用编排依赖工厂.js";
import { 创建聊天应用媒体编排 } from "./聊天应用媒体编排工厂.js";
import { 处理聊天应用命令 } from "./聊天应用命令路由.js";
import { 执行聊天房间视图退场 } from "./聊天房间视图退场.js";
import { 处理聊天内核平台桥接命令 } from "./聊天内核平台运行时.js";

export type 聊天应用快照 = 聊天状态 & {
  bootstrapState: 房间壳外观["bootstrapState"];
  media: 媒体播放会话快照;
};

export type 聊天应用命令 =
  | { type: "BOOTSTRAP_REQUESTED" }
  | { type: "ROOM_CODE_INPUT_CHANGED"; value: string }
  | { type: "MESSAGE_INPUT_CHANGED"; value: string }
  | { type: "JOIN_ROOM_REQUESTED"; roomCode?: string }
  | { type: "JOIN_HISTORY_ROOM_REQUESTED"; roomCode: string }
  | { type: "LEAVE_ROOM_VIEW_REQUESTED" }
  | { type: "SEND_MESSAGE_REQUESTED" }
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED" }
  | { type: "ROOM_MEDIA_WINDOW_OBSERVED"; attachmentIds: string[] }
  | { type: "MEDIA_INLINE_AUTOPLAY_OBSERVED"; candidates: 消息视频自动播候选[] }
  | {
      type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED";
      attachmentId: string;
      position: 媒体播放位置;
    }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED"; request: 媒体查看器打开请求 }
  | { type: "MEDIA_SESSION_SIGNALLED"; attachmentId: string; signal: 媒体会话信号 }
  | { type: "MEDIA_FILES_SELECTED"; files: Iterable<File> }
  | { type: "MEDIA_DRAFT_REMOVE_REQUESTED"; localId: string }
  | { type: "MEDIA_DRAFT_RESUME_REQUESTED"; localId: string }
  | { type: "MEDIA_DRAFT_RESTART_REQUESTED"; localId: string }
  | 平台桥接命令;

interface 聊天应用渲染桥 {
  /**
   * 内核只能表达“需要刷新”与“等待刷新完成”这两个渲染事实。
   * 它不再直接持有 Lit host，避免把壳层实例整包倒灌进业务编排。
   */
  请求重渲染(): void;
  等待壳渲染完成(): Promise<void>;
}

export interface 聊天应用内核依赖 {
  渲染桥: 聊天应用渲染桥;
  滚动宿主: 房间滚动器宿主;
  platform?: 浏览器应用平台;
  transport?: 前端传输端口;
  storage?: 前端存储端口;
  查询滚动容器(): HTMLElement | null;
  查询消息节点(): HTMLElement[];
  清理房间视图本地状态?(input: { previewUrls: string[] }): void;
}

export interface 聊天应用内核端口 {
  snapshot(): 聊天应用快照;
  dispatch(command: 聊天应用命令): Promise<void>;
  dispose(): void;
}

type 聊天视口调试状态 = Pick<
  聊天应用快照,
  | "lastReadEventPosition"
  | "firstUnreadEventPosition"
  | "initialUnreadSettled"
  | "scrollPhase"
  | "hasUserScrollIntent"
  | "pendingReadAnchorPosition"
  | "historyLoadThrottleUntil"
  | "viewportMode"
>;

class 聊天应用内核 implements 聊天应用内核端口 {
  private readonly deps: 聊天应用内核依赖;
  private readonly 平台桥接: 聊天内核平台端口;

  /**
   * 房间阶段机仍然是聊天内核里唯一的房间编排真相。
   * 壳层之后只能消费这里回填出的快照，不再自己摸状态机。
   */
  private readonly roomKernel = 创建房间内核();

  /**
   * 聊天主链本地状态现在按职责拆成六个 slice：
   * - 会话：浏览器端恢复锚点；
   * - 输入：草稿与输入框；
   * - 时间线：消息数组与历史分页；
   * - 视口：已读与滚动协作；
   * - 流程：短生命周期忙闲位。
   * - 运行时：浏览器生命周期/在线状态/更新待接管。
   *
   * room/session 继续从 room kernel 派生；
   * 视口模式、未读新增标记、候选已读锚点改由 RoomViewportActor 投影，
   * 不再让 room kernel 和滚动/阅读链路各写一份。
   */
  private readonly appLifecycle = 创建应用生命周期Actor();
  private readonly roomViewport = 创建房间视口Actor();
  private readonly roomTimeline = 创建房间时间线Actor();
  private readonly realtimeSession = 创建实时会话Actor();
  private 会话状态: 聊天会话状态;
  private 输入状态: 聊天输入状态;
  private 时间线状态: 聊天时间线状态;
  private 视口状态: 聊天视口状态;
  private 流程状态: 聊天流程状态;
  private 运行时状态: 聊天运行时状态;

  /**
   * transport / storage 继续属于聊天内核依赖，
   * 但这里已经收成 recovery / realtime / media 三条窄 transport。
   * 壳层不再直接 new / 持有这些浏览器适配器。
   */
  private 房间传输: 聊天房间传输端口;
  private 实时连接: 聊天实时连接端口;
  private 媒体传输: 媒体传输端口;
  private storage: 前端存储端口;
  /**
   * 聊天本地缓存 application port。
   *
   * 装配点仅此一处，避免多处重复 new IndexedDB 连接；底层 adapter 在 IDB 不可用时
   * 自动返回空仓库。该字段是 readonly，仅在 adapter / port 完全重写时才考虑调整。
   */
  private readonly 消息仓库: 消息仓库端口 = 创建IndexedDB消息仓库();
  private readonly 媒体编排: 媒体播放会话应用端口;
  private readonly 状态协调器: 聊天应用本地状态协调器;
  private readonly 执行平台桥接命令: (command: 平台桥接命令) => Promise<void>;
  private readonly 执行房间视图退场: (
    opts?: { keepRoomCodeCache: boolean }
  ) => void;

  /**
   * 恢复专用补锚标记仍只属于阅读/滚动协作链路。
   * 它不是聊天室业务真相，所以继续留在聊天应用内核内部，不往壳层外冒。
   */
  private shouldPrimeReadAnchorAfterInitialSettle = false;
  private readonly 编排协调器: 聊天应用编排协调器;

  /**
   * 视口 owner 需要 DOM 查询能力，但 owner 本身仍属于聊天应用内核。
   * 这样浏览器滚动信号就先收进内核，再由阅读推进编排消费，不再让壳层横穿业务边界。
   */
  private readonly roomScroller: ReturnType<typeof 创建房间滚动应用>;
  readonly dispatch: 聊天应用内核端口["dispatch"];

  constructor(deps: 聊天应用内核依赖) {
    this.deps = deps;
    const rawPlatform = deps.platform ?? 获取默认浏览器应用平台();
    this.平台桥接 = 创建聊天内核平台桥接(rawPlatform);
    const transport = deps.transport;
    this.房间传输 = transport ?? this.平台桥接.聊天房间传输();
    this.实时连接 = transport ?? this.平台桥接.聊天实时连接();
    this.媒体传输 = transport ?? this.平台桥接.媒体传输();
    this.storage = deps.storage ?? this.平台桥接.壳层记忆();
    this.会话状态 = { ...初始聊天会话状态 };
    this.输入状态 = { ...初始聊天输入状态 };
    this.时间线状态 = { ...初始聊天时间线状态 };
    this.视口状态 = { ...初始聊天视口状态 };
    this.流程状态 = { ...初始聊天流程状态 };
    this.运行时状态 = {
      ...初始聊天运行时状态,
      runtimeBudget: { ...初始聊天运行时状态.runtimeBudget },
    };
    this.状态协调器 = 创建聊天应用本地状态协调器({
      读取状态箱: () => ({
        会话状态: this.会话状态,
        输入状态: this.输入状态,
        时间线状态: this.时间线状态,
        视口状态: this.视口状态,
        流程状态: this.流程状态,
        运行时状态: this.运行时状态,
      }),
      写回状态箱: (next) => {
        if (next.会话状态) {
          this.会话状态 = next.会话状态;
        }
        if (next.输入状态) {
          this.输入状态 = next.输入状态;
        }
        if (next.时间线状态) {
          this.时间线状态 = next.时间线状态;
        }
        if (next.视口状态) {
          this.视口状态 = next.视口状态;
        }
        if (next.流程状态) {
          this.流程状态 = next.流程状态;
        }
        if (next.运行时状态) {
          this.运行时状态 = next.运行时状态;
        }
      },
      读取房间壳补丁: () => this.回填房间壳补丁(),
      同步消息附件播放结果: () => this.媒体编排.同步消息附件播放结果(),
      请求重渲染: () => this.deps.渲染桥.请求重渲染(),
      发送恢复基线同步: (firstUnreadEventPosition) => {
        this.roomViewport.send({
          type: "SNAPSHOT_BASELINE_SYNCED",
          firstUnreadEventPosition,
        });
      },
      同步房间视口快照: () => this.同步房间视口快照(),
    });
    this.同步房间视口快照();
    this.roomScroller = 创建房间滚动应用(deps.滚动宿主, {
      读取状态: () => this.读取滚动观察状态(),
      查询滚动容器: () => deps.查询滚动容器(),
      查询消息节点: () => deps.查询消息节点(),
      上报滚动观测: (observation) => this.处理房间滚动观测(observation),
      读取是否需要恢复补锚: () => this.shouldPrimeReadAnchorAfterInitialSettle,
      消耗恢复补锚标记: () => {
        this.shouldPrimeReadAnchorAfterInitialSettle = false;
      },
      报告首屏稳定完成: (mode) => this.处理首屏定位稳定完成(mode),
      报告历史补偿程序滚动已稳定: () => {
        this.roomViewport.send({
          type: "PROGRAMMATIC_SCROLL_FINISHED",
          reason: "compensate_history",
        });
        this.同步房间视口快照();
      },
      报告恢复补锚候选: (position) => {
        this.编排协调器.接收候选已读位置(position);
      },
    });
    this.执行房间视图退场 = (opts) => {
      执行聊天房间视图退场(
        {
          清除当前房间标识: () => this.storage.清除当前房间标识(),
          清除当前房间短码: () => this.storage.清除当前房间短码(),
          重置编排端口: () => this.编排协调器.重置端口(),
          取消挂起滚动副作用: () => this.roomScroller.取消挂起滚动副作用(),
          写入恢复补锚标记: (value) => {
            this.shouldPrimeReadAnchorAfterInitialSettle = value;
          },
          清空媒体编排: () => this.媒体编排.清空(),
          重置时间线房间视图: () => {
            this.roomTimeline.send({ type: "ROOM_SOFT_RESET" });
          },
          同步房间时间线快照: () => this.同步房间时间线快照(),
          标记房间视图已退出: () => {
            this.roomViewport.send({ type: "ROOM_VIEW_EXITED" });
          },
          写入本地状态: (patch) => {
            this.状态协调器.写入本地状态(patch);
          },
          同步房间视口快照: () => this.同步房间视口快照(),
        },
        opts
      );
    };
    this.编排协调器 = new 聊天应用编排协调器(
      创建聊天应用编排协调器依赖({
        读取消息仓库: () => this.消息仓库,
        状态协调器: this.状态协调器,
        接收时间线事实: (event) => this.接收时间线事实(event),
        接收实时会话事实: (event) => this.接收实时会话事实(event),
        读取房间传输: () => this.房间传输,
        读取实时传输: () => this.实时连接,
        storage: this.storage,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
        },
        roomScroller: this.roomScroller,
        ensureRealtimeSocket: (sessionId) => this.编排协调器.ensureRealtimeSocket(sessionId),
        subscribeRoom: (from) => this.编排协调器.subscribeRoom(from),
        取消待刷新已读锚点: () => this.编排协调器.取消待刷新已读锚点(),
        取消待跟随最新采样: () => this.编排协调器.取消待跟随最新采样(),
        exitCurrentRoomView: (opts) => this.执行房间视图退场(opts),
        disconnectRealtime: () => this.编排协调器.disconnectRealtime(),
        写入恢复补锚标记: (value) => {
          this.shouldPrimeReadAnchorAfterInitialSettle = value;
        },
        等待壳渲染完成: async () => {
          await this.deps.渲染桥.等待壳渲染完成();
        },
        上报Transport异常: async (error) => {
          await this.编排协调器.接收Transport异常(error);
        },
        处理恢复失败: (error, keepRoomVisible) => {
          this.编排协调器.处理恢复失败(error, keepRoomVisible);
        },
        跟随最新消息追加后刷新视口: async () => {
          await this.编排协调器.接收Realtime追加后跟随();
        },
        接收权威事件后副作用: (events) => {
          performance.mark?.("room_event_received");
          this.roomViewport.send({ type: "AUTHORITATIVE_EVENTS_APPENDED" });
          this.同步房间视口快照();
          const currentSessionId = this.回填房间壳补丁().sessionId;
          // 权威事件到达即触发 locator 预热，比 viewport sync 早 50-200ms
          this.媒体编排.预热权威消息媒体分发(events, currentSessionId);
          处理权威新消息平台副作用({
            events,
            currentSessionId,
            平台桥接: this.平台桥接,
          });
        },
        接收附件升级后副作用: (event) => {
          this.预热附件升级媒体分发(event);
        },
        登记待补发任务: async (task) => {
          return (await this.平台桥接.登记待补发任务?.(task)) ?? false;
        },
        请求后台补发同步: async (tag) => {
          return (await this.平台桥接.请求后台补发同步?.(tag)) ?? false;
        },
        读取当前时间: () => Date.now(),
        上报历史前插开始: () => {
          this.roomViewport.send({
            type: "PROGRAMMATIC_SCROLL_STARTED",
            reason: "compensate_history",
          });
          this.同步房间视口快照();
        },
        withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
          this.编排协调器.withSessionRefreshOnInvalid(operation),
        排空到期任务: this.平台桥接.排空到期任务,
      })
    );
    this.媒体编排 = 创建聊天应用媒体编排({
      读取媒体传输: () => this.媒体传输,
      读取会话编号: () => this.回填房间壳补丁().sessionId,
      读取当前房间标识: () => this.回填房间壳补丁().roomId || null,
      读取消息: () => this.时间线状态.messages,
      读取草稿: () => this.输入状态.composerMediaDrafts,
      写入媒体选择中过渡计数: (count) => {
        this.状态协调器.写入本地状态({ mediaSelectionPendingCount: count });
      },
      平台扩展: this.平台桥接,
      写入草稿列表: (nextDrafts) => {
        this.状态协调器.写入本地状态({ composerMediaDrafts: nextDrafts });
      },
      请求重渲染: () => {
        this.deps.渲染桥.请求重渲染();
      },
      回收媒体草稿预览地址: (previewUrls) => {
        this.deps.清理房间视图本地状态?.({ previewUrls });
      },
      登记程序滚动来源: (source) => {
        this.roomScroller.登记程序滚动来源(source);
      },
      清除程序滚动来源: (source) => {
        this.roomScroller.清除程序滚动来源(source);
      },
    });
    this.执行平台桥接命令 = async (command) => {
      await 处理聊天内核平台桥接命令(command, {
        appLifecycle: this.appLifecycle,
        媒体编排: this.媒体编排,
        读取运行时预算: () => this.运行时状态.runtimeBudget,
        写入本地状态: (patch) => {
          this.状态协调器.写入本地状态(patch);
        },
        接收实时会话事实: (event) => {
          this.接收实时会话事实(event);
        },
        // 页面隐藏 / 冻结时走 lifecycle 路径主动刷仓库 buffer。
        flush消息仓库: () => this.flush仓库(),
      });
    };
    this.dispatch = async (command) => {
      await 处理聊天应用命令(command, {
        编排协调器: this.编排协调器,
        媒体编排: this.媒体编排,
        roomScroller: this.roomScroller,
        roomViewport: this.roomViewport,
        读取媒体草稿: () => this.输入状态.composerMediaDrafts,
        读取媒体选择中过渡计数: () => this.输入状态.mediaSelectionPendingCount,
        写入房间号输入: (value) => {
          this.状态协调器.写入本地状态({ roomCodeInput: value });
        },
        写入消息输入: (value) => {
          this.状态协调器.写入本地状态({ messageInput: value });
        },
        标记用户滚动意图: () => this.标记用户滚动意图(),
        同步房间视口快照: () => this.同步房间视口快照(),
        处理平台桥接命令: async (platformCommand) => {
          await this.执行平台桥接命令(platformCommand);
        },
        leaveCurrentRoomView: () => this.leaveCurrentRoomView(),
      });
    };
  }

  snapshot(): 聊天应用快照 {
    return {
      ...this.读取聊天基础快照(),
      media: this.媒体编排.snapshot(),
    };
  }

  切换传输端口(transport: 前端传输端口): void {
    this.编排协调器.重置端口();
    this.房间传输 = transport;
    this.实时连接 = transport;
    this.媒体传输 = transport;
    this.媒体编排.清空();
  }

  /**
   * dispose 时主动 flush 消息仓库 buffer，避免推出应用丢失 100ms 内未落盘数据。
   *
   * 页面隐藏 / 冻结阶段的 flush 走 `处理聊天内核平台桥接命令` 里的
   * `flush消息仓库` 依赖。这里只负责 dispose 路径，不直接听浏览器生命周期事件。
   */
  private readonly flush仓库 = (): void => {
    void this.消息仓库.flush().catch(() => {
      /* dispose 阶段任何异常都吃掉 */
    });
  };

  dispose(): void {
    this.编排协调器.dispose();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.媒体编排.销毁();
    this.realtimeSession.stop();
    this.roomTimeline.stop();
    this.roomViewport.stop();
    this.appLifecycle.stop();
    // 显式 dispose 时补刷一次，作为页面隐藏路径以外的兑底。
    this.flush仓库();
  }

  private 标记用户滚动意图(): void {
    this.roomScroller.标记用户滚动意图();
    this.roomViewport.send({ type: "USER_SCROLL_INTENT_STARTED" });
    this.同步房间视口快照();
  }

  /**
   * DOM 观测先到这里，再由 RoomViewportActor 决定：
   * - 这次候选已读要不要接收；
   * - 当前是否该切回贴底跟随；
   * - 顶部触达是否真的允许触发历史分页。
   */
  private 处理房间滚动观测(observation: 房间滚动观测): void {
    this.roomViewport.send({
      type: "SCROLL_OBSERVED",
      ...observation,
      canLoadHistory: this.时间线状态.hasMoreBefore && !this.时间线状态.historyLoading,
      now: Date.now(),
    });
    const beforeCandidate = this.视口状态.candidateReadAnchorPosition;
    const snapshot = this.roomViewport.snapshot();
    this.同步房间视口快照();
    if (
      snapshot.candidateReadAnchorPosition !== null &&
      snapshot.candidateReadAnchorPosition !== beforeCandidate
    ) {
      this.编排协调器.接收候选已读位置(snapshot.candidateReadAnchorPosition);
    }
    if (snapshot.shouldLoadHistory) {
      this.roomViewport.send({ type: "HISTORY_LOAD_CONSUMED" });
      this.同步房间视口快照();
      void this.编排协调器.请求加载更早历史();
    }
  }

  private 处理首屏定位稳定完成(mode: 聊天状态["viewportMode"]): void {
    this.roomViewport.send({
      type: "INITIAL_UNREAD_SETTLED",
      firstUnreadEventPosition: this.视口状态.firstUnreadEventPosition,
    });
    this.同步房间视口快照();
    void mode;
    this.编排协调器.接收首屏稳定完成();
  }

  private 同步房间视口快照(): void {
    this.状态协调器.写入本地状态(
      投影视口快照到聊天视口状态(this.roomViewport.snapshot())
    );
  }

  读取房间滚动器调试接口(): ReturnType<typeof 创建房间滚动应用> {
    return this.roomScroller;
  }

  /**
   * Task 6 之后只保留“视口局部调试态”这一条窄测试缝：
   * - 不再允许整包快照补丁；
   * - 只允许搭建滚动/未读恢复这类难以纯 DOM 构造的极端视口场景；
   * - 房间壳派生状态仍然要翻成真实 room event，而不是直接改房间真相。
   */
  应用视口调试补丁(patch: Partial<聊天视口调试状态>): void {
    this.状态协调器.写入本地状态(patch);
    const nextFirstUnreadEventPosition =
      Object.hasOwn(patch, "firstUnreadEventPosition")
        ? patch.firstUnreadEventPosition ?? null
        : this.视口状态.firstUnreadEventPosition;
    if (
      Object.hasOwn(patch, "initialUnreadSettled") &&
      patch.initialUnreadSettled === false
    ) {
      this.roomViewport.send({
        type: "SNAPSHOT_BASELINE_SYNCED",
        firstUnreadEventPosition: nextFirstUnreadEventPosition,
      });
    }
    if (patch.hasUserScrollIntent) {
      this.roomViewport.send({ type: "USER_SCROLL_INTENT_STARTED" });
    }
    if (patch.scrollPhase === "restoring_unread") {
      this.roomViewport.send({
        type: "PROGRAMMATIC_SCROLL_STARTED",
        reason: "restore_unread",
      });
    }
    if (patch.scrollPhase === "compensating_history") {
      this.roomViewport.send({
        type: "PROGRAMMATIC_SCROLL_STARTED",
        reason: "compensate_history",
      });
    }
    if (patch.viewportMode === "贴底跟随") {
      this.roomViewport.send({ type: "JUMP_TO_LATEST_REQUESTED" });
    }
    if (patch.initialUnreadSettled === true) {
      this.roomViewport.send({
        type: "INITIAL_UNREAD_SETTLED",
        firstUnreadEventPosition: nextFirstUnreadEventPosition,
      });
    }
    this.同步房间视口快照();
  }

  /**
   * 时间线合流规则继续只允许走这一条入口。
   * 恢复 / realtime / 历史分页只能上报事实，不能各自在外面拼 messages 数组。
   *
   * 分层缓存派发（spec §7.3）：
   * - 在 actor 同步快照后，派发函数决定是否要镜像到本地缓存；
   * - 仅 REALTIME 事件触发镜像（其他类型在各自路径已写或不该写）；
   * - 派发本身是 fire-and-forget，不阻塞业务编排。
   */
  private 接收时间线事实(event: 房间时间线事件): void {
    const baselineLatestEventPosition = this.回填房间壳补丁().latestEventPosition;
    this.roomTimeline.send(event);
    this.同步房间时间线快照();
    时间线事实派发到本地缓存({
      event,
      roomId: this.回填房间壳补丁().roomId,
      消息仓库: this.消息仓库,
    });
    const snapshot = this.roomTimeline.getSnapshot().context;
    if (snapshot.latestEventPosition !== baselineLatestEventPosition) {
      this.发送房间事件({
        type: "LATEST_EVENT_ADVANCED",
        latestEventPosition: snapshot.latestEventPosition,
      });
    }
  }

  private 预热附件升级媒体分发(event: 附件状态变更事件): void {
    const attachment = event.attachment;
    if (event.status !== "ready" || !attachment?.distribution_hint) {
      return;
    }
    this.媒体编排.预热附件分发线索(
      [attachment],
      this.回填房间壳补丁().sessionId
    );
  }

  private 接收实时会话事实(event: 实时会话事件): void {
    const before = this.realtimeSession.getSnapshot();
    this.realtimeSession.send(event);
    void this.处理实时会话变化(before);
  }

  private async 处理实时会话变化(
    before: 实时会话快照 = this.realtimeSession.getSnapshot()
  ): Promise<void> {
    const snapshot = this.realtimeSession.getSnapshot();
    const beforeContext = before.context;
    const nextContext = snapshot.context;

    if (
      nextContext.needsResubscribe &&
      !beforeContext.needsResubscribe &&
      nextContext.resubscribeMode === "visible" &&
      nextContext.roomId &&
      nextContext.sessionId
    ) {
      this.发送房间事件({
        type: "RECONNECTING_STARTED",
        code: nextContext.lastDisconnectCode || "reconnect",
      });
    }

    await this.编排协调器.处理实时会话变化(before, snapshot);

    if (nextContext.backgroundDrainPending && !beforeContext.backgroundDrainPending) {
      this.realtimeSession.send({ type: "BACKGROUND_DRAIN_FINISHED" });
    }
  }

  private 同步房间时间线快照(): void {
    const snapshot = this.roomTimeline.getSnapshot();
    this.状态协调器.写入本地状态(投影时间线快照到聊天时间线状态(snapshot));
  }

  private 读取聊天基础快照(): Omit<聊天应用快照, "media"> {
    return 投影聊天基础快照({
      会话状态: this.会话状态,
      输入状态: this.输入状态,
      时间线状态: this.时间线状态,
      视口状态: this.视口状态,
      流程状态: this.流程状态,
      运行时状态: this.运行时状态,
      runtimeBudget: this.读取当前运行时预算(),
      房间壳: this.回填房间壳补丁(),
    });
  }

  private 读取当前运行时预算(): 聊天运行时预算状态 {
    return 投影聊天运行时预算({
      运行时状态: this.运行时状态,
      媒体预算: this.媒体编排.读取预算(),
      updatePendingDurationMs: this.appLifecycle.snapshot().updatePendingDurationMs,
    });
  }

  private 读取滚动观察状态(): ReturnType<房间滚动器依赖["读取状态"]> {
    const 房间壳 = this.回填房间壳补丁();
    return {
      roomId: 房间壳.roomId,
      firstUnreadEventPosition: this.视口状态.firstUnreadEventPosition,
      initialUnreadSettled: this.视口状态.initialUnreadSettled,
      scrollPhase: this.视口状态.scrollPhase,
      historyLoading: this.时间线状态.historyLoading,
      hasMoreBefore: this.时间线状态.hasMoreBefore,
      hasUserScrollIntent: this.视口状态.hasUserScrollIntent,
      historyLoadThrottleUntil: this.视口状态.historyLoadThrottleUntil,
    };
  }

  /**
   * 房间壳派生字段全部来自 room kernel。
   * 因此只要发了房间事件，就必须顺手请求一次壳层重渲染，不能再指望别的本地 patch 帮它“顺带刷新”。
   */
  private 发送房间事件(event: 房间内核事件): void {
    const realtimeBefore = this.realtimeSession.getSnapshot();
    const 当前房间壳 = 派生房间壳外观(this.roomKernel.getSnapshot());
    if (event.type === "SNAPSHOT_LOADED") {
      this.realtimeSession.send({
        type: "CONNECT_REQUESTED",
        roomId: event.roomId,
        sessionId: 当前房间壳.sessionId,
        latestEventPosition: event.latestEventPosition,
      });
    } else if (event.type === "SESSION_REFRESHED" && 当前房间壳.roomId) {
      this.realtimeSession.send({
        type: "CONNECT_REQUESTED",
        roomId: 当前房间壳.roomId,
        sessionId: event.sessionId,
        latestEventPosition: 当前房间壳.latestEventPosition,
      });
    } else if (event.type === "SUBSCRIPTION_ESTABLISHED") {
      this.realtimeSession.send({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: event.latestEventPosition,
      });
    } else if (event.type === "SOFT_LEAVE_REQUESTED") {
      this.realtimeSession.send({ type: "ROOM_VIEW_EXITED" });
    }
    this.roomKernel.send(event);
    this.deps.渲染桥.请求重渲染();
    void this.处理实时会话变化(realtimeBefore);
  }

  private 回填房间壳补丁(): 房间壳补丁 {
    return 投影房间壳补丁(派生房间壳外观(this.roomKernel.getSnapshot()));
  }

  private leaveCurrentRoomView(): void {
    this.发送房间事件({ type: "SOFT_LEAVE_REQUESTED" });
    this.执行房间视图退场({ keepRoomCodeCache: true });
  }

}

export function 创建聊天应用内核(deps: 聊天应用内核依赖): 聊天应用内核端口 {
  return new 聊天应用内核(deps);
}

