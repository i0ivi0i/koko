import { html, LitElement, type PropertyValues } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import {
  视频地址属于旧流媒体清单,
  type 媒体播放结果,
  type 媒体播放位置,
} from "../媒体/媒体播放.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "../媒体/媒体查看器.js";
import {
  渲染消息附件,
  读取保存续帧是否允许承接时间线预览底板 as 读取保存续帧是否允许承接时间线预览底板投影,
  读取附件播放源 as 读取附件播放源投影,
  读取图片查看器播放源 as 读取图片查看器播放源投影,
  读取时间线视频封面地址 as 读取时间线视频封面地址投影,
  读取时间线视频首帧预览源 as 读取时间线视频首帧预览源投影,
  读取时间线视频预算投影 as 读取时间线视频预算投影计算,
  读取时间线预览视频是否允许渲染 as 读取时间线预览视频是否允许渲染投影,
} from "./附件渲染.js";
import {
  估算媒体附件布局高度,
  估算消息行高度,
  提取消息虚拟范围,
  补齐首帧消息虚拟项,
  消息虚拟列表overscan消息数,
  type 消息虚拟项,
  type 消息虚拟范围,
} from "./消息虚拟列表.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";
import { 自动播候选观察Owner } from "./自动播候选观察器.js";
import { 时间线播放器宿主Owner } from "./时间线播放器宿主.js";
import { 时间线画面缓存Owner } from "./时间线画面缓存.js";
import {
  媒体窗口观察Owner,
  读取即将渲染的时间线视频附件,
  读取允许渲染真实预览视频附件集合,
  type 时间线视频附件,
} from "./媒体窗口.js";

const 自动播时间戳常规上报最小间隔毫秒 = 1_000;
const 自动播时间戳常规上报最小变化秒 = 0.75;
const 自动播观察候选上限 = 12;
const 首帧预热候选上限 = 2;

/**
 * 真正的房间消息窗 owner 收进本文件：
 * 1. 根级 `frontend/房间消息窗.ts` 已删除；
 * 2. 这里统一承接消息列表虚拟化、局部媒体交互和滚动观察；
 * 3. 聊天壳内部直连这里，避免根目录再次回流成展示总控。
 *
 * 房间消息窗只承接消息视口内部的表达与交互回抛：
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
  private readonly 自动播候选观察Owner: 自动播候选观察Owner;
  private readonly 媒体窗口观察Owner: 媒体窗口观察Owner;
  private readonly 时间线播放器宿主Owner: 时间线播放器宿主Owner;
  private readonly 时间线画面缓存Owner: 时间线画面缓存Owner;
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
   * canonical player 可见接管就绪缓存：
   * - key: attachmentId
   * - value: 已经在隐藏预热宿主上完成 source/time 对齐、可以揭帘到可见卡片的 src
   *
   * 设计约束：
   * 1. 这不是普通预览 `<video>` 的首帧 ready，而是“唯一播放器自己已经准备好接管可见表面”；
   * 2. 不能与普通预览首帧 ready 缓存复用，否则预览壳刚 ready 就会误判成 canonical 也 ready；
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
    this.自动播候选观察Owner = new 自动播候选观察Owner({
      读取视频按钮: () =>
        this.querySelectorAll<HTMLButtonElement>(
          "button.message-video-preview-trigger[data-attachment-id]"
        ),
      派发候选: (candidates) => {
        this.预热自动播候选首帧(candidates);
        this.dispatchEvent(
          new CustomEvent<{ candidates: 消息视频自动播候选[] }>(
            "room-inline-autoplay-observed",
            {
              detail: { candidates },
              bubbles: true,
              composed: true,
            }
          )
        );
      },
      读取连通状态: () => this.isConnected,
      候选上限: 自动播观察候选上限,
    });
    this.媒体窗口观察Owner = new 媒体窗口观察Owner((attachmentIds) => {
      this.dispatchEvent(
        new CustomEvent<{ attachmentIds: string[] }>("room-media-window-observed", {
          detail: {
            attachmentIds,
          },
          bubbles: true,
          composed: true,
        })
      );
    });
    this.时间线播放器宿主Owner = new 时间线播放器宿主Owner({
      读取宿主根: () => this,
      恢复播放位置: (attachmentId, video) =>
        this.恢复时间线自动播播放位置(attachmentId, video),
      标记首帧已就绪: (attachmentId, currentSrc) =>
        this.时间线画面缓存Owner.标记首帧已就绪(attachmentId, currentSrc),
      标记可见接管已就绪: (attachmentId, video) =>
        this.标记时间线唯一播放器可见接管已就绪(attachmentId, video),
      广播播放位置: (attachmentId, video, force = false, allowReleasedOwner = false) =>
        this.广播自动播播放位置(attachmentId, video, force, allowReleasedOwner),
      广播媒体会话信号: (attachmentId, signal) =>
        this.广播媒体会话信号(attachmentId, signal),
    });
    this.时间线画面缓存Owner = new 时间线画面缓存Owner({
      读取视频当前播放源: (video) => this.读取视频当前播放源(video),
      归一化时间线视频播放源: (src) => this.归一化时间线视频播放源(src),
      读取预览状态: (attachmentId) =>
        this.mediaPreviewByAttachmentId[attachmentId] ?? null,
      请求刷新: () => this.requestUpdate(),
    });
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
    this.自动播候选观察Owner.取消自动播候选调度();
    this.自动播候选观察Owner.清理自动播候选观察();
    this.时间线播放器宿主Owner.停止();
    this.失效视频封面地址.clear();
    this.时间线画面缓存Owner.清空();
    this.时间线唯一播放器可见接管就绪源.clear();
    this.时间线隐藏接管附件Id = null;
    this.媒体窗口观察Owner.重置();
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
    this.dispatchEvent(new CustomEvent("room-scroll", { bubbles: true, composed: true }));
    this.自动播候选观察Owner.调度自动播候选(scrollContainer);
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
        this.时间线播放器宿主Owner.冲刷当前播放位置();
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
      this.时间线播放器宿主Owner.同步(this.inlineAutoplayOwnerAttachmentId);
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
    this.媒体窗口观察Owner.dispatch媒体窗口观察({
      items: this.items,
      virtualItems,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
      最近退场Owner附件Id: this.最近退场Owner附件Id,
      自动播候选可见条目: this.自动播候选观察Owner.自动播候选可见条目,
    });
    this.自动播候选观察Owner.同步自动播候选观察(scrollContainer);
    if (this.自动播候选观察Owner.自动播候选观察器) {
      return;
    }
    // 只有旧环境缺少 IntersectionObserver 时，才在低频更新点同步量测兜底。
    this.自动播候选观察Owner.取消自动播候选调度();
    this.自动播候选观察Owner.dispatch自动播候选(scrollContainer);
  }

  private 同步时间线视频首帧就绪缓存(): void {
    const 当前视频附件 = this.时间线画面缓存Owner.同步当前视频附件(this.items);
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
    const 可渲染真实预览视频附件 = 读取允许渲染真实预览视频附件集合({
      items: this.items,
      virtualItems,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
      最近退场Owner附件Id: this.最近退场Owner附件Id,
      自动播候选可见条目: this.自动播候选观察Owner.自动播候选可见条目,
      inlineAutoplayPositionByAttachmentId: this.inlineAutoplayPositionByAttachmentId,
      读取时间线视频已就绪首帧预览源: (attachmentId) =>
        this.时间线画面缓存Owner.读取已就绪首帧预览源(attachmentId),
    });
    const previewVideoSrcByAttachmentId = new Map<string, string>();
    const canonicalVideoSrcByAttachmentId = new Map<string, string>();
    for (const attachment of 读取即将渲染的时间线视频附件({
      items: this.items,
      virtualItems,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
      最近退场Owner附件Id: this.最近退场Owner附件Id,
      自动播候选可见条目: this.自动播候选观察Owner.自动播候选可见条目,
      时间线隐藏接管附件Id: this.时间线隐藏接管附件Id,
      dom视频附件标识: Array.from(
        this.querySelectorAll<HTMLElement>(
          "video.message-video-preview[data-attachment-id]," +
            ".message-video-canonical-host[data-attachment-id]," +
            ".message-video-canonical-stage-host[data-attachment-id]"
        ),
        (video) => video.dataset.attachmentId
      ),
    })) {
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
      const knownReadyTimelineFrameSrc = this.时间线画面缓存Owner.读取已就绪首帧预览源(
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
      const hasKnownReadyPreviewFrame = this.时间线画面缓存Owner.读取首帧是否就绪(
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
      this.时间线播放器宿主Owner.同步(this.inlineAutoplayOwnerAttachmentId);
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
      this.时间线播放器宿主Owner.同步(this.inlineAutoplayOwnerAttachmentId);
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
    if (this.时间线画面缓存Owner.读取首帧是否就绪(attachmentId, currentSrc)) {
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
    this.时间线画面缓存Owner.标记首帧已就绪(attachmentId, canonicalSrc);
    this.时间线画面缓存Owner.捕获自动播冻结帧(attachmentId, canonicalVideo);
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
     * 当前 DOM 自己回抛过首帧事件时，优先认这颗节点留下的 ready-src 证明：
     * 1. 这仍然是同一颗 `<video>` 的本地事实，不会把旧 DOM 或别的 attachment 的缓存冒充成当前表面；
     * 2. 某些测试/浏览器环境会先发 `loadeddata/canplay`，再慢一拍更新 `readyState`，不能让 cover 因此多挂一拍；
     * 3. 一旦 src 改变，`data-preview-src` 会同步变化，旧 ready-src 立刻失效，不会污染新源。
     */
    if (
      previewVideo.dataset.previewReadySrc &&
      previewVideo.dataset.previewReadySrc === normalizedExpectedSrc &&
      previewVideo.dataset.previewSrc === normalizedExpectedSrc
    ) {
      return true;
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
      this.时间线画面缓存Owner.捕获自动播冻结帧(attachmentId, video);
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
    this.时间线播放器宿主Owner.同步(this.inlineAutoplayOwnerAttachmentId);
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
        this.时间线画面缓存Owner.捕获自动播冻结帧(attachmentId, video);
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
    return 估算消息行高度(this.items, index);
  }

  private 估算媒体附件布局高度(item: 消息展示项): number {
    return 估算媒体附件布局高度(item);
  }

  private 提取消息虚拟范围(range: 消息虚拟范围): number[] {
    return 提取消息虚拟范围(this.items, range);
  }

  private 补齐首帧消息虚拟项(virtualItems: 消息虚拟项[]): 消息虚拟项[] {
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
    return 补齐首帧消息虚拟项({
      virtualItems,
      items: this.items,
      viewportHeight: this.messageScrollRef.value?.clientHeight || this.clientHeight,
    });
  }

  private 读取当前虚拟消息项(): 消息虚拟项[] {
    return this.补齐首帧消息虚拟项(this.读取消息虚拟器().getVirtualItems());
  }

  private 读取附件播放源(attachment: 消息展示项["attachments"][number]): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    return 读取附件播放源投影(attachment, playback);
  }

  private 读取图片查看器播放源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "image" }>
  ): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    return 读取图片查看器播放源投影(attachment, playback);
  }

  private 读取时间线视频封面地址(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    playback: 媒体播放结果 | null
  ): string {
    return 读取时间线视频封面地址投影({
      attachment,
      playback,
      failedPosterSrc: this.失效视频封面地址.get(attachment.attachmentId) ?? null,
      clearFailedPoster: () => this.失效视频封面地址.delete(attachment.attachmentId),
    });
  }

  private 读取时间线视频首帧预览源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "video" }>,
    playback: 媒体播放结果 | null,
    input: {
      有静态封面: boolean;
      有运行时预览: boolean;
    }
  ): string | null {
    return 读取时间线视频首帧预览源投影({
      attachment,
      playback,
      previewState: this.mediaPreviewByAttachmentId[attachment.attachmentId] ?? null,
      ...input,
    });
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
    return 读取时间线视频预算投影计算({
      attachment,
      previewVideoSrcCandidate,
      fromSnapshot: this.mediaVideoBudgetByAttachmentId[attachment.attachmentId] ?? null,
      playback: this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null,
      inlineAutoplayPlayback:
        this.inlineAutoplayPlaybackByAttachmentId[attachment.attachmentId] ?? null,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
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
    return 读取时间线预览视频是否允许渲染投影(budget, input);
  }

  private 读取保存续帧是否允许承接时间线预览底板(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
    playbackTimelineVideoSrc: string | null;
    savedTimelineFrameSrc: string | null;
  }): boolean {
    return 读取保存续帧是否允许承接时间线预览底板投影({
      ...input,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
      recentlyReleasedOwnerAttachmentId: this.最近退场Owner附件Id,
      normalizeSrc: (src) => this.归一化时间线视频播放源(src),
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
    return 渲染消息附件(
      {
        mediaPlaybackByAttachmentId: this.mediaPlaybackByAttachmentId,
        inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
        inlineAutoplayPositionByAttachmentId: this.inlineAutoplayPositionByAttachmentId,
        最近退场Owner附件Id: this.最近退场Owner附件Id,
        时间线隐藏接管附件Id: this.时间线隐藏接管附件Id,
        时间线唯一播放器可见接管就绪源: this.时间线唯一播放器可见接管就绪源,
        读取时间线视频运行时预览: (attachmentId) =>
          this.读取时间线视频运行时预览(attachmentId),
        读取时间线视频封面地址: (attachment, playback) =>
          this.读取时间线视频封面地址(attachment, playback),
        读取时间线视频首帧预览源: (attachment, playback, input) =>
          this.读取时间线视频首帧预览源(attachment, playback, input),
        读取保存续帧是否允许承接时间线预览底板: (input) =>
          this.读取保存续帧是否允许承接时间线预览底板(input),
        读取时间线视频已就绪首帧预览源: (attachmentId) =>
          this.时间线画面缓存Owner.读取已就绪首帧预览源(attachmentId),
        读取时间线视频预算投影: (attachment, previewVideoSrcCandidate) =>
          this.读取时间线视频预算投影(attachment, previewVideoSrcCandidate),
        读取时间线唯一播放器是否可见接管就绪: (attachmentId, src) =>
          this.读取时间线唯一播放器是否可见接管就绪(attachmentId, src),
        读取自动播恢复位置: (attachmentId, src) =>
          this.读取自动播恢复位置(attachmentId, src),
        读取时间线现有预览视频是否可继续显示: (attachmentId, src) =>
          this.读取时间线现有预览视频是否可继续显示(attachmentId, src),
        读取时间线自动播冻结帧: (attachmentId, src, position) =>
          this.时间线画面缓存Owner.读取自动播冻结帧(attachmentId, src, position),
        读取时间线视频首帧是否就绪: (attachmentId, src) =>
          this.时间线画面缓存Owner.读取首帧是否就绪(attachmentId, src),
        归一化时间线视频播放源: (src) => this.归一化时间线视频播放源(src),
        读取时间线预览视频是否允许渲染: (budget, input) =>
          this.读取时间线预览视频是否允许渲染(budget, input),
        恢复时间线自动播播放位置: (attachmentId, video, input) =>
          this.恢复时间线自动播播放位置(attachmentId, video, input),
        标记时间线视频首帧已就绪: (attachmentId, src) =>
          this.时间线画面缓存Owner.标记首帧已就绪(attachmentId, src),
        标记视频封面加载失败: (attachmentId, event) =>
          this.标记视频封面加载失败(attachmentId, event),
        广播媒体会话信号: (attachmentId, signal) =>
          this.广播媒体会话信号(attachmentId, signal),
        阻止时间线媒体预览原生菜单: (event) =>
          this.阻止时间线媒体预览原生菜单(event),
        打开媒体查看器: (event, startAttachmentId) =>
          this.打开媒体查看器(event, startAttachmentId),
      },
      item,
      可渲染真实预览视频附件
    );
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
    const 可渲染真实预览视频附件 = 读取允许渲染真实预览视频附件集合({
      items: this.items,
      virtualItems,
      inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
      最近退场Owner附件Id: this.最近退场Owner附件Id,
      自动播候选可见条目: this.自动播候选观察Owner.自动播候选可见条目,
      inlineAutoplayPositionByAttachmentId: this.inlineAutoplayPositionByAttachmentId,
      读取时间线视频已就绪首帧预览源: (attachmentId) =>
        this.时间线画面缓存Owner.读取已就绪首帧预览源(attachmentId),
    });
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
