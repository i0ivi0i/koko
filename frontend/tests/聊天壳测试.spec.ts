// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import {
  createFakeStorage,
  假传输,
  创建已入房聊天壳,
  创建房间快照,
  创建传输错误,
  注入媒体草稿,
  注入媒体播放器供测试,
  注入媒体发布器供测试,
  注入媒体查看器供测试,
  注入图片草稿,
  等待组件稳定,
  读取附件入口按钮,
  读取操作台主输入,
  读取操作台主动作,
  读取操作台表单,
  读取统一媒体文件输入,
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
  type 聊天列表展示项,
} from "../视图";
import type { 房间消息窗 } from "../房间消息窗";
import type { 匿名身份引导结果 } from "../契约";
import { 聊天壳 } from "../聊天壳";

const 查询查看器关闭按钮 = (): HTMLButtonElement | null => {
  const directButton = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭视频查看器"]'
  );
  if (directButton) {
    return directButton;
  }
  const skins = document.body.querySelectorAll("koko-video-skin, video-skin");
  for (const skin of skins) {
    const button = skin.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭视频查看器"]'
    );
    if (button) {
      return button;
    }
  }
  return null;
};
import { 读取默认全局唯一播放器 } from "../媒体/全局唯一播放器";

const 当前测试文件目录 = dirname(fileURLToPath(import.meta.url));
const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(当前测试文件目录, "..", relativePath), "utf8");

const 安装聊天壳直达全屏模拟 = () => {
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "requestFullscreen"
  );
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const restore = () => {
    if (fullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (requestFullscreenDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", requestFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
  };
  return { requestFullscreen, restore };
};

const 安装聊天壳测试唯一播放器桩 = (): void => {
  const 全局唯一播放器 = 读取默认全局唯一播放器();
  全局唯一播放器.销毁();
  全局唯一播放器.配置壳工厂((initialSource, deps = {}) => {
    const video = document.createElement("video");
    const container = document.createElement("div");
    const 挂载到宿主 = (mountTarget: HTMLElement): void => {
      mountTarget.append(container);
      if (!container.contains(video)) {
        container.append(video);
      }
    };
    /**
     * 聊天壳集成只需要一颗“会真实进 DOM、会跟着宿主迁移”的测试播放器：
     * 1. 这里不复刻 Video.js，只保留 source/pointer 的最小真相；
     * 2. 这样失败时就能区分是“壳层没把 canonical owner 投影出来”，还是“测试壳太空心”；
     * 3. 同时继续避免把集成测试绑死到真实播放器内部实现。
     */
    const 同步源 = (source = initialSource): void => {
      video.src = source.src;
      if (source.posterSrc) {
        video.poster = source.posterSrc;
      } else {
        video.removeAttribute("poster");
      }
    };
    if (deps.mountTarget) {
      挂载到宿主(deps.mountTarget);
    }
    同步源(initialSource);
    return {
      destroy() {
        video.pause();
        container.remove();
      },
      同步: 同步源,
      挂载到宿主,
      进入全屏: async () => "standard",
      读取视频元素: () => video,
      读取容器元素: () => container,
    };
  });
};

describe("聊天壳集成 / 首页与控制台", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
    安装聊天壳测试唯一播放器桩();
  });

  afterEach(() => {
    读取默认全局唯一播放器().销毁();
  });

  const 创建假媒体发布器 = () => ({
    处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
    移除草稿: vi.fn(),
    继续上传草稿: vi.fn().mockResolvedValue(undefined),
    重新上传草稿: vi.fn().mockResolvedValue(undefined),
    清空: vi.fn(),
    销毁: vi.fn(),
  });

  const 创建大量消息展示项 = (count: number): 聊天列表展示项[] => {
    // 这里直接构造 Presenter 输出，避免一万条文本布局计算掩盖“DOM 是否全量渲染”的判断。
    const layout = {
      height: 20,
      lineCount: 1,
      naturalWidth: 80,
      maxLineWidth: 80,
      lines: [
        {
          index: 0,
          width: 80,
          text: "消息",
          segments: [{ kind: "text" as const, text: "消息" }],
        },
      ],
    };
    return Array.from({ length: count }, (_, index) => ({
      kind: "message" as const,
      id: `m-${index + 1}`,
      owner: index % 2 === 0 ? ("mine" as const) : ("other" as const),
      body: `消息-${index + 1}`,
      hasText: true,
      attachments: [],
      layout,
      bubbleWidth: 120,
      senderDisplayAlias: index % 2 === 0 ? "暴躁的企鹅" : "冷静的水獭",
      showAlias: index % 2 !== 0,
      eventPosition: index + 1,
    }));
  };
  it("聊天滚动容器会显式收口浏览器边界回弹与滚动链", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overscroll-behavior-y: contain");
  });

  it("媒体编排已经下沉到聊天内核，聊天壳不再自己持有媒体 runtime 真相", async () => {
    const source = 读取前端源码("聊天壳.ts");
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
    expect(styles).toMatch(
      /\.message-video-preview(?:\s*,\s*\.message-video-poster|\s*\{)/
    );
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
    expect(styles).toMatch(/#shellConsoleStatus[\s\S]*min-height:\s*0/);
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
            text: "消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "消息-2",
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
    expect(el.shadowRoot!.querySelector(".message-body [data-line-index='0']")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".message-bubble")?.getAttribute("style")).toContain("width:");
    el.remove();
  });

  it("万人消息窗口只渲染当前虚拟窗口内的消息 DOM，但仍保留 event_position 定位入口", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    pane.items = 创建大量消息展示项(10_000);
    document.body.appendChild(pane);
    await pane.updateComplete;

    const renderedRows = pane.querySelectorAll("#messageList [data-event-position]");

    expect(renderedRows.length).toBeLessThanOrEqual(120);
    expect(renderedRows[0]?.getAttribute("data-event-position")).toBe("1");
    pane.remove();
  });

  it("万人消息恢复到靠后的未读位置时，虚拟窗口仍保留未读定位节点", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    const items = 创建大量消息展示项(10_000);
    items.splice(8_999, 0, {
      kind: "unread-divider",
      id: "unread-divider",
      label: "未读消息",
    });
    pane.items = items;
    document.body.appendChild(pane);
    await pane.updateComplete;

    const renderedRows = pane.querySelectorAll("#messageList [data-event-position]");

    expect(renderedRows.length).toBeLessThanOrEqual(122);
    expect(pane.querySelector("#unreadDivider")).not.toBeNull();
    expect(pane.querySelector('[data-event-position="9000"]')).not.toBeNull();
    pane.remove();
  });

  it("纯图片权威消息会像 IM 一样直接展示原图媒体，不再套气泡底板", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-img-1",
            client_message_id: "c-img-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const image = el.shadowRoot!.querySelector(
      'img[data-attachment-id="att-1"]'
    ) as HTMLImageElement | null;
    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-image-preview-trigger[data-attachment-id="att-1"]'
    ) as HTMLButtonElement | null;
    const mediaSurface = el.shadowRoot!.querySelector(".message-surface.media-message") as HTMLElement | null;
    expect(image).not.toBeNull();
    expect(image?.src).toContain(
      "/api/attachments/att-1/content?session_id=s-test&variant=original"
    );
    expect(el.shadowRoot!.querySelector(".message-body")).toBeNull();
    expect(mediaSurface).not.toBeNull();
    expect(mediaSurface?.classList.contains("message-bubble")).toBe(false);
    expect(mediaSurface?.getAttribute("style")).toContain("width: 320px");
    expect(el.shadowRoot!.querySelector(".message-image-link")).toBeNull();
    expect(previewTrigger).not.toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-1",
            kind: "image",
            src: expect.stringContaining(
              "/api/attachments/att-1/content?session_id=s-test&variant=original"
            ),
          }),
        ],
      })
    );

    expect(el.shadowRoot!.querySelector('[data-image-preview="att-1"]')).toBeNull();
    el.remove();
  });

  it("带文字的媒体消息也使用媒体容器，不能因为有 caption 就退回气泡底板", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-img-caption-1",
            client_message_id: "c-img-caption-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "这是一张图片说明",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-caption-image-1",
                width: 1200,
                height: 800,
              },
            ],
            event_position: 1,
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

    const mediaSurface = el.shadowRoot!.querySelector(".message-surface.media-message") as HTMLElement | null;
    expect(mediaSurface).not.toBeNull();
    expect(mediaSurface?.classList.contains("message-bubble")).toBe(false);
    expect(mediaSurface?.querySelector(".message-body")?.textContent).toContain("这是一张图片说明");
    expect(el.shadowRoot!.querySelector(".message-bubble .message-image-card")).toBeNull();
    el.remove();
  });

  it("带视频附件的权威消息会在消息流里只渲染预览入口，点开后才播放", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-1",
            client_message_id: "c-video-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看视频",
             attachments: [
               {
                 kind: "video",
                 attachment_id: "att-video-1",
                 width: 1280,
                 height: 720,
                 preview_asset: {
                   still_url:
                     "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail",
                 },
               },
             ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-video-1",
        thumbnailUrl:
          "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail",
        hint: "正在协作分发",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
    ) as HTMLButtonElement | null;
    const previewPoster = el.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    ) as HTMLImageElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail"
    );
    expect(
      el.shadowRoot!.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      )
    ).toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);
    await vi.waitFor(() => {
      expect(viewer.打开).toHaveBeenCalled();
    });

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-1",
            kind: "video",
            src: "blob:http://media.local/webtorrent-video-1",
          }),
        ],
      })
    );

    expect(el.shadowRoot!.querySelector('[data-video-preview="att-video-1"]')).toBeNull();
    el.remove();
  });

  it("带视频附件的权威消息会显示协作分发提示，而不是只把裸 originalSrc 塞给 video", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-swarm-1",
            client_message_id: "c-video-swarm-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看协作分发视频",
             attachments: [
               {
                 kind: "video",
                 attachment_id: "att-video-swarm-1",
                 width: 1280,
                 height: 720,
                 preview_asset: {
                   still_url:
                     "/api/attachments/att-video-swarm-1/content?session_id=s-test&variant=thumbnail",
                 },
               },
             ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-swarm-1",
        kind: "video",
        src: "blob:http://localhost/swarm-video-1",
        thumbnailUrl: null,
        hint: "正在协作分发",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-swarm-1"]'
    ) as HTMLButtonElement | null;
    const previewPoster = el.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-swarm-1"]'
    ) as HTMLImageElement | null;
    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-swarm-1"]'
    ) as HTMLElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-swarm-1/content?session_id=s-test&variant=thumbnail"
    );
    expect(
      el.shadowRoot!.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-swarm-1"]'
      )
    ).toBeNull();
    expect(hint).toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-swarm-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-swarm-1",
            kind: "video",
            src: "blob:http://localhost/swarm-video-1",
          }),
        ],
      })
    );
    el.remove();
  });

  it("点击视频附件时会把 WebTorrent 播放源交给页面级媒体查看器", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-viewer-1",
            client_message_id: "c-video-viewer-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看协作分发视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-viewer-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
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
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-viewer-1",
        kind: "video",
        src: "blob:http://localhost/webtorrent-viewer-video-1",
        thumbnailUrl: null,
        hint: null,
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-viewer-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-viewer-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-viewer-1",
            kind: "video",
            src: "blob:http://localhost/webtorrent-viewer-video-1",
          }),
        ],
      })
    );
    el.remove();
  });

  it("点击当前自动播 owner 视频时，也走统一查看器入口，不再让时间线原生 video 直达全屏", async () => {
    const { requestFullscreen, restore } = 安装聊天壳直达全屏模拟();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-direct-fullscreen",
            client_message_id: "c-video-inline-direct-fullscreen",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-direct-fullscreen",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
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
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-inline-direct-fullscreen",
        kind: "video",
        src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
        thumbnailUrl: null,
        hint: null,
      }),
    });
    try {
      document.body.appendChild(el);
      await 等待组件稳定(el);

      输入房间短码到操作台(el, "ROOM01");
      读取操作台主动作(el).click();
      await 等待组件稳定(el);
      await 等待组件稳定(el);

      const pane = el.shadowRoot!.querySelector("koko-room-message-pane") as 房间消息窗 | null;
      expect(pane).not.toBeNull();
      pane!.mediaPlaybackByAttachmentId = {
        "att-video-inline-direct-fullscreen": {
          mode: "swarm",
          attachmentId: "att-video-inline-direct-fullscreen",
          kind: "video",
          src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          thumbnailUrl: null,
          hint: null,
        },
      };
      pane!.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-inline-direct-fullscreen": {
          mode: "swarm",
          attachmentId: "att-video-inline-direct-fullscreen",
          kind: "video",
          src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          thumbnailUrl: null,
          hint: null,
        },
      };
      (
        pane as unknown as {
          mediaVideoBudgetByAttachmentId: Record<
            string,
            {
              attachmentId: string;
              tier: string;
              reason: string;
              canonicalVideoSrc: string | null;
              previewVideoSrc: string | null;
              allowInlineCanonical: boolean;
              allowPreviewVideo: boolean;
            }
          >;
        }
      ).mediaVideoBudgetByAttachmentId = {
        "att-video-inline-direct-fullscreen": {
          attachmentId: "att-video-inline-direct-fullscreen",
          tier: "heavy_playback",
          reason: "inline_autoplay_owner",
          canonicalVideoSrc: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          previewVideoSrc: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          allowInlineCanonical: true,
          allowPreviewVideo: true,
        },
      };
      pane!.inlineAutoplayOwnerAttachmentId = "att-video-inline-direct-fullscreen";
      await pane!.updateComplete;

      const preview = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-direct-fullscreen"]'
      );
      const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-inline-direct-fullscreen"]'
      );
      expect(preview).not.toBeNull();
      expect(trigger).not.toBeNull();

      trigger?.click();
      await pane!.updateComplete;

      /**
       * 壳层现在必须把“当前 owner 点击”也交回统一查看器入口：
       * 1. 消息窗不再直接请求原生全屏；
       * 2. 查看器会基于同一颗 canonical Video.js player 决定接管/迁移；
       * 3. 这里只验证入口统一，不在聊天壳测试里重复断言底层迁移实现。
       */
      expect(requestFullscreen).toHaveBeenCalledTimes(0);
      expect(viewer.打开).toHaveBeenCalledWith(
        expect.objectContaining({
          startAttachmentId: "att-video-inline-direct-fullscreen",
          items: [
            expect.objectContaining({
              attachmentId: "att-video-inline-direct-fullscreen",
              kind: "video",
              src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
            }),
          ],
        })
      );
      expect(document.body.querySelector("video-player[data-player-shell='videojs']")).toBeNull();
      expect(pane!.inlineAutoplayOwnerAttachmentId).toBe("att-video-inline-direct-fullscreen");
    } finally {
      el.remove();
      restore();
    }
  });

  it("真实查看器打开后切到另一条视频时，会继续复用同一颗 Video.js 壳", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-1",
            client_message_id: "c-video-switch-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-switch-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-2",
            client_message_id: "c-video-switch-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-switch-2",
                width: 720,
                height: 1280,
              },
            ],
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn(async ({ attachmentId, kind }) => ({
        mode: "anchor",
        attachmentId,
        kind,
        src: `http://media.local/original-${attachmentId}`,
        thumbnailUrl: `http://media.local/poster-${attachmentId}`,
        hint: null,
      }) satisfies import("../媒体/媒体播放").媒体播放结果),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-switch-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 等待查看器壳出现 = async (): Promise<Element | null> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const shell = document.body.querySelector("video-player[data-player-shell='videojs']");
        if (shell) {
          return shell;
        }
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return document.body.querySelector("video-player[data-player-shell='videojs']");
    };

    const 初始壳 = await 等待查看器壳出现();
    const 初始视频 = document.body.querySelector("video");
    expect(初始壳).not.toBeNull();
    expect(初始视频).not.toBeNull();

    const kernel = (el as unknown as {
      kernel: {
        dispatch(command: {
          type: "MEDIA_OPEN_REQUESTED";
          request: {
            startAttachmentId: string;
            items: Array<{
              attachmentId: string;
              kind: "video";
              src: string;
              posterSrc: string;
              width: number;
              height: number;
            }>;
          };
        }): Promise<void>;
      };
    }).kernel;

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-switch-2",
        items: [
          {
            attachmentId: "att-video-switch-1",
            kind: "video",
            src: "http://media.local/original-att-video-switch-1",
            posterSrc: "http://media.local/poster-att-video-switch-1",
            width: 1280,
            height: 720,
          },
          {
            attachmentId: "att-video-switch-2",
            kind: "video",
            src: "http://media.local/original-att-video-switch-2",
            posterSrc: "http://media.local/poster-att-video-switch-2",
            width: 720,
            height: 1280,
          },
        ],
      },
    });
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 当前壳 = await 等待查看器壳出现();
    const 当前视频 = document.body.querySelector("video");
    expect(当前壳).toBe(初始壳);
    expect(当前视频).toBe(初始视频);
    expect((当前视频 as HTMLVideoElement | null)?.poster).toBe(
      "http://media.local/poster-att-video-switch-2"
    );

    el.remove();
  });

  it("关闭真实视频查看器后，再点另一条视频仍会重新打开正式查看器", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-reopen-1",
            client_message_id: "c-video-reopen-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-reopen-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-reopen-2",
            client_message_id: "c-video-reopen-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-reopen-2",
                width: 720,
                height: 1280,
              },
            ],
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn(async ({ attachmentId, kind }) => ({
        mode: "anchor",
        attachmentId,
        kind,
        src: `http://media.local/original-${attachmentId}`,
        thumbnailUrl: `http://media.local/poster-${attachmentId}`,
        hint: null,
      }) satisfies import("../媒体/媒体播放").媒体播放结果),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 等待查看器壳出现 = async (): Promise<Element | null> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const shell = document.body.querySelector("video-player[data-player-shell='videojs']");
        if (shell) {
          return shell;
        }
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return document.body.querySelector("video-player[data-player-shell='videojs']");
    };
    const 等待查看器壳消失 = async (): Promise<void> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (!document.body.querySelector("video-player[data-player-shell='videojs']")) {
          return;
        }
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-reopen-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(await 等待查看器壳出现()).not.toBeNull();

    查询查看器关闭按钮()?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待查看器壳消失();

    expect(document.body.querySelector("video-player[data-player-shell='videojs']")).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-reopen-2"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const reopenedShell = await 等待查看器壳出现();
    const reopenedVideo = document.body.querySelector<HTMLVideoElement>("video");
    expect(reopenedShell).not.toBeNull();
    expect(reopenedVideo).not.toBeNull();
    expect(reopenedVideo?.poster).toBe("http://media.local/poster-att-video-reopen-2");
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );

    el.remove();
  });

  it("媒体播放结果是 expired 时，时间线会统一显示内容已过期", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-expired-1",
            client_message_id: "c-video-expired-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "过期视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-expired-1",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "expired",
        attachmentId: "att-video-expired-1",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        hint: "内容已过期",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-expired-1"]'
    ) as HTMLButtonElement | null;
    expect(previewTrigger).not.toBeNull();

    previewTrigger?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-expired-1"]'
    ) as HTMLElement | null;
    expect(hint?.textContent).toContain("内容已过期");
    el.remove();
  });

  it("可见自动播候选在真正成为 owner 前仍保持 poster，owner 成立后才切进正式 video 节点", async () => {
    const transport = new 假传输();
    const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "IntersectionObserver"
    );
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-shell",
            client_message_id: "c-video-inline-shell",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-shell",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    /**
     * 这条集成要验证的是“消息窗几何 -> 候选 -> owner -> canonical 节点”整条业务链，
     * 不是 happy-dom 自带 IntersectionObserver 的空壳实现。
     * 因此这里显式切回同步量测 fallback，让测试几何真相来自我们手动 mock 的矩形。
     */
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-inline-shell",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-inline-shell",
        thumbnailUrl: null,
        hint: null,
      }),
      释放附件播放资源: vi.fn(),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    try {
      const pane = el.shadowRoot!.querySelector(
        "koko-room-message-pane"
      ) as HTMLElement & { updateComplete?: Promise<unknown> };
      const scrollContainer = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement | null;
      const previewButton = el.shadowRoot!.querySelector(
        'button.message-video-preview-trigger[data-attachment-id="att-video-inline-shell"]'
      ) as HTMLButtonElement | null;
      expect(scrollContainer).not.toBeNull();
      expect(previewButton).not.toBeNull();
      /**
       * 这条集成用例必须走“消息窗自己量测可见候选 -> 壳层回抛 -> 内核裁决 owner”真实入口，
       * 不能再直接手塞 `MEDIA_INLINE_AUTOPLAY_OBSERVED`：
       * 1. 否则后续消息窗按默认 0 尺寸重新量测时，会立刻把候选清空，测出来的只是 happy-dom 几何缺省值；
       * 2. 这里显式模拟可见视口与按钮矩形，让候选事实继续来自 RoomPane，而不是测试越级改内核；
       * 3. 这样才能真正覆盖“未观看仅可见只做预热，正式自动播 owner 仍由可见候选稳定裁决”。
       */
      vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 320, 300)
      );
      vi.spyOn(previewButton!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 320, 180)
      );
      scrollContainer!.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await el.updateComplete;
      await pane.updateComplete;

      const beforeOwnerVideo = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-shell"]'
      );
      expect(beforeOwnerVideo).toBeNull();
      expect(
        el.shadowRoot!.querySelector(
          'img.message-video-poster[data-attachment-id="att-video-inline-shell"]'
        )
      ).not.toBeNull();

      /**
       * 壳层先建好再切 fake timer 时，自动播协作已经持有真实定时链；
       * 这里直接按真实时间等待一轮稳定窗，更符合“投影是否会自己发生”的集成语义。
       */
      await new Promise((resolve) => setTimeout(resolve, 121));
      await Promise.resolve();
      await Promise.resolve();
      await el.updateComplete;
      await pane.updateComplete;

      const ownerVideo = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-shell"]'
      );
      expect(ownerVideo).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector(
          'img.message-video-poster[data-attachment-id="att-video-inline-shell"]'
        )
      ).toBeNull();
    } finally {
      if (intersectionObserverDescriptor) {
        Object.defineProperty(globalThis, "IntersectionObserver", intersectionObserverDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "IntersectionObserver");
      }
      el.remove();
    }
  });

  it("进入房间后发送区会显示统一附件入口和统一媒体文件输入", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(读取附件入口按钮(el)).not.toBeNull();
    expect(读取统一媒体文件输入(el)).not.toBeNull();

    el.remove();
  });

  it("附件入口是小号加号按钮，而不是大号文案按钮", async () => {
    const el = await 创建已入房聊天壳();

    const button = 读取附件入口按钮(el);
    expect(button?.textContent?.trim()).toBe("+");
    expect(button?.getAttribute("aria-label")).toBe("选择图片或视频");

    el.remove();
  });

  it("点击加号会直接触发原生文件输入，而不是打开 Dashboard", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);

    const input = 读取统一媒体文件输入(el);
    const clickSpy = vi.spyOn(input, "click");

    读取附件入口按钮(el).click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("发送区图片草稿会渲染在本地预览带里，而不是伪造成时间线消息", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-1",
      kind: "image",
      attachmentId: "att-1",
      previewUrl: "https://example.com/thumb.png",
      width: 120,
      height: 90,
      status: "ready",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    const draftImage = el.shadowRoot!.querySelector(
      'img[data-draft-id="draft-1"]'
    ) as HTMLImageElement | null;
    expect(draftImage).not.toBeNull();
    expect(draftImage?.src).toBe("https://example.com/thumb.png");
    expect(el.shadowRoot!.querySelectorAll('[data-event-position]').length).toBe(0);
    el.remove();
  });

  it("图片草稿预览优先使用本地 previewUrl，而不是远端缩略图地址", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-local-preview",
      kind: "image",
      attachmentId: "att-1",
      previewUrl: "blob:http://test.local/draft-local-preview",
      width: 120,
      height: 90,
      status: "ready",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    const draftImage = el.shadowRoot!.querySelector(
      'img[data-draft-id="draft-local-preview"]'
    ) as HTMLImageElement | null;
    expect(draftImage).not.toBeNull();
    expect(draftImage?.src).toBe("blob:http://test.local/draft-local-preview");

    el.remove();
  });

  it("transporting 草稿存在时发送按钮会被禁用并显示正在上传", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-transporting",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-transporting",
      width: 120,
      height: 90,
      status: "transporting",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");

    el.remove();
  });

  it("processing 草稿存在时发送按钮会被禁用并显示正在处理", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-processing",
      kind: "image",
      attachmentId: "att-processing",
      previewUrl: "blob:http://test.local/draft-processing",
      width: 120,
      height: 90,
      status: "processing",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在处理");

    el.remove();
  });

  it("存在失败图片草稿时发送按钮会禁用并提示重试或删除", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-failed",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-failed",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "broken.png",
      errorCode: "attachment_upload_failed",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain(
      "上传失败"
    );

    el.remove();
  });

  it("删除图片草稿会立刻把它从草稿带移除", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-remove",
      kind: "image",
      attachmentId: "att-remove",
      previewUrl: "blob:http://test.local/draft-remove",
      width: 120,
      height: 90,
      status: "ready",
      fileName: "remove.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    (
      el.shadowRoot!.querySelector(
        '[data-draft-remove-id="draft-remove"]'
      ) as HTMLButtonElement
    ).click();
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector('img[data-draft-id="draft-remove"]')).toBeNull();
    el.remove();
  });

  it("统一媒体文件输入会同时放行图片和视频，并在桌面环境保留多选", async () => {
    const el = await 创建已入房聊天壳();

    const input = 读取统一媒体文件输入(el);
    expect(input.accept).toContain("image/*");
    expect(input.accept).toContain("video/*");
    expect(input.multiple).toBe(true);

    el.remove();
  });

  it("失败图片点击继续上传时会把 localId 转交给媒体发布器", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    注入图片草稿(el, {
      localId: "draft-retry",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-retry",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "retry.png",
      errorCode: "attachment_upload_failed",
    });
    await 等待组件稳定(el);

    (
      el.shadowRoot!.querySelector(
        '[data-draft-resume-id="draft-retry"]'
      ) as HTMLButtonElement
    ).click();
    await 等待组件稳定(el);

    expect(fake媒体发布器.继续上传草稿).toHaveBeenCalledWith("draft-retry");
    el.remove();
  });

  it("失败图片会同时渲染继续上传和重新上传动作", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-retry-split",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-retry-split",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "retry-split.png",
      errorCode: "attachment_upload_failed",
    });
    await 等待组件稳定(el);

    expect(
      el.shadowRoot!.querySelector('[data-draft-resume-id="draft-retry-split"]')
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      el.shadowRoot!.querySelector('[data-draft-restart-id="draft-retry-split"]')
    ).toBeInstanceOf(HTMLButtonElement);
    el.remove();
  });

  it("失败图片点击继续上传和重新上传时会转交不同的媒体发布器方法", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    注入图片草稿(el, {
      localId: "draft-retry-actions",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-retry-actions",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "retry-actions.png",
      errorCode: "attachment_upload_failed",
    });
    await 等待组件稳定(el);

    (
      el.shadowRoot!.querySelector(
        '[data-draft-resume-id="draft-retry-actions"]'
      ) as HTMLButtonElement
    ).click();
    (
      el.shadowRoot!.querySelector(
        '[data-draft-restart-id="draft-retry-actions"]'
      ) as HTMLButtonElement
    ).click();
    await 等待组件稳定(el);

    expect(fake媒体发布器.继续上传草稿).toHaveBeenCalledWith("draft-retry-actions");
    expect(fake媒体发布器.重新上传草稿).toHaveBeenCalledWith("draft-retry-actions");
    el.remove();
  });

  it("统一媒体文件输入 change 时会把选中的文件转交给媒体发布器并清空 input 值", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    const imageFile = new File([new Uint8Array([1, 2, 3])], "selected.jpg", {
      type: "image/jpeg",
    });
    const videoFile = new File([new Uint8Array([4, 5, 6])], "selected.mp4", {
      type: "video/mp4",
    });
    const input = 读取统一媒体文件输入(el);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [imageFile, videoFile],
    });
    Object.defineProperty(input, "value", {
      configurable: true,
      writable: true,
      value: "selected",
    });

    input.dispatchEvent(new Event("change"));
    await 等待组件稳定(el);

    expect(fake媒体发布器.处理选择媒体文件).toHaveBeenCalledWith([imageFile, videoFile]);
    expect(input.value).toBe("");
    el.remove();
  });

  it("组件销毁时会销毁媒体发布器，避免旧上传器泄漏到下一次挂载", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);

    el.remove();

    expect(fake媒体发布器.销毁).toHaveBeenCalledTimes(1);
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
      const 宽屏宽度 = Number.parseFloat(
        宽屏气泡!.style.width.replace("px", "")
      );

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
      const 窄屏宽度 = Number.parseFloat(
        窄屏气泡!.style.width.replace("px", "")
      );

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
    const pane = el.shadowRoot!.querySelector("koko-room-message-pane") as 房间消息窗 | null;
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

  it("浏览器存储会按 roomCode 去重、按 lastEnteredAt 倒序读取首页房间历史", () => {
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
      roomId: "r-old",
      roomCode: "ROOM01",
      lastEnteredAt: 100,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-2",
      roomCode: "ROOM02",
      lastEnteredAt: 200,
    });
    browserStorage.写入或更新首页房间历史条目({
      roomId: "r-new",
      roomCode: "ROOM01",
      lastEnteredAt: 300,
    });

    expect(browserStorage.读取首页房间历史()).toEqual([
      { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
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

  it("浏览器存储读取旧脏首页历史时，会把同 roomCode 的重复项自动合并并回写", () => {
    const rawStorage = createFakeStorage();
    rawStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-old", roomCode: "ROOM01", lastEnteredAt: 100 },
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      ])
    );

    const browserStorage = 创建浏览器存储(rawStorage) as unknown as {
      读取首页房间历史(): Array<{
        roomId: string;
        roomCode: string;
        lastEnteredAt: number;
      }>;
    };

    const normalized = [
      { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
      { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
    ];

    expect(browserStorage.读取首页房间历史()).toEqual(normalized);
    expect(JSON.parse(rawStorage.getItem("koko_home_sessions") ?? "null")).toEqual(normalized);
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

  it("启动时若本地历史里有重复 roomCode，也只会渲染最新那一条首页会话", async () => {
    window.localStorage.setItem(
      "koko_home_sessions",
      JSON.stringify([
        { roomId: "r-old", roomCode: "ROOM01", lastEnteredAt: 100 },
        { roomId: "r-2", roomCode: "ROOM02", lastEnteredAt: 200 },
        { roomId: "r-new", roomCode: "ROOM01", lastEnteredAt: 300 },
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
    expect(list?.querySelectorAll("[data-room-id]").length).toBe(2);
    expect(list?.querySelector('[data-room-id="r-new"]')?.textContent).toContain("ROOM01");
    expect(list?.querySelector('[data-room-id="r-old"]')).toBeNull();
    expect(
      Array.from(list?.querySelectorAll("[data-room-id]") ?? []).filter((item) =>
        item.textContent?.includes("ROOM01")
      )
    ).toHaveLength(1);
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

  it("存在阻塞图片草稿时，主 form submit 不会再偷偷进入发送主链", async () => {
    const transport = new 假传输();
    const el = await 创建已入房聊天壳(transport);
    输入消息到操作台(el, "hello");
    注入图片草稿(el, {
      localId: "draft-uploading-submit",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-uploading-submit",
      width: 120,
      height: 90,
      status: "transporting",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    读取操作台表单(el).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(transport.socket.sentEvents.some(({ event }) => event === "create_message")).toBe(false);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");
    el.remove();
  });

  it("存在 transporting 视频草稿时主发送按钮仍会被禁用", async () => {
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "video pending");
    注入媒体草稿(el, {
      localId: "draft-video-transporting",
      kind: "video",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-video-transporting",
      width: 1280,
      height: 720,
      status: "transporting",
      fileName: "demo.mp4",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("媒体附件");
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).not.toContain("图片");
    el.remove();
  });

  it("发送区视频草稿会渲染静态缩略图，但不会直接挂本地 video 元素再次触发媒体读取", async () => {
    const el = await 创建已入房聊天壳();
    注入媒体草稿(el, {
      localId: "draft-video-lightweight",
      kind: "video",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-video-lightweight-poster",
      width: 1280,
      height: 720,
      status: "transporting",
      fileName: "demo.mp4",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(
      el.shadowRoot!.querySelector(
        '[data-draft-card-id="draft-video-lightweight"] video.composer-draft-thumb'
      )
    ).toBeNull();
    const draftImage = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-video-lightweight"] img.composer-draft-thumb[data-draft-id="draft-video-lightweight"]'
    ) as HTMLImageElement | null;
    expect(draftImage).not.toBeNull();
    expect(draftImage?.getAttribute("src")).toBe("blob:http://test.local/draft-video-lightweight-poster");
    expect(
      el.shadowRoot!.querySelector(
        '[data-draft-card-id="draft-video-lightweight"] [data-video-draft-placeholder="true"]'
      )
    ).toBeNull();

    el.remove();
  });

  it("当前会话发送带视频附件后，首条 realtime 权威消息会回填当前会话缩略图，而不是退回默认占位图", async () => {
    const el = await 创建已入房聊天壳();
    注入媒体草稿(el, {
      localId: "draft-video-send-1",
      kind: "video",
      attachmentId: "att-video-send-1",
      previewUrl: "blob:http://test.local/draft-video-send-1-poster",
      width: 1280,
      height: 720,
      status: "ready",
      fileName: "send.mp4",
      errorCode: "",
    });
    await 等待组件稳定(el);

    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewPoster = el.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-send-1"]'
    ) as HTMLImageElement | null;
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-send-1/content?session_id=s-test&variant=thumbnail"
    );
    expect(previewPoster?.getAttribute("src")).not.toContain("data:image/svg+xml");
    expect(
      el.shadowRoot!.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-send-1"]'
      )
    ).toBeNull();

    el.remove();
  });

  it("视频草稿失败后不会伪造成时间线消息", async () => {
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "失败视频不要伪装成已发送");
    注入媒体草稿(el, {
      localId: "draft-video-failed",
      kind: "video",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-video-failed",
      width: 1280,
      height: 720,
      status: "failed",
      fileName: "failed.mp4",
      errorCode: "attachment_upload_failed",
    });
    await 等待组件稳定(el);

    读取操作台表单(el).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector('[data-draft-card-id="draft-video-failed"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#messageList")?.textContent ?? "").not.toContain(
      "失败视频不要伪装成已发送"
    );
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("媒体附件");
    el.remove();
  });

  it("存在阻塞图片草稿时，按 Enter 不会再绕过禁用态偷偷触发发送", async () => {
    const transport = new 假传输();
    const el = await 创建已入房聊天壳(transport);
    输入消息到操作台(el, "hello");
    注入图片草稿(el, {
      localId: "draft-uploading-enter",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-uploading-enter",
      width: 120,
      height: 90,
      status: "transporting",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    读取操作台主输入(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await 等待组件稳定(el);

    expect(transport.socket.sentEvents.some(({ event }) => event === "create_message")).toBe(false);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");
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
