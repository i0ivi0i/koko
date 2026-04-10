import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import type { 媒体附件上传结果, 媒体上传准备结果, 媒体种类 } from "../契约.js";
import type { 媒体附件草稿, 媒体草稿状态补丁 } from "./媒体草稿.js";
import {
  创建本地图片预览地址 as 创建本地媒体预览地址,
  准备待上传图片文件,
  可选择图片文件类型,
  图片附件上传上限字节数,
} from "./图片预处理.js";
import {
  可选择视频文件类型,
  读取视频文件元数据,
  视频附件上传上限字节数,
} from "./视频元数据.js";
import {
  记录媒体上传失败诊断,
  解析媒体上传失败代码,
  解析传输错误代码,
  type 媒体上传失败响应,
} from "./媒体诊断.js";

export type 媒体上传Meta = {
  session_id?: string;
  attachment_id?: string;
  attachment_kind?: 媒体种类;
  upload_method?: "PUT";
  upload_url?: string;
  upload_headers_json?: string;
  preview_width?: number;
  preview_height?: number;
};

export type 媒体上传响应体 = Record<string, unknown>;

export type 媒体上传文件 = {
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  data?: unknown;
  meta?: 媒体上传Meta | undefined;
};

export interface 媒体上传器 {
  addFile(input: {
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 媒体上传Meta;
  }): string;
  getFile(id: string): 媒体上传文件 | undefined;
  removeFile(id: string): void;
  retryUpload(id: string): Promise<void>;
  cancelAll(): void;
  destroy(): void;
  on(event: string, handler: (...args: Array<any>) => void | Promise<void>): void;
}

export const 媒体上传失活超时毫秒 = 15_000;

type 媒体发布器依赖 = {
  getSessionId(): string;
  prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果>;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  readDrafts(): 媒体附件草稿[];
  writeDraft(draft: 媒体附件草稿): void;
  updateDraft(localId: string, patch: 媒体草稿状态补丁): void;
  removeDraft(localId: string): void;
  clearDrafts(): void;
  createUploader?(): 媒体上传器;
  readVideoMetadata?(file: File): Promise<{ width: number; height: number }>;
  createPreviewUrl?(file: Blob | null): string;
};

function 读取媒体上传头信息(meta: 媒体上传Meta): Record<string, string> {
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

function 读取媒体直传参数(
  file: 媒体上传文件
): { method: "PUT"; url: string; headers: Record<string, string> } | null {
  const meta = (file.meta ?? {}) as 媒体上传Meta;
  if (meta.upload_method !== "PUT" || !meta.upload_url?.trim()) {
    return null;
  }
  return {
    method: "PUT",
    url: meta.upload_url,
    headers: 读取媒体上传头信息(meta),
  };
}

function 提取媒体附件标识(file: 媒体上传文件 | undefined): string {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return typeof meta.attachment_id === "string" ? meta.attachment_id : "";
}

function 读取媒体种类(file: 媒体上传文件 | undefined): 媒体种类 {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return meta.attachment_kind === "video" ? "video" : "image";
}

function 读取预览宽高(file: 媒体上传文件 | undefined): { width: number; height: number } {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return {
    width: typeof meta.preview_width === "number" ? meta.preview_width : 0,
    height: typeof meta.preview_height === "number" ? meta.preview_height : 0,
  };
}

function 读取媒体上传上限(kind: 媒体种类): number {
  return kind === "video" ? 视频附件上传上限字节数 : 图片附件上传上限字节数;
}

function 默认文件名(kind: 媒体种类): string {
  return kind === "video" ? "未命名视频" : "未命名图片";
}

function 创建失败草稿标识(kind: 媒体种类, prefix: string, file: File): string {
  return `${prefix}-${kind}-${file.name}-${file.size}-${file.lastModified}`;
}

/**
 * 生产环境继续直接复用 Uppy + AwsS3。
 * 这里的职责只有“把媒体文件稳定送进 prepare -> PUT -> complete 主链”，
 * 不再额外长第二套私有上传器。
 */
function 创建默认媒体上传器(): 媒体上传器 {
  return new Uppy<媒体上传Meta, 媒体上传响应体>({
    autoProceed: true,
    allowMultipleUploadBatches: true,
    restrictions: {
      maxNumberOfFiles: 9,
      allowedFileTypes: [...可选择图片文件类型, ...可选择视频文件类型],
      maxFileSize: 视频附件上传上限字节数,
    },
  }).use(AwsS3, {
    shouldUseMultipart: false,
    getUploadParameters: async (file) => {
      const parameters = 读取媒体直传参数(file as unknown as 媒体上传文件);
      if (!parameters) {
        throw new Error("attachment_upload_failed");
      }
      return parameters;
    },
  }) as unknown as 媒体上传器;
}

export function 创建媒体发布器(deps: 媒体发布器依赖) {
  const createUploader = deps.createUploader ?? 创建默认媒体上传器;
  const readVideoMetadata = deps.readVideoMetadata ?? 读取视频文件元数据;
  const createPreviewUrl = deps.createPreviewUrl ?? 创建本地媒体预览地址;
  const 上传失活计时器 = new Map<string, ReturnType<typeof setTimeout>>();
  let uploader: 媒体上传器 | null = null;

  const 读取媒体草稿 = (localId: string): 媒体附件草稿 | undefined =>
    deps.readDrafts().find((item) => item.localId === localId);

  const 清理媒体上传失活计时 = (localId: string): void => {
    const timer = 上传失活计时器.get(localId);
    if (timer) {
      clearTimeout(timer);
      上传失活计时器.delete(localId);
    }
  };

  const 处理媒体上传失活 = (localId: string): void => {
    上传失活计时器.delete(localId);
    const draft = 读取媒体草稿(localId);
    if (!draft || draft.status !== "uploading") {
      return;
    }
    const sourceFile = draft.sourceFile ?? null;
    uploader?.removeFile(localId);
    console.warn("[koko:media-upload:watchdog]", {
      localId,
      kind: draft.kind,
      fileName: draft.fileName,
      userAgent: globalThis.navigator?.userAgent ?? "",
      reason: "no_terminal_upload_event",
    });
    deps.writeDraft({
      localId,
      kind: draft.kind,
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

  const 重置媒体上传失活计时 = (localId: string): void => {
    清理媒体上传失活计时(localId);
    上传失活计时器.set(
      localId,
      setTimeout(() => {
        处理媒体上传失活(localId);
      }, 媒体上传失活超时毫秒)
    );
  };

  const 清理全部媒体上传失活计时 = (): void => {
    for (const timer of 上传失活计时器.values()) {
      clearTimeout(timer);
    }
    上传失活计时器.clear();
  };

  /**
   * file-added 是 UI 草稿真正进入“上传中”的唯一时刻。
   * kind / attachment_id / 本地预览都从同一份上传 meta 读取，避免壳层再猜第二遍。
   */
  const handleMediaUploadAdded = (file: 媒体上传文件): void => {
    const sourceFile = file.data instanceof File ? file.data : null;
    const kind = 读取媒体种类(file);
    const previewSize = 读取预览宽高(file);
    deps.writeDraft({
      localId: file.id,
      kind,
      attachmentId: 提取媒体附件标识(file),
      previewUrl: file.data instanceof Blob ? createPreviewUrl(file.data) : "",
      width: previewSize.width,
      height: previewSize.height,
      status: "uploading",
      fileName: file.name ?? 默认文件名(kind),
      errorCode: "",
      sourceFile,
    });
    重置媒体上传失活计时(file.id);
  };

  const handleMediaUploadSuccess = async (
    file: 媒体上传文件 | undefined,
    _response: { body?: 媒体上传响应体 } | undefined
  ): Promise<void> => {
    if (!file) {
      return;
    }
    const attachmentId = 提取媒体附件标识(file) || 读取媒体草稿(file.id)?.attachmentId || "";
    if (!attachmentId) {
      清理媒体上传失活计时(file.id);
      deps.updateDraft(file.id, {
        status: "failed",
        errorCode: "attachment_upload_failed",
      });
      return;
    }
    重置媒体上传失活计时(file.id);
    try {
      const ready = await deps.completeMediaUpload(deps.getSessionId(), attachmentId);
      const currentDraft = 读取媒体草稿(file.id);
      if (!currentDraft || currentDraft.status !== "uploading") {
        return;
      }
      清理媒体上传失活计时(file.id);
      deps.updateDraft(file.id, {
        kind: ready.kind,
        attachmentId: ready.attachment_id,
        width: ready.width,
        height: ready.height,
        status: "ready",
        errorCode: "",
      });
    } catch (error: unknown) {
      const currentDraft = 读取媒体草稿(file.id);
      if (!currentDraft || currentDraft.status !== "uploading") {
        return;
      }
      清理媒体上传失活计时(file.id);
      deps.updateDraft(file.id, {
        status: "failed",
        errorCode: 解析传输错误代码(error, "system_error"),
      });
    }
  };

  const handleMediaUploadError = (
    file: 媒体上传文件 | undefined,
    error: { message: string },
    response?: 媒体上传失败响应
  ): void => {
    if (!file) {
      return;
    }
    清理媒体上传失活计时(file.id);
    const kind = 读取媒体种类(file);
    const attachmentId = 提取媒体附件标识(file) || 读取媒体草稿(file.id)?.attachmentId || "";
    const errorCode = 解析媒体上传失败代码(error, response);
    记录媒体上传失败诊断({
      attachmentId,
      localId: file.id,
      fileName: file.name ?? 默认文件名(kind),
      error,
      response,
      errorCode,
    });
    deps.updateDraft(file.id, {
      status: "failed",
      errorCode,
    });
  };

  const handleMediaUploadRemoved = (file: 媒体上传文件): void => {
    清理媒体上传失活计时(file.id);
    deps.removeDraft(file.id);
  };

  const handleMediaUploadProgress = (file: 媒体上传文件 | undefined): void => {
    if (!file) {
      return;
    }
    重置媒体上传失活计时(file.id);
  };

  /**
   * stalled 事件本身只会告诉我们“这条上传卡住了”，不会把 UI 草稿收口。
   * 这里统一做三件事：
   * 1. 主动移除当前上传文件，触发 Uppy 自己的清理；
   * 2. 立刻补回 failed 草稿，保住预览和重试入口；
   * 3. 不让“上传中”无限挂住，也不让草稿凭空消失。
   */
  const handleMediaUploadStalled = (
    _error: { message: string },
    files: 媒体上传文件[]
  ): void => {
    if (!uploader) {
      return;
    }
    for (const file of files) {
      清理媒体上传失活计时(file.id);
      const existingDraft = 读取媒体草稿(file.id);
      const sourceFile = file.data instanceof File ? file.data : existingDraft?.sourceFile ?? null;
      const kind = existingDraft?.kind ?? 读取媒体种类(file);
      uploader.removeFile(file.id);
      deps.writeDraft({
        localId: file.id,
        kind,
        attachmentId: "",
        previewUrl: createPreviewUrl(sourceFile),
        width: existingDraft?.width ?? 0,
        height: existingDraft?.height ?? 0,
        status: "failed",
        fileName: file.name ?? existingDraft?.fileName ?? 默认文件名(kind),
        errorCode: "attachment_upload_stalled",
        sourceFile,
      });
    }
  };

  const ensureUploader = (): 媒体上传器 => {
    if (uploader) {
      return uploader;
    }
    const nextUploader = createUploader();
    nextUploader.on("file-added", handleMediaUploadAdded);
    nextUploader.on("upload-progress", handleMediaUploadProgress);
    nextUploader.on("upload-success", handleMediaUploadSuccess);
    nextUploader.on("upload-error", handleMediaUploadError);
    nextUploader.on("upload-stalled", handleMediaUploadStalled);
    nextUploader.on("file-removed", handleMediaUploadRemoved);
    uploader = nextUploader;
    return nextUploader;
  };

  /**
   * 各类媒体在进入 Uppy 之前先完成自己最小的本地预处理：
   * - 图片负责 MIME 补全与 HEIC/HEIF 转码；
   * - 视频负责浏览器可读性探测和基础元数据读取。
   *
   * 这样共核编排只消费“已经可以进入上传主链的稳定文件”，
   * 不把图片/视频差异直接塞进后续上传状态机。
   */
  const 准备待上传媒体文件 = async (
    kind: 媒体种类,
    sourceFile: File
  ): Promise<{ file: File; width: number; height: number }> => {
    if (kind === "video") {
      const metadata = await readVideoMetadata(sourceFile);
      return {
        file: sourceFile,
        width: metadata.width,
        height: metadata.height,
      };
    }
    const normalizedFile = await 准备待上传图片文件(sourceFile);
    return {
      file: normalizedFile,
      width: 0,
      height: 0,
    };
  };

  const 写入超限失败草稿 = (kind: 媒体种类, file: File): void => {
    deps.writeDraft({
      localId: 创建失败草稿标识(kind, "too-large", file),
      kind,
      attachmentId: "",
      previewUrl: createPreviewUrl(file),
      width: 0,
      height: 0,
      status: "failed",
      fileName: file.name,
      errorCode: "attachment_too_large",
      sourceFile: file,
    });
  };

  const 处理选择媒体文件 = async (
    kind: 媒体种类,
    files: Iterable<File>
  ): Promise<void> => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) {
      return;
    }
    const currentUploader = ensureUploader();
    const maxFileSize = 读取媒体上传上限(kind);
    for (const sourceFile of selectedFiles) {
      if (sourceFile.size > maxFileSize) {
        写入超限失败草稿(kind, sourceFile);
        continue;
      }
      try {
        const preparedFile = await 准备待上传媒体文件(kind, sourceFile);
        if (preparedFile.file.size > maxFileSize) {
          写入超限失败草稿(kind, preparedFile.file);
          continue;
        }
        const prepared = await deps.prepareMediaUpload(kind, deps.getSessionId(), preparedFile.file);
        currentUploader.addFile({
          // 让 prepared 生成的 attachment_id 直接成为上传文件主键，
          // 可以保证 prepare / PUT / complete / 草稿日志 全部围绕一条真相关联。
          id: prepared.attachment_id,
          name: preparedFile.file.name,
          type: preparedFile.file.type,
          data: preparedFile.file,
          meta: {
            session_id: deps.getSessionId(),
            attachment_id: prepared.attachment_id,
            attachment_kind: kind,
            upload_method: prepared.upload_method,
            upload_url: prepared.upload_url,
            upload_headers_json: JSON.stringify(prepared.upload_headers),
            preview_width: preparedFile.width,
            preview_height: preparedFile.height,
          },
        });
      } catch (error: unknown) {
        deps.writeDraft({
          localId: 创建失败草稿标识(kind, "rejected", sourceFile),
          kind,
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
  };

  return {
    准备选择图片(): void {
      ensureUploader();
    },

    准备选择视频(): void {
      ensureUploader();
    },

    async 处理选择图片文件(files: Iterable<File>): Promise<void> {
      await 处理选择媒体文件("image", files);
    },

    async 处理选择视频文件(files: Iterable<File>): Promise<void> {
      await 处理选择媒体文件("video", files);
    },

    移除草稿(localId: string): void {
      uploader?.removeFile(localId);
      if (!uploader?.getFile(localId)) {
        deps.removeDraft(localId);
      }
    },

    async 重试草稿(localId: string): Promise<void> {
      const currentUploader = ensureUploader();
      const draft = 读取媒体草稿(localId);
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
          const prepared = await deps.prepareMediaUpload(
            draft.kind,
            deps.getSessionId(),
            draft.sourceFile
          );
          currentUploader.addFile({
            id: localId,
            name: draft.fileName,
            type: draft.sourceFile.type,
            data: draft.sourceFile,
            meta: {
              session_id: deps.getSessionId(),
              attachment_id: prepared.attachment_id,
              attachment_kind: draft.kind,
              upload_method: prepared.upload_method,
              upload_url: prepared.upload_url,
              upload_headers_json: JSON.stringify(prepared.upload_headers),
              preview_width: draft.width,
              preview_height: draft.height,
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
      清理全部媒体上传失活计时();
      deps.clearDrafts();
    },

    销毁(): void {
      this.清空();
      uploader?.destroy();
      uploader = null;
    },
  };
}
