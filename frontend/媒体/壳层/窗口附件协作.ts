import type { 消息事件, 媒体种类 } from "../../聊天共享/契约.js";
import type { 媒体缓存快照 } from "../媒体缓存.js";

export type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

type 窗口外显式保活上下文 = {
  viewerAttachmentId: string | null;
  autoplayOwnerAttachmentId: string | null;
};

type 窗口附件协作依赖 = {
  读取消息(): 消息事件[];
  读取当前房间标识(): string | null;
  读取媒体缓存快照(): 媒体缓存快照;
  读取当前媒体窗口附件标识(): Iterable<string>;
  读取当前自动播候选附件标识(): Iterable<string>;
  读取窗口外显式保活上下文(): 窗口外显式保活上下文;
};

export interface 窗口附件协作端口 {
  读取当前房间媒体附件(): 媒体附件条目[];
  读取当前帮助窗口附件标识(attachments?: 媒体附件条目[]): Set<string>;
  读取当前房间帮助附件候选(attachments?: 媒体附件条目[]): 媒体附件条目[];
  读取当前活跃媒体窗口附件(attachments?: 媒体附件条目[]): 媒体附件条目[];
  读取附件条目(attachmentId: string): 媒体附件条目 | null;
  同步附件标识集合(target: Set<string>, attachmentIds: Iterable<string>): boolean;
}

const 归一化附件标识 = (attachmentId: string | null | undefined): string => attachmentId?.trim() ?? "";

/**
 * 窗口附件协作只回答三件事：
 * 1. 当前房间里有哪些媒体附件；
 * 2. 哪些附件属于“当前窗口/帮助链/显式 owner”需要继续保活；
 * 3. 哪些附件标识集合真的发生了变化。
 *
 * 这样播放会话应用只做装配和发号施令，不再自己内联窗口附件筛选细节。
 */
export function 创建窗口附件协作(
  deps: 窗口附件协作依赖
): 窗口附件协作端口 {
  const 读取当前房间媒体附件 = (): 媒体附件条目[] => {
    const seen = new Set<string>();
    const attachments: 媒体附件条目[] = [];
    for (const message of deps.读取消息()) {
      for (const attachment of message.attachments ?? []) {
        const attachmentId = 归一化附件标识(attachment.attachment_id);
        if (!attachmentId || seen.has(attachmentId)) {
          continue;
        }
        seen.add(attachmentId);
        attachments.push({
          attachmentId,
          kind: attachment.kind,
        });
      }
    }
    return attachments;
  };

  const 读取当前房间缓存帮助附件 = (): 媒体附件条目[] => {
    const currentRoomId = 归一化附件标识(deps.读取当前房间标识());
    if (!currentRoomId) {
      return [];
    }
    /**
     * 缓存恢复只允许回看“当前房间里已经完整落盘过的附件”：
     * 1. 当前窗口看不见的旧附件，只要仍属于当前房间，也可以继续帮后来的群友；
     * 2. 别的房间缓存绝不能因为同页存活就混进当前帮助链；
     * 3. 所以 roomId 是这里唯一允许跨消息列表恢复的边界。
     */
    const attachments: 媒体附件条目[] = [];
    for (const record of Object.values(deps.读取媒体缓存快照())) {
      if (!record.complete || record.roomId !== currentRoomId || !record.kind) {
        continue;
      }
      attachments.push({
        attachmentId: record.attachmentId,
        kind: record.kind,
      });
    }
    return attachments;
  };

  const 读取当前帮助窗口附件标识 = (
    attachments = 读取当前房间媒体附件()
  ): Set<string> => {
    const attachmentIds = new Set<string>([
      ...deps.读取当前媒体窗口附件标识(),
      ...deps.读取当前自动播候选附件标识(),
      ...attachments.map((attachment) => attachment.attachmentId),
    ]);
    const 显式保活上下文 = deps.读取窗口外显式保活上下文();
    const viewerAttachmentId = 归一化附件标识(显式保活上下文.viewerAttachmentId);
    if (viewerAttachmentId) {
      attachmentIds.add(viewerAttachmentId);
    }
    const autoplayOwnerAttachmentId = 归一化附件标识(
      显式保活上下文.autoplayOwnerAttachmentId
    );
    if (autoplayOwnerAttachmentId) {
      attachmentIds.add(autoplayOwnerAttachmentId);
    }
    return attachmentIds;
  };

  const 读取当前房间帮助附件候选 = (
    attachments = 读取当前房间媒体附件()
  ): 媒体附件条目[] => {
    const helpWindowAttachmentIds = 读取当前帮助窗口附件标识(attachments);
    const merged = new Map<string, 媒体附件条目>();
    for (const attachment of attachments) {
      merged.set(attachment.attachmentId, attachment);
    }
    for (const attachment of 读取当前房间缓存帮助附件()) {
      if (!helpWindowAttachmentIds.has(attachment.attachmentId)) {
        continue;
      }
      if (!merged.has(attachment.attachmentId)) {
        merged.set(attachment.attachmentId, attachment);
      }
    }
    return Array.from(merged.values());
  };

  const 同步附件标识集合 = (
    target: Set<string>,
    attachmentIds: Iterable<string>
  ): boolean => {
    const normalizedIds: string[] = [];
    for (const attachmentId of attachmentIds) {
      const normalized = 归一化附件标识(attachmentId);
      if (!normalized) {
        continue;
      }
      normalizedIds.push(normalized);
    }
    if (
      target.size === normalizedIds.length &&
      normalizedIds.every((attachmentId) => target.has(attachmentId))
    ) {
      return false;
    }
    target.clear();
    for (const attachmentId of normalizedIds) {
      target.add(attachmentId);
    }
    return true;
  };

  const 读取当前活跃媒体窗口附件 = (
    attachments = 读取当前房间媒体附件()
  ): 媒体附件条目[] => {
    /**
     * 活媒体窗口真相只允许来自三类输入：
     * 1. RoomPane 当前回抛的窗口附件；
     * 2. 即将露头的自动播候选；
     * 3. 查看器 / autoplay owner 这类显式 owner。
     *
     * 只要这三类信号都没有，就宁可暂时没有活会话，也不能把整房历史附件误抬成活窗口。
     */
    const activeWindowIds = new Set<string>([
      ...deps.读取当前媒体窗口附件标识(),
      ...deps.读取当前自动播候选附件标识(),
    ]);
    const 显式保活上下文 = deps.读取窗口外显式保活上下文();
    const viewerAttachmentId = 归一化附件标识(显式保活上下文.viewerAttachmentId);
    if (viewerAttachmentId) {
      activeWindowIds.add(viewerAttachmentId);
    }
    const autoplayOwnerAttachmentId = 归一化附件标识(
      显式保活上下文.autoplayOwnerAttachmentId
    );
    if (autoplayOwnerAttachmentId) {
      activeWindowIds.add(autoplayOwnerAttachmentId);
    }
    if (activeWindowIds.size === 0) {
      return [];
    }
    return attachments.filter((attachment) => activeWindowIds.has(attachment.attachmentId));
  };

  const 读取附件条目 = (attachmentId: string): 媒体附件条目 | null => {
    const normalized = 归一化附件标识(attachmentId);
    if (!normalized) {
      return null;
    }
    return (
      读取当前房间媒体附件().find((attachment) => attachment.attachmentId === normalized) ?? null
    );
  };

  return {
    读取当前房间媒体附件,
    读取当前帮助窗口附件标识,
    读取当前房间帮助附件候选,
    读取当前活跃媒体窗口附件,
    读取附件条目,
    同步附件标识集合,
  };
}
