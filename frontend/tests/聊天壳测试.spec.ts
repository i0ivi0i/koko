// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../聊天壳";
import type { 前端传输端口 } from "../传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台概览,
  房间快照,
  后台登录结果,
  后台房间列表,
  后台房间详情,
} from "../契约";
import { 聊天壳 } from "../聊天壳";
import type { Socket } from "socket.io-client";

function createFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

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
        sender_display_alias: "暴躁的企鹅",
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
  bootstrapTokens: string[] = [];

  async bootstrapAnonymousIdentity(
    deviceToken: string
  ): Promise<匿名身份引导结果> {
    this.bootstrapTokens.push(deviceToken);
    return {
      anonymous_identity_id: "a-test",
      display_alias: "暴躁的企鹅",
      session_id: "s-test",
    };
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
          sender_display_alias: "暴躁的企鹅",
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
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("启动时会从本地设备凭证恢复匿名身份", async () => {
    window.localStorage.setItem(
      "koko_device_anonymous_token",
      "11111111-1111-4111-8111-111111111111"
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(transport.bootstrapTokens).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(el.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    expect(el.shadowRoot!.querySelector("#session")!.textContent).toContain("s-test");

    el.remove();
  });

  it("首次启动会生成并持久化设备匿名凭证，刷新后恢复同一花名", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "22222222-2222-4222-8222-222222222222"
    );
    const firstTransport = new 假传输();
    const first = document.createElement("koko-chat-shell") as 聊天壳;
    first.setTransportForTest(firstTransport);
    document.body.appendChild(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await first.updateComplete;

    expect(window.localStorage.getItem("koko_device_anonymous_token")).toBe(
      "22222222-2222-4222-8222-222222222222"
    );
    expect(firstTransport.bootstrapTokens).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(first.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    first.remove();

    const secondTransport = new 假传输();
    const second = document.createElement("koko-chat-shell") as 聊天壳;
    second.setTransportForTest(secondTransport);
    document.body.appendChild(second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await second.updateComplete;

    expect(secondTransport.bootstrapTokens).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(second.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    second.remove();
  });

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
