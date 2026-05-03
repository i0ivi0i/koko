// @vitest-environment happy-dom

import { beforeEach,describe,expect,it,vi } from "vitest";
import { 聊天壳 } from "../应用根/聊天壳";
import type { 房间历史页 } from "../聊天共享/契约";
import {
createFakeStorage,
假传输,
创建传输错误,
创建房间快照,
模拟用户滚动意图,
等待组件稳定,
读取操作台主动作,
读取聊天快照供测试,
输入房间短码到操作台
} from "./common/聊天测试支架";

describe("聊天壳集成 / 历史分页与锚点补偿", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
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
});

