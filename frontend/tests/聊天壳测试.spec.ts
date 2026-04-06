import { describe, expect, it } from "vitest";
import "../聊天壳";
import type { 前端传输端口 } from "../传输";
import type {
  会话快照,
  增量事件快照,
  后台概览,
  房间快照,
  后台登录结果,
  后台房间列表,
  后台房间详情,
} from "../契约";
import { 聊天壳 } from "../聊天壳";
import type { Socket } from "socket.io-client";

class 假Socket {
  private handlers = new Map<string, Array<(payload: unknown) => void>>();
  public sentEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];

  on(event: string, handler: (payload: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): boolean {
    this.sentEvents.push({ event, payload });
    if (event === "subscribe_room_stream") {
      if (payload.from === 99) {
        this.fire("control_result", {
          kind: "need_snapshot_reload",
          room_id: payload.room_id,
          expected_position: 99,
        });
      } else {
        this.fire("control_result", {
          kind: "subscribed",
          room_id: payload.room_id,
          latest_event_position: 0,
        });
      }
    }
    if (event === "send_text_message") {
      this.fire("room_event", {
        type: "message_created",
        room_id: "r-test",
        message_id: "m-1",
        client_message_id: payload.client_message_id,
        sender_session_id: "s-test",
        body: payload.text,
        event_position: 1,
      });
    }
    return true;
  }

  disconnect(): void {}

  trigger(event: string, payload: unknown): void {
    this.fire(event, payload);
  }

  private fire(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class 假传输 implements 前端传输端口 {
  readonly socket = new 假Socket();
  loadRoomSnapshotCalls = 0;
  loadRoomEventsCalls = 0;

  async bootstrapSession(): Promise<会话快照> {
    return { session_id: "s-test", display_name: "tester" };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return { room_id: "r-test", latest_event_position: 0 };
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    this.loadRoomSnapshotCalls += 1;
    return { room_id: "r-test", latest_event_position: 1 };
  }
  async loadRoomEvents(): Promise<增量事件快照> {
    this.loadRoomEventsCalls += 1;
    return {
      room_id: "r-test",
      latest_event_position: 1,
      events: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-test",
          body: "hello",
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
    return { rooms: ["r-test"] };
  }
  async adminRoomDetail(): Promise<后台房间详情> {
    return { room_id: "r-test", latest_event_position: 1, message_count: 1 };
  }
  createSocket(_sessionId: string): Socket {
    return this.socket as unknown as Socket;
  }
}

describe("聊天壳", () => {
  it("可以引导会话、进房并渲染消息", async () => {
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(new 假传输());
    document.body.appendChild(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    const joinBtn = el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement;
    joinBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const msgInput = el.shadowRoot!.querySelector("#msgInput") as HTMLInputElement;
    msgInput.value = "hello";
    msgInput.dispatchEvent(new Event("input"));
    const sendBtn = el.shadowRoot!.querySelector("#sendBtn") as HTMLButtonElement;
    sendBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const list = el.shadowRoot!.querySelector("#messageList")!;
    expect(list.textContent).toContain("hello");

    el.remove();
  });

  it("收到 need_snapshot_reload 时会回退 HTTP 快照并按最新锚点重订阅", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    const joinBtn = el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement;
    joinBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    (el as unknown as { chatState: { latestEventPosition: number } }).chatState.latestEventPosition = 99;
    transport.socket.trigger("connect", undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(transport.loadRoomSnapshotCalls).toBe(2);
    expect(transport.loadRoomEventsCalls).toBe(1);
    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("hello");
    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) =>
          event === "subscribe_room_stream" && payload.room_id === "r-test" && payload.from === 1
      )
    ).toBe(true);

    el.remove();
  });
});
