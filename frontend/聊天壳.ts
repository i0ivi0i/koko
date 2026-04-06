import { css, html, LitElement } from "lit";
import type { 消息事件 } from "./契约.js";
import { Http接口错误, HttpRealtime传输, type 前端传输端口 } from "./传输.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import { 派生消息展示项 } from "./视图.js";
import type { Socket } from "socket.io-client";

const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";

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
      display: block;
      padding: 16px;
      font-family: "Microsoft YaHei", sans-serif;
      color: #1f2937;
    }

    .row {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
    }

    button {
      padding: 8px 12px;
      border: 0;
      border-radius: 10px;
      background: #2563eb;
      color: white;
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .panel {
      max-width: 720px;
    }

    .meta {
      margin-bottom: 12px;
      color: #475569;
    }

    .hint {
      margin: 10px 0 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #fff7ed;
      color: #9a3412;
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 0;
      margin: 16px 0 0;
      list-style: none;
    }

    .message-scroll {
      max-height: 420px;
      overflow-y: auto;
      padding-right: 4px;
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

    .message-bubble {
      max-width: min(80%, 520px);
      padding: 10px 12px;
      border-radius: 16px;
      background: #e2e8f0;
      word-break: break-word;
    }

    .message-row.mine .message-bubble {
      background: #dbeafe;
    }

    .message-alias {
      margin-bottom: 4px;
      font-size: 12px;
      color: #64748b;
    }
  `;

  private chatState: 聊天状态 = { ...初始聊天状态 };

  private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);

  private realtimeSocket: Socket | null = null;

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
    super.disconnectedCallback();
  }

  private async bootstrap(): Promise<void> {
    const deviceAnonymousToken = this.readOrCreateDeviceAnonymousToken();
    const identity = await this.transport.bootstrapAnonymousIdentity(deviceAnonymousToken);
    this.applyBootstrapIdentity(deviceAnonymousToken, identity);
    this.ensureRealtimeSocket(identity.session_id);
    await this.restoreCurrentRoomIfNeeded();
  }

  private async joinRoom(): Promise<void> {
    const roomCode = this.chatState.roomCodeInput.trim();
    if (!roomCode) return;
    try {
      const snapshot = await this.withSessionRefreshOnInvalid((sessionId) =>
        this.transport.joinOrCreateRoom(sessionId, roomCode)
      );
      // join-or-create 现在已经返回权威房间快照：
      // 这里直接消费 recent_messages，避免进房后再额外打一枪 snapshot，
      // 否则不仅浪费一次请求，还会人为拉大“进房成功”和“首屏可读”之间的竞态窗口。
      this.enterRoomFromSnapshot(snapshot);
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
      this.updateChat({
        roomId: roomId,
        latestEventPosition,
        // 重拉快照时，必须先回到快照自带的最近消息基线，再叠加其后的增量。
        // 否则一旦同步链重建，房间又会退化成“只有未来消息、没有最近历史”的假空房。
        messages: this.reconcileMessages([...snapshot.recent_messages, ...delta.events]),
        pending: false,
        historyLoading: false,
        historyReachedStart: false,
        historyErrorCode: "",
        recoveryState: "idle",
        lastRecoveryErrorCode: "",
      });
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
    if (!this.chatState.roomId || this.chatState.historyLoading || this.chatState.historyReachedStart) {
      return;
    }

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
        historyReachedStart: page.messages.length === 0,
        historyErrorCode: "",
      });
    } catch (error) {
      this.updateChat({
        historyLoading: false,
        historyErrorCode: this.asRecoveryFailure(error).code ?? "system_error",
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
   * 硬失败要清 room 锚点并退出房间；临时失败则保留锚点，让用户还能重试。
   */
  private handleRecoveryFailure(
    roomId: string,
    error: unknown,
    keepRoomVisible: boolean
  ): void {
    const failure = this.asRecoveryFailure(error);
    if (this.isHardRoomFailure(failure)) {
      this.clearCurrentRoomId();
      this.updateChat({
        roomId: "",
        latestEventPosition: 0,
        messages: [],
        pending: false,
        historyLoading: false,
        historyReachedStart: false,
        historyErrorCode: "",
        recoveryState: "idle",
        lastRecoveryErrorCode: failure.code ?? "",
      });
      return;
    }

    this.updateChat({
      roomId: keepRoomVisible ? roomId : "",
      pending: false,
      historyLoading: false,
      recoveryState: "retryable_failure",
      lastRecoveryErrorCode: failure.code ?? "system_error",
    });
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
      this.clearCurrentRoomId();
      this.updateChat({
        roomId: "",
        latestEventPosition: 0,
        messages: [],
        pending: false,
        historyLoading: false,
        historyReachedStart: false,
        historyErrorCode: "",
        recoveryState: "idle",
        lastRecoveryErrorCode: control.code ?? "",
      });
      return;
    }

    this.updateChat({
      pending: false,
      historyLoading: false,
      recoveryState: "retryable_failure",
      lastRecoveryErrorCode: control.code ?? "system_error",
    });
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

  private clearCurrentRoomId(): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.removeItem === "function") {
      storage.removeItem(当前房间存储键);
    }
  }

  /**
   * 房间基线一旦成立，就统一从这里更新壳层状态与本地恢复锚点。
   * 这样 join / 刷新恢复 两条入口不会各自漂出一套写状态逻辑。
   */
  private enterRoomFromSnapshot(snapshot: {
    room_id: string;
    latest_event_position: number;
    recent_messages: 消息事件[];
  }): void {
    this.writeCurrentRoomId(snapshot.room_id);
    this.updateChat({
      roomId: snapshot.room_id,
      latestEventPosition: snapshot.latest_event_position,
      // recent_messages 是后端给出的权威房间基线，不是前端自己残留的缓存。
      // 只要快照成立，房间第一屏就应该直接可读，而不是先清空再等待未来增量。
      messages: this.reconcileMessages(snapshot.recent_messages),
      pending: false,
      historyLoading: false,
      historyReachedStart: false,
      historyErrorCode: "",
      recoveryState: "idle",
      lastRecoveryErrorCode: "",
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
    if (!this.chatState.roomId) {
      return html`
        <section id="joinView" class="panel">
          <div id="alias" class="meta">alias: ${this.chatState.displayAlias || "-"}</div>
          ${recoveryHint ? html`<div id="recoveryHint" class="hint">${recoveryHint}</div>` : null}
          <div class="row">
            <input
              id="roomCode"
              placeholder="房间短码"
              .value=${this.chatState.roomCodeInput}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                this.updateChat({ roomCodeInput: target.value });
              }}
            />
            <button id="joinBtn" @click=${() => this.joinRoom()}>进房</button>
          </div>
        </section>
      `;
    }

    return html`
      <section id="roomView" class="panel">
        <div id="alias" class="meta">alias: ${this.chatState.displayAlias || "-"}</div>
        <div class="meta">room: ${this.chatState.roomId || "-"}</div>
        ${recoveryHint ? html`<div id="recoveryHint" class="hint">${recoveryHint}</div>` : null}
        ${historyHint ? html`<div id="historyHint" class="hint">${historyHint}</div>` : null}
        <div class="row">
          <input
            id="msgInput"
            placeholder="输入消息"
            .value=${this.chatState.messageInput}
            @input=${(e: Event) => {
              const target = e.target as HTMLInputElement;
              this.updateChat({ messageInput: target.value });
            }}
          />
          <button
            id="sendBtn"
            ?disabled=${this.chatState.pending}
            @click=${() => this.sendMessage()}
          >
            发送
          </button>
        </div>
        <div
          id="messageScroll"
          class="message-scroll"
          @scroll=${(event: Event) => {
            const target = event.currentTarget as HTMLElement;
            if (target.scrollTop <= 0) {
              void this.loadOlderHistory();
            }
          }}
        >
          <ul id="messageList" class="message-list">
            ${this.chatState.messages.map((message) => {
              const item = 派生消息展示项(message, this.chatState.sessionId);
              return html`
                <li class="message-row ${item.owner}" data-owner=${item.owner}>
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
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
