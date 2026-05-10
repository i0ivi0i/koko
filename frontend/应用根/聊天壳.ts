import { html, LitElement } from "lit";
import type { 应用运行时端口 } from "../平台/应用运行时.js";
import type { 聊天应用快照 } from "./聊天应用内核.js";
import "../房间消息窗/壳.js";
import type { 聊天运行时预算状态 } from "./聊天状态.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器.js";
import { 创建聊天壳应用装配 } from "./应用装配.js";
import {
  派生壳主舞台模式,
  派生控制台模式,
  派生壳级操作台状态,
  派生聊天列表展示项,
  派生首页会话展示项,
  派生房间壳提示文案,
  派生消息窗口提示文案,
  派生跳到最新入口文案,
  type 消息文本布局环境,
} from "../房间消息窗/视图.js";
import {
  聊天壳布局观测器,
  按房间宽度派生消息文本布局环境,
} from "./聊天壳布局协作.js";
import { 创建聊天列表展示项缓存 } from "./聊天列表展示项缓存.js";
import { 渲染聊天壳操作台 } from "./聊天壳操作台视图.js";
import { 聊天壳样式 } from "./聊天壳样式.js";

declare global {
  var __kokoBudgetSnapshot: (() => 聊天运行时预算状态) | undefined;
}

export class 聊天壳 extends LitElement {
  /**
   * 文本几何已经改由 Pretext 主导后，宿主尺寸变化就不能再指望浏览器自然流偷偷兜底。
   * render 路径禁止再同步读几何；这里只把 resize 信号翻译成一次缓存同步。
   */
  private readonly handleViewportResize = (): void => {
    this.布局观测器.同步消息文本布局环境(this.shadowRoot);
  };

  private readonly 布局观测器 = new 聊天壳布局观测器({
    同步房间宽度: (width) => this.应用消息文本布局宽度(width),
    同步操作台输入组宽度: (width) => this.应用操作台输入组宽度(width),
  });
  private 操作台输入组宽度缓存 = Math.min(globalThis.innerWidth || 390, 560);
  private 消息文本布局宽度缓存 = Math.max(1, globalThis.innerWidth || 1024);
  private 消息文本布局环境缓存 = 按房间宽度派生消息文本布局环境(
    this.消息文本布局宽度缓存
  );
  /**
   * 聊天列表展示项增量缓存（plan v2 §B）。
   *
   * 旧版本是引用相等缓存：xstate 每次 send 都返回新 messages 数组引用，
   * 缓存永远 miss，N=3000 时每次 REALTIME 全量重派生（含文本布局测量）。
   * 新版本按 message_id 单条增量缓存，只对新增/变更的消息重派生。
   */
  private readonly 聊天列表展示项缓存 = 创建聊天列表展示项缓存();

  static override styles = 聊天壳样式;

  /**
   * ChatAppKernel 是聊天壳唯一的业务入口。
   * 壳层之后只允许：
   * - 读 `snapshot()`；
   * - 发 `dispatch(command)`；
   * - 转接少量浏览器副作用清理回调。
   */
  private readonly 装配 = 创建聊天壳应用装配({
    请求重渲染: () => {
      this.requestUpdate();
    },
    等待壳渲染完成: async () => {
      await this.updateComplete;
    },
    滚动宿主: this,
    查询滚动容器: () =>
      (this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null) ?? null,
    查询消息节点: () =>
      Array.from(this.shadowRoot?.querySelectorAll("[data-event-position]") ?? []) as HTMLElement[],
    清理房间视图本地状态: ({ previewUrls }) => {
      this.回收媒体草稿预览地址(previewUrls);
    },
  });

  private get kernel() {
    return this.装配.kernel;
  }

  /**
   * 壳层只读内核快照，不再缓存第二份 `chatState` 镜像。
   * 这样测试和业务代码都会被迫走同一份真相，不再通过 setter 黑箱篡改状态。
   */
  private 读取聊天快照() {
    return this.kernel.snapshot();
  }

  /**
   * 真实浏览器烟测只读取内核预算快照，不在壳层派生第二套运行时真相。
   * 这个探针只服务验证：自动播放、查看器、swarm 与重任务预算仍以聊天内核为唯一来源。
   */
  private readonly 读取预算烟测快照 = (): 聊天运行时预算状态 =>
    this.装配.读取预算烟测快照();

  /**
   * 应用运行时是壳层里唯一的应用事件入口。
   * 它现在只认内核命令，不再把 roomScroller / 阅读推进端口这些 owner 暴露给壳层。
   */
  private get 应用运行时(): 应用运行时端口 {
    return this.装配.读取应用运行时();
  }

  private revokeDraftPreviewUrl(previewUrl: string): void {
    if (!previewUrl.startsWith("blob:")) {
      return;
    }
    URL.revokeObjectURL(previewUrl);
  }

  /**
   * 纯状态模块只告诉壳层“哪些旧 blob URL 应该作废”。
   * 真正的浏览器资源回收仍留在壳层执行，避免把 DOM/URL API 倒灌进纯状态模块。
   */
  private 回收媒体草稿预览地址(previewUrls: string[]): void {
    for (const previewUrl of previewUrls) {
      this.revokeDraftPreviewUrl(previewUrl);
    }
  }

  private 同步预算烟测探针(): void {
    globalThis.__kokoBudgetSnapshot = this.读取预算烟测快照;
  }

  private removeComposerDraft(localId: string): void {
    void this.kernel.dispatch({ type: "MEDIA_DRAFT_REMOVE_REQUESTED", localId });
  }

  /**
   * 失败草稿的“继续上传”和“重新上传”必须是两条不同意图：
   * - 继续上传：只允许复用旧 upload；
   * - 重新上传：明确放弃旧 upload，开启新一轮 prepare。
   *
   * 壳层只负责把用户意图转成应用事件，不在这里偷偷猜条件。
   */
  private async resumeComposerDraft(localId: string): Promise<void> {
    await this.kernel.dispatch({ type: "MEDIA_DRAFT_RESUME_REQUESTED", localId });
  }

  private async restartComposerDraft(localId: string): Promise<void> {
    await this.kernel.dispatch({ type: "MEDIA_DRAFT_RESTART_REQUESTED", localId });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener("resize", this.handleViewportResize);
    this.同步预算烟测探针();
    /**
     * 聊天壳只负责启动应用运行时并触发统一 bootstrap 命令。
     * 会话恢复、房间恢复、snapshot reload 全都留在内核与恢复编排里。
     */
    this.应用运行时.start();
    void this.kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" });
  }

  override updated(): void {
    this.布局观测器.同步房间宽度观察(this.shadowRoot);
    this.布局观测器.同步操作台输入组观察(this.shadowRoot);
    this.同步预算烟测探针();
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener("resize", this.handleViewportResize);
    if (globalThis.__kokoBudgetSnapshot === this.读取预算烟测快照) {
      globalThis.__kokoBudgetSnapshot = undefined;
    }
    this.布局观测器.释放();
    this.装配.销毁();
    super.disconnectedCallback();
  }

  /**
   * 唯一操作台现在只有一条 submit 主链：
   * - `join` / `message` 都先转成聊天内核 command；
   * - `hidden` 态只阻止默认提交，不允许 boot 骨架误触发业务动作。
   */
  private submitShellConsole(event: SubmitEvent): void {
    event.preventDefault();
    const consoleMode = 派生控制台模式({
      bootstrapState: this.读取聊天快照().bootstrapState,
      roomId: this.读取聊天快照().roomId,
    });
    if (this.操作台主动作已禁用(consoleMode)) {
      return;
    }
    if (consoleMode === "join") {
      void this.kernel.dispatch({ type: "JOIN_ROOM_REQUESTED" });
      return;
    }
    if (consoleMode === "message") {
      void this.kernel.dispatch({ type: "SEND_MESSAGE_REQUESTED" });
    }
  }

  private handleShellConsolePrimaryInput(event: Event, isMessageMode: boolean): void {
    const target = event.target as HTMLTextAreaElement;
    if (isMessageMode) {
      void this.kernel.dispatch({ type: "MESSAGE_INPUT_CHANGED", value: target.value });
      return;
    }
    void this.kernel.dispatch({ type: "ROOM_CODE_INPUT_CHANGED", value: target.value });
  }

  private handleShellConsolePrimaryKeydown(
    event: KeyboardEvent,
    isMessageMode: boolean
  ): void {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    /**
     * `textarea` 不会像单行 `input` 那样自动触发表单提交。
     * 为了保住原有 IM 发送语义，这里显式收口成：
     * 1. 房间短码模式：Enter 直接进房；
     * 2. 消息模式：Enter 发送，Shift+Enter 才换行。
     */
    if (isMessageMode && event.shiftKey) {
      return;
    }

    if (this.操作台主动作已禁用(isMessageMode ? "message" : "join")) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  /**
   * 键盘 Enter、表单 submit、按钮点击都必须尊重同一套 presenter 禁用态。
   * 否则视觉上已经“禁发”，但另一条入口仍然偷偷触发发送，就会重新长出 silent return。
   */
  private 操作台主动作已禁用(consoleMode: "hidden" | "join" | "message"): boolean {
    return 派生壳级操作台状态({
      consoleMode,
      roomCodeInput: this.读取聊天快照().roomCodeInput,
      messageInput: this.读取聊天快照().messageInput,
      pending: this.读取聊天快照().pending,
      statusText: "",
      composerMediaDrafts: this.读取聊天快照().composerMediaDrafts,
      mediaSelectionPendingCount: this.读取聊天快照().mediaSelectionPendingCount,
    }).primaryAction.disabled;
  }

  private 应用消息文本布局宽度(roomWidth: number): void {
    const nextWidth = Math.max(1, Math.round(roomWidth || globalThis.innerWidth || 1024));
    if (nextWidth === this.消息文本布局宽度缓存) {
      return;
    }
    this.消息文本布局宽度缓存 = nextWidth;
    // 新 layoutEnv 引用：增量缓存内部检测到 `上次layoutEnv !== input.layoutEnv` 时
    // 会自动全局失效（参 `创建聊天列表展示项缓存` 实现），不需要这里手动清空。
    this.消息文本布局环境缓存 = 按房间宽度派生消息文本布局环境(nextWidth);
    this.requestUpdate();
  }

  private 应用操作台输入组宽度(width: number): void {
    const nextWidth = Math.max(
      180,
      Math.round(width || Math.min(globalThis.innerWidth || 390, 560))
    );
    if (nextWidth === this.操作台输入组宽度缓存) {
      return;
    }
    this.操作台输入组宽度缓存 = nextWidth;
    this.requestUpdate();
  }

  private 读取消息文本布局环境(): 消息文本布局环境 {
    return this.消息文本布局环境缓存;
  }

  private 读取聊天列表展示项(聊天快照: 聊天应用快照): ReturnType<typeof 派生聊天列表展示项> {
    /**
     * 增量缓存增原路：
     * - 按 (message_id, 内容指纹) 缓存单条派生结果；
     * - sessionId / layoutEnv 变化时全局失效（语义变了）；
     * - 消息被裁掉时缓存条目自动驱逐。
     * 结果语义与原 `派生聊天列表展示项` 完全一致，仅是增量计算。
     */
    return this.聊天列表展示项缓存.派生({
      messages: 聊天快照.messages,
      currentSessionId: 聊天快照.sessionId,
      firstUnreadEventPosition: 聊天快照.firstUnreadEventPosition,
      layoutEnv: this.读取消息文本布局环境(),
      附件预览地址表: 聊天快照.media.previewUrlByAttachmentId,
    });
  }

  override render() {
    const 聊天快照 = this.读取聊天快照();
    const { recoveryHint, subtitle: roomSubtitle } = 派生房间壳提示文案({
      recoveryState: 聊天快照.recoveryState,
      roomId: 聊天快照.roomId,
      displayAlias: 聊天快照.displayAlias,
    });
    const { historyHint } = 派生消息窗口提示文案({
      historyLoading: 聊天快照.historyLoading,
      historyErrorCode: 聊天快照.historyErrorCode,
    });
    const jumpToLatestLabel = 派生跳到最新入口文案({
      viewportMode: 聊天快照.viewportMode,
      hasUnreadNewerMessages: 聊天快照.hasUnreadNewerMessages,
    });
    const shellView = 派生壳主舞台模式({
      bootstrapState: 聊天快照.bootstrapState,
      roomId: 聊天快照.roomId,
    });
    const consoleMode = 派生控制台模式({
      bootstrapState: 聊天快照.bootstrapState,
      roomId: 聊天快照.roomId,
    });
    const homeSessionViewItems = 派生首页会话展示项(聊天快照.homeSessionItems);
    const shellConsole = 渲染聊天壳操作台({
      mode: consoleMode,
      statusText:
        consoleMode === "hidden"
          ? "正在恢复身份、会话和上次停留的房间，请稍等一下。"
          : consoleMode === "message"
            ? (recoveryHint || "在这里输入消息，发送后会实时出现在房间里。")
            : "在这里输入房间短码，进入对应群聊空间。",
      statusAttention: consoleMode === "message" ? Boolean(recoveryHint) : false,
      roomId: 聊天快照.roomId,
      roomCodeInput: 聊天快照.roomCodeInput,
      messageInput: 聊天快照.messageInput,
      pending: 聊天快照.pending,
      composerMediaDrafts: 聊天快照.composerMediaDrafts,
      mediaSelectionPendingCount: 聊天快照.mediaSelectionPendingCount,
      操作台输入组宽度: this.操作台输入组宽度缓存,
      获取统一媒体文件输入: () =>
        this.shadowRoot?.querySelector<HTMLInputElement>('#shellConsoleAuxSlot input[type="file"]') ??
        null,
      处理选择媒体文件: async (files) => {
        await this.kernel.dispatch({ type: "MEDIA_FILES_SELECTED", files });
      },
      提交操作台: (event) => this.submitShellConsole(event),
      处理主输入: (event, isMessageMode) =>
        this.handleShellConsolePrimaryInput(event, isMessageMode),
      处理主输入按键: (event, isMessageMode) =>
        this.handleShellConsolePrimaryKeydown(event, isMessageMode),
      移除媒体草稿: (localId) => this.removeComposerDraft(localId),
      继续上传媒体草稿: (localId) => this.resumeComposerDraft(localId),
      重新上传媒体草稿: (localId) => this.restartComposerDraft(localId),
    });
    if (shellView === "boot") {
      return html`
        <section class="shell-screen">
          <section id="bootView" class="boot-screen">
            <div class="boot-card">
              <h1 class="boot-title">正在回到聊天空间</h1>
              <p class="boot-subtitle">正在恢复身份、会话和上次停留的房间，请稍等一下。</p>
            </div>
          </section>
          ${shellConsole}
        </section>
      `;
    }
    if (shellView === "home") {
      // 首页与房间页共用同一块壳级控制台；主舞台只负责展示列表和空态说明。
      return html`
        <section class="shell-screen">
          <section id="homeView" class="home-screen">
            <div class="home-card">
              <h1 class="join-title">空态首页占位</h1>
              <p class="join-subtitle">输入房间短码后进入当前聊天空间，身份和会话会继续沿用。</p>
              <div id="alias" class="join-meta">alias: ${聊天快照.displayAlias || "-"}</div>
            ${recoveryHint ? html`<div id="recoveryHint" class="hint">${recoveryHint}</div>` : null}
            ${homeSessionViewItems.length > 0
              ? html`
                  <ul id="homeRoomList" class="home-room-list">
                    ${homeSessionViewItems.map(
                      (item) => html`
                        <li>
                          <button
                            type="button"
                            class="home-room-item"
                            data-room-id=${item.roomId}
                            @click=${() =>
                              void this.kernel.dispatch({
                                type: "JOIN_HISTORY_ROOM_REQUESTED",
                                roomCode: item.roomCode,
                              })}
                          >
                            <div class="home-room-code">${item.title}</div>
                            <div class="home-room-meta">${item.meta}</div>
                          </button>
                        </li>
                      `
                    )}
                  </ul>
                `
              : null}
            </div>
          </section>
          ${shellConsole}
        </section>
      `;
    }
    const 聊天列表展示项 = this.读取聊天列表展示项(聊天快照);
    return html`
      <section class="shell-screen">
        <section id="roomView" class="room-screen">
          <header id="roomHeader" class="room-header">
            <button
              id="backBtn"
              class="back-button"
              aria-label="返回"
              @click=${() => void this.kernel.dispatch({ type: "LEAVE_ROOM_VIEW_REQUESTED" })}
            >
              ‹
            </button>
            <div class="room-heading">
              <div id="roomTitle" class="room-title">
                ${聊天快照.roomDisplayTitle || "群聊房间"}
              </div>
              <div id="roomSubtitle" class="room-subtitle">${roomSubtitle}</div>
            </div>
          </header>
          <koko-room-message-pane
             .roomId=${聊天快照.roomId}
             .items=${聊天列表展示项}
             .mediaPlaybackByAttachmentId=${聊天快照.media.playbackByAttachmentId}
             .mediaPreviewByAttachmentId=${聊天快照.media.previewByAttachmentId}
             .mediaVideoBudgetByAttachmentId=${聊天快照.media.videoBudgetByAttachmentId}
             .inlineAutoplayOwnerAttachmentId=${聊天快照.media.inlineAutoplayOwnerAttachmentId}
             .inlineAutoplayPlaybackByAttachmentId=${聊天快照.media.inlineAutoplayPlaybackByAttachmentId}
             .inlineAutoplayPositionByAttachmentId=${聊天快照.media.inlineAutoplayPositionByAttachmentId}
             .historyHint=${historyHint}
             .jumpToLatestLabel=${jumpToLatestLabel}
            @room-scroll-intent=${() =>
              this.应用运行时.dispatch({ type: "ROOM_SCROLL_INTENT" })}
            @room-scroll=${() => {
              this.应用运行时.dispatch({
                type: "ROOM_SCROLL_OBSERVED",
              });
            }}
            @room-media-window-observed=${(
              event: CustomEvent<{ attachmentIds: string[] }>
            ) => {
              this.应用运行时.dispatch({
                type: "ROOM_MEDIA_WINDOW_OBSERVED",
                attachmentIds: event.detail.attachmentIds,
              });
            }}
            @room-inline-autoplay-observed=${(
              event: CustomEvent<{
                candidates: Array<{
                  attachmentId: string;
                  visibilityRatio: number;
                  distanceToViewportCenter: number;
                }>;
              }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_INLINE_AUTOPLAY_OBSERVED",
                candidates: event.detail.candidates,
              });
            }}
            @room-inline-autoplay-position-changed=${(
              event: CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_INLINE_AUTOPLAY_POSITION_CHANGED",
                attachmentId: event.detail.attachmentId,
                position: event.detail.position,
              });
            }}
            @jump-to-latest=${() =>
              this.应用运行时.dispatch({ type: "ROOM_JUMP_TO_LATEST_REQUESTED" })}
            @room-open-media-viewer=${(event: CustomEvent<媒体查看器打开请求>) => {
              this.应用运行时.dispatch({
                type: "MEDIA_OPEN_REQUESTED",
                request: event.detail,
              });
            }}
            @room-media-session-signal=${(
              event: CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>
            ) => {
              this.应用运行时.dispatch({
                type: "MEDIA_SESSION_SIGNALLED",
                attachmentId: event.detail.attachmentId,
                signal: event.detail.signal,
              });
            }}
          ></koko-room-message-pane>
        </section>
        ${shellConsole}
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);

