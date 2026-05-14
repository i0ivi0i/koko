import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排";

type 自动播候选观察Owner依赖 = {
  /**
   * 由消息窗壳提供“当前虚拟窗口内真实存在的视频按钮”。
   * Owner 只吃这个输入，不直接持有消息数据真相。
   */
  读取视频按钮: () => Iterable<HTMLButtonElement>;
  /**
   * 候选派发回调由壳层注入：
   * - owner 只负责“候选观察和调度”；
   * - 壳层继续负责“首帧预热 + 事件回抛”。
   */
  派发候选: (candidates: 消息视频自动播候选[]) => void;
  /**
   * 连接态判定由壳层注入，避免 owner 硬依赖 Lit 生命周期。
   */
  读取连通状态?: () => boolean;
  /**
   * 候选裁剪上限交给调用方配置，便于热路径预算统一收口。
   */
  候选上限?: number;
};

const 默认候选上限 = 12;

/**
 * 自动播候选观察 owner（房间消息窗 adapter 能力）：
 * 1. 只负责“按钮可见性 -> 候选集合”的观察、缓存与节流；
 * 2. 不决定谁能自动播，不持有业务真相；
 * 3. 不触碰媒体字节 owner，只输出壳层可消费的候选投影。
 */
export class 自动播候选观察Owner {
  private 自动播候选调度句柄: number | null = null;
  private 自动播候选调度兜底定时器: ReturnType<typeof setTimeout> | null = null;
  private 自动播候选滚动容器: HTMLElement | null = null;
  private 自动播候选观察根: HTMLElement | null = null;
  private _自动播候选观察器: IntersectionObserver | null = null;
  private _自动播候选观察目标 = new Map<HTMLButtonElement, string>();
  private _自动播候选可见条目 = new Map<string, 消息视频自动播候选>();

  constructor(private readonly 依赖: 自动播候选观察Owner依赖) {}

  get 自动播候选观察器(): IntersectionObserver | null {
    return this._自动播候选观察器;
  }

  set 自动播候选观察器(value: IntersectionObserver | null) {
    this._自动播候选观察器 = value;
  }

  get 自动播候选观察目标(): Map<HTMLButtonElement, string> {
    return this._自动播候选观察目标;
  }

  set 自动播候选观察目标(value: Map<HTMLButtonElement, string>) {
    this._自动播候选观察目标 = value;
  }

  get 自动播候选可见条目(): Map<string, 消息视频自动播候选> {
    return this._自动播候选可见条目;
  }

  set 自动播候选可见条目(value: Map<string, 消息视频自动播候选>) {
    this._自动播候选可见条目 = value;
  }

  调度自动播候选(scrollContainer: HTMLElement): void {
    this.自动播候选滚动容器 = scrollContainer;
    if (this.自动播候选调度句柄 !== null) {
      return;
    }
    this.自动播候选调度句柄 = window.requestAnimationFrame(() => {
      this.执行候选调度();
    });
    this.自动播候选调度兜底定时器 = setTimeout(() => {
      this.执行候选调度();
    }, 32);
  }

  取消自动播候选调度(): void {
    if (this.自动播候选调度句柄 !== null) {
      window.cancelAnimationFrame(this.自动播候选调度句柄);
      this.自动播候选调度句柄 = null;
    }
    if (this.自动播候选调度兜底定时器 !== null) {
      clearTimeout(this.自动播候选调度兜底定时器);
      this.自动播候选调度兜底定时器 = null;
    }
    this.自动播候选滚动容器 = null;
  }

  强制执行候选调度(): void {
    this.执行候选调度();
  }

  dispatch自动播候选(scrollContainer: HTMLElement): void {
    this.依赖.派发候选(this.读取自动播候选(scrollContainer));
  }

  清理自动播候选观察(): void {
    this._自动播候选观察器?.disconnect();
    this._自动播候选观察器 = null;
    this.自动播候选观察根 = null;
    this._自动播候选观察目标.clear();
    this._自动播候选可见条目.clear();
  }

  同步自动播候选观察(scrollContainer: HTMLElement): void {
    if (typeof IntersectionObserver !== "function") {
      this.清理自动播候选观察();
      return;
    }
    if (this.自动播候选观察根 !== scrollContainer) {
      this.清理自动播候选观察();
      this.自动播候选观察根 = scrollContainer;
      this._自动播候选观察器 = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLButtonElement)) {
              continue;
            }
            const button = entry.target;
            const currentAttachmentId = button.dataset.attachmentId ?? "";
            const knownAttachmentId =
              this._自动播候选观察目标.get(button) ?? currentAttachmentId;
            if (knownAttachmentId !== currentAttachmentId && knownAttachmentId !== "") {
              this._自动播候选可见条目.delete(knownAttachmentId);
            }
            if (currentAttachmentId !== "") {
              this._自动播候选观察目标.set(button, currentAttachmentId);
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
                this._自动播候选可见条目.delete(currentAttachmentId);
              }
              continue;
            }
            this._自动播候选可见条目.set(currentAttachmentId, candidate);
          }
          this.取消自动播候选调度();
          this.dispatch自动播候选(scrollContainer);
        },
        {
          root: scrollContainer,
          threshold: [0, 0.25, 0.5, 0.75, 1],
        }
      );
    }
    const observer = this._自动播候选观察器;
    if (!observer) {
      return;
    }
    const currentButtons = new Set(this.依赖.读取视频按钮());
    for (const [button, attachmentId] of this._自动播候选观察目标) {
      if (currentButtons.has(button)) {
        continue;
      }
      observer.unobserve(button);
      this._自动播候选观察目标.delete(button);
      if (attachmentId !== "") {
        this._自动播候选可见条目.delete(attachmentId);
      }
    }
    for (const button of currentButtons) {
      const attachmentId = button.dataset.attachmentId ?? "";
      const previousAttachmentId = this._自动播候选观察目标.get(button);
      if (previousAttachmentId === undefined) {
        this._自动播候选观察目标.set(button, attachmentId);
        observer.observe(button);
      } else if (previousAttachmentId !== attachmentId) {
        if (previousAttachmentId !== "") {
          this._自动播候选可见条目.delete(previousAttachmentId);
        }
        this._自动播候选观察目标.set(button, attachmentId);
      }
    }
  }

  根据矩形计算自动播候选(
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

  读取自动播候选(scrollContainer: HTMLElement): 消息视频自动播候选[] {
    const 候选上限 = this.依赖.候选上限 ?? 默认候选上限;
    const 裁剪预算 = (candidates: Iterable<消息视频自动播候选>): 消息视频自动播候选[] =>
      Array.from(candidates)
        .sort(
          (left, right) =>
            left.distanceToViewportCenter - right.distanceToViewportCenter ||
            right.visibilityRatio - left.visibilityRatio ||
            left.attachmentId.localeCompare(right.attachmentId)
        )
        .slice(0, 候选上限);
    if (this._自动播候选观察器) {
      return 裁剪预算(this._自动播候选可见条目.values());
    }
    const viewportRect = scrollContainer.getBoundingClientRect();
    return 裁剪预算(
      Array.from(this.依赖.读取视频按钮())
        .map((entry) => this.量测按钮自动播候选(entry, viewportRect))
        .filter((candidate): candidate is 消息视频自动播候选 => candidate !== null)
    );
  }

  private 执行候选调度(): void {
    if (this.自动播候选调度句柄 !== null) {
      window.cancelAnimationFrame(this.自动播候选调度句柄);
      this.自动播候选调度句柄 = null;
    }
    if (this.自动播候选调度兜底定时器 !== null) {
      clearTimeout(this.自动播候选调度兜底定时器);
      this.自动播候选调度兜底定时器 = null;
    }
    const nextScrollContainer = this.自动播候选滚动容器;
    this.自动播候选滚动容器 = null;
    if (!nextScrollContainer) {
      return;
    }
    const connected = this.依赖.读取连通状态?.() ?? true;
    if (!connected) {
      return;
    }
    this.依赖.派发候选(this.读取自动播候选(nextScrollContainer));
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
}
