import { css, html, LitElement } from "lit";
import type { 消息事件 } from "./契约.js";
import { HttpRealtime传输, type 前端传输端口 } from "./传输.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import { 格式化消息 } from "./视图.js";
import type { Socket } from "socket.io-client";

const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";

export class 聊天壳 extends LitElement {
  static override styles = css`
    :host { display: block; padding: 16px; font-family: "Microsoft YaHei", sans-serif; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input { padding: 8px; }
    button { padding: 8px 12px; }
    ul { padding-left: 18px; }
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
    this.updateChat({
      deviceAnonymousToken,
      anonymousIdentityId: identity.anonymous_identity_id,
      displayAlias: identity.display_alias,
      sessionId: identity.session_id,
    });
    this.ensureRealtimeSocket(identity.session_id);
    await this.restoreCurrentRoomIfNeeded(identity.session_id);
  }

  private async joinRoom(): Promise<void> {
    if (!this.chatState.roomCodeInput.trim()) return;
    const room = await this.transport.joinOrCreateRoom(
      this.chatState.sessionId,
      this.chatState.roomCodeInput.trim()
    );
    const snapshot = await this.transport.loadRoomSnapshot(room.room_id, this.chatState.sessionId);
    this.enterRoomFromSnapshot(snapshot);
    this.subscribeRoom(snapshot.latest_event_position);
  }

  /**
   * 启动恢复顺序必须固定：
   * 1. 先 bootstrap 拿到当前权威 session；
   * 2. 再读取壳层上次记住的 room_id；
   * 3. 再用“本次 bootstrap 返回的 session”拉快照恢复。
   *
   * 这里故意不复用旧 session_id，也不把 room_id 当成员资格真相。
   */
  private async restoreCurrentRoomIfNeeded(sessionId: string): Promise<void> {
    const roomId = this.readCurrentRoomId();
    if (!roomId) return;
    const snapshot = await this.transport.loadRoomSnapshot(roomId, sessionId);
    this.enterRoomFromSnapshot(snapshot);
    this.subscribeRoom(snapshot.latest_event_position);
  }

  // 当 realtime 锚点闭合不了时，退回 HTTP 基线重建，再回到统一事件流。
  private async reloadRoomFromSnapshot(roomId: string): Promise<void> {
    if (!this.chatState.sessionId || roomId !== this.chatState.roomId) return;
    try {
      const snapshot = await this.transport.loadRoomSnapshot(roomId, this.chatState.sessionId);
      // 补洞锚点直接吃权威快照位置；不要再手搓 `0` 或 `+1` 这种第二套语义。
      const delta = await this.transport.loadRoomEvents(
        roomId,
        this.chatState.sessionId,
        snapshot.latest_event_position
      );
      const latestEventPosition = Math.max(
        snapshot.latest_event_position,
        delta.latest_event_position
      );
      this.updateChat({
        latestEventPosition,
        messages: this.reconcileMessages(delta.events),
        pending: false,
      });
      this.subscribeRoom(latestEventPosition);
    } catch {
      this.updateChat({ pending: false });
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

  /**
   * 只有成功拿到房间快照后才写入 room 恢复锚点。
   * 这样刷新页恢复的是“上次成功进入过的房间”，而不是半路失败的意图输入。
   */
  private writeCurrentRoomId(roomId: string): void {
    const storage =
      typeof window !== "undefined" ? (window.localStorage as Partial<Storage>) : undefined;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem(当前房间存储键, roomId);
    }
  }

  /**
   * 房间基线一旦成立，就统一从这里更新壳层状态与本地恢复锚点。
   * 这样 join / 刷新恢复 两条入口不会各自漂出一套写状态逻辑。
   */
  private enterRoomFromSnapshot(snapshot: { room_id: string; latest_event_position: number }): void {
    this.writeCurrentRoomId(snapshot.room_id);
    this.updateChat({
      roomId: snapshot.room_id,
      latestEventPosition: snapshot.latest_event_position,
      messages: [],
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
    socket.on(
      "control_result",
      (control: {
        kind?: string;
        latest_event_position?: number;
        code?: string;
        room_id?: string;
      }) => {
        if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
          this.updateChat({ latestEventPosition: control.latest_event_position });
        }
        if (control.kind === "need_snapshot_reload" && control.room_id) {
          void this.reloadRoomFromSnapshot(control.room_id);
        }
        if (control.kind === "rejected" || control.kind === "error") {
          this.updateChat({ pending: false });
        }
      }
    );
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
    const byClientMessageId = new Map<string, number>();
    const out: 消息事件[] = [];

    for (const message of messages) {
      const existingIndex = byClientMessageId.get(message.client_message_id);
      if (existingIndex === undefined) {
        byClientMessageId.set(message.client_message_id, out.length);
        out.push(message);
        continue;
      }

      const existing = out[existingIndex]!;
      const existingIsOptimistic = existing.message_id.startsWith("local-");
      const currentIsOptimistic = message.message_id.startsWith("local-");
      if (existingIsOptimistic && !currentIsOptimistic) {
        out[existingIndex] = message;
      }
    }

    return out.sort((left, right) => left.event_position - right.event_position);
  }

  override render() {
    if (!this.chatState.roomId) {
      return html`
        <section id="joinView">
          <div id="alias">alias: ${this.chatState.displayAlias || "-"}</div>
          <div id="session">session: ${this.chatState.sessionId || "-"}</div>
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
      <section id="roomView">
        <div id="alias">alias: ${this.chatState.displayAlias || "-"}</div>
        <div id="session">session: ${this.chatState.sessionId || "-"}</div>
        <div>room: ${this.chatState.roomId || "-"}</div>
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
        <ul id="messageList">
          ${this.chatState.messages.map((m) => html`<li>${格式化消息(m)}</li>`)}
        </ul>
      </section>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
