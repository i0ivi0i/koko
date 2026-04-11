import Uppy from "@uppy/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建传输错误 } from "./common/聊天测试支架";
import {
  写入媒体草稿,
  更新媒体草稿状态,
  移除媒体草稿,
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
} from "../媒体/媒体草稿";
import {
  创建媒体发布器,
  媒体上传失活超时毫秒,
  type 媒体上传器,
  type 媒体上传文件,
  type 媒体上传Meta,
  type 媒体上传响应体,
} from "../媒体/媒体发布";

class 假媒体上传器 implements 媒体上传器 {
  private readonly handlers = new Map<string, Array<(...args: Array<any>) => void | Promise<void>>>();
  private readonly files = new Map<string, 媒体上传文件>();

  readonly addFileCalls: Array<{
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 媒体上传Meta;
  }> = [];
  readonly removeFileCalls: string[] = [];
  readonly retryUploadCalls: string[] = [];
  cancelAllCalls = 0;
  destroyCalls = 0;
  retryUploadError: unknown = null;
  nextAddFileReturnedId: string | null = null;

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
    meta?: 媒体上传Meta;
  }): string {
    this.addFileCalls.push(input);
    const returnedId = this.nextAddFileReturnedId ?? input.id;
    this.nextAddFileReturnedId = null;
    const file: 媒体上传文件 = {
      id: returnedId,
      name: input.name,
      type: input.type,
      data: input.data,
      meta: input.meta,
    };
    this.files.set(returnedId, file);
    void this.emit("file-added", file);
    return returnedId;
  }

  getFile(id: string): 媒体上传文件 | undefined {
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

  静默丢弃文件(id: string): void {
    this.files.delete(id);
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

  async 触发上传成功(id: string, response: { body?: 媒体上传响应体 } = {}): Promise<void> {
    await this.emit("upload-success", this.files.get(id), response);
  }

  async 触发上传错误(
    id: string,
    error: { message: string },
    response?: {
      body?: 媒体上传响应体;
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
  let drafts: 媒体附件草稿[] = [];
  return {
    readDrafts: () => drafts,
    writeDraft(draft: 媒体附件草稿) {
      drafts = 写入媒体草稿(drafts, draft).草稿列表;
    },
    updateDraft(localId: string, patch: 媒体草稿状态补丁) {
      drafts = 更新媒体草稿状态(drafts, localId, patch).草稿列表;
    },
    removeDraft(localId: string) {
      drafts = 移除媒体草稿(drafts, localId).草稿列表;
    },
    clearDrafts() {
      drafts = [];
    },
  };
}

function 创建场景() {
  const uploader = new 假媒体上传器();
  const drafts = 创建草稿仓库();
  const uploaderEndpoints: string[] = [];
  const prepareMediaUpload = vi.fn(async (_kind: "image" | "video", _sessionId: string, file: File) => ({
    attachment_id: `att-${file.name}`,
    upload_method: "tus" as const,
    tus_endpoint: "http://storage.local/files",
    tus_headers: { Authorization: "Bearer media-upload-token" },
    tus_metadata: {
      attachment_id: `att-${file.name}`,
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      byte_size: String(file.size),
    },
    expires_at: "2026-04-10T12:00:00Z",
  }));
  const completeMediaUpload = vi.fn(async (_sessionId: string, attachmentId: string) => ({
    attachment_id: attachmentId,
    kind: attachmentId.endsWith(".mp4") ? ("video" as const) : ("image" as const),
    mime_type: attachmentId.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    byte_size: 3,
    width: attachmentId.endsWith(".mp4") ? 1280 : 120,
    height: attachmentId.endsWith(".mp4") ? 720 : 90,
    status: "ready" as const,
  }));
  const 发布器 = 创建媒体发布器({
    getSessionId: () => "s-test",
    prepareMediaUpload,
    completeMediaUpload,
    readDrafts: drafts.readDrafts,
    writeDraft: drafts.writeDraft,
    updateDraft: drafts.updateDraft,
    removeDraft: drafts.removeDraft,
    clearDrafts: drafts.clearDrafts,
    createUploader: (endpoint) => {
      uploaderEndpoints.push(endpoint);
      return uploader;
    },
    readVideoMetadata: async () => ({ width: 1280, height: 720 }),
    createPreviewUrl: (file) => (file instanceof File ? `blob:${file.name}` : file ? "blob:memory" : ""),
  });
  return {
    发布器,
    uploader,
    drafts,
    prepareMediaUpload,
    completeMediaUpload,
    uploaderEndpoints,
  };
}

describe("媒体发布器", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Uppy 本地文件会忽略传入 id，只有 relativePath 变化才会改变内部 file.id", () => {
    const uppy = new Uppy<媒体上传Meta, 媒体上传响应体>();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "same.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });

    const firstId = uppy.addFile({
      id: "att-first",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: { attachment_id: "att-first" },
    });
    uppy.removeFile(firstId);
    const secondId = uppy.addFile({
      id: "att-second",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: { attachment_id: "att-second" },
    });
    expect(secondId).toBe(firstId);

    uppy.removeFile(secondId);
    const thirdId = uppy.addFile({
      id: "att-third",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: {
        attachment_id: "att-third",
        relativePath: "att-third",
      },
    });
    expect(thirdId).not.toBe(secondId);
  });

  it("选图后会先 prepare 再写入 uploading 草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });

    await 场景.发布器.处理选择图片文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith("image", "s-test", sourceFile);
    expect(场景.uploader.addFileCalls).toEqual([
      expect.objectContaining({
        id: "att-picked.jpg",
        name: "picked.jpg",
        meta: expect.objectContaining({
          upload_method: "tus",
          tus_endpoint: "http://storage.local/files",
          attachment_id: "att-picked.jpg",
          relativePath: "att-picked.jpg",
          file_name: "picked.jpg",
          mime_type: "image/jpeg",
          byte_size: "3",
        }),
      }),
    ]);
    expect(场景.uploaderEndpoints).toEqual(["http://storage.local/files"]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.jpg",
        kind: "image",
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
    await 场景.发布器.处理选择图片文件([sourceFile]);

    await 场景.uploader.触发上传成功("att-complete-ok.jpg");

    expect(场景.completeMediaUpload).toHaveBeenCalledWith("s-test", "att-complete-ok.jpg");
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-complete-ok.jpg",
        kind: "image",
        attachmentId: "att-complete-ok.jpg",
        status: "ready",
        width: 120,
        height: 90,
      }),
    ]);
  });

  it("complete 失败时会把草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    场景.completeMediaUpload.mockRejectedValueOnce(
      创建传输错误(500, "system_error", "system_error")
    );
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-failed.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择图片文件([sourceFile]);

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
    await 场景.发布器.处理选择图片文件([sourceFile]);

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

  it("选视频后会先走媒体 prepare 再写入 uploading 视频草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择视频文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith("video", "s-test", sourceFile);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.mp4",
        kind: "video",
        attachmentId: "att-picked.mp4",
        status: "uploading",
        width: 1280,
        height: 720,
      }),
    ]);
  });

  it("视频 upload-success 后 complete 成功，草稿会变成 ready 视频", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择视频文件([sourceFile]);
    await 场景.uploader.触发上传成功("att-clip.mp4");

    expect(场景.completeMediaUpload).toHaveBeenCalledWith("s-test", "att-clip.mp4");
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-clip.mp4",
        kind: "video",
        attachmentId: "att-clip.mp4",
        status: "ready",
        width: 1280,
        height: 720,
      }),
    ]);
  });

  it("upload-stalled 后不会把 failed 草稿误删成空白", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "stalled.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择图片文件([sourceFile]);

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
      await 场景.发布器.处理选择图片文件([sourceFile]);
      await vi.advanceTimersByTimeAsync(媒体上传失活超时毫秒 + 1000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[koko:media-upload:watchdog]",
        expect.objectContaining({
          localId: "att-watchdog.jpg",
          kind: "image",
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

  it("重试失败草稿时若底层上传器分配了新 localId，不会留下旧草稿幽灵副本", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "retry.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择图片文件([sourceFile]);
    场景.drafts.updateDraft("att-retry.jpg", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    场景.uploader.静默丢弃文件("att-retry.jpg");
    场景.prepareMediaUpload.mockResolvedValueOnce({
      attachment_id: "att-retry-second",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer media-upload-token" },
      tus_metadata: {
        attachment_id: "att-retry-second",
        file_name: sourceFile.name,
        mime_type: sourceFile.type,
        byte_size: String(sourceFile.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    });
    场景.uploader.nextAddFileReturnedId = "uppy-retry-second-local-id";

    await 场景.发布器.重试草稿("att-retry.jpg");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "uppy-retry-second-local-id",
        attachmentId: "att-retry-second",
        status: "uploading",
        errorCode: "",
      }),
    ]);
  });
});
