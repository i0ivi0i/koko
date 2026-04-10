/**
 * 媒体草稿只表达前端发送区的本地体验态：
 * 1. 上传进度、失败码、预览地址都留在这里；
 * 2. 真正可发送时只认 ready + attachmentId；
 * 3. 模块只做纯状态演算，不碰 DOM、不碰 URL API、不碰壳层副作用。
 */
export interface 媒体附件草稿 {
  localId: string;
  kind: "image" | "video";
  attachmentId: string;
  previewUrl: string;
  width: number;
  height: number;
  status: "uploading" | "ready" | "failed";
  fileName: string;
  errorCode: string;
  /**
   * 失败重试仍然属于壳层本地体验态，所以只在草稿里短暂保留源文件。
   * 它不能越过壳层边界进入共享 contract。
   */
  sourceFile?: File | null;
}

export type 媒体草稿状态补丁 = Partial<Omit<媒体附件草稿, "localId" | "fileName">> & {
  fileName?: string;
};

export type 媒体草稿状态结果 = {
  草稿列表: 媒体附件草稿[];
  需要回收的预览地址: string[];
};

function 需要回收旧预览地址(current: string, next?: string): string[] {
  if (!current || current === next) {
    return [];
  }
  return [current];
}

export function 提取可发送媒体附件标识(草稿列表: 媒体附件草稿[]): string[] | null {
  if (草稿列表.length === 0) {
    return [];
  }
  /**
   * 发送命令不能静默吞掉仍在上传或已经失败的媒体。
   * 这里宁可阻止发送，也不制造“文本发出去了，但附件被悄悄丢了”的假成功。
   */
  if (草稿列表.some((draft) => draft.status !== "ready" || !draft.attachmentId)) {
    return null;
  }
  return 草稿列表.map((draft) => draft.attachmentId);
}

export function 写入媒体草稿(
  当前草稿列表: 媒体附件草稿[],
  草稿: 媒体附件草稿
): 媒体草稿状态结果 {
  const existing = 当前草稿列表.find((item) => item.localId === 草稿.localId);
  return {
    草稿列表: [
      ...当前草稿列表.filter((item) => item.localId !== 草稿.localId),
      草稿,
    ],
    需要回收的预览地址: existing
      ? 需要回收旧预览地址(existing.previewUrl, 草稿.previewUrl)
      : [],
  };
}

export function 更新媒体草稿状态(
  当前草稿列表: 媒体附件草稿[],
  localId: string,
  patch: 媒体草稿状态补丁
): 媒体草稿状态结果 {
  let 需要回收的预览地址: string[] = [];
  return {
    草稿列表: 当前草稿列表.map((draft) => {
      if (draft.localId !== localId) {
        return draft;
      }
      if (typeof patch.previewUrl === "string") {
        需要回收的预览地址 = 需要回收旧预览地址(draft.previewUrl, patch.previewUrl);
      }
      return {
        ...draft,
        ...patch,
      };
    }),
    需要回收的预览地址,
  };
}

export function 移除媒体草稿(
  当前草稿列表: 媒体附件草稿[],
  localId: string
): 媒体草稿状态结果 {
  const target = 当前草稿列表.find((draft) => draft.localId === localId);
  return {
    草稿列表: 当前草稿列表.filter((draft) => draft.localId !== localId),
    需要回收的预览地址: target?.previewUrl ? [target.previewUrl] : [],
  };
}
