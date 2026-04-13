import { html, LitElement } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { ifDefined } from "lit/directives/if-defined.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { 媒体播放结果 } from "./媒体/媒体播放.js";
import type { 媒体会话信号 } from "./媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "./媒体/媒体查看器.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

type 消息虚拟项 = {
  key: unknown;
  index: number;
  start: number;
};

const 构建视频首帧预览源 = (src: string, posterSrc: string | null): string => {
  // 没有服务端 poster 时，用媒体片段让浏览器预取首帧，避免群聊里出现一片黑的视频卡片。
  if (posterSrc || src.includes("#")) {
    return src;
  }
  return `${src}#t=0.1`;
};

/**
 * 房间消息窗只承接消息视口内部的表达与交互转发：
 * 1. 它渲染消息列表、局部历史提示和“跳到最新”入口；
 * 2. 它把滚动意图、滚动事件和跳转动作回抛给外层壳；
 * 3. 它不持有第二份消息真状态，也不在这里偷写业务判断。
 *
 * 本期故意使用 light DOM：
 * - 现有滚动器、测试和查询入口都依赖 `#messageScroll` / `#messageList` / `[data-event-position]`；
 * - 虚拟列表只决定“哪些行进入 DOM”，消息顺序和 event_position 真相仍来自 Presenter 输入；
 * - 未读分隔线附近的行会被固定保留，避免恢复定位找不到首条未读节点。
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

  private readonly messageScrollRef: Ref<HTMLElement> = createRef();
  private readonly messageVirtualizer = new VirtualizerController<HTMLElement, HTMLElement>(
    this,
    {
      getScrollElement: () => this.messageScrollRef.value ?? null,
      count: 0,
      getItemKey: (index) => this.items[index]?.id ?? index,
      estimateSize: (index) => this.估算消息行高度(index),
      overscan: 30,
      gap: 10,
      initialRect: { width: 360, height: 720 },
      rangeExtractor: (range) => this.提取消息虚拟范围(range),
    }
  );

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

  private dispatchPointerScrollIntent(event: Event): void {
    if (this.事件来自交互控件(event)) {
      return;
    }
    this.dispatchScrollIntent();
  }

  private dispatchScrollIntent(): void {
    this.dispatchEvent(
      new CustomEvent("room-scroll-intent", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private 事件来自交互控件(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }
    // 点图片/视频/按钮是在表达“打开内容”，不是表达“我要翻历史”。
    const interactiveTarget = target.closest(
      "button,a,input,textarea,select,summary,[role='button']"
    );
    return interactiveTarget !== null && interactiveTarget !== event.currentTarget;
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

  private 读取消息虚拟器() {
    const virtualizer = this.messageVirtualizer.getVirtualizer();
    virtualizer.setOptions({
      ...virtualizer.options,
      count: this.items.length,
      getItemKey: (index) => this.items[index]?.id ?? index,
      estimateSize: (index) => this.估算消息行高度(index),
      rangeExtractor: (range) => this.提取消息虚拟范围(range),
    });
    return virtualizer;
  }

  private 估算消息行高度(index: number): number {
    const item = this.items[index];
    if (!item) {
      return 72;
    }
    if (item.kind === "unread-divider") {
      return 28;
    }
    const mediaHeight =
      item.attachments.length > 0
        ? Math.max(...item.attachments.map((attachment) => attachment.displayHeight), 0)
        : 0;
    return Math.max(48, item.layout.height + mediaHeight + 32);
  }

  private 提取消息虚拟范围(range: {
    startIndex: number;
    endIndex: number;
    overscan: number;
    count: number;
  }): number[] {
    const indexes = new Set<number>();
    const start = Math.max(range.startIndex - range.overscan, 0);
    const end = Math.min(range.endIndex + range.overscan, range.count - 1);
    for (let index = start; index <= end; index += 1) {
      indexes.add(index);
    }
    // 恢复到首条未读仍沿用现有滚动器的 DOM 查询入口；
    // 固定保留分隔线和后一条消息，避免大房间初始 range 不包含目标节点。
    const unreadDividerIndex = this.items.findIndex((item) => item.kind === "unread-divider");
    if (unreadDividerIndex >= 0) {
      indexes.add(unreadDividerIndex);
      if (unreadDividerIndex + 1 < this.items.length) {
        indexes.add(unreadDividerIndex + 1);
      }
    }
    return Array.from(indexes).sort((left, right) => left - right);
  }

  private 补齐首帧消息虚拟项(virtualItems: 消息虚拟项[]): 消息虚拟项[] {
    if (virtualItems.length > 0 || this.items.length === 0) {
      return virtualItems;
    }

    // Lit 父壳用属性把消息交给子组件时，首帧可能早于 controller 完成 range 计算。
    // 这里兜一层固定首窗，防止小房间首帧空白；TanStack virtualizer 就绪后会接管后续 range。
    const indexes = this.提取消息虚拟范围({
      startIndex: 0,
      endIndex: Math.min(this.items.length - 1, 30),
      overscan: 30,
      count: this.items.length,
    });
    const starts: number[] = [];
    let offset = 0;
    for (let index = 0; index < this.items.length; index += 1) {
      starts[index] = offset;
      offset += this.估算消息行高度(index) + 10;
    }
    return indexes.map((index) => ({
      key: this.items[index]?.id ?? index,
      index,
      start: starts[index] ?? 0,
    }));
  }

  private 读取附件播放源(attachmentId: string, originalSrc: string): string {
    const playback = this.mediaPlaybackByAttachmentId[attachmentId];
    return playback?.mode === "blob" ||
      playback?.mode === "swarm" ||
      playback?.mode === "anchor" ||
      playback?.mode === "manifest"
      ? playback.src
      : originalSrc;
  }

  private 读取图片查看器播放源(attachmentId: string, originalSrc: string): string {
    const playback = this.mediaPlaybackByAttachmentId[attachmentId];
    return playback?.mode === "blob" ? playback.viewerSrc ?? playback.src : this.读取附件播放源(attachmentId, originalSrc);
  }

  private 读取媒体查看器项目(): 媒体查看器项目[] {
    const items: 媒体查看器项目[] = [];
    for (const item of this.items) {
      if (item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId];
        if (playback?.mode === "expired" || playback?.mode === "degraded") {
          continue;
        }
        if (attachment.kind === "image") {
          items.push({
            kind: "image",
            attachmentId: attachment.attachmentId,
            src: this.读取图片查看器播放源(attachment.attachmentId, attachment.originalSrc),
            alt: "图片附件原图",
            width: attachment.width,
            height: attachment.height,
          });
          continue;
        }
        items.push({
          kind: "video",
          attachmentId: attachment.attachmentId,
          src: this.读取附件播放源(attachment.attachmentId, attachment.originalSrc),
          posterSrc: attachment.posterSrc,
          ...(playback?.mode === "manifest" && playback.streamingDistribution
            ? {
                streamingDistribution: playback.streamingDistribution,
              }
            : {}),
          width: attachment.width,
          height: attachment.height,
        });
      }
    }
    return items;
  }

  private 打开媒体查看器(event: Event, startAttachmentId: string): void {
    event.preventDefault();
    event.stopPropagation();
    const items = this.读取媒体查看器项目();
    if (!items.some((item) => item.attachmentId === startAttachmentId)) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<媒体查看器打开请求>("room-open-media-viewer", {
        detail: {
          startAttachmentId,
          items,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * `video` 元素抛出来的只是浏览器层运行时信号。
   * 这里统一翻译后回抛给外层应用运行时，真正的恢复/等待/降级仍由媒体会话 owner 裁决。
   */
  private 广播媒体会话信号(attachmentId: string, signal: 媒体会话信号): void {
    this.dispatchEvent(
      new CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>(
        "room-media-session-signal",
        {
          detail: {
            attachmentId,
            signal,
          },
          bubbles: true,
          composed: true,
        }
      )
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
            playback?.mode === "swarm" ||
            playback?.mode === "anchor" ||
            playback?.mode === "manifest"
              ? playback.src
              : null;
          if (attachment.kind === "video") {
            const previewPosterSrc = playback?.thumbnailUrl ?? attachment.posterSrc;
            const 应使用Poster占位 =
              playback?.mode === "manifest" && Boolean(previewPosterSrc);
            const videoSrc = 应使用Poster占位 ? null : playbackSrc ?? attachment.originalSrc;
            return html`
              <div class="message-video-card">
                <button
                  class="message-video-preview-trigger"
                  type="button"
                  data-attachment-id=${attachment.attachmentId}
                  aria-label="观看视频"
                  @click=${(event: Event) =>
                    this.打开媒体查看器(event, attachment.attachmentId)}
                >
                  <video
                    class="message-video-preview"
                    data-attachment-id=${attachment.attachmentId}
                    src=${ifDefined(
                      videoSrc
                        ? 构建视频首帧预览源(videoSrc, previewPosterSrc)
                        : undefined
                    )}
                    width=${attachment.displayWidth}
                    height=${attachment.displayHeight}
                    muted
                    playsinline
                    preload="metadata"
                    tabindex="-1"
                    aria-hidden="true"
                    poster=${ifDefined(previewPosterSrc ?? undefined)}
                    @playing=${() =>
                      this.广播媒体会话信号(attachment.attachmentId, {
                        type: "PLAYER_PLAYING",
                      })}
                    @waiting=${() =>
                      this.广播媒体会话信号(attachment.attachmentId, {
                        type: "PLAYER_WAITING",
                      })}
                    @stalled=${() =>
                      this.广播媒体会话信号(attachment.attachmentId, {
                        type: "PLAYER_STALLED",
                      })}
                    @error=${() =>
                      this.广播媒体会话信号(attachment.attachmentId, {
                        type: "PLAYER_ERROR",
                      })}
                  ></video>
                  <span class="message-video-play-indicator" aria-hidden="true">▶</span>
                </button>
                ${渲染媒体提示(attachment.attachmentId, playback)}
              </div>
            `;
          }
          return html`
            <div class="message-image-card">
              ${(() => {
                const imagePreviewSrc =
                  playback?.thumbnailUrl ??
                  attachment.thumbnailSrc ??
                  (playback?.mode === "swarm" || playback?.mode === "anchor"
                    ? playback.src
                    : attachment.originalSrc);
                return html`
                  <button
                    class="message-image-preview-trigger"
                    type="button"
                    data-attachment-id=${attachment.attachmentId}
                    aria-label="查看图片原图"
                    @click=${(event: Event) =>
                      this.打开媒体查看器(event, attachment.attachmentId)}
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
                        this.广播媒体会话信号(attachment.attachmentId, {
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
  }

  private renderVirtualMessageItem(
    item: 聊天列表展示项,
    index: number,
    start: number,
    measureElement: (element: HTMLElement) => void
  ) {
    const rowStyle = `position: absolute; top: 0; left: 0; width: 100%; transform: translateY(${start}px);`;
    const measureRow = (element?: Element): void => {
      if (element instanceof HTMLElement) {
        measureElement(element);
      }
    };
    if (item.kind === "unread-divider") {
      return html`
        <li
          id="unreadDivider"
          class="unread-divider"
          data-kind="unread-divider"
          data-index=${index}
          style=${rowStyle}
          ${ref(measureRow)}
        >
          ${item.label}
        </li>
      `;
    }
    const hasAttachments = item.attachments.length > 0;
    const mediaOnly = !item.hasText && hasAttachments;
    const surfaceClass = hasAttachments
      ? `message-surface media-message ${mediaOnly ? "media-only" : ""}`
      : "message-surface message-bubble";
    return html`
      <li
        class="message-row ${item.owner}"
        data-owner=${item.owner}
        data-event-position=${item.eventPosition}
        data-index=${index}
        style=${rowStyle}
        ${ref(measureRow)}
      >
        <article
          class=${surfaceClass}
          style=${`width: ${item.bubbleWidth}px;`}
        >
          ${item.showAlias
            ? html`<div class="message-alias">${item.senderDisplayAlias}</div>`
            : null}
          ${item.hasText ? this.renderMessageBody(item) : null}
          ${this.renderMessageAttachments(item)}
        </article>
      </li>
    `;
  }

  override render() {
    const virtualizer = this.读取消息虚拟器();
    const virtualItems = this.补齐首帧消息虚拟项(virtualizer.getVirtualItems());
    return html`
      <div
        id="messageScroll"
        class="message-scroll"
        ${ref(this.messageScrollRef)}
        @pointerdown=${(event: Event) => this.dispatchPointerScrollIntent(event)}
        @touchstart=${(event: Event) => this.dispatchPointerScrollIntent(event)}
        @wheel=${() => this.dispatchScrollIntent()}
        @scroll=${(event: Event) => this.dispatchScroll(event)}
      >
        <ul
          id="messageList"
          class="message-list"
          style=${`height: ${virtualizer.getTotalSize()}px; position: relative;`}
        >
          ${repeat(
            virtualItems,
            (virtualItem) => virtualItem.key,
            (virtualItem) => {
              const item = this.items[virtualItem.index];
              if (!item) {
                return null;
              }
              return this.renderVirtualMessageItem(
                item,
                virtualItem.index,
                virtualItem.start,
                (element) => virtualizer.measureElement(element)
              );
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
