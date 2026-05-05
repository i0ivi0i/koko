import { html } from "lit";
import type { 媒体播放结果 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 消息展示项 } from "./视图.js";

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

type 图片附件 = Extract<消息展示项["attachments"][number], { kind: "image" }>;

export type 图片附件渲染宿主 = {
  广播媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  打开媒体查看器(event: Event, startAttachmentId: string): void;
};

export const 渲染图片附件 = (
  context: 图片附件渲染宿主,
  input: {
    attachment: 图片附件;
    playback: 媒体播放结果 | null;
    attachmentCardStyle: string;
    渲染媒体提示(attachmentId: string, playback: 媒体播放结果 | null): unknown;
  }
) => {
  const { attachment, playback } = input;
  const imagePreviewSrc =
    /**
     * 图片渲染只吃媒体 owner 已经投影出来的播放结果。
     * 原始地址和缩略图不是时间线正式像素真相，不能在这里另开冷源入口。
     */
    playback?.mode === "swarm" ? playback.src : 默认图片清单占位图;

  return html`
    <div
      class="message-attachment-card message-image-card"
      data-attachment-id=${attachment.attachmentId}
      data-grid-column-start=${attachment.gridColumnStart ?? ""}
      data-grid-column-span=${attachment.gridColumnSpan ?? ""}
      data-grid-row-start=${attachment.gridRowStart ?? ""}
      data-grid-row-span=${attachment.gridRowSpan ?? ""}
      style=${input.attachmentCardStyle}
    >
      <button
        class="message-image-preview-trigger"
        type="button"
        data-attachment-id=${attachment.attachmentId}
        aria-label="查看图片原图"
        @click=${(event: Event) => context.打开媒体查看器(event, attachment.attachmentId)}
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
              // 图片虽然没有 video 的 waiting/stalled，但“当前渲染源已经失效”是同一种恢复信号。
              // 这里统一回抛到媒体会话 owner，由 owner 决定是否重取正式播放源。
              type: "PLAYER_ERROR",
            })}
        />
      </button>
      ${input.渲染媒体提示(attachment.attachmentId, playback)}
    </div>
  `;
};
