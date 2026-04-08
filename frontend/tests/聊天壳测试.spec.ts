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
  readAnchorUpdateQueue: Array<Error | null> = [];
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
    const queued = this.readAnchorUpdateQueue.shift();
    if (queued instanceof Error) {
      throw queued;
    }
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

function 设置测试滚动阶段(
  el: 聊天壳,
  patch: {
    initialUnreadSettled?: boolean;
    firstUnreadEventPosition?: number | null;
    scrollPhase?: string;
    hasUserScrollIntent?: boolean;
  }
): void {
  (el as unknown as {
    chatState: {
      initialUnreadSettled: boolean;
      firstUnreadEventPosition: number | null;
      scrollPhase?: string;
      hasUserScrollIntent?: boolean;
    };
  }).chatState = {
    ...(el as unknown as {
      chatState: {
        initialUnreadSettled: boolean;
        firstUnreadEventPosition: number | null;
        scrollPhase?: string;
        hasUserScrollIntent?: boolean;
      };
    }).chatState,
    ...patch,
  };
}

function 模拟用户滚动意图(scroll: HTMLElement): void {
  scroll.dispatchEvent(new Event("pointerdown"));
}

function 模拟消息滚动视口(
  el: 聊天壳,
  scroll: HTMLElement,
  rows: Array<{ eventPosition: number; top: number; bottom: number }>
): void {
  const byPosition = new Map(rows.map((row) => [row.eventPosition, row]));
  Object.defineProperty(scroll, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 300,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    }),
  });
  const elements = Array.from(
    el.shadowRoot!.querySelectorAll("[data-event-position]")
  ) as HTMLElement[];
  for (const element of elements) {
    const eventPosition = Number(element.dataset.eventPosition);
    const row = byPosition.get(eventPosition) ?? {
      eventPosition,
      top: 1000 + eventPosition * 10,
      bottom: 1040 + eventPosition * 10,
    };
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: row.top,
        top: row.top,
        left: 0,
        right: 320,
        bottom: row.bottom,
        width: 320,
        height: row.bottom - row.top,
        toJSON: () => ({}),
      }),
    });
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

  it("聊天滚动容器会显式收口浏览器边界回弹与滚动链", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overscroll-behavior-y: contain");
  });

  it("聊天滚动容器会显式关闭浏览器默认滚动锚点，避免和手动历史补偿打架", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overflow-anchor: none");
  });

  it("聊天壳样式会声明深空石墨色板，而不是棕色底板", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("--surface-canvas: #0b0f14");
    expect(styles).toContain("--surface-panel: #151b23");
    expect(styles).toContain("--surface-elevated: #1b2430");
    expect(styles).toContain("--text-primary: #f3f7fb");
    expect(styles).toContain("--accent-core: #ff385c");
    expect(styles).not.toContain("--surface-canvas: #171312");
    expect(styles).not.toContain("--surface-panel: #211b19");
    expect(styles).not.toContain("--surface-elevated: #2a2321");
  });

  it("启动恢复房间时在 bootstrap 完成前不会先闪出空态首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    vi.spyOn(transport, "bootstrapAnonymousIdentity").mockImplementation(
      () => new Promise<匿名身份引导结果>(() => {})
    );
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("#bootView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#homeView")).toBeNull();
    el.remove();
  });

  it("聊天壳会用确定高度锁住房间视图，避免禁掉整页滚动后消息区失去内部滚动", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("height: 100%");
    expect(styles).toContain("overflow: hidden");
    expect(styles).toContain(".boot-screen");
  });

  it("没有当前房间恢复锚点时会默认进入空态首页占位并保留最小进房表单", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinForm")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomCode")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#joinBtn")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("#joinBtn")?.textContent?.trim()).toBe(
      "进房"
    );
    el.remove();
  });

  it("有当前房间恢复锚点时会优先恢复房间而不是退回首页", async () => {
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
    expect(el.shadowRoot!.querySelector("#homeView")).toBeNull();
    expect(el.shadowRoot!.querySelector("#joinView")).toBeNull();
    el.remove();
  });

  it("空态首页样式会复用暖夜 token 和圆角材质，而不是浅色网页表单", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".home-screen");
    expect(styles).toContain(".home-card");
    expect(styles).toContain("backdrop-filter: blur");
    expect(styles).toContain("border-radius: 28px");
    expect(styles).toContain("var(--surface-panel)");
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

  it("进房输入框会通过表单 submit 支持回车进房", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));

    const joinForm = el.shadowRoot!.querySelector("#joinForm") as HTMLFormElement | null;
    expect(joinForm).not.toBeNull();
    expect(roomInput.getAttribute("enterkeyhint")).toBe("go");

    joinForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    el.remove();
  });

  it("消息输入框会通过表单 submit 支持回车发送", async () => {
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

    const composerForm = el.shadowRoot!.querySelector("#composerForm") as HTMLFormElement | null;
    expect(composerForm).not.toBeNull();
    expect(msgInput.getAttribute("enterkeyhint")).toBe("send");

    composerForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("hello");
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

  it("浏览器存储会在清除当前房间锚点时保留房间短码缓存", async () => {
    const { 创建浏览器存储 } = await import("../存储");

    const 存储 = 创建浏览器存储(window.localStorage);

    存储.写入当前房间标识("r-test");
    存储.写入当前房间短码("ROOM01");
    存储.清除当前房间标识();

    expect(存储.读取当前房间标识()).toBe("");
    expect(存储.读取当前房间短码()).toBe("ROOM01");
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

  it("进房成功后会缓存当前房间短码并在标题显示短码", async () => {
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

    const roomTitle = el.shadowRoot!.querySelector("#roomTitle");

    expect(window.localStorage.getItem("koko_current_room_code")).toBe("ROOM01");
    expect(roomTitle).not.toBeNull();
    expect(roomTitle?.textContent).toContain("ROOM01");
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
    expect(el.shadowRoot!.querySelector("#roomTitle")?.textContent).toContain("群聊房间");
    expect(el.shadowRoot!.textContent).not.toContain("room:");
    expect(el.shadowRoot!.textContent).not.toContain("r-restore");
    el.remove();
  });

  it("恢复进入房间时若存在短码缓存则继续显示短码而不是内部 room_id", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    window.localStorage.setItem("koko_current_room_code", "ROOM01");
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const roomTitle = el.shadowRoot!.querySelector("#roomTitle");

    expect(roomTitle).not.toBeNull();
    expect(roomTitle?.textContent).toContain("ROOM01");
    expect(el.shadowRoot!.textContent).not.toContain("room:");
    expect(el.shadowRoot!.textContent).not.toContain("r-restore");
    el.remove();
  });

  it("恢复进入房间时若没有短码缓存则回退通用标题且不泄露内部 room_id", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const roomTitle = el.shadowRoot!.querySelector("#roomTitle");

    expect(roomTitle).not.toBeNull();
    expect(roomTitle?.textContent).toContain("群聊房间");
    expect(el.shadowRoot!.textContent).not.toContain("room:");
    expect(el.shadowRoot!.textContent).not.toContain("r-restore");
    el.remove();
  });

  it("点击返回会退出当前房间视图并清掉当前房间锚点", async () => {
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

    const backBtn = el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement | null;

    expect(backBtn).not.toBeNull();
    backBtn?.click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(window.localStorage.getItem("koko_current_room_code")).toBe("ROOM01");
    el.remove();
  });

  it("点击返回不会清匿名身份和会话，但会断开当前房间 socket", async () => {
    const transport = new 假传输();
    const disconnectSpy = vi.spyOn(transport.socket, "disconnect");
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const roomInput = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    const backBtn = el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement | null;

    expect(backBtn).not.toBeNull();
    backBtn?.click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.textContent).toContain("暴躁的企鹅");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("点击返回后再次进房会重建 realtime 连接并重新订阅", async () => {
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

    const backBtn = el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement | null;

    expect(backBtn).not.toBeNull();
    backBtn?.click();
    await 等待组件稳定(el);

    const roomInputAgain = el.shadowRoot!.querySelector("#roomCode") as HTMLInputElement;
    roomInputAgain.value = "ROOM02";
    roomInputAgain.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#joinBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(transport.socketSessionIds).toEqual(["s-test", "s-test"]);
    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) =>
          event === "subscribe_room_stream" &&
          payload.room_id === "r-room-2" &&
          payload.from === 1
      )
    ).toBe(true);
    el.remove();
  });

  it("房间页会渲染单屏聊天结构，顶部是导航头部，底部是输入区", async () => {
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

    const roomHeader = el.shadowRoot!.querySelector("#roomHeader");
    const messageScroll = el.shadowRoot!.querySelector("#messageScroll");
    const composerBar = el.shadowRoot!.querySelector("#composerBar");

    expect(roomHeader).not.toBeNull();
    expect(messageScroll).not.toBeNull();
    expect(composerBar).not.toBeNull();
    expect(
      roomHeader!.compareDocumentPosition(messageScroll!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      messageScroll!.compareDocumentPosition(composerBar!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    el.remove();
  });

  it("房间页关键样式会吃满视口，并用三行网格把消息区夹在中间", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("min-height: 100dvh");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(styles).toContain("padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px))");
  });

  it("房间页输入区会使用更适合窄屏的自适应栅格，而不是继续复用普通表单行", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".composer-bar");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(styles).toContain("@media (max-width: 640px)");
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

  it("刷新恢复房间时，不会在 boot 阶段过早跳过首屏未读定位", async () => {
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
          {
            type: "message_created",
            room_id: "r-restore",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
          },
        ],
      }),
    ];
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);

    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
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

  it("全部已读或无未读分隔条时，恢复首屏会落到当前消息窗口底部", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 60, {
        last_read_event_position: 60,
        first_unread_event_position: null,
        snapshot_messages: Array.from({ length: 55 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-restore",
          message_id: `m-${index + 6}`,
          client_message_id: `c-${index + 6}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `恢复消息-${index + 6}`,
          event_position: index + 6,
        })),
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 720 });
    设置测试滚动阶段(el, {
      initialUnreadSettled: false,
      scrollPhase: "idle",
    });

    (
      el as unknown as { roomScroller: { 安排首屏定位: () => void } }
    ).roomScroller.安排首屏定位();
    await Promise.resolve();
    await 等待组件稳定(el);

    expect(scroll.scrollTop).toBe(480);
    el.remove();
  });

  it("恢复首屏已经把较新的消息放进视口时，会主动推进阅读锚点而不是等用户再手动滚动", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 19, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: Array.from({ length: 19 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-restore",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `恢复消息-${index + 1}`,
          event_position: index + 1,
        })),
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    vi.useFakeTimers();
    try {
      (
        el as unknown as {
          readAnchorFlushTimer: ReturnType<typeof setTimeout> | null;
        }
      ).readAnchorFlushTimer = null;
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 960 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: -60, bottom: -20 },
        { eventPosition: 2, top: 0, bottom: 40 },
        { eventPosition: 3, top: 50, bottom: 90 },
        { eventPosition: 4, top: 100, bottom: 140 },
        { eventPosition: 5, top: 150, bottom: 190 },
        { eventPosition: 6, top: 200, bottom: 240 },
        { eventPosition: 7, top: 250, bottom: 290 },
        { eventPosition: 8, top: 295, bottom: 335 },
      ]);
      设置测试滚动阶段(el, {
        initialUnreadSettled: false,
        firstUnreadEventPosition: 2,
        scrollPhase: "restoring_unread",
        hasUserScrollIntent: false,
      });
      (
        el as unknown as {
          chatState: { pendingReadAnchorPosition: number | null };
        }
      ).chatState.pendingReadAnchorPosition = null;
      (
        el as unknown as {
          shouldPrimeReadAnchorAfterInitialSettle: boolean;
        }
      ).shouldPrimeReadAnchorAfterInitialSettle = true;

      (
        el as unknown as { roomScroller: { 安排首屏定位: () => void } }
      ).roomScroller.安排首屏定位();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(450);

      expect(transport.readAnchorUpdates).toEqual([
        { roomId: "r-restore", sessionId: "s-test", lastReadEventPosition: 7 },
      ]);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("首屏恢复阶段采样到候选已读后，不会在完成前立刻进入待提交队列", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 19, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: Array.from({ length: 19 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-restore",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `恢复消息-${index + 1}`,
          event_position: index + 1,
        })),
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 960 });
    模拟消息滚动视口(el, scroll, [
      { eventPosition: 1, top: -60, bottom: -20 },
      { eventPosition: 2, top: 0, bottom: 40 },
      { eventPosition: 3, top: 50, bottom: 90 },
      { eventPosition: 4, top: 100, bottom: 140 },
      { eventPosition: 5, top: 150, bottom: 190 },
      { eventPosition: 6, top: 200, bottom: 240 },
      { eventPosition: 7, top: 250, bottom: 290 },
      { eventPosition: 8, top: 295, bottom: 335 },
    ]);
    设置测试滚动阶段(el, {
      initialUnreadSettled: false,
      firstUnreadEventPosition: 2,
      scrollPhase: "restoring_unread",
      hasUserScrollIntent: false,
    });

    (
      el as unknown as {
        scheduleReadAnchorUpdate: (position: number) => void;
      }
    ).scheduleReadAnchorUpdate(7);

    expect(
      (
        el as unknown as {
          chatState: { pendingReadAnchorPosition: number | null; candidateReadAnchorPosition: number | null };
        }
      ).chatState.pendingReadAnchorPosition
    ).toBeNull();
    expect(
      (
        el as unknown as {
          chatState: { pendingReadAnchorPosition: number | null; candidateReadAnchorPosition: number | null };
        }
      ).chatState.candidateReadAnchorPosition
    ).toBe(7);

    el.remove();
  });

  it("首屏稳定完成后，已有候选已读才会进入正式待提交队列", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 19, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: Array.from({ length: 19 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-restore",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `恢复消息-${index + 1}`,
          event_position: index + 1,
        })),
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    (
      el as unknown as {
        scheduleReadAnchorUpdate: (position: number) => void;
      }
    ).scheduleReadAnchorUpdate(7);

    (
      el as unknown as {
        handleInitialSettleCompleted: (mode: "围绕未读阅读" | "贴底跟随") => void;
      }
    ).handleInitialSettleCompleted("围绕未读阅读");

    expect(
      (
        el as unknown as {
          chatState: { pendingReadAnchorPosition: number | null; candidateReadAnchorPosition: number | null };
        }
      ).chatState.candidateReadAnchorPosition
    ).toBe(7);
    expect(
      (
        el as unknown as {
          chatState: { pendingReadAnchorPosition: number | null; candidateReadAnchorPosition: number | null };
        }
      ).chatState.pendingReadAnchorPosition
    ).toBe(7);

    el.remove();
  });

  it("久未进入房间并围绕首条未读恢复后，会进入围绕未读阅读模式", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.snapshotQueue = [
      创建房间快照("r-restore", 12, {
        last_read_event_position: 4,
        first_unread_event_position: 5,
        snapshot_messages: Array.from({ length: 12 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-restore",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `恢复消息-${index + 1}`,
          event_position: index + 1,
        })),
      }),
    ];
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(scrollIntoView).toHaveBeenCalled();
    expect(
      (
        el as unknown as {
          chatState: { viewportMode?: string };
        }
      ).chatState.viewportMode
    ).toBe("围绕未读阅读");

    el.remove();
  });

  it("用户围绕旧未读阅读时，新消息到达不会抢走视角，并会标记有更新", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 8, {
        last_read_event_position: 2,
        first_unread_event_position: 3,
        snapshot_messages: Array.from({ length: 8 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 960 });
    模拟消息滚动视口(el, scroll, [
      { eventPosition: 1, top: -60, bottom: -20 },
      { eventPosition: 2, top: -10, bottom: 30 },
      { eventPosition: 3, top: 40, bottom: 80 },
      { eventPosition: 4, top: 90, bottom: 130 },
      { eventPosition: 5, top: 140, bottom: 180 },
      { eventPosition: 6, top: 190, bottom: 230 },
      { eventPosition: 7, top: 240, bottom: 280 },
      { eventPosition: 8, top: 290, bottom: 330 },
    ]);
    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      firstUnreadEventPosition: 3,
      hasUserScrollIntent: true,
      scrollPhase: "idle",
    });
    scroll.scrollTop = 180;
    const beforeScrollTop = scroll.scrollTop;

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-9",
      client_message_id: "c-9",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "新消息-9",
      event_position: 9,
    });
    await 等待组件稳定(el);

    expect(scroll.scrollTop).toBe(beforeScrollTop);
    expect(
      (
        el as unknown as {
          chatState: { hasUnreadNewerMessages?: boolean };
        }
      ).chatState.hasUnreadNewerMessages
    ).toBe(true);

    el.remove();
  });

  it("用户围绕旧未读阅读且有更新时，会出现跳到最新入口", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 8, {
        last_read_event_position: 2,
        first_unread_event_position: 3,
        snapshot_messages: Array.from({ length: 8 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 960 });
    模拟消息滚动视口(el, scroll, [
      { eventPosition: 1, top: -60, bottom: -20 },
      { eventPosition: 2, top: -10, bottom: 30 },
      { eventPosition: 3, top: 40, bottom: 80 },
      { eventPosition: 4, top: 90, bottom: 130 },
      { eventPosition: 5, top: 140, bottom: 180 },
      { eventPosition: 6, top: 190, bottom: 230 },
      { eventPosition: 7, top: 240, bottom: 280 },
      { eventPosition: 8, top: 290, bottom: 330 },
    ]);
    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      firstUnreadEventPosition: 3,
      hasUserScrollIntent: true,
      scrollPhase: "idle",
    });
    scroll.scrollTop = 180;

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-9",
      client_message_id: "c-9",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "新消息-9",
      event_position: 9,
    });
    await 等待组件稳定(el);

    const jumpBtn = el.shadowRoot!.querySelector("#jumpToLatestBtn") as HTMLButtonElement | null;
    expect(jumpBtn).not.toBeNull();
    expect(jumpBtn?.textContent).toContain("跳到最新");

    el.remove();
  });

  it("点击跳到最新入口后才会切到贴底跟随并清掉有更新标记", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 8, {
        last_read_event_position: 2,
        first_unread_event_position: 3,
        snapshot_messages: Array.from({ length: 8 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    let scrollHeight = 960;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    模拟消息滚动视口(el, scroll, [
      { eventPosition: 1, top: -60, bottom: -20 },
      { eventPosition: 2, top: -10, bottom: 30 },
      { eventPosition: 3, top: 40, bottom: 80 },
      { eventPosition: 4, top: 90, bottom: 130 },
      { eventPosition: 5, top: 140, bottom: 180 },
      { eventPosition: 6, top: 190, bottom: 230 },
      { eventPosition: 7, top: 240, bottom: 280 },
      { eventPosition: 8, top: 290, bottom: 330 },
    ]);
    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      firstUnreadEventPosition: 3,
      hasUserScrollIntent: true,
      scrollPhase: "idle",
    });
    scroll.scrollTop = 180;

    scrollHeight = 1020;
    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-9",
      client_message_id: "c-9",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "新消息-9",
      event_position: 9,
    });
    await 等待组件稳定(el);

    const jumpBtn = el.shadowRoot!.querySelector("#jumpToLatestBtn") as HTMLButtonElement | null;
    jumpBtn?.click();
    await 等待组件稳定(el);

    expect(scroll.scrollTop).toBe(720);
    expect(
      (
        el as unknown as {
          chatState: {
            viewportMode?: string;
            hasUnreadNewerMessages?: boolean;
          };
        }
      ).chatState.viewportMode
    ).toBe("贴底跟随");
    expect(
      (
        el as unknown as {
          chatState: {
            viewportMode?: string;
            hasUnreadNewerMessages?: boolean;
          };
        }
      ).chatState.hasUnreadNewerMessages
    ).toBe(false);
    expect(el.shadowRoot!.querySelector("#jumpToLatestBtn")).toBeNull();

    el.remove();
  });

  it("用户贴底时，新消息到达会继续跟随到底部", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 8, {
        last_read_event_position: 8,
        first_unread_event_position: null,
        snapshot_messages: Array.from({ length: 8 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    let scrollHeight = 640;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      firstUnreadEventPosition: null,
      hasUserScrollIntent: true,
      scrollPhase: "idle",
    });
    (
      el as unknown as {
        chatState: { viewportMode?: string };
      }
    ).chatState.viewportMode = "贴底跟随";
    scroll.scrollTop = 400;

    scrollHeight = 700;
    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-9",
      client_message_id: "c-9",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "新消息-9",
      event_position: 9,
    });
    await 等待组件稳定(el);

    expect(scroll.scrollTop).toBe(460);

    el.remove();
  });

  it("用户贴底跟随后，即使没有新的手动滚动，新消息进入视口也会推进已读", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 3,
        first_unread_event_position: null,
        snapshot_messages: Array.from({ length: 3 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      let scrollHeight = 320;
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", {
        configurable: true,
        get: () => scrollHeight,
      });
      设置测试滚动阶段(el, {
        initialUnreadSettled: true,
        firstUnreadEventPosition: null,
        hasUserScrollIntent: false,
        scrollPhase: "idle",
      });
      (
        el as unknown as {
          chatState: { viewportMode?: string; lastReadEventPosition: number | null };
        }
      ).chatState.viewportMode = "贴底跟随";
      (
        el as unknown as {
          chatState: { viewportMode?: string; lastReadEventPosition: number | null };
        }
      ).chatState.lastReadEventPosition = 3;
      scroll.scrollTop = 80;

      scrollHeight = 380;
      transport.socket.trigger("room_event", {
        type: "message_created",
        room_id: "r-test",
        message_id: "m-4",
        client_message_id: "c-4",
        sender_session_id: "s-other",
        sender_display_alias: "冷静的水獭",
        body: "新消息-4",
        event_position: 4,
      });
      await Promise.resolve();
      await el.updateComplete;
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: -120, bottom: -80 },
        { eventPosition: 2, top: -70, bottom: -30 },
        { eventPosition: 3, top: -20, bottom: 20 },
        { eventPosition: 4, top: 40, bottom: 80 },
      ]);

      await vi.advanceTimersByTimeAsync(450);

      expect(transport.readAnchorUpdates).toEqual([
        { roomId: "r-test", sessionId: "s-test", lastReadEventPosition: 4 },
      ]);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
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
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
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
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
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

  it("connect_error invalid_session 会重新 bootstrap 并重拉当前房间", async () => {
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
      创建房间快照("r-restore", 1),
      创建房间快照("r-restore", 2),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    transport.socket.trigger("connect_error", 创建传输错误(401, "invalid_session"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.bootstrapTokens).toHaveLength(2);
    expect(transport.loadRoomSnapshotArgs).toEqual([
      { roomId: "r-restore", sessionId: "s-stale" },
      { roomId: "r-restore", sessionId: "s-refresh" },
    ]);
    expect(transport.socketSessionIds).toEqual(["s-stale", "s-refresh"]);
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
    模拟用户滚动意图(scroll);
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
    模拟用户滚动意图(scroll);
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
    模拟用户滚动意图(scroll);
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
    模拟用户滚动意图(scroll);
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
    模拟用户滚动意图(scroll);
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(1);
    el.remove();
  });

  it("首屏还未稳定时不会把最新底部误推进为已读", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
    };
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
    scroll.scrollTop = 80;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.readAnchorUpdates).toEqual([]);
    el.remove();
  });

  it("程序性首屏恢复滚动不会触发阅读推进，也不会立刻清空未读分隔条", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: -60, bottom: -20 },
        { eventPosition: 2, top: 0, bottom: 40 },
        { eventPosition: 3, top: 50, bottom: 90 },
      ]);
      // 这次滚动是壳层为了恢复首条未读而触发的程序性滚动，不代表用户已经读完它们。
      设置测试滚动阶段(el, {
        initialUnreadSettled: true,
        firstUnreadEventPosition: 2,
        scrollPhase: "restoring_unread",
      });

      scroll.scrollTop = 80;
      scroll.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(450);

      expect(transport.readAnchorUpdates).toEqual([]);
      expect(
        (
          el as unknown as {
            chatState: { firstUnreadEventPosition: number | null };
          }
        ).chatState.firstUnreadEventPosition
      ).toBe(2);
      expect(el.shadowRoot!.querySelector("#unreadDivider")?.textContent).toContain("未读消息");
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("程序性首屏恢复阶段触顶时不会提前拉取更早历史", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        has_more_before: true,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      scrollPhase: "restoring_unread",
    });

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(0);
    el.remove();
  });

  it("历史前插补偿阶段的程序性滚动不会再次触发分页或阅读推进", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        has_more_before: true,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: 0, bottom: 40 },
        { eventPosition: 2, top: 50, bottom: 90 },
        { eventPosition: 3, top: 100, bottom: 140 },
      ]);
      设置测试滚动阶段(el, {
        initialUnreadSettled: true,
        scrollPhase: "compensating_history",
      });

      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(450);

      expect(transport.loadRoomHistoryCalls).toBe(0);
      expect(transport.readAnchorUpdates).toEqual([]);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("即使已经回到 idle，只要没有用户滚动意图，程序性滚动也不会推进已读", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: -60, bottom: -20 },
        { eventPosition: 2, top: 0, bottom: 40 },
        { eventPosition: 3, top: 50, bottom: 90 },
      ]);
      设置测试滚动阶段(el, {
        initialUnreadSettled: true,
        firstUnreadEventPosition: 2,
        scrollPhase: "idle",
        hasUserScrollIntent: false,
      });

      scroll.scrollTop = 80;
      scroll.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(450);

      expect(transport.readAnchorUpdates).toEqual([]);
      expect(
        (
          el as unknown as {
            chatState: { firstUnreadEventPosition: number | null };
          }
        ).chatState.firstUnreadEventPosition
      ).toBe(2);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("即使已经回到 idle，只要没有用户滚动意图，程序性触顶也不会拉更早历史", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        has_more_before: true,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条未读",
            event_position: 3,
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

    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      scrollPhase: "idle",
      hasUserScrollIntent: false,
    });

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(0);
    el.remove();
  });

  it("用户向下阅读后会节流上报新的 last_read_event_position", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        last_read_event_position: 1,
        first_unread_event_position: null,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "未读消息-1",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "未读消息-2",
            event_position: 3,
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: 0, bottom: 40 },
        { eventPosition: 2, top: 50, bottom: 90 },
        { eventPosition: 3, top: 100, bottom: 140 },
      ]);
      模拟用户滚动意图(scroll);
      scroll.scrollTop = 80;
      scroll.dispatchEvent(new Event("scroll"));
      scroll.dispatchEvent(new Event("scroll"));

      await vi.advanceTimersByTimeAsync(350);
      expect(transport.readAnchorUpdates).toEqual([]);
      await vi.advanceTimersByTimeAsync(100);

      expect(transport.readAnchorUpdates).toEqual([
        { roomId: "r-test", sessionId: "s-test", lastReadEventPosition: 3 },
      ]);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("用户停在中段阅读时会按视口里最后完整可见消息推进已读", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 19, {
        last_read_event_position: 1,
        first_unread_event_position: 2,
        snapshot_messages: Array.from({ length: 19 }, (_, index) => ({
          type: "message_created" as const,
          room_id: "r-test",
          message_id: `m-${index + 1}`,
          client_message_id: `c-${index + 1}`,
          sender_session_id: index % 2 === 0 ? "s-other" : "s-test",
          sender_display_alias: index % 2 === 0 ? "冷静的水獭" : "暴躁的企鹅",
          body: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 300 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 960 });
      模拟消息滚动视口(el, scroll, [
        { eventPosition: 1, top: -60, bottom: -20 },
        { eventPosition: 2, top: 0, bottom: 40 },
        { eventPosition: 3, top: 50, bottom: 90 },
        { eventPosition: 4, top: 100, bottom: 140 },
        { eventPosition: 5, top: 150, bottom: 190 },
        { eventPosition: 6, top: 200, bottom: 240 },
        { eventPosition: 7, top: 250, bottom: 290 },
        { eventPosition: 8, top: 295, bottom: 335 },
      ]);
      模拟用户滚动意图(scroll);
      scroll.scrollTop = 180;
      scroll.dispatchEvent(new Event("scroll"));

      await vi.advanceTimersByTimeAsync(450);

      expect(transport.readAnchorUpdates).toEqual([
        { roomId: "r-test", sessionId: "s-test", lastReadEventPosition: 7 },
      ]);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("阅读推进失败不会清空消息或踢出房间", async () => {
    const transport = new 假传输();
    transport.readAnchorUpdateQueue = [创建传输错误(503, "system_error", "busy")];
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        last_read_event_position: 0,
        first_unread_event_position: null,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            body: "还在房间里的消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "第二条消息",
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

    vi.useFakeTimers();
    try {
      const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
        scrollTop: number;
        clientHeight: number;
        scrollHeight: number;
      };
      Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 240 });
      Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 300 });
      模拟用户滚动意图(scroll);
      scroll.scrollTop = 80;
      scroll.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(500);

      expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("还在房间里的消息");
      expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-test");
    } finally {
      vi.useRealTimers();
      el.remove();
    }
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
    模拟用户滚动意图(scroll);
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
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
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
