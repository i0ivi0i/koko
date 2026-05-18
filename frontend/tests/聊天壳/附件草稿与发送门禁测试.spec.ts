// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 聊天壳 } from "../../应用根/聊天壳";
import {
  创建已入房聊天壳,
  假传输,
  注入媒体草稿,
  注入媒体发布器供测试,
  注入图片草稿,
  等待组件稳定,
  读取附件入口按钮,
  读取操作台主动作,
  读取操作台主输入,
  读取操作台表单,
  读取统一媒体文件输入,
  输入房间短码到操作台,
  输入消息到操作台,
} from "../common/聊天测试支架";
import { 创建假媒体发布器, 注册聊天壳集成测试基线 } from "./测试支撑";

describe("聊天壳集成 / 附件草稿与发送门禁", () => {
  注册聊天壳集成测试基线();

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

    const draftImage = el.shadowRoot!.querySelector('img[data-draft-id="draft-1"]') as HTMLImageElement | null;
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

  it("pending-first: processing 草稿已有 attachmentId 时发送按钮可点击并仍提示后台处理中", async () => {
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

    expect(读取操作台主动作(el).disabled).toBe(false);
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
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("上传失败");
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
      el.shadowRoot!.querySelector('[data-draft-remove-id="draft-remove"]') as HTMLButtonElement
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
      sourceFile: new File([new Uint8Array([1, 2, 3])], "retry.png", {
        type: "image/png",
      }),
    });
    await 等待组件稳定(el);

    (
      el.shadowRoot!.querySelector('[data-draft-resume-id="draft-retry"]') as HTMLButtonElement
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
      sourceFile: new File([new Uint8Array([1, 2, 3])], "retry-split.png", {
        type: "image/png",
      }),
    });
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector('[data-draft-resume-id="draft-retry-split"]')).toBeInstanceOf(
      HTMLButtonElement
    );
    expect(el.shadowRoot!.querySelector('[data-draft-restart-id="draft-retry-split"]')).toBeInstanceOf(
      HTMLButtonElement
    );
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
      sourceFile: new File([new Uint8Array([1, 2, 3])], "retry-actions.png", {
        type: "image/png",
      }),
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

  it("需要重新选择文件的失败草稿会用同一个文件输入继续同一草稿", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    注入图片草稿(el, {
      localId: "draft-needs-file",
      kind: "image",
      attachmentId: "att-needs-file",
      previewUrl: "",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "needs-file.jpg",
      errorCode: "attachment_file_needs_reselect",
    });
    await 等待组件稳定(el);

    const input = 读取统一媒体文件输入(el);
    const clickSpy = vi.spyOn(input, "click");
    (
      el.shadowRoot!.querySelector(
        '[data-draft-reselect-id="draft-needs-file"]'
      ) as HTMLButtonElement
    ).click();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File([new Uint8Array([1, 2, 3])], "needs-file.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    Object.defineProperty(input, "value", {
      configurable: true,
      writable: true,
      value: "selected",
    });
    input.dispatchEvent(new Event("change"));
    await 等待组件稳定(el);

    expect(fake媒体发布器.重新选择上传草稿).toHaveBeenCalledWith(
      "draft-needs-file",
      file
    );
    expect(fake媒体发布器.处理选择媒体文件).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    el.remove();
  });

  it("刷新后源文件丢失的中断草稿必须重新选择文件，不能继续调用无 owner 重试", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    注入图片草稿(el, {
      localId: "draft-interrupted-no-file",
      kind: "image",
      attachmentId: "att-interrupted-no-file",
      previewUrl: "",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "interrupted.jpg",
      errorCode: "attachment_upload_interrupted",
      sourceFile: null,
    });
    await 等待组件稳定(el);

    expect(
      el.shadowRoot!.querySelector('[data-draft-resume-id="draft-interrupted-no-file"]')
    ).toBeNull();
    expect(
      el.shadowRoot!.querySelector('[data-draft-restart-id="draft-interrupted-no-file"]')
    ).toBeNull();

    const input = 读取统一媒体文件输入(el);
    const clickSpy = vi.spyOn(input, "click");
    (
      el.shadowRoot!.querySelector(
        '[data-draft-reselect-id="draft-interrupted-no-file"]'
      ) as HTMLButtonElement
    ).click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fake媒体发布器.继续上传草稿).not.toHaveBeenCalled();
    expect(fake媒体发布器.重新上传草稿).not.toHaveBeenCalled();
    el.remove();
  });

  it("统一媒体文件输入 change 时会把选中的文件转交给媒体发布器并清空 input 值", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);
    const imageFile = new File([new Uint8Array([1, 2, 3])], "selected.jpg", { type: "image/jpeg" });
    const videoFile = new File([new Uint8Array([4, 5, 6])], "selected.mp4", { type: "video/mp4" });
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

  it("统一媒体文件刚选中但草稿尚未注册时，也会立刻禁用发送并阻止纯文本抢跑", async () => {
    const transport = new 假传输();
    const el = await 创建已入房聊天壳(transport);
    const fake媒体发布器 = 创建假媒体发布器();
    let 结束媒体选择!: () => void;
    fake媒体发布器.处理选择媒体文件.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          结束媒体选择 = resolve;
        })
    );
    注入媒体发布器供测试(el, fake媒体发布器);
    输入消息到操作台(el, "文本不能先发");
    const imageFile = new File([new Uint8Array([1, 2, 3])], "selected.jpg", { type: "image/jpeg" });
    const input = 读取统一媒体文件输入(el);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [imageFile],
    });

    input.dispatchEvent(new Event("change"));
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在准备");

    读取操作台表单(el).dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(transport.socket.sentEvents.some(({ event }) => event === "create_message")).toBe(false);

    结束媒体选择();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(读取操作台主动作(el).disabled).toBe(false);
    el.remove();
  });

  it("组件销毁时会销毁媒体发布器，避免旧上传器泄漏到下一次挂载", async () => {
    const el = await 创建已入房聊天壳();
    const fake媒体发布器 = 创建假媒体发布器();
    注入媒体发布器供测试(el, fake媒体发布器);

    el.remove();

    expect(fake媒体发布器.销毁).toHaveBeenCalledTimes(1);
  });

  it("首页和房间都只存在同一个主输入与同一个主动作节点", async () => {
    const transport = new 假传输();
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryInput").length).toBe(1);
    expect(el.shadowRoot!.querySelectorAll("#shellConsolePrimaryAction").length).toBe(1);

    const primaryInput = el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement;
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

    const primaryInput = el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement;
    const shellConsoleForm = el.shadowRoot!.querySelector("#shellConsoleForm") as HTMLFormElement | null;

    expect(shellConsoleForm).not.toBeNull();

    primaryInput.value = "ROOM01";
    primaryInput.dispatchEvent(new Event("input"));
    shellConsoleForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await 等待组件稳定(el);

    expect(transport.joinCalls).toEqual([{ sessionId: "s-test", roomCode: "ROOM01" }]);

    const messageInput = el.shadowRoot!.querySelector("#shellConsolePrimaryInput") as HTMLInputElement;
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
      el.shadowRoot!.querySelector('video.message-video-preview[data-attachment-id="att-video-send-1"]')
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

    读取操作台主输入(el).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    await 等待组件稳定(el);

    expect(transport.socket.sentEvents.some(({ event }) => event === "create_message")).toBe(false);
    expect(el.shadowRoot!.querySelector("#shellConsoleStatus")?.textContent).toContain("正在上传");
    el.remove();
  });
});
