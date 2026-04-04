import { css, html, LitElement } from "lit";
import { HttpRealtime传输, type 前端传输端口 } from "./传输";
import { 格式化后台概览 } from "./视图";

export class 后台壳 extends LitElement {
  static styles = css`
    :host { display: block; padding: 16px; font-family: "Microsoft YaHei", sans-serif; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input { padding: 8px; }
    button { padding: 8px 12px; }
  `;

  private transport: 前端传输端口 = new HttpRealtime传输(window.location.origin);
  private username = "admin";
  private password = "admin";
  private token = "";
  private roomFilter = "";
  private roomIds: string[] = [];
  private overviewText = "-";
  private detailText = "-";

  setTransportForTest(transport: 前端传输端口): void {
    this.transport = transport;
  }

  private async login(): Promise<void> {
    const out = await this.transport.adminLogin(this.username, this.password);
    this.token = out.token;
    await this.loadOverview();
    await this.loadRooms();
    this.requestUpdate();
  }

  private async loadOverview(): Promise<void> {
    if (!this.token) return;
    const overview = await this.transport.loadAdminOverview(this.token);
    this.overviewText = 格式化后台概览(overview.room_count, overview.message_count);
  }

  private async loadRooms(): Promise<void> {
    if (!this.token) return;
    const rooms = await this.transport.adminRooms(this.token);
    this.roomIds = rooms.rooms;
  }

  private async loadRoomDetail(roomId: string): Promise<void> {
    if (!this.token) return;
    const detail = await this.transport.adminRoomDetail(this.token, roomId);
    this.detailText = `房间 ${detail.room_id}，位置 ${detail.latest_event_position}，消息 ${detail.message_count}`;
    this.requestUpdate();
  }

  private get filteredRooms(): string[] {
    if (!this.roomFilter.trim()) return this.roomIds;
    return this.roomIds.filter((id) => id.includes(this.roomFilter.trim()));
  }

  render() {
    return html`
      <section id="adminShell">
        <div class="row">
          <input
            id="adminUser"
            .value=${this.username}
            @input=${(e: Event) => {
              this.username = (e.target as HTMLInputElement).value;
            }}
          />
          <input
            id="adminPass"
            .value=${this.password}
            @input=${(e: Event) => {
              this.password = (e.target as HTMLInputElement).value;
            }}
          />
          <button id="adminLoginBtn" @click=${() => this.login()}>登录</button>
        </div>
        <div id="overview">${this.overviewText}</div>
        <div class="row">
          <input
            id="roomSearch"
            placeholder="搜索房间"
            .value=${this.roomFilter}
            @input=${(e: Event) => {
              this.roomFilter = (e.target as HTMLInputElement).value;
              this.requestUpdate();
            }}
          />
          <button id="reloadRooms" @click=${() => this.loadRooms()}>刷新房间</button>
        </div>
        <ul id="roomList">
          ${this.filteredRooms.map(
            (id) => html`<li>${id} <button class="roomDetailBtn" @click=${() => this.loadRoomDetail(id)}>详情</button></li>`
          )}
        </ul>
        <div id="roomDetail">${this.detailText}</div>
      </section>
    `;
  }
}

customElements.define("koko-admin-shell", 后台壳);
