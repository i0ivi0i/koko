import type { 消息事件, 媒体种类 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";
import {
  创建媒体定位器,
  创建媒体播放器,
  创建媒体发布器,
  创建媒体查看器,
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  解析协作分发源,
  type 媒体附件草稿,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
  type 媒体播放结果,
} from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 附件内容地址快照 = {
  originalSrc: string;
  thumbnailSrc: string;
};

export type 聊天媒体快照 = {
  playbackByAttachmentId: Record<string, 媒体播放结果>;
  contentUrlByAttachmentId: Record<string, 附件内容地址快照>;
};

type 聊天媒体编排依赖 = {
  transport(): 前端传输端口;
  读取会话编号(): string;
  读取消息(): 消息事件[];
  读取草稿(): 媒体附件草稿[];
  写入草稿列表(next: 媒体附件草稿[]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: 程序滚动来源): void;
  清除程序滚动来源(source: 程序滚动来源): void;
};

export interface 聊天媒体编排端口 {
  snapshot(): 聊天媒体快照;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  移除媒体草稿(localId: string): void;
  重试媒体草稿(localId: string): Promise<void>;
  清空草稿(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步消息附件播放结果(): void;
  清空(): void;
  销毁(): void;
  设置媒体播放器供测试(player: {
    解析播放结果(input: { attachmentId: string; kind: "image" | "video" }): Promise<媒体播放结果>;
  }): void;
  设置媒体查看器供测试(viewer: { 打开(input: 媒体查看器打开请求): void; 销毁(): void }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    重试草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
}

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

/**
 * 聊天媒体编排只拥有“浏览器端媒体体验真相”：
 * - 上传草稿属于本地体验态；
 * - 播放结果属于浏览器端解析态；
 * - 查看器开关和视口占用属于前端交互编排。
 *
 * 它不拥有聊天时间线真相，也不直接暴露 transport。
 */
export function 创建聊天媒体编排(deps: 聊天媒体编排依赖): 聊天媒体编排端口 {
  const 媒体定位器 = 创建媒体定位器({
    getSessionId: () => deps.读取会话编号(),
    loadMediaLocator: (sessionId, attachmentId) =>
      deps.transport().loadMediaLocator(sessionId, attachmentId),
  });

  let 媒体播放器 = 创建媒体播放器({
    locate: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    resolveSwarmSource: 解析协作分发源,
  });

  let 媒体查看器 = 创建媒体查看器({
    onViewportCaptureEnd: () => {
      deps.清除程序滚动来源("media_viewer_open");
    },
  });

  let 媒体播放结果表: Record<string, 媒体播放结果> = {};
  const 正在解析媒体播放 = new Map<string, Promise<void>>();

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

  let 媒体发布器 = 创建媒体发布器({
    getSessionId: () => deps.读取会话编号(),
    prepareMediaUpload: (kind, sessionId, file) =>
      deps.transport().prepareMediaUpload(kind, sessionId, file),
    completeMediaUpload: (sessionId, attachmentId) =>
      deps.transport().completeMediaUpload(sessionId, attachmentId),
    readDrafts: () => deps.读取草稿(),
    writeDraft: 写入媒体草稿,
    updateDraft: 更新媒体草稿状态,
    removeDraft: 移除媒体草稿,
    clearDrafts: 清空媒体草稿,
  });

  const 读取当前房间媒体附件 = (): 媒体附件条目[] => {
    const seen = new Set<string>();
    const attachments: 媒体附件条目[] = [];
    for (const message of deps.读取消息()) {
      for (const attachment of message.attachments ?? []) {
        if (seen.has(attachment.attachment_id)) {
          continue;
        }
        seen.add(attachment.attachment_id);
        attachments.push({
          attachmentId: attachment.attachment_id,
          kind: attachment.kind,
        });
      }
    }
    return attachments;
  };

  /**
   * 附件内容地址属于“当前会话下可访问的媒体资源定位结果”。
   * 这里按当前时间线里的附件集合现算现给，目的有两个：
   * 1. 壳层 presenter 只消费 snapshot 里的纯数据，不再回调内核 helper；
   * 2. URL 仍然只从 transport 能力构建，避免视图层自己猜 session 参数。
   */
  const 读取附件内容地址表 = (): Record<string, 附件内容地址快照> => {
    const sessionId = deps.读取会话编号();
    const urlsByAttachmentId: Record<string, 附件内容地址快照> = {};
    for (const attachment of 读取当前房间媒体附件()) {
      urlsByAttachmentId[attachment.attachmentId] = {
        originalSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "original"
        ),
        thumbnailSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "thumbnail"
        ),
      };
    }
    return urlsByAttachmentId;
  };

  const 清空播放状态 = (): void => {
    媒体播放结果表 = {};
    正在解析媒体播放.clear();
    媒体定位器.清空();
  };

  return {
    snapshot(): 聊天媒体快照 {
      return {
        playbackByAttachmentId: 媒体播放结果表,
        contentUrlByAttachmentId: 读取附件内容地址表(),
      };
    },

    async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
      await 媒体发布器.处理选择媒体文件(files);
    },

    移除媒体草稿(localId: string): void {
      媒体发布器.移除草稿(localId);
    },

    async 重试媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.重试草稿(localId);
    },

    清空草稿(): void {
      媒体发布器.清空();
    },

    打开查看器(request: 媒体查看器打开请求): void {
      deps.登记程序滚动来源("media_viewer_open");
      媒体查看器.打开(request);
    },

    /**
     * 播放结果只从“当前时间线里的附件集合”推导：
     * - 新出现的附件进入解析；
     * - 已经不在时间线里的附件立即退场；
     * - 壳层只读这个结果表，不再自己记一份播放缓存。
     */
    同步消息附件播放结果(): void {
      const attachments = 读取当前房间媒体附件();
      const activeAttachmentIds = new Set(attachments.map((item) => item.attachmentId));
      let hasRemovedPlaybackState = false;

      for (const attachmentId of Object.keys(媒体播放结果表)) {
        if (activeAttachmentIds.has(attachmentId)) {
          continue;
        }
        const nextResults = { ...媒体播放结果表 };
        delete nextResults[attachmentId];
        媒体播放结果表 = nextResults;
        hasRemovedPlaybackState = true;
      }

      if (hasRemovedPlaybackState) {
        deps.请求重渲染();
      }

      for (const attachment of attachments) {
        if (媒体播放结果表[attachment.attachmentId] || 正在解析媒体播放.has(attachment.attachmentId)) {
          continue;
        }
        const task = (async () => {
          const result = await 媒体播放器.解析播放结果({
            attachmentId: attachment.attachmentId,
            kind: attachment.kind,
          });
          if (!读取当前房间媒体附件().some((item) => item.attachmentId === attachment.attachmentId)) {
            return;
          }
          媒体播放结果表 = {
            ...媒体播放结果表,
            [attachment.attachmentId]: result,
          };
          deps.请求重渲染();
        })().finally(() => {
          正在解析媒体播放.delete(attachment.attachmentId);
        });
        正在解析媒体播放.set(attachment.attachmentId, task);
      }
    },

    清空(): void {
      媒体查看器.销毁();
      媒体发布器.清空();
      清空播放状态();
      deps.请求重渲染();
    },

    销毁(): void {
      媒体查看器.销毁();
      媒体发布器.销毁();
      清空播放状态();
      deps.请求重渲染();
    },

    设置媒体播放器供测试(player): void {
      清空播放状态();
      媒体播放器 = player;
      deps.请求重渲染();
    },

    设置媒体查看器供测试(viewer): void {
      媒体查看器.销毁();
      媒体查看器 = viewer;
    },

    设置媒体发布器供测试(publisher): void {
      媒体发布器.销毁();
      媒体发布器 = publisher;
    },
  };
}
