// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import {
  createFakeStorage,
  假传输,
  创建房间快照,
  创建传输错误,
  等待组件稳定,
  读取操作台主输入,
  读取操作台主动作,
  读取操作台表单,
  输入房间短码到操作台,
  输入消息到操作台,
} from "./common/聊天测试支架";
import {
  派生壳主舞台模式,
  派生控制台模式,
  派生壳级操作台状态,
  派生首页会话展示项,
} from "../视图";
import type { 匿名身份引导结果 } from "../契约";
import { 聊天壳 } from "../聊天壳";
describe("聊天壳集成 / 引导与入房", () => {
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    expect(
      transport.socket.sentEvents.some(
        ({ event, payload }) =>
          event === "subscribe_room_stream" && payload.room_id === "r-test" && payload.from === 1
      )
    ).toBe(true);

    输入消息到操作台(el, "hello");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#messageList")!;
    expect(list.textContent).toContain("hello");
    expect(list.textContent).not.toContain("[1]");

    const storedHistory = JSON.parse(
      window.localStorage.getItem("koko_home_sessions") ?? "[]"
    ) as Array<{ roomId: string; roomCode: string; lastEnteredAt: number }>;
    expect(storedHistory).toEqual([
      { roomId: "r-test", roomCode: "ROOM01", lastEnteredAt: expect.any(Number) },
    ]);

    (el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    const historyAfterLeave = JSON.parse(
      window.localStorage.getItem("koko_home_sessions") ?? "[]"
    ) as Array<{ roomId: string; roomCode: string; lastEnteredAt: number }>;
    expect(historyAfterLeave).toEqual(storedHistory);
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#homeRoomList")?.textContent).toContain("ROOM01");
    el.remove();
  });

  it("进房输入框会通过表单 submit 支持回车进房", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");

    const shellConsoleForm = 读取操作台表单(el);
    expect(读取操作台主输入(el).getAttribute("enterkeyhint")).toBe("go");

    shellConsoleForm.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    输入消息到操作台(el, "hello");

    const shellConsoleForm = 读取操作台表单(el);
    expect(读取操作台主输入(el).getAttribute("enterkeyhint")).toBe("send");

    shellConsoleForm.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-99",
      client_message_id: "c-99",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      body: "需要回退快照的最新消息",
      event_position: 99,
    });
    await 等待组件稳定(el);
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBe("r-test");
    el.remove();
  });

  it("浏览器存储会在清除当前房间锚点时保留房间短码缓存", async () => {
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
    输入房间短码到操作台(el, "ROOM02");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    const backBtn = el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement | null;

    expect(backBtn).not.toBeNull();
    backBtn?.click();
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM02");
    读取操作台主动作(el).click();
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

  it("房间页会渲染主舞台加壳级控制台，顶部是导航头部，底部是固定输入区", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    const roomHeader = el.shadowRoot!.querySelector("#roomHeader");
    const messageScroll = el.shadowRoot!.querySelector("#messageScroll");
    const shellConsole = el.shadowRoot!.querySelector("#shellConsole");

    expect(roomHeader).not.toBeNull();
    expect(messageScroll).not.toBeNull();
    expect(shellConsole).not.toBeNull();
    expect(
      roomHeader!.compareDocumentPosition(messageScroll!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      messageScroll!.compareDocumentPosition(shellConsole!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    el.remove();
  });

  it("壳级布局关键样式会先锁一层主舞台加控制台，再让房间页自己夹住消息区", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("min-height: 100dvh");
    expect(styles).toContain(".shell-screen");
    expect(styles).toContain("grid-template-rows: minmax(0, 1fr) auto");
    expect(styles).toContain(".room-screen");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr)");
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

});

