import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { 聊天状态, 房间视口模式 } from "./状态.js";

const 稳定可读最小可见像素 = 40;
const 稳定可读最小可见比例 = 0.55;
const 贴底跟随阈值像素 = 24;

type 房间滚动观察态 = Pick<
  聊天状态,
  | "roomId"
  | "firstUnreadEventPosition"
  | "initialUnreadSettled"
  | "scrollPhase"
  | "historyLoading"
  | "hasMoreBefore"
  | "hasUserScrollIntent"
  | "historyLoadThrottleUntil"
>;

export interface 房间滚动器宿主 extends ReactiveControllerHost {
  readonly updateComplete: Promise<boolean>;
}

export interface 历史补偿上下文 {
  旧滚动高度: number;
  锚点消息位置: number | null;
  锚点距容器顶部: number | null;
}

export interface 房间滚动观测 {
  candidateReadAnchorPosition: number | null;
  isNearBottom: boolean;
  reachedTop: boolean;
}

interface 消息可见片段 {
  eventPosition: number;
  行顶部相对容器: number;
  可见高度: number;
  行高: number;
}

type 程序滚动来源 = "media_viewer_open" | "jump_to_latest";

export interface 房间滚动器依赖 {
  读取状态(): 房间滚动观察态;
  查询滚动容器(): HTMLElement | null;
  查询消息节点(): HTMLElement[];
  上报滚动观测?(observation: 房间滚动观测): void;
  读取是否需要恢复补锚(): boolean;
  消耗恢复补锚标记(): void;
  报告首屏稳定完成?(mode: 房间视口模式): void;
  报告历史补偿程序滚动已稳定?(): void;
  报告恢复补锚候选?(position: number): void;
}

/**
 * 房间滚动器只处理 DOM 滚动副作用。
 *
 * 它不做业务裁决，不直接打网络：
 * - 什么时候该补历史，由它观测滚动并发出请求；
 * - 什么时候采样到更靠后的已读锚点，由它观测视口并回调给壳层；
 * - 什么时候隔离程序滚动，不让浏览器事件误判成用户行为，也由它负责。
 */
export class 房间滚动器 implements ReactiveController {
  private scrollPhaseReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private 阅读锚点采样句柄: number | null = null;
  private 待采样阅读锚点容器: HTMLElement | null = null;
  private readonly 活跃程序滚动来源 = new Set<程序滚动来源>();
  private readonly 待吸收程序滚动尾波来源 = new Set<程序滚动来源>();

  constructor(
    private readonly host: 房间滚动器宿主,
    private readonly deps: 房间滚动器依赖
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.取消挂起滚动副作用();
    this.活跃程序滚动来源.clear();
    this.待吸收程序滚动尾波来源.clear();
  }

  安排首屏定位(): void {
    queueMicrotask(() => {
      void this.落实首屏定位();
    });
  }

  标记用户滚动意图(): void {
    // 媒体查看器这类覆盖层关闭后，浏览器可能补发恢复滚动事件；只有新的用户滚动意图才能结束这段尾波。
    this.待吸收程序滚动尾波来源.clear();
  }

  处理滚动事件(scrollContainer: HTMLElement | null = this.deps.查询滚动容器()): boolean {
    if (!this.本次滚动属于聊天视口()) {
      return false;
    }
    if (!scrollContainer) {
      return false;
    }
    const reachedTop = scrollContainer.scrollTop <= 0;
    this.deps.上报滚动观测?.({
      candidateReadAnchorPosition: null,
      isNearBottom: reachedTop ? false : this.读取当前是否接近底部(),
      reachedTop,
    });
    this.调度阅读锚点采样(scrollContainer);
    return true;
  }

  /**
   * 点开媒体查看器后，接下来一段时间聊天视口会被外部查看器占用。
   * 这期间即便浏览器抛出了 scroll，也不能再把它解释成聊天窗口里的用户阅读。
   */
  登记程序滚动来源(source: 程序滚动来源): void {
    this.待吸收程序滚动尾波来源.delete(source);
    this.活跃程序滚动来源.add(source);
  }

  清除程序滚动来源(source: 程序滚动来源): void {
    if (this.活跃程序滚动来源.delete(source)) {
      this.待吸收程序滚动尾波来源.add(source);
    }
  }

  /**
   * 某些壳层体验允许“非手动滚动也推进已读”，例如：
   * - 用户本来就贴底，新消息继续进入当前视口；
   * - 刷新恢复后，权威首屏已经稳定落在较新的消息窗口。
   *
   * 这时仍然要复用滚动器自己的“稳定可读”判定，而不是在壳层重新猜一次。
   */
  读取当前可见阅读锚点(): number | null {
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return null;
    }
    return this.查找可见阅读锚点(scrollContainer);
  }

  /**
   * “是否接近底部”依然是滚动器的 DOM 观测结果，不是业务真相。
   * 应用层只消费这个只读判断，不再自己重复读 scrollTop / scrollHeight。
   */
  读取当前是否接近底部(): boolean {
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return false;
    }
    return (
      scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop <=
      贴底跟随阈值像素
    );
  }

  async 滚到最新位置(): Promise<void> {
    await this.host.updateComplete;
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return;
    }
    // “跳到最新”是用户命令，但真正写 scrollTop 的仍是程序性滚动；
    // 这里登记尾波，避免浏览器随后补发的 scroll 被误解成一次新的手动阅读。
    this.登记程序滚动来源("jump_to_latest");
    try {
      scrollContainer.scrollTop = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight
      );
    } finally {
      this.清除程序滚动来源("jump_to_latest");
    }
  }

  /**
   * 历史补偿不能再只记一个旧 scrollHeight：
   * - 前插历史期间如果同时有 realtime 新消息追加，单看总高度会把“顶部前插”和“底部追加”混成一锅；
   * - 真正需要守住的是“用户刚才正在看的那条消息相对视口顶部的位置”。
   *
   * 所以这里改成读取一份补偿上下文：
   * 1. 先尽量挑一个当前视口里最靠近顶部、且足够稳定可读的消息当锚点；
   * 2. 实在没有稳定可读锚点，再退回到最靠近顶部的重叠消息；
   * 3. 最后仍保留旧 scrollHeight，作为彻底找不回锚点时的兜底。
   */
  读取历史补偿上下文(): 历史补偿上下文 {
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return {
        旧滚动高度: 0,
        锚点消息位置: null,
        锚点距容器顶部: null,
      };
    }
    const 锚点 = this.查找历史补偿锚点(scrollContainer);
    return {
      旧滚动高度: scrollContainer.scrollHeight,
      锚点消息位置: 锚点?.eventPosition ?? null,
      锚点距容器顶部: 锚点?.行顶部相对容器 ?? null,
    };
  }

  async 应用历史补偿(补偿上下文: 历史补偿上下文, 插入了消息: boolean): Promise<void> {
    if (!插入了消息) {
      return;
    }
    await this.host.updateComplete;
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return;
    }
    if (!this.按历史锚点恢复视口(scrollContainer, 补偿上下文)) {
      const 新滚动高度 = scrollContainer.scrollHeight;
      scrollContainer.scrollTop += 新滚动高度 - 补偿上下文.旧滚动高度;
    }
    this.安排程序滚动释放("compensating_history", () => {
      this.deps.报告历史补偿程序滚动已稳定?.();
    });
  }

  取消挂起滚动副作用(): void {
    if (this.scrollPhaseReleaseTimer !== null) {
      clearTimeout(this.scrollPhaseReleaseTimer);
      this.scrollPhaseReleaseTimer = null;
    }
    if (this.阅读锚点采样句柄 !== null) {
      cancelAnimationFrame(this.阅读锚点采样句柄);
      this.阅读锚点采样句柄 = null;
    }
    this.待采样阅读锚点容器 = null;
  }

  private 本次滚动属于聊天视口(): boolean {
    const 状态 = this.deps.读取状态();
    if (状态.scrollPhase !== "idle") {
      return false;
    }
    if (this.活跃程序滚动来源.size > 0) {
      return false;
    }
    if (this.待吸收程序滚动尾波来源.size > 0) {
      return false;
    }
    return 状态.hasUserScrollIntent;
  }

  private async 落实首屏定位(): Promise<void> {
    const 状态 = this.deps.读取状态();
    if (状态.initialUnreadSettled) {
      return;
    }
    await this.host.updateComplete;
    const scrollContainer = this.deps.查询滚动容器();
    if (!scrollContainer) {
      return;
    }
    if (this.deps.读取状态().initialUnreadSettled) {
      return;
    }
    const firstUnreadEventPosition = this.deps.读取状态().firstUnreadEventPosition;
    if (firstUnreadEventPosition === null) {
      scrollContainer.scrollTop = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight
      );
      this.补一次恢复阅读锚点();
      this.deps.报告首屏稳定完成?.("贴底跟随");
      return;
    }

    const target = this.deps
      .查询消息节点()
      .find(
        (node) => Number(node.dataset.eventPosition ?? Number.NaN) === firstUnreadEventPosition
      );
    if (!target) {
      // 首条未读节点这轮还没准备好时，不能直接宣布首屏已经恢复完成。
      // 否则壳层会把一次“没找到目标”的偶发时序问题误记成“已稳定停靠”，
      // 后续刷新就容易退化成停在错误位置。
      return;
    }

    target.scrollIntoView?.({ block: "center" });
    this.补一次恢复阅读锚点();
    this.安排程序滚动释放("restoring_unread", () => {
      this.deps.报告首屏稳定完成?.("围绕未读阅读");
    });
  }

  private 补一次恢复阅读锚点(): void {
    if (!this.deps.读取是否需要恢复补锚()) {
      return;
    }
    this.deps.消耗恢复补锚标记();
    queueMicrotask(() => {
      const scrollContainer = this.deps.查询滚动容器();
      if (!scrollContainer) {
        return;
      }
      const nextReadPosition = this.查找可见阅读锚点(scrollContainer);
      if (nextReadPosition === null) {
        return;
      }
      this.deps.报告恢复补锚候选?.(nextReadPosition);
    });
  }

  private 调度阅读锚点采样(scrollContainer: HTMLElement): void {
    this.待采样阅读锚点容器 = scrollContainer;
    if (this.阅读锚点采样句柄 !== null) {
      return;
    }
    /**
     * 阅读锚点采样需要量消息节点和容器几何。
     * 这里改成“同一帧只量一次”，避免浏览器在连续 scroll 事件里
     * 被重复 `getBoundingClientRect()` 拖进 forced reflow。
     *
     * 历史分页仍保持同步判断，因为它只看 scrollTop；
     * 只有真正需要量布局的阅读锚点采样才延后到帧尾统一做。
     */
    this.阅读锚点采样句柄 = requestAnimationFrame(() => {
      this.阅读锚点采样句柄 = null;
      const nextScrollContainer = this.待采样阅读锚点容器;
      this.待采样阅读锚点容器 = null;
      if (!nextScrollContainer) {
        return;
      }
      this.按需采样阅读锚点(nextScrollContainer);
    });
  }

  private 按需采样阅读锚点(scrollContainer: HTMLElement): void {
    const 状态 = this.deps.读取状态();
    if (
      !状态.roomId ||
      !状态.initialUnreadSettled ||
      状态.historyLoading ||
      状态.scrollPhase !== "idle" ||
      !状态.hasUserScrollIntent
    ) {
      return;
    }
    const nextReadPosition = this.查找可见阅读锚点(scrollContainer);
    this.deps.上报滚动观测?.({
      candidateReadAnchorPosition: nextReadPosition,
      isNearBottom: this.读取当前是否接近底部(),
      reachedTop: scrollContainer.scrollTop <= 0,
    });
  }

  private 查找历史补偿锚点(scrollContainer: HTMLElement): 消息可见片段 | null {
    const containerRect = scrollContainer.getBoundingClientRect();
    let 最靠近顶部的稳定锚点: 消息可见片段 | null = null;
    let 最靠近顶部的重叠锚点: 消息可见片段 | null = null;

    for (const row of this.deps.查询消息节点()) {
      const 片段 = this.读取消息可见片段(row, containerRect);
      if (!片段 || 片段.可见高度 <= 0) {
        continue;
      }
      if (
        this.消息片段稳定可读(片段) &&
        (最靠近顶部的稳定锚点 === null ||
          片段.行顶部相对容器 < 最靠近顶部的稳定锚点.行顶部相对容器)
      ) {
        最靠近顶部的稳定锚点 = 片段;
      }
      if (
        最靠近顶部的重叠锚点 === null ||
        片段.行顶部相对容器 < 最靠近顶部的重叠锚点.行顶部相对容器
      ) {
        最靠近顶部的重叠锚点 = 片段;
      }
    }

    return 最靠近顶部的稳定锚点 ?? 最靠近顶部的重叠锚点;
  }

  private 查找可见阅读锚点(scrollContainer: HTMLElement): number | null {
    const containerRect = scrollContainer.getBoundingClientRect();
    let nextReadPosition: number | null = null;

    for (const row of this.deps.查询消息节点()) {
      const 片段 = this.读取消息可见片段(row, containerRect);
      if (!片段) {
        continue;
      }
      // 阅读候选不能继续死卡“整条消息必须完全可见”：
      // 真实 IM 里，长消息只要大部分主体已经稳定进入视口，就应允许它成为候选已读锚点。
      if (!this.消息片段稳定可读(片段)) {
        continue;
      }
      nextReadPosition =
        nextReadPosition === null
          ? 片段.eventPosition
          : Math.max(nextReadPosition, 片段.eventPosition);
    }

    return nextReadPosition;
  }

  private 读取消息可见片段(
    row: HTMLElement,
    containerRect: ReturnType<HTMLElement["getBoundingClientRect"]>
  ): 消息可见片段 | null {
    const rawEventPosition = row.dataset.eventPosition;
    if (!rawEventPosition) {
      return null;
    }
    const eventPosition = Number(rawEventPosition);
    if (!Number.isFinite(eventPosition)) {
      return null;
    }
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom <= rowRect.top) {
      return null;
    }
    const 可见顶部 = Math.max(rowRect.top, containerRect.top);
    const 可见底部 = Math.min(rowRect.bottom, containerRect.bottom);
    return {
      eventPosition,
      行顶部相对容器: rowRect.top - containerRect.top,
      可见高度: Math.max(0, 可见底部 - 可见顶部),
      行高: Math.max(1, rowRect.bottom - rowRect.top),
    };
  }

  private 消息片段稳定可读(片段: 消息可见片段): boolean {
    return (
      片段.可见高度 >= Math.min(片段.行高, 稳定可读最小可见像素) ||
      片段.可见高度 / 片段.行高 >= 稳定可读最小可见比例
    );
  }

  /**
   * 历史补偿优先尝试“把旧锚点拉回到原来的相对顶部位置”。
   * 这样即使顶部前插和底部 realtime 追加同时发生，也只会围绕用户真正正在看的那条消息恢复视口。
   */
  private 按历史锚点恢复视口(
    scrollContainer: HTMLElement,
    补偿上下文: 历史补偿上下文
  ): boolean {
    if (
      补偿上下文.锚点消息位置 === null ||
      补偿上下文.锚点距容器顶部 === null
    ) {
      return false;
    }
    const target = this.deps
      .查询消息节点()
      .find(
        (node) =>
          Number(node.dataset.eventPosition ?? Number.NaN) === 补偿上下文.锚点消息位置
      );
    if (!target) {
      return false;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom <= targetRect.top) {
      return false;
    }
    const 当前位置差值 =
      targetRect.top - containerRect.top - 补偿上下文.锚点距容器顶部;
    if (!Number.isFinite(当前位置差值)) {
      return false;
    }
    scrollContainer.scrollTop += 当前位置差值;
    return true;
  }

  /**
   * 程序滚动只在一个极短窗口里隔离，避免浏览器随后抛出的 scroll
   * 被错误解释成“用户正在阅读/翻页”。
   */
  private 安排程序滚动释放(
    expectedPhase: 房间滚动观察态["scrollPhase"],
    onReleased?: () => void
  ): void {
    this.取消挂起滚动副作用();
    this.scrollPhaseReleaseTimer = setTimeout(() => {
      this.scrollPhaseReleaseTimer = null;
      if (this.deps.读取状态().scrollPhase !== expectedPhase) {
        return;
      }
      onReleased?.();
    }, 0);
  }
}
