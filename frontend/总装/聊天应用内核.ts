import {
  创建房间内核,
  派生房间壳外观,
  type 房间内核事件,
  type 房间壳外观,
} from "../房间/运行时.js";
import {
  type 房间恢复编排依赖,
} from "../恢复/壳层/房间恢复编排.js";
import {
  type 房间实时编排依赖,
} from "../实时/应用.js";
import {
  type 阅读推进编排依赖,
} from "../房间/壳层/阅读推进.js";
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
import {
  处理历史房间进房请求,
  处理房间号输入变更,
  处理进房请求,
} from "../房间/应用.js";
import { 创建房间滚动应用 } from "../时间线/应用.js";
import { 处理发送消息请求, 处理消息输入变更 } from "../输入框/应用.js";
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
  投影恢复编排状态,
  投影实时编排状态,
  投影聊天基础快照,
  投影聊天运行时预算,
  投影阅读推进状态,
  type 房间壳补丁,
} from "./聊天内核状态投影.js";
import {
  处理聊天内核平台桥接命令,
  type 平台桥接命令,
} from "./聊天内核平台运行时.js";
import { 处理权威新消息平台副作用 } from "./聊天内核通知副作用.js";
import {
  应用聊天本地状态折叠,
  type 聊天本地状态补丁,
} from "./聊天本地状态折叠.js";
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
import {
  type 消息视频自动播候选,
  type 媒体会话信号,
  type 媒体播放位置,
  type 媒体查看器打开请求,
} from "../媒体/index.js";
import {
  创建媒体播放会话应用,
  type 媒体播放会话快照,
  type 媒体播放会话应用端口,
} from "../媒体/播放会话/应用.js";

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
  setTransportForTest(transport: 前端传输端口): void;
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
  private readonly 媒体编排: 媒体播放会话应用端口;

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
    this.编排协调器 = new 聊天应用编排协调器({
      创建恢复编排依赖: () => ({
        读取恢复状态: () => this.读取恢复状态快照(),
        写入恢复状态: (patch) => this.写入恢复状态补丁(patch),
        接收时间线事实: (event) => this.接收时间线事实(event),
        transport: this.房间传输,
        storage: this.storage,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
        },
        roomScroller: this.roomScroller,
        ensureRealtimeSocket: (sessionId) => this.编排协调器.ensureRealtimeSocket(sessionId),
        subscribeRoom: (from) => this.编排协调器.subscribeRoom(from),
        取消待刷新已读锚点: () => this.编排协调器.取消待刷新已读锚点(),
        取消待跟随最新采样: () => this.编排协调器.取消待跟随最新采样(),
        exitCurrentRoomView: (opts) => this.exitCurrentRoomView(opts),
        disconnectRealtime: () => this.编排协调器.disconnectRealtime(),
        写入恢复补锚标记: (value) => {
          this.shouldPrimeReadAnchorAfterInitialSettle = value;
        },
        等待壳渲染完成: async () => {
          await this.deps.渲染桥.等待壳渲染完成();
        },
      }),
      创建实时编排依赖: () => ({
        读取实时状态: () => this.读取实时状态快照(),
        写入实时状态: (patch) => this.写入实时状态补丁(patch),
        接收时间线事实: (event) => this.接收时间线事实(event),
        接收实时会话事实: (event) => this.接收实时会话事实(event),
        transport: this.实时连接,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
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
          this.roomViewport.send({ type: "AUTHORITATIVE_EVENTS_APPENDED" });
          this.同步房间视口快照();
          处理权威新消息平台副作用({
            events,
            currentSessionId: this.回填房间壳补丁().sessionId,
            平台桥接: this.平台桥接,
          });
        },
        登记待补发任务: async (task) => {
          return (await this.平台桥接.登记待补发任务?.(task)) ?? false;
        },
        请求后台补发同步: async (tag) => {
          return (await this.平台桥接.请求后台补发同步?.(tag)) ?? false;
        },
        读取当前时间: () => Date.now(),
      }),
      创建阅读推进依赖: () => ({
        读取阅读状态: () => this.读取阅读状态快照(),
        写入阅读状态: (patch) => this.写入阅读状态补丁(patch),
        接收时间线事实: (event) => this.接收时间线事实(event),
        transport: this.房间传输,
        上报历史前插开始: () => {
          this.roomViewport.send({
            type: "PROGRAMMATIC_SCROLL_STARTED",
            reason: "compensate_history",
          });
          this.同步房间视口快照();
        },
        roomScroller: this.roomScroller,
        withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
          this.编排协调器.withSessionRefreshOnInvalid(operation),
        等待壳渲染完成: async () => {
          await this.deps.渲染桥.等待壳渲染完成();
        },
        滚到最新位置: () => this.roomScroller.滚到最新位置(),
      }),
      排空到期任务: this.平台桥接.排空到期任务,
    });
    this.媒体编排 = 创建媒体播放会话应用({
      transport: () => this.媒体传输,
      读取会话编号: () => this.回填房间壳补丁().sessionId,
      读取当前房间标识: () => this.回填房间壳补丁().roomId || null,
      读取消息: () => this.时间线状态.messages,
      读取草稿: () => this.输入状态.composerMediaDrafts,
      ...(this.平台桥接.媒体资产仓库
        ? { 媒体缓存仓库: this.平台桥接.媒体资产仓库() }
        : {}),
      ...(this.平台桥接.媒体定位仓库
        ? { 媒体定位仓库: this.平台桥接.媒体定位仓库() }
        : {}),
      ...(this.平台桥接.视频预览仓库
        ? { 预览缓存: this.平台桥接.视频预览仓库() }
        : {}),
      写入草稿列表: (nextDrafts) => {
        this.应用本地状态折叠({ composerMediaDrafts: nextDrafts });
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
  }

  snapshot(): 聊天应用快照 {
    return {
      ...this.读取聊天基础快照(),
      media: this.媒体编排.snapshot(),
    };
  }

  async dispatch(command: 聊天应用命令): Promise<void> {
    switch (command.type) {
      case "BOOTSTRAP_REQUESTED":
        await this.编排协调器.bootstrap();
        return;
      case "ROOM_CODE_INPUT_CHANGED":
        处理房间号输入变更({
          value: command.value,
          写入房间号输入: (value) => {
            this.应用本地状态折叠({ roomCodeInput: value });
          },
        });
        return;
      case "MESSAGE_INPUT_CHANGED":
        处理消息输入变更({
          value: command.value,
          写入消息输入: (value) => {
            this.应用本地状态折叠({ messageInput: value });
          },
        });
        return;
      case "JOIN_ROOM_REQUESTED":
        await 处理进房请求({
          roomCode: command.roomCode,
          写入房间号输入: (value) => {
            this.应用本地状态折叠({ roomCodeInput: value });
          },
          触发进房: () => this.编排协调器.joinRoom(),
        });
        return;
      case "JOIN_HISTORY_ROOM_REQUESTED":
        await 处理历史房间进房请求({
          roomCode: command.roomCode,
          写入房间号输入: (value) => {
            this.应用本地状态折叠({ roomCodeInput: value });
          },
          触发进房: () => this.编排协调器.joinRoom(),
        });
        return;
      case "LEAVE_ROOM_VIEW_REQUESTED":
        this.leaveCurrentRoomView();
        return;
      case "SEND_MESSAGE_REQUESTED":
        await 处理发送消息请求({
          读取媒体草稿: () => this.输入状态.composerMediaDrafts,
          触发发送: () => this.编排协调器.sendMessage(),
          清空媒体草稿: () => this.媒体编排.清空草稿(),
        });
        return;
      case "ROOM_SCROLL_INTENT":
        this.标记用户滚动意图();
        return;
      case "ROOM_SCROLL_OBSERVED":
        this.roomScroller.处理滚动事件();
        return;
      case "ROOM_MEDIA_WINDOW_OBSERVED":
        this.媒体编排.同步媒体窗口附件(command.attachmentIds);
        return;
      case "MEDIA_INLINE_AUTOPLAY_OBSERVED":
        this.媒体编排.处理自动播候选(command.candidates);
        return;
      case "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED":
        this.媒体编排.更新媒体播放位置({
          attachmentId: command.attachmentId,
          position: command.position,
        });
        return;
      case "ROOM_JUMP_TO_LATEST_REQUESTED":
        this.roomViewport.send({ type: "JUMP_TO_LATEST_REQUESTED" });
        this.同步房间视口快照();
        await this.编排协调器.请求跳到最新();
        return;
      case "MEDIA_OPEN_REQUESTED":
        this.媒体编排.打开查看器(command.request);
        return;
      case "MEDIA_SESSION_SIGNALLED":
        this.媒体编排.处理媒体会话信号(command.attachmentId, command.signal);
        return;
      case "MEDIA_FILES_SELECTED":
        await this.媒体编排.处理选择媒体文件(command.files);
        return;
      case "MEDIA_DRAFT_REMOVE_REQUESTED":
        this.媒体编排.移除媒体草稿(command.localId);
        return;
      case "MEDIA_DRAFT_RESUME_REQUESTED":
        await this.媒体编排.继续上传媒体草稿(command.localId);
        return;
      case "MEDIA_DRAFT_RESTART_REQUESTED":
        await this.媒体编排.重新上传媒体草稿(command.localId);
        return;
      case "PLATFORM_LIFECYCLE_CHANGED":
      case "PLATFORM_SERVICE_WORKER_UPDATE_READY":
      case "PLATFORM_SERVICE_WORKER_CONTROLLER_READY":
      case "PLATFORM_CACHE_UPDATE_CHANGED":
      case "PLATFORM_BACKGROUND_DRAIN_REQUESTED":
      case "PLATFORM_OFFLINE_STATUS_CHANGED":
        await this.处理平台桥接命令(command);
        return;
    }
  }

  setTransportForTest(transport: 前端传输端口): void {
    this.编排协调器.重置端口();
    this.房间传输 = transport;
    this.实时连接 = transport;
    this.媒体传输 = transport;
    this.媒体编排.清空();
  }

  dispose(): void {
    this.编排协调器.dispose();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.媒体编排.销毁();
    this.realtimeSession.stop();
    this.roomTimeline.stop();
    this.roomViewport.stop();
    this.appLifecycle.stop();
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
    this.应用本地状态折叠(投影视口快照到聊天视口状态(this.roomViewport.snapshot()));
  }

  读取房间滚动器供测试(): ReturnType<typeof 创建房间滚动应用> {
    return this.roomScroller;
  }

  /**
   * Task 6 之后只保留“视口局部调试态”这一条窄测试缝：
   * - 不再允许整包快照补丁；
   * - 只允许搭建滚动/未读恢复这类难以纯 DOM 构造的极端视口场景；
   * - 房间壳派生状态仍然要翻成真实 room event，而不是直接改房间真相。
   */
  写入视口调试状态供测试(patch: Partial<聊天视口调试状态>): void {
    this.应用本地状态折叠(patch);
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

  private async 处理平台桥接命令(command: 平台桥接命令): Promise<void> {
    await 处理聊天内核平台桥接命令(command, {
      appLifecycle: this.appLifecycle,
      媒体编排: this.媒体编排,
      读取运行时预算: () => this.运行时状态.runtimeBudget,
      写入本地状态: (patch) => {
        this.应用本地状态折叠(patch);
      },
      接收实时会话事实: (event) => {
        this.接收实时会话事实(event);
      },
    });
  }

  /**
   * 时间线合流规则继续只允许走这一条入口。
   * 恢复 / realtime / 历史分页只能上报事实，不能各自在外面拼 messages 数组。
   */
  private 接收时间线事实(event: 房间时间线事件): void {
    const baselineLatestEventPosition = this.回填房间壳补丁().latestEventPosition;
    this.roomTimeline.send(event);
    this.同步房间时间线快照();
    const snapshot = this.roomTimeline.getSnapshot().context;
    if (snapshot.latestEventPosition !== baselineLatestEventPosition) {
      this.发送房间事件({
        type: "LATEST_EVENT_ADVANCED",
        latestEventPosition: snapshot.latestEventPosition,
      });
    }
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
    this.应用本地状态折叠(投影时间线快照到聊天时间线状态(snapshot));
  }

  /**
   * 本地 slice 写入口只负责聊天内核自己拥有的状态。
   * room kernel 派生字段不会在这里落地，避免重新长回“共享大状态 + 多处 patch”。
   */
  private 应用本地状态折叠(patch: 聊天本地状态补丁): boolean {
    const 结果 = 应用聊天本地状态折叠(
      {
        会话状态: this.会话状态,
        输入状态: this.输入状态,
        时间线状态: this.时间线状态,
        视口状态: this.视口状态,
        流程状态: this.流程状态,
        运行时状态: this.运行时状态,
      },
      patch
    );
    if (!结果.写入了本地补丁) {
      return false;
    }
    if (结果.会话状态) {
      this.会话状态 = 结果.会话状态;
    }
    if (结果.输入状态) {
      this.输入状态 = 结果.输入状态;
    }
    if (结果.时间线状态) {
      this.时间线状态 = 结果.时间线状态;
    }
    if (结果.视口状态) {
      this.视口状态 = 结果.视口状态;
    }
    if (结果.流程状态) {
      this.流程状态 = 结果.流程状态;
    }
    if (结果.运行时状态) {
      this.运行时状态 = 结果.运行时状态;
    }
    if (结果.消息列表发生变化) {
      this.媒体编排.同步消息附件播放结果();
    }
    this.deps.渲染桥.请求重渲染();
    return true;
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

  private 读取恢复状态快照(): ReturnType<房间恢复编排依赖["读取恢复状态"]> {
    return 投影恢复编排状态({
      会话状态: this.会话状态,
      输入状态: this.输入状态,
      时间线状态: this.时间线状态,
      视口状态: this.视口状态,
      流程状态: this.流程状态,
      房间壳: this.回填房间壳补丁(),
    });
  }

  private 写入恢复状态补丁(
    patch: Parameters<房间恢复编排依赖["写入恢复状态"]>[0]
  ): void {
    this.应用本地状态折叠(patch);
    if (
      Object.hasOwn(patch, "initialUnreadSettled") &&
      patch.initialUnreadSettled === false &&
      Object.hasOwn(patch, "firstUnreadEventPosition")
    ) {
      this.roomViewport.send({
        type: "SNAPSHOT_BASELINE_SYNCED",
        firstUnreadEventPosition: patch.firstUnreadEventPosition ?? null,
      });
      this.同步房间视口快照();
    }
  }

  private 读取实时状态快照(): ReturnType<房间实时编排依赖["读取实时状态"]> {
    return 投影实时编排状态({
      会话状态: this.会话状态,
      输入状态: this.输入状态,
      时间线状态: this.时间线状态,
      视口状态: this.视口状态,
      流程状态: this.流程状态,
      房间壳: this.回填房间壳补丁(),
    });
  }

  private 写入实时状态补丁(
    patch: Parameters<房间实时编排依赖["写入实时状态"]>[0]
  ): void {
    this.应用本地状态折叠(patch);
  }

  private 读取阅读状态快照(): ReturnType<阅读推进编排依赖["读取阅读状态"]> {
    return 投影阅读推进状态({
      时间线状态: this.时间线状态,
      视口状态: this.视口状态,
      房间壳: this.回填房间壳补丁(),
    });
  }

  private 写入阅读状态补丁(
    patch: Parameters<阅读推进编排依赖["写入阅读状态"]>[0]
  ): void {
    this.应用本地状态折叠(patch);
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

  /**
   * 房间页退场必须同时清掉 socket、滚动尾波和壳层本地媒体副作用。
   * 否则 UI 已经退回首页了，旧房间的上传器/播放态还活着，就会制造幽灵状态。
   */
  private exitCurrentRoomView(
    opts: { keepRoomCodeCache: boolean } = {
      keepRoomCodeCache: true,
    }
  ): void {
    this.storage.清除当前房间标识();
    if (!opts.keepRoomCodeCache) {
      this.storage.清除当前房间短码();
    }
    this.编排协调器.重置端口();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.媒体编排.清空();
    this.roomTimeline.send({ type: "ROOM_SOFT_RESET" });
    this.同步房间时间线快照();
    this.roomViewport.send({ type: "ROOM_VIEW_EXITED" });
    this.应用本地状态折叠({
      messageInput: "",
      lastReadEventPosition: null,
      firstUnreadEventPosition: null,
      pendingReadAnchorPosition: null,
      pending: false,
      historyLoading: false,
      historyErrorCode: "",
    });
    this.同步房间视口快照();
  }

  private leaveCurrentRoomView(): void {
    this.发送房间事件({ type: "SOFT_LEAVE_REQUESTED" });
    this.exitCurrentRoomView({ keepRoomCodeCache: true });
  }

}

export function 创建聊天应用内核(deps: 聊天应用内核依赖): 聊天应用内核端口 {
  return new 聊天应用内核(deps);
}

