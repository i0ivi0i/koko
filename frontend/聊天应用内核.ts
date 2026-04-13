import {
  创建房间内核,
  派生房间壳外观,
  type 房间内核事件,
  type 房间壳外观,
} from "./房间内核.js";
import {
  创建房间恢复编排,
  type 房间恢复编排依赖,
  type 房间恢复编排端口,
} from "./房间恢复编排.js";
import {
  创建房间实时编排,
  type 房间实时编排依赖,
  type 房间实时编排端口,
} from "./房间实时编排.js";
import {
  创建阅读推进编排,
  type 阅读推进编排依赖,
  type 阅读推进编排端口,
} from "./阅读推进编排.js";
import {
  房间滚动器,
  type 房间滚动器依赖,
  type 房间滚动器宿主,
} from "./房间滚动器.js";
import { 推进房间时间线, type 时间线输入 } from "./房间时间线.js";
import {
  获取默认浏览器应用平台,
  type 浏览器应用平台,
} from "./平台/index.js";
import type { 消息事件 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";
import type { 前端存储端口 } from "./存储.js";
import {
  初始聊天会话状态,
  初始聊天时间线状态,
  初始聊天流程状态,
  初始聊天视口状态,
  初始聊天输入状态,
  type 聊天会话状态,
  type 聊天时间线状态,
  type 聊天流程状态,
  type 聊天状态,
  type 聊天视口状态,
  type 聊天输入状态,
} from "./状态.js";
import {
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
} from "./媒体/index.js";
import {
  创建聊天媒体编排,
  type 聊天媒体快照,
  type 聊天媒体编排端口,
} from "./聊天媒体编排.js";

type 程序滚动来源 = "media_viewer_open";

export type 聊天应用快照 = 聊天状态 & {
  bootstrapState: 房间壳外观["bootstrapState"];
  media: 聊天媒体快照;
};

type 房间壳补丁 = Pick<
  聊天应用快照,
  | "bootstrapState"
  | "sessionId"
  | "displayAlias"
  | "roomId"
  | "roomDisplayTitle"
  | "latestEventPosition"
  | "viewportMode"
  | "candidateReadAnchorPosition"
  | "hasUnreadNewerMessages"
  | "recoveryState"
  | "lastRecoveryErrorCode"
>;

type 聊天本地状态补丁 = Partial<
  聊天会话状态 & 聊天输入状态 & 聊天时间线状态 & 聊天视口状态 & 聊天流程状态
>;

export type 聊天应用命令 =
  | { type: "BOOTSTRAP_REQUESTED" }
  | { type: "ROOM_CODE_INPUT_CHANGED"; value: string }
  | { type: "MESSAGE_INPUT_CHANGED"; value: string }
  | { type: "JOIN_ROOM_REQUESTED"; roomCode?: string }
  | { type: "JOIN_HISTORY_ROOM_REQUESTED"; roomCode: string }
  | { type: "LEAVE_ROOM_VIEW_REQUESTED" }
  | { type: "SEND_MESSAGE_REQUESTED" }
  | { type: "ROOM_SCROLL_INTENT" }
  | { type: "ROOM_SCROLL_OBSERVED"; scrollContainer: HTMLElement }
  | { type: "ROOM_JUMP_TO_LATEST_REQUESTED" }
  | { type: "MEDIA_OPEN_REQUESTED"; request: 媒体查看器打开请求 }
  | { type: "MEDIA_FILES_SELECTED"; files: Iterable<File> }
  | { type: "MEDIA_DRAFT_REMOVE_REQUESTED"; localId: string }
  | { type: "MEDIA_DRAFT_RETRY_REQUESTED"; localId: string };

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
  private readonly platform: 浏览器应用平台;

  /**
   * 房间阶段机仍然是聊天内核里唯一的房间编排真相。
   * 壳层之后只能消费这里回填出的快照，不再自己摸状态机。
   */
  private readonly roomKernel = 创建房间内核();

  /**
   * 聊天主链本地状态现在按职责拆成五个 slice：
   * - 会话：浏览器端恢复锚点；
   * - 输入：草稿与输入框；
   * - 时间线：消息数组与历史分页；
   * - 视口：已读与滚动协作；
   * - 流程：短生命周期忙闲位。
   *
   * room/session/viewportMode 这类房间壳外观继续只从 room kernel 派生，
   * 不再复制进一个共享 `chatState` 里让多个 owner 共写。
   */
  private 会话状态: 聊天会话状态;
  private 输入状态: 聊天输入状态;
  private 时间线状态: 聊天时间线状态;
  private 视口状态: 聊天视口状态;
  private 流程状态: 聊天流程状态;

  /**
   * transport / storage 现在都属于聊天内核依赖。
   * 壳层只通过内核拿稳定端口，不再直接 new / 持有这些浏览器适配器。
   */
  private transport: 前端传输端口;
  private storage: 前端存储端口;
  private readonly 媒体编排: 聊天媒体编排端口;

  /**
   * 恢复专用补锚标记仍只属于阅读/滚动协作链路。
   * 它不是聊天室业务真相，所以继续留在聊天应用内核内部，不往壳层外冒。
   */
  private shouldPrimeReadAnchorAfterInitialSettle = false;

  private _恢复编排端口: 房间恢复编排端口 | null = null;
  private _实时编排端口: 房间实时编排端口 | null = null;
  private _阅读推进编排端口: 阅读推进编排端口 | null = null;

  /**
   * 视口 owner 需要 DOM 查询能力，但 owner 本身仍属于聊天应用内核。
   * 这样浏览器滚动信号就先收进内核，再由阅读推进编排消费，不再让壳层横穿业务边界。
   */
  private readonly roomScroller: 房间滚动器;

  constructor(deps: 聊天应用内核依赖) {
    this.deps = deps;
    this.platform = deps.platform ?? 获取默认浏览器应用平台();
    this.transport = deps.transport ?? this.platform.transport.transport();
    this.storage = deps.storage ?? this.platform.storage.壳层记忆();
    this.会话状态 = { ...初始聊天会话状态 };
    this.输入状态 = { ...初始聊天输入状态 };
    this.时间线状态 = { ...初始聊天时间线状态 };
    this.视口状态 = { ...初始聊天视口状态 };
    this.流程状态 = { ...初始聊天流程状态 };
    this.roomScroller = new 房间滚动器(deps.滚动宿主, {
      读取状态: () => this.读取滚动观察状态(),
      更新状态: (patch) => this.写入滚动观察状态(patch),
      查询滚动容器: () => deps.查询滚动容器(),
      查询消息节点: () => deps.查询消息节点(),
      请求更早历史: () => {
        void this.阅读推进编排端口.请求加载更早历史();
      },
      采样阅读锚点: (position) => this.阅读推进编排端口.接收候选已读位置(position),
      读取是否需要恢复补锚: () => this.shouldPrimeReadAnchorAfterInitialSettle,
      消耗恢复补锚标记: () => {
        this.shouldPrimeReadAnchorAfterInitialSettle = false;
      },
      报告首屏稳定完成: (mode) => this.阅读推进编排端口.接收首屏稳定完成(mode),
    });
    this.媒体编排 = 创建聊天媒体编排({
      transport: () => this.transport,
      读取会话编号: () => this.回填房间壳补丁().sessionId,
      读取消息: () => this.时间线状态.messages,
      读取草稿: () => this.输入状态.composerMediaDrafts,
      写入草稿列表: (nextDrafts) => {
        this.应用本地状态补丁({ composerMediaDrafts: nextDrafts });
      },
      请求重渲染: () => {
        this.deps.渲染桥.请求重渲染();
      },
      回收媒体草稿预览地址: (previewUrls) => {
        this.deps.清理房间视图本地状态?.({ previewUrls });
      },
      登记程序滚动来源: (source) => {
        this.登记程序滚动来源(source);
      },
      清除程序滚动来源: (source) => {
        this.清除程序滚动来源(source);
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
        await this.恢复编排端口.bootstrap();
        return;
      case "ROOM_CODE_INPUT_CHANGED":
        this.应用本地状态补丁({ roomCodeInput: command.value });
        return;
      case "MESSAGE_INPUT_CHANGED":
        this.应用本地状态补丁({ messageInput: command.value });
        return;
      case "JOIN_ROOM_REQUESTED":
        if (typeof command.roomCode === "string") {
          const trimmedRoomCode = command.roomCode.trim();
          if (!trimmedRoomCode) {
            return;
          }
          this.应用本地状态补丁({ roomCodeInput: trimmedRoomCode });
        }
        await this.恢复编排端口.joinRoom();
        return;
      case "JOIN_HISTORY_ROOM_REQUESTED": {
        const trimmedRoomCode = command.roomCode.trim();
        if (!trimmedRoomCode) {
          return;
        }
        this.应用本地状态补丁({ roomCodeInput: trimmedRoomCode });
        await this.恢复编排端口.joinRoom();
        return;
      }
      case "LEAVE_ROOM_VIEW_REQUESTED":
        this.leaveCurrentRoomView();
        return;
      case "SEND_MESSAGE_REQUESTED": {
        const currentDrafts = this.输入状态.composerMediaDrafts;
        const hasReadyDraft = currentDrafts.some((draft) => draft.status === "ready");
        const hasBlockingDraft = currentDrafts.some((draft) => draft.status !== "ready");
        await this.实时编排端口.sendMessage();
        if (hasReadyDraft && !hasBlockingDraft) {
          this.媒体编排.清空草稿();
        }
        return;
      }
      case "ROOM_SCROLL_INTENT":
        this.标记用户滚动意图();
        return;
      case "ROOM_SCROLL_OBSERVED":
        this.处理聊天视口滚动(command.scrollContainer);
        return;
      case "ROOM_JUMP_TO_LATEST_REQUESTED":
        await this.请求跳到最新();
        return;
      case "MEDIA_OPEN_REQUESTED":
        this.登记程序滚动来源("media_viewer_open");
        this.打开媒体查看器(command.request);
        return;
      case "MEDIA_FILES_SELECTED":
        await this.处理选择媒体文件(command.files);
        return;
      case "MEDIA_DRAFT_REMOVE_REQUESTED":
        this.移除媒体草稿(command.localId);
        return;
      case "MEDIA_DRAFT_RETRY_REQUESTED":
        await this.重试媒体草稿(command.localId);
        return;
    }
  }

  setTransportForTest(transport: 前端传输端口): void {
    this._实时编排端口?.disconnect();
    this._实时编排端口 = null;
    this._阅读推进编排端口?.dispose();
    this._阅读推进编排端口 = null;
    this._恢复编排端口 = null;
    this.transport = transport;
    this.媒体编排.清空();
  }

  dispose(): void {
    this._实时编排端口?.disconnect();
    this._阅读推进编排端口?.dispose();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.媒体编排.销毁();
  }

  private 标记用户滚动意图(): void {
    this.roomScroller.标记用户滚动意图();
  }

  private 处理聊天视口滚动(scrollContainer: HTMLElement): void {
    const 应继续观察视口 = this.roomScroller.处理滚动事件(scrollContainer);
    if (应继续观察视口) {
      this.阅读推进编排端口.接收视口滚动();
    }
  }

  private 请求跳到最新(): Promise<void> {
    return this.阅读推进编排端口.请求跳到最新();
  }

  private 登记程序滚动来源(source: 程序滚动来源): void {
    this.roomScroller.登记程序滚动来源(source);
  }

  private 清除程序滚动来源(source: 程序滚动来源): void {
    this.roomScroller.清除程序滚动来源(source);
  }

  private async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
    await this.媒体编排.处理选择媒体文件(files);
  }

  private 移除媒体草稿(localId: string): void {
    this.媒体编排.移除媒体草稿(localId);
  }

  private async 重试媒体草稿(localId: string): Promise<void> {
    await this.媒体编排.重试媒体草稿(localId);
  }

  private 打开媒体查看器(request: 媒体查看器打开请求): void {
    this.媒体编排.打开查看器(request);
  }

  读取房间滚动器供测试(): 房间滚动器 {
    return this.roomScroller;
  }

  /**
   * Task 6 之后只保留“视口局部调试态”这一条窄测试缝：
   * - 不再允许整包快照补丁；
   * - 只允许搭建滚动/未读恢复这类难以纯 DOM 构造的极端视口场景；
   * - 房间壳派生状态仍然要翻成真实 room event，而不是直接改房间真相。
   */
  写入视口调试状态供测试(patch: Partial<聊天视口调试状态>): void {
    if (patch.viewportMode === "贴底跟随") {
      this.发送房间事件({ type: "USER_JUMPED_TO_LATEST" });
    }
    this.应用本地状态补丁(patch);
  }

  private get 恢复编排端口(): 房间恢复编排端口 {
    if (!this._恢复编排端口) {
      this._恢复编排端口 = 创建房间恢复编排({
        读取恢复状态: () => this.读取恢复编排状态(),
        写入恢复状态: (patch) => this.写入恢复编排状态(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        storage: this.storage,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
        },
        roomScroller: this.roomScroller,
        ensureRealtimeSocket: (sessionId) => this.实时编排端口.ensureRealtimeSocket(sessionId),
        subscribeRoom: (from) => this.实时编排端口.subscribeRoom(from),
        cancelPendingReadAnchorFlush: () => this.阅读推进编排端口.dispose(),
        cancelPendingFollowLatestReadSample: () => this.阅读推进编排端口.dispose(),
        exitCurrentRoomView: (opts) => this.exitCurrentRoomView(opts),
        disconnectRealtime: () => this.实时编排端口.disconnect(),
        写入恢复补锚标记: (value) => {
          this.shouldPrimeReadAnchorAfterInitialSettle = value;
        },
        等待壳渲染完成: async () => {
          await this.deps.渲染桥.等待壳渲染完成();
        },
      });
    }
    return this._恢复编排端口;
  }

  private get 实时编排端口(): 房间实时编排端口 {
    if (!this._实时编排端口) {
      this._实时编排端口 = 创建房间实时编排({
        读取实时状态: () => this.读取实时编排状态(),
        写入实时状态: (patch) => this.写入实时编排状态(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
        },
        上报Transport异常: async (error) => {
          await this.恢复编排端口.接收Transport异常(error);
        },
        处理恢复失败: (error, keepRoomVisible) => {
          this.恢复编排端口.处理恢复失败(error, keepRoomVisible);
        },
        跟随最新消息追加后刷新视口: async () => {
          await this.阅读推进编排端口.接收Realtime追加后跟随();
        },
        接收权威事件后副作用: (events) => {
          this.处理权威新消息平台副作用(events);
        },
      });
    }
    return this._实时编排端口;
  }

  private get 阅读推进编排端口(): 阅读推进编排端口 {
    if (!this._阅读推进编排端口) {
      this._阅读推进编排端口 = 创建阅读推进编排({
        读取阅读状态: () => this.读取阅读推进状态(),
        写入阅读状态: (patch) => this.写入阅读状态(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        roomKernel: {
          send: (event) => this.发送房间事件(event),
        },
        roomScroller: this.roomScroller,
        withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
          this.恢复编排端口.withSessionRefreshOnInvalid(operation),
        等待壳渲染完成: async () => {
          await this.deps.渲染桥.等待壳渲染完成();
        },
        滚到最新位置: () => this.roomScroller.滚到最新位置(),
      });
    }
    return this._阅读推进编排端口;
  }

  /**
   * 时间线合流规则继续只允许走这一条入口。
   * 恢复 / realtime / 历史分页只能上报事实，不能各自在外面拼 messages 数组。
   */
  private 推进时间线(input: 时间线输入): void {
    this.应用本地状态补丁({
      messages: 推进房间时间线(this.时间线状态.messages, input),
    });
  }

  /**
   * 本地 slice 写入口只负责聊天内核自己拥有的状态。
   * room kernel 派生字段不会在这里落地，避免重新长回“共享大状态 + 多处 patch”。
   */
  private 应用本地状态补丁(patch: 聊天本地状态补丁): boolean {
    let 写入了本地补丁 = false;
    let 消息列表发生变化 = false;
    const 会话补丁: Partial<聊天会话状态> = {};
    const 输入补丁: Partial<聊天输入状态> = {};
    const 时间线补丁: Partial<聊天时间线状态> = {};
    const 视口补丁: Partial<聊天视口状态> = {};
    const 流程补丁: Partial<聊天流程状态> = {};

    if (Object.hasOwn(patch, "deviceAnonymousToken")) {
      会话补丁.deviceAnonymousToken = patch.deviceAnonymousToken ?? "";
    }
    if (Object.hasOwn(patch, "anonymousIdentityId")) {
      会话补丁.anonymousIdentityId = patch.anonymousIdentityId ?? "";
    }
    if (Object.hasOwn(patch, "homeSessionItems")) {
      会话补丁.homeSessionItems = patch.homeSessionItems ?? [];
    }
    if (Object.hasOwn(patch, "roomCodeInput")) {
      输入补丁.roomCodeInput = patch.roomCodeInput ?? "";
    }
    if (Object.hasOwn(patch, "messageInput")) {
      输入补丁.messageInput = patch.messageInput ?? "";
    }
    if (Object.hasOwn(patch, "composerMediaDrafts")) {
      输入补丁.composerMediaDrafts = patch.composerMediaDrafts ?? [];
    }
    if (Object.hasOwn(patch, "messages")) {
      时间线补丁.messages = patch.messages ?? [];
      消息列表发生变化 = true;
    }
    if (Object.hasOwn(patch, "hasMoreBefore")) {
      时间线补丁.hasMoreBefore = patch.hasMoreBefore ?? false;
    }
    if (Object.hasOwn(patch, "historyLoading")) {
      时间线补丁.historyLoading = patch.historyLoading ?? false;
    }
    if (Object.hasOwn(patch, "historyErrorCode")) {
      时间线补丁.historyErrorCode = patch.historyErrorCode ?? "";
    }
    if (Object.hasOwn(patch, "lastReadEventPosition")) {
      视口补丁.lastReadEventPosition = patch.lastReadEventPosition ?? null;
    }
    if (Object.hasOwn(patch, "firstUnreadEventPosition")) {
      视口补丁.firstUnreadEventPosition = patch.firstUnreadEventPosition ?? null;
    }
    if (Object.hasOwn(patch, "initialUnreadSettled")) {
      视口补丁.initialUnreadSettled = patch.initialUnreadSettled ?? false;
    }
    if (Object.hasOwn(patch, "scrollPhase")) {
      视口补丁.scrollPhase = patch.scrollPhase ?? "idle";
    }
    if (Object.hasOwn(patch, "hasUserScrollIntent")) {
      视口补丁.hasUserScrollIntent = patch.hasUserScrollIntent ?? false;
    }
    if (Object.hasOwn(patch, "pendingReadAnchorPosition")) {
      视口补丁.pendingReadAnchorPosition = patch.pendingReadAnchorPosition ?? null;
    }
    if (Object.hasOwn(patch, "historyLoadThrottleUntil")) {
      视口补丁.historyLoadThrottleUntil = patch.historyLoadThrottleUntil ?? 0;
    }
    if (Object.hasOwn(patch, "pending")) {
      流程补丁.pending = patch.pending ?? false;
    }

    if (Object.keys(会话补丁).length > 0) {
      this.会话状态 = { ...this.会话状态, ...会话补丁 };
      写入了本地补丁 = true;
    }
    if (Object.keys(输入补丁).length > 0) {
      this.输入状态 = { ...this.输入状态, ...输入补丁 };
      写入了本地补丁 = true;
    }
    if (Object.keys(时间线补丁).length > 0) {
      this.时间线状态 = { ...this.时间线状态, ...时间线补丁 };
      写入了本地补丁 = true;
    }
    if (Object.keys(视口补丁).length > 0) {
      this.视口状态 = { ...this.视口状态, ...视口补丁 };
      写入了本地补丁 = true;
    }
    if (Object.keys(流程补丁).length > 0) {
      this.流程状态 = { ...this.流程状态, ...流程补丁 };
      写入了本地补丁 = true;
    }

    if (!写入了本地补丁) {
      return false;
    }
    if (消息列表发生变化) {
      this.媒体编排.同步消息附件播放结果();
    }
    this.deps.渲染桥.请求重渲染();
    return true;
  }

  private 读取聊天基础快照(): Omit<聊天应用快照, "media"> {
    return {
      ...this.会话状态,
      ...this.输入状态,
      ...this.时间线状态,
      ...this.视口状态,
      ...this.流程状态,
      ...this.回填房间壳补丁(),
    };
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

  private 写入滚动观察状态(patch: Parameters<房间滚动器依赖["更新状态"]>[0]): void {
    this.应用本地状态补丁(patch);
  }

  private 读取恢复编排状态(): ReturnType<房间恢复编排依赖["读取恢复状态"]> {
    const 房间壳 = this.回填房间壳补丁();
    return {
      deviceAnonymousToken: this.会话状态.deviceAnonymousToken,
      anonymousIdentityId: this.会话状态.anonymousIdentityId,
      displayAlias: 房间壳.displayAlias,
      sessionId: 房间壳.sessionId,
      roomId: 房间壳.roomId,
      roomCodeInput: this.输入状态.roomCodeInput,
      lastReadEventPosition: this.视口状态.lastReadEventPosition,
      firstUnreadEventPosition: this.视口状态.firstUnreadEventPosition,
      hasMoreBefore: this.时间线状态.hasMoreBefore,
      initialUnreadSettled: this.视口状态.initialUnreadSettled,
      scrollPhase: this.视口状态.scrollPhase,
      hasUserScrollIntent: this.视口状态.hasUserScrollIntent,
      pendingReadAnchorPosition: this.视口状态.pendingReadAnchorPosition,
      historyLoadThrottleUntil: this.视口状态.historyLoadThrottleUntil,
      pending: this.流程状态.pending,
      historyLoading: this.时间线状态.historyLoading,
      historyErrorCode: this.时间线状态.historyErrorCode,
      homeSessionItems: this.会话状态.homeSessionItems,
    };
  }

  private 写入恢复编排状态(
    patch: Parameters<房间恢复编排依赖["写入恢复状态"]>[0]
  ): void {
    this.应用本地状态补丁(patch);
  }

  private 读取实时编排状态(): ReturnType<房间实时编排依赖["读取实时状态"]> {
    const 房间壳 = this.回填房间壳补丁();
    return {
      displayAlias: 房间壳.displayAlias,
      sessionId: 房间壳.sessionId,
      roomId: 房间壳.roomId,
      latestEventPosition: 房间壳.latestEventPosition,
      viewportMode: 房间壳.viewportMode,
      messageInput: this.输入状态.messageInput,
      composerMediaDrafts: this.输入状态.composerMediaDrafts,
      messages: this.时间线状态.messages,
      pending: this.流程状态.pending,
    };
  }

  private 写入实时编排状态(
    patch: Parameters<房间实时编排依赖["写入实时状态"]>[0]
  ): void {
    this.应用本地状态补丁(patch);
  }

  private 读取阅读推进状态(): ReturnType<阅读推进编排依赖["读取阅读状态"]> {
    const 房间壳 = this.回填房间壳补丁();
    return {
      roomId: 房间壳.roomId,
      sessionId: 房间壳.sessionId,
      latestEventPosition: 房间壳.latestEventPosition,
      viewportMode: 房间壳.viewportMode,
      candidateReadAnchorPosition: 房间壳.candidateReadAnchorPosition,
      messages: this.时间线状态.messages,
      hasMoreBefore: this.时间线状态.hasMoreBefore,
      historyLoading: this.时间线状态.historyLoading,
      historyErrorCode: this.时间线状态.historyErrorCode,
      lastReadEventPosition: this.视口状态.lastReadEventPosition,
      firstUnreadEventPosition: this.视口状态.firstUnreadEventPosition,
      initialUnreadSettled: this.视口状态.initialUnreadSettled,
      scrollPhase: this.视口状态.scrollPhase,
      pendingReadAnchorPosition: this.视口状态.pendingReadAnchorPosition,
    };
  }

  private 写入阅读状态(patch: Parameters<阅读推进编排依赖["写入阅读状态"]>[0]): void {
    this.应用本地状态补丁(patch);
  }

  private 读取房间壳外观(): 房间壳外观 {
    return 派生房间壳外观(this.roomKernel.getSnapshot());
  }

  /**
   * 房间壳派生字段全部来自 room kernel。
   * 因此只要发了房间事件，就必须顺手请求一次壳层重渲染，不能再指望别的本地 patch 帮它“顺带刷新”。
   */
  private 发送房间事件(event: 房间内核事件): void {
    this.roomKernel.send(event);
    this.deps.渲染桥.请求重渲染();
  }

  private 回填房间壳补丁(): 房间壳补丁 {
    const roomShell = this.读取房间壳外观();
    return {
      bootstrapState: roomShell.bootstrapState,
      sessionId: roomShell.sessionId,
      displayAlias: roomShell.displayAlias,
      roomId: roomShell.roomId,
      roomDisplayTitle: roomShell.roomDisplayTitle,
      latestEventPosition: roomShell.latestEventPosition,
      viewportMode: roomShell.viewportMode,
      candidateReadAnchorPosition: roomShell.candidateReadAnchorPosition,
      hasUnreadNewerMessages: roomShell.hasUnreadNewerMessages,
      recoveryState: roomShell.recoveryState,
      lastRecoveryErrorCode: roomShell.lastRecoveryErrorCode,
    };
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
    this.实时编排端口.disconnect();
    this.storage.清除当前房间标识();
    if (!opts.keepRoomCodeCache) {
      this.storage.清除当前房间短码();
    }
    this.阅读推进编排端口.dispose();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.媒体编排.清空();
    this.应用本地状态补丁({
      messageInput: "",
      lastReadEventPosition: null,
      firstUnreadEventPosition: null,
      hasMoreBefore: false,
      initialUnreadSettled: true,
      scrollPhase: "idle",
      hasUserScrollIntent: false,
      pendingReadAnchorPosition: null,
      historyLoadThrottleUntil: 0,
      messages: [],
      pending: false,
      historyLoading: false,
      historyErrorCode: "",
    });
  }

  private leaveCurrentRoomView(): void {
    this.发送房间事件({ type: "SOFT_LEAVE_REQUESTED" });
    this.exitCurrentRoomView({ keepRoomCodeCache: true });
  }

  /**
   * 系统通知和 badge 仍然先由聊天内核裁决“要不要提醒”：
   * - 只有别人的权威新消息才可能触发；
   * - 当前上下文已经是前台主窗口时，不重复弹系统提醒；
   * - 真正执行浏览器 Notification / Badge 的细节继续留在平台层。
   */
  private 处理权威新消息平台副作用(events: 消息事件[]): void {
    const 房间壳 = this.回填房间壳补丁();
    const otherMessages = events.filter((event) => event.sender_session_id !== 房间壳.sessionId);
    if (otherMessages.length === 0) {
      return;
    }

    const platformSnapshot = this.platform.snapshot();
    const 当前就在前台主窗口 =
      platformSnapshot.lifecycle.phase === "active" &&
      platformSnapshot.lifecycle.visibility === "visible" &&
      platformSnapshot.multiContext.isPrimaryContext;
    if (当前就在前台主窗口) {
      return;
    }

    const 最新一条他人消息 = otherMessages.at(-1)!;
    void this.platform.dispatch({
      type: "SET_BADGE",
      count: platformSnapshot.notification.badgeCount + otherMessages.length,
    });
    void this.platform.dispatch({
      type: "SHOW_NOTIFICATION",
      id: 最新一条他人消息.message_id,
      title: 最新一条他人消息.sender_display_alias,
      body: 最新一条他人消息.text || 最新一条他人消息.body,
      tag: 最新一条他人消息.room_id,
    });
  }
}

export function 创建聊天应用内核(deps: 聊天应用内核依赖): 聊天应用内核端口 {
  return new 聊天应用内核(deps);
}
