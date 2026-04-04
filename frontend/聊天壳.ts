import { css, html, LitElement } from "lit";
import type { 消息事件 } from "./契约";
import { HttpRealtime传输, type 前端传输端口 } from "./传输";
import { 初始聊天状态, type 聊天状态 } from "./状态";
import { 格式化消息 } from "./视图";

export class 聊天壳 extends LitElement {
  static styles = css`
    :host { display: block; padding: 16px; font-family: "Microsoft YaHei", sans-serif; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input { padding: 8px; }
    button { padding: 8px 12px; }
    ul { padding-left: 18px; }
  `;

  private chatState: 聊天状态 = { ...初始聊天状态 };

  private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);

  setTransportForTest(transport: 前端传输端口): void {
    this.transport = transport;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const session = await this.transport.bootstrapSession("web-user");
    this.updateChat({ sessionId: session.session_id });
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
    });
  }

  private async sendMessage(): Promise<void> {
    if (!this.chatState.roomId || !this.chatState.messageInput.trim()) return;
    this.updateChat({ pending: true });
    const events = await this.transport.loadRoomEvents(
      this.chatState.roomId,
      this.chatState.latestEventPosition
    );
    const merged = [...this.chatState.messages, ...events.events];
    this.updateChat({
      messages: this.dedupe(merged),
      latestEventPosition: events.latest_event_position,
      messageInput: "",
      pending: false,
    });
  }

  private updateChat(patch: Partial<聊天状态>): void {
    this.chatState = { ...this.chatState, ...patch };
    this.requestUpdate();
  }

  private dedupe(messages: 消息事件[]): 消息事件[] {
    const seen = new Set<string>();
    const out: 消息事件[] = [];
    for (const item of messages) {
      if (!seen.has(item.message_id)) {
        seen.add(item.message_id);
        out.push(item);
      }
    }
    return out;
  }

  render() {
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
