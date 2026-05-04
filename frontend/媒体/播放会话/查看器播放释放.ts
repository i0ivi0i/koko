import type { 媒体会话端口 } from "../媒体会话.js";
import type { 媒体查看器打开请求 } from "../媒体查看器.js";

type 查看器播放释放请求 = {
  attachmentId: string;
  consumerId?: string;
};

/**
 * 查看器播放释放 owner 只处理 viewer 退场后的正式 playback 清理。
 * 时间线会话壳、预览状态和 WebTorrent 帮助任务仍由各自 owner 决定是否保留。
 */
export function 释放查看器正式播放占用(input: {
  attachmentId: string | null | undefined;
  媒体会话表: Map<string, 媒体会话端口>;
  读取当前查看器请求(): 媒体查看器打开请求 | null;
  释放附件播放资源(request: 查看器播放释放请求): void;
  构造媒体会话ConsumerId(attachmentId: string): string;
  跳过查看器同步的播放释放附件: Set<string>;
}): boolean {
  const normalizedAttachmentId = input.attachmentId?.trim() ?? "";
  if (!normalizedAttachmentId) {
    return false;
  }
  const session = input.媒体会话表.get(normalizedAttachmentId);
  if (!session?.snapshot().playback) {
    return false;
  }
  input.释放附件播放资源({
    attachmentId: normalizedAttachmentId,
    consumerId: input.构造媒体会话ConsumerId(normalizedAttachmentId),
  });
  const 当前查看器请求 = input.读取当前查看器请求();
  if (
    当前查看器请求 &&
    当前查看器请求.startAttachmentId !== normalizedAttachmentId &&
    当前查看器请求.items.some((item) => item.attachmentId === normalizedAttachmentId)
  ) {
    input.跳过查看器同步的播放释放附件.add(normalizedAttachmentId);
  }
  session.send({ type: "PLAYBACK_RELEASED" });
  return true;
}
