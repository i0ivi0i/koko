import Uppy from "@uppy/core";
import { vi } from "vitest";
import {
创建媒体发布器,
大视频高吞吐阈值字节数,
媒体Tus单请求体分块字节数,
媒体Tus文件并发上限,
媒体Tus重试延迟毫秒数组,
媒体单条消息附件上限,
构造媒体Tus传输选项,
type 媒体上传Meta,
type 媒体上传响应体,
type 媒体上传器,
type 媒体上传文件,
} from "../媒体/媒体发布";
import {
写入媒体草稿,
更新媒体草稿状态,
移除媒体草稿,
type 媒体草稿状态补丁,
type 媒体附件草稿,
} from "../媒体/媒体草稿";
import { 创建传输错误 } from "./common/聊天测试支架";

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

function 模拟浏览器Webp编码(): void {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    }))
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number
      ) {}

      getContext(type: string) {
        return type === "2d" ? { drawImage: vi.fn() } : null;
      }

      async convertToBlob(options: { type: string }) {
        return new Blob([new Uint8Array([9, 8, 7])], { type: options.type });
      }
    }
  );
}

function 创建场景(overrides: {
  preprocessVideo?: (file: File) => Promise<{ file: File; width?: number; height?: number; previewUrl?: string | null }>;
  readVideoMetadata?: (file: File) => Promise<{ width: number; height: number; previewUrl?: string | null }>;
  getCurrentRoomId?: () => string | null;
  calculateSourceHash?: (file: File) => Promise<{
    source_hash: string;
    source_byte_size: number;
    source_file_name?: string;
  }>;
  reuseMediaBySourceHash?: (
    kind: "image" | "video",
    input: {
      session_id: string;
      room_id: string;
      source_hash: string;
      source_byte_size: number;
      source_file_name?: string;
    }
  ) => Promise<
    | { status: "miss" }
    | {
        status: "reused";
        attachment: {
          attachment_id: string;
          kind: "image" | "video";
          mime_type: string;
          byte_size: number;
          width: number;
          height: number;
          status: "ready";
        };
      }
  >;
} = {}) {
  const 默认上传器 = new 假媒体上传器();
  const 大视频上传器 = new 假媒体上传器();
  const drafts = 创建草稿仓库();
  const writeDraft = vi.fn((draft: 媒体附件草稿) => {
    drafts.writeDraft(draft);
  });
  const updateDraft = vi.fn((localId: string, patch: 媒体草稿状态补丁) => {
    drafts.updateDraft(localId, patch);
  });
  const removeDraft = vi.fn((localId: string) => {
    drafts.removeDraft(localId);
  });
  const createUploaderCalls: Array<{
    tusEndpoint?: string;
    profile?: string;
    attachmentId?: string;
    uploadSessionId?: string;
  }> = [];
  const yieldToMainThread = vi.fn(async () => {});
  const calculateSourceHash =
    overrides.calculateSourceHash ??
    vi.fn(async (file: File) => ({
      source_hash: "a".repeat(64),
      source_byte_size: file.size,
      source_file_name: file.name,
    }));
  const reuseMediaBySourceHash =
    overrides.reuseMediaBySourceHash ??
    vi.fn(async () => ({
      status: "miss" as const,
    }));
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
    getCurrentRoomId: overrides.getCurrentRoomId ?? (() => null),
    calculateSourceHash,
    reuseMediaBySourceHash,
    prepareMediaUpload,
    abandonMediaUpload,
    completeMediaUpload,
    readDrafts: drafts.readDrafts,
    writeDraft,
    updateDraft,
    removeDraft,
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
    readVideoMetadata: overrides.readVideoMetadata ?? (async (file) => ({
      width: 1280,
      height: 720,
      previewUrl: `blob:poster-${file.name}`,
    })),
    /**
     * 这是一条面向新视频预制 owner 的测试注入 seam。
     * 当前实现尚未消费它，红测会证明发布器仍会把原始视频直接送进 prepare。
     */
    preprocessVideo: overrides.preprocessVideo,
    createPreviewUrl: (file: Blob | null) => (file instanceof File ? `blob:${file.name}` : file ? "blob:memory" : ""),
    yieldToMainThread,
  } as any);
  return {
    发布器,
    默认上传器,
    大视频上传器,
    drafts,
    prepareMediaUpload,
    calculateSourceHash,
    reuseMediaBySourceHash,
    abandonMediaUpload,
    completeMediaUpload,
    writeDraft,
    updateDraft,
    removeDraft,
    createUploaderCalls,
    yieldToMainThread,
  };
}

export {
Uppy,假媒体上传器,创建传输错误,创建场景,创建媒体发布器,创建指定大小文件,大视频高吞吐阈值字节数,媒体Tus单请求体分块字节数,
媒体Tus文件并发上限,
媒体Tus重试延迟毫秒数组,媒体单条消息附件上限,构造媒体Tus传输选项,模拟浏览器Webp编码
};
export type {
媒体上传Meta,
媒体上传响应体,媒体上传器,
媒体上传文件,媒体草稿状态补丁,媒体附件草稿
};
