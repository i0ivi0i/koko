import type { 媒体种类 } from "../../聊天共享/契约.js";
import type { 媒体会话端口, 媒体播放结果 } from "../index.js";
import type { 媒体附件条目 } from "./窗口附件协作.js";

type 窗口会话协作依赖 = {
  读取当前房间媒体附件(): 媒体附件条目[];
  读取当前活跃媒体窗口附件(attachments: 媒体附件条目[]): 媒体附件条目[];
  读取当前房间帮助附件候选(attachments: 媒体附件条目[]): 媒体附件条目[];
  读取媒体会话表(): Map<string, 媒体会话端口>;
  创建媒体会话条目(attachment: 媒体附件条目): 媒体会话端口;
  释放媒体附件会话(
    attachmentId: string,
    input: {
      丢弃未完成预览补齐?: boolean;
      清理协作补齐?: boolean;
      清理视频预览?: boolean;
    }
  ): boolean;
  读取附件条目(attachmentId: string): 媒体附件条目 | null;
  触发视频预览收敛(attachmentId: string): void;
  应保留帮助任务(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
  }): boolean;
  同步当前帮助窗口附件(attachments: 媒体附件条目[]): void;
  恢复当前房间缓存帮助任务(attachments: 媒体附件条目[]): void;
  接收消息附件同步(input: {
    attachmentIds: string[];
    positionRetentionAttachmentIds: string[];
  }): void;
  请求重渲染(): void;
};

export interface 窗口会话协作端口 {
  按当前窗口重同步消息附件播放结果(): void;
}

/**
 * 窗口会话协作只拥有“当前前台窗口该保留哪些媒体会话”：
 * 1. 依据窗口附件、自动播候选和帮助链同步增删会话；
 * 2. 只负责前台会话集合收口，不改播放真相、不改 WebTorrent 真相；
 * 3. 这样聊天媒体编排根文件只做装配，不再自己内联窗口会话裁剪流程。
 */
export function 创建窗口会话协作(
  deps: 窗口会话协作依赖
): 窗口会话协作端口 {
  const 清理失活媒体会话 = (activeAttachmentIds: Set<string>): boolean => {
    let hasSessionSetChanged = false;
    for (const [attachmentId, session] of deps.读取媒体会话表()) {
      if (activeAttachmentIds.has(attachmentId)) {
        continue;
      }
      const playback = session.snapshot().playback;
      if (
        deps.应保留帮助任务({
          attachmentId,
          playback,
        })
      ) {
        continue;
      }
      if (
        deps.释放媒体附件会话(attachmentId, {
          丢弃未完成预览补齐: true,
          清理协作补齐: deps.读取附件条目(attachmentId) === null,
          清理视频预览: true,
        })
      ) {
        hasSessionSetChanged = true;
      }
    }
    return hasSessionSetChanged;
  };

  const 补齐当前房间媒体会话 = (attachments: 媒体附件条目[]): boolean => {
    let hasSessionSetChanged = false;
    for (const attachment of attachments) {
      if (deps.读取媒体会话表().has(attachment.attachmentId)) {
        if (attachment.kind === "video") {
          deps.触发视频预览收敛(attachment.attachmentId);
        }
        continue;
      }
      hasSessionSetChanged = true;
      const session = deps.创建媒体会话条目(attachment);
      deps.读取媒体会话表().set(attachment.attachmentId, session);
      if (attachment.kind === "image") {
        void session.启动();
        continue;
      }
      deps.触发视频预览收敛(attachment.attachmentId);
    }
    return hasSessionSetChanged;
  };

  return {
    按当前窗口重同步消息附件播放结果(): void {
      const attachments = deps.读取当前房间媒体附件();
      const activeWindowAttachments = deps.读取当前活跃媒体窗口附件(attachments);
      const helpAttachments = deps.读取当前房间帮助附件候选(activeWindowAttachments);
      deps.同步当前帮助窗口附件(helpAttachments);
      const activeAttachmentIds = new Set(
        activeWindowAttachments.map((item) => item.attachmentId)
      );
      if (清理失活媒体会话(activeAttachmentIds)) {
        deps.请求重渲染();
      }
      deps.接收消息附件同步({
        attachmentIds: Array.from(activeAttachmentIds),
        positionRetentionAttachmentIds: attachments.map((item) => item.attachmentId),
      });
      if (补齐当前房间媒体会话(activeWindowAttachments)) {
        deps.请求重渲染();
      }
      deps.恢复当前房间缓存帮助任务(helpAttachments);
    },
  };
}
