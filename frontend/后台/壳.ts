import { css, html, LitElement } from "lit";
import {
  创建后台应用内核,
  type 后台应用内核端口,
} from "./应用内核.js";
import type { 后台会话传输端口, 后台查询传输端口 } from "../平台/传输.js";
import { 格式化后台房间详情, 格式化后台概览 } from "./视图.js";

export class 后台壳 extends LitElement {
  static override styles = css`
    :host { display: block; padding: 16px; font-family: "Microsoft YaHei", sans-serif; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input { padding: 8px; }
    button { padding: 8px 12px; }
  `;

  /**
   * 后台壳现在只持有后台应用内核入口：
   * 1. 壳层把输入翻成命令；
   * 2. 所有展示文本都从快照读取；
   * 3. transport 已经退回到内核内部，不再由壳层直接 await。
   */
  private kernel: 后台应用内核端口 = 创建后台应用内核({
    onSnapshotChanged: () => {
      this.requestUpdate();
    },
  });

  setTransportForTest(transport: 后台查询传输端口 & 后台会话传输端口): void {
    this.kernel.setTransportForTest(transport);
  }

  setKernelForTest(kernel: 后台应用内核端口): void {
    this.kernel = kernel;
    this.requestUpdate();
  }

  private 读取快照() {
    return this.kernel.snapshot();
  }

  /**
   * 壳层发命令后主动请求一次刷新：
   * 1. 真实内核会通过 onSnapshotChanged 再次触发更新；
   * 2. 测试替身内核如果没有回调，这里也能把最新快照刷回模板。
   */
  private 派发命令(command: Parameters<后台应用内核端口["dispatch"]>[0]): void {
    void Promise.resolve(this.kernel.dispatch(command)).finally(() => {
      this.requestUpdate();
    });
  }

  private submitLoginForm(event: SubmitEvent): void {
    event.preventDefault();
    this.派发命令({ type: "LOGIN_REQUESTED" });
  }

  private submitRoomSearchForm(event: SubmitEvent): void {
    event.preventDefault();
    this.派发命令({ type: "RELOAD_ROOMS_REQUESTED" });
  }

  override render() {
    const snapshot = this.读取快照();
    const overviewText = snapshot.overview
      ? 格式化后台概览(
          snapshot.overview.room_count,
          snapshot.overview.message_count
        )
      : "-";
    const detailText = 格式化后台房间详情(snapshot.detail);
    return html`
      <section id="adminShell">
        <form id="adminLoginForm" class="row" @submit=${this.submitLoginForm}>
          <input
            id="adminUser"
            enterkeyhint="go"
            .value=${snapshot.username}
            @input=${(e: Event) => {
              this.派发命令({
                type: "USERNAME_CHANGED",
                value: (e.target as HTMLInputElement).value,
              });
            }}
          />
          <input
            id="adminPass"
            enterkeyhint="go"
            .value=${snapshot.password}
            @input=${(e: Event) => {
              this.派发命令({
                type: "PASSWORD_CHANGED",
                value: (e.target as HTMLInputElement).value,
              });
            }}
          />
          <button id="adminLoginBtn" type="submit">登录</button>
        </form>
        <div id="overview">${overviewText}</div>
        <form id="roomSearchForm" class="row" @submit=${this.submitRoomSearchForm}>
          <input
            id="roomSearch"
            placeholder="搜索房间"
            enterkeyhint="search"
            .value=${snapshot.roomFilter}
            @input=${(e: Event) => {
              this.派发命令({
                type: "ROOM_FILTER_CHANGED",
                value: (e.target as HTMLInputElement).value,
              });
            }}
          />
          <button id="reloadRooms" type="submit">刷新房间</button>
        </form>
        <ul id="roomList">
          ${snapshot.roomIds.map(
            (id) =>
              html`<li>
                ${id}
                <button
                  class="roomDetailBtn"
                  @click=${() => {
                    this.派发命令({
                      type: "ROOM_DETAIL_REQUESTED",
                      roomId: id,
                    });
                  }}
                >
                  详情
                </button>
              </li>`
          )}
        </ul>
        <div id="roomDetail">${detailText}</div>
      </section>
    `;
  }
}

customElements.define("koko-admin-shell", 后台壳);
