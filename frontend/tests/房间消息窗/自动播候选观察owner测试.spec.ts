// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 自动播候选观察Owner } from "../../房间消息窗/自动播候选观察器";
import type { 消息视频自动播候选 } from "../../媒体/消息视频自动播编排";

describe("自动播候选观察Owner", () => {
  it("支持 IntersectionObserver 时，候选由观察回调驱动，不做整列同步量测", () => {
    const 容器 = document.createElement("div");
    const 按钮 = document.createElement("button");
    按钮.className = "message-video-preview-trigger";
    按钮.dataset.attachmentId = "att-1";
    容器.appendChild(按钮);

    const 候选批次: 消息视频自动播候选[][] = [];
    const 按钮矩形量测 = vi.spyOn(按钮, "getBoundingClientRect");

    type 观察回调 = (
      entries: IntersectionObserverEntry[],
      observer: IntersectionObserver
    ) => void;
    let 回调: 观察回调 | null = null;
    let 实例: IntersectionObserver | null = null;

    class 假观察器 {
      readonly root: Element | Document | null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.25, 0.5, 0.75, 1];

      constructor(callback: 观察回调, options?: IntersectionObserverInit) {
        回调 = callback;
        this.root = (options?.root as Element | Document | null) ?? null;
        实例 = this as unknown as IntersectionObserver;
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", 假观察器 as unknown as typeof IntersectionObserver);

    const owner = new 自动播候选观察Owner({
      读取视频按钮: () => [按钮],
      派发候选: (candidates) => 候选批次.push(candidates),
    });

    owner.同步自动播候选观察(容器);
    expect(按钮矩形量测).not.toHaveBeenCalled();
    expect(回调).not.toBeNull();
    expect(实例).not.toBeNull();
    if (!回调 || !实例) {
      throw new Error("观察回调未初始化");
    }

    (回调 as 观察回调)(
      [
        {
          target: 按钮,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: new DOMRect(0, 250, 320, 180),
          rootBounds: new DOMRect(0, 0, 320, 680),
          intersectionRect: new DOMRect(0, 250, 320, 180),
          time: performance.now(),
        } as IntersectionObserverEntry,
      ],
      实例
    );
    owner.强制执行候选调度();

    expect(候选批次).toEqual([
      [{ attachmentId: "att-1", visibilityRatio: 1, distanceToViewportCenter: 0 }],
    ]);
    expect(按钮矩形量测).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
