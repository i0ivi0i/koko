import { LitElement, type PropertyValues } from "lit";
import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排.js";
import type { 媒体查看器项目 } from "../媒体/媒体查看器.js";
import {
  读取保存续帧是否允许承接时间线预览底板 as 读取保存续帧是否允许承接时间线预览底板投影,
  读取附件播放源 as 读取附件播放源投影,
  读取图片查看器播放源 as 读取图片查看器播放源投影,
  读取时间线视频封面地址 as 读取时间线视频封面地址投影,
  读取时间线视频首帧预览源 as 读取时间线视频首帧预览源投影,
  读取时间线视频预算投影 as 读取时间线视频预算投影计算,
  读取时间线预览视频是否允许渲染 as 读取时间线预览视频是否允许渲染投影,
} from "./附件渲染.js";
import type { 消息虚拟项 } from "./消息虚拟列表.js";
import { 首帧预热候选上限, 自动播观察候选上限, 自动播时间戳常规上报最小变化秒, 自动播时间戳常规上报最小间隔毫秒 } from "./时间线媒体常量.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";
import { 自动播候选观察Owner } from "./自动播候选观察器.js";
import { 时间线播放器宿主Owner } from "./时间线播放器宿主.js";
import { 时间线画面缓存Owner } from "./时间线画面缓存.js";
import { 媒体窗口观察Owner } from "./媒体窗口.js";
import {
  广播房间媒体会话信号,
  读取时间线视频表面期望,
} from "./时间线媒体协作.js";

export abstract class 房间消息窗时间线媒体基类 extends LitElement {
  declare items: 聊天列表展示项[];
  declare mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare mediaPreviewByAttachmentId: Record<string, 视频预览状态>;
  declare mediaVideoBudgetByAttachmentId: Record<string, 信息流视频预算投影>;
  declare inlineAutoplayOwnerAttachmentId: string | null;
  declare inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  declare inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;

  protected readonly 自动播候选观察Owner: 自动播候选观察Owner;
  protected readonly 媒体窗口观察Owner: 媒体窗口观察Owner;
  protected readonly 时间线播放器宿主Owner: 时间线播放器宿主Owner;
  protected readonly 时间线画面缓存Owner: 时间线画面缓存Owner;
  protected readonly 失效视频封面地址 = new Map<string, string>();
  protected readonly 自动播位置上报记录 = new Map<
    string,
    { src: string; currentTime: number; reportedAt: number }
  >();
  protected readonly 时间线唯一播放器可见接管就绪源 = new Map<string, string>();
  protected 时间线隐藏接管附件Id: string | null = null;
  protected 最近退场Owner附件Id: string | null = null;

  protected abstract 读取当前虚拟消息项(): 消息虚拟项[];

  constructor() {
    super();
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
          detail: { attachmentIds },
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
        广播房间媒体会话信号({
          dispatcher: this,
          attachmentId,
          signal,
        }),
    });
    this.时间线画面缓存Owner = new 时间线画面缓存Owner({
      读取视频当前播放源: (video) => this.读取视频当前播放源(video),
      归一化时间线视频播放源: (src) => this.归一化时间线视频播放源(src),
      读取预览状态: (attachmentId) =>
        this.mediaPreviewByAttachmentId[attachmentId] ?? null,
      请求刷新: () => this.requestUpdate(),
    });
  }
  protected 同步时间线视频首帧就绪缓存(): void {
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

  protected 释放时间线预览视频资源(video: HTMLVideoElement): void {
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

  protected 清理即将退场时间线视频表面(virtualItems = this.读取当前虚拟消息项()): void {
    const { previewVideoSrcByAttachmentId, canonicalVideoSrcByAttachmentId } =
      读取时间线视频表面期望({
        root: this,
        items: this.items,
        virtualItems,
        inlineAutoplayOwnerAttachmentId: this.inlineAutoplayOwnerAttachmentId,
        最近退场Owner附件Id: this.最近退场Owner附件Id,
        时间线隐藏接管附件Id: this.时间线隐藏接管附件Id,
        自动播候选可见条目: this.自动播候选观察Owner.自动播候选可见条目,
        inlineAutoplayPositionByAttachmentId: this.inlineAutoplayPositionByAttachmentId,
        mediaPlaybackByAttachmentId: this.mediaPlaybackByAttachmentId,
        读取时间线视频已就绪首帧预览源: (attachmentId) =>
          this.时间线画面缓存Owner.读取已就绪首帧预览源(attachmentId),
        读取时间线视频首帧是否就绪: (attachmentId, src) =>
          this.时间线画面缓存Owner.读取首帧是否就绪(attachmentId, src),
        读取时间线视频运行时预览: (attachmentId) =>
          this.读取时间线视频运行时预览(attachmentId),
        读取时间线视频首帧预览源: (attachment, playback, input) =>
          this.读取时间线视频首帧预览源(attachment, playback, input),
        读取时间线视频预算投影: (attachment, previewVideoSrcCandidate) =>
          this.读取时间线视频预算投影(attachment, previewVideoSrcCandidate),
        读取保存续帧是否允许承接时间线预览底板: (input) =>
          this.读取保存续帧是否允许承接时间线预览底板(input),
        读取时间线现有预览视频是否可继续显示: (attachmentId, src) =>
          this.读取时间线现有预览视频是否可继续显示(attachmentId, src),
        读取时间线预览视频是否允许渲染: (budget, input) =>
          this.读取时间线预览视频是否允许渲染(budget, input),
      });
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

  protected 读取时间线唯一播放器是否可见接管就绪(
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

  protected 标记时间线唯一播放器可见接管已就绪(
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

  protected 揭开已就绪的时间线隐藏接管宿主(): void {
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
  protected 预热时间线视频首帧(button: HTMLButtonElement, attachmentId: string): void {
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

  protected 预热自动播候选首帧(candidates: 消息视频自动播候选[]): void {
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

  protected 读取视频当前播放源(video: HTMLVideoElement): string | null {
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

  protected 归一化时间线视频播放源(src: string | null): string | null {
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

  protected 读取自动播恢复位置(
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

  protected 校验同源自动播恢复位置(
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

  protected 读取时间线现有预览视频是否可继续显示(
    attachmentId: string,
    src: string | null
  ): boolean {
    return Boolean(this.读取时间线现有预览帧证据(attachmentId, src));
  }

  protected 读取时间线现有预览帧证据(
    attachmentId: string,
    src: string | null
  ): { src: string; currentTime: number } | null {
    const normalizedExpectedSrc = this.归一化时间线视频播放源(src);
    if (!normalizedExpectedSrc) {
      return null;
    }
    const previewVideo = this.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );
    if (!previewVideo || !previewVideo.isConnected) {
      return null;
    }
    const normalizedCurrentSrc = this.归一化时间线视频播放源(
      this.读取视频当前播放源(previewVideo)
    );
    if (normalizedCurrentSrc !== normalizedExpectedSrc) {
      return null;
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
      return Number.isFinite(previewVideo.currentTime)
        ? { src: normalizedExpectedSrc, currentTime: previewVideo.currentTime }
        : null;
    }
    /**
     * 真实浏览器里，非 owner 的 preview `<video>` 可能已经拿到首帧，
     * 但 `loadeddata/canplay` 还没来得及把缓存写回本轮 render。
     * 这里补看 DOM 现状，避免“明明已经有稳定可见帧，却因为缓存慢一拍而直接显露 canonical host”。
     * `currentTime > 0` 只能说明 seek 目标已写入，不能证明当前 DOM 已有可展示像素。
     */
    return previewVideo.readyState >= 2 && Number.isFinite(previewVideo.currentTime)
      ? { src: normalizedExpectedSrc, currentTime: previewVideo.currentTime }
      : null;
  }

  protected 恢复时间线自动播播放位置(
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
    /**
     * 滚动 / resize 期间，当前 owner 仍可能在同一颗 live video 上继续自然前进，
     * 而位置快照由于节流会短暂落后几十到几百毫秒。
     * 这时如果继续拿旧快照回灌，就会把正在播放的画面硬拉回旧时间点，直接造成“边播边抽”。
     *
     * 允许的恢复只有两种：
     * 1. 冷启动 / hidden handoff / DOM 重挂载时，把 0.x 或更早的位置拉到目标续播点；
     * 2. `allowPreviewFrame` 的非 owner 续帧桥，只为静态预览帧对齐，不参与 live 回放。
     */
    if (
      !options.allowPreviewFrame &&
      !video.paused &&
      Number.isFinite(video.currentTime) &&
      video.currentTime > position.currentTime
    ) {
      return;
    }
    try {
      video.currentTime = position.currentTime;
    } catch {
      // 某些浏览器/测试环境会在 metadata 尚未稳定时拒绝 seek。
      // 恢复动作会在 loadedmetadata 与 play 前各尝试一次，这里不把它升级成播放失败。
    }
  }

  protected 广播自动播播放位置(
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

  protected 同步时间线自动播播放状态(changedProperties: PropertyValues<this>): void {
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

  protected 读取附件播放源(attachment: 消息展示项["attachments"][number]): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    return 读取附件播放源投影(attachment, playback);
  }

  protected 读取图片查看器播放源(
    attachment: Extract<消息展示项["attachments"][number], { kind: "image" }>
  ): string {
    const playback = this.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    /**
     * 图片查看器和视频查看器一样，只认 swarm 正式源：
     * 1. `anchor/blob canonical` 可以继续留在 legacy/迁移壳里做显式兼容；
     * 2. 但新附件正式查看器不能再直接吃这类受控 HTTP 地址；
     * 3. 真拿不到 swarm 时继续抛空串，让查看器等待 owner 后续同步。
     */
    return playback?.mode === "swarm" ? 读取图片查看器播放源投影(attachment, playback) : "";
  }

  protected 读取时间线视频封面地址(
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

  protected 读取时间线视频首帧预览源(
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

  protected 读取时间线视频运行时预览(
    attachmentId: string
  ): Extract<视频预览状态, { phase: "ready" }> | null {
    const preview = this.mediaPreviewByAttachmentId[attachmentId] ?? null;
    return preview?.phase === "ready" ? preview : null;
  }

  protected 读取时间线视频预算投影(
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

  protected 读取时间线预览视频是否允许渲染(
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

  protected 读取保存续帧是否允许承接时间线预览底板(input: {
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

  protected 标记视频封面加载失败(attachmentId: string, event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLImageElement)) {
      return;
    }
    const failedPosterSrc = target.currentSrc || target.getAttribute("src");
    if (!failedPosterSrc) {
      return;
    }
    this.失效视频封面地址.set(attachmentId, failedPosterSrc);
    广播房间媒体会话信号({
      dispatcher: this,
      attachmentId,
      signal: {
        type: "PLAYER_ERROR",
      },
    });
    this.requestUpdate();
  }

  protected 读取媒体查看器项目(): 媒体查看器项目[] {
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
            playback.mode === "swarm" &&
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
        /**
         * 查看器视频项目现在只认 swarm 正式源：
         * 1. `anchor` 仍可能作为 legacy/迁移态暂时留在别的壳层结果里；
         * 2. 但查看器是正式播放 owner，不能再把它抬成新附件正式视频入口；
         * 3. 真拿不到 swarm 时，继续抛空串，让查看器维持缺源等待或降级真相。
         */
        const viewerVideoSrc = playback?.mode === "swarm" ? this.读取附件播放源(attachment) : "";
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

  protected 阻止时间线媒体预览原生菜单(event: Event): void {
    /**
     * 时间线卡片只表达“打开查看器”这一种意图。
     * 这里主动拦住原生媒体右键/长按菜单，避免浏览器把预览层误当成正式播放器表面。
     */
    event.preventDefault();
  }

}
