import { html, LitElement, type PropertyValues } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { ifDefined } from "lit/directives/if-defined.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import {
  type 媒体播放结果,
  type 媒体播放位置,
} from "./媒体/媒体播放.js";
import type { 视频预览状态 } from "./媒体/视频预览.js";
import type { 消息视频自动播候选 } from "./媒体/消息视频自动播编排.js";
import type { 媒体会话信号 } from "./媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "./媒体/媒体查看器.js";
import { 读取默认全局唯一播放器 } from "./媒体/全局唯一播放器.js";
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

const 自动播时间戳常规上报最小间隔毫秒 = 1_000;
const 自动播时间戳常规上报最小变化秒 = 0.75;

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
    mediaPreviewByAttachmentId: { attribute: false },
    inlineAutoplayOwnerAttachmentId: { type: String },
    inlineAutoplayPlaybackByAttachmentId: { attribute: false },
    inlineAutoplayPositionByAttachmentId: { attribute: false },
  };

  declare items: 聊天列表展示项[];
  declare historyHint: string;
  declare jumpToLatestLabel: string;
  declare mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare mediaPreviewByAttachmentId: Record<string, 视频预览状态>;
  declare inlineAutoplayOwnerAttachmentId: string | null;
  declare inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;

  private readonly messageScrollRef: Ref<HTMLElement> = createRef();
  private 自动播候选调度句柄: number | null = null;
  private 自动播候选滚动容器: HTMLElement | null = null;
  private 自动播候选观察根: HTMLElement | null = null;
  private 自动播候选观察器: IntersectionObserver | null = null;
  private readonly 自动播候选观察目标 = new Map<HTMLButtonElement, string>();
  private readonly 自动播候选可见条目 = new Map<string, 消息视频自动播候选>();
  private readonly 失效视频封面地址 = new Map<string, string>();
  private readonly 自动播位置上报记录 = new Map<
    string,
    { src: string; currentTime: number; reportedAt: number }
  >();
  /**
   * 时间线视频首帧就绪缓存：
   * - key: attachmentId
   * - value: 已经确认拿到首帧的 video src
   *
   * 设计约束：
   * 1. 只缓存“哪一个 src 已经成功出首帧”，不缓存像素数据；
   * 2. src 变化后会自动重新进入 gated，避免沿用旧 src 的就绪结论；
   * 3. 缓存 owner 在消息窗本身，用来消除“首帧前黑闪”而不引入第二播放链。
   */
  private readonly 时间线视频首帧就绪源 = new Map<string, string>();
  /**
   * canonical player 可见接管就绪缓存：
   * - key: attachmentId
   * - value: 已经在隐藏预热宿主上完成 source/time 对齐、可以揭帘到可见卡片的 src
   *
   * 设计约束：
   * 1. 这不是普通预览 `<video>` 的首帧 ready，而是“唯一播放器自己已经准备好接管可见表面”；
   * 2. 不能与 `时间线视频首帧就绪源` 复用，否则预览壳刚 ready 就会误判成 canonical 也 ready；
   * 3. reveal gate 只认这张表，确保用户永远看不到 canonical player 在可见卡片上现场换源/seek。
   */
  private readonly 时间线唯一播放器可见接管就绪源 = new Map<string, string>();
  /**
   * 只记录“正在进行跨附件 handoff 的那一条 owner”：
   * 1. 初次拿到 owner 或同附件重新拿回 owner，不需要强制 hidden stage；
   * 2. 真正会让用户看到抽搐的，是 A 附件退场、B 附件接管时把 canonical player 直接显露到 B 卡片；
   * 3. 因此 hidden stage 必须只在跨附件 handoff 期间生效，不能把所有 owner 获取都拖进隐藏预热。
   */
  private 时间线隐藏接管附件Id: string | null = null;
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
    this.mediaPreviewByAttachmentId = {};
    this.inlineAutoplayOwnerAttachmentId = null;
    this.inlineAutoplayPlaybackByAttachmentId = {};
    this.inlineAutoplayPositionByAttachmentId = {};
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
    读取默认全局唯一播放器().同步时间线自动播(null);
    this.失效视频封面地址.clear();
    this.时间线视频首帧就绪源.clear();
    this.时间线唯一播放器可见接管就绪源.clear();
    this.时间线隐藏接管附件Id = null;
    this.自动播位置上报记录.clear();
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

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("inlineAutoplayOwnerAttachmentId")) {
      const previousOwnerAttachmentId =
        changedProperties.get("inlineAutoplayOwnerAttachmentId") ?? null;
      const currentOwnerAttachmentId = this.inlineAutoplayOwnerAttachmentId;
      if (previousOwnerAttachmentId && previousOwnerAttachmentId !== currentOwnerAttachmentId) {
        this.时间线唯一播放器可见接管就绪源.delete(previousOwnerAttachmentId);
      }
      if (
        previousOwnerAttachmentId &&
        currentOwnerAttachmentId &&
        currentOwnerAttachmentId !== previousOwnerAttachmentId
      ) {
        /**
         * reveal gate 只对“这一轮 owner 交接”有效，绝不能跨轮次复用：
         * 1. 同一附件多次进出 owner 是消息流常态，上一轮 ready 不代表这一轮 canonical player 仍然已经对齐；
         * 2. 如果继续沿用旧缓存，render 会直接显露可见 canonical host，唯一播放器就会在用户眼前现场切源 / seek；
         * 3. 因此 owner 每次切到新附件时，都必须先清掉该附件历史 ready 结论，强制重新走 hidden stage 校验。
         */
        this.时间线唯一播放器可见接管就绪源.delete(currentOwnerAttachmentId);
        this.时间线隐藏接管附件Id = currentOwnerAttachmentId;
      } else if (currentOwnerAttachmentId !== this.时间线隐藏接管附件Id) {
        this.时间线隐藏接管附件Id = null;
      }
    }
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("items")) {
      this.同步时间线视频首帧就绪缓存();
    }
    this.同步时间线自动播播放状态(changedProperties);
    const scrollContainer = this.messageScrollRef.value;
    if (!scrollContainer) {
      return;
    }
    if (
      !changedProperties.has("items") &&
      !changedProperties.has("mediaPlaybackByAttachmentId") &&
      !changedProperties.has("mediaPreviewByAttachmentId")
    ) {
      return;
    }
    this.同步自动播候选观察(scrollContainer);
    /**
     * 房间首轮渲染 / playback 更新不是滚动风暴：
     * 1. 此时候选表刚刚按最新 DOM 同步完成，继续再等一帧只会白白推迟正式会话预热；
     * 2. 真正高频的滚动链仍然走 `调度自动播候选`，不会把每次 wheel/touchmove 放大成同步全量派发；
     * 3. 这里先清掉旧的 rAF 尾波，避免首轮“立刻派发”和上一轮延迟派发重复回抛同一批候选。
     */
    this.取消自动播候选调度();
    this.dispatch自动播候选(scrollContainer);
  }

  private 同步时间线视频首帧就绪缓存(): void {
    const 当前视频附件 = new Set<string>();
    for (const item of this.items) {
      if (item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (attachment.kind === "video") {
          当前视频附件.add(attachment.attachmentId);
        }
      }
    }
    for (const attachmentId of this.时间线视频首帧就绪源.keys()) {
      if (!当前视频附件.has(attachmentId)) {
        this.时间线视频首帧就绪源.delete(attachmentId);
      }
    }
    for (const attachmentId of this.时间线唯一播放器可见接管就绪源.keys()) {
      if (!当前视频附件.has(attachmentId)) {
        this.时间线唯一播放器可见接管就绪源.delete(attachmentId);
      }
    }
  }

  private 读取时间线视频首帧是否就绪(attachmentId: string, src: string | null): boolean {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return false;
    }
    return this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc;
  }

  private 标记时间线视频首帧已就绪(attachmentId: string, src: string | null): void {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return;
    }
    if (this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc) {
      return;
    }
    this.时间线视频首帧就绪源.set(attachmentId, normalizedSrc);
    this.requestUpdate();
  }

  private 读取时间线唯一播放器是否可见接管就绪(
    attachmentId: string,
    src: string | null
  ): boolean {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return false;
    }
    return this.时间线唯一播放器可见接管就绪源.get(attachmentId) === normalizedSrc;
  }

  private 标记时间线唯一播放器可见接管已就绪(
    attachmentId: string,
    video: HTMLVideoElement
  ): void {
    const currentSrc = this.读取视频当前播放源(video);
    const normalizedSrc = this.归一化时间线视频播放源(currentSrc);
    if (!normalizedSrc || video.seeking) {
      return;
    }
    const 最低可见接管就绪状态 =
      typeof video.HAVE_FUTURE_DATA === "number" ? video.HAVE_FUTURE_DATA : 3;
    if (video.readyState < 最低可见接管就绪状态) {
      /**
       * hidden stage 里的 canonical player 只有在“已经具备继续播放所需数据”后才允许揭帘：
       * 1. 只看 `loadedmetadata/seeked/currentTime` 还不够，浏览器此时仍可能在可见宿主上立刻 `waiting/loadstart`；
       * 2. `HAVE_FUTURE_DATA` 对应 `canplay` 语义，更接近“揭帘后用户不会先看到一次卡顿”；
       * 3. 这条门槛只影响 reveal，不影响后台 source/time 对齐，所以不会把播放真相拆成第二套。
       */
      return;
    }
    /**
     * reveal gate 只接受“canonical player 已经追上当前续播点”的事实：
     * 1. 如果这条附件有保存位置，而当前 canonical video 还停在更早时间，说明它只是刚 load 完，还没 seek 到位；
     * 2. 这时继续保留目标卡片自己的暂停预览帧，让唯一播放器留在隐藏宿主完成对齐；
     * 3. 等 `seeked/canplay/playing` 再次回抛且 currentTime 已对齐后，才允许揭帘。
     */
    const position = this.读取自动播恢复位置(attachmentId, currentSrc);
    if (position && Math.abs(video.currentTime - position.currentTime) >= 0.25) {
      return;
    }
    if (this.时间线唯一播放器可见接管就绪源.get(attachmentId) === normalizedSrc) {
      return;
    }
    this.时间线唯一播放器可见接管就绪源.set(attachmentId, normalizedSrc);
    this.requestUpdate();
    /**
     * reveal gate 打开后，真正的可见 canonical host 是在下一轮 Lit 更新里才会进入 DOM。
     * 单靠 `requestUpdate()` 不会触发 `同步时间线自动播播放状态()` 的属性变更分支，
     * 所以这里要在更新完成后显式再同步一次唯一播放器宿主，把同一颗壳从 hidden stage 迁回可见卡片。
     */
    void this.updateComplete.then(() => {
      this.同步时间线唯一播放器宿主();
    });
  }

  /**
   * 自动播候选一进入预热窗口，就要用现有这颗 `<video>` 把首帧热出来：
   * 1. 目标不是提前播放，而是让 Chrome 在 owner 接管前先拿到真实视频帧；
   * 2. 只提升已经存在正式预览源的时间线 `<video>`，不新增第二条预览真相；
   * 3. 已经有续播帧/首帧 ready 的卡片不再 `load()`，避免把暂停中的续播位置重置回开头。
   */
  private 预热时间线视频首帧(button: HTMLButtonElement, attachmentId: string): void {
    if (!attachmentId) {
      return;
    }
    const previewVideo = button.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id]'
    );
    if (!previewVideo || previewVideo.dataset.attachmentId !== attachmentId) {
      return;
    }
    if (previewVideo.autoplay) {
      return;
    }
    const currentSrc = this.读取视频当前播放源(previewVideo);
    if (!currentSrc) {
      return;
    }
    if (this.读取时间线视频首帧是否就绪(attachmentId, currentSrc)) {
      return;
    }
    if (previewVideo.currentTime > 0) {
      return;
    }
    const 需要提升预载强度 = previewVideo.preload !== "auto";
    previewVideo.preload = "auto";
    if (previewVideo.readyState >= previewVideo.HAVE_CURRENT_DATA) {
      return;
    }
    if (!需要提升预载强度) {
      return;
    }
    previewVideo.load();
  }

  private 读取视频当前播放源(video: HTMLVideoElement): string | null {
    /**
     * 时间线 `<video>` 的 canonical 源应优先认模板当前绑定的 `src`：
     * 1. Chrome 会把 `currentSrc` 展开成绝对地址；
     * 2. 若把这个绝对地址继续上报回运行时，再回灌到模板，就会在 owner 切换时把
     *    `/webtorrent/...` 改写成 `https://host/webtorrent/...`；
     * 3. 对浏览器来说这依然是一次新的 `src` 赋值，会触发 `emptied/loadstart`，真实滚动里就会抽一下。
     */
    const src = video.getAttribute("src") || video.currentSrc || "";
    return src.length > 0 ? src : null;
  }

  private 归一化时间线视频播放源(src: string | null): string | null {
    if (!src) {
      return null;
    }
    try {
      /**
       * 浏览器事件上报常给 `currentSrc` 绝对地址，而 playback 快照常保留
       * `/webtorrent/...` 相对地址。这里只做 URL 等价归一化，不放宽 source-aware
       * 约束，避免把旧 session / 旧附件源误判成同一个续播帧。
       */
      return new URL(src, window.location.href).href;
    } catch {
      return src;
    }
  }

  private 读取自动播恢复位置(
    attachmentId: string,
    src: string | null
  ): 媒体播放位置 | null {
    if (!src) {
      return null;
    }
    const position = this.inlineAutoplayPositionByAttachmentId[attachmentId];
    if (
      !position ||
      !Number.isFinite(position.currentTime) ||
      position.currentTime <= 0
    ) {
      return null;
    }
    const normalizedPositionSrc = this.归一化时间线视频播放源(position.src);
    const normalizedCurrentSrc = this.归一化时间线视频播放源(src);
    if (
      position.src !== src &&
      (!normalizedPositionSrc || normalizedPositionSrc !== normalizedCurrentSrc)
    ) {
      return null;
    }
    return position;
  }

  private 读取时间线现有预览视频是否可继续显示(
    attachmentId: string,
    src: string | null
  ): boolean {
    const normalizedExpectedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedExpectedSrc) {
      return false;
    }
    const previewVideo = this.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );
    if (!previewVideo || !previewVideo.isConnected) {
      return false;
    }
    const normalizedCurrentSrc = this.归一化时间线视频播放源(
      this.读取视频当前播放源(previewVideo)
    );
    if (normalizedCurrentSrc !== normalizedExpectedSrc) {
      return false;
    }
    /**
     * 真实浏览器里，非 owner 的 preview `<video>` 可能已经拿到首帧，
     * 但 `loadeddata/canplay` 还没来得及把缓存写回本轮 render。
     * 这里补看 DOM 现状，避免“明明已经有稳定可见帧，却因为缓存慢一拍而直接显露 canonical host”。
     */
    return (
      previewVideo.readyState >= 2 ||
      previewVideo.currentTime > 0
    );
  }

  private 恢复时间线自动播播放位置(
    attachmentId: string,
    video: HTMLVideoElement,
    options: { allowPreviewFrame?: boolean } = {}
  ): void {
    /**
     * 默认只允许当前自动播 owner 恢复播放位置。
     * `allowPreviewFrame` 是唯一例外：非 owner 的时间线视频已经确认 src 与保存位置同源时，
     * 只允许它 seek 到暂停预览帧，不能借此进入自动播放链。
     */
    if (
      !options.allowPreviewFrame &&
      this.inlineAutoplayOwnerAttachmentId !== attachmentId
    ) {
      return;
    }
    const position = this.读取自动播恢复位置(
      attachmentId,
      this.读取视频当前播放源(video)
    );
    if (!position || Math.abs(video.currentTime - position.currentTime) < 0.25) {
      return;
    }
    try {
      video.currentTime = position.currentTime;
    } catch {
      // 某些浏览器/测试环境会在 metadata 尚未稳定时拒绝 seek。
      // 恢复动作会在 loadedmetadata 与 play 前各尝试一次，这里不把它升级成播放失败。
    }
  }

  private 广播自动播播放位置(
    attachmentId: string,
    video: HTMLVideoElement,
    force = false,
    allowReleasedOwner = false
  ): void {
    if (
      !allowReleasedOwner &&
      (this.inlineAutoplayOwnerAttachmentId !== attachmentId || !video.autoplay)
    ) {
      return;
    }
    const src = this.读取视频当前播放源(video);
    if (!src || !Number.isFinite(video.currentTime) || video.currentTime < 0) {
      return;
    }
    const now = Date.now();
    const last = this.自动播位置上报记录.get(attachmentId);
    if (
      !force &&
      last?.src === src &&
      /**
       * 节流只负责吞掉“同一小段播放进度里的高频噪声”：
       * - 时间很近但 currentTime 已经发生大跳变（例如自然 loop 回到 0.x、seek、热接管补位），
       *   这类事实必须立刻上报，不能继续沿用上一轮时间戳；
       * - 只有“时间很近且位移也很小”时，才说明这只是连续 timeupdate 噪声。
       */
      now - last.reportedAt < 自动播时间戳常规上报最小间隔毫秒 &&
      Math.abs(video.currentTime - last.currentTime) <
        自动播时间戳常规上报最小变化秒
    ) {
      return;
    }
    /**
     * 消息窗只读取真实 video 的当前时间，并把事实上报给媒体运行时。
     * 这里的 Map 只做高频事件节流，不作为续播真相；真正恢复来源仍是外层回灌的 snapshot。
     */
    this.自动播位置上报记录.set(attachmentId, {
      src,
      currentTime: video.currentTime,
      reportedAt: now,
    });
    this.dispatchEvent(
      new CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>(
        "room-inline-autoplay-position-changed",
        {
          detail: {
            attachmentId,
            position: {
              src,
              currentTime: video.currentTime,
              updatedAt: now,
            },
          },
          bubbles: true,
          composed: true,
        }
      )
    );
  }

  private 同步时间线自动播播放状态(changedProperties: PropertyValues<this>): void {
    if (
      !changedProperties.has("items") &&
      !changedProperties.has("mediaPlaybackByAttachmentId") &&
      !changedProperties.has("inlineAutoplayOwnerAttachmentId") &&
      !changedProperties.has("inlineAutoplayPlaybackByAttachmentId") &&
      !changedProperties.has("inlineAutoplayPositionByAttachmentId")
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
    this.同步时间线唯一播放器宿主();
    const previewVideos = this.querySelectorAll<HTMLVideoElement>(
      "video.message-video-preview[data-attachment-id]"
    );
    const previousAutoplayOwnerAttachmentId =
      changedProperties.get("inlineAutoplayOwnerAttachmentId") ?? null;
    for (const video of previewVideos) {
      if (video.dataset.canonicalPlayer === "true") {
        continue;
      }
      const attachmentId = video.getAttribute("data-attachment-id");
      if (!attachmentId) {
        continue;
      }
      const shouldAutoplay =
        this.inlineAutoplayOwnerAttachmentId === attachmentId && video.autoplay;
      if (shouldAutoplay) {
        this.恢复时间线自动播播放位置(attachmentId, video);
        if (video.paused) {
          void video.play().catch(() => undefined);
        }
        continue;
      }
      if (this.读取自动播恢复位置(attachmentId, this.读取视频当前播放源(video))) {
        this.恢复时间线自动播播放位置(attachmentId, video, {
          allowPreviewFrame: true,
        });
      }
      if (!video.paused) {
        this.广播自动播播放位置(
          attachmentId,
          video,
          true,
          previousAutoplayOwnerAttachmentId === attachmentId
        );
        video.pause();
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
   * 自动播候选不只服务“谁现在开播”，还要服务“下一条视频能否提前长出稳定 `<video>` 壳”：
   * 1. 已经可见的按钮返回真实 `visibilityRatio`，供 owner 裁决使用；
   * 2. 刚贴到视口边缘外的一小段按钮返回 `visibilityRatio=0`，只作为预热候选，不抢 owner；
   * 3. 这样可避免视频露头后才第一次 `img -> video` 换壳，而不需要新增第二套预热状态机。
   */
  private 根据矩形计算自动播候选(
    attachmentId: string,
    rect: Pick<DOMRectReadOnly, "top" | "bottom" | "height">,
    viewportRect: Pick<DOMRectReadOnly, "top" | "bottom" | "height">
  ): 消息视频自动播候选 | null {
    if (!attachmentId || rect.height <= 0) {
      return null;
    }
    const distanceToViewportCenter = Math.abs(
      (rect.top + rect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2
    );
    const visibleTop = Math.max(rect.top, viewportRect.top);
    const visibleBottom = Math.min(rect.bottom, viewportRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight > 0) {
      return {
        attachmentId,
        visibilityRatio: visibleHeight / rect.height,
        distanceToViewportCenter,
      };
    }
    /**
     * 预热窗口不能只盯着“已经贴边的一条卡片”：
     * - 正式媒体会话从 locator / cache / swarm 解析到可播 src 本身就有异步成本；
     * - 如果只在 `edgeGap <= rect.height` 时才开始，用户一次较快滚动就可能先看到 poster，再等 `<video>` 长出来；
     * - 这里把预热边界放宽到“距离当前视口不足一屏”，仍然只预热当前虚拟 DOM 里离视口最近的一批视频，
     *   但能给正式会话留出足够的解析提前量。
     */
    const 预热边界像素 = Math.max(rect.height, viewportRect.height);
    const edgeGap =
      rect.bottom <= viewportRect.top
        ? viewportRect.top - rect.bottom
        : rect.top >= viewportRect.bottom
          ? rect.top - viewportRect.bottom
          : 0;
    if (edgeGap > 预热边界像素) {
      return null;
    }
    return {
      attachmentId,
      visibilityRatio: 0,
      distanceToViewportCenter,
    };
  }

  private 量测按钮自动播候选(
    button: HTMLButtonElement,
    viewportRect: DOMRect
  ): 消息视频自动播候选 | null {
    const attachmentId = button.dataset.attachmentId ?? "";
    if (!attachmentId) {
      return null;
    }
    return this.根据矩形计算自动播候选(
      attachmentId,
      button.getBoundingClientRect(),
      viewportRect
    );
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
            const rootBounds =
              entry.rootBounds ?? this.自动播候选观察根?.getBoundingClientRect() ?? null;
            if (!rootBounds) {
              continue;
            }
            const candidate = this.根据矩形计算自动播候选(
              currentAttachmentId,
              entry.boundingClientRect,
              rootBounds
            );
            if (!candidate) {
              if (currentAttachmentId !== "") {
                this.自动播候选可见条目.delete(currentAttachmentId);
              }
              continue;
            }
            this.自动播候选可见条目.set(currentAttachmentId, candidate);
            this.预热时间线视频首帧(button, currentAttachmentId);
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
      } else if (previousAttachmentId !== attachmentId) {
        if (previousAttachmentId !== "") {
          this.自动播候选可见条目.delete(previousAttachmentId);
        }
        this.自动播候选观察目标.set(button, attachmentId);
      }
      /**
       * 既有观察目标也要在每次房间更新时重算一次几何：
       * - 进房恢复、虚拟列表回填、poster/video 切换都会让按钮位置晚于 `observe()` 再稳定；
       * - 如果只在“首次 observe”时量一次，候选表可能长期停在旧的空结果，直到用户手动滚一下才恢复；
       * - 这里仍然只在 `updated(items/playback/preview)` 这些低频节点重算，不把滚动路径重新变回同步全量扫描。
       */
      const warmCandidate = this.量测按钮自动播候选(button, 读取视口矩形());
      if (warmCandidate) {
        this.自动播候选可见条目.set(attachmentId, warmCandidate);
        this.预热时间线视频首帧(button, attachmentId);
      } else if (attachmentId !== "") {
        this.自动播候选可见条目.delete(attachmentId);
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

  private 读取附件播放源(attachment: 消息展示项["attachments"][number]): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId];
    return playback?.mode === "swarm" ||
      playback?.mode === "anchor" ||
      playback?.mode === "manifest"
      ? playback.src
      : attachment.kind === "image"
        ? attachment.originalSrc
        : "";
  }

  private 读取图片查看器播放源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "image" }>
  ): string {
    return this.读取附件播放源(attachment);
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
    if (playback?.src && playback.mode === "swarm") {
      return playback.src;
    }
    /**
     * 禁止时间线预览直接读取原始视频地址：
     * 1. 自动播/查看器都必须由媒体主链解析出的 playback owner 驱动；
     * 2. 未拿到 playback 时保持静态占位，避免列表层偷偷走第二条 original 读取链路；
     * 3. 这样可确保“要播就吃 WebTorrent 真相，不播就占位”，不混跑。
     */
    return null;
  }

  private 读取时间线视频运行时预览(
    attachmentId: string
  ): Extract<视频预览状态, { phase: "ready" }> | null {
    const preview = this.mediaPreviewByAttachmentId[attachmentId] ?? null;
    return preview?.phase === "ready" ? preview : null;
  }

  private 同步时间线唯一播放器宿主(): void {
    const ownerAttachmentId = this.inlineAutoplayOwnerAttachmentId;
    if (!ownerAttachmentId) {
      读取默认全局唯一播放器().同步时间线自动播(null);
      return;
    }
    const visibleHost = this.querySelector<HTMLElement>(
      `.message-video-canonical-host[data-attachment-id="${ownerAttachmentId}"]`
    );
    const stageHost = this.querySelector<HTMLElement>(
      `.message-video-canonical-stage-host[data-attachment-id="${ownerAttachmentId}"]`
    );
    const host = visibleHost ?? stageHost;
    const src = host?.dataset.videoSrc?.trim() ?? "";
    const kind = host?.dataset.videoKind === "hls" ? "hls" : "file";
    const width = Number(host?.dataset.videoWidth ?? "0");
    const height = Number(host?.dataset.videoHeight ?? "0");
    if (!host || !host.isConnected || !src || !Number.isFinite(width) || !Number.isFinite(height)) {
      读取默认全局唯一播放器().同步时间线自动播(null);
      return;
    }
    读取默认全局唯一播放器().同步时间线自动播({
      attachmentId: ownerAttachmentId,
      mountTarget: host,
      source: {
        kind,
        src,
        posterSrc: host.dataset.videoPoster?.trim() || null,
        width,
        height,
      },
      回调: {
        恢复播放位置: (video) => {
          this.恢复时间线自动播播放位置(ownerAttachmentId, video);
        },
        标记首帧已就绪: (currentSrc) => {
          this.标记时间线视频首帧已就绪(ownerAttachmentId, currentSrc);
        },
        标记可见接管已就绪: (video) => {
          this.标记时间线唯一播放器可见接管已就绪(ownerAttachmentId, video);
        },
        广播播放位置: (video, force = false, allowReleasedOwner = false) => {
          this.广播自动播播放位置(ownerAttachmentId, video, force, allowReleasedOwner);
        },
        广播媒体会话信号: (signal) => {
          this.广播媒体会话信号(ownerAttachmentId, signal);
        },
      },
    });
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
            src: this.读取图片查看器播放源(attachment),
            ...((playback &&
            (playback.mode === "anchor" || playback.mode === "swarm") &&
            ("contentHash" in playback || "distribution" in playback))
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
          src: this.读取附件播放源(attachment),
          ...(playback?.mode === "manifest" && playback.fallbackSrc
            ? {
                fallbackSrc: playback.fallbackSrc,
              }
            : {}),
          // 播放链拿到的新 thumbnail 可能已经完成重签；应优先覆盖消息快照里可能失效的旧 poster。
          posterSrc:
            playback?.thumbnailUrl ??
            this.读取时间线视频运行时预览(attachment.attachmentId)?.src ??
            attachment.posterSrc ??
            null,
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
                    this.广播媒体会话信号(attachment.attachmentId, {
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
            const runtimePreview = this.读取时间线视频运行时预览(attachment.attachmentId);
            const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
            const hasRuntimePreview = Boolean(runtimePreview);
            const previewPosterSrc =
              !hasSourcePoster && runtimePreview
                ? runtimePreview.src
                : this.读取时间线视频封面地址(attachment, playback);
            const inlineAutoplayPlayback =
              this.inlineAutoplayPlaybackByAttachmentId[attachment.attachmentId] ?? null;
            const inlineAutoplayPreviewSrc =
              inlineAutoplayPlayback && inlineAutoplayPlayback.mode === "swarm"
                ? inlineAutoplayPlayback.src
                : null;
            const playbackTimelineVideoSrc = this.读取时间线视频首帧预览源(
              attachment,
              playback
            );
            const savedTimelineFrame =
              this.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
            /**
             * owner 刚滑出视口时，上层可能先撤掉 autoplay playback 快照，
             * 下一轮可见性裁决才会重新回灌。这个短窗口不能退回 poster：
             * 保存位置的 src 来自刚才那颗真实 `<video>` 的当前模板源，只作为同源续帧画面，
             * 不打开 original 冷源，也不产生第二条播放真相。
             */
            const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
            /**
             * 时间线视频一旦拿到正式 swarm 播放源，就继续复用同一颗 `<video>` 作为唯一视觉壳，
             * 且优先保留 playback 给出的 canonical src：
             * 1. 有 poster 也只允许挂在这颗 `<video>` 上等待首帧，不能退回独立 `<img>`；
             * 2. 这样下一个可见视频从“静态预览 -> 自动播 owner”时，只切 autoplay，不切主节点；
             * 3. `savedTimelineFrameSrc` 只在 playback 暂缺时兜住释放帧，不允许反过来改写已有的 canonical playback 源；
             * 4. 否则同一资源会在相对/绝对 URL 间来回赋值，Chrome 会把它当成一次新 load，自动播切换就会闪。
             */
            const timelinePreviewVideoSrc =
              playbackTimelineVideoSrc ?? savedTimelineFrameSrc;
            /**
             * 自动播 owner 交接时，新的 swarm autoplay playback 结果不一定与 owner 切换同拍到达：
             * 1. 如果这里硬等 `inlineAutoplayPlayback`，旧 host 会先撤掉，而新 host 要晚一拍才出现；
             * 2. 但如果直接把 canonical host 暴露到可见卡片上，唯一播放器又会在用户眼前现场切源 / seek；
             * 3. 因此这里先收口“owner 需要的 canonical source”，再由 reveal gate 决定它是进隐藏预热宿主还是可见宿主；
             * 4. 后续更正式的 autoplay swarm 源到达时，只允许同一颗壳继续 `同步(source)`，不允许再换主节点。
             */
            const ownerCanonicalVideoSrc =
              inlineAutoplayPreviewSrc ?? timelinePreviewVideoSrc;
            const shouldRenderInlineVideo =
              this.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
              Boolean(ownerCanonicalVideoSrc);
            const shouldRevealCanonicalHost =
              shouldRenderInlineVideo &&
              this.读取时间线唯一播放器是否可见接管就绪(
                attachment.attachmentId,
                ownerCanonicalVideoSrc
              );
            const previewVideoSrc = shouldRenderInlineVideo
              ? ownerCanonicalVideoSrc
              : timelinePreviewVideoSrc;
            const restorableTimelineFrame = this.读取自动播恢复位置(
              attachment.attachmentId,
              previewVideoSrc
            );
            const shouldRenderPreviewVideo = Boolean(previewVideoSrc);
            const isFirstFrameReady = this.读取时间线视频首帧是否就绪(
              attachment.attachmentId,
              previewVideoSrc
            );
            /**
             * 时间线 `<video>` 一旦已经拿到首帧，就不能继续把 `poster` 当正式画面：
             * 1. 让非 owner 长期挂着 poster，等 owner 接管时再移除，会在 Chrome 里形成一次可见的“海报 -> 真视频帧”跳变；
             * 2. 真正丝滑的体验应该是：首帧 ready 之后，非 owner 也已经在展示真实视频像素，只是暂停着；
             * 3. `poster` 仍然保留为首帧未就绪前的临时遮挡，不改写无源/未 ready 时的兜底语义。
             */
            const previewVideoPoster =
              !restorableTimelineFrame &&
              !isFirstFrameReady &&
              (hasSourcePoster || hasRuntimePreview)
                ? previewPosterSrc
                : undefined;
            const shouldGateVideoUntilFirstFrame =
              shouldRenderPreviewVideo && !hasSourcePoster && !hasRuntimePreview;
            const shouldShowFirstFrameGuard = shouldGateVideoUntilFirstFrame && !isFirstFrameReady;
            const hasReadyPreviewSurface =
              Boolean(restorableTimelineFrame) ||
              isFirstFrameReady ||
              this.读取时间线现有预览视频是否可继续显示(
                attachment.attachmentId,
                previewVideoSrc
              );
            /**
             * hidden stage 只在“目标卡片当前已经有一张能继续顶住像素的预览视频”时启用：
             * 1. 有保存续播点、首帧缓存，或 DOM 上那张 preview `<video>` 自己已经 ready，都算“可继续显示”；
             * 2. 这时必须先保留现有预览帧，让 canonical player 在隐藏宿主里完成 source/time 对齐；
             * 3. 如果当前卡片其实还没有任何可显示帧，再强行 hidden stage 只会把 autoplay 体验拖成长时间静止态；
             * 4. 因此真正的裁决不是“所有 owner 都 hidden stage”，而是“已有稳定可见帧时才 hidden stage”。
             */
            const shouldUseHiddenStageCover =
              shouldRenderInlineVideo &&
              this.时间线隐藏接管附件Id === attachment.attachmentId &&
              hasReadyPreviewSurface;
            const shouldRenderStageHost = shouldUseHiddenStageCover && !shouldRevealCanonicalHost;
            const shouldRenderVisibleCanonicalHost =
              shouldRenderInlineVideo && (!shouldUseHiddenStageCover || shouldRevealCanonicalHost);
            const 时间线视频预览内容 = shouldRenderVisibleCanonicalHost
              ? html`
                  <div
                    class="message-video-canonical-host"
                    data-attachment-id=${attachment.attachmentId}
                    data-video-kind=${previewVideoSrc?.includes(".m3u8") ? "hls" : "file"}
                    data-video-src=${previewVideoSrc ?? ""}
                    data-video-poster=${previewVideoPoster ?? ""}
                    data-video-width=${attachment.width}
                    data-video-height=${attachment.height}
                    style="display:block;width:100%;height:100%;background:#000;"
                    aria-hidden="true"
                  ></div>
                `
              : html`
                  <video
                    class=${`message-video-preview${
                      shouldShowFirstFrameGuard ? " message-video-preview--gated" : ""
                    }`}
                    data-attachment-id=${attachment.attachmentId}
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
                      this.恢复时间线自动播播放位置(attachment.attachmentId, target, {
                        allowPreviewFrame: Boolean(restorableTimelineFrame),
                      });
                    }}
                    @loadeddata=${(event: Event) => {
                      const target = event.currentTarget;
                      if (!(target instanceof HTMLVideoElement)) {
                        return;
                      }
                      this.标记时间线视频首帧已就绪(
                        attachment.attachmentId,
                        target.currentSrc || target.getAttribute("src")
                      );
                    }}
                    @canplay=${(event: Event) => {
                      const target = event.currentTarget;
                      if (!(target instanceof HTMLVideoElement)) {
                        return;
                      }
                      this.标记时间线视频首帧已就绪(
                        attachment.attachmentId,
                        target.currentSrc || target.getAttribute("src")
                      );
                    }}
                    @playing=${(event: Event) => {
                      const target = event.currentTarget;
                      if (!(target instanceof HTMLVideoElement)) {
                        return;
                      }
                      this.标记时间线视频首帧已就绪(
                        attachment.attachmentId,
                        target.currentSrc || target.getAttribute("src")
                      );
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
                  ${shouldRenderStageHost
                    ? html`
                        <div
                          class="message-video-canonical-stage-host"
                          data-stage-host="true"
                          data-attachment-id=${attachment.attachmentId}
                          data-video-kind=${previewVideoSrc?.includes(".m3u8") ? "hls" : "file"}
                          data-video-src=${previewVideoSrc ?? ""}
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
             * 1. 只要拿到同文件可播源（swarm/blob），就保持同一颗 `<video>` 作为时间线预览容器；
             * 2. runtime preview 作为该 `<video>` 的 poster，而不是另起一颗 `<img>` 与 autoplay 互切；
             * 3. 没有任何 poster 时，先用轻量 guard 遮挡，等 `loadeddata/canplay/playing` 任一事件到达再揭开像素；
             * 4. owner 交接前若目标卡片已经有暂停预览帧，就先保留它；canonical player 在隐藏宿主切源就绪后再揭帘；
             * 5. 有同源播放位置时，非 owner 也用视频自身暂停帧做预览，禁止退回开头 poster；
             * 6. 没有 source bytes 时继续稳态占位，不偷走 original 直读链。
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
