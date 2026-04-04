import { describe, expect, it } from "vitest";
import "../聊天壳";
import "../后台壳";
import { 聊天壳 } from "../聊天壳";
import { 后台壳 } from "../后台壳";
import type { 前端传输端口 } from "../传输";
import type {
  会话快照,
  增量事件快照,
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
  房间快照,
} from "../契约";
import type { Socket } from "socket.io-client";

class 端到端假传输 implements 前端传输端口 {
  async bootstrapSession(): Promise<会话快照> {
    return { session_id: "s-e2e", display_name: "e2e" };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return { room_id: "r-e2e", latest_event_position: 0 };
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    return { room_id: "r-e2e", latest_event_position: 0 };
  }
  async loadRoomEvents(): Promise<增量事件快照> {
    return {
      room_id: "r-e2e",
      latest_event_position: 1,
      events: [
        {
          type: "message_created",
          room_id: "r-e2e",
          message_id: "m-e2e",
          client_message_id: "c-e2e",
          sender_session_id: "s-e2e",
          body: "e2e-hello",
          event_position: 1,
        },
      ],
    };
  }
  async loadAdminOverview(): Promise<后台概览> {
    return { room_count: 1, message_count: 1 };
  }
  async adminLogin(): Promise<后台登录结果> {
    return { token: "admin-token" };
  }
  async adminRooms(): Promise<后台房间列表> {
    return { rooms: ["r-e2e"] };
  }
  async adminRoomDetail(): Promise<后台房间详情> {
    return { room_id: "r-e2e", latest_event_position: 1, message_count: 1 };
  }
  createSocket(): Socket {
    throw new Error("not used");
  }
}

describe("前后台壳端到端冒烟", () => {
  it("聊天壳和后台壳都能走完主流程", async () => {
    const transport = new 端到端假传输();

    const chat = document.createElement("koko-chat-shell") as 聊天壳;
    chat.setTransportForTest(transport);
    document.body.appendChild(chat);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;

    const roomInput = chat.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "E2E01";
    roomInput.dispatchEvent(new Event("input"));
    const joinBtn = chat.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement;
    joinBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;
    const msgInput = chat.shadowRoot!.querySelector("#msgInput") as HTMLInputElement;
    msgInput.value = "hello";
    msgInput.dispatchEvent(new Event("input"));
    const sendBtn = chat.shadowRoot!.querySelector("#sendBtn") as HTMLButtonElement;
    sendBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector("#messageList")!.textContent).toContain("e2e-hello");

    const admin = document.createElement("koko-admin-shell") as 后台壳;
    admin.setTransportForTest(transport);
    document.body.appendChild(admin);
    await admin.updateComplete;
    (admin.shadowRoot!.querySelector("#adminLoginBtn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await admin.updateComplete;
    expect(admin.shadowRoot!.querySelector("#overview")!.textContent).toContain("房间 1");

    chat.remove();
    admin.remove();
  });
});
