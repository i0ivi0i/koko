import type { 媒体种类 } from "../../聊天共享/契约.js";
import {
  提取重点信息流视频预算,
  投影信息流视频预算,
  type 信息流视频预算投影,
  type 正式媒体字节来源,
} from "../信息流视频预算.js";
import type { WebTorrentSessionLifecycleSnapshot } from "../资产协作分发运行时.js";
import type { 媒体会话快照, 媒体会话端口 } from "../媒体会话.js";
import type { 媒体播放结果 } from "../媒体播放.js";
import type { 媒体运行时上下文 } from "../运行时.js";

export type 附件内容地址快照 = {
  thumbnailSrc: string;
};

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

type 媒体快照投影协作依赖 = {
  构建附件内容地址(
    attachmentId: string,
    variant: "original" | "thumbnail"
  ): string;
  读取当前房间媒体附件(): 媒体附件条目[];
  读取媒体会话表(): ReadonlyMap<string, 媒体会话端口>;
  读取视频预览候选播放源(
    attachmentId: string
  ): { src: string; contentHash: string | null } | null;
  读取媒体运行时上下文(): 媒体运行时上下文;
  当前在媒体窗口内(attachmentId: string): boolean;
  当前是自动播候选(attachmentId: string): boolean;
  读取附件缓存是否完整(attachmentId: string): boolean;
  读取播放结果协作分发生命周期(
    playback: 媒体播放结果 | null
  ): WebTorrentSessionLifecycleSnapshot | null;
};

export interface 媒体快照投影协作端口 {
  读取附件内容地址表(): Record<string, 附件内容地址快照>;
  读取媒体会话快照表(): Record<string, 媒体会话快照>;
  读取媒体播放结果表(): Record<string, 媒体播放结果>;
  读取信息流视频预算表(): Record<string, 信息流视频预算投影>;
  缓存重点信息流视频预算(
    nextBudgets: Record<string, 信息流视频预算投影>
  ): 信息流视频预算投影[];
}

/**
 * 快照投影协作只做浏览器侧快照压平：
 * 1. 把会话、自动播、查看器、缓存完整度投影成消息窗可直接消费的纯数据；
 * 2. 预算只表达“这一刻前台该怎么展示”，不直接驱动播放器或 WebTorrent；
 * 3. 这样聊天媒体编排只保留装配，不再在根文件里长第二份投影状态机。
 */
export function 创建媒体快照投影协作(
  deps: 媒体快照投影协作依赖
): 媒体快照投影协作端口 {
  let 上次重点信息流视频预算: 信息流视频预算投影[] = [];

  const 信息流视频预算条目相同 = (
    left: 信息流视频预算投影,
    right: 信息流视频预算投影
  ): boolean =>
    left.attachmentId === right.attachmentId &&
    left.tier === right.tier &&
    left.reason === right.reason &&
    left.canonicalVideoSrc === right.canonicalVideoSrc &&
    left.previewVideoSrc === right.previewVideoSrc &&
    left.allowInlineCanonical === right.allowInlineCanonical &&
    left.allowPreviewVideo === right.allowPreviewVideo &&
    left.formalByteSource === right.formalByteSource &&
    left.webTorrentLifecycleState === right.webTorrentLifecycleState &&
    left.activeWebTorrentReaderCount === right.activeWebTorrentReaderCount;

  return {
    读取附件内容地址表(): Record<string, 附件内容地址快照> {
      const urlsByAttachmentId: Record<string, 附件内容地址快照> = {};
      for (const attachment of deps.读取当前房间媒体附件()) {
        urlsByAttachmentId[attachment.attachmentId] = {
          /**
           * 这里只保留视频 poster 的静态封面地址：
           * 1. 视频消息卡片仍允许使用后端权威 still/poster 做非正式封面；
           * 2. 图片则不再额外生成 thumbnail/original 地址，避免 presenter 替它脑补 blob/canonical 第二面；
           * 3. 正式显示仍然统一等待 swarm source 或稳定占位。
           */
          thumbnailSrc:
            attachment.kind === "video"
              ? deps.构建附件内容地址(attachment.attachmentId, "thumbnail")
              : "",
        };
      }
      return urlsByAttachmentId;
    },

    读取媒体会话快照表(): Record<string, 媒体会话快照> {
      const snapshots: Record<string, 媒体会话快照> = {};
      for (const [attachmentId, session] of deps.读取媒体会话表()) {
        snapshots[attachmentId] = session.snapshot();
      }
      return snapshots;
    },

    读取媒体播放结果表(): Record<string, 媒体播放结果> {
      const playbackByAttachmentId: Record<string, 媒体播放结果> = {};
      for (const [attachmentId, session] of deps.读取媒体会话表()) {
        const playback = session.snapshot().playback;
        if (playback) {
          playbackByAttachmentId[attachmentId] = playback;
        }
      }
      return playbackByAttachmentId;
    },

    读取信息流视频预算表(): Record<string, 信息流视频预算投影> {
      const budgets: Record<string, 信息流视频预算投影> = {};
      const context = deps.读取媒体运行时上下文();
      const viewerAttachmentId = context.currentViewerRequest?.startAttachmentId?.trim() ?? "";
      for (const attachment of deps.读取当前房间媒体附件()) {
        if (attachment.kind !== "video") {
          continue;
        }
        const attachmentId = attachment.attachmentId;
        const session = deps.读取媒体会话表().get(attachmentId)?.snapshot() ?? null;
        const previewCandidate = deps.读取视频预览候选播放源(attachmentId);
        const runtimeAutoplayPlayback =
          context.inlineAutoplayOwnerAttachmentId === attachmentId
            ? context.inlineAutoplayPlayback
            : null;
        const webTorrentLifecycle = deps.读取播放结果协作分发生命周期(
          runtimeAutoplayPlayback ?? session?.playback ?? null
        );
        const formalByteSource: 正式媒体字节来源 =
          session?.playback?.mode === "swarm" ||
          runtimeAutoplayPlayback?.mode === "swarm" ||
          previewCandidate
            ? "webtorrent_official_stream"
            : "none";
        const viewerCanonicalVideoSrc =
          viewerAttachmentId === attachmentId
            ? context.currentViewerRequest?.items.find(
                (item) => item.kind === "video" && item.attachmentId === attachmentId
              )?.src ?? null
            : null;
        budgets[attachmentId] = 投影信息流视频预算({
          attachmentId,
          playback: session?.playback ?? null,
          inlineAutoplayPlayback: runtimeAutoplayPlayback,
          viewerCanonicalVideoSrc,
          previewVideoSrc: previewCandidate?.src ?? null,
          inMediaWindow: deps.当前在媒体窗口内(attachmentId),
          isAutoplayCandidate: deps.当前是自动播候选(attachmentId),
          isInlineAutoplayOwner: context.inlineAutoplayOwnerAttachmentId === attachmentId,
          isViewerOwner: viewerAttachmentId === attachmentId,
          sessionStatus: session?.status ?? null,
          locallyComplete:
            Boolean(session?.locallyComplete) || deps.读取附件缓存是否完整(attachmentId),
          formalByteSource,
          webTorrentLifecycle,
        });
      }
      return budgets;
    },

    缓存重点信息流视频预算(
      nextBudgets: Record<string, 信息流视频预算投影>
    ): 信息流视频预算投影[] {
      const nextFocused = 提取重点信息流视频预算(nextBudgets);
      if (
        nextFocused.length === 上次重点信息流视频预算.length &&
        nextFocused.every((budget, index) =>
          信息流视频预算条目相同(budget, 上次重点信息流视频预算[index]!)
        )
      ) {
        return 上次重点信息流视频预算;
      }
      上次重点信息流视频预算 = nextFocused.map((budget) => ({ ...budget }));
      return 上次重点信息流视频预算;
    },
  };
}
