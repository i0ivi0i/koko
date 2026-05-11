import type { 媒体附件上传结果 } from "../聊天共享/契约.js";
import type { 媒体附件草稿 } from "./媒体草稿.js";
import type {
  媒体上传器,
  媒体上传器创建参数,
  媒体上传文件,
  媒体上传响应体,
} from "./媒体发布.js";
import {
  记录媒体上传失败诊断,
  解析媒体上传失败代码,
  解析传输错误代码,
  type 媒体上传失败响应,
} from "./媒体诊断.js";
import {
  默认文件名,
  构造媒体上传器键,
  提取媒体附件标识,
  读取媒体种类,
  读取本地预览地址,
  读取预览宽高,
  type 媒体发布器依赖,
} from "./媒体发布基础语义.js";

export type 媒体上传事件接线依赖 = {
  读取媒体草稿(localId: string): 媒体附件草稿 | undefined;
  读取草稿所属上传器(localId: string): 媒体上传器 | null;
  createUploader(input: 媒体上传器创建参数): 媒体上传器;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  getSessionId(): string;
  createPreviewUrl(file: Blob | null): string;
  writeDraft: 媒体发布器依赖["writeDraft"];
  updateDraft: 媒体发布器依赖["updateDraft"];
  removeDraft: 媒体发布器依赖["removeDraft"];
  上传器表: Map<string, 媒体上传器>;
  草稿上传器键表: Map<string, string>;
  /** complete 成功后 fire-and-forget 预取 locator，让发送者视频秒播。 */
  预取媒体定位?(attachmentId: string): void;
};

/**
 * 这一组 helper 只拥有“Uppy/Tus 事件如何收口回草稿状态”：
 * - added / success / error / removed / stalled 五种 transport 事实；
 * - 一个显式的 ensureUploader 装配入口；
 * - 不碰 source_hash 预检，也不碰 restart/continue 草稿恢复。
 */
function 处理媒体上传新增事件(
  deps: 媒体上传事件接线依赖,
  uploaderKey: string,
  file: 媒体上传文件
): void {
  const sourceFile = file.data instanceof File ? file.data : null;
  const kind = 读取媒体种类(file);
  const previewSize = 读取预览宽高(file);
  deps.草稿上传器键表.set(file.id, uploaderKey);
  deps.writeDraft({
    localId: file.id,
    kind,
    attachmentId: 提取媒体附件标识(file),
    previewUrl: 读取本地预览地址(file, deps.createPreviewUrl),
    width: previewSize.width,
    height: previewSize.height,
    status: "transporting",
    fileName: file.name ?? 默认文件名(kind),
    errorCode: "",
    sourceFile,
  });
}

async function 处理媒体上传成功事件(
  deps: 媒体上传事件接线依赖,
  uploaderKey: string,
  file: 媒体上传文件 | undefined,
  _response: { body?: 媒体上传响应体 } | undefined
): Promise<void> {
  if (!file) {
    return;
  }
  deps.草稿上传器键表.set(file.id, uploaderKey);
  const attachmentId = 提取媒体附件标识(file) || deps.读取媒体草稿(file.id)?.attachmentId || "";
  if (!attachmentId) {
    deps.updateDraft(file.id, {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    return;
  }
  const currentDraft = deps.读取媒体草稿(file.id);
  if (!currentDraft || currentDraft.status !== "transporting") {
    return;
  }
  deps.updateDraft(file.id, {
    status: "processing",
    errorCode: "",
  });
  try {
    const ready = await deps.completeMediaUpload(deps.getSessionId(), attachmentId);
    const processedDraft = deps.读取媒体草稿(file.id);
    if (!processedDraft || processedDraft.status !== "processing") {
      return;
    }
    deps.updateDraft(file.id, {
      kind: ready.kind,
      attachmentId: ready.attachment_id,
      width: ready.width,
      height: ready.height,
      status: "ready",
      errorCode: "",
    });
    // complete 成功后 fire-and-forget 预取 locator：
    // 用户还在看 composer，发送前 locator 缓存已热，视频秒播。
    deps.预取媒体定位?.(ready.attachment_id);
  } catch (error: unknown) {
    const processedDraft = deps.读取媒体草稿(file.id);
    if (
      !processedDraft ||
      (processedDraft.status !== "transporting" && processedDraft.status !== "processing")
    ) {
      return;
    }
    deps.updateDraft(file.id, {
      status: "failed",
      errorCode: 解析传输错误代码(error, "system_error"),
    });
  }
}

function 处理媒体上传失败事件(
  deps: Pick<媒体上传事件接线依赖, "读取媒体草稿" | "updateDraft">,
  file: 媒体上传文件 | undefined,
  error: { message: string },
  response?: 媒体上传失败响应
): void {
  if (!file) {
    return;
  }
  const kind = 读取媒体种类(file);
  const attachmentId = 提取媒体附件标识(file) || deps.读取媒体草稿(file.id)?.attachmentId || "";
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
}

function 处理媒体上传移除事件(
  deps: Pick<媒体上传事件接线依赖, "草稿上传器键表" | "removeDraft">,
  file: 媒体上传文件
): void {
  deps.草稿上传器键表.delete(file.id);
  deps.removeDraft(file.id);
}

function 处理媒体上传卡住事件(
  deps: Pick<
    媒体上传事件接线依赖,
    "读取媒体草稿" | "createPreviewUrl" | "writeDraft" | "上传器表" | "草稿上传器键表"
  >,
  uploaderKey: string,
  _error: { message: string },
  files: 媒体上传文件[]
): void {
  const uploader = deps.上传器表.get(uploaderKey);
  if (!uploader) {
    return;
  }
  for (const file of files) {
    const existingDraft = deps.读取媒体草稿(file.id);
    const sourceFile = file.data instanceof File ? file.data : existingDraft?.sourceFile ?? null;
    const kind = existingDraft?.kind ?? 读取媒体种类(file);
    uploader.removeFile(file.id);
    deps.草稿上传器键表.delete(file.id);
    deps.writeDraft({
      localId: file.id,
      kind,
      attachmentId: "",
      previewUrl: deps.createPreviewUrl(sourceFile),
      width: existingDraft?.width ?? 0,
      height: existingDraft?.height ?? 0,
      status: "failed",
      fileName: file.name ?? existingDraft?.fileName ?? 默认文件名(kind),
      errorCode: "attachment_upload_stalled",
      sourceFile,
    });
  }
}

export function 确保媒体上传器(
  deps: 媒体上传事件接线依赖,
  input: 媒体上传器创建参数
): { key: string; uploader: 媒体上传器 } {
  const key = 构造媒体上传器键(input);
  const existingUploader = deps.上传器表.get(key);
  if (existingUploader) {
    return { key, uploader: existingUploader };
  }
  const nextUploader = deps.createUploader(input);
  nextUploader.on("file-added", (file) => 处理媒体上传新增事件(deps, key, file));
  nextUploader.on("upload-success", (file, response) =>
    处理媒体上传成功事件(deps, key, file, response)
  );
  nextUploader.on("upload-error", (file, error, response) =>
    处理媒体上传失败事件(deps, file, error, response)
  );
  nextUploader.on("upload-stalled", (error, files) =>
    处理媒体上传卡住事件(deps, key, error, files)
  );
  nextUploader.on("file-removed", (file) => 处理媒体上传移除事件(deps, file));
  deps.上传器表.set(key, nextUploader);
  return { key, uploader: nextUploader };
}
