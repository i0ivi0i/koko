// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../聊天壳";
import type { 前端传输端口 } from "../传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台概览,
  房间历史页,
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
  public subscribeResults: Array<Record<string, unknown>> = [];

  on(event: string, handler: (payload: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): boolean {
    this.sentEvents.push({ event, payload });
    if (event === "subscribe_room_stream") {
      if (this.subscribeResults.length > 0) {
        this.fire("control_result", this.subscribeResults.shift()!);
      } else if (payload.from === 99) {
        this.fire("control_result", {
          kind: "need_snapshot_reload",
          room_id: payload.room_id,
          expected_position: 99,
        });
      } else {
        this.fire("control_result", {
          kind: "subscribed",
          room_id: payload.room_id,
          latest_event_position: Number(payload.from ?? 0),
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

function 创建房间快照(
  roomId = "r-test",
  latestEventPosition = 1,
  patch: Partial<房间快照> = {}
): 房间快照 {
  return {
    room_id: roomId,
    latest_event_position: latestEventPosition,
    last_read_event_position: null,
    first_unread_event_position: null,
    snapshot_messages: [],
    has_more_before: false,
    ...patch,
  };
}

class 假传输 implements 前端传输端口 {
  readonly socket = new 假Socket();
  loadRoomSnapshotCalls = 0;
  loadRoomEventsCalls = 0;
  loadRoomHistoryCalls = 0;
  bootstrapTokens: string[] = [];
  joinCalls: Array<{ sessionId: string; roomCode: string }> = [];
  loadRoomSnapshotArgs: Array<{ roomId: string; sessionId: string }> = [];
  loadRoomEventsArgs: Array<{ roomId: string; sessionId: string; from: number }> = [];
  loadRoomHistoryArgs: Array<{
    roomId: string;
    sessionId: string;
    beforeEventPosition: number;
    limit: number;
  }> = [];
  socketSessionIds: string[] = [];
  bootstrapResult: 匿名身份引导结果 = {
    anonymous_identity_id: "a-test",
    display_alias: "暴躁的企鹅",
    session_id: "s-test",
  };
  bootstrapQueue: Array<匿名身份引导结果 | Error> = [];
  joinQueue: Array<房间快照 | Error> = [];
  snapshotQueue: Array<房间快照 | Error> = [];
  eventsQueue: Array<增量事件快照 | Error> = [];
  historyQueue: Array<房间历史页 | Error> = [];
  readAnchorUpdates: Array<{
    roomId: string;
    sessionId: string;
    lastReadEventPosition: number;
  }> = [];
  snapshotRoomId = "r-test";
  joinRoomId = "r-test";

  async bootstrapAnonymousIdentity(
    deviceToken: string
  ): Promise<匿名身份引导结果> {
    this.bootstrapTokens.push(deviceToken);
    const queued = this.bootstrapQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return this.bootstrapResult;
  }
  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    this.joinCalls.push({ sessionId, roomCode });
    this.joinRoomId = roomCode === "ROOM02" ? "r-room-2" : "r-test";
    const queued = this.joinQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return 创建房间快照(this.joinRoomId);
  }
  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    this.loadRoomSnapshotCalls += 1;
    this.loadRoomSnapshotArgs.push({ roomId, sessionId });
    const queued = this.snapshotQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    this.snapshotRoomId = roomId;
    return 创建房间快照(roomId);
  }
  async updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void> {
    this.readAnchorUpdates.push({ roomId, sessionId, lastReadEventPosition });
  }
  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    this.loadRoomEventsCalls += 1;
    this.loadRoomEventsArgs.push({ roomId, sessionId, from });
    const queued = this.eventsQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return {
      room_id: roomId,
      latest_event_position: 1,
      events: [
        {
          type: "message_created",
          room_id: roomId,
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
  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    this.loadRoomHistoryCalls += 1;
    this.loadRoomHistoryArgs.push({ roomId, sessionId, beforeEventPosition, limit });
    const queued = this.historyQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return { room_id: roomId, messages: [] };
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
    this.socketSessionIds.push(_sessionId);
    return this.socket as unknown as Socket;
  }
}

function 创建传输错误(status: number, code: string, message = code): Error {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}

async function 等待组件稳定(el: 聊天壳): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
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
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(el.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    expect(el.shadowRoot!.textContent).not.toContain("session:");
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
    await 等待组件稳定(first);

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
    await 等待组件稳定(second);

    expect(secondTransport.bootstrapTokens).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(second.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    second.remove();
  });

  it("可以引导会话、进房并渲染消息", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    const joinBtn = el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement;
    joinBtn.click();
    await 等待组件稳定(el);

    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) =>
          event === "subscribe_room_stream" && payload.room_id === "r-test" && payload.from === 1
      )
    ).toBe(true);

    const msgInput = el.shadowRoot!.querySelector("#msgInput") as HTMLInputElement;
    msgInput.value = "hello";
    msgInput.dispatchEvent(new Event("input"));
    const sendBtn = el.shadowRoot!.querySelector("#sendBtn") as HTMLButtonElement;
    sendBtn.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#messageList")!;
    expect(list.textContent).toContain("hello");
    expect(list.textContent).not.toContain("[1]");

    el.remove();
  });

  it("收到 need_snapshot_reload 时会回退 HTTP 快照并按最新锚点重订阅", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    const joinBtn = el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement;
    joinBtn.click();
    await 等待组件稳定(el);

    (el as unknown as { chatState: { latestEventPosition: number } }).chatState.latestEventPosition = 99;
    transport.socket.trigger("connect", undefined);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomSnapshotCalls).toBe(1);
    expect(transport.loadRoomEventsCalls).toBe(1);
    expect(transport.loadRoomEventsArgs).toEqual([
      { roomId: "r-test", sessionId: "s-test", from: 1 },
    ]);
    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("hello");
    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) =>
          event === "subscribe_room_stream" && payload.room_id === "r-test" && payload.from === 1
      )
    ).toBe(true);
    expect(
      transport.loadRoomEventsArgs.some(({ from }) => from === 2)
    ).toBe(false);

    el.remove();
  });

  it("进房成功后会写入 koko_current_room_id", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-test");
    el.remove();
  });

  it("再次进房成功后会覆盖旧的 koko_current_room_id", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    window.localStorage.setItem("koko_current_room_id", "r-old");
    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM02";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-room-2");
    el.remove();
  });

  it("启动时若本地已有 koko_current_room_id，会自动恢复该房间", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-test" },
    ]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")!.textContent).toContain("r-restore");
    el.remove();
  });

  it("恢复房间时 current_session_id 只来自本次 bootstrap", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapResult = {
      anonymous_identity_id: "a-new",
      display_alias: "冷静的水獭",
      session_id: "s-fresh",
    };
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-fresh" },
    ]);
    expect(transport.socketSessionIds).toEqual(["s-fresh"]);
    el.remove();
  });

  it("首次进入已有历史房间时会直接渲染 snapshot_messages", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "历史消息-2",
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#messageList")!;
    expect(list.textContent).toContain("历史消息-1");
    expect(list.textContent).toContain("历史消息-2");
    el.remove();
  });

  it("进房会直接消费 joinOrCreateRoom 返回的 snapshot_messages，不再二次拉 snapshot", async () => {
    const transport = new 假传输();
    transport.joinRoomId = "r-join";
    vi.spyOn(transport, "joinOrCreateRoom").mockResolvedValue(
      创建房间快照("r-join", 2, {
      snapshot_messages: [
        {
          type: "message_created",
          room_id: "r-join",
          message_id: "m-join-1",
          client_message_id: "c-join-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          body: "进房基线-1",
          event_position: 1,
        },
        {
          type: "message_created",
          room_id: "r-join",
          message_id: "m-join-2",
          client_message_id: "c-join-2",
          sender_session_id: "s-test",
          sender_display_alias: "暴躁的企鹅",
          body: "进房基线-2",
          event_position: 2,
        },
      ],
      })
    );
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomSnapshotCalls).toBe(0);
    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("进房基线-1");
    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("进房基线-2");
    el.remove();
  });

  it("刷新恢复房间时会直接渲染 snapshot_messages", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-restore-1",
            client_message_id: "c-restore-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "恢复历史-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-restore-2",
            client_message_id: "c-restore-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "恢复历史-2",
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#messageList")!;
    expect(list.textContent).toContain("恢复历史-1");
    expect(list.textContent).toContain("恢复历史-2");
    el.remove();
  });

  it("有 first_unread_event_position 时会显示未读消息分隔条", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#unreadDivider")?.textContent).toContain("未读消息");
    el.remove();
  });

  it("无 first_unread_event_position 时不会显示未读分隔条", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 2, {
        last_read_event_position: null,
        first_unread_event_position: null,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "普通消息",
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#unreadDivider")).toBeNull();
    el.remove();
  });

  it("room_not_found 会清掉 current_room_id 并回到搜索页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-missing");
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(404, "room_not_found")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    el.remove();
  });

  it("membership_required 会清掉 current_room_id 并回到搜索页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-blocked");
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(403, "membership_required")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinView")).not.toBeNull();
    el.remove();
  });

  it("invalid_session 会重新 bootstrap 再决定恢复分支", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        anonymous_identity_id: "a-old",
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
        anonymous_identity_id: "a-new",
        display_alias: "冷静的水獭",
        session_id: "s-refresh",
      },
    ];
    transport.snapshotQueue = [
      创建传输错误(401, "invalid_session"),
      创建房间快照("r-restore", 2),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toHaveLength(2);
    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-stale" },
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });

  it("恢复超时或5xx不会清掉 current_room_id", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-retry");
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(503, "system_error", "backend busy")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-retry");
    expect(el.shadowRoot!.textContent).toContain("恢复失败");
    el.remove();
  });

  it("滚动到顶部时会以当前最老消息的 event_position 触发 history 查询", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "历史消息-3",
            event_position: 3,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-1",
            event_position: 1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryArgs).toEqual([
      { roomId: "r-test", sessionId: "s-test", beforeEventPosition: 2, limit: 55 },
    ]);
    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("历史消息-1");
    el.remove();
  });

  it("上滑历史前插后会按 scrollHeight 差值补偿 scrollTop", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "历史消息-3",
            event_position: 3,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-1",
            event_position: 1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      scrollHeight: number;
    };
    let measureIndex = 0;
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get() {
        const values = [120, 200];
        return values[Math.min(measureIndex++, values.length - 1)];
      },
    });
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(scroll.scrollTop).toBe(80);
    el.remove();
  });

  it("history 失败不会清空当前消息列表", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "保留消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "保留消息-2",
            event_position: 2,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [创建传输错误(503, "system_error", "history busy")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("保留消息");
    expect((el as unknown as { chatState: { historyErrorCode: string } }).chatState.historyErrorCode).toBe(
      "system_error"
    );
    el.remove();
  });

  it("history 返回空数组后会标记没有更早历史，重复上滑不会再次请求", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "最早消息",
            event_position: 1,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [{ room_id: "r-test", messages: [] }];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(1);
    expect(
      (el as unknown as { chatState: { hasMoreBefore: boolean } }).chatState.hasMoreBefore
    ).toBe(false);
    el.remove();
  });

  it("顶部回弹时不会重复触发多次历史请求", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "历史消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "历史消息-2",
            event_position: 2,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-0",
            client_message_id: "c-0",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "更早消息",
            event_position: 0,
          },
        ],
      },
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m--1",
            client_message_id: "c--1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "不该再次请求到这里",
            event_position: -1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(1);
    el.remove();
  });

  it("history 页和 realtime 新消息同时并入时不会重复 message_id", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "现在消息",
            event_position: 2,
          },
        ],
        has_more_before: true,
      }),
    ];
    transport.historyQueue = [
      {
        room_id: "r-test",
        messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "更早消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2-dup",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "现在消息",
            event_position: 2,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-3",
      client_message_id: "c-3",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "新消息",
      event_position: 3,
    });
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const messages = Array.from(el.shadowRoot!.querySelectorAll(".message-body")).map(
      (node) => node.textContent
    );
    expect(messages).toEqual(["更早消息", "现在消息", "新消息"]);
    el.remove();
  });

  it("快照成功后订阅被硬拒绝时会退出房间", async () => {
    const transport = new 假传输();
    transport.socket.subscribeResults = [
      { kind: "rejected", code: "membership_required", message: "成员资格不足" },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    el.remove();
  });

  it("快照成功后订阅临时失败时会保留房间页并显示重试提示", async () => {
    const transport = new 假传输();
    transport.socket.subscribeResults = [
      { kind: "error", code: "system_error", message: "临时失败" },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-test");
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("实时连接暂不可用");
    el.remove();
  });

  it("自己发送的消息按 mine/right 渲染", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    const msgInput = el.shadowRoot!.querySelector("#msgInput") as HTMLInputElement;
    msgInput.value = "hello";
    msgInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#sendBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const item = el.shadowRoot!.querySelector('[data-owner="mine"]');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain("hello");
    el.remove();
  });

  it("其他成员发送的消息按 other/left 渲染", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-other",
      client_message_id: "c-other",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "other hello",
      event_position: 2,
    });
    await 等待组件稳定(el);

    const item = el.shadowRoot!.querySelector('[data-owner="other"]');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain("冷静的水獭");
    expect(item?.textContent).toContain("other hello");
    el.remove();
  });
});
