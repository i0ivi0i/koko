import type {
  媒体附件上传结果,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  媒体SourceHash信息,
  媒体上传准备结果,
  媒体种类,
} from "../聊天共享/契约.js";
import type { 媒体附件草稿, 媒体草稿状态补丁 } from "./媒体草稿.js";
import { 图片附件上传上限字节数, 推导图片Mime类型 } from "./图片预处理.js";
import { 视频附件上传上限字节数 } from "./视频元数据.js";
import type { 视频预处理结果 } from "./视频预处理.js";
import { 计算源文件SHA256经Worker } from "./源文件哈希.js";
import type {
  媒体上传Meta,
  媒体上传器,
  媒体上传器创建参数,
  媒体上传文件,
} from "./媒体发布.js";

/**
 * 发布器依赖只描述外部端口，不拥有上传流程。
 * 这样测试、壳层和真实 Uppy/Tus 适配都只能从同一份端口进入，不会绕开 prepare/complete 主链。
 */
export type 媒体发布器依赖 = {
  getSessionId(): string;
  getCurrentRoomId?(): string | null;
  calculateSourceHash?(file: File): Promise<媒体SourceHash信息>;
  reuseMediaBySourceHash?(
    kind: 媒体种类,
    input: 媒体SourceHash复用请求
  ): Promise<媒体SourceHash复用结果>;
  prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File,
    sourceHash?: 媒体SourceHash信息
  ): Promise<媒体上传准备结果>;
  abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void>;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  readDrafts(): 媒体附件草稿[];
  writeDraft(draft: 媒体附件草稿): void;
  updateDraft(localId: string, patch: 媒体草稿状态补丁): void;
  removeDraft(localId: string): void;
  clearDrafts(): void;
  createUploader?(input: 媒体上传器创建参数): 媒体上传器;
  readVideoMetadata?(file: File): Promise<{
    width: number;
    height: number;
    previewUrl?: string | null;
  }>;
  preprocessVideo?(file: File): Promise<
    视频预处理结果 & {
      width?: number;
      height?: number;
      previewUrl?: string | null;
    }
  >;
  createPreviewUrl?(file: Blob | null): string;
  yieldToMainThread?(): Promise<void>;
  /** complete 成功后 fire-and-forget 预取 locator，让发送者视频秒播。 */
  预取媒体定位?(attachmentId: string): void;
};

export const 大视频高吞吐阈值字节数 = 32 * 1024 * 1024;

export function 读取媒体Tus请求头(meta: 媒体上传Meta): Record<string, string> {
  if (!meta.tus_headers_json?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(meta.tus_headers_json) as unknown;
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

export function 提取媒体附件标识(file: 媒体上传文件 | undefined): string {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return typeof meta.attachment_id === "string" ? meta.attachment_id : "";
}

export function 读取媒体种类(file: 媒体上传文件 | undefined): 媒体种类 {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return meta.attachment_kind === "video" ? "video" : "image";
}

export function 读取预览宽高(file: 媒体上传文件 | undefined): { width: number; height: number } {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  return {
    width: typeof meta.preview_width === "number" ? meta.preview_width : 0,
    height: typeof meta.preview_height === "number" ? meta.preview_height : 0,
  };
}

export function 读取本地预览地址(
  file: 媒体上传文件 | undefined,
  createPreviewUrl: (file: Blob | null) => string
): string {
  const meta = (file?.meta ?? {}) as 媒体上传Meta;
  if (typeof meta.local_preview_url === "string" && meta.local_preview_url.trim()) {
    return meta.local_preview_url;
  }
  return file?.data instanceof Blob ? createPreviewUrl(file.data) : "";
}

export function 读取媒体上传上限(kind: 媒体种类): number {
  return kind === "video" ? 视频附件上传上限字节数 : 图片附件上传上限字节数;
}

/**
 * 统一附件入口先判断“这是不是我们认识的媒体”，再决定走哪条最小预处理分支。
 * 图片复用既有 MIME 推导，视频继续信任浏览器给出的 `video/*`，未知文件明确拒绝。
 */
export function 识别待上传媒体种类(file: File): 媒体种类 | null {
  const normalizedType = file.type.trim().toLowerCase();
  if (normalizedType.startsWith("image/")) {
    return "image";
  }
  if (normalizedType.startsWith("video/")) {
    return "video";
  }
  return 推导图片Mime类型(file).startsWith("image/") ? "image" : null;
}

export function 默认文件名(kind: 媒体种类): string {
  return kind === "video" ? "未命名视频" : "未命名图片";
}

export function 读取媒体上传档位(kind: 媒体种类, file: File): "default" | "large-video" {
  return kind === "video" && file.size >= 大视频高吞吐阈值字节数 ? "large-video" : "default";
}

export function 构造媒体上传器键(input: 媒体上传器创建参数): string {
  /**
   * default 档位仍然可以按 endpoint 复用上传器；
   * large-video 的 partial metadata 绑定到单个 attachment/session，不能让多个大视频共用 uploader。
   */
  if (input.profile === "large-video") {
    return `${input.profile}@${input.tusEndpoint}@${input.uploadSessionId ?? "missing-session"}`;
  }
  return `${input.profile}@${input.tusEndpoint}`;
}

export async function 默认计算源文件SourceHash(file: File): Promise<媒体SourceHash信息> {
  const result = await 计算源文件SHA256经Worker(file);
  const info: 媒体SourceHash信息 = {
    source_hash: result.sourceHash,
    source_byte_size: result.sourceByteSize,
  };
  if (result.sourceFileName.trim()) {
    info.source_file_name = result.sourceFileName;
  }
  return info;
}

export function 构造SourceHash复用请求(input: {
  sessionId: string;
  roomId: string;
  sourceHash: 媒体SourceHash信息;
}): 媒体SourceHash复用请求 {
  const request: 媒体SourceHash复用请求 = {
    session_id: input.sessionId,
    room_id: input.roomId,
    source_hash: input.sourceHash.source_hash,
    source_byte_size: input.sourceHash.source_byte_size,
  };
  if (input.sourceHash.source_file_name?.trim()) {
    request.source_file_name = input.sourceHash.source_file_name;
  }
  return request;
}

export function 构造媒体上传Meta(input: {
  sessionId: string;
  kind: 媒体种类;
  prepared: 媒体上传准备结果;
  previewWidth: number;
  previewHeight: number;
  localPreviewUrl?: string;
}): 媒体上传Meta {
  const { sessionId, kind, prepared, previewWidth, previewHeight, localPreviewUrl } = input;
  const meta: 媒体上传Meta = {
    session_id: sessionId,
    attachment_id: prepared.attachment_id,
    upload_session_id: prepared.upload_session_id,
    attachment_kind: kind,
    relativePath: prepared.attachment_id,
    upload_method: prepared.upload_method,
    tus_endpoint: prepared.tus_endpoint,
    tus_headers_json: JSON.stringify(prepared.tus_headers),
    preview_width: previewWidth,
    preview_height: previewHeight,
  };
  if (typeof localPreviewUrl === "string" && localPreviewUrl.trim()) {
    meta.local_preview_url = localPreviewUrl;
  }
  if (typeof prepared.tus_metadata.file_name === "string") {
    meta.file_name = prepared.tus_metadata.file_name;
  }
  if (typeof prepared.tus_metadata.mime_type === "string") {
    meta.mime_type = prepared.tus_metadata.mime_type;
  }
  if (typeof prepared.tus_metadata.byte_size === "string") {
    meta.byte_size = prepared.tus_metadata.byte_size;
  }
  return meta;
}

export function 创建失败草稿标识(kind: 媒体种类, prefix: string, file: File): string {
  return `${prefix}-${kind}-${file.name}-${file.size}-${file.lastModified}`;
}
