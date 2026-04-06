// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import "../后台壳";
import type { 前端传输端口 } from "../传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
  房间快照,
  房间历史页,
} from "../契约";
import { 后台壳 } from "../后台壳";
import type { Socket } from "socket.io-client";

const 空Socket = {
  on() {
    return this;
  },
  emit() {
    return true;
  },
  disconnect() {},
} as unknown as Socket;

function 创建房间快照(roomId = "r-x", latestEventPosition = 0): 房间快照 {
  return {
    room_id: roomId,
    latest_event_position: latestEventPosition,
    last_read_event_position: null,
    first_unread_event_position: null,
    snapshot_messages: [],
    has_more_before: false,
  };
}

class 假后台传输 implements 前端传输端口 {
  async bootstrapAnonymousIdentity(): Promise<匿名身份引导结果> {
    return {
      anonymous_identity_id: "a-x",
      display_alias: "暴躁的企鹅",
      session_id: "s-x",
    };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return 创建房间快照();
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    return 创建房间快照();
  }
  async updateRoomReadAnchor(): Promise<void> {}
  async loadRoomEvents(
    _roomId: string,
    _sessionId: string,
    _from: number
  ): Promise<增量事件快照> {
    return { room_id: "r-x", latest_event_position: 0, events: [] };
  }
  async loadRoomHistory(): Promise<房间历史页> {
    return { room_id: "r-x", messages: [] };
  }
  async loadAdminOverview(): Promise<后台概览> {
    return { room_count: 2, message_count: 5 };
  }
  async adminLogin(): Promise<后台登录结果> {
    return { token: "admin-token" };
  }
  async adminRooms(): Promise<后台房间列表> {
    return { rooms: ["room-A", "room-B"] };
  }
  async adminRoomDetail(_token: string, roomId: string): Promise<后台房间详情> {
    return { room_id: roomId, latest_event_position: 12, message_count: 99 };
  }
  createSocket(_sessionId: string): Socket {
    return 空Socket;
  }
}

describe("后台壳", () => {
  it("可登录并加载概览、房间列表和详情", async () => {
    const el = document.createElement("koko-admin-shell") as 后台壳;
    el.setTransportForTest(new 假后台传输());
    document.body.appendChild(el);
    await el.updateComplete;

    const loginBtn = el.shadowRoot!.querySelector("#adminLoginBtn") as HTMLButtonElement;
    loginBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const overview = el.shadowRoot!.querySelector("#overview")!;
    expect(overview.textContent).toContain("房间 2");

    const firstDetailBtn = el.shadowRoot!.querySelector(".roomDetailBtn") as HTMLButtonElement;
    firstDetailBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const detail = el.shadowRoot!.querySelector("#roomDetail")!;
    expect(detail.textContent).toContain("room-A");

    el.remove();
  });
});
