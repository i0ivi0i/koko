import { css, html, LitElement } from "lit";
import type { 房间快照, 消息事件 } from "./契约.js";
import { Http接口错误, HttpRealtime传输, type 前端传输端口 } from "./传输.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import { 派生聊天列表展示项 } from "./视图.js";
import type { Socket } from "socket.io-client";

const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";
const 当前房间短码存储键 = "koko_current_room_code";
const 历史分页顶部节流毫秒 = 180;
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
      --surface-canvas: #171312;
      --surface-panel: #211b19;
      --surface-elevated: #2a2321;
      --surface-soft: #332a27;
      --surface-overlay: rgba(42, 35, 33, 0.92);
      --surface-input: rgba(36, 30, 28, 0.96);
      --surface-nav: rgba(46, 38, 35, 0.92);
      --surface-scroll: rgba(19, 16, 15, 0.46);
      --surface-panel-top: rgba(49, 40, 37, 0.94);
      --surface-panel-bottom: rgba(31, 26, 24, 0.96);
      --surface-elevated-bottom: rgba(35, 29, 27, 0.96);
      --bubble-other-top: rgba(57, 47, 43, 0.98);
      --bubble-other-bottom: rgba(42, 35, 33, 0.98);
      --bubble-mine-top: rgba(255, 56, 92, 0.24);
      --bubble-mine-bottom: rgba(98, 36, 51, 0.92);
      --text-primary: #f6ede9;
      --text-secondary: #cfbdb6;
      --text-muted: #9f8d86;
      --text-on-accent: #fff7f9;
      --accent-core: #ff385c;
      --accent-pressed: #e00b41;
      --accent-hover: #ff5674;
      --accent-glow: rgba(255, 56, 92, 0.22);
      --line-soft: rgba(255, 255, 255, 0.08);
      --line-strong: rgba(255, 255, 255, 0.14);
      --line-accent-soft: rgba(255, 188, 146, 0.16);
      --line-on-accent: rgba(255, 255, 255, 0.06);
      --line-on-bubble: rgba(255, 255, 255, 0.04);
      --status-warn-bg: rgba(88, 55, 34, 0.9);
      --status-warn-text: #ffd7b8;
      --status-warn-strong: #ffbea2;
      --status-divider: rgba(255, 188, 146, 0.38);
      --shadow-warm:
        rgba(0, 0, 0, 0.18) 0px 0px 0px 1px,
        rgba(0, 0, 0, 0.24) 0px 10px 24px,
        rgba(0, 0, 0, 0.34) 0px 18px 40px;
      display: block;
      height: 100%;
      min-height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(circle at top, rgba(255, 56, 92, 0.16), transparent 28%),
        radial-gradient(circle at 80% 18%, rgba(118, 35, 55, 0.3), transparent 22%),
        linear-gradient(180deg, #171312 0%, #1b1615 54%, #141010 100%);
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

    .join-screen {
      height: 100%;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    /* bootstrap 未完成时只展示一层中性壳，避免刷新恢复房间时先闪出搜索页。 */
    .boot-screen {
      height: 100%;
      min-height: 100dvh;
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

    .join-card {
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
      min-height: 100dvh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 12px;
      padding: 12px 14px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
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
        padding-inline: clamp(18px, 4vw, 36px);
      }

      .message-bubble {
        max-width: min(70%, 760px);
      }
    }

    @media (max-width: 640px) {
      .join-card {
        padding: 18px;
        border-radius: 24px;
      }

      .join-row,
      .composer-row {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .room-screen {
        gap: 10px;
        padding-inline: 10px;
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
    }
  `;

  private chatState: 聊天状态 = { ...初始聊天状态 };

  private bootstrapState: "booting" | "ready" = "booting";

  private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);

  private realtimeSocket: Socket | null = null;

  private readAnchorFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private scrollPhaseReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  setTransportForTest(transport: 前端传输端口): void {
    this.transport = transport;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.bootstrap();
  }

  override disconnectedCallback(): void {
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingScrollPhaseRelease();
    super.disconnectedCallback();
  }

  private async bootstrap(): Promise<void> {
    try {
      const deviceAnonymousToken = this.readOrCreateDeviceAnonymousToken();
      const identity = await this.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
      this.applyBootstrapIdentity(deviceAnonymousToken, identity);
      this.ensureRealtimeSocket(identity.session_id);
      await this.restoreCurrentRoomIfNeeded();
    } catch (error) {
      this.updateChat({
        recoveryState: "retryable_failure",
        lastRecoveryErrorCode: this.asRecoveryFailure(error).code ?? "system_error",
      });
    } finally {
      this.bootstrapState = "ready";
      this.requestUpdate();
    }
  }

  private async joinRoom(): Promise<void> {
    const roomCode = this.chatState.roomCodeInput.trim();
    if (!roomCode) return;
    try {
      this.ensureRealtimeSocket(this.chatState.sessionId);
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.joinOrCreateRoom(sessionId, roomCode)
      );
      // join-or-create 现在已经返回权威房间快照：
      // 这里直接消费 snapshot_messages，避免进房后再额外打一枪 snapshot，
      // 否则不仅浪费一次请求，还会人为拉大“进房成功”和“首屏可读”之间的竞态窗口。
      this.enterRoomFromSnapshot(snapshot, roomCode);
      this.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      this.handleRecoveryFailure(this.chatState.roomId || this.readCurrentRoomId(), error, false);
    }
  }

  /**
   * 启动恢复顺序必须固定：
   * 1. bootstrap 拿到当前权威 session；
   * 2. 读取壳层记住的 room_id；
   * 3. 用当前 session 拉快照恢复。
   */
  private async restoreCurrentRoomIfNeeded(): Promise<void> {
    const roomId = this.readCurrentRoomId();
    if (!roomId) return;
    try {
      this.ensureRealtimeSocket(this.chatState.sessionId);
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.loadRoomSnapshot(roomId, sessionId)
      );
      this.enterRoomFromSnapshot(snapshot);
      this.subscribeRoom(snapshot.latest_event_position);
    } catch (error) {
      this.handleRecoveryFailure(roomId, error, false);
    }
  }

  /**
   * 当 realtime 锚点闭合不了时，退回 HTTP 快照 + 增量补洞重建基线。
   * 这里继续沿用同一条权威锚点语义：`from = snapshot.latest_event_position`。
   */
  private async reloadRoomFromSnapshot(roomId: string): Promise<void> {
    if (!this.chatState.roomId || roomId !== this.chatState.roomId) return;
    try {
      this.cancelPendingScrollPhaseRelease();
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
      const roomDisplayTitle = this.readCurrentRoomCode() || "群聊房间";
      this.updateChat({
        roomId: roomId,
        roomDisplayTitle,
        latestEventPosition,
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
        recoveryState: "idle",
        lastRecoveryErrorCode: "",
      });
      this.scheduleInitialUnreadSettle();
      this.subscribeRoom(latestEventPosition);
    } catch (error) {
      this.handleRecoveryFailure(roomId, error, true);
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
   * 历史分页只负责“向更早方向补页”：
   * - 以当前最老消息的 event_position 作为锚点；
   * - 只往顶部追加，不动已经可见的消息；
   * - 与 snapshot / realtime 共用同一套合流逻辑，避免重复和乱序。
   */
  private async loadOlderHistory(): Promise<void> {
    if (!this.chatState.roomId || this.chatState.historyLoading || !this.chatState.hasMoreBefore) {
      return;
    }

    const scrollContainer = this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null;
    const beforeHeight = scrollContainer?.scrollHeight ?? 0;
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
      if (page.messages.length > 0 && scrollContainer) {
        // 历史页是往列表顶部前插的；补偿前后 scrollHeight 差值，才能守住用户当前视口。
        // 这段滚动完全由程序发起，因此必须暂时隔离出“用户阅读滚动”语义。
        await this.updateComplete;
        const afterHeight = scrollContainer.scrollHeight;
        scrollContainer.scrollTop += afterHeight - beforeHeight;
        this.scheduleScrollPhaseRelease("compensating_history");
      }
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
      displayAlias: identity.display_alias,
      sessionId: identity.session_id,
      recoveryState: "idle",
      lastRecoveryErrorCode: "",
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
      this.updateChat({
        recoveryState: "reconnecting",
        lastRecoveryErrorCode: "invalid_session",
      });
      const sessionId = await this.bootstrapFreshSession();
      return operation(sessionId);
    }
  }

  private async bootstrapFreshSession(): Promise<string> {
    const deviceAnonymousToken = this.chatState.deviceAnonymousToken || this.readOrCreateDeviceAnonymousToken();
    const identity = await this.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.applyBootstrapIdentity(deviceAnonymousToken, identity);
    this.ensureRealtimeSocket(identity.session_id);
    return identity.session_id;
  }

  /**
   * 房间页相关的壳层状态必须统一从这里清空，避免返回、硬失败、控制面拒绝各自散一份字面量。
   * 这里故意不碰身份和会话，只清“当前正在看的房间”这层视图事实。
   */
  private buildRoomViewResetPatch(): Partial<聊天状态> {
    return {
      roomId: "",
      roomDisplayTitle: "",
      messageInput: "",
      latestEventPosition: 0,
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
      recoveryState: "idle",
      lastRecoveryErrorCode: "",
    };
  }

  /**
   * 退出当前房间视图时，必须同时收掉本地锚点和当前 socket。
   * 否则 UI 回到搜索页了，旧房间事件还在往壳层里灌，会制造“人已经离开房间但消息还在进来”的假状态。
   */
  private exitCurrentRoomView(
    opts: { keepRoomCodeCache: boolean; lastRecoveryErrorCode?: string } = {
      keepRoomCodeCache: true,
    }
  ): void {
    this.realtimeSocket?.disconnect();
    this.realtimeSocket = null;
    this.clearCurrentRoomId();
    if (!opts.keepRoomCodeCache) {
      this.clearCurrentRoomCode();
    }
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingScrollPhaseRelease();
    this.updateChat({
      ...this.buildRoomViewResetPatch(),
      lastRecoveryErrorCode: opts.lastRecoveryErrorCode ?? "",
    });
  }

  /**
   * 返回搜索页是软离房，不是退群：
   * - 当前房间视图退出；
   * - 当前房间实时连接断开；
   * - 身份、会话和短码展示缓存保留。
   */
  private leaveCurrentRoomView(): void {
    this.exitCurrentRoomView({ keepRoomCodeCache: true });
  }

  /**
   * 硬失败要清 room 锚点并退出房间；临时失败则保留锚点，让用户还能重试。
   */
  private handleRecoveryFailure(
    roomId: string,
    error: unknown,
    keepRoomVisible: boolean
  ): void {
    const failure = this.asRecoveryFailure(error);
    if (this.isHardRoomFailure(failure)) {
      this.exitCurrentRoomView({
        keepRoomCodeCache: false,
        lastRecoveryErrorCode: failure.code ?? "",
      });
      return;
    }

    this.updateChat({
      roomId: keepRoomVisible ? roomId : "",
      roomDisplayTitle: keepRoomVisible ? this.chatState.roomDisplayTitle : "",
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: keepRoomVisible ? this.chatState.hasUserScrollIntent : false,
      recoveryState: "retryable_failure",
      lastRecoveryErrorCode: failure.code ?? "system_error",
    });
    this.cancelPendingScrollPhaseRelease();
  }

  private async handleControlResult(control: 控制面结果): Promise<void> {
    if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
      this.updateChat({
        latestEventPosition: control.latest_event_position,
        recoveryState: "idle",
        lastRecoveryErrorCode: "",
      });
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
        await this.bootstrapFreshSession();
        await this.reloadRoomFromSnapshot(this.chatState.roomId);
      } catch (error) {
        this.handleRecoveryFailure(this.chatState.roomId, error, true);
      }
      return;
    }

    if (this.isHardRoomFailure(control)) {
      this.exitCurrentRoomView({
        keepRoomCodeCache: false,
        lastRecoveryErrorCode: control.code ?? "",
      });
      return;
    }

    this.updateChat({
      pending: false,
      historyLoading: false,
      scrollPhase: "idle",
      hasUserScrollIntent: this.chatState.hasUserScrollIntent,
      recoveryState: "retryable_failure",
      lastRecoveryErrorCode: control.code ?? "system_error",
    });
    this.cancelPendingScrollPhaseRelease();
  }

  /**
   * 设备入口凭证只属于壳层：
   * - Web 当前用 localStorage 持久化；
   * - 未来移动端和 CLI 可以换成各自的本地存储；
   * - 业务核心只消费这个凭证换回后端权威身份。
   */
  private readOrCreateDeviceAnonymousToken(): string {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    const stored =
      storage && typeof storage.getItem === "function"
        ? storage.getItem(设备匿名凭证存储键)
        : null;
    if (stored && stored.trim()) {
      return stored;
    }

    const generated =
      typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(设备匿名凭证存储键, generated);
    }
    return generated;
  }

  private readCurrentRoomId(): string {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    const stored =
      storage && typeof storage.getItem === "function"
        ? storage.getItem(当前房间存储键)
        : null;
    return stored?.trim() ? stored : "";
  }

  private writeCurrentRoomId(roomId: string): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(当前房间存储键, roomId);
    }
  }

  private readCurrentRoomCode(): string {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    const stored =
      storage && typeof storage.getItem === "function"
        ? storage.getItem(当前房间短码存储键)
        : null;
    return stored?.trim() ? stored : "";
  }

  private writeCurrentRoomCode(roomCode: string): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(当前房间短码存储键, roomCode);
    }
  }

  private clearCurrentRoomId(): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem(当前房间存储键);
    }
  }

  private clearCurrentRoomCode(): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem(当前房间短码存储键);
    }
  }

  /**
   * 房间标题目前优先来自用户实际输入过的短码缓存。
   * 后端还没有返回房间名或短码时，壳层只能在“不泄露 room_id”和“不给用户空标题”之间取平衡。
   */
  private resolveRoomDisplayTitle(roomCodeForDisplay?: string): string {
    const trimmedRoomCode = roomCodeForDisplay?.trim() ?? "";
    if (trimmedRoomCode) {
      this.writeCurrentRoomCode(trimmedRoomCode);
      return trimmedRoomCode;
    }
    return this.readCurrentRoomCode() || "群聊房间";
  }

  /**
   * 房间基线一旦成立，就统一从这里更新壳层状态与本地恢复锚点。
   * 这样 join / 刷新恢复 两条入口不会各自漂出一套写状态逻辑。
   */
  private enterRoomFromSnapshot(snapshot: 房间快照, roomCodeForDisplay?: string): void {
    this.cancelPendingReadAnchorFlush();
    this.cancelPendingScrollPhaseRelease();
    this.writeCurrentRoomId(snapshot.room_id);
    const roomDisplayTitle = this.resolveRoomDisplayTitle(roomCodeForDisplay);
    this.updateChat({
      roomId: snapshot.room_id,
      roomDisplayTitle,
      latestEventPosition: snapshot.latest_event_position,
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
      recoveryState: "idle",
      lastRecoveryErrorCode: "",
    });
    this.scheduleInitialUnreadSettle();
  }

  /**
   * 首屏未读定位和历史前插补偿是两套完全不同的逻辑：
   * - 这里仅处理“刚恢复房间时，把视口落到第一条未读附近”；
   * - 不推进阅读真相，也不做历史分页补偿。
   */
  private scheduleInitialUnreadSettle(): void {
    queueMicrotask(() => {
      void this.settleInitialUnreadAnchor();
    });
  }

  private async settleInitialUnreadAnchor(): Promise<void> {
    if (this.chatState.initialUnreadSettled) {
      return;
    }
    await this.updateComplete;
    if (this.chatState.initialUnreadSettled) {
      return;
    }
    const firstUnreadEventPosition = this.chatState.firstUnreadEventPosition;
    if (firstUnreadEventPosition === null) {
      const scrollContainer = this.shadowRoot?.querySelector("#messageScroll") as HTMLElement | null;
      if (scrollContainer) {
        // “没有未读分隔条”不等于应该停在顶部：
        // 这通常代表“全部已读”或“当前窗口只需要展示最近消息”，
        // 因此前端要把视口落到这批首屏消息的底部，也就是最新消息附近。
        scrollContainer.scrollTop = Math.max(
          0,
          scrollContainer.scrollHeight - scrollContainer.clientHeight
        );
      }
      this.updateChat({
        initialUnreadSettled: true,
        scrollPhase: "idle",
      });
      return;
    }
    const target = this.shadowRoot?.querySelector(
      `[data-event-position="${firstUnreadEventPosition}"]`
    ) as HTMLElement | null;
    if (!target) {
      this.updateChat({
        initialUnreadSettled: true,
        scrollPhase: "idle",
      });
      return;
    }
    target.scrollIntoView?.({ block: "center" });
    // 首屏恢复滚动是程序行为，不应立刻放行给“已读推进 / 顶部分页”解释。
    // 这里延后一拍再回到 idle，让浏览器随后抛出的 scroll 先被壳层隔离掉。
    this.scheduleScrollPhaseRelease("restoring_unread", {
      initialUnreadSettled: true,
    });
  }

  private ensureRealtimeSocket(sessionId: string): void {
    if (this.realtimeSocket) return;
    const socket = this.transport.createSocket(sessionId);
    socket.on("connect", () => {
      if (this.chatState.roomId) {
        this.subscribeRoom(this.chatState.latestEventPosition);
      }
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
    this.realtimeSocket.emit("subscribe_room_stream", {
      room_id: this.chatState.roomId,
      from,
    });
  }

  /**
   * 顶部历史分页要防止“已经在顶端时的连续回弹”打出重复请求。
   * 因此这里先做节流门禁，再进入真正的历史加载逻辑。
   */
  private maybeLoadOlderHistory(scrollContainer: HTMLElement): void {
    if (
      scrollContainer.scrollTop > 0 ||
      this.chatState.scrollPhase !== "idle" ||
      !this.chatState.hasUserScrollIntent
    ) {
      return;
    }
    const now = Date.now();
    if (now < this.chatState.historyLoadThrottleUntil) {
      return;
    }
    this.updateChat({
      historyLoadThrottleUntil: now + 历史分页顶部节流毫秒,
    });
    void this.loadOlderHistory();
  }

  /**
   * 阅读推进必须基于“当前视口里真正读到哪一条消息”：
   * 1. 首屏恢复期间仍然不能误把未读批量推进成已读；
   * 2. 上滑补历史时只能单调前进，不能把顶部旧消息写成新的阅读真相；
   * 3. 用户停在中段刷新时，后端要能拿到准确的 last_read_event_position，
   *    否则小房间会直接退化成“整房都在首屏里，于是回到最老消息附近”的错误体验。
   */
  private maybeTrackReadAnchor(scrollContainer: HTMLElement): void {
    if (
      !this.chatState.roomId ||
      !this.chatState.initialUnreadSettled ||
      this.chatState.historyLoading ||
      this.chatState.scrollPhase !== "idle" ||
      !this.chatState.hasUserScrollIntent
    ) {
      return;
    }
    const nextReadPosition = this.findVisibleReadAnchorPosition(scrollContainer);
    if (nextReadPosition === null) {
      return;
    }
    this.scheduleReadAnchorUpdate(nextReadPosition);
  }

  /**
   * 只把“完整进入当前滚动视口”的最后一条消息视作已读：
   * - 刚露出一点的下一条未读，不应被过早推进；
   * - 这样 last_read / first_unread 的边界才会稳定停在真实阅读断点上。
   */
  private findVisibleReadAnchorPosition(scrollContainer: HTMLElement): number | null {
    const containerRect = scrollContainer.getBoundingClientRect();
    const messageRows = Array.from(
      this.shadowRoot?.querySelectorAll("[data-event-position]") ?? []
    ) as HTMLElement[];
    let nextReadPosition: number | null = null;
    for (const row of messageRows) {
      const rawEventPosition = row.dataset.eventPosition;
      if (!rawEventPosition) {
        continue;
      }
      const eventPosition = Number(rawEventPosition);
      if (!Number.isFinite(eventPosition)) {
        continue;
      }
      const rowRect = row.getBoundingClientRect();
      const fullyVisible =
        rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom;
      if (!fullyVisible) {
        continue;
      }
      nextReadPosition =
        nextReadPosition === null ? eventPosition : Math.max(nextReadPosition, eventPosition);
    }
    return nextReadPosition;
  }

  private scheduleReadAnchorUpdate(nextPosition: number): void {
    const currentReadPosition = this.chatState.lastReadEventPosition ?? 0;
    const pendingPosition = this.chatState.pendingReadAnchorPosition ?? 0;
    const floor = Math.max(currentReadPosition, pendingPosition);
    if (nextPosition <= floor) {
      return;
    }
    this.updateChat({ pendingReadAnchorPosition: nextPosition });
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

  /**
   * 壳层只在一个很短的窗口里隔离程序性滚动：
   * - 这不是业务状态，不会进入共享契约；
   * - 目的只是把浏览器随后抛出的 scroll 事件吞掉，避免误判成用户阅读。
   */
  private scheduleScrollPhaseRelease(
    expectedPhase: 聊天状态["scrollPhase"],
    patch: Partial<聊天状态> = {}
  ): void {
    this.cancelPendingScrollPhaseRelease();
    this.scrollPhaseReleaseTimer = setTimeout(() => {
      this.scrollPhaseReleaseTimer = null;
      if (this.chatState.scrollPhase !== expectedPhase) {
        return;
      }
      this.updateChat({
        ...patch,
        scrollPhase: "idle",
      });
    }, 0);
  }

  private cancelPendingScrollPhaseRelease(): void {
    if (this.scrollPhaseReleaseTimer === null) {
      return;
    }
    clearTimeout(this.scrollPhaseReleaseTimer);
    this.scrollPhaseReleaseTimer = null;
  }

  /**
   * 只有用户真的开始拖动 / 触摸 / 滚轮滚动后，后续 scroll 才能被解释成阅读或翻页意图。
   * 这样不同浏览器对程序性 scroll 的事件时序差异，就不会再把刷新恢复误判成“用户在往上翻历史”。
   */
  private markUserScrollIntent(): void {
    if (this.chatState.hasUserScrollIntent) {
      return;
    }
    this.updateChat({ hasUserScrollIntent: true });
  }

  private applyAuthoritativeEvents(events: 消息事件[], latestEventPosition: number): void {
    const merged = this.reconcileMessages([...this.chatState.messages, ...events]);
    this.updateChat({
      messages: merged,
      latestEventPosition: Math.max(this.chatState.latestEventPosition, latestEventPosition),
      pending: false,
      recoveryState: "idle",
      lastRecoveryErrorCode: "",
    });
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

  private recoveryHintText(): string {
    if (this.chatState.recoveryState === "reconnecting") {
      return "会话已刷新，正在重新恢复";
    }
    if (this.chatState.recoveryState !== "retryable_failure") {
      return "";
    }
    return this.chatState.roomId ? "实时连接暂不可用，可稍后重试" : "恢复失败，可稍后重试";
  }

  private historyHintText(): string {
    if (this.chatState.historyLoading) {
      return "正在加载更早消息";
    }
    if (this.chatState.historyErrorCode) {
      return "更早消息加载失败，可继续上滑重试";
    }
    return "";
  }

  /**
   * 房间副标题是纯壳层展示槽位：
   * - 优先承接当前最重要的即时状态提示；
   * - 没有异常提示时，再退回到“你当前是谁”这种稳定辅助信息。
   * 这样顶部信息区就不会在正常态和异常态之间反复跳出额外面板。
   */
  private roomSubtitleText(recoveryHint: string, historyHint: string): string {
    if (recoveryHint) {
      return recoveryHint;
    }
    if (historyHint) {
      return historyHint;
    }
    return this.chatState.displayAlias
      ? `当前匿名身份：${this.chatState.displayAlias}`
      : "群聊房间";
  }

  private isInvalidSessionError(error: unknown): boolean {
    return this.asRecoveryFailure(error).code === "invalid_session";
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

  override render() {
    const recoveryHint = this.recoveryHintText();
    const historyHint = this.historyHintText();
    if (this.bootstrapState === "booting") {
      return html`
        <section id="bootView" class="boot-screen">
          <div class="boot-card">
            <h1 class="boot-title">正在回到聊天空间</h1>
            <p class="boot-subtitle">正在恢复身份、会话和上次停留的房间，请稍等一下。</p>
          </div>
        </section>
      `;
    }
    if (!this.chatState.roomId) {
      return html`
        <section id="joinView" class="join-screen">
          <div class="join-card">
            <h1 class="join-title">进入群聊房间</h1>
            <p class="join-subtitle">输入房间短码后进入当前聊天空间，身份和会话会继续沿用。</p>
            <div id="alias" class="join-meta">alias: ${this.chatState.displayAlias || "-"}</div>
          ${recoveryHint ? html`<div id="recoveryHint" class="hint">${recoveryHint}</div>` : null}
            <div class="join-row">
              <input
                id="roomCode"
                class="text-input"
                placeholder="房间短码"
                .value=${this.chatState.roomCodeInput}
                @input=${(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  this.updateChat({ roomCodeInput: target.value });
                }}
              />
              <button id="joinBtn" class="primary-button" @click=${() => this.joinRoom()}>
                进房
              </button>
            </div>
          </div>
        </section>
      `;
    }

    const roomSubtitle = this.roomSubtitleText(recoveryHint, historyHint);
    const statusAttention = Boolean(recoveryHint || historyHint);

    return html`
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
          @pointerdown=${() => this.markUserScrollIntent()}
          @touchstart=${() => this.markUserScrollIntent()}
          @wheel=${() => this.markUserScrollIntent()}
          @scroll=${(event: Event) => {
            const target = event.currentTarget as HTMLElement;
            this.maybeLoadOlderHistory(target);
            this.maybeTrackReadAnchor(target);
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
        <footer id="composerBar" class="composer-bar">
          <div class="composer-status ${statusAttention ? "attention" : ""}">
            ${statusAttention ? roomSubtitle : "在这里输入消息，发送后会实时出现在房间里。"}
          </div>
          <div class="composer-row">
            <input
              id="msgInput"
              class="text-input composer-input"
              placeholder="输入消息"
              .value=${this.chatState.messageInput}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                this.updateChat({ messageInput: target.value });
              }}
            />
            <button
              id="sendBtn"
              class="primary-button send-button"
              ?disabled=${this.chatState.pending}
              @click=${() => this.sendMessage()}
            >
              发送
            </button>
          </div>
        </footer>
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
