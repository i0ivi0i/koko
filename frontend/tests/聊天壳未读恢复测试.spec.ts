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
  读取房间滚动器供测试,
  读取聊天快照供测试,
  读取阅读推进编排端口供测试,
  写入恢复补锚标记供测试,
  注入聊天快照补丁供测试,
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
import type { 匿名身份引导结果 } from "../契约";
import { 聊天壳 } from "../聊天壳";
describe("聊天壳集成 / 未读恢复与跟随", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
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

    读取房间滚动器供测试<{ 安排首屏定位: () => void }>(el).安排首屏定位();
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
      注入聊天快照补丁供测试(el, { pendingReadAnchorPosition: null });
      写入恢复补锚标记供测试(el, true);

      读取房间滚动器供测试<{ 安排首屏定位: () => void }>(el).安排首屏定位();
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

    读取阅读推进编排端口供测试<{
      接收候选已读位置: (position: number) => void;
    }>(el).接收候选已读位置(7);

    expect(读取聊天快照供测试(el).pendingReadAnchorPosition).toBeNull();
    expect(读取聊天快照供测试(el).candidateReadAnchorPosition).toBe(7);

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

    const 阅读推进编排端口 = 读取阅读推进编排端口供测试<{
      接收候选已读位置: (position: number) => void;
      接收首屏稳定完成: (mode: "围绕未读阅读" | "贴底跟随") => void;
    }>(el);

    阅读推进编排端口.接收候选已读位置(7);
    阅读推进编排端口.接收首屏稳定完成("围绕未读阅读");

    expect(读取聊天快照供测试(el).candidateReadAnchorPosition).toBe(7);
    expect(读取聊天快照供测试(el).pendingReadAnchorPosition).toBe(7);

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
    expect(读取聊天快照供测试(el).viewportMode).toBe("围绕未读阅读");

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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
    expect(读取聊天快照供测试(el).hasUnreadNewerMessages).toBe(true);

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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
    expect(读取聊天快照供测试(el).viewportMode).toBe("贴底跟随");
    expect(读取聊天快照供测试(el).hasUnreadNewerMessages).toBe(false);
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

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
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
    注入聊天快照补丁供测试(el, { viewportMode: "贴底跟随" });
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
    注入聊天快照补丁供测试(el, {
      viewportMode: "贴底跟随",
      lastReadEventPosition: 3,
    });
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

});

