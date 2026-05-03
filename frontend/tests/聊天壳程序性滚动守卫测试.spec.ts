// @vitest-environment happy-dom

import { beforeEach,describe,expect,it,vi } from "vitest";
import { 聊天壳 } from "../总装/聊天壳";
import {
createFakeStorage,
假传输,
创建房间快照,
模拟消息滚动视口,
注入媒体查看器供测试,
等待组件稳定,
设置测试滚动阶段,
读取房间滚动器供测试,
读取操作台主动作,
读取聊天快照供测试,
输入房间短码到操作台
} from "./common/聊天测试支架";

describe("聊天壳集成 / 程序性滚动守卫", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
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

