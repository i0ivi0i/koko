import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { 判定播放连续性表面 } from "../媒体/视频可见槽位协议.js";
import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import { 标记当前预览视频已出首帧 } from "./视频首帧桥接.js";
import {
  绘制时间线冻结帧到画布,
  type 时间线自动播冻结帧,
} from "./视频桥接帧.js";
import { 默认视频清单占位Poster } from "./视频表面占位.js";
import type { 消息展示项 } from "./视图.js";

export type 时间线视频附件 = Extract<
  消息展示项["attachments"][number],
  { kind: "video" }
>;

export type 视频附件渲染宿主 = {
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
  最近退场Owner附件Id: string | null;
  时间线隐藏接管附件Id: string | null;
  时间线唯一播放器可见接管就绪源: Map<string, string>;
  读取时间线视频预览状态(attachmentId: string): 视频预览状态 | null;
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
  读取时间线唯一播放器可见宿主是否已出帧(attachmentId: string, src: string | null): boolean;
  读取自动播恢复位置(attachmentId: string, src: string | null): 媒体播放位置 | null;
  读取时间线现有预览视频是否可继续显示(attachmentId: string, src: string | null): boolean;
  读取时间线现有预览帧证据(
    attachmentId: string,
    src: string | null
  ): { src: string; currentTime: number } | null;
  读取时间线自动播冻结帧(
    attachmentId: string,
    src: string | null,
    position: 媒体播放位置 | null
  ): 时间线自动播冻结帧 | null;
  捕获时间线自动播冻结帧(
    attachmentId: string,
    video: HTMLVideoElement,
    options?: { 预热已合成帧?: boolean; 立即提交?: boolean }
  ): void;
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

export const 渲染视频附件 = (
  context: 视频附件渲染宿主,
  input: {
    attachment: 时间线视频附件;
    playback: 媒体播放结果 | null;
    attachmentCardStyle: string;
    可渲染真实预览视频附件: Set<string>;
    渲染媒体提示(attachmentId: string, playback: 媒体播放结果 | null): unknown;
  }
) => {
  const { attachment, playback } = input;
  const previewState = context.读取时间线视频预览状态(attachment.attachmentId);
  const isPreviewMissingSource = previewState?.phase === "missing_source";
  const runtimePreview = context.读取时间线视频运行时预览(attachment.attachmentId);
  const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
  const hasRuntimePreview = Boolean(runtimePreview);
  /**
   * 可见槽位里的静态 bridge 必须优先吃“最新、最贴近真实画面”的投影：
   * 1. runtime preview 来自同一附件字节已经真实解出的帧，比上传后长期不变的 poster/still 更新鲜；
   * 2. 如果这里继续优先露旧 poster，用户快滑进入自动播时看到的就会是“旧封面 -> 黑一拍 -> 真视频”；
   * 3. 因此只要 runtime preview 已经 ready，就让它盖过静态 poster，直到 canonical 自己提交可见帧。
   *
   * 注意这不是第二媒体真相：
   * - runtime preview 只是唯一正式视频链导出的静态桥接帧；
   * - 真正的 live owner 仍然只有同一颗 canonical Video.js player。
   */
  const previewPosterSrc =
    runtimePreview?.src ?? context.读取时间线视频封面地址(attachment, playback);
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
  /** owner 刚滑出视口时，保存续帧只准承接同源画面，不准长第二条读取链。 */
  const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
  const knownReadyTimelineFrameSrc = context.读取时间线视频已就绪首帧预览源(attachment.attachmentId);
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
  const videoBudget = context.读取时间线视频预算投影(attachment, timelinePreviewVideoSrcCandidate);
  const ownerCanonicalVideoSrc = videoBudget.canonicalVideoSrc;
  const shouldRenderInlineVideo =
    !isPreviewMissingSource &&
    videoBudget.allowInlineCanonical &&
    Boolean(ownerCanonicalVideoSrc);
  /** 时间线先吃统一预算，再用同源续帧/已就绪首帧做本地连续性桥。 */
  const timelinePreviewVideoSrc =
    videoBudget.previewVideoSrc ??
    /**
     * 新 owner 刚刚接管时，`inlineAutoplayPlayback` 往往比通用 playback 更早落到当前卡片：
     * 1. 如果 preview 还坚持只等通用 playback，卡片会先退成默认 poster/黑壳；
     * 2. 这里允许 preview bridge 直接复用同一条正式 canonical src，只承担揭帘前的同源连续性；
     * 3. live player 仍然只有那颗全局唯一 canonical，preview 只是它的同源 bridge。
     */
    (shouldRenderInlineVideo ? ownerCanonicalVideoSrc : null) ??
    (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
    knownReadyTimelineFrameSrc;
  const previewVideoSrc = timelinePreviewVideoSrc;
  const restorableTimelineFrame = context.读取自动播恢复位置(
    attachment.attachmentId,
    previewVideoSrc
  );
  const isRecentOwnerContinuityBridge =
    attachment.attachmentId === context.最近退场Owner附件Id;
  const isRetiringReleasedOwner =
    isRecentOwnerContinuityBridge &&
    context.inlineAutoplayOwnerAttachmentId !== attachment.attachmentId;
  const previewFrameEvidence = context.读取时间线现有预览帧证据(
    attachment.attachmentId,
    previewVideoSrc
  );
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
  const normalizedPreviewVideoSrc = context.归一化时间线视频播放源(previewVideoSrc);
  const normalizedSavedTimelineFrameSrc =
    context.归一化时间线视频播放源(savedTimelineFrameSrc);
  const normalizedOwnerCanonicalVideoSrc =
    context.归一化时间线视频播放源(ownerCanonicalVideoSrc);
  const hasVisibleCanonicalCommittedFrame = context.读取时间线唯一播放器可见宿主是否已出帧(
    attachment.attachmentId,
    ownerCanonicalVideoSrc
  );
  const shouldRevealCanonicalHost =
    shouldRenderInlineVideo && hasVisibleCanonicalCommittedFrame;
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
      previewReadyState: hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame ? 2 : 0,
      canonicalReadyState: shouldRevealCanonicalHost ? 3 : 0,
      previewCommitted: hasExistingSameSourcePreviewFrame,
      canonicalCommitted: hasVisibleCanonicalCommittedFrame,
      sourceMatches: hasSameSourceSavedTimelineFrame || hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame || hasHistoricalCanonicalReveal,
    },
    host: {
      exists: true,
      hasStableFrame: hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame || shouldReuseSavedTimelineFrameAsPreview || hasHistoricalCanonicalReveal,
    },
    frameEvidence: frozenTimelineFrame
      ? {
          kind: "frozen_frame",
          src: frozenTimelineFrame.src,
          currentTime: frozenTimelineFrame.currentTime,
        }
      : previewFrameEvidence
        ? {
            kind: "preview_dom",
            src: previewFrameEvidence.src,
            currentTime: previewFrameEvidence.currentTime,
          }
      : { kind: "none" },
    intent: {
      viewerOpen: false,
      fullscreen: false,
      retiringOwner: isRetiringReleasedOwner,
    },
  });
  const shouldPreferRetiringOwnerPreviewSurface =
    isRetiringReleasedOwner &&
    playbackContinuityDecision.kind === "retiring_hold_frame";
  const shouldSuppressPosterForContinuity =
    (Boolean(restorableTimelineFrame) || shouldReuseSavedTimelineFrameAsPreview || hasFrozenTimelineFrame || hasHistoricalCanonicalReveal) &&
    (playbackContinuityDecision.kind === "hidden_handoff" ||
      playbackContinuityDecision.kind === "retiring_hold_frame" ||
      playbackContinuityDecision.kind === "hold_frame" ||
      playbackContinuityDecision.kind === "visible_canonical");
  const shouldShowTimelinePlayIndicator =
    !shouldRenderInlineVideo && !isRecentOwnerContinuityBridge &&
    !shouldReuseSavedTimelineFrameAsPreview && !hasSameSourceSavedTimelineFrame && !restorableTimelineFrame &&
    !hasExistingSameSourcePreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame;
  /** 旧 owner 退场时只允许在“无 playback + 无 formal source”的极窄兜底里短暂复用旧 preview bridge。 */
  const shouldRenderReleasedOwnerPreviewVideo =
    Boolean(previewVideoSrc) &&
    isRetiringReleasedOwner &&
    !playback &&
    videoBudget.formalByteSource === "none" &&
    shouldReuseSavedTimelineFrameAsPreview &&
    !hasFrozenTimelineFrame;
  const shouldKeepExistingPreviewDomForRetiringOwner =
    shouldPreferRetiringOwnerPreviewSurface && hasExistingSameSourcePreviewFrame;
  const shouldForceOwnerBridgePreview =
    shouldRenderInlineVideo &&
    !isPreviewMissingSource &&
    Boolean(previewVideoSrc) &&
    previewVideoSrc === ownerCanonicalVideoSrc &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame;
  const shouldRenderPreviewVideoByBudget = (Boolean(previewVideoSrc) && context.读取时间线预览视频是否允许渲染(videoBudget, {
    hasExistingSameSourcePreviewFrame,
    hasFrozenTimelineFrame,
    hasKnownReadyPreviewFrame,
    previewVideoSrc,
    shouldReuseSavedTimelineFrameAsPreview,
  }) && (input.可渲染真实预览视频附件.has(attachment.attachmentId) ||
      hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame || hasKnownReadyPreviewFrame)) ||
    shouldForceOwnerBridgePreview ||
    shouldRenderReleasedOwnerPreviewVideo;
  const hasStablePreviewPosterSurface = hasSourcePoster || hasRuntimePreview;
  /** preview 还没追上续播点时，不能先把错误时间点露给用户。 */
  const shouldSuppressWrongTimePreviewVideo = shouldRenderInlineVideo &&
    playbackContinuityDecision.kind === "hidden_handoff" &&
    Boolean(restorableTimelineFrame) &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame &&
    !hasStablePreviewPosterSurface &&
    !shouldReuseSavedTimelineFrameAsPreview &&
    !shouldRenderReleasedOwnerPreviewVideo;
  const shouldShowFirstFrameGuard = shouldRenderPreviewVideoByBudget &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasStablePreviewPosterSurface;
  const hasReadyPreviewSurface = hasStablePreviewPosterSurface || hasCurrentDomPreviewFrame || hasFrozenTimelineFrame;
  const shouldUseHiddenStageCover = shouldRenderInlineVideo && (hasReadyPreviewSurface || hasKnownReadyPreviewFrame) &&
    !shouldRevealCanonicalHost && (context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId ||
      context.时间线隐藏接管附件Id === attachment.attachmentId || hasHistoricalCanonicalReveal || shouldReuseSavedTimelineFrameAsPreview);
  const shouldStageWarmupGuardedOwnerCanonical = shouldRenderInlineVideo && !shouldRevealCanonicalHost && shouldShowFirstFrameGuard;
  const shouldStageWarmupColdInitialOwnerCanonical = shouldRenderInlineVideo && !shouldRevealCanonicalHost && !playback &&
    context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
    context.时间线隐藏接管附件Id !== attachment.attachmentId &&
    !hasHistoricalCanonicalReveal && !hasStablePreviewPosterSurface &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame &&
    !shouldReuseSavedTimelineFrameAsPreview;
  const shouldRenderStageHost =
    !shouldRevealCanonicalHost &&
    !shouldUseHiddenStageCover &&
    (shouldStageWarmupGuardedOwnerCanonical || shouldStageWarmupColdInitialOwnerCanonical);
  const shouldRenderVisibleCanonicalHost =
    shouldRenderInlineVideo &&
    !shouldPreferRetiringOwnerPreviewSurface &&
    (shouldRevealCanonicalHost || shouldUseHiddenStageCover);
  const shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup =
    shouldRenderVisibleCanonicalHost && !hasVisibleCanonicalCommittedFrame &&
    (hasCurrentDomPreviewFrame || hasFrozenTimelineFrame || shouldReuseSavedTimelineFrameAsPreview || hasStablePreviewPosterSurface);
  /**
   * handoff 期间只允许一个 bridge surface 占着可见槽位：
   * 1. 一旦已经有同源冻结帧，它比 live preview 更稳，因为不会再被 seek / readyState 波动拖着抖；
   * 2. visible canonical 这时仍在后台追 source/time，不该和 preview/frozen 一起争可见位；
   * 3. 因而过渡期固定优先 frozen frame，preview 退回“冷态/稳态预览”职责。
   */
  const shouldPreferFrozenBridgeOverPreview =
    hasFrozenTimelineFrame &&
    (playbackContinuityDecision.kind === "hidden_handoff" ||
      playbackContinuityDecision.kind === "hold_frame" ||
      playbackContinuityDecision.kind === "retiring_hold_frame" ||
      isRetiringReleasedOwner ||
      (shouldRenderInlineVideo && !shouldRevealCanonicalHost));
  const shouldSuppressPosterBackedWarmupPreviewVideo = shouldUseHiddenStageCover && hasStablePreviewPosterSurface &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame;
  const shouldRenderPreviewVideo = shouldRenderPreviewVideoByBudget &&
    !shouldPreferFrozenBridgeOverPreview &&
    !shouldSuppressPosterBackedWarmupPreviewVideo &&
    !shouldSuppressWrongTimePreviewVideo &&
    (!shouldRenderVisibleCanonicalHost || shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup) &&
    (!isRecentOwnerContinuityBridge || shouldRenderReleasedOwnerPreviewVideo || shouldKeepExistingPreviewDomForRetiringOwner);
  const shouldRenderFrozenTimelineFrame =
    hasFrozenTimelineFrame &&
    (shouldPreferFrozenBridgeOverPreview ||
      (!hasCurrentDomPreviewFrame &&
        (!shouldRenderInlineVideo ||
          !shouldRevealCanonicalHost ||
          shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup)));
  const shouldKeepCanonicalCoverDuringGuardedPreviewWarmup = shouldRenderInlineVideo && shouldRenderPreviewVideo &&
    shouldRenderStageHost && shouldShowFirstFrameGuard &&
    !hasStablePreviewPosterSurface && !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame;
  const shouldRenderCanonicalLoadingPosterCover =
    shouldRenderInlineVideo && !shouldPreferRetiringOwnerPreviewSurface &&
    !shouldForceOwnerBridgePreview &&
    !(playbackContinuityDecision.kind === "hidden_handoff" && Boolean(restorableTimelineFrame)) &&
    !shouldRevealCanonicalHost && !shouldRenderFrozenTimelineFrame && !hasCurrentDomPreviewFrame &&
    Boolean(previewPosterSrc) && !(shouldRenderVisibleCanonicalHost && hasKnownReadyPreviewFrame) &&
    (!shouldRenderPreviewVideo || shouldKeepCanonicalCoverDuringGuardedPreviewWarmup);
  const shouldRenderPreviewPosterSurface =
    (hasStablePreviewPosterSurface &&
      !shouldSuppressPosterForContinuity &&
      !isRecentOwnerContinuityBridge &&
      !shouldReuseSavedTimelineFrameAsPreview &&
      !hasSameSourceSavedTimelineFrame &&
      !hasFrozenTimelineFrame &&
      !hasCurrentDomPreviewFrame &&
      (!shouldRenderInlineVideo || !shouldRevealCanonicalHost || shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup)) ||
    shouldRenderCanonicalLoadingPosterCover;
  const previewVideoPoster =
    !shouldPreferRetiringOwnerPreviewSurface &&
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
        if (target instanceof HTMLVideoElement) {
          context.恢复时间线自动播播放位置(attachment.attachmentId, target, {
            allowPreviewFrame: Boolean(restorableTimelineFrame),
          });
        }
      }}
      @loadeddata=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          标记当前预览视频已出首帧(context, attachment.attachmentId, target);
        }
      }}
      @canplay=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          标记当前预览视频已出首帧(context, attachment.attachmentId, target);
        }
      }}
      @playing=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          标记当前预览视频已出首帧(context, attachment.attachmentId, target);
        }
      }}
      @error=${() => {
        // 预览壳失败不代表活跃播放会话失败；错误只由 canonical owner 上抛。
      }}
    ></video>
  `;
  const 时间线视频预览内容 = html`
    ${shouldRenderFrozenTimelineFrame
      ? html`
          <canvas
            class="message-video-frozen-frame"
            data-attachment-id=${attachment.attachmentId}
            data-bridge-src=${frozenTimelineFrame?.src ?? ""}
            data-bridge-time=${frozenTimelineFrame?.currentTime ?? 0}
            width=${attachment.displayWidth}
            height=${attachment.displayHeight}
            aria-hidden="true"
            ${ref((canvas) => {
              if (!(canvas instanceof HTMLCanvasElement) || !frozenTimelineFrame) {
                return;
              }
              绘制时间线冻结帧到画布(frozenTimelineFrame, canvas);
            })}
          ></canvas>
        `
      : null}
    ${shouldRenderVisibleCanonicalHost
      ? html`
          <div
            class="message-video-canonical-host"
            data-attachment-id=${attachment.attachmentId}
            data-covered=${shouldRevealCanonicalHost ? "false" : "true"}
            data-video-kind=${视频地址属于旧流媒体清单(ownerCanonicalVideoSrc)
              ? "archived_stream"
              : "file"}
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
            data-video-kind=${视频地址属于旧流媒体清单(ownerCanonicalVideoSrc)
              ? "archived_stream"
              : "file"}
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
      style=${input.attachmentCardStyle}
    >
      <button
        class="message-video-preview-trigger"
        type="button"
        data-attachment-id=${attachment.attachmentId}
        aria-label="观看视频"
        @contextmenu=${context.阻止时间线媒体预览原生菜单}
        @click=${(event: Event) => context.打开媒体查看器(event, attachment.attachmentId)}
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
                  ? html`<span class="message-video-play-indicator" aria-hidden="true">▶</span>`
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
      ${input.渲染媒体提示(attachment.attachmentId, playback)}
    </div>
  `;
};
