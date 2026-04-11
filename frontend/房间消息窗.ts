import { html, LitElement } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { 媒体播放结果 } from "./媒体/媒体播放.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

/**
 * 房间消息窗只承接消息视口内部的表达与交互转发：
 * 1. 它渲染消息列表、局部历史提示和“跳到最新”入口；
 * 2. 它把滚动意图、滚动事件和跳转动作回抛给外层壳；
 * 3. 它不持有第二份消息真状态，也不在这里偷写业务判断。
 *
 * 本期故意使用 light DOM：
 * - 现有滚动器、测试和查询入口都依赖 `#messageScroll` / `#messageList` / `[data-event-position]`；
 * - 先保住这些稳定入口，再逐步把消息窗口边界立起来。
 */
export class 房间消息窗 extends LitElement {
  static override properties = {
    items: { attribute: false },
    historyHint: { type: String },
    jumpToLatestLabel: { type: String },
    mediaPlaybackByAttachmentId: { attribute: false },
  };

  declare items: 聊天列表展示项[];
  declare historyHint: string;
  declare jumpToLatestLabel: string;
  declare mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;

  constructor() {
    super();
    this.items = [];
    this.historyHint = "";
    this.jumpToLatestLabel = "";
    this.mediaPlaybackByAttachmentId = {};
  }

  /**
   * 这里明确不用 shadow root。
   * 目的不是偷懒，而是先保证现有壳层滚动查询和测试入口不失效，
   * 再在同一轮重构里把“消息窗口独立”这条边界立住。
   */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private dispatchScrollIntent(): void {
    this.dispatchEvent(
      new CustomEvent("room-scroll-intent", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private dispatchScroll(event: Event): void {
    this.dispatchEvent(
      new CustomEvent<{ scrollContainer: HTMLElement }>("room-scroll", {
        detail: { scrollContainer: event.currentTarget as HTMLElement },
        bubbles: true,
        composed: true,
      })
    );
  }

  private dispatchJumpToLatest(): void {
    this.dispatchEvent(
      new CustomEvent("jump-to-latest", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderMessageBody(item: 消息展示项) {
    /**
     * 从这里开始，消息正文不再把裸字符串直接交给浏览器自然换行。
     * DOM 只负责表达 Presenter 已经绑定好的布局结果：
     * 1. `.message-body` 这个稳定入口继续保留给现有测试与查询使用；
     * 2. 真正的逐行结果由 `item.layout.lines` 驱动；
     * 3. 每个片段带上种类标记，为后续 rich inline 样式接入留稳定钩子。
     */
    return html`<div class="message-body">${item.layout.lines.map(
      (line) =>
        html`<div class="message-line" data-line-index=${line.index}>${line.segments.map(
          (segment) =>
            html`<span class="message-segment segment-${segment.kind}">${segment.text}</span>`
        )}</div>`
    )}</div>`;
  }

  private renderMessageAttachments(item: 消息展示项) {
    if (item.attachments.length === 0) {
      return null;
    }

    const 读取附件播放结果 = (attachmentId: string): 媒体播放结果 | null =>
      this.mediaPlaybackByAttachmentId[attachmentId] ?? null;

    const 渲染媒体提示 = (attachmentId: string, playback: 媒体播放结果 | null) => {
      if (!playback?.hint) {
        return null;
      }
      return html`
        <div class="message-media-hint" data-media-hint=${attachmentId}>${playback.hint}</div>
      `;
    };

    const 渲染不可用附件 = (attachmentId: string, playback: 媒体播放结果) =>
      html`
        <div class="message-media-unavailable" data-attachment-id=${attachmentId}>
          ${渲染媒体提示(attachmentId, playback)}
        </div>
      `;

    return html`
      <div
        class="message-attachment-grid"
        data-attachment-count=${item.attachments.length}
      >
        ${item.attachments.map((attachment) => {
          const playback = 读取附件播放结果(attachment.attachmentId);
          if (playback?.mode === "expired" || playback?.mode === "degraded") {
            return 渲染不可用附件(attachment.attachmentId, playback);
          }
          const playbackSrc =
            playback?.mode === "swarm" || playback?.mode === "anchor" ? playback.src : null;
          if (attachment.kind === "video") {
            return html`
              <div class="message-video-card">
                <video
                  class="message-video"
                  data-attachment-id=${attachment.attachmentId}
                  src=${playbackSrc ?? attachment.originalSrc}
                  width=${attachment.displayWidth}
                  height=${attachment.displayHeight}
                  controls
                  playsinline
                  preload="metadata"
                  poster=${attachment.posterSrc ?? ""}
                ></video>
                ${渲染媒体提示(attachment.attachmentId, playback)}
              </div>
            `;
          }
          return html`
            <div class="message-image-card">
              ${(() => {
                const imagePlaybackSrc =
                  playback?.mode === "swarm" ||
                  (playback?.mode === "anchor" && playback.hint !== null)
                    ? playback.src
                    : null;
                return html`
                  <a
                    class="message-image-link"
                    href=${imagePlaybackSrc ?? attachment.originalSrc}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      class="message-image"
                      data-attachment-id=${attachment.attachmentId}
                      src=${imagePlaybackSrc ?? attachment.thumbnailSrc}
                      alt="图片附件"
                      width=${attachment.displayWidth}
                      height=${attachment.displayHeight}
                      loading="lazy"
                    />
                  </a>
                `;
              })()}
              ${渲染媒体提示(attachment.attachmentId, playback)}
            </div>
          `;
        })}
      </div>
    `;
  }

  override render() {
    return html`
      <div
        id="messageScroll"
        class="message-scroll"
        @pointerdown=${() => this.dispatchScrollIntent()}
        @touchstart=${() => this.dispatchScrollIntent()}
        @wheel=${() => this.dispatchScrollIntent()}
        @scroll=${(event: Event) => this.dispatchScroll(event)}
      >
        <ul id="messageList" class="message-list">
          ${repeat(
            this.items,
            (item) => item.id,
            (item) => {
              if (item.kind === "unread-divider") {
                return html`
                  <li id="unreadDivider" class="unread-divider" data-kind="unread-divider">
                    ${item.label}
                  </li>
                `;
              }
              return html`
                <li
                  class="message-row ${item.owner}"
                  data-owner=${item.owner}
                  data-event-position=${item.eventPosition}
                >
                  <article class="message-bubble" style=${`width: ${item.bubbleWidth}px;`}>
                    ${item.showAlias
                      ? html`<div class="message-alias">${item.senderDisplayAlias}</div>`
                      : null}
                    ${item.hasText ? this.renderMessageBody(item) : null}
                    ${this.renderMessageAttachments(item)}
                  </article>
                </li>
              `;
            }
          )}
        </ul>
      </div>
      ${this.historyHint
        ? html`
            <div id="messageHistoryHint" class="message-history-hint" role="status">
              ${this.historyHint}
            </div>
          `
        : null}
      ${this.jumpToLatestLabel
        ? html`
            <button
              id="jumpToLatestBtn"
              class="jump-latest-button"
              @click=${() => this.dispatchJumpToLatest()}
            >
              ${this.jumpToLatestLabel}
            </button>
          `
        : null}
    `;
  }
}

customElements.define("koko-room-message-pane", 房间消息窗);
