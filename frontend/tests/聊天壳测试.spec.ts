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
describe("聊天壳集成 / 首页与控制台", () => {
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

  it("操作台主输入和主动作在不同模式下共用同一套高度约束", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("#shellConsolePrimaryInput");
    expect(styles).toContain("#shellConsolePrimaryAction");
    expect(styles).toContain("min-height: 50px");
  });

  it("状态槽会单行截断，不会因文案变化撑高操作台", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("#shellConsoleStatus");
    expect(styles).toContain("white-space: nowrap");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("overflow: hidden");
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

  it("没有当前房间恢复锚点时会默认进入空态首页占位并保留最小进房控制台", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsoleForm")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryInput")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryAction")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("#shellConsolePrimaryAction")?.textContent?.trim()).toBe(
      "进房"
    );
    el.remove();
  });

  it("进入房间后会通过独立消息窗口组件承接消息区，但保留现有滚动查询入口", async () => {
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
            body: "消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            body: "消息-2",
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

    expect(el.shadowRoot!.querySelector("koko-room-message-pane")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#messageScroll")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#messageList")).not.toBeNull();
    el.remove();
  });

  it("boot 态时唯一操作台骨架仍然常驻，但主输入和主动作不可交互", async () => {
    const transport = new 假传输();
    vi.spyOn(transport, "bootstrapAnonymousIdentity").mockImplementation(
      () => new Promise<匿名身份引导结果>(() => {})
    );
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsoleMainRow")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsoleAuxSlot")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryInput")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryAction")).not.toBeNull();
    expect(
      (el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (el.shadowRoot!.querySelector("#shellConsolePrimaryAction") as HTMLButtonElement).disabled
    ).toBe(true);
    el.remove();
  });

  it("首页与房间都共用同一套操作台 selector 骨架", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const homeSelectors = [
      "#shellConsole",
      "#shellConsoleStatus",
      "#shellConsoleMainRow",
      "#shellConsoleAuxSlot",
      "#shellConsolePrimaryInput",
      "#shellConsolePrimaryAction",
    ].map((selector) => el.shadowRoot!.querySelector(selector));

    const roomInput = el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#shellConsolePrimaryAction") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    for (const selector of [
      "#shellConsole",
      "#shellConsoleStatus",
      "#shellConsoleMainRow",
      "#shellConsoleAuxSlot",
      "#shellConsolePrimaryInput",
      "#shellConsolePrimaryAction",
    ]) {
      expect(el.shadowRoot!.querySelector(selector)).not.toBeNull();
    }
    expect(homeSelectors.every(Boolean)).toBe(true);
    el.remove();
  });

  it("首页与房间都只存在同一个主 form", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelectorAll("form").length).toBe(1);

    const roomInput = el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement;
    roomInput.value = "ROOM01";
    roomInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#shellConsolePrimaryAction") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelectorAll("form").length).toBe(1);
    el.remove();
  });

  it("浏览器存储会按 roomId 去重、按 lastEnteredAt 倒序读取首页房间历史", () => {
    const rawStorage = createFakeStorage();
    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
      写入或更新首页房间历史条目(entry: {
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }): void;
    };

    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-1",
      roomCode: "ROOM-OLD",
      lastEnteredAt: 100,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-2",
      roomCode: "ROOM-MID",
      lastEnteredAt: 200,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-1",
      roomCode: "ROOM-NEW",
      lastEnteredAt: 300,
    });

    expect(browserStorage.读取首页房间历史()).toEqual([
      { roomId: "r-1", roomCode: "ROOM-NEW", lastEnteredAt: 300 },
      { roomId: "r-2", roomCode: "ROOM-MID", lastEnteredAt: 200 },
    ]);
  });

  it("浏览器存储支持按房间标识删除首页房间历史条目", () => {
    const rawStorage = createFakeStorage();
    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
      写入或更新首页房间历史条目(entry: {
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }): void;
      按房间标识删除首页房间历史条目(roomId: string): void;
    };

    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-1",
      roomCode: "ROOM01",
      lastEnteredAt: 100,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-2",
      roomCode: "ROOM02",
      lastEnteredAt: 200,
    });

    browserStorage.按房间标识删除首页房间历史条目("r-1");

    expect(browserStorage.读取首页房间历史()).toEqual([
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
    ]);
  });

  it("浏览器存储在 JSON 损坏时会安全回退为空列表", () => {
    const rawStorage = createFakeStorage();
    rawStorage.setItem("koko_home_sessions", "{broken-json");

    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
    };

    expect(browserStorage.读取首页房间历史()).toEqual([]);
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

  it("启动时会把本地恢复的历史房间列表渲染到首页", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 300 },
      ])
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const list = el.shadowRoot!.querySelector("#homeRoomList");
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain("ROOM01");
    expect(list?.textContent).toContain("ROOM02");
    expect(list?.querySelectorAll("[data-room-id]").length).toBe(2);
    expect(list?.querySelectorAll("[data-room-id]")[0]?.textContent).toContain("ROOM01");
    el.remove();
  });

  it("点击首页历史房间会直接进房并沿用既有进房主链", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([{ roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 300 }])
    );
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const historyEntry = el.shadowRoot!.querySelector('[data-room-id="r-1"]') as HTMLElement | null;
    expect(historyEntry).not.toBeNull();

    historyEntry!.click();
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);
    expect(el.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    el.remove();
  });

  it("底部控制台在首页和房间内都存在同一锚点容器", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const homeConsole = el.shadowRoot!.querySelector("#shellConsole");
    expect(homeConsole).not.toBeNull();

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    const roomConsole = el.shadowRoot!.querySelector("#shellConsole");
    expect(roomConsole).not.toBeNull();
    expect(homeConsole?.id).toBe(roomConsole?.id);
    el.remove();
  });

  it("从房间返回首页后控制台会切回进房语义", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);

    (el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#shellConsolePrimaryInput")).not.toBeNull();
    expect(读取操作台主输入(el).getAttribute("placeholder")).toBe("房间短码");
    expect(读取操作台主动作(el).textContent).toContain("进房");
    el.remove();
  });

  it("壳主舞台模式和控制台模式都只从 bootstrapState 与 roomId 派生", () => {
    expect(
      派生壳主舞台模式({
        bootstrapState: "booting",
        roomId: "",
      })
    ).toBe("boot");
    expect(
      派生壳主舞台模式({
        bootstrapState: "ready",
        roomId: "",
      })
    ).toBe("home");
    expect(
      派生壳主舞台模式({
        bootstrapState: "ready",
        roomId: "r-1",
      })
    ).toBe("room");

    expect(
      派生控制台模式({
        bootstrapState: "booting",
        roomId: "",
      })
    ).toBe("hidden");
    expect(
      派生控制台模式({
        bootstrapState: "ready",
        roomId: "",
      })
    ).toBe("join");
    expect(
      派生控制台模式({
        bootstrapState: "ready",
        roomId: "r-1",
      })
    ).toBe("message");
  });

  it("boot / home / room 都由同一个操作台状态模型派生", () => {
    expect(
      派生壳级操作台状态({
        consoleMode: "hidden",
        roomCodeInput: "",
        messageInput: "",
        pending: false,
        statusText: "正在恢复",
      })
    ).toMatchObject({
      mode: "hidden",
      primaryInput: { disabled: true },
      primaryAction: { disabled: true },
    });

    expect(
      派生壳级操作台状态({
        consoleMode: "join",
        roomCodeInput: "ROOM01",
        messageInput: "",
        pending: false,
        statusText: "输入房间号进入",
      })
    ).toMatchObject({
      mode: "join",
      primaryInput: {
        value: "ROOM01",
        placeholder: "房间短码",
        enterKeyHint: "go",
      },
      primaryAction: { label: "进房" },
    });

    expect(
      派生壳级操作台状态({
        consoleMode: "message",
        roomCodeInput: "",
        messageInput: "hello",
        pending: true,
        statusText: "当前房间",
      })
    ).toMatchObject({
      mode: "message",
      primaryInput: {
        value: "hello",
        placeholder: "输入消息",
        enterKeyHint: "send",
      },
      primaryAction: { label: "发送", disabled: true },
    });
  });

  it("首页和房间都只存在同一个主输入与同一个主动作节点", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryInput").length).toBe(1);
    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryAction").length).toBe(1);

    const primaryInput = el.shadowRoot!.querySelector(
      "#shellConsolePrimaryInput"
    ) as HTMLInputElement;
    primaryInput.value = "ROOM01";
    primaryInput.dispatchEvent(new Event("input"));
    (el.shadowRoot!.querySelector("#shellConsolePrimaryAction") as HTMLButtonElement).click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryInput").length).toBe(1);
    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryAction").length).toBe(1);
    el.remove();
  });

  it("唯一主 form 会按模式把 submit 派发到进房或发消息主链", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    const primaryInput = el.shadowRoot!.querySelector(
      "#shellConsolePrimaryInput"
    ) as HTMLInputElement;
    const shellConsoleForm = el.shadowRoot!.querySelector(
      "#shellConsoleForm"
    ) as HTMLFormElement | null;

    expect(shellConsoleForm).not.toBeNull();

    primaryInput.value = "ROOM01";
    primaryInput.dispatchEvent(new Event("input"));
    shellConsoleForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);

    const messageInput = el.shadowRoot!.querySelector(
      "#shellConsolePrimaryInput"
    ) as HTMLInputElement;
    messageInput.value = "hello";
    messageInput.dispatchEvent(new Event("input"));
    shellConsoleForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#messageList")!.textContent).toContain("hello");
    el.remove();
  });

  it("首页会话展示项会把房间标题和辅助文案收口到 presenter", () => {
    expect(
      派生首页会话展示项([
        { roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 1710000000000 },
      ])
    ).toEqual([
      {
        roomId: "r-1",
        roomCode: "ROOM01",
        title: "ROOM01",
        meta: expect.stringContaining("最近进入"),
      },
    ]);
  });

  it("空态首页样式会复用暖夜 token 和圆角材质，而不是浅色网页表单", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".home-screen");
    expect(styles).toContain(".home-card");
    expect(styles).toContain("backdrop-filter: blur");
    expect(styles).toContain("border-radius: 28px");
    expect(styles).toContain("var(--surface-panel)");
  });

});

