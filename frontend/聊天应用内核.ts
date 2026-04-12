import { 创建房间内核, 派生房间壳外观, type 房间壳外观 } from "./房间内核.js";
import { 创建房间恢复编排, type 房间恢复编排端口 } from "./房间恢复编排.js";
import { 创建房间实时编排, type 房间实时编排端口 } from "./房间实时编排.js";
import { 创建阅读推进编排, type 阅读推进编排端口 } from "./阅读推进编排.js";
import { 房间滚动器 } from "./房间滚动器.js";
import { 推进房间时间线, type 时间线输入 } from "./房间时间线.js";
import {
  获取默认浏览器应用平台,
  type 浏览器应用平台,
} from "./平台/index.js";
import type { 消息事件 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";
import type { 前端存储端口 } from "./存储.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import {
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
  type 媒体播放结果,
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

export interface 聊天应用内核宿主 {
  addController(controller: object): void;
  removeController(controller: object): void;
  requestUpdate(): void;
  updateComplete: Promise<boolean>;
}

export interface 聊天应用内核依赖 {
  host: 聊天应用内核宿主;
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
  构建附件内容地址(attachmentId: string, variant?: "original" | "thumbnail"): string;
  设置媒体播放器供测试(player: {
    解析播放结果(input: { attachmentId: string; kind: "image" | "video" }): Promise<媒体播放结果>;
  }): void;
  设置媒体查看器供测试(viewer: { 打开(input: 媒体查看器打开请求): void; 销毁(): void }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    重试草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  注入快照补丁供测试(patch: Partial<聊天应用快照>): void;
  读取房间滚动器供测试(): 房间滚动器;
  读取恢复编排端口供测试(): 房间恢复编排端口;
  读取阅读推进编排端口供测试(): 阅读推进编排端口;
  读取恢复补锚标记供测试(): boolean;
  写入恢复补锚标记供测试(value: boolean): void;
}

class 聊天应用内核 implements 聊天应用内核端口 {
  private readonly deps: 聊天应用内核依赖;
  private readonly platform: 浏览器应用平台;

  /**
   * 房间阶段机仍然是聊天内核里唯一的房间编排真相。
   * 壳层之后只能消费这里回填出的快照，不再自己摸状态机。
   */
  private readonly roomKernel = 创建房间内核();

  /**
   * 这里继续只保存聊天主链自己的业务快照。
   * 媒体播放结果不再混进同一个对象里，而是由媒体 owner 单独持有；
   * `snapshot()` 再把两者投影成壳层可读的组合快照。
   */
  private chatState: Omit<聊天应用快照, "media">;

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
    this.chatState = {
      ...初始聊天状态,
      ...this.回填房间壳补丁(),
    };
    this.roomScroller = new 房间滚动器(deps.host, {
      读取状态: () => this.chatState,
      更新状态: (patch) => this.更新快照(patch),
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
      读取会话编号: () => this.chatState.sessionId,
      读取消息: () => this.chatState.messages,
      读取草稿: () => this.chatState.composerMediaDrafts,
      写入草稿列表: (nextDrafts) => {
        this.更新快照({ composerMediaDrafts: nextDrafts });
      },
      请求重渲染: () => {
        this.deps.host.requestUpdate();
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
      ...this.chatState,
      media: this.媒体编排.snapshot(),
    };
  }

  async dispatch(command: 聊天应用命令): Promise<void> {
    switch (command.type) {
      case "BOOTSTRAP_REQUESTED":
        await this.恢复编排端口.bootstrap();
        return;
      case "ROOM_CODE_INPUT_CHANGED":
        this.更新快照({ roomCodeInput: command.value });
        return;
      case "MESSAGE_INPUT_CHANGED":
        this.更新快照({ messageInput: command.value });
        return;
      case "JOIN_ROOM_REQUESTED":
        if (typeof command.roomCode === "string") {
          const trimmedRoomCode = command.roomCode.trim();
          if (!trimmedRoomCode) {
            return;
          }
          this.更新快照({ roomCodeInput: trimmedRoomCode });
        }
        await this.恢复编排端口.joinRoom();
        return;
      case "JOIN_HISTORY_ROOM_REQUESTED": {
        const trimmedRoomCode = command.roomCode.trim();
        if (!trimmedRoomCode) {
          return;
        }
        this.更新快照({ roomCodeInput: trimmedRoomCode });
        await this.恢复编排端口.joinRoom();
        return;
      }
      case "LEAVE_ROOM_VIEW_REQUESTED":
        this.leaveCurrentRoomView();
        return;
      case "SEND_MESSAGE_REQUESTED": {
        const currentDrafts = this.chatState.composerMediaDrafts;
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

  构建附件内容地址(
    attachmentId: string,
    variant: "original" | "thumbnail" = "original"
  ): string {
    return this.媒体编排.构建附件内容地址(attachmentId, variant);
  }

  设置媒体播放器供测试(player: {
    解析播放结果(input: { attachmentId: string; kind: "image" | "video" }): Promise<媒体播放结果>;
  }): void {
    this.媒体编排.设置媒体播放器供测试(player);
  }

  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void {
    this.媒体编排.设置媒体查看器供测试(viewer);
  }

  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    重试草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void {
    this.媒体编排.设置媒体发布器供测试(publisher);
  }

  /**
   * 下面这些测试缝只服务现有集成测试迁移：
   * - 它们显式带上“供测试”标记，避免重新伪装成正式业务入口；
   * - 只允许补丁式注入和只读观察，不再保留 `replaceSnapshot()` 那种整包覆盖真相的旁路。
   */
  注入快照补丁供测试(patch: Partial<聊天应用快照>): void {
    const { media: _忽略媒体快照, ...statePatch } = patch;
    this.更新快照(statePatch);
  }

  读取房间滚动器供测试(): 房间滚动器 {
    return this.roomScroller;
  }

  读取恢复编排端口供测试(): 房间恢复编排端口 {
    return this.恢复编排端口;
  }

  读取阅读推进编排端口供测试(): 阅读推进编排端口 {
    return this.阅读推进编排端口;
  }

  读取恢复补锚标记供测试(): boolean {
    return this.shouldPrimeReadAnchorAfterInitialSettle;
  }

  写入恢复补锚标记供测试(value: boolean): void {
    this.shouldPrimeReadAnchorAfterInitialSettle = value;
  }

  private get 恢复编排端口(): 房间恢复编排端口 {
    if (!this._恢复编排端口) {
      this._恢复编排端口 = 创建房间恢复编排({
        读取状态: () => this.chatState,
        更新状态: (patch) => this.更新快照(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        storage: this.storage,
        roomKernel: this.roomKernel,
        roomShellPatch: () => this.回填房间壳补丁(),
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
          await this.deps.host.updateComplete;
        },
      });
    }
    return this._恢复编排端口;
  }

  private get 实时编排端口(): 房间实时编排端口 {
    if (!this._实时编排端口) {
      this._实时编排端口 = 创建房间实时编排({
        读取状态: () => this.chatState,
        更新状态: (patch) => this.更新快照(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        roomKernel: this.roomKernel,
        roomShellPatch: () => this.回填房间壳补丁(),
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
        读取状态: () => this.chatState,
        更新状态: (patch) => this.更新快照(patch),
        推进时间线: (input) => this.推进时间线(input),
        transport: this.transport,
        roomKernel: this.roomKernel,
        roomShellPatch: () => this.回填房间壳补丁(),
        roomScroller: this.roomScroller,
        withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
          this.恢复编排端口.withSessionRefreshOnInvalid(operation),
        等待壳渲染完成: async () => {
          await this.deps.host.updateComplete;
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
    this.更新快照({
      messages: 推进房间时间线(this.chatState.messages, input),
    });
  }

  private 更新快照(patch: Partial<Omit<聊天应用快照, "media">>): void {
    this.chatState = { ...this.chatState, ...patch };
    if (Object.hasOwn(patch, "messages")) {
      this.媒体编排.同步消息附件播放结果();
    }
    this.deps.host.requestUpdate();
  }

  private 读取房间壳外观(): 房间壳外观 {
    return 派生房间壳外观(this.roomKernel.getSnapshot());
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
    this.更新快照({
      messageInput: "",
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
    });
  }

  private leaveCurrentRoomView(): void {
    this.roomKernel.send({ type: "SOFT_LEAVE_REQUESTED" });
    this.exitCurrentRoomView({ keepRoomCodeCache: true });
    this.更新快照(this.回填房间壳补丁());
  }

  /**
   * 系统通知和 badge 仍然先由聊天内核裁决“要不要提醒”：
   * - 只有别人的权威新消息才可能触发；
   * - 当前上下文已经是前台主窗口时，不重复弹系统提醒；
   * - 真正执行浏览器 Notification / Badge 的细节继续留在平台层。
   */
  private 处理权威新消息平台副作用(events: 消息事件[]): void {
    const otherMessages = events.filter((event) => event.sender_session_id !== this.chatState.sessionId);
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
