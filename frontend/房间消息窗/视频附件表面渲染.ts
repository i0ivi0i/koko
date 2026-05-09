import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import {
  绘制时间线冻结帧到画布,
  type 时间线自动播冻结帧,
} from "./视频桥接帧.js";
import { 默认视频清单占位Poster } from "./视频表面占位.js";
import type { 消息展示项 } from "./视图.js";

type 时间线视频附件 = Extract<
  消息展示项["attachments"][number],
  { kind: "video" }
>;

export type 时间线视频表面渲染输入 = {
  attachment: 时间线视频附件;
  attachmentCardStyle: string;
  budgetTier: string;
  budgetReason: string;
  formalByteSource: string;
  previewPosterSrc: string;
  previewVideoSrc: string | null;
  normalizedPreviewVideoSrc: string | null;
  ownerCanonicalVideoSrc: string | null;
  previewVideoPoster: string | undefined;
  frozenTimelineFrame: 时间线自动播冻结帧 | null;
  shouldRenderPreviewVideo: boolean;
  shouldRenderPreviewPosterSurface: boolean;
  shouldRenderFrozenTimelineFrame: boolean;
  shouldRenderVisibleCanonicalHost: boolean;
  shouldRevealCanonicalHost: boolean;
  shouldRenderStageHost: boolean;
  shouldRenderInlineVideo: boolean;
  shouldShowFirstFrameGuard: boolean;
  hasCurrentDomPreviewFrame: boolean;
  shouldShowTimelinePlayIndicator: boolean;
  renderMediaHint: unknown;
  操作: {
    恢复预览位置(video: HTMLVideoElement): void;
    标记预览视频已出首帧(video: HTMLVideoElement): void;
    处理封面加载失败(event: Event): void;
    阻止原生菜单(event: Event): void;
    打开查看器(event: Event): void;
  };
};

/**
 * 这个模块只负责把上一层已经裁决好的可见表面投影成 DOM。
 * owner / 协议 / 冷路径判断仍然留在 `视频附件渲染.ts`，这里不再偷做第二次业务决策。
 */
export const 渲染时间线视频表面卡片 = (input: 时间线视频表面渲染输入) => {
  const {
    attachment,
    attachmentCardStyle,
    budgetTier,
    budgetReason,
    formalByteSource,
    previewPosterSrc,
    previewVideoSrc,
    normalizedPreviewVideoSrc,
    ownerCanonicalVideoSrc,
    previewVideoPoster,
    frozenTimelineFrame,
    shouldRenderPreviewVideo,
    shouldRenderPreviewPosterSurface,
    shouldRenderFrozenTimelineFrame,
    shouldRenderVisibleCanonicalHost,
    shouldRevealCanonicalHost,
    shouldRenderStageHost,
    shouldRenderInlineVideo,
    shouldShowFirstFrameGuard,
    hasCurrentDomPreviewFrame,
    shouldShowTimelinePlayIndicator,
    renderMediaHint,
    操作,
  } = input;

  const 时间线预览底板视频 = html`
    <video
      class=${`message-video-preview${
        shouldShowFirstFrameGuard ? " message-video-preview--gated" : ""
      }${
        hasCurrentDomPreviewFrame ? " message-video-preview--has-frame" : ""
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
          操作.恢复预览位置(target);
        }
      }}
      @loadeddata=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          操作.标记预览视频已出首帧(target);
        }
      }}
      @canplay=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          操作.标记预览视频已出首帧(target);
        }
      }}
      @playing=${(event: Event) => {
        const target = event.currentTarget;
        if (target instanceof HTMLVideoElement) {
          操作.标记预览视频已出首帧(target);
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
            @error=${操作.处理封面加载失败}
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
      data-budget-tier=${budgetTier}
      data-budget-reason=${budgetReason}
      data-formal-byte-source=${formalByteSource}
      style=${attachmentCardStyle}
    >
      <button
        class="message-video-preview-trigger"
        type="button"
        data-attachment-id=${attachment.attachmentId}
        aria-label="观看视频"
        @contextmenu=${操作.阻止原生菜单}
        @click=${操作.打开查看器}
      >
        ${shouldRenderPreviewVideo ||
        shouldRenderFrozenTimelineFrame ||
        shouldRenderPreviewPosterSurface ||
        shouldRenderInlineVideo
          ? html`
              ${时间线视频预览内容}
              ${shouldShowFirstFrameGuard
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
                : (shouldShowTimelinePlayIndicator ||
                    /* 只有 poster、没有任何视频/冻结帧/inline 表面时，播放指示器必须显示 */
                    (!shouldRenderPreviewVideo && !shouldRenderFrozenTimelineFrame && !shouldRenderInlineVideo))
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
                @error=${操作.处理封面加载失败}
              />
              <span class="message-video-play-indicator" aria-hidden="true">▶</span>
            `}
      </button>
      ${renderMediaHint}
    </div>
  `;
};
