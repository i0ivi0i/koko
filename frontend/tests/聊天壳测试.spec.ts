// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建浏览器存储 } from "../存储";
import {
  createFakeStorage,
  假传输,
  创建已入房聊天壳,
  创建房间快照,
  创建传输错误,
  注入图片草稿,
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

  it("带图片附件的权威消息会在消息窗口里渲染缩略图", async () => {
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
            text: "看图",
            body: "看图",
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
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const image = el.shadowRoot!.querySelector(
      'img[data-attachment-id="att-1"]'
    ) as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.src).toContain(
      "/api/attachments/att-1/content?session_id=s-test&variant=thumbnail"
    );
    el.remove();
  });

  it("进入房间后发送区会显示图片选择入口", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("#composerImagePickerBtn")).not.toBeNull();
    el.remove();
  });

  it("图片入口是小号加号按钮，而不是大号图片文案按钮", async () => {
    const el = await 创建已入房聊天壳();

    const button = el.shadowRoot!.querySelector(
      "#composerImagePickerBtn"
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button?.textContent?.trim()).toBe("+");
    expect(button?.getAttribute("aria-label")).toBe("选择图片");

    el.remove();
  });

  it("点击加号会直接触发原生文件输入，而不是打开 Dashboard", async () => {
    const el = await 创建已入房聊天壳();

    const input = el.shadowRoot!.querySelector(
      "#composerImageFileInput"
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const clickSpy = vi.spyOn(input!, "click");

    (
      el.shadowRoot!.querySelector("#composerImagePickerBtn") as HTMLButtonElement
    ).click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("发送区图片草稿会渲染在本地预览带里，而不是伪造成时间线消息", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-1",
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

  it("失败图片点击重试后会重新进入 uploading，而不是新建第二个草稿", async () => {
    const el = await 创建已入房聊天壳();
    (
      el as unknown as {
        imageUploader: {
          getFile: ReturnType<typeof vi.fn>;
          retryUpload: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      getFile: vi.fn().mockReturnValue({ id: "draft-retry" }),
      retryUpload: vi.fn().mockResolvedValue(undefined),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };
    注入图片草稿(el, {
      localId: "draft-retry",
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

    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-retry"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("uploading");
    expect(el.shadowRoot!.querySelectorAll('[data-draft-card-id="draft-retry"]').length).toBe(1);
    expect(
      (
        el as unknown as {
          imageUploader: {
            getFile: ReturnType<typeof vi.fn>;
            retryUpload: ReturnType<typeof vi.fn>;
            cancelAll: ReturnType<typeof vi.fn>;
            destroy: ReturnType<typeof vi.fn>;
          };
        }
      ).imageUploader.retryUpload
    ).toHaveBeenCalledWith("draft-retry");

    el.remove();
  });

  it("超出后端上限的图片会立即进入 failed 草稿，而不是卡在 uploading", async () => {
    const el = await 创建已入房聊天壳();
    const addFile = vi.fn();
    (
      el as unknown as {
        imageUploader: {
          addFile: ReturnType<typeof vi.fn>;
          setMeta: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      addFile,
      setMeta: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };
    const tooLargeFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-large.jpg", {
      type: "image/jpeg",
    });

    (
      el as unknown as {
        handleImageFileInputChange(event: Event): void;
      }
    ).handleImageFileInputChange({
      currentTarget: {
        files: [tooLargeFile],
        value: "selected",
      },
    } as unknown as Event);
    await 等待组件稳定(el);

    expect(addFile).not.toHaveBeenCalled();
    const draftStatus = el.shadowRoot!.querySelector(
      ".composer-draft-status"
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("failed");
    expect(draftStatus?.textContent).toContain("超过");
    el.remove();
  });

  it("图片选择器会显式放行 HEIC/HEIF 文件，而不是只靠 image/*", async () => {
    const el = await 创建已入房聊天壳();

    const input = el.shadowRoot!.querySelector(
      "#composerImageFileInput"
    ) as HTMLInputElement | null;
    expect(input?.accept).toContain(".heic");
    expect(input?.accept).toContain(".heif");

    el.remove();
  });

  it("手机 HEIC 图片会先在前端转成标准图片，再交给 Uppy 上传", async () => {
    const el = await 创建已入房聊天壳();
    const addFile = vi.fn();
    const input = {
      files: [new File([new Uint8Array([1, 2, 3])], "mobile.heic", { type: "image/heic" })],
      value: "selected",
    };
    const normalizedFile = new File([new Uint8Array([9, 8, 7])], "mobile.jpg", {
      type: "image/jpeg",
    });
    (
      el as unknown as {
        imageUploader: {
          addFile: ReturnType<typeof vi.fn>;
          setMeta: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
        准备待上传图片文件(file: File): Promise<File>;
      }
    ).imageUploader = {
      addFile,
      setMeta: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };
    (
      el as unknown as {
        准备待上传图片文件: ReturnType<typeof vi.fn>;
      }
    ).准备待上传图片文件 = vi.fn().mockResolvedValue(normalizedFile);

    await (
      el as unknown as {
        handleImageFileInputChange(event: Event): Promise<void>;
      }
    ).handleImageFileInputChange({
      currentTarget: input,
    } as unknown as Event);
    await 等待组件稳定(el);

    expect(
      (
        el as unknown as {
          准备待上传图片文件: ReturnType<typeof vi.fn>;
        }
      ).准备待上传图片文件
    ).toHaveBeenCalledWith(input.files[0]);
    expect(addFile).toHaveBeenCalledWith({
      name: "mobile.jpg",
      type: "image/jpeg",
      data: normalizedFile,
    });
    expect(input.value).toBe("");

    el.remove();
  });

  it("选图后会先 prepare，再把 attachmentId 记到草稿里", async () => {
    const transport = new 假传输();
    transport.prepareQueue = [
      {
        attachment_id: "att-prepared-1",
        upload_method: "PUT",
        upload_url: "http://storage.local/test-bucket/images/att-prepared-1/original?sig=1",
        upload_headers: { "content-type": "image/jpeg" },
        expires_at: "2026-04-10T12:00:00Z",
      },
    ];
    const el = await 创建已入房聊天壳(transport);
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "prepared.jpg", {
      type: "image/jpeg",
    });
    (
      el as unknown as {
        imageUploader: {
          addFile: ReturnType<typeof vi.fn>;
          setMeta: ReturnType<typeof vi.fn>;
          setFileMeta: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
        handleImageUploadAdded(file: {
          id: string;
          name: string;
          data: File;
          meta?: Record<string, unknown>;
        }): void;
      }
    ).imageUploader = {
      addFile: vi.fn((input: { name: string; data: File; meta?: Record<string, unknown> }) => {
        (
          el as unknown as {
            handleImageUploadAdded(file: {
              id: string;
              name: string;
              data: File;
              meta?: Record<string, unknown>;
            }): void;
          }
        ).handleImageUploadAdded({
          id: "draft-prepared-1",
          name: input.name,
          data: input.data,
          meta: input.meta,
        });
        return "draft-prepared-1";
      }),
      setMeta: vi.fn(),
      setFileMeta: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };

    await (
      el as unknown as {
        handleImageFileInputChange(event: Event): Promise<void>;
      }
    ).handleImageFileInputChange({
      currentTarget: {
        files: [sourceFile],
        value: "selected",
      },
    } as unknown as Event);
    await 等待组件稳定(el);

    expect(transport.prepareImageCalls).toEqual([
      { sessionId: "s-test", fileName: "prepared.jpg" },
    ]);
    const drafts = (
      el as unknown as {
        chatState: {
          composerImageDrafts: Array<{ attachmentId: string; status: string }>;
        };
      }
    ).chatState.composerImageDrafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.attachmentId).toBe("att-prepared-1");
    expect(drafts[0]?.status).toBe("uploading");

    el.remove();
  });

  it("直传成功后必须 complete 成功，草稿才会变成 ready", async () => {
    const transport = new 假传输();
    transport.completeQueue = [
      {
        attachment_id: "att-prepared-2",
        kind: "image",
        mime_type: "image/jpeg",
        byte_size: 3,
        width: 120,
        height: 90,
        status: "ready",
      },
    ];
    const el = await 创建已入房聊天壳(transport);
    注入图片草稿(el, {
      localId: "draft-complete-ok",
      attachmentId: "att-prepared-2",
      previewUrl: "blob:http://test.local/draft-complete-ok",
      width: 0,
      height: 0,
      status: "uploading",
      fileName: "complete-ok.jpg",
      errorCode: "",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "complete-ok.jpg", {
        type: "image/jpeg",
      }),
    });

    await Promise.resolve(
      (
        el as unknown as {
          handleImageUploadSuccess(
            file: { id: string },
            response: { body?: Record<string, unknown> }
          ): Promise<void> | void;
        }
      ).handleImageUploadSuccess({ id: "draft-complete-ok" }, {})
    );
    await 等待组件稳定(el);

    expect(transport.completeImageCalls).toEqual([
      { sessionId: "s-test", attachmentId: "att-prepared-2" },
    ]);
    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-complete-ok"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("ready");
    expect(draftStatus?.textContent).toContain("可发送");

    el.remove();
  });

  it("complete 失败时草稿会收口成 failed，而不是假 ready", async () => {
    const transport = new 假传输();
    transport.completeQueue = [创建传输错误(500, "system_error", "system_error")];
    const el = await 创建已入房聊天壳(transport);
    注入图片草稿(el, {
      localId: "draft-complete-failed",
      attachmentId: "att-prepared-3",
      previewUrl: "blob:http://test.local/draft-complete-failed",
      width: 0,
      height: 0,
      status: "uploading",
      fileName: "complete-failed.jpg",
      errorCode: "",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "complete-failed.jpg", {
        type: "image/jpeg",
      }),
    });

    await Promise.resolve(
      (
        el as unknown as {
          handleImageUploadSuccess(
            file: { id: string },
            response: { body?: Record<string, unknown> }
          ): Promise<void> | void;
        }
      ).handleImageUploadSuccess({ id: "draft-complete-failed" }, {})
    );
    await 等待组件稳定(el);

    expect(transport.completeImageCalls).toEqual([
      { sessionId: "s-test", attachmentId: "att-prepared-3" },
    ]);
    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-complete-failed"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("failed");
    expect(draftStatus?.textContent).toContain("system_error");

    el.remove();
  });

  it("上传 stalled 后会把草稿转成 failed，避免一直停在 uploading", async () => {
    const el = await 创建已入房聊天壳();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "stall.jpg", {
      type: "image/jpeg",
    });
    注入图片草稿(el, {
      localId: "draft-stalled",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-stalled",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "stall.jpg",
      errorCode: "",
      sourceFile,
    });
    (
      el as unknown as {
        imageUploader: {
          getFile: ReturnType<typeof vi.fn>;
          removeFile: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      getFile: vi.fn().mockReturnValue({
        id: "draft-stalled",
        name: "stall.jpg",
        data: sourceFile,
      }),
      removeFile: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };

    (
      el as unknown as {
        handleImageUploadStalled(
          error: { message: string },
          files: Array<{ id: string; name: string; data: File }>
        ): void;
      }
    ).handleImageUploadStalled(
      { message: "upload stalled" },
      [{ id: "draft-stalled", name: "stall.jpg", data: sourceFile }]
    );
    await 等待组件稳定(el);

    expect(
      (
        el as unknown as {
          imageUploader: {
            removeFile: ReturnType<typeof vi.fn>;
          };
        }
      ).imageUploader.removeFile
    ).toHaveBeenCalledWith("draft-stalled");
    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-stalled"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("failed");
    expect(draftStatus?.textContent).toContain("超时");
    el.remove();
  });

  it("upload-error 会从原始 xhr JSON 响应里提取稳定错误码并记录诊断", async () => {
    const el = await 创建已入房聊天壳();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    注入图片草稿(el, {
      localId: "draft-xhr-error",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-xhr-error",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "xhr-error.jpg",
      errorCode: "",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "xhr-error.jpg", {
        type: "image/jpeg",
      }),
    });

    (
      el as unknown as {
        handleImageUploadError(
          file: { id: string; name: string },
          error: { message: string },
          response: {
            status: number;
            responseText: string;
            readyState: number;
            responseURL: string;
            getResponseHeader(name: string): string | null;
          }
        ): void;
      }
    ).handleImageUploadError(
      { id: "draft-xhr-error", name: "xhr-error.jpg" },
      { message: "Upload error" },
      {
        status: 401,
        responseText: JSON.stringify({
          code: "invalid_session",
          message: "会话无效",
        }),
        readyState: 4,
        responseURL: "http://test.local/api/attachments/image",
        getResponseHeader(name: string) {
          return name === "x-koko-upload-id" ? "upl-debug-1" : null;
        },
      }
    );
    await 等待组件稳定(el);

    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-xhr-error"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("failed");
    expect(draftStatus?.textContent).toContain("会话");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[koko:image-upload:error]",
      expect.objectContaining({
        localId: "draft-xhr-error",
        fileName: "xhr-error.jpg",
        status: 401,
        errorCode: "invalid_session",
        uploadTraceId: "upl-debug-1",
        reachedHandler: true,
      })
    );

    el.remove();
  });

  it("upload-error 在 status=0 时会收口成网络失败，而不是继续停在模糊 uploading", async () => {
    const el = await 创建已入房聊天壳();
    注入图片草稿(el, {
      localId: "draft-network-error",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-network-error",
      width: 120,
      height: 90,
      status: "uploading",
      fileName: "network-error.jpg",
      errorCode: "",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "network-error.jpg", {
        type: "image/jpeg",
      }),
    });

    (
      el as unknown as {
        handleImageUploadError(
          file: { id: string; name: string },
          error: { message: string },
          response: {
            status: number;
            responseText: string;
            readyState: number;
            responseURL: string;
            getResponseHeader(name: string): string | null;
          }
        ): void;
      }
    ).handleImageUploadError(
      { id: "draft-network-error", name: "network-error.jpg" },
      { message: "Network Error" },
      {
        status: 0,
        responseText: "",
        readyState: 4,
        responseURL: "",
        getResponseHeader() {
          return null;
        },
      }
    );
    await 等待组件稳定(el);

    const draftStatus = el.shadowRoot!.querySelector(
      '[data-draft-card-id="draft-network-error"] .composer-draft-status'
    ) as HTMLElement | null;
    expect(draftStatus?.dataset.status).toBe("failed");
    expect(draftStatus?.textContent).toContain("网络");

    el.remove();
  });

  it("浏览器长期不回 upload-error 或 stalled 时，看门狗也会把草稿收口成 failed", async () => {
    const el = await 创建已入房聊天壳();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "watchdog.jpg", {
      type: "image/jpeg",
    });
    (
      el as unknown as {
        imageUploader: {
          setFileMeta: ReturnType<typeof vi.fn>;
          getFile: ReturnType<typeof vi.fn>;
          removeFile: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      setFileMeta: vi.fn(),
      getFile: vi.fn().mockReturnValue({
        id: "draft-watchdog",
        name: "watchdog.jpg",
        data: sourceFile,
      }),
      removeFile: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };

    vi.useFakeTimers();
    try {
      (
        el as unknown as {
          handleImageUploadAdded(file: { id: string; name: string; data: File }): void;
        }
      ).handleImageUploadAdded({
        id: "draft-watchdog",
        name: "watchdog.jpg",
        data: sourceFile,
      });
      await el.updateComplete;

      await vi.advanceTimersByTimeAsync(16000);
      await el.updateComplete;

      expect(
        (
          el as unknown as {
            imageUploader: {
              removeFile: ReturnType<typeof vi.fn>;
            };
          }
        ).imageUploader.removeFile
      ).toHaveBeenCalledWith("draft-watchdog");
      const draftStatus = el.shadowRoot!.querySelector(
        '[data-draft-card-id="draft-watchdog"] .composer-draft-status'
      ) as HTMLElement | null;
      expect(draftStatus?.dataset.status).toBe("failed");
      expect(draftStatus?.textContent).toContain("超时");
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("已经 ready 的图片草稿不会再被上传看门狗误伤回 failed", async () => {
    const transport = new 假传输();
    transport.completeQueue = [
      {
        attachment_id: "att-watchdog-ready",
        kind: "image",
        mime_type: "image/jpeg",
        byte_size: 3,
        width: 120,
        height: 90,
        status: "ready",
      },
    ];
    const el = await 创建已入房聊天壳(transport);
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "watchdog-ready.jpg", {
      type: "image/jpeg",
    });
    (
      el as unknown as {
        imageUploader: {
          setFileMeta: ReturnType<typeof vi.fn>;
          getFile: ReturnType<typeof vi.fn>;
          removeFile: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      setFileMeta: vi.fn(),
      getFile: vi.fn().mockReturnValue({
        id: "draft-watchdog-ready",
        name: "watchdog-ready.jpg",
        data: sourceFile,
      }),
      removeFile: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };

    vi.useFakeTimers();
    try {
      (
        el as unknown as {
          handleImageUploadAdded(file: { id: string; name: string; data: File }): void;
          handleImageUploadSuccess(
            file: { id: string },
            response: { body: Record<string, unknown> }
          ): Promise<void> | void;
        }
      ).handleImageUploadAdded({
        id: "draft-watchdog-ready",
        name: "watchdog-ready.jpg",
        data: sourceFile,
      });
      await Promise.resolve(
        (
        el as unknown as {
          handleImageUploadSuccess(
            file: { id: string },
            response: { body: Record<string, unknown> }
          ): Promise<void> | void;
        }
      ).handleImageUploadSuccess(
        { id: "draft-watchdog-ready" },
        {
          body: {
            ok: true,
          },
        }
        )
      );
      await el.updateComplete;

      await vi.advanceTimersByTimeAsync(16000);
      await el.updateComplete;

      const draftStatus = el.shadowRoot!.querySelector(
        '[data-draft-card-id="draft-watchdog-ready"] .composer-draft-status'
      ) as HTMLElement | null;
      expect(draftStatus?.dataset.status).toBe("ready");
      expect(transport.completeImageCalls).toEqual([
        { sessionId: "s-test", attachmentId: "att-watchdog-ready" },
      ]);
      expect(
        (
          el as unknown as {
            imageUploader: {
              removeFile: ReturnType<typeof vi.fn>;
            };
          }
        ).imageUploader.removeFile
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it("stalled 后的失败草稿重试会重新 addFile，而不是调用失效的 retryUpload", async () => {
    const el = await 创建已入房聊天壳();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "retry-stalled.jpg", {
      type: "image/jpeg",
    });
    注入图片草稿(el, {
      localId: "draft-stalled-retry",
      attachmentId: "",
      previewUrl: "blob:http://test.local/draft-stalled-retry",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "retry-stalled.jpg",
      errorCode: "attachment_upload_stalled",
      sourceFile,
    });
    (
      el as unknown as {
        imageUploader: {
          getFile: ReturnType<typeof vi.fn>;
          addFile: ReturnType<typeof vi.fn>;
          retryUpload: ReturnType<typeof vi.fn>;
          cancelAll: ReturnType<typeof vi.fn>;
          destroy: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader = {
      getFile: vi.fn().mockReturnValue(undefined),
      addFile: vi.fn().mockReturnValue("draft-stalled-retry"),
      retryUpload: vi.fn(),
      cancelAll: vi.fn(),
      destroy: vi.fn(),
    };
    await 等待组件稳定(el);

    (
      el.shadowRoot!.querySelector(
        '[data-draft-retry-id="draft-stalled-retry"]'
      ) as HTMLButtonElement
    ).click();
    await 等待组件稳定(el);

    const uploader = (
      el as unknown as {
        imageUploader: {
          getFile: ReturnType<typeof vi.fn>;
          addFile: ReturnType<typeof vi.fn>;
          retryUpload: ReturnType<typeof vi.fn>;
        };
      }
    ).imageUploader;
    expect(uploader.addFile).toHaveBeenCalled();
    expect(uploader.retryUpload).not.toHaveBeenCalled();
    el.remove();
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

  it("存在阻塞图片草稿时，按 Enter 不会再绕过禁用态偷偷触发发送", async () => {
    const el = await 创建已入房聊天壳();
    输入消息到操作台(el, "hello");
    注入图片草稿(el, {
      localId: "draft-uploading-enter",
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

