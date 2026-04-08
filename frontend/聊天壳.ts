import { css, html, LitElement } from "lit";
import type { 房间快照, 消息事件 } from "./契约.js";
import { 创建房间内核, 派生房间壳外观 } from "./房间内核.js";
import { 房间滚动器 } from "./房间滚动器.js";
import {
  创建浏览器存储,
  type 首页房间历史条目,
  type 前端存储端口,
} from "./存储.js";
import { Http接口错误, HttpRealtime传输, type 前端传输端口 } from "./传输.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import {
  派生壳主舞台模式,
  派生控制台模式,
  派生聊天列表展示项,
  派生首页会话展示项,
  派生房间提示文案,
  派生跳到最新入口文案,
} from "./视图.js";
import type { Socket } from "socket.io-client";
const 阅读推进节流毫秒 = 400;

type 控制面结果 = {
  kind?: string;
  latest_event_position?: number;
  code?: string;
  room_id?: string;
};

type 恢复失败 = Error & {
  status?: number;
  code?: string;
};

export class 聊天壳 extends LitElement {
  static override styles = css`
    :host {
      --surface-canvas: #0b0f14;
      --surface-panel: #151b23;
      --surface-elevated: #1b2430;
      --surface-soft: #243042;
      --surface-overlay: rgba(21, 27, 35, 0.92);
      --surface-input: rgba(18, 24, 32, 0.96);
      --surface-nav: rgba(24, 31, 41, 0.92);
      --surface-scroll: rgba(9, 13, 18, 0.48);
      --surface-panel-top: rgba(28, 36, 47, 0.94);
      --surface-panel-bottom: rgba(16, 21, 29, 0.96);
      --surface-elevated-bottom: rgba(20, 27, 36, 0.96);
      --bubble-other-top: rgba(34, 43, 56, 0.98);
      --bubble-other-bottom: rgba(24, 31, 41, 0.98);
      --bubble-mine-top: rgba(255, 56, 92, 0.22);
      --bubble-mine-bottom: rgba(91, 34, 56, 0.92);
      --text-primary: #f3f7fb;
      --text-secondary: #c7d1dc;
      --text-muted: #8a97a8;
      --text-on-accent: #fff7f9;
      --accent-core: #ff385c;
      --accent-pressed: #d92a4f;
      --accent-hover: #ff5a78;
      --accent-glow: rgba(255, 56, 92, 0.2);
      --line-soft: rgba(255, 255, 255, 0.08);
      --line-strong: rgba(255, 255, 255, 0.16);
      --line-accent-soft: rgba(255, 107, 132, 0.18);
      --line-on-accent: rgba(255, 255, 255, 0.08);
      --line-on-bubble: rgba(255, 255, 255, 0.05);
      --status-warn-bg: rgba(30, 39, 52, 0.9);
      --status-warn-text: #dbe7f5;
      --status-warn-strong: #ff9bb0;
      --status-divider: rgba(255, 56, 92, 0.32);
      --shadow-warm:
        rgba(0, 0, 0, 0.2) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.28) 0px 12px 28px,
        rgba(0, 0, 0, 0.38) 0px 22px 44px;
      display: block;
      height: 100%;
      min-height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(circle at top, rgba(255, 56, 92, 0.14), transparent 30%),
        radial-gradient(circle at 82% 18%, rgba(96, 165, 250, 0.12), transparent 24%),
        linear-gradient(180deg, #0b0f14 0%, #0f141b 52%, #090d12 100%);
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
      color: var(--text-primary);
    }

    * {
      box-sizing: border-box;
    }

    button,
    input {
      font: inherit;
    }

    button {
      border: 0;
      cursor: pointer;
      transition:
        transform 140ms ease,
        opacity 140ms ease,
        background-color 140ms ease;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }

    .shell-screen {
      height: 100%;
      min-height: 100dvh;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 12px 14px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }

    .home-screen {
      height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 2px 0;
    }

    /* bootstrap 未完成时只展示一层中性壳，避免刷新恢复房间时先闪出空态首页。 */
    .boot-screen {
      height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    .boot-card {
      width: min(100%, 460px);
      padding: 24px;
      border: 1px solid var(--line-soft);
      border-radius: 28px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-panel-bottom)),
        var(--surface-panel);
      box-shadow: var(--shadow-warm);
    }

    .boot-title {
      margin: 0;
      font-size: clamp(20px, 3vw, 26px);
      font-weight: 700;
      letter-spacing: -0.18px;
      color: var(--text-primary);
    }

    .boot-subtitle {
      margin: 10px 0 0;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .home-card {
      width: min(100%, 560px);
      padding: 24px;
      border: 1px solid var(--line-soft);
      border-radius: 28px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-panel-bottom)),
        var(--surface-panel);
      box-shadow: var(--shadow-warm);
      backdrop-filter: blur(18px);
    }

    .join-title {
      margin: 0;
      font-size: clamp(24px, 4vw, 34px);
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: -0.24px;
      color: var(--text-primary);
    }

    .join-subtitle {
      margin: 10px 0 0;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .join-meta {
      margin-top: 18px;
      color: var(--text-muted);
    }

    .hint {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid var(--line-accent-soft);
      background: var(--status-warn-bg);
      color: var(--status-warn-text);
    }

    .home-room-list {
      margin-top: 16px;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }

    .home-room-item {
      display: grid;
      gap: 4px;
      width: 100%;
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid var(--line-soft);
      background: rgba(255, 255, 255, 0.03);
      text-align: left;
    }

    .home-room-code {
      font-weight: 700;
      color: var(--text-primary);
    }

    .home-room-meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    .join-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      margin-top: 18px;
    }

    .text-input {
      width: 100%;
      min-width: 0;
      padding: 12px 16px;
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      background: var(--surface-input);
      color: var(--text-primary);
      outline: none;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.18);
    }

    .text-input:focus {
      border-color: rgba(255, 56, 92, 0.45);
      box-shadow:
        0 0 0 3px var(--accent-glow),
        inset 0 1px 2px rgba(0, 0, 0, 0.18);
    }

    .primary-button {
      padding: 12px 18px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--accent-core) 0%, var(--accent-pressed) 100%);
      color: var(--text-on-accent);
      box-shadow:
        0 0 0 1px var(--line-on-accent),
        0 12px 24px rgba(224, 11, 65, 0.22);
    }

    .primary-button:not(:disabled):hover {
      transform: translateY(-1px);
      background: linear-gradient(135deg, var(--accent-hover) 0%, var(--accent-core) 100%);
    }

    /* 房间页按单屏聊天应用组织：头部、消息流、输入区共用一张屏幕，不再漂浮成网页卡片。 */
    .room-screen {
      height: 100%;
      min-height: 0;
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 0;
    }

    .room-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: calc(4px + env(safe-area-inset-top, 0px)) 4px 10px;
    }

    .back-button {
      min-width: 72px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--surface-nav);
      color: var(--text-secondary);
      box-shadow: var(--shadow-warm);
    }

    .room-heading {
      min-width: 0;
      text-align: center;
    }

    .room-title {
      overflow: hidden;
      font-size: clamp(18px, 2.4vw, 22px);
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.18px;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
    }

    .room-subtitle {
      overflow: hidden;
      margin-top: 4px;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
    }

    /* 消息区必须吃掉中间所有剩余高度，这样不同屏幕高度下输入区都能稳定贴底。 */
    .message-scroll {
      min-height: 0;
      overflow-y: auto;
      padding: 6px 2px;
      border-radius: 28px;
      /* 聊天窗口是内层滚动容器，触顶/触底时不应把浏览器页面回弹和外层滚动链带进来。 */
      overscroll-behavior-y: contain;
      /* 历史前插后由壳层按 scrollHeight 差值手动补偿，不能再让浏览器默认滚动锚点重复干预。 */
      overflow-anchor: none;
      scrollbar-gutter: stable both-edges;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
        var(--surface-scroll);
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 100%;
      padding: 8px 4px 0;
      margin: 0;
      list-style: none;
    }

    .message-row {
      display: flex;
    }

    .message-row.mine {
      justify-content: flex-end;
    }

    .message-row.other {
      justify-content: flex-start;
    }

    .unread-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--status-warn-strong);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .unread-divider::before,
    .unread-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--status-divider);
    }

    .message-bubble {
      max-width: min(82%, 720px);
      padding: 12px 14px;
      border-radius: 20px;
      border: 1px solid var(--line-on-bubble);
      background: linear-gradient(180deg, var(--bubble-other-top), var(--bubble-other-bottom));
      box-shadow: var(--shadow-warm);
      word-break: break-word;
    }

    /* 新消息提示属于房间壳层浮动入口：用户正在补旧未读时提示可见，但不抢走当前视角。 */
    .jump-latest-button {
      position: absolute;
      right: 18px;
      bottom: 18px;
      z-index: 1;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line-on-accent);
      background: linear-gradient(135deg, var(--accent-hover) 0%, var(--accent-core) 100%);
      color: var(--text-on-accent);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.04),
        0 10px 24px rgba(224, 11, 65, 0.28);
    }

    .message-row.mine .message-bubble {
      background: linear-gradient(135deg, var(--bubble-mine-top) 0%, var(--bubble-mine-bottom) 100%);
    }

    .message-alias {
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* 输入区单独放在底部壳层栏位里，避免消息很多时把输入框重新挤回顶部。 */
    .composer-bar {
      display: grid;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--line-soft);
      border-radius: 24px;
      background:
        linear-gradient(180deg, var(--surface-panel-top), var(--surface-elevated-bottom)),
        var(--surface-elevated);
      box-shadow: var(--shadow-warm);
      backdrop-filter: blur(18px);
    }

    .composer-status {
      min-height: 18px;
      padding: 0 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .composer-status.attention {
      color: var(--status-warn-strong);
    }

    .shell-console-form {
      margin: 0;
    }

    /* 左侧辅助槽当前只是结构占位：先把唯一操作台骨架钉死，
       后续再按模式和功能逐步启用，不在这一步抢跑出第二套布局。 */
    .shell-console-aux-slot {
      display: none;
    }

    .composer-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    .composer-input {
      min-height: 50px;
      border-radius: 20px;
    }

    .send-button {
      min-width: 84px;
      min-height: 50px;
      border-radius: 20px;
    }

    @media (min-width: 768px) {
      .room-screen {
        padding-inline: clamp(4px, 2vw, 12px);
      }

      .message-bubble {
        max-width: min(70%, 760px);
      }
    }

    @media (max-width: 640px) {
      .home-card {
        padding: 18px;
        border-radius: 24px;
      }

      .join-row,
      .composer-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .room-screen {
        gap: 10px;
        padding-inline: 0;
      }

      .room-header {
        gap: 10px;
      }

      .back-button {
        min-width: 60px;
        padding-inline: 12px;
      }

      .message-bubble {
        max-width: 88%;
      }

      .send-button {
        min-width: 72px;
      }

      .jump-latest-button {
        right: 12px;
        bottom: 12px;
      }
    }
  `;

  private chatState: 聊天状态 = { ...初始聊天状态 };

  private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);

  /**
   * 房间阶段编排由状态机承载，聊天壳只消费它派生出的外观。
   * 这样 UI 改版时，就不必再顺手碰 bootstrap / 恢复 / 重连 的阶段逻辑。
   */
  private roomKernel = 创建房间内核();

  /**
   * 本地存储是壳层能力，不是领域能力。
   * 这里统一接一个端口，避免房间组件继续散落具体键名和浏览器 API 细节。
   */
  private storage: 前端存储端口 = 创建浏览器存储();

  private realtimeSocket: Socket | null = null;

  /**
   * 握手阶段的 invalid_session 可能在短时间内连续冒多次 connect_error。
   * 这里用一个很薄的门闩避免重复 bootstrap，把前端自己打成恢复风暴。
   */
  private socketInvalidSessionRecoveryTask: Promise<void> | null = null;

  private readAnchorFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private followLatestReadSampleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 只在“刷新恢复 / 快照重拉”这类恢复链路里，才允许首屏程序性补一次阅读锚点。
   * 首次手动进房仍然保持原语义，避免把恢复专用逻辑扩散到所有入口。
   */
  private shouldPrimeReadAnchorAfterInitialSettle = false;

  /**
   * 滚动器只处理 DOM 滚动副作用：
   * - 首屏定位
   * - 历史补偿
   * - 程序滚动隔离
   * - 已读采样
   */
  private roomScroller = new 房间滚动器(this, {
    读取状态: () => this.chatState,
    更新状态: (patch) => this.updateChat(patch),
    查询滚动容器: () =>
      (this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null) ?? null,
    查询消息节点: () =>
      Array.from(this.shadowRoot?.querySelectorAll("[data-event-position]") ?? []) as HTMLElement[],
    请求更早历史: () => {
      void this.loadOlderHistory();
    },
    采样阅读锚点: (position) => this.scheduleReadAnchorUpdate(position),
    读取是否需要恢复补锚: () => this.shouldPrimeReadAnchorAfterInitialSettle,
    消耗恢复补锚标记: () => {
      this.shouldPrimeReadAnchorAfterInitialSettle = false;
    },
    报告首屏稳定完成: (mode) => this.handleInitialSettleCompleted(mode),
  });

  setTransportForTest(transport: 前端传输端口): void {
    this.transport = transport;
  }

  private roomShellState() {
    return 派生房间壳外观(this.roomKernel.getSnapshot());
  }

  /**
   * `聊天状态` 里仍然保留消息流、滚动与输入态；
   * 但房间外观字段统一从状态机快照回填，避免壳层继续手拼会话阶段。
   */
  private roomShellPatch(): Pick<
    聊天状态,
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
  > {
    const roomShell = this.roomShellState();
    return {
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

  override connectedCallback(): void {
    super.connectedCallback();
    void this.bootstrap();
  }

  override disconnectedCallback(): void {
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingFollowLatestReadSample();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    super.disconnectedCallback();
  }

  private async bootstrap(): Promise<void> {
    try {
      const deviceAnonymousToken = this.storage.读取或创建设备匿名凭证();
      const roomId = this.storage.读取当前房间标识();
      this.syncHomeSessionItems();
      const identity = await this.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
      this.applyBootstrapIdentity(deviceAnonymousToken, identity);
      this.roomKernel.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: identity.session_id,
        displayAlias: identity.display_alias,
        roomId,
      });
      this.updateChat(this.roomShellPatch());
      this.ensureRealtimeSocket(identity.session_id);
      await this.restoreCurrentRoomIfNeeded();
    } catch (error) {
      this.roomKernel.send({
        type: "BOOTSTRAP_FAILED",
        code: this.asRecoveryFailure(error).code ?? "system_error",
      });
      this.syncHomeSessionItems();
      this.updateChat(this.roomShellPatch());
    } finally {
      await this.updateComplete;
      // 刷新恢复房间时，快照状态可能早于 roomView 真正渲染完成。
      // 因此 bootstrap 解锁后必须再补一次首屏定位调度，避免先对 bootView 做了无效定位。
      if (this.chatState.roomId && !this.chatState.initialUnreadSettled) {
        this.roomScroller.安排首屏定位();
      }
    }
  }

  private async joinRoom(): Promise<void> {
    const roomCode = this.chatState.roomCodeInput.trim();
    if (!roomCode) return;
    try {
      this.roomKernel.send({ type: "JOIN_REQUESTED" });
      this.ensureRealtimeSocket(this.chatState.sessionId);
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.joinOrCreateRoom(sessionId, roomCode)
      );
      // join-or-create 现在已经返回权威房间快照：
      // 这里直接消费 snapshot_messages，避免进房后再额外打一枪 snapshot，
      // 否则不仅浪费一次请求，还会人为拉大“进房成功”和“首屏可读”之间的竞态窗口。
      this.enterRoomFromSnapshot(snapshot, roomCode, false);
      this.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      this.handleRecoveryFailure(error, false);
    }
  }

  /**
   * 启动恢复顺序必须固定：
   * 1. bootstrap 拿到当前权威 session；
   * 2. 读取壳层记住的 room_id；
   * 3. 用当前 session 拉快照恢复。
   */
  private async restoreCurrentRoomIfNeeded(): Promise<void> {
    const roomId = this.storage.读取当前房间标识();
    if (!roomId) return;
    try {
      this.ensureRealtimeSocket(this.chatState.sessionId);
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.loadRoomSnapshot(roomId, sessionId)
      );
      this.enterRoomFromSnapshot(snapshot, undefined, true);
      this.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      this.handleRecoveryFailure(error, false);
    }
  }

  /**
   * 当 realtime 锚点闭合不了时，退回 HTTP 快照 + 增量补洞重建基线。
   * 这里继续沿用同一条权威锚点语义：`from = snapshot.latest_event_position`。
   */
  private async reloadRoomFromSnapshot(roomId: string): Promise<void> {
    if (!this.chatState.roomId || roomId !== this.chatState.roomId) return;
    try {
      this.roomScroller.取消挂起滚动副作用();
      this.ensureRealtimeSocket(this.chatState.sessionId);
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.loadRoomSnapshot(roomId, sessionId)
      );
      const delta = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.loadRoomEvents(roomId, sessionId, snapshot.latest_event_position)
      );
      const latestEventPosition = Math.max(
        snapshot.latest_event_position,
        delta.latest_event_position
      );
      const roomDisplayTitle = this.storage.读取当前房间短码() || "群聊房间";
      this.roomKernel.send({
        type: "SNAPSHOT_LOADED",
        roomId,
        roomDisplayTitle,
        latestEventPosition,
      });
      this.shouldPrimeReadAnchorAfterInitialSettle = true;
      this.updateChat({
        ...this.roomShellPatch(),
        lastReadEventPosition: snapshot.last_read_event_position,
        firstUnreadEventPosition: snapshot.first_unread_event_position,
        hasMoreBefore: snapshot.has_more_before,
        initialUnreadSettled: false,
        scrollPhase:
          snapshot.first_unread_event_position === null ? "idle" : "restoring_unread",
        hasUserScrollIntent: false,
        pendingReadAnchorPosition: null,
        // 重拉快照时，必须先回到快照自带的权威首屏，再叠加其后的增量。
        // 否则一旦同步链重建，房间又会退化成“只有未来消息、没有最近历史”的假空房。
        messages: this.reconcileMessages([...snapshot.snapshot_messages, ...delta.events]),
        pending: false,
        historyLoading: false,
        historyLoadThrottleUntil: 0,
        historyErrorCode: "",
      });
      this.roomScroller.安排首屏定位();
      this.subscribeRoom(latestEventPosition);
    } catch (error) {
      this.handleRecoveryFailure(error, true);
    }
  }

  private async sendMessage(): Promise<void> {
    if (!this.chatState.roomId || !this.chatState.messageInput.trim() || !this.realtimeSocket) return;
    const text = this.chatState.messageInput.trim();
    const clientMessageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}`;
    const optimistic = this.createOptimisticMessage(clientMessageId, text);
    this.updateChat({
      messages: this.reconcileMessages([...this.chatState.messages, optimistic]),
      messageInput: "",
      pending: true,
    });
    this.realtimeSocket.emit("send_text_message", {
      room_id: this.chatState.roomId,
      client_message_id: clientMessageId,
      text,
    });
  }

  private updateChat(patch: Partial<聊天状态>): void {
    this.chatState = { ...this.chatState, ...patch };
    this.requestUpdate();
  }

  /**
   * 首页历史只是一份壳层本地记忆。
   * 这里统一从存储刷新回状态，避免 UI 自己再推导一份第二真相。
   */
  private syncHomeSessionItems(): void {
    this.updateChat({
      homeSessionItems: this.storage.读取首页房间历史(),
    });
  }

  /**
   * 历史分页只负责“向更早方向补页”：
   * - 以当前最老消息的 event_position 作为锚点；
   * - 只往顶部追加，不动已经可见的消息；
   * - 与 snapshot / realtime 共用同一套合流逻辑，避免重复和乱序。
   */
  private async loadOlderHistory(): Promise<void> {
    if (!this.chatState.roomId || this.chatState.historyLoading || !this.chatState.hasMoreBefore) {
      return;
    }

    const beforeHeight = this.roomScroller.读取历史补偿基线();
    const oldestMessage = this.chatState.messages[0];
    if (!oldestMessage) {
      return;
    }

    this.updateChat({
      historyLoading: true,
      historyErrorCode: "",
    });

    try {
      const page = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.loadRoomHistory(
          this.chatState.roomId,
          sessionId,
          oldestMessage.event_position,
          55
        )
      );
      this.updateChat({
        messages: this.reconcileMessages([...page.messages, ...this.chatState.messages]),
        historyLoading: false,
        // 历史分页接口当前还只返回这一页消息本身：
        // 因此前端仍维持“拿到空页才确认到顶”的保守语义，不再额外猜首屏恢复真相。
        hasMoreBefore: page.messages.length > 0,
        historyErrorCode: "",
        scrollPhase: page.messages.length > 0 ? "compensating_history" : this.chatState.scrollPhase,
      });
      // 历史页是往列表顶部前插的；必须补偿前后 scrollHeight 差值，才能守住用户当前视口。
      // 这段滚动完全由程序发起，因此补偿和程序滚动隔离统一交给房间滚动器处理。
      await this.roomScroller.应用历史补偿(beforeHeight, page.messages.length > 0);
    } catch (error) {
      this.updateChat({
        historyLoading: false,
        historyErrorCode: this.asRecoveryFailure(error).code ?? "system_error",
        scrollPhase: this.chatState.scrollPhase === "compensating_history" ? "idle" : this.chatState.scrollPhase,
      });
    }
  }

  private applyBootstrapIdentity(
    deviceAnonymousToken: string,
    identity: {
      anonymous_identity_id: string;
      display_alias: string;
      session_id: string;
    }
  ): void {
    this.updateChat({
      deviceAnonymousToken,
      anonymousIdentityId: identity.anonymous_identity_id,
    });
  }

  /**
   * invalid_session 不是永久房间失效，而是“当前 session 失效，需要重新 bootstrap”。
   * 刷新后的新 session 建好后，再重试当前恢复步骤一次。
   */
  private async withSessionRefreshOnInvalid<T>(
    operation: (sessionId: string) => Promise<T>
  ): Promise<T> {
    try {
      return await operation(this.chatState.sessionId);
    } catch (error) {
      if (!this.isInvalidSessionError(error)) {
        throw error;
      }
      this.roomKernel.send({
        type: "RECONNECTING_STARTED",
        code: "invalid_session",
      });
      this.updateChat(this.roomShellPatch());
      const sessionId = await this.bootstrapFreshSession();
      return operation(sessionId);
    }
  }

  private async bootstrapFreshSession(): Promise<string> {
    const deviceAnonymousToken =
      this.chatState.deviceAnonymousToken || this.storage.读取或创建设备匿名凭证();
    const identity = await this.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.applyBootstrapIdentity(deviceAnonymousToken, identity);
    this.roomKernel.send({
      type: "SESSION_REFRESHED",
      sessionId: identity.session_id,
      displayAlias: identity.display_alias,
    });
    this.updateChat(this.roomShellPatch());
    this.ensureRealtimeSocket(identity.session_id);
    return identity.session_id;
  }

  /**
   * socket.io 的 connect_error 发生在握手阶段，此时 control_result 还不存在。
   * 因此 invalid_session 必须在这里直接转成“刷新 session 再恢复当前房间”的壳层动作。
   */
  private async handleRealtimeConnectError(error: unknown): Promise<void> {
    if (!this.isInvalidSessionError(error) || this.socketInvalidSessionRecoveryTask) {
      return;
    }
    const keepRoomVisible = Boolean(this.chatState.roomId);
    this.socketInvalidSessionRecoveryTask = (async () => {
      try {
        this.roomKernel.send({
          type: "RECONNECTING_STARTED",
          code: "invalid_session",
        });
        this.updateChat(this.roomShellPatch());
        await this.bootstrapFreshSession();
        if (this.chatState.roomId) {
          await this.reloadRoomFromSnapshot(this.chatState.roomId);
        }
      } catch (recoveryError) {
        if (keepRoomVisible) {
          this.handleRecoveryFailure(recoveryError, true);
        } else {
          this.roomKernel.send({
            type: "BOOTSTRAP_FAILED",
            code: this.recoveryCodeOf(recoveryError) ?? "system_error",
          });
          this.updateChat(this.roomShellPatch());
        }
      } finally {
        this.socketInvalidSessionRecoveryTask = null;
      }
    })();
    await this.socketInvalidSessionRecoveryTask;
  }

  /**
   * 房间页相关的壳层状态必须统一从这里清空，避免返回、硬失败、控制面拒绝各自散一份字面量。
   * 这里故意不碰身份和会话，只清“当前正在看的房间”这层视图事实。
   */
  private buildRoomViewResetPatch(): Partial<聊天状态> {
    return {
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
    };
  }

  /**
   * 退出当前房间视图时，必须同时收掉本地锚点和当前 socket。
   * 否则 UI 回到空态首页了，旧房间事件还在往壳层里灌，会制造“人已经离开房间但消息还在进来”的假状态。
   */
  private exitCurrentRoomView(
    opts: { keepRoomCodeCache: boolean } = {
      keepRoomCodeCache: true,
    }
  ): void {
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.storage.清除当前房间标识();
    if (!opts.keepRoomCodeCache) {
      this.storage.清除当前房间短码();
    }
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingFollowLatestReadSample();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = false;
    this.updateChat({
      ...this.buildRoomViewResetPatch(),
    });
  }

  /**
   * 返回空态首页是软离房，不是退群：
   * - 当前房间视图退出；
   * - 当前房间实时连接断开；
   * - 身份、会话和短码展示缓存保留。
   */
  private leaveCurrentRoomView(): void {
    this.roomKernel.send({ type: "SOFT_LEAVE_REQUESTED" });
    this.exitCurrentRoomView({ keepRoomCodeCache: true });
    this.updateChat(this.roomShellPatch());
  }

  /**
   * 首页历史删除边界必须非常窄：
   * - 只有明确的 `room_not_found`，才说明这条历史锚点已经失效；
   * - `membership_required` 仍然可能是有价值的历史房间，只是当前身份暂时进不去。
   */
  private pruneHomeSessionIfRoomMissing(code: string | undefined, roomIdHint = ""): void {
    if (code !== "room_not_found") {
      return;
    }
    const roomId = roomIdHint.trim() || this.chatState.roomId || this.storage.读取当前房间标识();
    if (!roomId) {
      return;
    }
    this.storage.按房间标识删除首页房间历史条目(roomId);
    this.syncHomeSessionItems();
  }

  /**
   * 硬失败要清 room 锚点并退出房间；临时失败则保留锚点，让用户还能重试。
   */
  private handleRecoveryFailure(error: unknown, keepRoomVisible: boolean): void {
    const failure = this.asRecoveryFailure(error);
    if (this.isHardRoomFailure(failure)) {
      this.pruneHomeSessionIfRoomMissing(failure.code);
      this.roomKernel.send({
        type: "RECOVERY_FAILED",
        code: failure.code ?? "",
        keepRoomVisible: false,
      });
      this.exitCurrentRoomView({ keepRoomCodeCache: false });
      this.updateChat(this.roomShellPatch());
      return;
    }

    this.roomKernel.send({
      type: "RECOVERY_FAILED",
      code: failure.code ?? "system_error",
      keepRoomVisible,
    });
    this.updateChat({
      ...this.roomShellPatch(),
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: keepRoomVisible ? this.chatState.hasUserScrollIntent : false,
    });
    this.roomScroller.取消挂起滚动副作用();
  }

  private async handleControlResult(control: 控制面结果): Promise<void> {
    if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
      this.roomKernel.send({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: control.latest_event_position,
      });
      this.updateChat(this.roomShellPatch());
      return;
    }

    if (control.kind === "need_snapshot_reload" && control.room_id) {
      await this.reloadRoomFromSnapshot(control.room_id);
      return;
    }

    if (control.kind !== "rejected" && control.kind !== "error") {
      return;
    }

    if (!this.chatState.roomId) {
      this.updateChat({ pending: false });
      return;
    }

    if (control.code === "invalid_session") {
      try {
        this.roomKernel.send({
          type: "RECONNECTING_STARTED",
          code: "invalid_session",
        });
        this.updateChat(this.roomShellPatch());
        await this.bootstrapFreshSession();
        await this.reloadRoomFromSnapshot(this.chatState.roomId);
      } catch (error) {
        this.handleRecoveryFailure(error, true);
      }
      return;
    }

    if (this.isHardRoomFailure(control)) {
      this.pruneHomeSessionIfRoomMissing(control.code, control.room_id ?? "");
      this.roomKernel.send({
        type: "RECOVERY_FAILED",
        code: control.code ?? "",
        keepRoomVisible: false,
      });
      this.exitCurrentRoomView({ keepRoomCodeCache: false });
      this.updateChat(this.roomShellPatch());
      return;
    }

    this.roomKernel.send({
      type: "RECOVERY_FAILED",
      code: control.code ?? "system_error",
      keepRoomVisible: true,
    });
    this.updateChat({
      ...this.roomShellPatch(),
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: this.chatState.hasUserScrollIntent,
    });
    this.roomScroller.取消挂起滚动副作用();
  }

  /**
   * 房间标题目前优先来自用户实际输入过的短码缓存。
   * 后端还没有返回房间名或短码时，壳层只能在“不泄露 room_id”和“不给用户空标题”之间取平衡。
   */
  private resolveRoomDisplayTitle(roomCodeForDisplay?: string): string {
    const trimmedRoomCode = roomCodeForDisplay?.trim() ?? "";
    if (trimmedRoomCode) {
      this.storage.写入当前房间短码(trimmedRoomCode);
      return trimmedRoomCode;
    }
    return this.storage.读取当前房间短码() || "群聊房间";
  }

  /**
   * 房间基线一旦成立，就统一从这里更新壳层状态与本地恢复锚点。
   * 这样 join / 刷新恢复 两条入口不会各自漂出一套写状态逻辑。
   */
  private enterRoomFromSnapshot(
    snapshot: 房间快照,
    roomCodeForDisplay?: string,
    primeReadAnchorAfterInitialSettle = false
  ): void {
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingFollowLatestReadSample();
    this.roomScroller.取消挂起滚动副作用();
    this.shouldPrimeReadAnchorAfterInitialSettle = primeReadAnchorAfterInitialSettle;
    this.storage.写入当前房间标识(snapshot.room_id);
    const roomDisplayTitle = this.resolveRoomDisplayTitle(roomCodeForDisplay);
    this.recordHomeSession(snapshot.room_id, roomCodeForDisplay?.trim() || this.storage.读取当前房间短码());
    this.roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: snapshot.room_id,
      roomDisplayTitle,
      latestEventPosition: snapshot.latest_event_position,
      viewportMode:
        snapshot.first_unread_event_position === null ? "贴底跟随" : "围绕未读阅读",
    });
    this.updateChat({
      ...this.roomShellPatch(),
      lastReadEventPosition: snapshot.last_read_event_position,
      firstUnreadEventPosition: snapshot.first_unread_event_position,
      hasMoreBefore: snapshot.has_more_before,
      initialUnreadSettled: false,
      // 只有带着首条未读恢复时，壳层才进入程序性恢复阶段；否则滚动语义直接保持 idle。
      scrollPhase:
        snapshot.first_unread_event_position === null ? "idle" : "restoring_unread",
      hasUserScrollIntent: false,
      pendingReadAnchorPosition: null,
      // snapshot_messages 是后端给出的权威房间基线，不是前端自己残留的缓存。
      // 只要快照成立，房间第一屏就应该直接可读，而不是先清空再等待未来增量。
      messages: this.reconcileMessages(snapshot.snapshot_messages),
      pending: false,
      historyLoading: false,
      historyLoadThrottleUntil: 0,
      historyErrorCode: "",
    });
    this.roomScroller.安排首屏定位();
  }

  /**
   * 只在房间基线成功成立后，才把它记进首页历史。
   * 这样软离房不会删历史，硬失败也不会留下半成品条目。
   */
  private recordHomeSession(roomId: string, roomCode: string): void {
    const trimmedRoomId = roomId.trim();
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomId || !trimmedRoomCode) {
      return;
    }
    const nextItem: 首页房间历史条目 = {
      roomId: trimmedRoomId,
      roomCode: trimmedRoomCode,
      lastEnteredAt: Date.now(),
    };
    this.storage.写入或更新首页房间历史条目(nextItem);
    this.syncHomeSessionItems();
  }

  private ensureRealtimeSocket(sessionId: string): void {
    if (this.realtimeSocket) return;
    const socket = this.transport.createSocket(sessionId);
    socket.on("connect", () => {
      if (this.chatState.roomId) {
        this.subscribeRoom(this.chatState.latestEventPosition);
      }
    });
    socket.on("connect_error", (error: unknown) => {
      void this.handleRealtimeConnectError(error);
    });
    socket.on("room_events", (events: { latest_event_position: number; events: 消息事件[] }) => {
      this.applyAuthoritativeEvents(events.events, events.latest_event_position);
    });
    socket.on("room_event", (event: 消息事件) => {
      this.applyAuthoritativeEvents([event], event.event_position);
    });
    socket.on("control_result", (control: 控制面结果) => {
      void this.handleControlResult(control);
    });
    this.realtimeSocket = socket;
  }

  private subscribeRoom(from: number): void {
    if (!this.chatState.roomId || !this.realtimeSocket) return;
    this.roomKernel.send({ type: "SUBSCRIPTION_STARTED" });
    this.realtimeSocket.emit("subscribe_room_stream", {
      room_id: this.chatState.roomId,
      from,
    });
  }

  private scheduleReadAnchorUpdate(nextPosition: number): void {
    this.roomKernel.send({
      type: "VIEWPORT_OBSERVED",
      candidateReadAnchorPosition: nextPosition,
      isNearBottom: this.isNearBottom(),
    });
    this.updateChat(this.roomShellPatch());
    this.promoteCandidateReadAnchorToPending();
  }

  /**
   * 候选已读锚点和“正式待提交”必须分两层：
   * - 候选只代表壳层观测到“用户大概率已经看到这里”；
   * - 只有当前房间已经处于稳定阅读阶段，才允许它进入真正的提交队列。
   */
  private promoteCandidateReadAnchorToPending(): void {
    if (!this.chatState.roomId || !this.chatState.initialUnreadSettled) {
      return;
    }
    if (this.chatState.scrollPhase !== "idle") {
      return;
    }
    const candidatePosition = this.chatState.candidateReadAnchorPosition;
    if (candidatePosition === null) {
      return;
    }
    const currentReadPosition = this.chatState.lastReadEventPosition ?? 0;
    const pendingPosition = this.chatState.pendingReadAnchorPosition ?? 0;
    const floor = Math.max(currentReadPosition, pendingPosition);
    if (candidatePosition <= floor) {
      return;
    }
    this.updateChat({
      pendingReadAnchorPosition: candidatePosition,
    });
    if (this.readAnchorFlushTimer !== null) {
      return;
    }
    this.readAnchorFlushTimer = setTimeout(() => {
      this.readAnchorFlushTimer = null;
      void this.flushReadAnchorUpdate();
    }, 阅读推进节流毫秒);
  }

  private async flushReadAnchorUpdate(): Promise<void> {
    const nextPosition = this.chatState.pendingReadAnchorPosition;
    if (!this.chatState.roomId || nextPosition === null) {
      return;
    }
    if (nextPosition <= (this.chatState.lastReadEventPosition ?? 0)) {
      this.updateChat({ pendingReadAnchorPosition: null });
      return;
    }
    try {
      await this.transport.updateRoomReadAnchor(
        this.chatState.roomId,
        this.chatState.sessionId,
        nextPosition
      );
      this.updateChat({
        lastReadEventPosition: nextPosition,
        pendingReadAnchorPosition: null,
        firstUnreadEventPosition:
          this.chatState.firstUnreadEventPosition !== null &&
          nextPosition >= this.chatState.firstUnreadEventPosition
            ? null
            : this.chatState.firstUnreadEventPosition,
      });
    } catch {
      // 阅读推进失败不应破坏当前房间内容；丢掉这次 pending，等待后续滚动再重试即可。
      this.updateChat({ pendingReadAnchorPosition: null });
    }
  }

  private cancelPendingReadAnchorFlush(): void {
    if (this.readAnchorFlushTimer === null) {
      return;
    }
    clearTimeout(this.readAnchorFlushTimer);
    this.readAnchorFlushTimer = null;
  }

  private cancelPendingFollowLatestReadSample(): void {
    if (this.followLatestReadSampleTimer === null) {
      return;
    }
    clearTimeout(this.followLatestReadSampleTimer);
    this.followLatestReadSampleTimer = null;
  }

  /**
   * 首屏稳定完成必须显式回灌给房间内核，而不是只在壳层里改一个布尔值。
   * 这样以后换模板、换滚动实现时，内核仍然能明确知道：
   * “当前房间已经从恢复阶段进入了可解释阅读语义的稳定状态。”
   */
  private handleInitialSettleCompleted(mode: 聊天状态["viewportMode"]): void {
    if (this.chatState.initialUnreadSettled) {
      return;
    }
    this.roomKernel.send({
      type: "INITIAL_SETTLE_COMPLETED",
      mode,
    });
    this.updateChat({
      ...this.roomShellPatch(),
      initialUnreadSettled: true,
      scrollPhase: "idle",
    });
    this.promoteCandidateReadAnchorToPending();
  }

  private applyAuthoritativeEvents(events: 消息事件[], latestEventPosition: number): void {
    const merged = this.reconcileMessages([...this.chatState.messages, ...events]);
    const shouldFollowLatest = this.chatState.viewportMode === "贴底跟随";
    this.roomKernel.send({
      type: "AUTHORITATIVE_EVENTS_ARRIVED",
      latestEventPosition,
    });
    this.updateChat({
      ...this.roomShellPatch(),
      messages: merged,
      pending: false,
    });
    if (shouldFollowLatest) {
      void this.followLatestAfterRealtimeAppend();
    }
  }

  /**
   * 贴底跟随只属于壳层体验：
   * - 用户本来就在底部，realtime 新消息到达后才允许继续跟底；
   * - 这不是后端真相，只是前端当前视口该怎么表现。
   */
  private async followLatestAfterRealtimeAppend(): Promise<void> {
    await this.scrollToLatestAndEnterFollowMode();
  }

  /**
   * “跳到最新”是纯壳层动作：
   * - 它只改变当前视口落点和本地视口模式；
   * - 真正的已读推进仍然由后续稳定采样 + 提交链决定。
   */
  private async jumpToLatest(): Promise<void> {
    await this.scrollToLatestAndEnterFollowMode();
  }

  private async scrollToLatestAndEnterFollowMode(): Promise<void> {
    await this.updateComplete;
    const scrollContainer = this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null;
    if (!scrollContainer) {
      return;
    }
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    this.roomKernel.send({ type: "USER_JUMPED_TO_LATEST" });
    this.updateChat(this.roomShellPatch());
    this.schedulePassiveReadAnchorAfterFollowLatest();
  }

  /**
   * 用户已经处在贴底跟随模式时，新消息进入视口本身就是一次真实阅读推进来源。
   * 这里额外等一个极短窗口，让 DOM 和布局先稳定，再复用滚动器的“稳定可读”采样。
   */
  private schedulePassiveReadAnchorAfterFollowLatest(): void {
    this.cancelPendingFollowLatestReadSample();
    this.followLatestReadSampleTimer = setTimeout(() => {
      this.followLatestReadSampleTimer = null;
      const nextReadPosition = this.roomScroller.读取当前可见阅读锚点();
      if (nextReadPosition === null) {
        return;
      }
      this.scheduleReadAnchorUpdate(nextReadPosition);
    }, 0);
  }

  /**
   * 贴底判断仍是壳层观测，不是业务真相。
   * 这里只回答“当前视口是否已经足够接近底部，可以允许新消息自然跟随”。
   */
  private isNearBottom(scrollContainer?: HTMLElement | null): boolean {
    const target =
      scrollContainer ??
      ((this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null) ?? null);
    if (!target) {
      return false;
    }
    return target.scrollHeight - target.clientHeight - target.scrollTop <= 24;
  }

  private observeViewport(scrollContainer: HTMLElement): void {
    this.roomKernel.send({
      type: "VIEWPORT_OBSERVED",
      candidateReadAnchorPosition: null,
      isNearBottom: this.isNearBottom(scrollContainer),
    });
    this.updateChat(this.roomShellPatch());
  }

  private createOptimisticMessage(clientMessageId: string, text: string): 消息事件 {
    return {
      type: "message_created",
      room_id: this.chatState.roomId,
      message_id: `local-${clientMessageId}`,
      client_message_id: clientMessageId,
      sender_session_id: this.chatState.sessionId,
      sender_display_alias: this.chatState.displayAlias,
      body: text,
      event_position: this.chatState.latestEventPosition + 1,
    };
  }

  private reconcileMessages(messages: 消息事件[]): 消息事件[] {
    const sorted = [...messages].sort((left, right) => left.event_position - right.event_position);
    const byClientMessageId = new Map<string, 消息事件>();
    const authoritativeByMessageId = new Map<string, 消息事件>();

    // 第一层按 client_message_id 收敛，解决“本地乐观态 later 被权威消息替换”的情况。
    for (const message of sorted) {
      const existing = byClientMessageId.get(message.client_message_id);
      byClientMessageId.set(
        message.client_message_id,
        existing ? this.pickPreferredMessage(existing, message) : message
      );
    }

    // 第二层按真正的 message_id 收敛，解决 snapshot / history / realtime
    // 三条路径把同一条权威消息重复送进壳层的问题。
    for (const message of byClientMessageId.values()) {
      if (message.message_id.startsWith("local-")) {
        continue;
      }
      const existing = authoritativeByMessageId.get(message.message_id);
      authoritativeByMessageId.set(
        message.message_id,
        existing ? this.pickPreferredMessage(existing, message) : message
      );
    }

    const out: 消息事件[] = [];
    const seenMessageIds = new Set<string>();
    for (const message of byClientMessageId.values()) {
      if (message.message_id.startsWith("local-")) {
        out.push(message);
        continue;
      }
      if (seenMessageIds.has(message.message_id)) {
        continue;
      }
      seenMessageIds.add(message.message_id);
      out.push(authoritativeByMessageId.get(message.message_id)!);
    }

    return out.sort((left, right) => left.event_position - right.event_position);
  }

  /**
   * 合流时优先保留更可信的那份：
   * - 权威消息覆盖本地乐观态；
   * - 事件位置更靠后的版本覆盖更早的副本；
   * - 若完全同位，则取新到的 candidate，保证最后一份统一写回。
   */
  private pickPreferredMessage(current: 消息事件, candidate: 消息事件): 消息事件 {
    const currentIsOptimistic = current.message_id.startsWith("local-");
    const candidateIsOptimistic = candidate.message_id.startsWith("local-");
    if (currentIsOptimistic !== candidateIsOptimistic) {
      return currentIsOptimistic ? candidate : current;
    }
    if (current.event_position !== candidate.event_position) {
      return current.event_position > candidate.event_position ? current : candidate;
    }
    return candidate;
  }

  private recoveryCodeOf(error: unknown): string | undefined {
    const failure = this.asRecoveryFailure(error);
    if (typeof failure.code === "string" && failure.code.trim()) {
      return failure.code;
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return undefined;
  }

  private isInvalidSessionError(error: unknown): boolean {
    return this.recoveryCodeOf(error) === "invalid_session";
  }

  private isHardRoomFailure(error: { code?: string; status?: number }): boolean {
    return (
      error.code === "room_not_found" ||
      error.code === "membership_required" ||
      error.status === 403 ||
      error.status === 404
    );
  }

  private asRecoveryFailure(error: unknown): 恢复失败 {
    if (error instanceof Http接口错误) {
      return error;
    }
    return error as 恢复失败;
  }

  private submitJoinForm(event: SubmitEvent): void {
    event.preventDefault();
    void this.joinRoom();
  }

  /**
   * 首页历史房间只是另一种“填入短码并进房”的入口，
   * 不能自己再旁路出第二套 join 逻辑。
   */
  private joinHistoryRoom(roomCode: string): void {
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomCode) {
      return;
    }
    this.updateChat({ roomCodeInput: trimmedRoomCode });
    void this.joinRoom();
  }

  private submitComposerForm(event: SubmitEvent): void {
    event.preventDefault();
    void this.sendMessage();
  }

  /**
   * boot 阶段必须让唯一操作台实体继续常驻，但这时它还没有可提交的业务目标。
   * 所以只保留同一套 form 骨架，显式阻止 submit 旁路到 join/send 主链。
   */
  private submitInactiveShellConsole(event: SubmitEvent): void {
    event.preventDefault();
  }

  /**
   * 这一步先只统一“身体”，不统一 presenter：
   * - boot / home / room 都用同一套操作台骨架；
   * - 输入语义仍然按当前壳层上下文切换；
   * - 先把 selector、常驻实体、不可交互边界锁住，再进入下一步视图模型收口。
   */
  private renderShellConsole(input: {
    mode: "hidden" | "join" | "message";
    statusText: string;
    statusAttention?: boolean;
  }) {
    const isMessageMode = input.mode === "message";
    const isHiddenMode = input.mode === "hidden";
    const primaryValue = isMessageMode
      ? this.chatState.messageInput
      : this.chatState.roomCodeInput;
    const primaryPlaceholder = isMessageMode ? "输入消息" : "房间短码";
    const primaryActionLabel = isMessageMode ? "发送" : "进房";
    const primaryActionDisabled = isHiddenMode || (isMessageMode && this.chatState.pending);
    const submitHandler = isHiddenMode
      ? this.submitInactiveShellConsole
      : isMessageMode
        ? this.submitComposerForm
        : this.submitJoinForm;
    const formId = isMessageMode ? "composerForm" : input.mode === "join" ? "joinForm" : "bootForm";

    return html`
      <footer id="shellConsole" class="composer-bar">
        <div id="shellConsoleStatus" class="composer-status ${input.statusAttention ? "attention" : ""}">
          ${input.statusText}
        </div>
        <form id=${formId} class="shell-console-form" @submit=${submitHandler}>
          <div
            id="shellConsoleMainRow"
            class=${isMessageMode ? "composer-row" : "join-row"}
            ?inert=${isHiddenMode}
          >
            <div
              id="shellConsoleAuxSlot"
              class="shell-console-aux-slot"
              aria-hidden="true"
              hidden
            ></div>
            <input
              id="shellConsolePrimaryInput"
              class=${isMessageMode ? "text-input composer-input" : "text-input"}
              placeholder=${primaryPlaceholder}
              enterkeyhint=${isMessageMode ? "send" : "go"}
              .value=${primaryValue}
              ?disabled=${isHiddenMode}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                if (isMessageMode) {
                  this.updateChat({ messageInput: target.value });
                  return;
                }
                this.updateChat({ roomCodeInput: target.value });
              }}
            />
            <button
              id="shellConsolePrimaryAction"
              class=${isMessageMode ? "primary-button send-button" : "primary-button"}
              type="submit"
              ?disabled=${primaryActionDisabled}
            >
              ${primaryActionLabel}
            </button>
          </div>
        </form>
      </footer>
    `;
  }

  override render() {
    const { recoveryHint, historyHint, subtitle: roomSubtitle } = 派生房间提示文案({
      recoveryState: this.chatState.recoveryState,
      roomId: this.chatState.roomId,
      displayAlias: this.chatState.displayAlias,
      historyLoading: this.chatState.historyLoading,
      historyErrorCode: this.chatState.historyErrorCode,
    });
    const jumpToLatestLabel = 派生跳到最新入口文案({
      viewportMode: this.chatState.viewportMode,
      hasUnreadNewerMessages: this.chatState.hasUnreadNewerMessages,
    });
    const roomShell = this.roomShellState();
    const shellView = 派生壳主舞台模式({
      bootstrapState: roomShell.bootstrapState,
      roomId: this.chatState.roomId,
    });
    const consoleMode = 派生控制台模式({
      bootstrapState: roomShell.bootstrapState,
      roomId: this.chatState.roomId,
    });
    const homeSessionViewItems = 派生首页会话展示项(this.chatState.homeSessionItems);
    const shellConsole = this.renderShellConsole({
      mode: consoleMode,
      statusText:
        consoleMode === "hidden"
          ? "正在恢复身份、会话和上次停留的房间，请稍等一下。"
          : consoleMode === "message"
            ? (recoveryHint || historyHint || "在这里输入消息，发送后会实时出现在房间里。")
            : "在这里输入房间短码，进入对应群聊空间。",
      statusAttention: consoleMode === "message" ? Boolean(recoveryHint || historyHint) : false,
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
              <div id="alias" class="join-meta">alias: ${this.chatState.displayAlias || "-"}</div>
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
                            @click=${() => this.joinHistoryRoom(item.roomCode)}
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
    return html`
      <section class="shell-screen">
        <section id="roomView" class="room-screen">
          <header id="roomHeader" class="room-header">
            <button id="backBtn" class="back-button" @click=${() => this.leaveCurrentRoomView()}>
              返回
            </button>
            <div class="room-heading">
              <div id="roomTitle" class="room-title">
                ${this.chatState.roomDisplayTitle || "群聊房间"}
              </div>
              <div id="roomSubtitle" class="room-subtitle">${roomSubtitle}</div>
            </div>
          </header>
          <div
            id="messageScroll"
            class="message-scroll"
            @pointerdown=${() => this.roomScroller.标记用户滚动意图()}
            @touchstart=${() => this.roomScroller.标记用户滚动意图()}
            @wheel=${() => this.roomScroller.标记用户滚动意图()}
            @scroll=${(event: Event) => {
              const target = event.currentTarget as HTMLElement;
              // 历史补偿基线依赖“本次滚动触发前的 scrollHeight”。
              // 因此必须先让滚动器处理补历史/采样，再做贴底观测，
              // 否则贴底观测提前读取 scrollHeight，会把补偿基线读脏。
              this.roomScroller.处理滚动事件(target);
              this.observeViewport(target);
            }}
          >
            <ul id="messageList" class="message-list">
              ${派生聊天列表展示项(
                this.chatState.messages,
                this.chatState.sessionId,
                this.chatState.firstUnreadEventPosition
              ).map((item) => {
                if (item.kind === "unread-divider") {
                  return html`
                    <li id="unreadDivider" class="unread-divider" data-kind="unread-divider">
                      ${item.label}
                    </li>
                  `;
                }
                return html`
                  <li
                    class="message-row ${item.owner}"
                    data-owner=${item.owner}
                    data-event-position=${item.eventPosition}
                  >
                    <article class="message-bubble">
                      ${item.showAlias
                        ? html`<div class="message-alias">${item.senderDisplayAlias}</div>`
                        : null}
                      <div class="message-body">${item.body}</div>
                    </article>
                  </li>
                `;
              })}
            </ul>
          </div>
          ${jumpToLatestLabel
            ? html`
                <button
                  id="jumpToLatestBtn"
                  class="jump-latest-button"
                  @click=${() => {
                    void this.jumpToLatest();
                  }}
                >
                  ${jumpToLatestLabel}
                </button>
              `
            : null}
        </section>
        ${shellConsole}
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
