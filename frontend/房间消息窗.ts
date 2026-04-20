import { html, LitElement, type PropertyValues } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { ifDefined } from "lit/directives/if-defined.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { 媒体是否默认循环播放, type 媒体播放结果 } from "./媒体/媒体播放.js";
import type { 消息视频自动播候选 } from "./媒体/消息视频自动播编排.js";
import type { 媒体会话信号 } from "./媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "./媒体/媒体查看器.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

type 消息虚拟项 = {
  key: unknown;
  index: number;
  start: number;
};

/**
 * HLS manifest 不是时间线原生 `<video>` 的可播放文件。
 * 当后端暂时还没有真正的 poster 资产时，这里给一张极轻的 SVG 静态占位图：
 * 1. 不再把 `master.m3u8` 强塞给浏览器导致黑块和转圈；
 * 2. 又不需要为了一个时间线卡片在前端手搓第二套视频截图链；
 * 3. 查看器仍然继续拿正式 manifest 主链，不影响真正播放。
 */
const 默认视频清单占位Poster =
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
    inlineAutoplayOwnerAttachmentId: { type: String },
    inlineAutoplayPlaybackByAttachmentId: { attribute: false },
  };

  declare items: 聊天列表展示项[];
  declare historyHint: string;
  declare jumpToLatestLabel: string;
  declare mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare inlineAutoplayOwnerAttachmentId: string | null;
  declare inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;

  private readonly messageScrollRef: Ref<HTMLElement> = createRef();
  private 自动播候选调度句柄: number | null = null;
  private 自动播候选滚动容器: HTMLElement | null = null;
  private 自动播候选观察根: HTMLElement | null = null;
  private 自动播候选观察器: IntersectionObserver | null = null;
  private readonly 自动播候选观察目标 = new Map<HTMLButtonElement, string>();
  private readonly 自动播候选可见条目 = new Map<string, 消息视频自动播候选>();
  private readonly 失效视频封面地址 = new Map<string, string>();
  private readonly 无封面视频稳定预览源 = new Map<string, string>();
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
    this.inlineAutoplayOwnerAttachmentId = null;
    this.inlineAutoplayPlaybackByAttachmentId = {};
  }

  /**
   * 这里明确不用 shadow root。
   * 目的不是偷懒，而是先保证现有壳层滚动查询和测试入口不失效，
   * 再在同一轮重构里把“消息窗口独立”这条边界立住。
   */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override disconnectedCallback(): void {
    this.取消自动播候选调度();
    this.清理自动播候选观察();
    this.失效视频封面地址.clear();
    this.无封面视频稳定预览源.clear();
    super.disconnectedCallback();
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
    const scrollContainer = event.currentTarget as HTMLElement;
    this.dispatchEvent(
      new CustomEvent<{ scrollContainer: HTMLElement }>("room-scroll", {
        detail: { scrollContainer },
        bubbles: true,
        composed: true,
      })
    );
    this.调度自动播候选(scrollContainer);
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("items")) {
      this.同步无封面视频稳定预览缓存();
    }
    this.同步时间线自动播播放状态(changedProperties);
    const scrollContainer = this.messageScrollRef.value;
    if (!scrollContainer) {
      return;
    }
    if (
      !changedProperties.has("items") &&
      !changedProperties.has("mediaPlaybackByAttachmentId")
    ) {
      return;
    }
    this.同步自动播候选观察(scrollContainer);
    this.调度自动播候选(scrollContainer);
  }

  private 同步时间线自动播播放状态(changedProperties: PropertyValues<this>): void {
    if (
      !changedProperties.has("items") &&
      !changedProperties.has("mediaPlaybackByAttachmentId") &&
      !changedProperties.has("inlineAutoplayOwnerAttachmentId") &&
      !changedProperties.has("inlineAutoplayPlaybackByAttachmentId")
    ) {
      return;
    }
    /**
     * 关键约束：
     * 时间线视频在“同一 src”下从静态预览切到自动播时，仅把 `autoplay=false -> true`
     * 并不保证浏览器一定会立刻开始播放（尤其是节点已存在且处于 paused 状态时）。
     * 因此这里显式补一次 `play()`，并在 owner 退场时显式 `pause()`，
     * 让自动播行为稳定且可预期，避免“看起来是自动播 owner 但画面不动”的回归。
     */
    const previewVideos = this.querySelectorAll<HTMLVideoElement>(
      "video.message-video-preview[data-attachment-id]"
    );
    for (const video of previewVideos) {
      const attachmentId = video.getAttribute("data-attachment-id");
      if (!attachmentId) {
        continue;
      }
      const shouldAutoplay =
        this.inlineAutoplayOwnerAttachmentId === attachmentId && video.autoplay;
      if (shouldAutoplay) {
        if (video.paused) {
          void video.play().catch(() => undefined);
        }
        continue;
      }
      if (!video.paused) {
        video.pause();
      }
    }
  }

  private 同步无封面视频稳定预览缓存(): void {
    const 活跃视频附件 = new Set<string>();
    for (const item of this.items) {
      if (item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (attachment.kind === "video") {
          活跃视频附件.add(attachment.attachmentId);
        }
      }
    }
    for (const attachmentId of this.无封面视频稳定预览源.keys()) {
      if (!活跃视频附件.has(attachmentId)) {
        this.无封面视频稳定预览源.delete(attachmentId);
      }
    }
  }

  private dispatch自动播候选(scrollContainer: HTMLElement): void {
    const candidates = this.读取自动播候选(scrollContainer);
    this.dispatchEvent(
      new CustomEvent<{ candidates: 消息视频自动播候选[] }>("room-inline-autoplay-observed", {
        detail: { candidates },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * 滚动与 Lit 更新会在一帧内连发；这里把候选读取收口到同一帧只跑一次，
   * 避免时间线里每次滚轮抖动都重新全量量测所有视频卡片。
   */
  private 调度自动播候选(scrollContainer: HTMLElement): void {
    this.自动播候选滚动容器 = scrollContainer;
    if (this.自动播候选调度句柄 !== null) {
      return;
    }
    this.自动播候选调度句柄 = window.requestAnimationFrame(() => {
      this.自动播候选调度句柄 = null;
      const nextScrollContainer = this.自动播候选滚动容器;
      this.自动播候选滚动容器 = null;
      if (!nextScrollContainer || !this.isConnected) {
        return;
      }
      this.dispatch自动播候选(nextScrollContainer);
    });
  }

  private 取消自动播候选调度(): void {
    if (this.自动播候选调度句柄 !== null) {
      window.cancelAnimationFrame(this.自动播候选调度句柄);
      this.自动播候选调度句柄 = null;
    }
    this.自动播候选滚动容器 = null;
  }

  private 清理自动播候选观察(): void {
    this.自动播候选观察器?.disconnect();
    this.自动播候选观察器 = null;
    this.自动播候选观察根 = null;
    this.自动播候选观察目标.clear();
    this.自动播候选可见条目.clear();
  }

  /**
   * IntersectionObserver 的首次回调在不同浏览器/帧节奏下可能晚一拍。
   * 这里给新进入观察集的按钮做一次同步热启动量测，避免“视频已经完整进视口，但候选表还是空的”。
   */
  private 量测按钮自动播候选(
    button: HTMLButtonElement,
    viewportRect: DOMRect
  ): 消息视频自动播候选 | null {
    const attachmentId = button.dataset.attachmentId ?? "";
    if (!attachmentId) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, viewportRect.top);
    const visibleBottom = Math.min(rect.bottom, viewportRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      attachmentId,
      visibilityRatio: visibleHeight / rect.height,
      distanceToViewportCenter: Math.abs(
        (rect.top + rect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2
      ),
    };
  }

  /**
   * 列表自动播只关心“真正进入滚动容器视口的少量视频卡片”：
   * 1. Chrome/现代浏览器优先走 IntersectionObserver，避免每帧对整列视频按钮同步量测；
   * 2. 观察器只维护候选快照，真正何时派发仍收口到现有 rAF 节流，不额外发明新 owner；
   * 3. 旧环境缺少观察器时再回退到同步扫描，保证行为不丢。
   */
  private 同步自动播候选观察(scrollContainer: HTMLElement): void {
    if (typeof IntersectionObserver !== "function") {
      this.清理自动播候选观察();
      return;
    }
    if (this.自动播候选观察根 !== scrollContainer) {
      this.清理自动播候选观察();
      this.自动播候选观察根 = scrollContainer;
      this.自动播候选观察器 = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLButtonElement)) {
              continue;
            }
            const button = entry.target;
            const currentAttachmentId = button.dataset.attachmentId ?? "";
            const knownAttachmentId =
              this.自动播候选观察目标.get(button) ?? currentAttachmentId;
            if (knownAttachmentId !== currentAttachmentId && knownAttachmentId !== "") {
              this.自动播候选可见条目.delete(knownAttachmentId);
            }
            if (currentAttachmentId !== "") {
              this.自动播候选观察目标.set(button, currentAttachmentId);
            }
            if (!currentAttachmentId || !entry.isIntersecting || entry.intersectionRatio <= 0) {
              if (currentAttachmentId !== "") {
                this.自动播候选可见条目.delete(currentAttachmentId);
              }
              continue;
            }
            const rootBounds =
              entry.rootBounds ?? this.自动播候选观察根?.getBoundingClientRect() ?? null;
            if (!rootBounds) {
              continue;
            }
            const distanceToViewportCenter = Math.abs(
              (entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2 -
                (rootBounds.top + rootBounds.bottom) / 2
            );
            this.自动播候选可见条目.set(currentAttachmentId, {
              attachmentId: currentAttachmentId,
              visibilityRatio: entry.intersectionRatio,
              distanceToViewportCenter,
            });
          }
          this.调度自动播候选(scrollContainer);
        },
        {
          root: scrollContainer,
          threshold: [0, 0.25, 0.5, 0.75, 1],
        }
      );
    }
    const observer = this.自动播候选观察器;
    if (!observer) {
      return;
    }
    let 视口矩形: DOMRect | null = null;
    const 读取视口矩形 = (): DOMRect => {
      视口矩形 ??= scrollContainer.getBoundingClientRect();
      return 视口矩形;
    };
    const currentButtons = new Set(
      this.querySelectorAll<HTMLButtonElement>(
        "button.message-video-preview-trigger[data-attachment-id]"
      )
    );
    for (const [button, attachmentId] of this.自动播候选观察目标) {
      if (currentButtons.has(button)) {
        continue;
      }
      observer.unobserve(button);
      this.自动播候选观察目标.delete(button);
      if (attachmentId !== "") {
        this.自动播候选可见条目.delete(attachmentId);
      }
    }
    for (const button of currentButtons) {
      const attachmentId = button.dataset.attachmentId ?? "";
      const previousAttachmentId = this.自动播候选观察目标.get(button);
      if (previousAttachmentId === undefined) {
        this.自动播候选观察目标.set(button, attachmentId);
        observer.observe(button);
        const warmCandidate = this.量测按钮自动播候选(button, 读取视口矩形());
        if (warmCandidate) {
          this.自动播候选可见条目.set(attachmentId, warmCandidate);
        } else if (attachmentId !== "") {
          this.自动播候选可见条目.delete(attachmentId);
        }
        continue;
      }
      if (previousAttachmentId !== attachmentId) {
        if (previousAttachmentId !== "") {
          this.自动播候选可见条目.delete(previousAttachmentId);
        }
        this.自动播候选观察目标.set(button, attachmentId);
        const warmCandidate = this.量测按钮自动播候选(button, 读取视口矩形());
        if (warmCandidate) {
          this.自动播候选可见条目.set(attachmentId, warmCandidate);
        } else if (attachmentId !== "") {
          this.自动播候选可见条目.delete(attachmentId);
        }
      }
    }
  }

  /**
   * 消息窗只把“浏览器当前看到了什么”翻成候选集合：
   * - 可见比例和距视口中心的距离是壳层事实；
   * - 真正谁拥有自动播资格，必须继续交给上层编排裁决。
   */
  private 读取自动播候选(scrollContainer: HTMLElement): 消息视频自动播候选[] {
    if (this.自动播候选观察器) {
      return Array.from(this.自动播候选可见条目.values());
    }
    const viewportRect = scrollContainer.getBoundingClientRect();
    const videoEntries = Array.from(
      this.querySelectorAll<HTMLButtonElement>("button.message-video-preview-trigger[data-attachment-id]")
    );
    return videoEntries
      .map((entry) => this.量测按钮自动播候选(entry, viewportRect))
      .filter((candidate): candidate is 消息视频自动播候选 => candidate !== null);
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

  private 读取时间线视频封面地址(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    playback: 媒体播放结果 | null
  ): string {
    const candidatePosterSrc =
      playback?.thumbnailUrl ?? attachment.posterSrc ?? 默认视频清单占位Poster;
    const failedPosterSrc = this.失效视频封面地址.get(attachment.attachmentId);
    if (failedPosterSrc && failedPosterSrc !== candidatePosterSrc) {
      // 新缩略图来源已到达，撤销旧失败记录，恢复正常封面展示。
      this.失效视频封面地址.delete(attachment.attachmentId);
      return candidatePosterSrc;
    }
    if (failedPosterSrc && failedPosterSrc === candidatePosterSrc) {
      return 默认视频清单占位Poster;
    }
    return candidatePosterSrc;
  }

  private 读取时间线视频首帧预览源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    playback: 媒体播放结果 | null
  ): string | null {
    if (playback?.src) {
      if (playback.mode === "anchor" || playback.mode === "swarm" || playback.mode === "blob") {
        return playback.src;
      }
      return null;
    }
    // 非自动播视频常常还没拿到 playback 投影；这时回退到附件 canonical 原始地址即可拿首帧。
    return attachment.originalSrc;
  }

  private 读取时间线视频稳定预览源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    playback: 媒体播放结果 | null,
    inlineAutoplayPreviewSrc: string | null
  ): string | null {
    const cachedPreviewSrc = this.无封面视频稳定预览源.get(attachment.attachmentId) ?? null;
    if (cachedPreviewSrc) {
      return cachedPreviewSrc;
    }
    if (inlineAutoplayPreviewSrc) {
      this.无封面视频稳定预览源.set(attachment.attachmentId, inlineAutoplayPreviewSrc);
      return inlineAutoplayPreviewSrc;
    }
    const directPreviewSrc = this.读取时间线视频首帧预览源(attachment, playback);
    if (directPreviewSrc) {
      this.无封面视频稳定预览源.set(attachment.attachmentId, directPreviewSrc);
    }
    return directPreviewSrc;
  }

  private 标记视频封面加载失败(attachmentId: string, event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLImageElement)) {
      return;
    }
    const failedPosterSrc = target.currentSrc || target.getAttribute("src");
    if (!failedPosterSrc) {
      return;
    }
    this.失效视频封面地址.set(attachmentId, failedPosterSrc);
    this.广播媒体会话信号(attachmentId, {
      type: "PLAYER_ERROR",
    });
    this.requestUpdate();
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
            ...(playback?.mode === "blob"
              ? {
                  contentHash: playback.contentHash ?? null,
                  distribution: playback.distribution ?? null,
                }
              : {}),
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
          ...(playback?.mode === "manifest" && playback.fallbackSrc
            ? {
                fallbackSrc: playback.fallbackSrc,
              }
            : {}),
          // 播放链拿到的新 thumbnail 可能已经完成重签；应优先覆盖消息快照里可能失效的旧 poster。
          posterSrc: playback?.thumbnailUrl ?? attachment.posterSrc ?? null,
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

  private 阻止时间线媒体预览原生菜单(event: Event): void {
    /**
     * 时间线卡片只表达“打开查看器”这一种意图。
     * 这里主动拦住原生媒体右键/长按菜单，避免浏览器把预览层误当成正式播放器表面。
     */
    event.preventDefault();
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
      this.mediaPlaybackByAttachmentId[attachmentId] ?? null;

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
                ${渲染不可用附件(attachment.attachmentId, playback)}
              </div>
            `;
          }
          if (attachment.kind === "video") {
            const previewPosterSrc = this.读取时间线视频封面地址(attachment, playback);
            const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
            const inlineAutoplayPlayback =
              this.inlineAutoplayPlaybackByAttachmentId[attachment.attachmentId] ?? null;
            const inlineAutoplayPreviewSrc =
              inlineAutoplayPlayback &&
              (inlineAutoplayPlayback.mode === "anchor" ||
                inlineAutoplayPlayback.mode === "swarm" ||
                inlineAutoplayPlayback.mode === "blob")
                ? inlineAutoplayPlayback.src
                : null;
            const shouldRenderInlineVideo =
              this.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
              Boolean(inlineAutoplayPreviewSrc);
            const stableFramePreviewSrc =
              shouldRenderInlineVideo || !hasSourcePoster
                ? this.读取时间线视频稳定预览源(
                    attachment,
                    playback,
                    inlineAutoplayPreviewSrc
                  )
                : null;
            const previewVideoSrc =
              shouldRenderInlineVideo
                ? stableFramePreviewSrc
                : !hasSourcePoster
                  ? stableFramePreviewSrc
                  : null;
            const shouldRenderPreviewVideo = Boolean(previewVideoSrc);
            const previewVideoPoster = hasSourcePoster ? previewPosterSrc : undefined;
            /**
             * 时间线视频卡片保持单入口（点击后统一进查看器）：
             * 1. 有 poster 就继续走静态封面，避免列表层变成第二播放器；
             * 2. 无 poster 且当前是可直播文件源时，回退到非自动播首帧预览，避免大面积空卡片；
             * 3. manifest 无 poster 时仍坚持静态占位，避免把 m3u8 塞给原生 `<video>`；
             * 4. 自动播前后复用同一 `<video>` 节点，只切属性，避免切 owner 时重建闪烁。
             */
            return html`
              <div
                class="message-attachment-card message-video-card"
                data-attachment-id=${attachment.attachmentId}
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
                  @contextmenu=${this.阻止时间线媒体预览原生菜单}
                  @click=${(event: Event) =>
                    this.打开媒体查看器(event, attachment.attachmentId)}
                >
                  ${shouldRenderPreviewVideo
                    ? html`
                        <video
                          class="message-video-preview"
                          data-attachment-id=${attachment.attachmentId}
                          src=${previewVideoSrc ?? ""}
                          width=${attachment.displayWidth}
                          height=${attachment.displayHeight}
                          muted
                          ?autoplay=${shouldRenderInlineVideo}
                          ?loop=${shouldRenderInlineVideo && 媒体是否默认循环播放("video")}
                          playsinline
                          preload="metadata"
                          disablepictureinpicture
                          disableremoteplayback
                          controlslist="nodownload nofullscreen noremoteplayback"
                          tabindex="-1"
                          aria-hidden="true"
                          poster=${ifDefined(previewVideoPoster)}
                          @playing=${() => {
                            if (!shouldRenderInlineVideo) {
                              return;
                            }
                            this.广播媒体会话信号(attachment.attachmentId, {
                              type: "PLAYER_PLAYING",
                            });
                          }}
                          @waiting=${() => {
                            if (!shouldRenderInlineVideo) {
                              return;
                            }
                            this.广播媒体会话信号(attachment.attachmentId, {
                              type: "PLAYER_WAITING",
                            });
                          }}
                          @stalled=${() => {
                            if (!shouldRenderInlineVideo) {
                              return;
                            }
                            this.广播媒体会话信号(attachment.attachmentId, {
                              type: "PLAYER_STALLED",
                            });
                          }}
                          @error=${() =>
                            (() => {
                              // 当前预览源已经不可用时，允许下次渲染切到新的解析结果。
                              this.无封面视频稳定预览源.delete(attachment.attachmentId);
                              this.广播媒体会话信号(attachment.attachmentId, {
                                type: "PLAYER_ERROR",
                              });
                            })()}
                        ></video>
                        ${shouldRenderInlineVideo
                          ? null
                          : html`
                              <span class="message-video-play-indicator" aria-hidden="true">▶</span>
                            `}
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
                            this.标记视频封面加载失败(attachment.attachmentId, event)}
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
    const alias = item.showAlias
      ? html`<div class="message-alias">${item.senderDisplayAlias}</div>`
      : null;
    return html`
      <li
        class="message-row ${item.owner}"
        data-owner=${item.owner}
        data-event-position=${item.eventPosition}
        data-index=${index}
        style=${rowStyle}
        ${ref(measureRow)}
      >
        <div class="message-stack ${item.owner}">
          ${alias}
          <article
            class=${surfaceClass}
            style=${`width: ${item.bubbleWidth}px;`}
          >
            ${item.hasText ? this.renderMessageBody(item) : null}
            ${this.renderMessageAttachments(item)}
          </article>
        </div>
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
