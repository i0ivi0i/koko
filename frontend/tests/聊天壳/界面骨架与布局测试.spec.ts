// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 匿名身份引导结果 } from "../../聊天共享/契约";
import { 聊天壳 } from "../../总装/聊天壳";
import {
  派生壳主舞台模式,
  派生控制台模式,
  派生壳级操作台状态,
  派生首页会话展示项,
} from "../../房间消息窗/视图";
import {
  创建已入房聊天壳,
  创建房间快照,
  假传输,
  等待组件稳定,
  输入房间短码到操作台,
  读取操作台主动作,
  读取聊天快照供测试,
} from "../common/聊天测试支架";
import { 注册聊天壳集成测试基线, 读取前端源码 } from "./测试支撑";

describe("聊天壳集成 / 界面骨架与布局", () => {
  注册聊天壳集成测试基线();

  it("聊天滚动容器会显式收口浏览器边界回弹与滚动链", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overscroll-behavior-y: contain");
  });

  it("媒体编排已经下沉到聊天内核，聊天壳不再自己持有媒体 runtime 真相", async () => {
    const source = 读取前端源码("总装/聊天壳.ts");
    const el = document.createElement("koko-chat-shell") as 聊天壳;

    expect(source).not.toContain("private readonly 媒体定位器");
    expect(source).not.toContain("private 媒体播放器");
    expect(source).not.toContain("private 媒体查看器");
    expect(source).not.toContain("private 媒体播放结果表");
    expect(source).not.toContain("private readonly 正在解析媒体播放");
    expect(source).not.toContain("private readonly 媒体发布器");
    expect(source).not.toContain("private 同步房间媒体播放结果()");
    expect("媒体定位器" in (el as object)).toBe(false);
    expect("媒体播放器" in (el as object)).toBe(false);
    expect("媒体查看器" in (el as object)).toBe(false);
    expect("媒体播放结果表" in (el as object)).toBe(false);
    expect("正在解析媒体播放" in (el as object)).toBe(false);
    expect("媒体发布器" in (el as object)).toBe(false);
  });

  it("聊天壳通过总装入口拿 kernel 和 runtime，不再自己 new 业务入口", () => {
    const source = 读取前端源码("总装/聊天壳.ts");

    expect(source).toContain('from "./应用装配.js"');
    expect(source).toContain("创建聊天壳应用装配(");
    expect(source).not.toContain("private readonly kernel = 创建聊天应用内核(");
    expect(source).not.toContain("this._应用运行时 = 创建应用运行时(");
  });

  it("浏览器烟测预算探针只读取聊天内核运行时预算，不新建壳层预算真相", async () => {
    const el = await 创建已入房聊天壳();
    await 等待组件稳定(el);

    expect(globalThis.__kokoBudgetSnapshot).toEqual(expect.any(Function));
    expect(globalThis.__kokoBudgetSnapshot?.()).toEqual(读取聊天快照供测试(el).runtimeBudget);

    el.remove();
    expect(globalThis.__kokoBudgetSnapshot).toBeUndefined();
  });

  it("操作台高度计算不在 render 热路径同步读取 DOM 宽度", async () => {
    const el = await 创建已入房聊天壳();
    await 等待组件稳定(el);
    const inputGroup = el.shadowRoot!.querySelector<HTMLElement>("#shellConsoleInputGroup");
    expect(inputGroup).not.toBeNull();
    Object.defineProperty(inputGroup!, "clientWidth", {
      configurable: true,
      get() {
        throw new Error("render 不应同步读取操作台几何宽度");
      },
    });

    el.requestUpdate();
    await expect(el.updateComplete).resolves.toBeTruthy();

    el.remove();
  });

  it("聊天滚动容器会显式关闭浏览器默认滚动锚点，避免和手动历史补偿打架", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overflow-anchor: none");
  });

  it("视频媒体卡片只在消息流里承载预览入口，真正播放交给媒体查看器", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("isolation: isolate");
    expect(styles).toContain("contain: paint");
    expect(styles).toContain(".message-surface.media-message");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("box-shadow: none");
    expect(styles).toContain(".message-video-card");
    expect(styles).toContain(".message-video-preview-trigger");
    expect(styles).toContain(".message-video-poster");
    expect(styles).toMatch(/\.message-video-preview(?:\s*,\s*\.message-video-poster|\s*\{)/);
    expect(styles).toMatch(/\.message-video-preview[\s\S]*width:\s*100%/);
    expect(styles).toMatch(/\.message-video-preview[\s\S]*max-width:\s*100%/);
    expect(styles).toMatch(/\.message-video-preview[\s\S]*object-fit:\s*cover/);
    expect(styles).toMatch(/\.message-video-preview[\s\S]*pointer-events:\s*none/);
    expect(styles).not.toContain(".message-media-preview-video");
    expect(styles).not.toContain(".message-media-preview-backdrop");
    expect(styles).toContain("z-index: 0");
  });

  it("消息窗口宿主会在壳层里接住房间 1fr 行的布局契约，保证内部滚动容器还能缩放", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("koko-room-message-pane");
    expect(styles).toContain("display: grid");
    expect(styles).toContain("min-height: 0");
    expect(styles).toContain("grid-template-rows: minmax(0, 1fr) auto");
    expect(styles).toContain(".message-scroll");
    expect(styles).toContain("height: 100%");
    expect(styles).toContain("overflow-y: auto");
  });

  it("聊天壳样式会声明黑曜石夜间底板和社论橙强调，而不是粉红或棕脏底板", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("--surface-canvas: #040506");
    expect(styles).toContain("--surface-panel: #0d0f12");
    expect(styles).toContain("--surface-elevated: #15181d");
    expect(styles).toContain("--text-primary: #f5f7fb");
    expect(styles).toContain("--accent-core: #ff6a00");
    expect(styles).toContain("--accent-hover: #ff8a1f");
    expect(styles).not.toContain("--surface-canvas: #171312");
    expect(styles).not.toContain("--surface-panel: #211b19");
    expect(styles).not.toContain("--surface-elevated: #2a2321");
    expect(styles).not.toContain("--accent-core: #ff385c");
  });

  it("操作台主输入和主动作在不同模式下共用同一套高度约束", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("#shellConsolePrimaryInput");
    expect(styles).toContain("#shellConsolePrimaryAction");
    expect(styles).toContain("min-height: 50px");
  });

  it("状态槽会保留可读换行，而不是用单行省略号吞掉房间状态真相", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("#shellConsoleStatus");
    expect(styles).toMatch(/#shellConsoleStatus[\s\S]*white-space:\s*normal/);
    expect(styles).toMatch(/#shellConsoleStatus[\s\S]*overflow-wrap:\s*anywhere/);
    expect(styles).not.toMatch(/#shellConsoleStatus[\s\S]*text-overflow:\s*ellipsis/);
  });

  it("房间头部会收成更薄的 iPhone 式导航条，把垂直空间还给消息主舞台", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".room-header");
    expect(styles).toContain("gap: 4px");
    expect(styles).toContain("min-width: 32px");
    expect(styles).toContain("padding: env(safe-area-inset-top, 0px) 0 1px");
    expect(styles).toMatch(/\.back-button[\s\S]*color:\s*var\(--accent-core\)/);
  });

  it("多附件网格会消费 presenter 提供的列数与行高变量，而不是把所有消息锁死在双列模板", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".message-attachment-grid");
    expect(styles).toContain("repeat(var(--attachment-grid-columns, 2), minmax(0, 1fr))");
    expect(styles).toContain("gap: var(--attachment-grid-gap, 8px)");
    expect(styles).toContain("grid-auto-rows: var(--attachment-grid-row-height, auto)");
    expect(styles).toContain(".message-attachment-card");
  });

  it("群友昵称会优先保证阅读性，而不是随着屏幕收缩被压成省略号", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".message-alias");
    expect(styles).toMatch(/\.message-alias\s*\{[^}]*white-space:\s*normal/);
    expect(styles).toMatch(/\.message-alias\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(styles).not.toMatch(/\.message-alias\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("房间消息布局预算会更积极利用横向空间，而不是继续保留网页式左右留白", async () => {
    const el = await 创建已入房聊天壳();
    const roomView = el.shadowRoot!.querySelector("#roomView") as HTMLElement | null;
    expect(roomView).not.toBeNull();
    Object.defineProperty(roomView!, "clientWidth", {
      configurable: true,
      value: 1024,
    });

    const env = (
      el as unknown as {
        读取消息文本布局环境(): {
          maxContentWidth: number;
          singleLineMaxContentWidth: number;
        };
      }
    ).读取消息文本布局环境();

    expect(env.maxContentWidth).toBeGreaterThanOrEqual(880);
    expect(env.singleLineMaxContentWidth).toBeGreaterThanOrEqual(env.maxContentWidth);
    el.remove();
  });

  it("房间页头返回按钮会收成单箭头，而不是继续占用文字按钮宽度", async () => {
    const el = await 创建已入房聊天壳();
    const backButton = el.shadowRoot!.querySelector("#backBtn") as HTMLButtonElement | null;

    expect(backButton).not.toBeNull();
    expect(backButton?.textContent?.trim()).toBe("‹");
    expect(backButton?.getAttribute("aria-label")).toBe("返回");
    el.remove();
  });

  it("控制器输入区域会继续压缩垂直留白，而不是让状态提示下面再空出一大片区域", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain(".shell-screen");
    expect(styles).toContain("gap: 8px");
    expect(styles).toContain(".composer-bar");
    expect(styles).toContain("padding: 4px 8px");
    expect(styles).toContain("gap: 6px");
    expect(styles).toMatch(/\.composer-bar[\s\S]*max-height:\s*min\(42vh,\s*360px\)/);
    expect(styles).toMatch(/\.composer-bar[\s\S]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.composer-drafts[\s\S]*max-height:\s*min\(28vh,\s*220px\)/);
    expect(styles).toMatch(/\.composer-drafts[\s\S]*overflow-y:\s*auto/);
    expect(styles).toMatch(/#shellConsoleStatus[\s\S]*min-height:\s*0/);
  });

  it("聊天壳会用确定高度锁住房间视图，避免禁掉整页滚动后消息区失去内部滚动", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("height: 100%");
    expect(styles).toContain("overflow: hidden");
    expect(styles).toContain(".boot-screen");
  });

  it("窗口宽度变化后会重新计算消息气泡宽度，而不是继续挂着旧的 Pretext 布局结果", async () => {
    const 原始宽度 = globalThis.innerWidth;
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });

    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "这是一条足够长的消息，用来确认聊天壳在窗口宽度变化后，会重新让 Pretext 按新的宿主宽度计算气泡尺寸，而不是继续挂着旧的布局结果。",
            event_position: 1,
          },
        ],
      }),
    ];

    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    try {
      输入房间短码到操作台(el, "ROOM01");
      读取操作台主动作(el).click();
      await 等待组件稳定(el);
      await 等待组件稳定(el);

      const 宽屏气泡 = el.shadowRoot!.querySelector(".message-bubble") as HTMLElement | null;
      expect(宽屏气泡).not.toBeNull();
      const 宽屏宽度 = Number.parseFloat(宽屏气泡!.style.width.replace("px", ""));

      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        writable: true,
        value: 320,
      });
      globalThis.dispatchEvent(new Event("resize"));
      await 等待组件稳定(el);
      await 等待组件稳定(el);

      const 窄屏气泡 = el.shadowRoot!.querySelector(".message-bubble") as HTMLElement | null;
      expect(窄屏气泡).not.toBeNull();
      const 窄屏宽度 = Number.parseFloat(窄屏气泡!.style.width.replace("px", ""));

      expect(窄屏宽度).toBeLessThan(宽屏宽度);
    } finally {
      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        writable: true,
        value: 原始宽度,
      });
      el.remove();
    }
  });

  it("无关重渲染不会重复读取房间宿主宽度，而是复用缓存的消息文本布局环境", async () => {
    const 原始宽度 = globalThis.innerWidth;
    Object.defineProperty(globalThis, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });
    const el = await 创建已入房聊天壳();
    const roomView = el.shadowRoot!.querySelector("#roomView") as HTMLElement | null;
    expect(roomView).not.toBeNull();

    try {
      let 宿主宽度读取次数 = 0;
      Object.defineProperty(roomView!, "clientWidth", {
        configurable: true,
        get() {
          宿主宽度读取次数 += 1;
          return 1024;
        },
      });

      globalThis.dispatchEvent(new Event("resize"));
      await 等待组件稳定(el);
      宿主宽度读取次数 = 0;

      el.requestUpdate();
      await 等待组件稳定(el);

      expect(宿主宽度读取次数).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "innerWidth", {
        configurable: true,
        writable: true,
        value: 原始宽度,
      });
      el.remove();
    }
  });

  it("无关重渲染不会重新生成消息展示项数组，而是复用上一次 presenter 结果", async () => {
    const el = await 创建已入房聊天壳();
    const pane = el.shadowRoot!.querySelector("koko-room-message-pane") as {
      items: unknown[];
    } | null;
    expect(pane).not.toBeNull();

    try {
      const 首次展示项 = pane!.items;

      el.requestUpdate();
      await 等待组件稳定(el);

      expect(pane!.items).toBe(首次展示项);
    } finally {
      el.remove();
    }
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
    expect((el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement).disabled).toBe(
      true
    );
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

  it("首页会话展示项会把房间标题和辅助文案收口到 presenter", () => {
    expect(
      派生首页会话展示项([{ roomId: "r-1", roomCode: "ROOM01", lastEnteredAt: 1710000000000 }])
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
