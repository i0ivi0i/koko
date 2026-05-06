// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeStorage,
  假传输,
  创建房间快照,
  创建传输错误,
  等待组件稳定,
  读取操作台主动作,
  输入房间短码到操作台,
  输入消息到操作台,
  模拟用户滚动意图,
  模拟消息滚动视口,
} from "./common/聊天测试支架";
import {
  默认消息文本布局环境,
  派生聊天列表展示项,
} from "../房间消息窗/视图";
import { 聊天壳 } from "../应用根/聊天壳";
describe("聊天壳集成 / 阅读推进与消息并流", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
  });
  it("消息展示项会绑定布局结果，但保留原始 body 作为消息事实", () => {
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "需要换行的展示文本 hello hello hello",
          event_position: 1,
        },
      ],
      "s-test",
      null,
      {
        ...默认消息文本布局环境,
        maxContentWidth: 120,
      }
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    expect(items[0].body).toBe("需要换行的展示文本 hello hello hello");
    expect(items[0].layout.lineCount).toBeGreaterThan(0);
    expect(items[0].layout.lines.length).toBe(items[0].layout.lineCount);
    expect(items[0].bubbleWidth).toBeGreaterThan(0);
  });

  it("图片附件会被派生成可渲染的消息展示项，而不是丢在壳层临时态里", () => {
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-img-1",
          client_message_id: "c-img-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "看图",
          attachments: [
            {
              kind: "image",
              attachment_id: "att-1",
              width: 960,
              height: 640,
            },
          ],
          event_position: 1,
        },
      ],
      "s-test",
      null,
      默认消息文本布局环境,
      {
        "att-1": {
          thumbnailSrc: "/api/attachments/att-1/thumb",
        },
      }
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    expect(items[0].attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-1",
        thumbnailSrc: "",
      }),
    ]);
    expect("originalSrc" in (items[0].attachments[0] ?? {})).toBe(false);
    expect(items[0].bubbleWidth).toBeGreaterThan(0);
  });

  it("视频附件即使给了旧 original 内容地址表，也只保留 poster 预览而不再派生正式 originalSrc", () => {
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-video-1",
          client_message_id: "c-video-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "",
          attachments: [
            {
              kind: "video",
              attachment_id: "att-video-1",
              width: 1280,
              height: 720,
              has_preview_asset: true,
            },
          ],
          event_position: 1,
        },
      ],
      "s-test",
      null,
      默认消息文本布局环境,
      {
        "att-video-1": {
          thumbnailSrc: "/api/attachments/att-video-1/thumb",
        },
      }
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    expect(items[0].attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-video-1",
        posterSrc: "/api/attachments/att-video-1/thumb",
      }),
    ]);
    expect("originalSrc" in (items[0].attachments[0] ?? {})).toBe(false);
  });

  it("聊天壳实例不再把媒体查看器和播放结果表挂在壳层对象上", () => {
    const el = document.createElement("koko-chat-shell") as 聊天壳;

    expect("媒体查看器" in (el as object)).toBe(false);
    expect("媒体播放结果表" in (el as object)).toBe(false);
  });

  it("消息气泡宽度会按紧凑 shrinkwrap 结果收窄，而不是继续等于自然单行宽度", () => {
    const 气泡外框附加宽度 =
      默认消息文本布局环境.bubbleHorizontalPadding +
      默认消息文本布局环境.bubbleHorizontalBorderWidth;
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "did you see the new library today",
          event_position: 1,
        },
      ],
      "s-test",
      null,
      {
        ...默认消息文本布局环境,
        maxContentWidth: 140,
        singleLineMaxContentWidth: 140,
      }
    );

    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    // 如果还在用 `naturalWidth + padding`，这里会接近单行自然宽度；
    // 真正的 bubbles 式 shrinkwrap 应该看紧凑布局后的最宽一行。
    expect(items[0].bubbleWidth).toBeLessThan(items[0].layout.naturalWidth + 气泡外框附加宽度);
  });

  it("单行自然宽度落在单行直通上限内时，会保持单行而不是被压成两行", () => {
    const 气泡外框附加宽度 =
      默认消息文本布局环境.bubbleHorizontalPadding +
      默认消息文本布局环境.bubbleHorizontalBorderWidth;
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "alpha beta gamma",
          event_position: 1,
        },
      ],
      "s-test",
      null,
      {
        ...默认消息文本布局环境,
        maxContentWidth: 140,
        singleLineMaxContentWidth: 220,
      }
    );

    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    // 这条消息在 140px 下会被断成两行，但它的单行自然宽度仍在单行直通上限内。
    // 所以正确行为是回到单行，而不是继续执行多行 shrinkwrap。
    expect(items[0].layout.naturalWidth).toBeGreaterThan(140);
    expect(items[0].layout.lineCount).toBe(1);
    expect(items[0].bubbleWidth).toBeGreaterThan(140 + 气泡外框附加宽度);
  });

  it("单行短消息的气泡外框宽度会把 border-box 边框也算进去，避免正文少 2px 被挤成两行", () => {
    const 气泡外框附加宽度 =
      默认消息文本布局环境.bubbleHorizontalPadding +
      默认消息文本布局环境.bubbleHorizontalBorderWidth;
    const items = 派生聊天列表展示项(
      [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "三个字",
          event_position: 1,
        },
      ],
      "s-test",
      null,
      {
        ...默认消息文本布局环境,
        maxContentWidth: 120,
        singleLineMaxContentWidth: 120,
      }
    );

    if (items[0]?.kind !== "message") {
      throw new Error("测试前提不成立：首个展示项必须是消息");
    }

    /**
     * 这里锁的是运行时宽度契约，而不是某个体验文案：
     * 在 `box-sizing: border-box` 下，Presenter 给 `.message-bubble` 的宽度
     * 必须覆盖正文、左右 padding 和左右边框，否则真实 DOM 可用正文宽度会比
     * Pretext 预算少 2px，短中文就会稳定出现 `2+1 / 3+1 / 4+1` 断行。
     */
    expect(items[0].layout.lineCount).toBe(1);
    expect(items[0].bubbleWidth - 气泡外框附加宽度).toBeGreaterThanOrEqual(
      items[0].layout.maxLineWidth
    );
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
            text: "未读消息-1",
            event_position: 2,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-3",
            client_message_id: "c-3",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "未读消息-2",
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
          text: `消息-${index + 1}`,
          event_position: index + 1,
        })),
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
            text: "还在房间里的消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "第二条消息",
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
            text: "现在消息",
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
            text: "更早消息",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2-dup",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "现在消息",
            event_position: 2,
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
    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-3",
      client_message_id: "c-3",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      text: "新消息",
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    输入消息到操作台(el, "hello");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    transport.socket.trigger("room_event", {
      type: "message_created",
      room_id: "r-test",
      message_id: "m-other",
      client_message_id: "c-other",
      sender_session_id: "s-other",
      sender_display_alias: "冷静的水獭",
      text: "other hello",
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
