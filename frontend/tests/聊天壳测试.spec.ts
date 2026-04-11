// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import {
  createFakeStorage,
  假传输,
  创建已入房聊天壳,
  创建房间快照,
  创建传输错误,
  注入媒体草稿,
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

  const 创建假媒体发布器 = () => ({
    处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
    移除草稿: vi.fn(),
    重试草稿: vi.fn().mockResolvedValue(undefined),
    清空: vi.fn(),
    销毁: vi.fn(),
  });
  it("聊天滚动容器会显式收口浏览器边界回弹与滚动链", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overscroll-behavior-y: contain");
  });

  it("聊天滚动容器会显式关闭浏览器默认滚动锚点，避免和手动历史补偿打架", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("overflow-anchor: none");
  });

  it("视频媒体卡片只在消息流里承载预览入口，真正播放交给媒体查看器", () => {
    const styles = (聊天壳 as unknown as { styles: { cssText: string } }).styles.cssText;

    expect(styles).toContain("isolation: isolate");
    expect(styles).toContain("contain: paint");
    expect(styles).toContain(".message-bubble.media-only");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("box-shadow: none");
    expect(styles).toContain(".message-video-card");
    expect(styles).toContain(".message-video-preview-trigger");
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
    expect(el.shadowRoot!.querySelector(".message-body [data-line-index='0']")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".message-bubble")?.getAttribute("style")).toContain("width:");
    el.remove();
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
            body: "",
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
    (el as unknown as { setMediaViewerForTest(nextViewer: typeof viewer): void }).setMediaViewerForTest(viewer);
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
    const bubble = el.shadowRoot!.querySelector(".message-bubble.media-only") as HTMLElement | null;
    expect(image).not.toBeNull();
    expect(image?.src).toContain(
      "/api/attachments/att-1/content?session_id=s-test&variant=original"
    );
    expect(el.shadowRoot!.querySelector(".message-body")).toBeNull();
    expect(bubble).not.toBeNull();
    expect(bubble?.getAttribute("style")).toContain("width: 320px");
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
            body: "看视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-1",
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
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    (el as unknown as { setMediaViewerForTest(nextViewer: typeof viewer): void }).setMediaViewerForTest(viewer);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
    ) as HTMLButtonElement | null;
    const previewVideo = el.shadowRoot!.querySelector(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    ) as HTMLVideoElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toContain(
      "/api/attachments/att-video-1/content?session_id=s-test&variant=original#t=0.1"
    );
    expect(previewVideo?.hasAttribute("controls")).toBe(false);
    expect(previewVideo?.hasAttribute("poster")).toBe(false);

    previewTrigger!.click();
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-1",
            kind: "video",
            src: expect.stringContaining(
              "/api/attachments/att-video-1/content?session_id=s-test&variant=original"
            ),
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
            body: "看协作分发视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-swarm-1",
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
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    (el as unknown as { setMediaViewerForTest(nextViewer: typeof viewer): void }).setMediaViewerForTest(viewer);
    el.setMediaPlayerForTest({
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
    const previewVideo = el.shadowRoot!.querySelector(
      'video.message-video-preview[data-attachment-id="att-video-swarm-1"]'
    ) as HTMLVideoElement | null;
    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-swarm-1"]'
    ) as HTMLElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe("blob:http://localhost/swarm-video-1#t=0.1");
    expect(previewVideo?.hasAttribute("controls")).toBe(false);
    expect(hint?.textContent).toContain("正在协作分发");

    previewTrigger!.click();
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
            body: "看协作分发视频",
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
    (el as unknown as { setMediaViewerForTest(nextViewer: typeof viewer): void }).setMediaViewerForTest(viewer);
    el.setMediaPlayerForTest({
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
            body: "过期视频",
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
    el.setMediaPlayerForTest({
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

    const video = el.shadowRoot!.querySelector(
      'video[data-attachment-id="att-video-expired-1"]'
    ) as HTMLVideoElement | null;
    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-expired-1"]'
    ) as HTMLElement | null;
    expect(video).toBeNull();
    expect(hint?.textContent).toContain("内容已过期");
    el.remove();
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
    (
      el as unknown as {
        媒体发布器: typeof fake媒体发布器;
      }
    ).媒体发布器 = fake媒体发布器;

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

  it("上传中时发送按钮会被禁用并显示明确原因", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-uploading",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-uploading",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");

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

  it("失败图片点击重试时会把 localId 转交给媒体发布器", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    (
      el as unknown as {
        媒体发布器: typeof fake媒体发布器;
      }
    ).媒体发布器 = fake媒体发布器;
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
        '[data-draft-retry-id="draft-retry"]'
      ) as HTMLButtonElement
    ).click();
    await 等待组件稳定(el);

    expect(fake媒体发布器.重试草稿).toHaveBeenCalledWith("draft-retry");
    el.remove();
  });

  it("统一媒体文件输入 change 时会把选中的文件转交给媒体发布器并清空 input 值", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    (
      el as unknown as {
        媒体发布器: typeof fake媒体发布器;
      }
    ).媒体发布器 = fake媒体发布器;
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
    (
      el as unknown as {
        媒体发布器: typeof fake媒体发布器;
      }
    ).媒体发布器 = fake媒体发布器;

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
            body: "这是一条足够长的消息，用来确认聊天壳在窗口宽度变化后，会重新让 Pretext 按新的宿主宽度计算气泡尺寸，而不是继续挂着旧的布局结果。",
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

  it("存在阻塞图片草稿时，主 form submit 不会再偷偷进入发送主链", async () => {
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "hello");
    注入图片草稿(el, {
      localId: "draft-uploading-submit",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-uploading-submit",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    const sendSpy = vi.spyOn(el as unknown as { sendCurrentMessage(): Promise<void> }, "sendCurrentMessage");
    读取操作台表单(el).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");
    el.remove();
  });

  it("存在 uploading 视频草稿时主发送按钮仍会被禁用", async () => {
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "video pending");
    注入媒体草稿(el, {
      localId: "draft-video-uploading",
      kind: "video",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-video-uploading",
      width: 1280,
      height: 720,
      status: "uploading",
      fileName: "demo.mp4",
      errorCode: "",
    });
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("媒体附件");
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).not.toContain("图片");
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
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "hello");
    注入图片草稿(el, {
      localId: "draft-uploading-enter",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-uploading-enter",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "demo.png",
      errorCode: "",
    });
    await 等待组件稳定(el);

    const sendSpy = vi.spyOn(el as unknown as { sendCurrentMessage(): Promise<void> }, "sendCurrentMessage");
    读取操作台主输入(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await 等待组件稳定(el);

    expect(sendSpy).not.toHaveBeenCalled();
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

