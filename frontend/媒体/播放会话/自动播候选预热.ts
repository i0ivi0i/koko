import {
  排序消息视频自动播候选,
  type 消息视频自动播候选,
} from "../消息视频自动播编排.js";

const 自动播预览预热候选上限 = 2;

interface 自动播候选附件 {
  attachmentId: string;
  kind: "image" | "video";
}

/**
 * 自动播候选预热 owner 只处理“可见候选值得提前补一帧预览”的体验信号。
 * 它不启动正式媒体会话，不创建播放器，也不把可见性升级成 WebTorrent 字节真相。
 */
export function 同步自动播候选预热(input: {
  candidates: 消息视频自动播候选[];
  currentOwnerOrPendingAttachmentId: string | null;
  当前自动播候选附件Id集合: Set<string>;
  同步附件标识集合(target: Set<string>, nextIds: string[]): boolean;
  读取附件条目(attachmentId: string): 自动播候选附件 | null;
  触发视频预览收敛(
    attachmentId: string,
    options: { trigger: "visible_candidate" }
  ): void;
}): { 自动播候选已变化: boolean } {
  const preheatCandidates = 排序消息视频自动播候选(
    input.candidates,
    input.currentOwnerOrPendingAttachmentId
  ).slice(0, 自动播预览预热候选上限);
  const 自动播候选已变化 = input.同步附件标识集合(
    input.当前自动播候选附件Id集合,
    preheatCandidates.map((candidate) => candidate.attachmentId)
  );

  for (const candidate of preheatCandidates) {
    const attachment = input.读取附件条目(candidate.attachmentId);
    if (!attachment || attachment.kind !== "video") {
      continue;
    }
    input.触发视频预览收敛(attachment.attachmentId, {
      trigger: "visible_candidate",
    });
  }

  return { 自动播候选已变化 };
}
