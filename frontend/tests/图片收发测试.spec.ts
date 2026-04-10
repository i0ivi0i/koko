import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建传输错误 } from "./common/聊天测试支架";
import {
  写入图片草稿,
  更新图片草稿状态,
  移除图片草稿,
  type 图片附件草稿,
  type 图片草稿状态补丁,
} from "../图像/图片草稿";
import {
  创建图片收发器,
  图片上传失活超时毫秒,
  type 图片上传器,
  type 图片上传文件,
  type 图片上传Meta,
  type 图片上传响应体,
} from "../图像/图片收发";

class 假图片上传器 implements 图片上传器 {
  private readonly handlers = new Map<string, Array<(...args: Array<any>) => void | Promise<void>>>();
  private readonly files = new Map<string, 图片上传文件>();

  readonly addFileCalls: Array<{
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 图片上传Meta;
  }> = [];
  readonly removeFileCalls: string[] = [];
  readonly retryUploadCalls: string[] = [];
  cancelAllCalls = 0;
  destroyCalls = 0;
  retryUploadError: unknown = null;

  on(event: string, handler: (...args: Array<any>) => void | Promise<void>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  addFile(input: {
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 图片上传Meta;
  }): string {
    this.addFileCalls.push(input);
    const file: 图片上传文件 = {
      id: input.id,
      name: input.name,
      type: input.type,
      data: input.data,
      meta: input.meta,
    };
    this.files.set(input.id, file);
    void this.emit("file-added", file);
    return input.id;
  }

  getFile(id: string): 图片上传文件 | undefined {
    return this.files.get(id);
  }

  removeFile(id: string): void {
    this.removeFileCalls.push(id);
    const file = this.files.get(id);
    this.files.delete(id);
    if (file) {
      void this.emit("file-removed", file);
    }
  }

  async retryUpload(id: string): Promise<void> {
    this.retryUploadCalls.push(id);
    if (this.retryUploadError) {
      throw this.retryUploadError;
    }
  }

  cancelAll(): void {
    this.cancelAllCalls += 1;
  }

  destroy(): void {
    this.destroyCalls += 1;
  }

  async 触发上传成功(id: string, response: { body?: 图片上传响应体 } = {}): Promise<void> {
    await this.emit("upload-success", this.files.get(id), response);
  }

  async 触发上传错误(
    id: string,
    error: { message: string },
    response?: {
      body?: 图片上传响应体;
      status?: number;
      responseText?: string;
      readyState?: number;
      responseURL?: string;
      getResponseHeader?(name: string): string | null;
    }
  ): Promise<void> {
    await this.emit("upload-error", this.files.get(id), error, response);
  }

  async 触发上传停滞(id: string, error: { message: string } = { message: "upload stalled" }): Promise<void> {
    const file = this.files.get(id);
    await this.emit("upload-stalled", error, file ? [file] : []);
  }

  async 触发上传进度(id: string): Promise<void> {
    await this.emit("upload-progress", this.files.get(id));
  }

  private async emit(event: string, ...args: Array<unknown>): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      await handler(...args);
    }
  }
}

function 创建草稿仓库() {
  let drafts: 图片附件草稿[] = [];
  return {
    readDrafts: () => drafts,
    writeDraft(draft: 图片附件草稿) {
      drafts = 写入图片草稿(drafts, draft).草稿列表;
    },
    updateDraft(localId: string, patch: 图片草稿状态补丁) {
      drafts = 更新图片草稿状态(drafts, localId, patch).草稿列表;
    },
    removeDraft(localId: string) {
      drafts = 移除图片草稿(drafts, localId).草稿列表;
    },
    clearDrafts() {
      drafts = [];
    },
  };
}

function 创建场景() {
  const uploader = new 假图片上传器();
  const drafts = 创建草稿仓库();
  const prepareImageUpload = vi.fn(async (_sessionId: string, file: File) => ({
    attachment_id: `att-${file.name}`,
    upload_method: "PUT" as const,
    upload_url: `http://storage.local/${file.name}`,
    upload_headers: { "content-type": file.type || "image/jpeg" },
    expires_at: "2026-04-10T12:00:00Z",
  }));
  const completeImageUpload = vi.fn(async (_sessionId: string, attachmentId: string) => ({
    attachment_id: attachmentId,
    kind: "image" as const,
    mime_type: "image/jpeg",
    byte_size: 3,
    width: 120,
    height: 90,
    status: "ready" as const,
  }));
  const 收发器 = 创建图片收发器({
    getSessionId: () => "s-test",
    prepareImageUpload,
    completeImageUpload,
    readDrafts: drafts.readDrafts,
    writeDraft: drafts.writeDraft,
    updateDraft: drafts.updateDraft,
    removeDraft: drafts.removeDraft,
    clearDrafts: drafts.clearDrafts,
    createUploader: () => uploader,
    normalizeUploadFile: async (file) => file,
    createPreviewUrl: (file) => (file instanceof File ? `blob:${file.name}` : file ? "blob:memory" : ""),
  });
  return {
    收发器,
    uploader,
    drafts,
    prepareImageUpload,
    completeImageUpload,
  };
}

describe("图片收发器", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("选图后会先 prepare 再写入 uploading 草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });

    await 场景.收发器.处理选择文件([sourceFile]);

    expect(场景.prepareImageUpload).toHaveBeenCalledWith("s-test", sourceFile);
    expect(场景.uploader.addFileCalls).toEqual([
      expect.objectContaining({
        id: "att-picked.jpg",
        name: "picked.jpg",
      }),
    ]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.jpg",
        attachmentId: "att-picked.jpg",
        status: "uploading",
      }),
    ]);
  });

  it("upload-success 后必须 complete 成功，草稿才会变成 ready", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-ok.jpg", {
      type: "image/jpeg",
    });
    await 场景.收发器.处理选择文件([sourceFile]);

    await 场景.uploader.触发上传成功("att-complete-ok.jpg");

    expect(场景.completeImageUpload).toHaveBeenCalledWith("s-test", "att-complete-ok.jpg");
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-complete-ok.jpg",
        attachmentId: "att-complete-ok.jpg",
        status: "ready",
        width: 120,
        height: 90,
      }),
    ]);
  });

  it("complete 失败时会把草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    场景.completeImageUpload.mockRejectedValueOnce(
      创建传输错误(500, "system_error", "system_error")
    );
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-failed.jpg", {
      type: "image/jpeg",
    });
    await 场景.收发器.处理选择文件([sourceFile]);

    await 场景.uploader.触发上传成功("att-complete-failed.jpg");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-complete-failed.jpg",
        status: "failed",
        errorCode: "system_error",
      }),
    ]);
  });

  it("upload-error 会把 uploading 草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "xhr-error.jpg", {
      type: "image/jpeg",
    });
    await 场景.收发器.处理选择文件([sourceFile]);

    await 场景.uploader.触发上传错误(
      "att-xhr-error.jpg",
      { message: "Upload error" },
      {
        status: 401,
        responseText: JSON.stringify({
          code: "invalid_session",
          message: "会话无效",
        }),
        readyState: 4,
        responseURL: "http://storage.local/xhr-error.jpg",
      }
    );

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-xhr-error.jpg",
        attachmentId: "att-xhr-error.jpg",
        status: "failed",
        errorCode: "invalid_session",
      }),
    ]);
  });

  it("upload-stalled 后不会把 failed 草稿误删成空白", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "stalled.jpg", {
      type: "image/jpeg",
    });
    await 场景.收发器.处理选择文件([sourceFile]);

    await 场景.uploader.触发上传停滞("att-stalled.jpg");

    expect(场景.uploader.removeFileCalls).toEqual(["att-stalled.jpg"]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-stalled.jpg",
        status: "failed",
        errorCode: "attachment_upload_stalled",
      }),
    ]);
  });

  it("看门狗超时后会把草稿收口成 failed，且不会静默丢草稿", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "watchdog.jpg", {
      type: "image/jpeg",
    });
    vi.useFakeTimers();
    try {
      await 场景.收发器.处理选择文件([sourceFile]);
      await vi.advanceTimersByTimeAsync(图片上传失活超时毫秒 + 1000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[koko:image-upload:watchdog]",
        expect.objectContaining({
          localId: "att-watchdog.jpg",
          fileName: "watchdog.jpg",
        })
      );
      expect(场景.uploader.removeFileCalls).toEqual(["att-watchdog.jpg"]);
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-watchdog.jpg",
          status: "failed",
          errorCode: "attachment_upload_stalled",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("已经 ready 的草稿不会再被看门狗误伤", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "ready.jpg", {
      type: "image/jpeg",
    });
    vi.useFakeTimers();
    try {
      await 场景.收发器.处理选择文件([sourceFile]);
      await 场景.uploader.触发上传进度("att-ready.jpg");
      await 场景.uploader.触发上传成功("att-ready.jpg");
      await vi.advanceTimersByTimeAsync(图片上传失活超时毫秒 + 1000);

      expect(场景.uploader.removeFileCalls).toEqual([]);
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-ready.jpg",
          status: "ready",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stalled 后重试会复用同一个 localId 重新 addFile，而不是调用失效的 retryUpload", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "retry-stalled.jpg", {
      type: "image/jpeg",
    });
    场景.drafts.writeDraft({
      localId: "draft-stalled-retry",
      attachmentId: "",
      previewUrl: "blob:retry-stalled.jpg",
      width: 120,
      height: 90,
      status: "failed",
      fileName: "retry-stalled.jpg",
      errorCode: "attachment_upload_stalled",
      sourceFile,
    });
    场景.收发器.准备选择图片();

    await 场景.收发器.重试草稿("draft-stalled-retry");

    expect(场景.uploader.addFileCalls).toEqual([
      expect.objectContaining({
        id: "draft-stalled-retry",
        name: "retry-stalled.jpg",
      }),
    ]);
    expect(场景.uploader.retryUploadCalls).toEqual([]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "draft-stalled-retry",
        status: "uploading",
      }),
    ]);
  });
});
