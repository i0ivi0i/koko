import { html, LitElement, type PropertyValues } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { ifDefined } from "lit/directives/if-defined.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import {
  投影信息流视频预算,
  type 信息流视频预算投影,
  type 正式媒体字节来源,
} from "./媒体/信息流视频预算.js";
import {
  视频地址属于旧流媒体清单,
  type 媒体播放结果,
  type 媒体播放位置,
} from "./媒体/媒体播放.js";
import type { 视频预览状态 } from "./媒体/视频预览.js";
import type { 消息视频自动播候选 } from "./媒体/消息视频自动播编排.js";
import type { 媒体会话信号 } from "./媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "./媒体/媒体查看器.js";
import { 读取默认全局唯一播放器 } from "./媒体/全局唯一播放器.js";
import { 判定播放连续性表面 } from "./媒体/全局丝滑自动播.js";
import { 读取BlobDataUrl } from "./媒体/视频元数据.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

type 消息虚拟项 = {
  key: unknown;
  index: number;
  start: number;
};

type 时间线视频附件 = Extract<消息展示项["attachments"][number], { kind: "video" }>;

type 时间线自动播冻结帧 = {
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

const 自动播时间戳常规上报最小间隔毫秒 = 1_000;
const 自动播时间戳常规上报最小变化秒 = 0.75;
const 近视口真实预览视频预算上限 = 2;
const 近视口活媒体会话预算上限 = 24;
const 近视口活视频会话预算上限 = 4;
const 自动播观察候选上限 = 12;
const 首帧预热候选上限 = 2;
const 消息虚拟列表overscan消息数 = 4;
const 首帧兜底消息预算上限 = 12;
const 首帧兜底最小消息数量 = 6;
const 首帧兜底默认视口高度 = 720;
const 首帧兜底视口覆盖倍率 = 1.25;
const 时间线自动播冻结帧最大边长 = 480;
const 时间线自动播冻结帧允许时间偏差秒 = 2.5;

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
    mediaVideoBudgetByAttachmentId: { attribute: false },
    inlineAutoplayOwnerAttachmentId: { type: String },
    inlineAutoplayPlaybackByAttachmentId: { attribute: false },
    inlineAutoplayPositionByAttachmentId: { attribute: false },
  };

  declare items: 聊天列表展示项[];
  declare historyHint: string;
  declare jumpToLatestLabel: string;
  declare mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare mediaPreviewByAttachmentId: Record<string, 视频预览状态>;
  declare mediaVideoBudgetByAttachmentId: Record<string, 信息流视频预算投影>;
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
   * 退场连续性约束：
   * 1. 这张表不是第二份业务真相，也不替代外层 runtime snapshot；
   * 2. 它只记“当前组件刚刚从真实 `<video>` flush 出来的最新一拍位置”；
   * 3. 当 owner 退场而外层 snapshot 还慢一拍时，允许它把底板 preview 补到更近的时间；
   * 4. 一旦外层 snapshot 追平或更新更晚，仍然以外层回灌为准。
   */
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
   * 时间线自动播冻结帧：
   * 1. 这不是媒体字节真相，也不是第二播放器，只是从“刚刚真实播放过的同一颗 video”截下来的 UI 暂停帧；
   * 2. 它只负责高速/远距离回滑时，在新 `<video>` 完成 metadata/seek/canplay 前顶住像素；
   * 3. 匹配必须同时满足同源 src 与续播时间接近，避免把旧附件、旧 source 或首帧封面误当续播画面。
  */
  private readonly 时间线自动播冻结帧 = new Map<string, 时间线自动播冻结帧>();
  private readonly 时间线自动播冻结帧导出中 = new Map<string, string>();
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
   * 记录“必须先在隐藏宿主里追上 source/time 的 owner”：
   * 1. 跨附件 handoff 必须走 hidden stage，避免在可见卡片上现场换源/seek；
   * 2. 同附件高速回滑若历史 reveal 缓存还在但当前 DOM 已不 ready，也要重新隐藏校验；
   * 3. 普通初次 owner 获取不强制 hidden stage，避免把自动播拖成长时间静止态。
   */
  private 时间线隐藏接管附件Id: string | null = null;
  /**
   * 只给“刚刚退场的那一条 owner”留一张本地续帧底板桥：
   * 1. `inlineAutoplayPositionByAttachmentId` 是续播位置真相，不等于“所有卡片都获得了一张合法 preview”；
   * 2. 旧 owner 退场时，确实需要把同一帧露给用户，避免 canonical host 拿走后闪一下；
   * 3. 但如果把保存位置无差别回填给任何 `missing_source` 卡片，就会把历史播过一次的 swarm 源永久伪装成 preview；
   * 4. 所以这里单独记“最近刚退场的 owner”，只允许这一条桥承接退场连续性，不泄漏成通用预览真相。
   */
  private 最近退场Owner附件Id: string | null = null;
  private 上次媒体窗口附件签名 = "";
  private readonly messageVirtualizer = new VirtualizerController<HTMLElement, HTMLElement>(
    this,
    {
      getScrollElement: () => this.messageScrollRef.value ?? null,
      count: 0,
      getItemKey: (index) => this.items[index]?.id ?? index,
      estimateSize: (index) => this.估算消息行高度(index),
      overscan: 消息虚拟列表overscan消息数,
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
    this.mediaVideoBudgetByAttachmentId = {};
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
    this.时间线自动播冻结帧.clear();
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
    this.清理即将退场时间线视频表面(this.读取当前虚拟消息项());
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
        /**
         * 旧 owner 退场前，先向唯一播放器要这一拍最终 flush：
         * 1. 否则会先按旧 preview 时间撤掉 canonical host；
         * 2. 紧接着外层再回灌一条更近位置，露出的 preview 就会在用户眼前 seek 一下；
         * 3. 这里先把最后一拍位置灌回本地桥，再对齐底板 preview，用户看到的才是同一帧退场。
         */
        读取默认全局唯一播放器().冲刷当前时间线播放位置();
        this.同步即将退场Owner底板预览(previousOwnerAttachmentId);
        this.时间线唯一播放器可见接管就绪源.delete(previousOwnerAttachmentId);
        this.最近退场Owner附件Id = previousOwnerAttachmentId;
      } else if (!currentOwnerAttachmentId) {
        this.最近退场Owner附件Id = null;
      }
      if (
        currentOwnerAttachmentId &&
        currentOwnerAttachmentId !== previousOwnerAttachmentId &&
        (previousOwnerAttachmentId ||
          currentOwnerAttachmentId === this.最近退场Owner附件Id)
      ) {
        /**
         * reveal gate 只对“这一轮 owner 交接”有效，绝不能跨轮次复用：
         * 1. 同一附件多次进出 owner 是消息流常态，上一轮 ready 不代表这一轮 canonical player 仍然已经对齐；
         * 2. 如果继续沿用旧缓存，render 会直接显露可见 canonical host，唯一播放器就会在用户眼前现场切源 / seek；
         * 3. “离屏 -> owner 为空 -> 同一附件滑回”也属于同一条视觉连续性交接，必须继续保留暂停底板，
         *    让唯一播放器在隐藏宿主里恢复位置后再揭帘；
         * 4. 因此 owner 每次进入需要承接旧可见帧的交接时，都必须清掉历史 ready 结论，重新走 hidden stage 校验。
         */
        this.时间线唯一播放器可见接管就绪源.delete(currentOwnerAttachmentId);
        this.时间线隐藏接管附件Id = currentOwnerAttachmentId;
      } else if (currentOwnerAttachmentId !== this.时间线隐藏接管附件Id) {
        this.时间线隐藏接管附件Id = null;
      }
    }
    /**
     * 退场视频源清理不能只盯属性变更：
     * 1. 虚拟列表纯滚动换窗时，Lit update 可能只来自 controller 的 range 变化；
     * 2. 这时如果还等 `items/playback/preview` 改了才清理，旧 `<video src="/webtorrent/...">`
     *    会在 DOM 复用/卸载前继续追旧 swarm，真实浏览器就会冒出残留 404；
     * 3. 现在每次 render 前都先对齐“下一拍应该还活着哪些视频表面”，
     *    因为当前预算下页面里同时存在的 preview/canonical host 数量已经被压到很小，这层清理成本可控。
     */
    this.清理即将退场时间线视频表面();
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("items")) {
      this.同步时间线视频首帧就绪缓存();
    }
    this.同步时间线自动播播放状态(changedProperties);
    if (changedProperties.size === 0 && this.inlineAutoplayOwnerAttachmentId) {
      /**
       * hidden-stage 揭帘和虚拟列表 range 更新常常是无属性更新：
       * DOM 已经从隐藏宿主切到可见宿主，但属性没有变，不能等 updateComplete.then 才迁移唯一播放器。
       * 这里同步一次宿主指针，避免真实浏览器里出现一帧到数帧的 owner -> 空 -> owner 接管空窗。
       */
      this.同步时间线唯一播放器宿主();
    }
    this.揭开已就绪的时间线隐藏接管宿主();
    const scrollContainer = this.messageScrollRef.value;
    if (!scrollContainer) {
      return;
    }
    // 虚拟列表纯 range 更新会以空 changedProperties 进来，媒体预算和候选也必须跟着当前 DOM 刷新。
    const shouldRefreshMediaWindow =
      changedProperties.size === 0 ||
      changedProperties.has("items") ||
      changedProperties.has("mediaPlaybackByAttachmentId") ||
      changedProperties.has("mediaPreviewByAttachmentId") ||
      changedProperties.has("mediaVideoBudgetByAttachmentId") ||
      changedProperties.has("inlineAutoplayOwnerAttachmentId") ||
      changedProperties.has("inlineAutoplayPlaybackByAttachmentId");
    if (!shouldRefreshMediaWindow) {
      return;
    }
    const virtualItems = this.读取当前虚拟消息项();
    this.dispatch媒体窗口观察(virtualItems);
    this.同步自动播候选观察(scrollContainer);
    if (this.自动播候选观察器) {
      return;
    }
    // 只有旧环境缺少 IntersectionObserver 时，才在低频更新点同步量测兜底。
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
    for (const attachmentId of this.时间线自动播冻结帧.keys()) {
      if (!当前视频附件.has(attachmentId)) {
        this.时间线自动播冻结帧.delete(attachmentId);
      }
    }
    for (const attachmentId of this.时间线唯一播放器可见接管就绪源.keys()) {
      if (!当前视频附件.has(attachmentId)) {
        this.时间线唯一播放器可见接管就绪源.delete(attachmentId);
      }
    }
    for (const attachmentId of this.自动播位置上报记录.keys()) {
      if (!当前视频附件.has(attachmentId)) {
        this.自动播位置上报记录.delete(attachmentId);
      }
    }
  }

  private 读取即将渲染的时间线视频表面期望(virtualItems = this.读取当前虚拟消息项()): {
    previewVideoSrcByAttachmentId: Map<string, string>;
    canonicalVideoSrcByAttachmentId: Map<string, string>;
  } {
    const 可渲染真实预览视频附件 = this.读取允许渲染真实预览视频的附件集合(virtualItems);
    const previewVideoSrcByAttachmentId = new Map<string, string>();
    const canonicalVideoSrcByAttachmentId = new Map<string, string>();
    for (const attachment of this.读取即将渲染的时间线视频附件(virtualItems)) {
      const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
      const runtimePreview = this.读取时间线视频运行时预览(attachment.attachmentId);
      const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
      const hasRuntimePreview = Boolean(runtimePreview);
      const playbackTimelineVideoSrc = this.读取时间线视频首帧预览源(attachment, playback, {
        有静态封面: hasSourcePoster,
        有运行时预览: hasRuntimePreview,
      });
      const savedTimelineFrame =
        this.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
      const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
      const knownReadyTimelineFrameSrc = this.读取时间线视频已就绪首帧预览源(
        attachment.attachmentId
      );
      const shouldReuseSavedTimelineFrameAsPreview =
        this.读取保存续帧是否允许承接时间线预览底板({
          attachmentId: attachment.attachmentId,
          playback,
          playbackTimelineVideoSrc,
          savedTimelineFrameSrc,
        });
      const timelinePreviewVideoSrcCandidate =
        playbackTimelineVideoSrc ??
        (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
        knownReadyTimelineFrameSrc;
      const budget = this.读取时间线视频预算投影(
        attachment,
        timelinePreviewVideoSrcCandidate
      );
      const timelinePreviewVideoSrc =
        budget.previewVideoSrc ??
        (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
        knownReadyTimelineFrameSrc;
      const hasKnownReadyPreviewFrame = this.读取时间线视频首帧是否就绪(
        attachment.attachmentId,
        timelinePreviewVideoSrc
      );
      const hasExistingSameSourcePreviewFrame = this.读取时间线现有预览视频是否可继续显示(
        attachment.attachmentId,
        timelinePreviewVideoSrc
      );
      if (
        this.读取时间线预览视频是否允许渲染(budget, {
          hasExistingSameSourcePreviewFrame,
          hasKnownReadyPreviewFrame,
          previewVideoSrc: timelinePreviewVideoSrc,
          shouldReuseSavedTimelineFrameAsPreview,
        }) &&
        timelinePreviewVideoSrc &&
        (可渲染真实预览视频附件.has(attachment.attachmentId) ||
          hasExistingSameSourcePreviewFrame ||
          hasKnownReadyPreviewFrame)
      ) {
        previewVideoSrcByAttachmentId.set(attachment.attachmentId, timelinePreviewVideoSrc);
      }
      if (budget.allowInlineCanonical && budget.canonicalVideoSrc) {
        canonicalVideoSrcByAttachmentId.set(attachment.attachmentId, budget.canonicalVideoSrc);
      }
    }
    return {
      previewVideoSrcByAttachmentId,
      canonicalVideoSrcByAttachmentId,
    };
  }

  private 读取即将渲染的时间线视频附件(
    virtualItems: 消息虚拟项[]
  ): 时间线视频附件[] {
    const attachmentsById = new Map<string, 时间线视频附件>();
    const unresolvedAttachmentIds = new Set<string>();
    const pushAttachment = (attachment: 消息展示项["attachments"][number]): void => {
      if (attachment.kind !== "video" || attachmentsById.has(attachment.attachmentId)) {
        return;
      }
      attachmentsById.set(attachment.attachmentId, attachment);
      unresolvedAttachmentIds.delete(attachment.attachmentId);
    };
    const pushAttachmentId = (attachmentId: string | null | undefined): void => {
      const normalized = attachmentId?.trim() ?? "";
      if (!normalized || attachmentsById.has(normalized)) {
        return;
      }
      unresolvedAttachmentIds.add(normalized);
    };

    for (const virtualItem of virtualItems) {
      const item = this.items[virtualItem.index];
      if (!item || item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        pushAttachment(attachment);
      }
    }

    pushAttachmentId(this.inlineAutoplayOwnerAttachmentId);
    pushAttachmentId(this.最近退场Owner附件Id);
    pushAttachmentId(this.时间线隐藏接管附件Id);

    for (const video of this.querySelectorAll<HTMLElement>(
      "video.message-video-preview[data-attachment-id]," +
        ".message-video-canonical-host[data-attachment-id]," +
        ".message-video-canonical-stage-host[data-attachment-id]"
    )) {
      pushAttachmentId(video.dataset.attachmentId);
    }

    if (unresolvedAttachmentIds.size > 0) {
      for (const item of this.items) {
        if (item.kind !== "message") {
          continue;
        }
        for (const attachment of item.attachments) {
          if (
            attachment.kind === "video" &&
            unresolvedAttachmentIds.has(attachment.attachmentId)
          ) {
            pushAttachment(attachment);
          }
        }
        if (unresolvedAttachmentIds.size === 0) {
          break;
        }
      }
    }

    return Array.from(attachmentsById.values());
  }

  private 释放时间线预览视频资源(video: HTMLVideoElement): void {
    /**
     * 退场 preview `<video>` 必须主动断掉旧媒体源：
     * 1. 浏览器在节点复用/卸载瞬间，仍可能沿着旧 `src` 继续追 range；
     * 2. 这时如果 swarm 会话已经被外层清理，后台就会开始打旧 `/webtorrent/...` 404；
     * 3. 因此在 Lit 把 DOM 改写掉之前，先 pause + remove src + load，明确告诉浏览器放弃旧源。
     */
    try {
      video.pause();
    } catch {
      // 某些测试宿主会在无效状态抛错；退场清理不能因此中断。
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // happy-dom / 个别浏览器实现可能拒绝无源 load；这里吞掉即可。
    }
  }

  private 清理即将退场时间线视频表面(virtualItems = this.读取当前虚拟消息项()): void {
    const { previewVideoSrcByAttachmentId, canonicalVideoSrcByAttachmentId } =
      this.读取即将渲染的时间线视频表面期望(virtualItems);
    const previewVideos = this.querySelectorAll<HTMLVideoElement>(
      'video.message-video-preview:not([data-canonical-player="true"])'
    );
    for (const video of previewVideos) {
      const attachmentId = video.dataset.attachmentId?.trim() ?? "";
      if (!attachmentId) {
        continue;
      }
      const expectedSrc = this.归一化时间线视频播放源(
        previewVideoSrcByAttachmentId.get(attachmentId) ?? null
      );
      const currentSrc = this.归一化时间线视频播放源(this.读取视频当前播放源(video));
      if (!currentSrc || currentSrc === expectedSrc) {
        continue;
      }
      this.释放时间线预览视频资源(video);
    }
    const canonicalHosts = this.querySelectorAll<HTMLElement>(
      ".message-video-canonical-host,.message-video-canonical-stage-host"
    );
    for (const host of canonicalHosts) {
      const attachmentId = host.dataset.attachmentId?.trim() ?? "";
      if (!attachmentId) {
        continue;
      }
      const expectedSrc = this.归一化时间线视频播放源(
        canonicalVideoSrcByAttachmentId.get(attachmentId) ?? null
      );
      const currentSrc = this.归一化时间线视频播放源(host.dataset.videoSrc ?? null);
      if (!currentSrc || currentSrc === expectedSrc) {
        continue;
      }
      host.dataset.videoSrc = "";
    }
  }

  private 读取时间线视频首帧是否就绪(attachmentId: string, src: string | null): boolean {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return false;
    }
    return this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc;
  }

  private 读取时间线视频已就绪首帧预览源(attachmentId: string): string | null {
    const previewState = this.mediaPreviewByAttachmentId[attachmentId] ?? null;
    if (previewState?.phase === "missing_source") {
      return null;
    }
    const src = this.时间线视频首帧就绪源.get(attachmentId) ?? null;
    if (!src || 视频地址属于旧流媒体清单(src)) {
      return null;
    }
    return src;
  }

  private 标记时间线视频首帧已就绪(attachmentId: string, src: string | null): void {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return;
    }
    if (this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc) {
      /**
       * 同一个 src 可能对应高速虚拟卸载后重新挂载的一颗新 `<video>`：
       * 源级缓存已经命中，但当前 DOM 刚刚 `loadeddata`，仍需要重新渲染一次，
       * 让 poster/guard 按“当前 DOM 已出帧”退场，避免卡在遮挡态。
       */
      this.requestUpdate();
      return;
    }
    this.时间线视频首帧就绪源.set(attachmentId, normalizedSrc);
    this.requestUpdate();
  }

  private 读取时间线自动播冻结帧(
    attachmentId: string,
    src: string | null,
    position: 媒体播放位置 | null
  ): 时间线自动播冻结帧 | null {
    if (!position) {
      return null;
    }
    const frame = this.时间线自动播冻结帧.get(attachmentId) ?? null;
    const normalizedExpectedSrc = this.归一化时间线视频播放源(src);
    const normalizedFrameSrc = this.归一化时间线视频播放源(frame?.src ?? null);
    if (
      !frame ||
      !normalizedExpectedSrc ||
      !normalizedFrameSrc ||
      normalizedExpectedSrc !== normalizedFrameSrc ||
      !frame.dataUrl.startsWith("data:image/")
    ) {
      return null;
    }
    if (
      Math.abs(frame.currentTime - position.currentTime) >
      时间线自动播冻结帧允许时间偏差秒
    ) {
      return null;
    }
    return frame;
  }

  private 捕获时间线自动播冻结帧(attachmentId: string, video: HTMLVideoElement): void {
    const src = this.读取视频当前播放源(video);
    const currentTime = video.currentTime;
    if (
      !attachmentId ||
      !src ||
      !Number.isFinite(currentTime) ||
      currentTime < 0 ||
      video.readyState < video.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      return;
    }
    const previousFrame = this.时间线自动播冻结帧.get(attachmentId);
    if (
      previousFrame?.src === src &&
      Math.abs(previousFrame.currentTime - currentTime) < 0.5
    ) {
      return;
    }
    const captureKey = `${src}\u0000${Math.round(currentTime * 2) / 2}`;
    if (this.时间线自动播冻结帧导出中.get(attachmentId) === captureKey) {
      return;
    }
    try {
      const scale = Math.min(
        1,
        时间线自动播冻结帧最大边长 / Math.max(video.videoWidth, video.videoHeight)
      );
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.drawImage(video, 0, 0, width, height);
      if (typeof canvas.toBlob !== "function") {
        return;
      }
      this.时间线自动播冻结帧导出中.set(attachmentId, captureKey);
      canvas.toBlob((blob) => {
        void (async () => {
          try {
            if (!blob || blob.type !== "image/webp") {
              return;
            }
            const dataUrl = await 读取BlobDataUrl(blob);
            if (!dataUrl?.startsWith("data:image/webp")) {
              return;
            }
            if (this.时间线自动播冻结帧导出中.get(attachmentId) !== captureKey) {
              return;
            }
            const latestFrame = this.时间线自动播冻结帧.get(attachmentId);
            if (
              latestFrame?.src === src &&
              Math.abs(latestFrame.currentTime - currentTime) < 0.5 &&
              latestFrame.dataUrl === dataUrl
            ) {
              return;
            }
            this.时间线自动播冻结帧.set(attachmentId, {
              src,
              currentTime,
              dataUrl,
              updatedAt: Date.now(),
            });
            this.requestUpdate();
          } finally {
            if (this.时间线自动播冻结帧导出中.get(attachmentId) === captureKey) {
              this.时间线自动播冻结帧导出中.delete(attachmentId);
            }
          }
        })();
      }, "image/webp", 0.82);
    } catch {
      // Canvas 可能因为解码器、浏览器策略或测试环境不可用而拒绝截图；失败时继续走原播放链，不扩大成业务错误。
      if (this.时间线自动播冻结帧导出中.get(attachmentId) === captureKey) {
        this.时间线自动播冻结帧导出中.delete(attachmentId);
      }
    }
  }

  private 读取时间线唯一播放器是否可见接管就绪(
    attachmentId: string,
    src: string | null
  ): boolean {
    const normalizedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return false;
    }
    if (this.时间线唯一播放器可见接管就绪源.get(attachmentId) !== normalizedSrc) {
      return false;
    }
    const canonicalVideo = this.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
    );
    if (!canonicalVideo || !canonicalVideo.isConnected || canonicalVideo.seeking) {
      return false;
    }
    const normalizedCurrentSrc = this.归一化时间线视频播放源(
      this.读取视频当前播放源(canonicalVideo)
    );
    if (normalizedCurrentSrc !== normalizedSrc) {
      return false;
    }
    /**
     * 可见接管缓存只是“这个 src 曾经可揭帘”的历史事实；
     * 高速虚拟回滑后，当前这颗唯一播放器 DOM 可能已经重新 load 到 readyState=0。
     * reveal 必须同时看当前 DOM 的 canplay 级证据，否则会把黑色播放器壳直接暴露给用户。
     */
    const 最低可见接管就绪状态 =
      typeof canonicalVideo.HAVE_FUTURE_DATA === "number" ? canonicalVideo.HAVE_FUTURE_DATA : 3;
    return canonicalVideo.readyState >= 最低可见接管就绪状态;
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

  private 揭开已就绪的时间线隐藏接管宿主(): void {
    const ownerAttachmentId = this.inlineAutoplayOwnerAttachmentId;
    if (!ownerAttachmentId) {
      return;
    }
    const stageHost = this.querySelector<HTMLElement>(
      `.message-video-canonical-stage-host[data-attachment-id="${ownerAttachmentId}"]`
    );
    const src = stageHost?.dataset.videoSrc?.trim() ?? "";
    if (
      !stageHost ||
      !src ||
      !this.读取时间线唯一播放器是否可见接管就绪(ownerAttachmentId, src)
    ) {
      return;
    }
    /**
     * hidden-stage ready 事实可能发生在上一轮 DOM 提交之后：
     * - canonical video 已经 canplay/seeked，reveal gate 也已经写入；
     * - 但没有新的 Lit 更新时，可见 preview 会和隐藏 canonical 长时间并存；
     * - 这里用 owner 层事实触发一次揭帘更新，避免靠滚动/下一条消息的偶然更新救场。
     */
    this.requestUpdate();
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

  private 预热自动播候选首帧(candidates: 消息视频自动播候选[]): void {
    if (candidates.length === 0) {
      return;
    }
    const buttonsByAttachmentId = new Map(
      Array.from(
        this.querySelectorAll<HTMLButtonElement>(
          "button.message-video-preview-trigger[data-attachment-id]"
        )
      ).map((button) => [button.dataset.attachmentId ?? "", button])
    );
    for (const candidate of candidates.slice(0, 首帧预热候选上限)) {
      const button = buttonsByAttachmentId.get(candidate.attachmentId);
      if (!button) {
        continue;
      }
      this.预热时间线视频首帧(button, candidate.attachmentId);
    }
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
    const runtimePosition = this.校验同源自动播恢复位置(
      src,
      this.inlineAutoplayPositionByAttachmentId[attachmentId] ?? null
    );
    const localPosition = this.校验同源自动播恢复位置(
      src,
      (() => {
        const local = this.自动播位置上报记录.get(attachmentId);
        if (!local) {
          return null;
        }
        return {
          src: local.src,
          currentTime: local.currentTime,
          updatedAt: local.reportedAt,
        } satisfies 媒体播放位置;
      })()
    );
    if (!runtimePosition) {
      return localPosition;
    }
    if (!localPosition) {
      return runtimePosition;
    }
    /**
     * 这里不是给本地节流表升格，而是只在“它比外层 snapshot 更新更晚”时，
     * 让同组件退场这一拍先吃到更近的位置。
     */
    return localPosition.updatedAt > runtimePosition.updatedAt ? localPosition : runtimePosition;
  }

  private 校验同源自动播恢复位置(
    src: string,
    position: 媒体播放位置 | null
  ): 媒体播放位置 | null {
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

  private 同步即将退场Owner底板预览(attachmentId: string): void {
    const previewVideo = this.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );
    const canonicalVideo = this.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
    );
    if (!canonicalVideo) {
      return;
    }
    const canonicalSrc = this.读取视频当前播放源(canonicalVideo);
    const normalizedCanonicalSrc = this.归一化时间线视频播放源(canonicalSrc);
    if (!normalizedCanonicalSrc) {
      return;
    }
    const localBridge = this.自动播位置上报记录.get(attachmentId);
    const normalizedLocalBridgeSrc = this.归一化时间线视频播放源(localBridge?.src ?? null);
    const hasNewerLocalBridge =
      Boolean(localBridge) &&
      normalizedLocalBridgeSrc === normalizedCanonicalSrc &&
      Number.isFinite(localBridge?.currentTime) &&
      (localBridge?.currentTime ?? 0) > canonicalVideo.currentTime + 0.25;
    const targetCurrentTime = hasNewerLocalBridge
      ? (localBridge?.currentTime ?? canonicalVideo.currentTime)
      : canonicalVideo.currentTime;
    /**
     * 旧 owner 退场前只认 canonical player 这一颗真实视频：
     * 1. 先从 canonical 捕获暂停帧，退场后用只读图片承接像素；
     * 2. 同时强制刷新一把本地位置桥，兜住 runtime snapshot 慢一拍的窗口；
     * 3. 如果旧版本 DOM 里还残留 preview video，只允许顺手对齐它，不能再依赖它做第二播放表面。
     */
    this.标记时间线视频首帧已就绪(attachmentId, canonicalSrc);
    this.捕获时间线自动播冻结帧(attachmentId, canonicalVideo);
    if (!hasNewerLocalBridge) {
      this.广播自动播播放位置(attachmentId, canonicalVideo, true, true);
    }
    if (!previewVideo) {
      return;
    }
    const previewSrc = this.读取视频当前播放源(previewVideo);
    const normalizedPreviewSrc = this.归一化时间线视频播放源(previewSrc);
    if (normalizedCanonicalSrc !== normalizedPreviewSrc) {
      return;
    }
    if (Math.abs(previewVideo.currentTime - targetCurrentTime) < 0.25) {
      return;
    }
    try {
      previewVideo.currentTime = targetCurrentTime;
    } catch {
      // preview 底板自己还没完全稳定时，后续的恢复位置桥会再补一次，这里不升级成失败。
    }
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
     * `currentTime > 0` 只能说明 seek 目标已写入，不能证明当前 DOM 已有可展示像素。
     */
    return previewVideo.readyState >= 2;
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
    if (force || allowReleasedOwner) {
      this.捕获时间线自动播冻结帧(attachmentId, video);
    }
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
      !changedProperties.has("mediaVideoBudgetByAttachmentId") &&
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
        this.捕获时间线自动播冻结帧(attachmentId, video);
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
    this.预热自动播候选首帧(candidates);
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
      const effectiveVisibleHeightBase = Math.max(
        1,
        Math.min(rect.height, viewportRect.height > 0 ? viewportRect.height : rect.height)
      );
      return {
        attachmentId,
        visibilityRatio: Math.min(1, visibleHeight / effectiveVisibleHeightBase),
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
            const rootBounds = entry.rootBounds ?? null;
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
    }
  }

  /**
   * 消息窗只把“浏览器当前看到了什么”翻成候选集合：
   * - 可见比例和距视口中心的距离是壳层事实；
   * - 真正谁拥有自动播资格，必须继续交给上层编排裁决。
   */
  private 读取自动播候选(scrollContainer: HTMLElement): 消息视频自动播候选[] {
    const 裁剪预算 = (candidates: Iterable<消息视频自动播候选>): 消息视频自动播候选[] =>
      Array.from(candidates)
        .sort(
          (left, right) =>
            left.distanceToViewportCenter - right.distanceToViewportCenter ||
            right.visibilityRatio - left.visibilityRatio ||
            left.attachmentId.localeCompare(right.attachmentId)
        )
        .slice(0, 自动播观察候选上限);
    if (this.自动播候选观察器) {
      return 裁剪预算(this.自动播候选可见条目.values());
    }
    const viewportRect = scrollContainer.getBoundingClientRect();
    const videoEntries = Array.from(
      this.querySelectorAll<HTMLButtonElement>("button.message-video-preview-trigger[data-attachment-id]")
    );
    return 裁剪预算(
      videoEntries
        .map((entry) => this.量测按钮自动播候选(entry, viewportRect))
        .filter((candidate): candidate is 消息视频自动播候选 => candidate !== null)
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
    const aliasHeight = item.showAlias ? 22 : 0;
    if (item.attachments.length > 0) {
      const mediaHeight = this.估算媒体附件布局高度(item);
      const mediaTextGap = item.hasText ? 8 : 0;
      return Math.max(48, aliasHeight + item.layout.height + mediaTextGap + mediaHeight);
    }
    return Math.max(48, aliasHeight + item.layout.height + 32);
  }

  private 估算媒体附件布局高度(item: 消息展示项): number {
    if (item.attachments.length === 0) {
      return 0;
    }
    const layout = item.attachmentLayout;
    if (layout) {
      const rowCount = Math.max(
        1,
        ...item.attachments.map(
          (attachment) =>
            (attachment.gridRowStart ?? 1) + Math.max(1, attachment.gridRowSpan ?? 1) - 1
        )
      );
      return rowCount * layout.rowHeight + Math.max(0, rowCount - 1) * layout.gap;
    }
    const columnCount = item.attachments.length >= 2 ? 2 : 1;
    const rowCount = Math.ceil(item.attachments.length / columnCount);
    const rowHeight = Math.max(
      0,
      ...item.attachments.map((attachment) => attachment.displayHeight)
    );
    const gap = columnCount > 1 ? 8 : 0;
    return rowCount * rowHeight + Math.max(0, rowCount - 1) * gap;
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

    /**
     * Lit 父壳把消息属性喂给子组件时，首帧可能早于 virtualizer 算出真实 range。
     * 这里仍要兜底，但兜底只服务“先别空白”，不能再退化成：
     * 1. 先把 30 多条历史消息一次性塞进 DOM；
     * 2. 再让自动播候选/媒体窗口从这批假首屏里推导出大批重对象；
     * 3. 最后等真正的 virtualizer range 回来以后再被动裁员。
     *
     * 所以首帧兜底只覆盖大约一屏到一屏多一点，并且硬限制消息数量；
     * 真正的 overscan 仍然交给 TanStack virtualizer 在下一拍接管。
     */
    const 视口高度 =
      this.messageScrollRef.value?.clientHeight || this.clientHeight || 首帧兜底默认视口高度;
    const 目标覆盖高度 = Math.max(视口高度 * 首帧兜底视口覆盖倍率, 首帧兜底默认视口高度);
    let 累积高度 = 0;
    let 已选消息数 = 0;
    let endIndex = 0;
    for (; endIndex < this.items.length; endIndex += 1) {
      累积高度 += this.估算消息行高度(endIndex) + 10;
      已选消息数 += 1;
      if (已选消息数 >= 首帧兜底消息预算上限) {
        break;
      }
      if (已选消息数 >= 首帧兜底最小消息数量 && 累积高度 >= 目标覆盖高度) {
        break;
      }
    }
    const indexes = this.提取消息虚拟范围({
      startIndex: 0,
      endIndex: Math.min(this.items.length - 1, endIndex),
      overscan: 0,
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

  private 读取当前虚拟消息项(): 消息虚拟项[] {
    return this.补齐首帧消息虚拟项(this.读取消息虚拟器().getVirtualItems());
  }

  private 读取当前媒体窗口附件标识(virtualItems = this.读取当前虚拟消息项()): string[] {
    const attachmentIds: string[] = [];
    const seen = new Set<string>();
    let mediaCount = 0;
    let videoCount = 0;
    const push = (
      attachmentId: string | null | undefined,
      kind: "image" | "video"
    ): void => {
      const normalized = attachmentId?.trim() ?? "";
      if (!normalized || seen.has(normalized)) {
        return;
      }
      if (mediaCount >= 近视口活媒体会话预算上限) {
        return;
      }
      if (kind === "video" && videoCount >= 近视口活视频会话预算上限) {
        return;
      }
      seen.add(normalized);
      attachmentIds.push(normalized);
      mediaCount += 1;
      if (kind === "video") {
        videoCount += 1;
      }
    };
    /**
     * 当前媒体窗口事件必须先做预算裁剪，再把附件集合回抛给编排层：
     * 1. owner / 刚退场 owner / 可见自动播候选优先占据热会话名额；
     * 2. 其余附件再按当前虚拟窗口里的消息顺序补齐；
     * 3. 这样单屏多附件消息不会把“当前窗口”偷换成“整屏全部附件都算活会话”。
     */
    push(this.inlineAutoplayOwnerAttachmentId, "video");
    push(this.最近退场Owner附件Id, "video");
    for (const [attachmentId] of Array.from(this.自动播候选可见条目.entries()).sort(
      (left, right) => left[1].distanceToViewportCenter - right[1].distanceToViewportCenter
    )) {
      push(attachmentId, "video");
    }
    for (const virtualItem of virtualItems) {
      const item = this.items[virtualItem.index];
      if (!item || item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        push(attachment.attachmentId, attachment.kind);
      }
    }
    return attachmentIds;
  }

  private 读取允许渲染真实预览视频的附件集合(
    virtualItems = this.读取当前虚拟消息项()
  ): Set<string> {
    const orderedAttachmentIds: string[] = [];
    const seen = new Set<string>();
    const push = (attachmentId: string | null | undefined): void => {
      const normalized = attachmentId?.trim() ?? "";
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      orderedAttachmentIds.push(normalized);
    };

    /**
     * 真实 preview `<video>` 的预算优先级固定为：
     * 1. 当前 owner / 刚退场 owner 先保住连续性；
     * 2. 当前虚拟窗口里已经有保存续播位置的卡片优先，因为高速回滑时它们最容易被用户看见闪回 poster；
     * 3. 当前虚拟窗口里已经真实出过首帧的卡片优先，因为编排冷快照可能比虚拟回滑慢一拍；
     * 4. 已进入近视口候选的卡片优先；
     * 5. 其余只允许当前虚拟窗口里最靠前的一小撮视频继续挂真实 `<video>`。
     *
     * 这样做的目的不是“所有历史视频都别显示”，而是让真正重的 DOM/解码表面收敛到稳定上限。
     */
    push(this.inlineAutoplayOwnerAttachmentId);
    push(this.最近退场Owner附件Id);
    for (const virtualItem of virtualItems) {
      const item = this.items[virtualItem.index];
      if (!item || item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (attachment.kind !== "video") {
          continue;
        }
        const position = this.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
        if (
          position?.src &&
          Number.isFinite(position.currentTime) &&
          position.currentTime > 0
        ) {
          push(attachment.attachmentId);
        }
      }
    }
    for (const virtualItem of virtualItems) {
      const item = this.items[virtualItem.index];
      if (!item || item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (
          attachment.kind === "video" &&
          this.读取时间线视频已就绪首帧预览源(attachment.attachmentId)
        ) {
          push(attachment.attachmentId);
        }
      }
    }
    for (const [attachmentId] of Array.from(this.自动播候选可见条目.entries()).sort(
      (left, right) => left[1].distanceToViewportCenter - right[1].distanceToViewportCenter
    )) {
      push(attachmentId);
    }
    for (const virtualItem of virtualItems) {
      const item = this.items[virtualItem.index];
      if (!item || item.kind !== "message") {
        continue;
      }
      for (const attachment of item.attachments) {
        if (attachment.kind === "video") {
          push(attachment.attachmentId);
        }
      }
    }
    return new Set(orderedAttachmentIds.slice(0, 近视口真实预览视频预算上限));
  }

  private dispatch媒体窗口观察(virtualItems = this.读取当前虚拟消息项()): void {
    const attachmentIds = this.读取当前媒体窗口附件标识(virtualItems);
    const signature = attachmentIds.join("\u0000");
    if (signature === this.上次媒体窗口附件签名) {
      return;
    }
    this.上次媒体窗口附件签名 = signature;
    this.dispatchEvent(
      new CustomEvent<{ attachmentIds: string[] }>("room-media-window-observed", {
        detail: {
          attachmentIds,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private 读取附件播放源(attachment: 消息展示项["attachments"][number]): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId];
    if (
      attachment.kind === "video" &&
      视频地址属于旧流媒体清单(playback?.src)
    ) {
      return "";
    }
    return playback?.mode === "swarm" ||
      playback?.mode === "anchor"
      ? playback.src
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
    playback: 媒体播放结果 | null,
    input: {
      有静态封面: boolean;
      有运行时预览: boolean;
    }
  ): string | null {
    if (playback?.src && playback.mode === "swarm") {
      const previewState = this.mediaPreviewByAttachmentId[attachment.attachmentId] ?? null;
      /**
       * 时间线 preview video 继续复用同一条 `swarm playback.src`，但它只回答“底层热态与连续性桥”：
       * 1. 这颗 `<video>` 仍然负责 preload / readyState / continuity bridge，避免 owner 接管时重新建壳；
       * 2. 真正的“当前可见像素”不再默认等于这颗视频自己的 `0s` 冷帧，而由上层 overlay preview truth 决定；
       * 3. 因此这里保留同源 `<video>` 壳，但 `missing_source` 仍要明确阻断，防止冷视频伪装成 preview。
       */
      if (input.有静态封面 || input.有运行时预览) {
        return playback.src;
      }
      if (previewState?.phase === "missing_source") {
        return null;
      }
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

  private 读取时间线视频预算投影(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    previewVideoSrcCandidate: string | null
  ): 信息流视频预算投影 {
    const fromSnapshot = this.mediaVideoBudgetByAttachmentId[attachment.attachmentId];
    if (fromSnapshot) {
      return fromSnapshot;
    }
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    const inlineAutoplayPlayback =
      this.inlineAutoplayPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    /**
     * fallback 里的 preview 候选只可能来自两条受控事实：
     * 1. `playback.mode === "swarm"` 的正式 WebTorrent 播放源；
     * 2. 刚退场 owner 留下的同源续帧桥。
     * 这里认的是上游事实来源，不用 URL 文本猜 `src`，避免把合法续帧误压成冷表达。
     */
    const formalByteSource: 正式媒体字节来源 =
      playback?.mode === "swarm" ||
      inlineAutoplayPlayback?.mode === "swarm" ||
      Boolean(previewVideoSrcCandidate)
        ? "webtorrent_official_stream"
        : "none";
    /**
     * 这里的 fallback 只服务直连组件测试和极少数独立挂载场景：
     * 1. 真实应用路径会由聊天媒体编排先给出统一预算投影；
     * 2. 即便需要兜底，也继续复用同一个投影原语，不再在消息窗里手搓第二套 owner 判断；
     * 3. 这样可以兼顾测试稳定性，同时守住“预算逻辑只有一份”的约束。
     */
    return 投影信息流视频预算({
      attachmentId: attachment.attachmentId,
      playback,
      inlineAutoplayPlayback,
      viewerCanonicalVideoSrc: null,
      previewVideoSrc: previewVideoSrcCandidate,
      inMediaWindow: true,
      isAutoplayCandidate: false,
      isInlineAutoplayOwner: this.inlineAutoplayOwnerAttachmentId === attachment.attachmentId,
      isViewerOwner: false,
      sessionStatus: playback?.mode === "swarm" ? "backfilling" : null,
      locallyComplete: false,
      formalByteSource,
    });
  }

  private 读取时间线预览视频是否允许渲染(
    budget: 信息流视频预算投影,
    input: {
      hasExistingSameSourcePreviewFrame?: boolean;
      hasFrozenTimelineFrame?: boolean;
      hasKnownReadyPreviewFrame?: boolean;
      previewVideoSrc: string | null;
      shouldReuseSavedTimelineFrameAsPreview: boolean;
    }
  ): boolean {
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
    /**
     * 续播/首帧缓存只能桥接仍归 WebTorrent 主链拥有的正式字节：
     * `none` 代表当前预算只允许静态表达，不能因为历史 src 曾经出帧就重新挂真实 `<video>`。
     */
    return budget.formalByteSource === "webtorrent_official_stream";
  }

  private 读取保存续帧是否允许承接时间线预览底板(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
    playbackTimelineVideoSrc: string | null;
    savedTimelineFrameSrc: string | null;
  }): boolean {
    if (!input.savedTimelineFrameSrc) {
      return false;
    }
    /**
     * 保存续帧只允许服务三种场景：
     * 1. 正式 playback 这一拍暂时还没回灌回来，此时保存帧是唯一像素桥；
     * 2. 当前 / 刚退场 owner 需要保住底板连续性，避免 canonical host 挪走后闪回 poster；
     * 3. 已有正式 swarm playback 且保存帧与当前 preview 源同源，说明它不是历史幽灵，而是同一条 WebTorrent 主链的暂停帧。
     *
     * 其余 `missing_source` 卡片即便有历史播放位置，也不代表它“天然就有 preview 真相”。
     * 否则 newcomer 首次进房滚动时，旧的 swarm 源会被房间消息窗偷偷重新长成一张 preview video，
     * 表面看像“有预览”，实际只是历史 playback 泄漏到了展示层。
     */
    if (!input.playback) {
      return true;
    }
    if (
      this.inlineAutoplayOwnerAttachmentId === input.attachmentId ||
      this.最近退场Owner附件Id === input.attachmentId
    ) {
      return true;
    }
    if (input.playback.mode !== "swarm") {
      return false;
    }
    const normalizedSavedSrc = this.归一化时间线视频播放源(input.savedTimelineFrameSrc);
    const normalizedPreviewSrc = this.归一化时间线视频播放源(input.playbackTimelineVideoSrc);
    return Boolean(normalizedSavedSrc && normalizedSavedSrc === normalizedPreviewSrc);
  }

  private 同步时间线唯一播放器宿主(): void {
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const ownerAttachmentId = this.inlineAutoplayOwnerAttachmentId;
    if (!ownerAttachmentId) {
      全局唯一播放器.同步时间线自动播(null);
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
    // 时间线唯一播放器只接受正式唯一链的 file 源，旧 manifest/dash 残留必须当场拦下。
    const kind = host?.dataset.videoKind === "file" ? "file" : null;
    const width = Number(host?.dataset.videoWidth ?? "0");
    const height = Number(host?.dataset.videoHeight ?? "0");
    if (!host || !host.isConnected || !src) {
      // owner 仍存在但虚拟宿主暂不在 DOM 时，不把唯一播放器误翻译成“停止播放”。
      全局唯一播放器.暂停当前时间线播放();
      return;
    }
    if (
      !kind ||
      视频地址属于旧流媒体清单(src) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      全局唯一播放器.同步时间线自动播(null);
      return;
    }
    全局唯一播放器.同步时间线自动播({
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
        const viewerVideoSrc = this.读取附件播放源(attachment);
        const viewerResumePosition = this.读取自动播恢复位置(
          attachment.attachmentId,
          viewerVideoSrc
        );
        items.push({
          kind: "video",
          attachmentId: attachment.attachmentId,
          src: viewerVideoSrc,
          // 播放链拿到的新 thumbnail 可能已经完成重签；应优先覆盖消息快照里可能失效的旧 poster。
          posterSrc:
            playback?.thumbnailUrl ??
            this.读取时间线视频运行时预览(attachment.attachmentId)?.src ??
            attachment.posterSrc ??
            null,
          ...(viewerResumePosition ? { resumePosition: viewerResumePosition } : {}),
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

  private renderMessageAttachments(
    item: 消息展示项,
    可渲染真实预览视频附件: Set<string>
  ) {
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
            const playbackTimelineVideoSrc = this.读取时间线视频首帧预览源(
              attachment,
              playback,
              {
                有静态封面: hasSourcePoster,
                有运行时预览: hasRuntimePreview,
              }
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
            const knownReadyTimelineFrameSrc = this.读取时间线视频已就绪首帧预览源(
              attachment.attachmentId
            );
            const shouldReuseSavedTimelineFrameAsPreview =
              this.读取保存续帧是否允许承接时间线预览底板({
                attachmentId: attachment.attachmentId,
                playback,
                playbackTimelineVideoSrc,
                savedTimelineFrameSrc,
              });
            const timelinePreviewVideoSrcCandidate =
              playbackTimelineVideoSrc ??
              (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
              knownReadyTimelineFrameSrc;
            const videoBudget = this.读取时间线视频预算投影(
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
              this.读取时间线唯一播放器是否可见接管就绪(
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
            const restorableTimelineFrame = this.读取自动播恢复位置(
              attachment.attachmentId,
              previewVideoSrc
            );
            const isRecentlyReleasedOwnerWithPosition =
              attachment.attachmentId === this.最近退场Owner附件Id;
            const hasExistingSameSourcePreviewFrame =
              this.读取时间线现有预览视频是否可继续显示(
                attachment.attachmentId,
                previewVideoSrc
              );
            const frozenTimelineFrame = this.读取时间线自动播冻结帧(
              attachment.attachmentId,
              previewVideoSrc ?? ownerCanonicalVideoSrc,
              restorableTimelineFrame
            );
            const hasFrozenTimelineFrame = Boolean(frozenTimelineFrame);
            const hasKnownReadyPreviewFrame = this.读取时间线视频首帧是否就绪(
              attachment.attachmentId,
              previewVideoSrc
            );
            const hasCurrentDomPreviewFrame = hasExistingSameSourcePreviewFrame;
            const normalizedPreviewVideoSrc =
              this.归一化时间线视频播放源(previewVideoSrc);
            const normalizedSavedTimelineFrameSrc =
              this.归一化时间线视频播放源(savedTimelineFrameSrc);
            const normalizedOwnerCanonicalVideoSrc =
              this.归一化时间线视频播放源(ownerCanonicalVideoSrc);
            const hasHistoricalCanonicalReveal =
              Boolean(normalizedOwnerCanonicalVideoSrc) &&
              this.时间线唯一播放器可见接管就绪源.get(attachment.attachmentId) ===
                normalizedOwnerCanonicalVideoSrc;
            const hasSameSourceSavedTimelineFrame = Boolean(
              normalizedPreviewVideoSrc &&
                normalizedSavedTimelineFrameSrc &&
                normalizedPreviewVideoSrc === normalizedSavedTimelineFrameSrc
            );
            const playbackContinuityDecision = 判定播放连续性表面({
              attachmentId: attachment.attachmentId,
              ownerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
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
                this.读取时间线预览视频是否允许渲染(videoBudget, {
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
              (this.时间线隐藏接管附件Id === attachment.attachmentId ||
                hasHistoricalCanonicalReveal);
            const shouldRenderStageHost = shouldUseHiddenStageCover && !shouldRevealCanonicalHost;
            const shouldRenderVisibleCanonicalHost =
              shouldRenderInlineVideo && (!shouldUseHiddenStageCover || shouldRevealCanonicalHost);
            const shouldRenderPreviewVideo =
              shouldRenderPreviewVideoByBudget &&
              !shouldRenderVisibleCanonicalHost &&
              (!isRecentlyReleasedOwnerWithPosition ||
                shouldRenderReleasedOwnerPreviewVideo);
            const shouldRenderFrozenTimelineFrame =
              hasFrozenTimelineFrame &&
              !hasCurrentDomPreviewFrame &&
              (!shouldRenderInlineVideo || !shouldRevealCanonicalHost);
            const shouldRenderCanonicalLoadingPosterCover =
              shouldRenderInlineVideo &&
              !shouldRevealCanonicalHost &&
              !shouldRenderPreviewVideo &&
              !shouldRenderFrozenTimelineFrame &&
              !hasCurrentDomPreviewFrame &&
              Boolean(previewPosterSrc);
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
                        this.标记视频封面加载失败(attachment.attachmentId, event)}
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
                  @contextmenu=${this.阻止时间线媒体预览原生菜单}
                  @click=${(event: Event) =>
                    this.打开媒体查看器(event, attachment.attachmentId)}
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
    可渲染真实预览视频附件: Set<string>
  ) {
    const rowStyle = `position: absolute; top: 0; left: 0; width: 100%; transform: translateY(${start}px);`;
    if (item.kind === "unread-divider") {
      return html`
        <li
          id="unreadDivider"
          class="unread-divider"
          data-kind="unread-divider"
          data-index=${index}
          style=${rowStyle}
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
      >
        <div class="message-stack ${item.owner}">
          ${alias}
          <article
            class=${surfaceClass}
            style=${`width: ${item.bubbleWidth}px;`}
          >
            ${item.hasText ? this.renderMessageBody(item) : null}
            ${this.renderMessageAttachments(item, 可渲染真实预览视频附件)}
          </article>
        </div>
      </li>
    `;
  }

  override render() {
    const virtualizer = this.读取消息虚拟器();
    const virtualItems = this.补齐首帧消息虚拟项(virtualizer.getVirtualItems());
    const 可渲染真实预览视频附件 = this.读取允许渲染真实预览视频的附件集合(virtualItems);
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
                可渲染真实预览视频附件
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
