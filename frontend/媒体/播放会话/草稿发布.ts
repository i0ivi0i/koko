import type {
  媒体SourceHash信息,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  媒体上传准备结果,
  媒体附件上传结果,
  媒体种类,
} from "../../聊天共享/契约.js";
import { 创建媒体发布器 } from "../媒体发布.js";
import {
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
} from "../媒体草稿.js";

interface 播放会话草稿发布依赖 {
  transport(): {
    prepareMediaUpload(
      kind: 媒体种类,
      sessionId: string,
      file: File,
      sourceHash?: 媒体SourceHash信息
    ): Promise<媒体上传准备结果>;
    reuseMediaBySourceHash(
      kind: 媒体种类,
      input: 媒体SourceHash复用请求
    ): Promise<媒体SourceHash复用结果>;
    abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void>;
    completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  };
  读取会话编号(): string;
  读取当前房间标识?(): string | null;
  读取草稿(): 媒体附件草稿[];
  写入草稿列表(next: 媒体附件草稿[]): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  /** complete 成功后 fire-and-forget 预取 locator，让发送者视频秒播。 */
  预取媒体定位?(attachmentId: string): void;
}

export type 播放会话媒体发布器 = ReturnType<typeof 创建媒体发布器>;

/**
 * 草稿发布 owner 只管理本地草稿列表与上传发布器接线。
 * 后端是否允许复用、上传、完成和放弃，仍由媒体传输背后的 application 裁决。
 */
export function 创建播放会话草稿发布(deps: 播放会话草稿发布依赖) {
  const 写入草稿列表 = (
    nextDrafts: 媒体附件草稿[],
    previewUrlsToRevoke: string[] = []
  ): void => {
    deps.写入草稿列表(nextDrafts);
    deps.回收媒体草稿预览地址(previewUrlsToRevoke);
  };

  const 写入媒体草稿 = (draft: 媒体附件草稿): void => {
    const result = 写入媒体草稿状态(deps.读取草稿(), draft);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 更新媒体草稿状态 = (localId: string, patch: 媒体草稿状态补丁): void => {
    const result = 更新媒体草稿状态值(deps.读取草稿(), localId, patch);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 移除媒体草稿 = (localId: string): void => {
    const result = 移除媒体草稿状态(deps.读取草稿(), localId);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 清空媒体草稿 = (): void => {
    const previewUrls = deps.读取草稿().map((draft) => draft.previewUrl);
    写入草稿列表([], previewUrls);
  };

  return {
    创建媒体发布器(): 播放会话媒体发布器 {
      return 创建媒体发布器({
        getSessionId: () => deps.读取会话编号(),
        getCurrentRoomId: () => deps.读取当前房间标识?.() ?? null,
        reuseMediaBySourceHash: (kind: 媒体种类, input) =>
          deps.transport().reuseMediaBySourceHash(kind, input),
        prepareMediaUpload: (kind, sessionId, file, sourceHash) =>
          deps.transport().prepareMediaUpload(kind, sessionId, file, sourceHash),
        abandonMediaUpload: (sessionId, attachmentId) =>
          deps.transport().abandonMediaUpload(sessionId, attachmentId),
        completeMediaUpload: (sessionId, attachmentId) =>
          deps.transport().completeMediaUpload(sessionId, attachmentId),
        readDrafts: () => deps.读取草稿(),
        writeDraft: 写入媒体草稿,
        updateDraft: 更新媒体草稿状态,
        removeDraft: 移除媒体草稿,
        clearDrafts: 清空媒体草稿,
        ...(deps.预取媒体定位 ? { 预取媒体定位: deps.预取媒体定位 } : {}),
      });
    },

    清空媒体草稿,

    替换媒体草稿列表(drafts: 媒体附件草稿[]): void {
      const 旧草稿预览地址 = deps.读取草稿().map((draft) => draft.previewUrl);
      const 保留中的预览地址 = new Set(drafts.map((draft) => draft.previewUrl));
      const 需要回收的预览地址 = 旧草稿预览地址.filter(
        (previewUrl) => !保留中的预览地址.has(previewUrl)
      );
      写入草稿列表([...drafts], 需要回收的预览地址);
    },
  };
}
