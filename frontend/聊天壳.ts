import { css, html, LitElement } from "lit";
import type { 消息事件 } from "./契约.js";
import { HttpRealtime传输, type 前端传输端口 } from "./传输.js";
import { 初始聊天状态, type 聊天状态 } from "./状态.js";
import { 格式化消息 } from "./视图.js";
import type { Socket } from "socket.io-client";

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
    const session = await this.transport.bootstrapSession("web-user");
    this.updateChat({ sessionId: session.session_id });
    this.ensureRealtimeSocket(session.session_id);
  }

  private async joinRoom(): Promise<void> {
    if (!this.chatState.roomCodeInput.trim()) return;
    const room = await this.transport.joinOrCreateRoom(
      this.chatState.sessionId,
      this.chatState.roomCodeInput.trim()
    );
    const snapshot = await this.transport.loadRoomSnapshot(room.room_id, this.chatState.sessionId);
    this.updateChat({
      roomId: room.room_id,
      latestEventPosition: snapshot.latest_event_position,
      messages: [],
    });
    this.subscribeRoom(0);
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
      (control: { kind?: string; latest_event_position?: number; code?: string }) => {
        if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
          this.updateChat({ latestEventPosition: control.latest_event_position });
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
    return html`
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
      <div>session: ${this.chatState.sessionId || "-"}</div>
      <div>room: ${this.chatState.roomId || "-"}</div>
      <ul id="messageList">
        ${this.chatState.messages.map((m) => html`<li>${格式化消息(m)}</li>`)}
      </ul>
    `;
  }
}

customElements.define("koko-chat-shell", 聊天壳);
