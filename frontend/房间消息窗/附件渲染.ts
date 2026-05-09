import { html } from "lit";
import { 投影信息流视频预算 } from "../媒体/信息流视频预算.js";
import type { 信息流视频预算投影, 正式媒体字节来源 } from "../媒体/信息流视频预算.js";
import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import type { 媒体播放结果 } from "../媒体/媒体播放.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import {
  渲染图片附件,
  type 图片附件渲染宿主,
} from "./图片附件渲染.js";
import {
  渲染视频附件,
  type 时间线视频附件,
  type 视频附件渲染宿主,
} from "./视频附件渲染.js";
import { 默认视频清单占位Poster } from "./视频表面占位.js";
import type { 消息展示项 } from "./视图.js";
export type { 时间线自动播冻结帧 } from "./视频桥接帧.js";

/**
 * 本文件只保留共享投影和按附件种类分派：
 * 1. 图片模板归 `图片附件渲染.ts`；
 * 2. 视频卡片模板归 `视频附件渲染.ts`；
 * 3. 这里不直接读取冷源，也不拥有播放器或媒体会话真相。
 */
type 图片附件 = Extract<消息展示项["attachments"][number], { kind: "image" }>;

export type 房间消息窗附件渲染宿主 = 图片附件渲染宿主 &
  视频附件渲染宿主 & {
  mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
};

export const 读取附件播放源 = (
  attachment: 消息展示项["attachments"][number],
  playback: 媒体播放结果 | null
): string => {
  if (attachment.kind === "video" && 视频地址属于旧流媒体清单(playback?.src)) {
    return "";
  }
  /**
   * 时间线正式媒体字节现在只认 swarm：
   * 1. `anchor` 可以继续作为内部迁移态存在；
   * 2. 但消息窗卡片不能再把它渲染成真正的 `<video>/<img>` 正式源；
   * 3. 真拿不到 swarm 时，保持占位或静态 poster，让唯一 owner 后续继续收口。
   */
  return playback?.mode === "swarm" ? playback.src : "";
};

export const 读取图片查看器播放源 = (
  attachment: 图片附件,
  playback: 媒体播放结果 | null
): string => 读取附件播放源(attachment, playback);

export const 读取时间线视频封面地址 = (input: {
  attachment: 时间线视频附件;
  playback: 媒体播放结果 | null;
  failedPosterSrc: string | null;
  clearFailedPoster(): void;
}): string => {
  const candidatePosterSrc =
    input.playback?.thumbnailUrl ?? input.attachment.posterSrc ?? 默认视频清单占位Poster;
  if (input.failedPosterSrc && input.failedPosterSrc !== candidatePosterSrc) {
    input.clearFailedPoster();
    return candidatePosterSrc;
  }
  if (input.failedPosterSrc && input.failedPosterSrc === candidatePosterSrc) {
    return 默认视频清单占位Poster;
  }
  return candidatePosterSrc;
};

export const 读取时间线视频首帧预览源 = (input: {
  attachment: 时间线视频附件;
  playback: 媒体播放结果 | null;
  previewState: 视频预览状态 | null;
  有静态封面: boolean;
  有运行时预览: boolean;
}): string | null => {
  if (input.playback?.src && input.playback.mode === "swarm") {
    if (input.有静态封面 || input.有运行时预览) {
      return input.playback.src;
    }
    if (input.previewState?.phase === "missing_source") {
      return null;
    }
    return input.playback.src;
  }
  return null;
};

export const 读取时间线视频预算投影 = (input: {
  attachment: 时间线视频附件;
  previewVideoSrcCandidate: string | null;
  fromSnapshot: 信息流视频预算投影 | null;
  playback: 媒体播放结果 | null;
  inlineAutoplayPlayback: 媒体播放结果 | null;
  inlineAutoplayOwnerAttachmentId: string | null;
}): 信息流视频预算投影 => {
  if (input.fromSnapshot) {
    return input.fromSnapshot;
  }
  const formalByteSource: 正式媒体字节来源 =
    input.playback?.mode === "swarm" ||
    input.inlineAutoplayPlayback?.mode === "swarm" ||
    Boolean(input.previewVideoSrcCandidate)
      ? "webtorrent_official_stream"
      : "none";
  return 投影信息流视频预算({
    attachmentId: input.attachment.attachmentId,
    playback: input.playback,
    inlineAutoplayPlayback: input.inlineAutoplayPlayback,
    viewerCanonicalVideoSrc: null,
    previewVideoSrc: input.previewVideoSrcCandidate,
    inMediaWindow: true,
    isAutoplayCandidate: false,
    isInlineAutoplayOwner: input.inlineAutoplayOwnerAttachmentId === input.attachment.attachmentId,
    isViewerOwner: false,
    sessionStatus: input.playback?.mode === "swarm" ? "backfilling" : null,
    locallyComplete: false,
    formalByteSource,
  });
};

export const 读取时间线预览视频是否允许渲染 = (
  budget: 信息流视频预算投影,
  input: {
    hasExistingSameSourcePreviewFrame?: boolean;
    hasFrozenTimelineFrame?: boolean;
    hasKnownReadyPreviewFrame?: boolean;
    previewVideoSrc: string | null;
    shouldReuseSavedTimelineFrameAsPreview: boolean;
  }
): boolean => {
  if (budget.allowPreviewVideo) {
    return true;
  }
  if (!input.previewVideoSrc) {
    return false;
  }
  if (
    !input.shouldReuseSavedTimelineFrameAsPreview &&
    !input.hasExistingSameSourcePreviewFrame &&
    !input.hasFrozenTimelineFrame &&
    !input.hasKnownReadyPreviewFrame
  ) {
    return false;
  }
  return budget.formalByteSource === "webtorrent_official_stream";
};

export const 读取保存续帧是否允许承接时间线预览底板 = (input: {
  attachmentId: string;
  playback: 媒体播放结果 | null;
  playbackTimelineVideoSrc: string | null;
  savedTimelineFrameSrc: string | null;
  inlineAutoplayOwnerAttachmentId: string | null;
  recentlyReleasedOwnerAttachmentId: string | null;
  normalizeSrc(src: string | null): string | null;
}): boolean => {
  if (!input.savedTimelineFrameSrc) {
    return false;
  }
  if (!input.playback) {
    return true;
  }
  if (
    input.inlineAutoplayOwnerAttachmentId === input.attachmentId ||
    input.recentlyReleasedOwnerAttachmentId === input.attachmentId
  ) {
    return true;
  }
  if (input.playback.mode !== "swarm") {
    return false;
  }
  const normalizedSavedSrc = input.normalizeSrc(input.savedTimelineFrameSrc);
  const normalizedPreviewSrc = input.normalizeSrc(input.playbackTimelineVideoSrc);
  return Boolean(normalizedSavedSrc && normalizedSavedSrc === normalizedPreviewSrc);
};

export const 渲染消息附件 = (
  context: 房间消息窗附件渲染宿主,
  item: 消息展示项,
  可渲染真实预览视频附件: Set<string>
) => {
  if (item.attachments.length === 0) {
    return null;
  }

  const attachmentLayout = item.attachmentLayout;

  /**
   * 容器样式：Telegram Mosaic 用 position: relative + 固定宽高，
   * 每张卡片用 position: absolute 绝对定位到算法输出的 (layoutX, layoutY)。
   */
  const containerStyle = attachmentLayout
    ? `position: relative; width: ${attachmentLayout.contentWidth}px; height: ${attachmentLayout.totalHeight}px`
    : "";

  const 读取附件播放结果 = (attachmentId: string): 媒体播放结果 | null =>
    context.mediaPlaybackByAttachmentId[attachmentId] ?? null;

  /** 每张卡片的绝对定位内联样式 */
  const 读取附件卡片样式 = (attachment: 消息展示项["attachments"][number]): string =>
    `position: absolute; left: ${attachment.layoutX}px; top: ${attachment.layoutY}px; width: ${attachment.displayWidth}px; height: ${attachment.displayHeight}px`;

  const 渲染媒体提示 = (attachmentId: string, playback: 媒体播放结果 | null) => {
    if (!playback?.hint) {
      return null;
    }
    return html`
      <div class="message-media-hint" data-media-hint=${attachmentId}>${playback.hint}</div>
    `;
  };

  const 是否允许手动重试不可用视频 = (
    attachment: 消息展示项["attachments"][number],
    playback: 媒体播放结果
  ): boolean =>
    attachment.kind === "video" &&
    playback.mode === "degraded" &&
    (playback.reason === "connecting_to_peers" || playback.reason === "no_online_seed");

  const 渲染不可用附件 = (
    attachment: 消息展示项["attachments"][number],
    playback: 媒体播放结果
  ) => html`
    <div class="message-media-unavailable" data-attachment-id=${attachment.attachmentId}>
      ${渲染媒体提示(attachment.attachmentId, playback)}
      ${是否允许手动重试不可用视频(attachment, playback)
        ? html`
            <button
              class="message-media-retry-trigger"
              type="button"
              data-attachment-id=${attachment.attachmentId}
              @click=${(event: Event) => {
                /**
                 * “暂无在线种子”卡片只表达恢复意图；恢复裁决仍归媒体会话 owner。
                 */
                event.preventDefault();
                event.stopPropagation();
                context.广播媒体会话信号(attachment.attachmentId, {
                  type: "ENTER_RECOVERING",
                });
              }}
            >
              立即重试
            </button>
          `
        : null}
    </div>
  `;

  return html`
    <div
      class="message-attachment-grid"
      data-attachment-count=${item.attachments.length}
      style=${containerStyle}
    >
      ${item.attachments.map((attachment) => {
        const playback = 读取附件播放结果(attachment.attachmentId);
        const attachmentCardStyle = 读取附件卡片样式(attachment);
        if (playback?.mode === "expired" || playback?.mode === "degraded") {
          return html`
            <div
              class="message-attachment-card message-media-unavailable"
              data-attachment-id=${attachment.attachmentId}
              style=${attachmentCardStyle}
            >
              ${渲染不可用附件(attachment, playback)}
            </div>
          `;
        }
        if (attachment.kind === "video") {
          return 渲染视频附件(context, {
            attachment,
            playback,
            attachmentCardStyle,
            可渲染真实预览视频附件,
            渲染媒体提示,
          });
        }
        return 渲染图片附件(context, {
          attachment,
          playback,
          attachmentCardStyle,
          渲染媒体提示,
        });
      })}
    </div>
  `;
};
