import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import type { 图片附件上传结果, 图片上传准备结果 } from "../契约.js";
import type { 图片附件草稿, 图片草稿状态补丁 } from "./图片草稿.js";
import {
  创建本地图片预览地址,
  准备待上传图片文件,
  可选择图片文件类型,
  图片附件上传上限字节数,
} from "./图片预处理.js";
import {
  记录图片上传失败诊断,
  解析图片上传失败代码,
  解析传输错误代码,
  type 图片上传失败响应,
} from "./图片上传诊断.js";

export type 图片上传Meta = {
  session_id?: string;
  attachment_id?: string;
  upload_method?: "PUT";
  upload_url?: string;
  upload_headers_json?: string;
};

export type 图片上传响应体 = Record<string, unknown>;

export type 图片上传文件 = {
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  data?: unknown;
  meta?: 图片上传Meta | undefined;
};

export interface 图片上传器 {
  addFile(input: {
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 图片上传Meta;
  }): string;
  getFile(id: string): 图片上传文件 | undefined;
  removeFile(id: string): void;
  retryUpload(id: string): Promise<void>;
  cancelAll(): void;
  destroy(): void;
  on(event: string, handler: (...args: Array<any>) => void | Promise<void>): void;
}

export const 图片上传失活超时毫秒 = 15_000;

type 图片收发器依赖 = {
  getSessionId(): string;
  prepareImageUpload(sessionId: string, file: File): Promise<图片上传准备结果>;
  completeImageUpload(sessionId: string, attachmentId: string): Promise<图片附件上传结果>;
  readDrafts(): 图片附件草稿[];
  writeDraft(draft: 图片附件草稿): void;
  updateDraft(localId: string, patch: 图片草稿状态补丁): void;
  removeDraft(localId: string): void;
  clearDrafts(): void;
  createUploader?(): 图片上传器;
  normalizeUploadFile?(file: File): Promise<File>;
  createPreviewUrl?(file: Blob | null): string;
};

function 读取图片上传头信息(meta: 图片上传Meta): Record<string, string> {
  if (!meta.upload_headers_json?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(meta.upload_headers_json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        output[key] = value;
      }
    }
    return output;
  } catch {
    return {};
  }
}

function 读取图片直传参数(
  file: 图片上传文件
): { method: "PUT"; url: string; headers: Record<string, string> } | null {
  const meta = (file.meta ?? {}) as 图片上传Meta;
  if (meta.upload_method !== "PUT" || !meta.upload_url?.trim()) {
    return null;
  }
  return {
    method: "PUT",
    url: meta.upload_url,
    headers: 读取图片上传头信息(meta),
  };
}

function 提取图片附件标识(file: 图片上传文件 | undefined): string {
  const meta = (file?.meta ?? {}) as 图片上传Meta;
  return typeof meta.attachment_id === "string" ? meta.attachment_id : "";
}

/**
 * 生产环境继续直接复用 Uppy + AwsS3。
 * 这层模块只负责把 canonical `prepare -> PUT -> complete` 串起来，
 * 不再在壳层里散着维护第二套上传状态机。
 */
function 创建默认图片上传器(): 图片上传器 {
  return new Uppy<图片上传Meta, 图片上传响应体>({
    autoProceed: true,
    allowMultipleUploadBatches: true,
    restrictions: {
      maxNumberOfFiles: 9,
      allowedFileTypes: [...可选择图片文件类型],
      maxFileSize: 图片附件上传上限字节数,
    },
  }).use(AwsS3, {
    shouldUseMultipart: false,
    getUploadParameters: async (file) => {
      const parameters = 读取图片直传参数(file as unknown as 图片上传文件);
      if (!parameters) {
        throw new Error("attachment_upload_failed");
      }
      return parameters;
    },
  }) as unknown as 图片上传器;
}

export function 创建图片收发器(deps: 图片收发器依赖) {
  const createUploader = deps.createUploader ?? 创建默认图片上传器;
  const normalizeUploadFile = deps.normalizeUploadFile ?? 准备待上传图片文件;
  const createPreviewUrl = deps.createPreviewUrl ?? 创建本地图片预览地址;
  const 上传失活计时器 = new Map<string, ReturnType<typeof setTimeout>>();
  let uploader: 图片上传器 | null = null;

  const 读取图片草稿 = (localId: string): 图片附件草稿 | undefined =>
    deps.readDrafts().find((item) => item.localId === localId);

  const 清理图片上传失活计时 = (localId: string): void => {
    const timer = 上传失活计时器.get(localId);
    if (timer) {
      clearTimeout(timer);
      上传失活计时器.delete(localId);
    }
  };

  const 处理图片上传失活 = (localId: string): void => {
    上传失活计时器.delete(localId);
    const draft = 读取图片草稿(localId);
    if (!draft || draft.status !== "uploading") {
      return;
    }
    const sourceFile = draft.sourceFile ?? null;
    uploader?.removeFile(localId);
    console.warn("[koko:image-upload:watchdog]", {
      localId,
      fileName: draft.fileName,
      userAgent: globalThis.navigator?.userAgent ?? "",
      reason: "no_terminal_upload_event",
    });
    deps.writeDraft({
      localId,
      attachmentId: "",
      previewUrl: createPreviewUrl(sourceFile),
      width: draft.width,
      height: draft.height,
      status: "failed",
      fileName: draft.fileName,
      errorCode: "attachment_upload_stalled",
      sourceFile,
    });
  };

  const 重置图片上传失活计时 = (localId: string): void => {
    清理图片上传失活计时(localId);
    上传失活计时器.set(
      localId,
      setTimeout(() => {
        处理图片上传失活(localId);
      }, 图片上传失活超时毫秒)
    );
  };

  const 清理全部图片上传失活计时 = (): void => {
    for (const timer of 上传失活计时器.values()) {
      clearTimeout(timer);
    }
    上传失活计时器.clear();
  };

  const handleImageUploadAdded = (file: 图片上传文件): void => {
    const sourceFile = file.data instanceof File ? file.data : null;
    deps.writeDraft({
      localId: file.id,
      attachmentId: 提取图片附件标识(file),
      previewUrl: file.data instanceof Blob ? createPreviewUrl(file.data) : "",
      width: 0,
      height: 0,
      status: "uploading",
      fileName: file.name ?? "未命名图片",
      errorCode: "",
      sourceFile,
    });
    重置图片上传失活计时(file.id);
  };

  const handleImageUploadSuccess = async (
    file: 图片上传文件 | undefined,
    _response: { body?: 图片上传响应体 } | undefined
  ): Promise<void> => {
    if (!file) {
      return;
    }
    const attachmentId = 提取图片附件标识(file) || 读取图片草稿(file.id)?.attachmentId || "";
    if (!attachmentId) {
      清理图片上传失活计时(file.id);
      deps.updateDraft(file.id, {
        status: "failed",
        errorCode: "attachment_upload_failed",
      });
      return;
    }
    重置图片上传失活计时(file.id);
    try {
      const ready = await deps.completeImageUpload(deps.getSessionId(), attachmentId);
      const currentDraft = 读取图片草稿(file.id);
      if (!currentDraft || currentDraft.status !== "uploading") {
        return;
      }
      清理图片上传失活计时(file.id);
      deps.updateDraft(file.id, {
        attachmentId: ready.attachment_id,
        width: ready.width,
        height: ready.height,
        status: "ready",
        errorCode: "",
      });
    } catch (error: unknown) {
      const currentDraft = 读取图片草稿(file.id);
      if (!currentDraft || currentDraft.status !== "uploading") {
        return;
      }
      清理图片上传失活计时(file.id);
      deps.updateDraft(file.id, {
        status: "failed",
        errorCode: 解析传输错误代码(error, "system_error"),
      });
    }
  };

  const handleImageUploadError = (
    file: 图片上传文件 | undefined,
    error: { message: string },
    response?: 图片上传失败响应
  ): void => {
    if (!file) {
      return;
    }
    清理图片上传失活计时(file.id);
    const attachmentId = 提取图片附件标识(file) || 读取图片草稿(file.id)?.attachmentId || "";
    const errorCode = 解析图片上传失败代码(error, response);
    记录图片上传失败诊断({
      attachmentId,
      localId: file.id,
      fileName: file.name ?? "未命名图片",
      error,
      response,
      errorCode,
    });
    deps.updateDraft(file.id, {
      status: "failed",
      errorCode,
    });
  };

  const handleImageUploadRemoved = (file: 图片上传文件): void => {
    清理图片上传失活计时(file.id);
    deps.removeDraft(file.id);
  };

  const handleImageUploadProgress = (file: 图片上传文件 | undefined): void => {
    if (!file) {
      return;
    }
    重置图片上传失活计时(file.id);
  };

  /**
   * stalled 事件本身只会告诉我们“这条上传卡住了”，不会把 UI 草稿收口。
   * 这里统一做三件事：
   * 1. 主动移除当前上传文件，触发 Uppy 自己的清理；
   * 2. 立刻补回 failed 草稿，保住预览和重试入口；
   * 3. 不让“上传中”无限挂住，也不让草稿凭空消失。
   */
  const handleImageUploadStalled = (
    _error: { message: string },
    files: 图片上传文件[]
  ): void => {
    if (!uploader) {
      return;
    }
    for (const file of files) {
      清理图片上传失活计时(file.id);
      const existingDraft = 读取图片草稿(file.id);
      const sourceFile = file.data instanceof File ? file.data : existingDraft?.sourceFile ?? null;
      uploader.removeFile(file.id);
      deps.writeDraft({
        localId: file.id,
        attachmentId: "",
        previewUrl: createPreviewUrl(sourceFile),
        width: existingDraft?.width ?? 0,
        height: existingDraft?.height ?? 0,
        status: "failed",
        fileName: file.name ?? existingDraft?.fileName ?? "未命名图片",
        errorCode: "attachment_upload_stalled",
        sourceFile,
      });
    }
  };

  const ensureUploader = (): 图片上传器 => {
    if (uploader) {
      return uploader;
    }
    const nextUploader = createUploader();
    nextUploader.on("file-added", handleImageUploadAdded);
    nextUploader.on("upload-progress", handleImageUploadProgress);
    nextUploader.on("upload-success", handleImageUploadSuccess);
    nextUploader.on("upload-error", handleImageUploadError);
    nextUploader.on("upload-stalled", handleImageUploadStalled);
    nextUploader.on("file-removed", handleImageUploadRemoved);
    uploader = nextUploader;
    return nextUploader;
  };

  return {
    准备选择图片(): void {
      ensureUploader();
    },

    async 处理选择文件(files: Iterable<File>): Promise<void> {
      const selectedFiles = Array.from(files);
      if (selectedFiles.length === 0) {
        return;
      }
      const currentUploader = ensureUploader();
      for (const sourceFile of selectedFiles) {
        if (sourceFile.size > 图片附件上传上限字节数) {
          deps.writeDraft({
            localId: `too-large-${sourceFile.name}-${sourceFile.size}-${sourceFile.lastModified}`,
            attachmentId: "",
            previewUrl: createPreviewUrl(sourceFile),
            width: 0,
            height: 0,
            status: "failed",
            fileName: sourceFile.name,
            errorCode: "attachment_too_large",
            sourceFile,
          });
          continue;
        }
        try {
          const file = await normalizeUploadFile(sourceFile);
          if (file.size > 图片附件上传上限字节数) {
            deps.writeDraft({
              localId: `too-large-${file.name}-${file.size}-${file.lastModified}`,
              attachmentId: "",
              previewUrl: createPreviewUrl(file),
              width: 0,
              height: 0,
              status: "failed",
              fileName: file.name,
              errorCode: "attachment_too_large",
              sourceFile: file,
            });
            continue;
          }
          const prepared = await deps.prepareImageUpload(deps.getSessionId(), file);
          currentUploader.addFile({
            // 让 prepared 生成的 attachment_id 直接成为上传文件主键，
            // 可以保证 prepare / PUT / complete / 草稿日志 全部围绕一条真相关联。
            id: prepared.attachment_id,
            name: file.name,
            type: file.type,
            data: file,
            meta: {
              session_id: deps.getSessionId(),
              attachment_id: prepared.attachment_id,
              upload_method: prepared.upload_method,
              upload_url: prepared.upload_url,
              upload_headers_json: JSON.stringify(prepared.upload_headers),
            },
          });
        } catch (error: unknown) {
          deps.writeDraft({
            localId: `rejected-${sourceFile.name}-${sourceFile.size}-${sourceFile.lastModified}`,
            attachmentId: "",
            previewUrl: createPreviewUrl(sourceFile),
            width: 0,
            height: 0,
            status: "failed",
            fileName: sourceFile.name,
            errorCode: 解析传输错误代码(error),
            sourceFile,
          });
        }
      }
    },

    移除草稿(localId: string): void {
      uploader?.removeFile(localId);
      if (!uploader?.getFile(localId)) {
        deps.removeDraft(localId);
      }
    },

    async 重试草稿(localId: string): Promise<void> {
      const currentUploader = ensureUploader();
      const draft = 读取图片草稿(localId);
      if (!draft) {
        return;
      }
      deps.updateDraft(localId, {
        attachmentId: "",
        status: "uploading",
        errorCode: "",
      });
      if (!currentUploader.getFile(localId)) {
        if (!draft.sourceFile) {
          deps.updateDraft(localId, {
            status: "failed",
            errorCode: "attachment_upload_failed",
          });
          return;
        }
        try {
          const prepared = await deps.prepareImageUpload(deps.getSessionId(), draft.sourceFile);
          currentUploader.addFile({
            id: localId,
            name: draft.fileName,
            type: draft.sourceFile.type,
            data: draft.sourceFile,
            meta: {
              session_id: deps.getSessionId(),
              attachment_id: prepared.attachment_id,
              upload_method: prepared.upload_method,
              upload_url: prepared.upload_url,
              upload_headers_json: JSON.stringify(prepared.upload_headers),
            },
          });
        } catch (error: unknown) {
          deps.updateDraft(localId, {
            status: "failed",
            errorCode: 解析传输错误代码(error),
          });
        }
        return;
      }
      void currentUploader.retryUpload(localId).catch((error: unknown) => {
        deps.updateDraft(localId, {
          status: "failed",
          errorCode: 解析传输错误代码(error),
        });
      });
    },

    清空(): void {
      uploader?.cancelAll();
      清理全部图片上传失活计时();
      deps.clearDrafts();
    },

    销毁(): void {
      this.清空();
      uploader?.destroy();
      uploader = null;
    },
  };
}
