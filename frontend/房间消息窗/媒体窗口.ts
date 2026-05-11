import type { 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排.js";
import type { 消息虚拟项 } from "./消息虚拟列表.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

export type 时间线视频附件 = Extract<
  消息展示项["attachments"][number],
  { kind: "video" }
>;

type 自动播候选可见条目 = Pick<消息视频自动播候选, "distanceToViewportCenter">;

interface 媒体窗口基础输入 {
  items: 聊天列表展示项[];
  virtualItems: 消息虚拟项[];
  inlineAutoplayOwnerAttachmentId: string | null;
  最近退场Owner附件Id: string | null;
  自动播候选可见条目: Map<string, 自动播候选可见条目>;
}

export interface 当前媒体窗口附件输入 extends 媒体窗口基础输入 {
  maxMediaCount?: number;
  maxVideoCount?: number;
}

export interface 即将渲染时间线视频输入 extends 媒体窗口基础输入 {
  时间线隐藏接管附件Id: string | null;
  dom视频附件标识: Iterable<string | null | undefined>;
}

export interface 可渲染真实预览视频输入 extends 媒体窗口基础输入 {
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
  读取时间线视频已就绪首帧预览源: (attachmentId: string) => string | null;
  maxPreviewVideoCount?: number;
}

const 近视口真实预览视频预算上限 = 2;
const 近视口活媒体会话预算上限 = 24;
export const 近视口活视频会话预算上限 = 12;

const 归一化附件标识 = (attachmentId: string | null | undefined): string =>
  attachmentId?.trim() ?? "";

const 按视口中心距离排序 = (
  candidates: Map<string, 自动播候选可见条目>
): string[] =>
  Array.from(candidates.entries())
    .sort((left, right) => left[1].distanceToViewportCenter - right[1].distanceToViewportCenter)
    .map(([attachmentId]) => attachmentId);

/**
 * 媒体窗口 owner 只回答“当前消息视口附近有哪些附件需要保持活会话”。
 *
 * 它不创建 WebTorrent，不创建播放器，也不判断媒体是否成立；这些仍由媒体 owner 和后端契约决定。
 * 这里的职责只是把 owner、刚退场 owner、自动播候选和虚拟窗口顺序压成一个稳定的小集合。
 */
export const 读取当前媒体窗口附件标识 = (input: 当前媒体窗口附件输入): string[] => {
  const attachmentIds: string[] = [];
  const seen = new Set<string>();
  let mediaCount = 0;
  let videoCount = 0;
  const maxMediaCount = input.maxMediaCount ?? 近视口活媒体会话预算上限;
  const maxVideoCount = input.maxVideoCount ?? 近视口活视频会话预算上限;
  const push = (attachmentId: string | null | undefined, kind: "image" | "video"): void => {
    const normalized = 归一化附件标识(attachmentId);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    if (mediaCount >= maxMediaCount) {
      return;
    }
    if (kind === "video" && videoCount >= maxVideoCount) {
      return;
    }
    seen.add(normalized);
    attachmentIds.push(normalized);
    mediaCount += 1;
    if (kind === "video") {
      videoCount += 1;
    }
  };

  push(input.inlineAutoplayOwnerAttachmentId, "video");
  push(input.最近退场Owner附件Id, "video");
  for (const attachmentId of 按视口中心距离排序(input.自动播候选可见条目)) {
    push(attachmentId, "video");
  }
  for (const virtualItem of input.virtualItems) {
    const item = input.items[virtualItem.index];
    if (!item || item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      push(attachment.attachmentId, attachment.kind);
    }
  }
  return attachmentIds;
};

export const 读取即将渲染的时间线视频附件 = (
  input: 即将渲染时间线视频输入
): 时间线视频附件[] => {
  const attachmentsById = new Map<string, 时间线视频附件>();
  const unresolvedAttachmentIds = new Set<string>();
  const pushAttachment = (attachment: 消息展示项["attachments"][number]): void => {
    if (attachment.kind !== "video" || attachmentsById.has(attachment.attachmentId)) {
      return;
    }
    attachmentsById.set(attachment.attachmentId, attachment);
    unresolvedAttachmentIds.delete(attachment.attachmentId);
  };
  const pushAttachmentId = (attachmentId: string | null | undefined): void => {
    const normalized = 归一化附件标识(attachmentId);
    if (!normalized || attachmentsById.has(normalized)) {
      return;
    }
    unresolvedAttachmentIds.add(normalized);
  };

  for (const virtualItem of input.virtualItems) {
    const item = input.items[virtualItem.index];
    if (!item || item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      pushAttachment(attachment);
    }
  }

  pushAttachmentId(input.inlineAutoplayOwnerAttachmentId);
  pushAttachmentId(input.最近退场Owner附件Id);
  pushAttachmentId(input.时间线隐藏接管附件Id);
  for (const attachmentId of input.dom视频附件标识) {
    pushAttachmentId(attachmentId);
  }

  if (unresolvedAttachmentIds.size > 0) {
    for (const item of input.items) {
      if (item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (
          attachment.kind === "video" &&
          unresolvedAttachmentIds.has(attachment.attachmentId)
        ) {
          pushAttachment(attachment);
        }
      }
      if (unresolvedAttachmentIds.size === 0) {
        break;
      }
    }
  }

  return Array.from(attachmentsById.values());
};

export const 读取允许渲染真实预览视频附件集合 = (
  input: 可渲染真实预览视频输入
): Set<string> => {
  const orderedAttachmentIds: string[] = [];
  const seen = new Set<string>();
  const push = (attachmentId: string | null | undefined): void => {
    const normalized = 归一化附件标识(attachmentId);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    orderedAttachmentIds.push(normalized);
  };

  push(input.inlineAutoplayOwnerAttachmentId);
  push(input.最近退场Owner附件Id);
  for (const virtualItem of input.virtualItems) {
    const item = input.items[virtualItem.index];
    if (!item || item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      if (attachment.kind !== "video") {
        continue;
      }
      const position = input.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
      if (position?.src && Number.isFinite(position.currentTime) && position.currentTime > 0) {
        push(attachment.attachmentId);
      }
    }
  }
  for (const virtualItem of input.virtualItems) {
    const item = input.items[virtualItem.index];
    if (!item || item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      if (
        attachment.kind === "video" &&
        input.读取时间线视频已就绪首帧预览源(attachment.attachmentId)
      ) {
        push(attachment.attachmentId);
      }
    }
  }
  for (const attachmentId of 按视口中心距离排序(input.自动播候选可见条目)) {
    push(attachmentId);
  }
  for (const virtualItem of input.virtualItems) {
    const item = input.items[virtualItem.index];
    if (!item || item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      if (attachment.kind === "video") {
        push(attachment.attachmentId);
      }
    }
  }
  return new Set(
    orderedAttachmentIds.slice(
      0,
      input.maxPreviewVideoCount ?? 近视口真实预览视频预算上限
    )
  );
};

export class 媒体窗口观察Owner {
  private 上次媒体窗口附件签名 = "";

  constructor(private readonly 派发媒体窗口附件: (attachmentIds: string[]) => void) {}

  dispatch媒体窗口观察(input: 当前媒体窗口附件输入): void {
    const attachmentIds = 读取当前媒体窗口附件标识(input);
    const signature = attachmentIds.join("\u0000");
    if (signature === this.上次媒体窗口附件签名) {
      return;
    }
    this.上次媒体窗口附件签名 = signature;
    this.派发媒体窗口附件(attachmentIds);
  }

  重置(): void {
    this.上次媒体窗口附件签名 = "";
  }
}
