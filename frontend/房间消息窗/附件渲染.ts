import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { 投影信息流视频预算 } from "../媒体/信息流视频预算.js";
import type { 信息流视频预算投影, 正式媒体字节来源 } from "../媒体/信息流视频预算.js";
import { 判定播放连续性表面 } from "../媒体/全局丝滑自动播.js";
import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 消息展示项 } from "../视图.js";

export type 时间线自动播冻结帧 = {
  src: string;
  currentTime: number;
  dataUrl: string;
  updatedAt: number;
};

/**
 * 时间线卡片对“当前没有正式视频源”的表达只保留静态 poster。
 * 1. 旧 manifest/HLS 地址不能再塞进时间线原生 `<video>`；
 * 2. 查看器也不能继续把这类旧地址当成正式可播真相；
 * 3. 当唯一主链还没重裁出来时，这张轻占位图就是唯一允许的降载表达。
 */
export const 默认视频清单占位Poster =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#1f2937"/>
          <stop offset="100%" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#bg)"/>
      <circle cx="160" cy="90" r="34" fill="rgba(255,255,255,0.18)"/>
    </svg>
  `);

/**
 * 图片时间线在正式播放真相到达前只允许本地轻占位：
 * 1. 不能把 attachment.originalSrc / thumbnailSrc 抢先塞进 `<img>`；
 * 2. 否则刷新或重进房第一屏会先绕过 WebTorrent 读冷源；
 * 3. 真图到达后再由同一条媒体会话 playback 替换，不在消息窗另造缓存 owner。
 */
const 默认图片清单占位图 =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
      <rect width="320" height="240" fill="#17202c"/>
      <rect x="78" y="58" width="164" height="124" rx="10" fill="rgba(255,255,255,0.12)"/>
      <circle cx="122" cy="98" r="18" fill="rgba(255,255,255,0.18)"/>
      <path d="M86 168l58-54 34 32 26-24 30 46z" fill="rgba(255,255,255,0.2)"/>
    </svg>
  `);

type 时间线视频附件 = Extract<消息展示项["attachments"][number], { kind: "video" }>;
type 图片附件 = Extract<消息展示项["attachments"][number], { kind: "image" }>;

export type 房间消息窗附件渲染宿主 = {
  mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
  最近退场Owner附件Id: string | null;
  时间线隐藏接管附件Id: string | null;
  时间线唯一播放器可见接管就绪源: Map<string, string>;
  读取时间线视频运行时预览(attachmentId: string): Extract<视频预览状态, { phase: "ready" }> | null;
  读取时间线视频封面地址(attachment: 时间线视频附件, playback: 媒体播放结果 | null): string;
  读取时间线视频首帧预览源(
    attachment: 时间线视频附件,
    playback: 媒体播放结果 | null,
    input: { 有静态封面: boolean; 有运行时预览: boolean }
  ): string | null;
  读取保存续帧是否允许承接时间线预览底板(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
    playbackTimelineVideoSrc: string | null;
    savedTimelineFrameSrc: string | null;
  }): boolean;
  读取时间线视频已就绪首帧预览源(attachmentId: string): string | null;
  读取时间线视频预算投影(
    attachment: 时间线视频附件,
    previewVideoSrcCandidate: string | null
  ): 信息流视频预算投影;
  读取时间线唯一播放器是否可见接管就绪(attachmentId: string, src: string | null): boolean;
  读取自动播恢复位置(attachmentId: string, src: string | null): 媒体播放位置 | null;
  读取时间线现有预览视频是否可继续显示(attachmentId: string, src: string | null): boolean;
  读取时间线自动播冻结帧(
    attachmentId: string,
    src: string | null,
    position: 媒体播放位置 | null
  ): 时间线自动播冻结帧 | null;
  读取时间线视频首帧是否就绪(attachmentId: string, src: string | null): boolean;
  归一化时间线视频播放源(src: string | null): string | null;
  读取时间线预览视频是否允许渲染(
    budget: 信息流视频预算投影,
    input: {
      hasExistingSameSourcePreviewFrame?: boolean;
      hasFrozenTimelineFrame?: boolean;
      hasKnownReadyPreviewFrame?: boolean;
      previewVideoSrc: string | null;
      shouldReuseSavedTimelineFrameAsPreview: boolean;
    }
  ): boolean;
  恢复时间线自动播播放位置(
    attachmentId: string,
    video: HTMLVideoElement,
    input?: { allowPreviewFrame?: boolean }
  ): void;
  标记时间线视频首帧已就绪(attachmentId: string, src: string | null): void;
  标记视频封面加载失败(attachmentId: string, event: Event): void;
  广播媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  阻止时间线媒体预览原生菜单(event: Event): void;
  打开媒体查看器(event: Event, startAttachmentId: string): void;
};

export const 读取附件播放源 = (
  attachment: 消息展示项["attachments"][number],
  playback: 媒体播放结果 | null
): string => {
  if (attachment.kind === "video" && 视频地址属于旧流媒体清单(playback?.src)) {
    return "";
  }
  return playback?.mode === "swarm" || playback?.mode === "anchor" ? playback.src : "";
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

function 标记当前预览视频已出首帧(context: 房间消息窗附件渲染宿主, attachmentId: string, target: HTMLVideoElement): void {
  const currentSrc = target.currentSrc || target.getAttribute("src");
  const readySrc = context.归一化时间线视频播放源(currentSrc);
  if (readySrc) {
    target.dataset.previewReadySrc = readySrc;
  }
  context.标记时间线视频首帧已就绪(attachmentId, currentSrc);
}

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
    const gridColumnCount =
      attachmentLayout?.columnCount ?? (item.attachments.length >= 2 ? 2 : 1);
    const gridStyle = [
      `--attachment-grid-columns: ${gridColumnCount}`,
      `--attachment-grid-gap: ${attachmentLayout?.gap ?? 8}px`,
      attachmentLayout ? `--attachment-grid-row-height: ${attachmentLayout.rowHeight}px` : "",
    ]
      .filter((value) => value.length > 0)
      .join("; ");

    const 读取附件播放结果 = (attachmentId: string): 媒体播放结果 | null =>
      context.mediaPlaybackByAttachmentId[attachmentId] ?? null;

    const 读取附件卡片样式 = (attachment: 消息展示项["attachments"][number]): string =>
      [
        attachment.gridColumnStart
          ? `grid-column: ${attachment.gridColumnStart} / span ${attachment.gridColumnSpan ?? 1}`
          : "",
        attachment.gridRowStart
          ? `grid-row: ${attachment.gridRowStart} / span ${attachment.gridRowSpan ?? 1}`
          : "",
      ]
        .filter((value) => value.length > 0)
        .join("; ");

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
    ) =>
      html`
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
                     * “暂无在线种子”卡片必须给出手动重试入口：
                     * 1. 用户点重试代表显式恢复意图，不应被动等下一轮 15 秒窗口；
                     * 2. 这里只回抛 ENTER_RECOVERING 信号，保持“壳层只表达意图，恢复裁决仍在会话 owner”；
                     * 3. deleted/非视频场景不显示该入口，避免误导无效操作。
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
        data-attachment-template=${attachmentLayout?.template ?? "legacy-grid"}
        style=${gridStyle}
      >
        ${item.attachments.map((attachment) => {
          const playback = 读取附件播放结果(attachment.attachmentId);
          const attachmentCardStyle = 读取附件卡片样式(attachment);
          if (playback?.mode === "expired" || playback?.mode === "degraded") {
            return html`
              <div
                class="message-attachment-card message-media-unavailable"
                data-attachment-id=${attachment.attachmentId}
                data-grid-column-start=${attachment.gridColumnStart ?? ""}
                data-grid-column-span=${attachment.gridColumnSpan ?? ""}
                data-grid-row-start=${attachment.gridRowStart ?? ""}
                data-grid-row-span=${attachment.gridRowSpan ?? ""}
                style=${attachmentCardStyle}
              >
                ${渲染不可用附件(attachment, playback)}
              </div>
            `;
          }
          if (attachment.kind === "video") {
            const runtimePreview = context.读取时间线视频运行时预览(attachment.attachmentId);
            const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
            const hasRuntimePreview = Boolean(runtimePreview);
            const previewPosterSrc =
              !hasSourcePoster && runtimePreview
                ? runtimePreview.src
                : context.读取时间线视频封面地址(attachment, playback);
            const playbackTimelineVideoSrc = context.读取时间线视频首帧预览源(
              attachment,
              playback,
              {
                有静态封面: hasSourcePoster,
                有运行时预览: hasRuntimePreview,
              }
            );
            const savedTimelineFrame =
              context.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
            /**
             * owner 刚滑出视口时，上层可能先撤掉 autoplay playback 快照，
             * 下一轮可见性裁决才会重新回灌。这个短窗口不能退回 poster：
             * 保存位置的 src 来自刚才那颗真实 `<video>` 的当前模板源，只作为同源续帧画面，
             * 不打开 original 冷源，也不产生第二条播放真相。
             */
            const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
            const knownReadyTimelineFrameSrc = context.读取时间线视频已就绪首帧预览源(
              attachment.attachmentId
            );
            const shouldReuseSavedTimelineFrameAsPreview =
              context.读取保存续帧是否允许承接时间线预览底板({
                attachmentId: attachment.attachmentId,
                playback,
                playbackTimelineVideoSrc,
                savedTimelineFrameSrc,
              });
            const timelinePreviewVideoSrcCandidate =
              playbackTimelineVideoSrc ??
              (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
              knownReadyTimelineFrameSrc;
            const videoBudget = context.读取时间线视频预算投影(
              attachment,
              timelinePreviewVideoSrcCandidate
            );
            /**
             * 时间线真正消费的是“统一预算投影 + 本地连续性桥”：
             * 1. canonical / preview 谁能露、谁该藏，先看编排层收口后的预算裁决；
             * 2. `savedTimelineFrameSrc` 只在预算没有 preview src 时兜住刚退场 owner 的同源续帧；
             * 3. `knownReadyTimelineFrameSrc` 只在高速虚拟回滑遇到冷快照时承接已经出过的同源首帧；
             * 4. 这样消息窗就不再自己重算第二套 owner 逻辑，只负责把预算真相投影成 DOM。
             */
            const timelinePreviewVideoSrc =
              videoBudget.previewVideoSrc ??
              (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
              knownReadyTimelineFrameSrc;
            const ownerCanonicalVideoSrc = videoBudget.canonicalVideoSrc;
            const shouldRenderInlineVideo =
              videoBudget.allowInlineCanonical && Boolean(ownerCanonicalVideoSrc);
            const shouldRevealCanonicalHost =
              shouldRenderInlineVideo &&
              context.读取时间线唯一播放器是否可见接管就绪(
                attachment.attachmentId,
                ownerCanonicalVideoSrc
              );
            /**
             * preview 底板只认 preview 真相，不再因为当前变成 owner 就自动借用 canonical 播放源：
             * 1. owner 自己是否可播，交给 `ownerCanonicalVideoSrc`；
             * 2. 底板是否可见，只看真正允许的 preview 来源；
             * 3. 这样 `missing_source` 场景就不会再把冷 paused `<video>` 冒充成可见 cover。
             */
            const previewVideoSrc = timelinePreviewVideoSrc;
            const restorableTimelineFrame = context.读取自动播恢复位置(
              attachment.attachmentId,
              previewVideoSrc
            );
            const isRecentlyReleasedOwnerWithPosition =
              attachment.attachmentId === context.最近退场Owner附件Id;
            const hasExistingSameSourcePreviewFrame =
              context.读取时间线现有预览视频是否可继续显示(
                attachment.attachmentId,
                previewVideoSrc
              );
            const frozenTimelineFrame = context.读取时间线自动播冻结帧(
              attachment.attachmentId,
              previewVideoSrc ?? ownerCanonicalVideoSrc,
              restorableTimelineFrame
            );
            const hasFrozenTimelineFrame = Boolean(frozenTimelineFrame);
            const hasKnownReadyPreviewFrame = context.读取时间线视频首帧是否就绪(
              attachment.attachmentId,
              previewVideoSrc
            );
            const hasCurrentDomPreviewFrame = hasExistingSameSourcePreviewFrame;
            const normalizedPreviewVideoSrc =
              context.归一化时间线视频播放源(previewVideoSrc);
            const normalizedSavedTimelineFrameSrc =
              context.归一化时间线视频播放源(savedTimelineFrameSrc);
            const normalizedOwnerCanonicalVideoSrc =
              context.归一化时间线视频播放源(ownerCanonicalVideoSrc);
            const hasHistoricalCanonicalReveal =
              Boolean(normalizedOwnerCanonicalVideoSrc) &&
              context.时间线唯一播放器可见接管就绪源.get(attachment.attachmentId) ===
                normalizedOwnerCanonicalVideoSrc;
            const hasSameSourceSavedTimelineFrame = Boolean(
              normalizedPreviewVideoSrc &&
                normalizedSavedTimelineFrameSrc &&
                normalizedPreviewVideoSrc === normalizedSavedTimelineFrameSrc
            );
            const playbackContinuityDecision = 判定播放连续性表面({
              attachmentId: attachment.attachmentId,
              ownerAttachmentId: context.inlineAutoplayOwnerAttachmentId,
              surface: "timeline",
              source: { src: previewVideoSrc ?? ownerCanonicalVideoSrc },
              savedPosition: savedTimelineFrame,
              dom: {
                previewReadyState:
                  hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame ? 2 : 0,
                canonicalReadyState: shouldRevealCanonicalHost ? 3 : 0,
                sourceMatches:
                  hasSameSourceSavedTimelineFrame ||
                  hasExistingSameSourcePreviewFrame ||
                  hasFrozenTimelineFrame ||
                  hasHistoricalCanonicalReveal,
              },
              host: {
                exists: true,
                hasStableFrame:
                  hasExistingSameSourcePreviewFrame ||
                  hasFrozenTimelineFrame ||
                  hasKnownReadyPreviewFrame ||
                  shouldReuseSavedTimelineFrameAsPreview ||
                  hasHistoricalCanonicalReveal,
              },
              intent: { viewerOpen: false, fullscreen: false },
            });
            /**
             * 同源续播证据已经存在时，poster 不再是“安全兜底”，而是闪烁源：
             * 1. 保存位置、当前首帧、历史 canonical 接管都属于同一条播放连续性；
             * 2. 外层 poster 会把“滑回续播”拆成 poster -> video 两拍；
             * 3. 没有同源连续性证据的普通冷预览仍保留 poster，避免裸露黑色 video。
             */
            const shouldSuppressPosterForContinuity =
              (shouldReuseSavedTimelineFrameAsPreview ||
                hasFrozenTimelineFrame ||
                hasHistoricalCanonicalReveal) &&
              (playbackContinuityDecision.kind === "hidden_handoff" ||
                playbackContinuityDecision.kind === "hold_frame" ||
                playbackContinuityDecision.kind === "visible_canonical");
            /**
             * 续播暂停帧是时间线自动播的视觉连续性底板，不是“等待用户点击播放”的静态封面。
             * 如果这里继续叠播放图标，owner 交接第一拍会先露一个中心图标再切成播放画面，
             * 肉眼看到的就是滑入/滑出时的闪一下。
             */
            const shouldShowTimelinePlayIndicator =
              !shouldRenderInlineVideo &&
              !isRecentlyReleasedOwnerWithPosition &&
              !shouldReuseSavedTimelineFrameAsPreview &&
              !hasSameSourceSavedTimelineFrame &&
              !restorableTimelineFrame &&
              !hasExistingSameSourcePreviewFrame &&
              !hasFrozenTimelineFrame &&
              !hasKnownReadyPreviewFrame;
            const shouldRenderReleasedOwnerPreviewVideo =
              Boolean(previewVideoSrc) &&
              isRecentlyReleasedOwnerWithPosition &&
              !playback &&
              videoBudget.formalByteSource === "none" &&
              shouldReuseSavedTimelineFrameAsPreview &&
              hasSameSourceSavedTimelineFrame &&
              !hasFrozenTimelineFrame;
            const shouldRenderPreviewVideoByBudget =
              (Boolean(previewVideoSrc) &&
                context.读取时间线预览视频是否允许渲染(videoBudget, {
                  hasExistingSameSourcePreviewFrame,
                  hasFrozenTimelineFrame,
                  hasKnownReadyPreviewFrame,
                  previewVideoSrc,
                  shouldReuseSavedTimelineFrameAsPreview,
                }) &&
                (可渲染真实预览视频附件.has(attachment.attachmentId) ||
                  hasExistingSameSourcePreviewFrame ||
                  hasFrozenTimelineFrame ||
                  hasKnownReadyPreviewFrame)) ||
              /**
               * 刚退场 owner 是“这一拍从 live player 退下来的当前会话”，不是普通历史冷卡片。
               * 真实冻结帧导出是异步的；在它写入前，必须继续挂同源 preview video 承接恢复位置，
               * 不能让统一预算里短暂的 cold_expression 把画面打回 poster。
               */
              shouldRenderReleasedOwnerPreviewVideo;
            const hasStablePreviewPosterSurface = hasSourcePoster || hasRuntimePreview;
            /**
             * 源级首帧缓存只说明“这个 WebTorrent src 曾经成功出帧”，
             * 不说明“这颗刚重新挂载的 DOM video 当前已经有像素”：
             * 1. 有当前 DOM 首帧时才移除 video 自身 poster，避免首帧前裸露黑块；
             * 2. 外层 `<img class="message-video-poster">` 会造成 img/video 两个表面互换，连续性链路中必须压掉；
             * 3. `<video poster>` 属于同一个 DOM 表面的冷保护，不会制造外层卡片闪回。
             */
            const shouldShowFirstFrameGuard =
              shouldRenderPreviewVideoByBudget &&
              !hasCurrentDomPreviewFrame &&
              !hasFrozenTimelineFrame &&
              !hasStablePreviewPosterSurface;
            const hasReadyPreviewSurface =
              hasStablePreviewPosterSurface ||
              hasCurrentDomPreviewFrame ||
              hasFrozenTimelineFrame;
            /**
             * hidden stage 只在“目标卡片当前已经有一张能继续顶住像素的预览视频”时启用：
             * 1. 明确跨附件 handoff 时，先保留现有预览帧，让 canonical player 在隐藏宿主完成 source/time 对齐；
             * 2. 历史 reveal 缓存存在但当前 DOM 不 ready 时，也要回到隐藏宿主重新校验；
             * 3. 普通初次 owner 获取不走这条路，避免把自动播体验拖成长时间静止态；
             * 4. 没有稳定 poster/preview 底板时也不启用 hidden stage，因为没有可继续顶住的像素。
             */
            const shouldUseHiddenStageCover =
              shouldRenderInlineVideo &&
              hasReadyPreviewSurface &&
              !shouldRevealCanonicalHost &&
              (context.时间线隐藏接管附件Id === attachment.attachmentId ||
                hasHistoricalCanonicalReveal);
            /**
             * 这里单独补的是“初次冷 owner 黑卡误露”这一个洞，不扩大成通用裁决：
             * 1. 仅当当前 attachment 首次拿到 owner，且时间线 playback 事实还没回灌，同时没有真实海报、运行时预览、冻结帧、同源续帧或已就绪首帧时触发；
             * 2. 默认占位 poster 只是冷态表达，不算稳定像素底板，不能据此把 canonical player 直接挂到可见卡片；
             * 3. 一旦已有真实海报、既有 preview/frame，或已经进入显式 handoff 路径，就回到原本通过回归的显露规则，
             *    避免把正常 owner 交接、missing_source 护栏和同附件滑回一起打坏。
             */
            const shouldStageWarmupColdInitialOwnerCanonical =
              shouldRenderInlineVideo &&
              !shouldRevealCanonicalHost &&
              !playback &&
              context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
              context.时间线隐藏接管附件Id !== attachment.attachmentId &&
              !hasHistoricalCanonicalReveal &&
              !hasStablePreviewPosterSurface &&
              !hasCurrentDomPreviewFrame &&
              !hasFrozenTimelineFrame &&
              !hasKnownReadyPreviewFrame &&
              !shouldReuseSavedTimelineFrameAsPreview;
            const shouldRenderStageHost =
              !shouldRevealCanonicalHost &&
              (shouldUseHiddenStageCover || shouldStageWarmupColdInitialOwnerCanonical);
            const shouldRenderVisibleCanonicalHost =
              shouldRenderInlineVideo &&
              (!shouldUseHiddenStageCover &&
                !shouldStageWarmupColdInitialOwnerCanonical);
            const shouldRenderPreviewVideo =
              shouldRenderPreviewVideoByBudget &&
              !shouldRenderVisibleCanonicalHost &&
              (!isRecentlyReleasedOwnerWithPosition ||
                shouldRenderReleasedOwnerPreviewVideo);
            const shouldRenderFrozenTimelineFrame =
              hasFrozenTimelineFrame &&
              !hasCurrentDomPreviewFrame &&
              (!shouldRenderInlineVideo || !shouldRevealCanonicalHost);
            /**
             * 冷 owner 进入 hidden stage 预热后，preview `<video>` 可以先挂出来接住 autoplay owner，
             * 但在它自己还没拿到当前 DOM 首帧前，外层 canonical cover 不能撤：
             * 1. 否则用户会先看到“默认 poster -> 黑色/空白 preview video -> 正式 canonical”三拍；
             * 2. 这里要求同时满足 hidden stage、首帧 guard、没有稳定 poster 底板，避免把普通 preview 都误压成 cover；
             * 3. 一旦当前 DOM 首帧就绪，或 canonical host 真正 ready，可见 cover 会按原有 reveal gate 自然撤掉。
             */
            const shouldKeepCanonicalCoverDuringGuardedPreviewWarmup =
              shouldRenderInlineVideo &&
              shouldRenderPreviewVideo &&
              shouldRenderStageHost &&
              shouldShowFirstFrameGuard &&
              !hasStablePreviewPosterSurface &&
              !hasCurrentDomPreviewFrame &&
              !hasFrozenTimelineFrame;
            const shouldRenderCanonicalLoadingPosterCover =
              shouldRenderInlineVideo &&
              !shouldRevealCanonicalHost &&
              !shouldRenderFrozenTimelineFrame &&
              !hasCurrentDomPreviewFrame &&
              Boolean(previewPosterSrc) &&
              !(shouldRenderVisibleCanonicalHost && hasKnownReadyPreviewFrame) &&
              (!shouldRenderPreviewVideo ||
                shouldKeepCanonicalCoverDuringGuardedPreviewWarmup);
            const shouldRenderPreviewPosterSurface =
              (hasStablePreviewPosterSurface &&
                !shouldSuppressPosterForContinuity &&
                !isRecentlyReleasedOwnerWithPosition &&
                !shouldReuseSavedTimelineFrameAsPreview &&
                !hasSameSourceSavedTimelineFrame &&
                !hasFrozenTimelineFrame &&
                !hasCurrentDomPreviewFrame &&
                (!shouldRenderInlineVideo || !shouldRevealCanonicalHost)) ||
              shouldRenderCanonicalLoadingPosterCover;
            const previewVideoPoster =
              !hasFrozenTimelineFrame &&
              !hasCurrentDomPreviewFrame &&
              (hasSourcePoster || hasRuntimePreview)
                ? previewPosterSrc
                : undefined;
            const 时间线预览底板视频 = html`
              <video
                class=${`message-video-preview${
                  shouldShowFirstFrameGuard ? " message-video-preview--gated" : ""
                }`}
                data-attachment-id=${attachment.attachmentId}
                data-preview-src=${normalizedPreviewVideoSrc ?? ""}
                src=${previewVideoSrc ?? ""}
                width=${attachment.displayWidth}
                height=${attachment.displayHeight}
                muted
                playsinline
                preload="metadata"
                disablepictureinpicture
                disableremoteplayback
                controlslist="nodownload nofullscreen noremoteplayback"
                tabindex="-1"
                aria-hidden="true"
                poster=${ifDefined(previewVideoPoster)}
                @loadedmetadata=${(event: Event) => {
                  const target = event.currentTarget;
                  if (!(target instanceof HTMLVideoElement)) {
                    return;
                  }
                  context.恢复时间线自动播播放位置(attachment.attachmentId, target, {
                    allowPreviewFrame: Boolean(restorableTimelineFrame),
                  });
                }}
                @loadeddata=${(event: Event) => {
                  const target = event.currentTarget;
                  if (!(target instanceof HTMLVideoElement)) {
                    return;
                  }
                  标记当前预览视频已出首帧(context, attachment.attachmentId, target);
                }}
                @canplay=${(event: Event) => {
                  const target = event.currentTarget;
                  if (!(target instanceof HTMLVideoElement)) {
                    return;
                  }
                  标记当前预览视频已出首帧(context, attachment.attachmentId, target);
                }}
                @playing=${(event: Event) => {
                  const target = event.currentTarget;
                  if (!(target instanceof HTMLVideoElement)) {
                    return;
                  }
                  标记当前预览视频已出首帧(context, attachment.attachmentId, target);
                }}
                @error=${() => {
                  /**
                   * 时间线非 owner 的 `<video>` 只是首帧/静态预览壳：
                   * - 它失败时不代表“当前活跃播放会话”失败；
                   * - 若这里也广播 PLAYER_ERROR，会把 owner 侧恢复链路放大成抖动重试；
                   * - 所以只允许 owner 那颗 canonical player 上抛错误，预览壳保持静默退避。
                   */
                }}
              ></video>
            `;
            const 时间线视频预览内容 = html`
              ${shouldRenderFrozenTimelineFrame
                ? html`
                    <img
                      class="message-video-frozen-frame"
                      data-attachment-id=${attachment.attachmentId}
                      src=${frozenTimelineFrame?.dataUrl ?? ""}
                      alt=""
                      width=${attachment.displayWidth}
                      height=${attachment.displayHeight}
                      loading="eager"
                      aria-hidden="true"
                    />
                  `
                : null}
              ${shouldRenderVisibleCanonicalHost
                ? html`
                    <div
                      class="message-video-canonical-host"
                      data-attachment-id=${attachment.attachmentId}
                      data-video-kind=${视频地址属于旧流媒体清单(ownerCanonicalVideoSrc) ? "legacy_stream" : "file"}
                      data-video-src=${ownerCanonicalVideoSrc ?? ""}
                      data-video-poster=${previewVideoPoster ?? ""}
                      data-video-width=${attachment.width}
                      data-video-height=${attachment.height}
                      aria-hidden="true"
                    ></div>
                  `
                : null}
              ${shouldRenderPreviewVideo ? 时间线预览底板视频 : null}
              ${shouldRenderPreviewPosterSurface
                ? html`
                    <img
                      class=${`message-video-poster${
                        shouldRenderInlineVideo && !shouldRevealCanonicalHost
                          ? " message-video-poster--canonical-cover"
                          : ""
                      }`}
                      data-attachment-id=${attachment.attachmentId}
                      src=${previewPosterSrc}
                      alt="视频封面"
                      width=${attachment.displayWidth}
                      height=${attachment.displayHeight}
                      loading="lazy"
                      aria-hidden="true"
                      @error=${(event: Event) =>
                        context.标记视频封面加载失败(attachment.attachmentId, event)}
                    />
                  `
                : null}
              ${shouldRenderStageHost
                ? html`
                    <div
                      class="message-video-canonical-stage-host"
                      data-stage-host="true"
                      data-attachment-id=${attachment.attachmentId}
                      data-video-kind=${视频地址属于旧流媒体清单(ownerCanonicalVideoSrc) ? "legacy_stream" : "file"}
                      data-video-src=${ownerCanonicalVideoSrc ?? ""}
                      data-video-poster=${previewVideoPoster ?? ""}
                      data-video-width=${attachment.width}
                      data-video-height=${attachment.height}
                      style="position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;"
                      aria-hidden="true"
                    ></div>
                  `
                : null}
            `;
            /**
             * 时间线视频卡片保持单入口（点击后统一进查看器）：
             * 1. steady-state 可见 preview 只认 preview truth：静态 poster/runtime preview，或 continuity bridge 保下来的暂停帧；
             * 2. 正式 playback 源属于 canonical owner / hidden-stage，禁止再泄漏成非 owner 的冷 `<video>`；
             * 3. 没有任何 preview surface 时，才允许直接暴露 canonical owner，并用轻量 guard 兜住首帧；
             * 4. owner 交接前若目标卡片已经有稳定 preview，就先保留它；canonical player 在隐藏宿主切源就绪后再揭帘；
             * 5. 没有 source bytes 时继续稳态占位，不偷走 original 直读链。
             */
            return html`
              <div
                class="message-attachment-card message-video-card"
                data-attachment-id=${attachment.attachmentId}
                data-budget-tier=${videoBudget.tier}
                data-budget-reason=${videoBudget.reason}
                data-formal-byte-source=${videoBudget.formalByteSource}
                data-grid-column-start=${attachment.gridColumnStart ?? ""}
                data-grid-column-span=${attachment.gridColumnSpan ?? ""}
                data-grid-row-start=${attachment.gridRowStart ?? ""}
                data-grid-row-span=${attachment.gridRowSpan ?? ""}
                style=${attachmentCardStyle}
              >
                <button
                  class="message-video-preview-trigger"
                  type="button"
                  data-attachment-id=${attachment.attachmentId}
                  aria-label="观看视频"
                  @contextmenu=${context.阻止时间线媒体预览原生菜单}
                  @click=${(event: Event) =>
                    context.打开媒体查看器(event, attachment.attachmentId)}
                >
                  ${shouldRenderPreviewVideo ||
                  shouldRenderFrozenTimelineFrame ||
                  shouldRenderPreviewPosterSurface ||
                  shouldRenderInlineVideo
                    ? html`
                        ${时间线视频预览内容}
                        ${shouldRenderPreviewVideo && shouldShowFirstFrameGuard
                          ? html`
                              <img
                                class="message-video-first-frame-guard"
                                data-attachment-id=${attachment.attachmentId}
                                src=${默认视频清单占位Poster}
                                alt=""
                                width=${attachment.displayWidth}
                                height=${attachment.displayHeight}
                                loading="lazy"
                                aria-hidden="true"
                              />
                            `
                          : null}
                        ${shouldRenderInlineVideo
                          ? null
                          : shouldShowTimelinePlayIndicator
                            ? html`
                                <span class="message-video-play-indicator" aria-hidden="true">▶</span>
                              `
                            : null}
                      `
                    : html`
                        <img
                          class="message-video-poster"
                          data-attachment-id=${attachment.attachmentId}
                          src=${previewPosterSrc}
                          alt="视频封面"
                          width=${attachment.displayWidth}
                          height=${attachment.displayHeight}
                          loading="lazy"
                          aria-hidden="true"
                          @error=${(event: Event) =>
                            context.标记视频封面加载失败(attachment.attachmentId, event)}
                        />
                        <span class="message-video-play-indicator" aria-hidden="true">▶</span>
                      `}
                </button>
                ${渲染媒体提示(attachment.attachmentId, playback)}
              </div>
            `;
          }
          return html`
            <div
              class="message-attachment-card message-image-card"
              data-attachment-id=${attachment.attachmentId}
              data-grid-column-start=${attachment.gridColumnStart ?? ""}
              data-grid-column-span=${attachment.gridColumnSpan ?? ""}
              data-grid-row-start=${attachment.gridRowStart ?? ""}
              data-grid-row-span=${attachment.gridRowSpan ?? ""}
              style=${attachmentCardStyle}
            >
              ${(() => {
                const imagePreviewSrc =
                  // 图片一旦有正式 WebTorrent 播放源，时间线可见像素必须直接吃这条源；
                  // thumbnail/original 只能服务未拿到 swarm 的冷启动或 legacy 表达，不能继续浪费已缓存 piece。
                  playback?.mode === "swarm"
                    ? playback.src
                    : playback?.thumbnailUrl ??
                      (playback?.mode === "anchor"
                        ? playback.src
                        : 默认图片清单占位图);
                return html`
                  <button
                    class="message-image-preview-trigger"
                    type="button"
                    data-attachment-id=${attachment.attachmentId}
                    aria-label="查看图片原图"
                    @click=${(event: Event) =>
                      context.打开媒体查看器(event, attachment.attachmentId)}
                  >
                    <img
                      class="message-image"
                      data-attachment-id=${attachment.attachmentId}
                      src=${imagePreviewSrc}
                      alt="图片附件"
                      width=${attachment.displayWidth}
                      height=${attachment.displayHeight}
                      loading="lazy"
                      @error=${() =>
                        context.广播媒体会话信号(attachment.attachmentId, {
                          // 图片虽然没有 video 的 waiting/stalled，但“当前渲染源已经失效”这件事是同一种恢复信号。
                          // 这里统一回抛到媒体会话 owner，由 owner 决定是否重取 swarm/anchor，
                          // 避免壳层再长一套图片专属恢复分支。
                          type: "PLAYER_ERROR",
                        })}
                    />
                  </button>
                `;
              })()}
              ${渲染媒体提示(attachment.attachmentId, playback)}
            </div>
          `;
        })}
      </div>
    `;
};
