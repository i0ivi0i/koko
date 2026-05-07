import { html, type PropertyValues } from "lit";
import { VirtualizerController } from "@tanstack/lit-virtual";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import {
  type 媒体播放结果,
  type 媒体播放位置,
} from "../媒体/媒体播放.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import { 渲染消息附件 } from "./附件渲染.js";
import {
  估算消息行高度,
  提取消息虚拟范围,
  补齐首帧消息虚拟项,
  消息虚拟列表overscan消息数,
  type 消息虚拟项,
  type 消息虚拟范围,
} from "./消息虚拟列表.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";
import { 房间消息窗时间线媒体基类 } from "./时间线媒体基类.js";
import { 读取允许渲染真实预览视频附件集合 } from "./媒体窗口.js";
import {
  同步时间线退场Owner底板预览,
  广播房间媒体会话信号,
  请求打开房间媒体查看器,
} from "./时间线媒体协作.js";

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
export class 房间消息窗 extends 房间消息窗时间线媒体基类 {
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
        同步时间线退场Owner底板预览({
          root: this,
          attachmentId: previousOwnerAttachmentId,
          自动播位置上报记录: this.自动播位置上报记录,
          读取视频当前播放源: (video) => this.读取视频当前播放源(video),
          归一化时间线视频播放源: (src) => this.归一化时间线视频播放源(src),
          标记时间线视频首帧已就绪: (attachmentId, src) =>
            this.时间线画面缓存Owner.标记首帧已就绪(attachmentId, src),
          捕获时间线自动播冻结帧: (attachmentId, video, options) =>
            this.时间线画面缓存Owner.捕获自动播冻结帧(
              attachmentId,
              video,
              options
            ),
          广播自动播播放位置: (
            attachmentId,
            video,
            force = false,
            allowReleasedOwner = false
          ) =>
            this.广播自动播播放位置(
              attachmentId,
              video,
              force,
              allowReleasedOwner
            ),
        });
        this.时间线唯一播放器可见接管就绪源.delete(previousOwnerAttachmentId);
        this.时间线唯一播放器可见宿主已出帧源.delete(previousOwnerAttachmentId);
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
        this.时间线唯一播放器可见宿主已出帧源.delete(currentOwnerAttachmentId);
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

  protected 读取当前虚拟消息项(): 消息虚拟项[] {
    return this.补齐首帧消息虚拟项(this.读取消息虚拟器().getVirtualItems());
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
        读取时间线唯一播放器可见宿主是否已出帧: (attachmentId, src) =>
          this.读取时间线唯一播放器可见宿主是否已出帧(attachmentId, src),
        读取自动播恢复位置: (attachmentId, src) =>
          this.读取自动播恢复位置(attachmentId, src),
        读取时间线现有预览视频是否可继续显示: (attachmentId, src) =>
          this.读取时间线现有预览视频是否可继续显示(attachmentId, src),
        读取时间线现有预览帧证据: (attachmentId, src) =>
          this.读取时间线现有预览帧证据(attachmentId, src),
        读取时间线自动播冻结帧: (attachmentId, src, position) =>
          this.时间线画面缓存Owner.读取自动播冻结帧(attachmentId, src, position),
        捕获时间线自动播冻结帧: (attachmentId, video, options) =>
          this.时间线画面缓存Owner.捕获自动播冻结帧(attachmentId, video, options),
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
          广播房间媒体会话信号({
            dispatcher: this,
            attachmentId,
            signal,
          }),
        阻止时间线媒体预览原生菜单: (event) =>
          this.阻止时间线媒体预览原生菜单(event),
        打开媒体查看器: (event, startAttachmentId) =>
          请求打开房间媒体查看器({
            dispatcher: this,
            triggerEvent: event,
            startAttachmentId,
            items: this.读取媒体查看器项目(),
          }),
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
