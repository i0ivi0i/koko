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
  构造媒体Tus传输选项,
  大视频高吞吐阈值字节数,
  媒体Tus文件并发上限,
  媒体Tus重试延迟毫秒数组,
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

function 创建指定大小文件(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(file, "size", {
    configurable: true,
    value: size,
  });
  return file;
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
  const 默认上传器 = new 假媒体上传器();
  const 大视频上传器 = new 假媒体上传器();
  const drafts = 创建草稿仓库();
  const createUploaderCalls: Array<{
    tusEndpoint?: string;
    profile?: string;
    attachmentId?: string;
    uploadSessionId?: string;
  }> = [];
  const yieldToMainThread = vi.fn(async () => {});
  const prepareMediaUpload = vi.fn(async (_kind: "image" | "video", _sessionId: string, file: File) => ({
    attachment_id: `att-${file.name}`,
    upload_session_id: `upl-${file.name}`,
    upload_method: "tus" as const,
    tus_endpoint: "http://storage.local/files",
    tus_headers: { Authorization: "Bearer media-upload-token" },
    tus_metadata: {
      attachment_id: `att-${file.name}`,
      upload_session_id: `upl-${file.name}`,
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
  const abandonMediaUpload = vi.fn(async (_sessionId: string, _attachmentId: string) => undefined);
  const 发布器 = 创建媒体发布器({
    getSessionId: () => "s-test",
    prepareMediaUpload,
    abandonMediaUpload,
    completeMediaUpload,
    readDrafts: drafts.readDrafts,
    writeDraft: drafts.writeDraft,
    updateDraft: drafts.updateDraft,
    removeDraft: drafts.removeDraft,
    clearDrafts: drafts.clearDrafts,
    createUploader: (input: unknown) => {
      const normalized =
        typeof input === "string"
          ? { tusEndpoint: input, profile: "legacy-single-uploader" }
          : ((input ?? {}) as {
              tusEndpoint?: string;
              profile?: string;
              attachmentId?: string;
              uploadSessionId?: string;
            });
      createUploaderCalls.push(normalized);
      return normalized.profile === "large-video" ? 大视频上传器 : 默认上传器;
    },
    readVideoMetadata: async () => ({ width: 1280, height: 720 }),
    createPreviewUrl: (file) => (file instanceof File ? `blob:${file.name}` : file ? "blob:memory" : ""),
    yieldToMainThread,
  });
  return {
    发布器,
    默认上传器,
    大视频上传器,
    drafts,
    prepareMediaUpload,
    abandonMediaUpload,
    completeMediaUpload,
    createUploaderCalls,
    yieldToMainThread,
  };
}

describe("媒体发布器", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("默认 Tus 参数保持显式并发与重试策略", () => {
    expect(媒体Tus文件并发上限).toBe(8);
    expect(大视频高吞吐阈值字节数).toBe(32 * 1024 * 1024);
    expect(媒体Tus重试延迟毫秒数组).toEqual([0, 1000, 3000, 5000]);
  });

  it("large-video 恢复 parallelUploads 时必须同时声明 partial metadata", () => {
    const transportOptions = 构造媒体Tus传输选项({
      tusEndpoint: "http://storage.local/files",
      profile: "large-video",
      /**
       * 这里继续锁住 Concatenation 的最小契约：
       * - `parallelUploads` 只是 transport 优化开关，不是业务锚点；
       * - partial upload 必须显式带回 attachment/session，否则 Rustus hook 无法知道这些分片属于谁；
       * - 所以这条测试专门防回归“只开并行、不补 metadataForPartialUploads”的假高吞吐。
       */
      attachmentId: "att-large-video",
      uploadSessionId: "upload-session-1",
    }) as {
      parallelUploads?: number;
      metadataForPartialUploads?: Record<string, string>;
      uploadDataDuringCreation: boolean;
      addRequestId: boolean;
    };

    expect(transportOptions.parallelUploads).toBe(4);
    expect(transportOptions.metadataForPartialUploads).toEqual(
      expect.objectContaining({
        attachment_id: "att-large-video",
        upload_session_id: "upload-session-1",
      }),
    );
    expect(transportOptions.uploadDataDuringCreation).toBe(true);
    expect(transportOptions.addRequestId).toBe(true);
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

  it("统一媒体入口会按文件逐个识别图片和视频，再进入同一条上传主链", async () => {
    const 场景 = 创建场景();
    const imageFile = new File([new Uint8Array([1, 2, 3])], "mixed.jpg", {
      type: "",
    });
    const videoFile = new File([new Uint8Array([4, 5, 6])], "mixed.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([imageFile, videoFile]);

    expect(场景.prepareMediaUpload.mock.calls).toEqual([
      ["image", "s-test", expect.objectContaining({ name: "mixed.jpg" })],
      ["video", "s-test", videoFile],
    ]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-mixed.jpg",
        kind: "image",
        status: "transporting",
      }),
      expect.objectContaining({
        localId: "att-mixed.mp4",
        kind: "video",
        status: "transporting",
      }),
    ]);
  });

  it("统一媒体入口批量处理多文件时会主动让出主线程，避免连续重任务长时间卡住页面", async () => {
    const 场景 = 创建场景();
    const firstFile = new File([new Uint8Array([1, 2, 3])], "first.jpg", {
      type: "image/jpeg",
    });
    const secondFile = new File([new Uint8Array([4, 5, 6])], "second.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([firstFile, secondFile]);

    expect(场景.yieldToMainThread).toHaveBeenCalledTimes(1);
  });

  it("统一媒体入口遇到不支持文件时不会误进 prepare/upload 主链", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "blocked.pdf", {
      type: "application/pdf",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
    expect(场景.默认上传器.addFileCalls).toEqual([]);
    expect(场景.drafts.readDrafts()).toEqual([]);
  });

  it("选图后会先 prepare 再写入 transporting 草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith("image", "s-test", sourceFile);
    expect(场景.默认上传器.addFileCalls).toEqual([
      expect.objectContaining({
        id: "att-picked.jpg",
        name: "picked.jpg",
        meta: expect.objectContaining({
          upload_method: "tus",
          tus_endpoint: "http://storage.local/files",
          attachment_id: "att-picked.jpg",
          upload_session_id: "upl-picked.jpg",
          relativePath: "att-picked.jpg",
          file_name: "picked.jpg",
          mime_type: "image/jpeg",
          byte_size: "3",
        }),
      }),
    ]);
    expect(场景.createUploaderCalls).toEqual([
      {
        tusEndpoint: "http://storage.local/files",
        profile: "default",
        attachmentId: "att-picked.jpg",
        uploadSessionId: "upl-picked.jpg",
      },
    ]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.jpg",
        kind: "image",
        attachmentId: "att-picked.jpg",
        status: "transporting",
      }),
    ]);
  });

  it("upload-success 后草稿会先进入 processing，再等 complete 成功后才会 ready", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-ok.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    let 完成上传!: (value: Awaited<ReturnType<typeof 场景.completeMediaUpload>>) => void;
    场景.completeMediaUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          完成上传 = resolve;
        })
    );

    const 上传成功任务 = 场景.默认上传器.触发上传成功("att-complete-ok.jpg");

    await vi.waitFor(() => {
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-complete-ok.jpg",
          status: "processing",
        }),
      ]);
    });

    完成上传({
      attachment_id: "att-complete-ok.jpg",
      kind: "image",
      mime_type: "image/jpeg",
      byte_size: 3,
      width: 120,
      height: 90,
      status: "ready",
    });
    await 上传成功任务;

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
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传成功("att-complete-failed.jpg");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-complete-failed.jpg",
        status: "failed",
        errorCode: "system_error",
      }),
    ]);
  });

  it("upload-error 会把 transporting / processing 草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "xhr-error.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传错误(
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

  it("选视频后会先走媒体 prepare 再写入 transporting 视频草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith("video", "s-test", sourceFile);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.mp4",
        kind: "video",
        attachmentId: "att-picked.mp4",
        status: "transporting",
        width: 1280,
        height: 720,
      }),
    ]);
  });

  it("大视频会走高吞吐 uploader profile，小文件继续走默认 profile", async () => {
    const 场景 = 创建场景();
    const imageFile = new File([new Uint8Array([1, 2, 3])], "small.jpg", {
      type: "image/jpeg",
    });
    const smallVideo = new File([new Uint8Array([1, 2, 3])], "small.mp4", {
      type: "video/mp4",
    });
    const largeVideo = 创建指定大小文件(
      "large.mp4",
      "video/mp4",
      大视频高吞吐阈值字节数
    );

    await 场景.发布器.处理选择媒体文件([imageFile, smallVideo, largeVideo]);

    expect(场景.createUploaderCalls).toEqual([
      {
        tusEndpoint: "http://storage.local/files",
        profile: "default",
        attachmentId: "att-small.jpg",
        uploadSessionId: "upl-small.jpg",
      },
      {
        tusEndpoint: "http://storage.local/files",
        profile: "large-video",
        attachmentId: "att-large.mp4",
        uploadSessionId: "upl-large.mp4",
      },
    ]);
    expect(场景.默认上传器.addFileCalls.map((item) => item.id)).toEqual([
      "att-small.jpg",
      "att-small.mp4",
    ]);
    expect(场景.大视频上传器.addFileCalls.map((item) => item.id)).toEqual([
      "att-large.mp4",
    ]);
  });

  it("视频 upload-success 后 complete 成功，草稿会变成 ready 视频", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);
    await 场景.默认上传器.触发上传成功("att-clip.mp4");

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
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传停滞("att-stalled.jpg");

    expect(场景.默认上传器.removeFileCalls).toEqual(["att-stalled.jpg"]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-stalled.jpg",
        status: "failed",
        errorCode: "attachment_upload_stalled",
      }),
    ]);
  });

  it("没有 upload-progress 时不会再被本地 watchdog 误杀", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "slow.mp4", {
      type: "video/mp4",
    });
    vi.useFakeTimers();
    try {
      await 场景.发布器.处理选择媒体文件([sourceFile]);
      await vi.advanceTimersByTimeAsync(16_000);

      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-slow.mp4",
          status: "transporting",
        }),
      ]);
      expect(场景.默认上传器.removeFileCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("重试失败草稿时若底层上传器分配了新 localId，不会留下旧草稿幽灵副本", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "retry.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-retry.jpg", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    场景.默认上传器.静默丢弃文件("att-retry.jpg");
    场景.prepareMediaUpload.mockResolvedValueOnce({
      attachment_id: "att-retry-second",
      upload_session_id: "upl-retry-second",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer media-upload-token" },
      tus_metadata: {
        attachment_id: "att-retry-second",
        upload_session_id: "upl-retry-second",
        file_name: sourceFile.name,
        mime_type: sourceFile.type,
        byte_size: String(sourceFile.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    });
    场景.默认上传器.nextAddFileReturnedId = "uppy-retry-second-local-id";

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("att-retry.jpg");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "uppy-retry-second-local-id",
        attachmentId: "att-retry-second",
        status: "transporting",
        errorCode: "",
      }),
    ]);
  });

  it("继续上传失败草稿时会复用旧 attachmentId，不会重新 prepare", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "resume.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-resume.jpg", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });

    await (
      场景.发布器 as unknown as {
        继续上传草稿(localId: string): Promise<void>;
      }
    ).继续上传草稿("att-resume.jpg");

    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(1);
    expect(场景.默认上传器.retryUploadCalls).toEqual(["att-resume.jpg"]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-resume.jpg",
        attachmentId: "att-resume.jpg",
        status: "transporting",
      }),
    ]);
  });

  it("重新上传失败草稿时会明确走新一轮 prepare 并拿到新的 attachmentId", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "restart.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-restart.jpg", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    场景.默认上传器.静默丢弃文件("att-restart.jpg");
    场景.prepareMediaUpload.mockResolvedValueOnce({
      attachment_id: "att-restart-second",
      upload_session_id: "upl-restart-second",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer media-upload-token" },
      tus_metadata: {
        attachment_id: "att-restart-second",
        upload_session_id: "upl-restart-second",
        file_name: sourceFile.name,
        mime_type: sourceFile.type,
        byte_size: String(sourceFile.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    });

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("att-restart.jpg");

    expect(场景.abandonMediaUpload).toHaveBeenCalledWith("s-test", "att-restart.jpg");
    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(2);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        attachmentId: "att-restart-second",
        status: "transporting",
        errorCode: "",
      }),
    ]);
  });

  it("重新上传附件占位失败草稿时，若旧 attachmentId 为空则不会伪造 abandon 调用", async () => {
    const 场景 = 创建场景();
    场景.drafts.writeDraft({
      localId: "failed-no-attachment",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:no-attachment",
      width: 0,
      height: 0,
      status: "failed",
      fileName: "fallback.jpg",
      errorCode: "attachment_upload_failed",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "fallback.jpg", {
        type: "image/jpeg",
      }),
    });

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("failed-no-attachment");

    expect(场景.abandonMediaUpload).not.toHaveBeenCalled();
    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(1);
  });
});
