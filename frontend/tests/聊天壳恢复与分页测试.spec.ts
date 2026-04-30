// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import {
  createFakeStorage,
  假传输,
  创建房间快照,
  创建传输错误,
  注入媒体查看器供测试,
  等待组件稳定,
  读取操作台主输入,
  读取操作台主动作,
  读取操作台表单,
  读取房间滚动器供测试,
  读取聊天快照供测试,
  输入房间短码到操作台,
  输入消息到操作台,
  设置测试滚动阶段,
  模拟用户滚动意图,
  模拟消息滚动视口,
} from "./common/聊天测试支架";
import {
  派生壳主舞台模式,
  派生控制台模式,
  派生壳级操作台状态,
  派生首页会话展示项,
} from "../视图";
import type { 匿名身份引导结果, 房间历史页 } from "../契约";
import { 聊天壳 } from "../聊天壳";
describe("聊天壳集成 / 恢复失败与历史分页", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("聊天壳恢复入口仍只通过内核 dispatch，不自己触发 bootstrap 或 snapshot 恢复", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天壳.ts"), "utf8");

    expect(source).toContain('this.kernel.dispatch({ type: "BOOTSTRAP_REQUESTED" })');
    expect(source).not.toContain("bootstrapAnonymousIdentity(");
    expect(source).not.toContain("loadRoomSnapshot(");
    expect(source).not.toContain("joinOrCreateRoom(");
  });

  it("room_not_found 会清掉 current_room_id、删除对应历史并回到首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-missing");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-missing", roomCode: "ROOM01", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(404, "room_not_found")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(window.localStorage.getItem("koko_home_sessions")).toBe("[]");
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });

  it("room_not_found 回首页后仍保留上一间房短码，允许直接重新进房", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-missing");
    window.localStorage.setItem("koko_current_room_code", "ROOM01");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-missing", roomCode: "ROOM01", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(404, "room_not_found")];
    transport.joinQueue = [创建房间快照("r-recreated")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(读取操作台主输入(el).value).toBe("ROOM01");
    expect(读取操作台主动作(el).disabled).toBe(false);
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");

    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });

  it("membership_required 会清掉 current_room_id、但保留历史并回到首页", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-blocked");
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-blocked", roomCode: "ROOM02", lastEnteredAt: 100 }])
    );
    const transport = new 假传输();
    transport.snapshotQueue = [创建传输错误(403, "membership_required")];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(window.localStorage.getItem("koko_current_room_id")).toBeNull();
    expect(window.localStorage.getItem("koko_home_sessions")).toContain("ROOM02");
    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });

  it("1234b 这类重房间的本地恢复快照写入失败时，仍应进入房间而不是显示恢复失败", async () => {
    const storage = createFakeStorage();
    const rawSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string): void => {
      if (key === "koko_current_room_snapshot") {
        throw new DOMException("localStorage quota exceeded", "QuotaExceededError");
      }
      rawSetItem(key, value);
    };
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
    });
    const transport = new 假传输();
    transport.joinQueue = [创建房间快照("r-1234b", 7)];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "1234b");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "1234b" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("1234b");
    expect(el.shadowRoot!.textContent).not.toContain("恢复失败");
    el.remove();
  });

  it("invalid_session 会重新 bootstrap 再决定恢复分支", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
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
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
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

  it("connect_error invalid_session 会重新 bootstrap 并通过恢复链刷新当前房间", async () => {
    window.localStorage.setItem("koko_current_room_id", "r-restore");
    const transport = new 假传输();
    transport.bootstrapQueue = [
      {
        display_alias: "暴躁的企鹅",
        session_id: "s-stale",
      },
      {
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
            text: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
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
            text: "历史消息-1",
            event_position: 1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

  it("上滑历史前插后会守住旧消息锚点的视口位置", async () => {
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
            text: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
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
            text: "历史消息-1",
            event_position: 1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

  it("历史前插后原有消息节点会保持同一 DOM 身份", async () => {
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
            text: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
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
            text: "历史消息-1",
            event_position: 1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 旧消息节点 = el.shadowRoot!.querySelector(
      '[data-event-position="2"]'
    ) as HTMLElement | null;
    expect(旧消息节点).not.toBeNull();

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    模拟用户滚动意图(scroll);
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 新消息节点 = el.shadowRoot!.querySelector(
      '[data-event-position="2"]'
    ) as HTMLElement | null;
    expect(新消息节点).not.toBeNull();
    expect(新消息节点).toBe(旧消息节点);
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
            text: "保留消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "保留消息-2",
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
    expect(读取聊天快照供测试(el).historyErrorCode).toBe("system_error");
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
            text: "最早消息",
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
    expect(读取聊天快照供测试(el).hasMoreBefore).toBe(false);
    el.remove();
  });

  it("历史加载中时房间头部和底部不再跟着切到更早消息文案", async () => {
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
            text: "历史消息-2",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
            event_position: 3,
          },
        ],
        has_more_before: true,
      }),
    ];
    let resolveHistory: ((value: 房间历史页) => void) | undefined;
    transport.loadRoomHistory = vi.fn(
      () =>
        new Promise<房间历史页>((resolve) => {
          resolveHistory = resolve;
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

    const roomSubtitle = el.shadowRoot!.querySelector("#roomSubtitle") as HTMLElement;
    const shellConsoleStatus = el.shadowRoot!.querySelector("#shellConsoleStatus") as HTMLElement;
    const subtitleBefore = roomSubtitle.textContent;
    const consoleBefore = shellConsoleStatus.textContent;

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    模拟用户滚动意图(scroll);
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(roomSubtitle.textContent).toBe(subtitleBefore);
    expect(shellConsoleStatus.textContent).toBe(consoleBefore);

    resolveHistory?.({ room_id: "r-test", messages: [] });
    await 等待组件稳定(el);
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
            text: "历史消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-2",
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
            text: "更早消息",
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
            text: "不该再次请求到这里",
            event_position: -1,
          },
        ],
      },
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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
      expect(读取聊天快照供测试(el).firstUnreadEventPosition).toBe(2);
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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
      expect(读取聊天快照供测试(el).firstUnreadEventPosition).toBe(2);
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
            text: "已读消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "第一条未读",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条未读",
            event_position: 3,
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

  it("点开媒体查看器后的紧邻程序性 scroll 不会误触发历史分页", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        has_more_before: true,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "历史消息-2",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
            event_position: 3,
          },
        ],
      }),
    ];
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      scrollPhase: "idle",
      hasUserScrollIntent: true,
    });

    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };
    const previewTrigger = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
    );
    expect(previewTrigger).not.toBeNull();

    previewTrigger!.click();
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalled();
    expect(transport.loadRoomHistoryCalls).toBe(0);
    el.remove();
  });

  it("媒体查看器关闭后的滚动尾波不会被壳层误判成用户翻历史", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 3, {
        has_more_before: true,
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "历史消息-2",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-image-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "历史消息-3",
            event_position: 3,
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

    设置测试滚动阶段(el, {
      initialUnreadSettled: true,
      scrollPhase: "idle",
      hasUserScrollIntent: true,
    });

    const roomScroller = 读取房间滚动器供测试<{
      登记程序滚动来源(source: "media_viewer_open"): void;
      清除程序滚动来源(source: "media_viewer_open"): void;
    }>(el);
    const scroll = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement & {
      scrollTop: number;
    };

    roomScroller.登记程序滚动来源("media_viewer_open");
    roomScroller.清除程序滚动来源("media_viewer_open");
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(0);

    scroll.dispatchEvent(new Event("wheel"));
    scroll.dispatchEvent(new Event("scroll"));
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(transport.loadRoomHistoryCalls).toBe(1);
    el.remove();
  });

});

