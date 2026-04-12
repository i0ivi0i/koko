import { css, html, LitElement } from "lit";
import { 获取默认浏览器应用平台 } from "./平台/index.js";
import type { 前端传输端口 } from "./传输.js";
import { 格式化后台概览 } from "./视图.js";

export class 后台壳 extends LitElement {
  static override styles = css`
    :host { display: block; padding: 16px; font-family: "Microsoft YaHei", sans-serif; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input { padding: 8px; }
    button { padding: 8px 12px; }
  `;

  /**
   * 后台壳与聊天壳共用平台层 transport 入口。
   * 这里收的是浏览器端实例归属，不是把后台业务语义挪进平台层。
   */
  private transport: 前端传输端口 = 获取默认浏览器应用平台().transport.transport();
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

  private submitLoginForm(event: SubmitEvent): void {
    event.preventDefault();
    void this.login();
  }

  private submitRoomSearchForm(event: SubmitEvent): void {
    event.preventDefault();
    void this.loadRooms();
  }

  override render() {
    return html`
      <section id="adminShell">
        <form id="adminLoginForm" class="row" @submit=${this.submitLoginForm}>
          <input
            id="adminUser"
            enterkeyhint="go"
            .value=${this.username}
            @input=${(e: Event) => {
              this.username = (e.target as HTMLInputElement).value;
            }}
          />
          <input
            id="adminPass"
            enterkeyhint="go"
            .value=${this.password}
            @input=${(e: Event) => {
              this.password = (e.target as HTMLInputElement).value;
            }}
          />
          <button id="adminLoginBtn" type="submit">登录</button>
        </form>
        <div id="overview">${this.overviewText}</div>
        <form id="roomSearchForm" class="row" @submit=${this.submitRoomSearchForm}>
          <input
            id="roomSearch"
            placeholder="搜索房间"
            enterkeyhint="search"
            .value=${this.roomFilter}
            @input=${(e: Event) => {
              this.roomFilter = (e.target as HTMLInputElement).value;
              this.requestUpdate();
            }}
          />
          <button id="reloadRooms" type="submit">刷新房间</button>
        </form>
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
