// @vitest-environment happy-dom

import { describe,expect,it,vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体查看器打开请求,媒体查看器项目 } from "../../媒体/媒体查看器";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import {
创建媒体消息窗,
创建媒体消息项
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 / 查看器意图与基础观察", () => {

  it("打开查看器时会携带同源时间线保存位置，供唯一播放器续播", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash/content-demo.mp4",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: new URL(playback.src, window.location.href).href,
        currentTime: 23.5,
        updatedAt: 2,
      },
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    const viewerVideoItem = details[0]?.items.find(
      (item): item is Extract<媒体查看器项目, { kind: "video" }> =>
        item.kind === "video" && item.attachmentId === "att-video-1"
    );
    expect(viewerVideoItem?.resumePosition).toEqual({
      src: new URL(playback.src, window.location.href).href,
      currentTime: 23.5,
      updatedAt: 2,
    });

    pane.remove();
  });
  it("有 poster 的视频保存位置源不匹配时，不偷用旧播放帧但继续复用当前 swarm 视频壳", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1-new",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: "http://media.local/swarm-video-1-old",
        currentTime: 24.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.autoplay).toBe(false);
    expect(previewVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1-new");
    expect(previewVideo?.getAttribute("poster")).toBe("http://media.local/poster-video-1");
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    previewVideo!.dispatchEvent(new Event("loadedmetadata"));
    expect(previewVideo!.currentTime).not.toBeCloseTo(24.5, 2);

    pane.remove();
  });
  it("时间线自动播 video 只承载查看器入口，不暴露原生媒体右键菜单", async () => {
    const pane = 创建媒体消息窗();
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-1";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const inlineVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(inlineVideo).not.toBeNull();

    const menuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    inlineVideo!.dispatchEvent(menuEvent);

    expect(menuEvent.defaultPrevented).toBe(true);

    pane.remove();
  });
  it("滚动抖动和视图更新落在同一帧时，只会派发一次自动播候选观察", async () => {
    const pane = 创建媒体消息窗();
    const observedEvents: Array<CustomEvent<{ candidates: unknown[] }>> = [];
    let nextAnimationFrameId = 1;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const flushAnimationFrame = () => {
      const callbacks = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      for (const callback of callbacks) {
        callback(performance.now());
      }
    };

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        rafCallbacks.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        rafCallbacks.delete(id);
      })
    );

    try {
      pane.addEventListener("room-inline-autoplay-observed", (event) => {
        observedEvents.push(event as CustomEvent<{ candidates: unknown[] }>);
      });
      document.body.appendChild(pane);
      await pane.updateComplete;
      flushAnimationFrame();
      observedEvents.length = 0;

      const scrollContainer = pane.querySelector<HTMLElement>("#messageScroll");
      expect(scrollContainer).not.toBeNull();

      scrollContainer?.dispatchEvent(new Event("scroll"));
      scrollContainer?.dispatchEvent(new Event("scroll"));
      pane.jumpToLatestLabel = "跳到最新";
      await pane.updateComplete;

      expect(observedEvents).toHaveLength(0);
      expect(rafCallbacks.size).toBe(1);

      flushAnimationFrame();

      expect(observedEvents).toHaveLength(1);
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });
  it("historyHint 和 jumpToLatestLabel 这类无关更新不会重跑自动播观察与候选调度", async () => {
    const pane = 创建媒体消息窗();
    document.body.appendChild(pane);
    await pane.updateComplete;

    const 自动播候选观察Owner = (
      pane as unknown as {
        自动播候选观察Owner: {
          同步自动播候选观察(scrollContainer: HTMLElement): void;
          调度自动播候选(scrollContainer: HTMLElement): void;
        };
      }
    ).自动播候选观察Owner;
    const 同步自动播候选观察 = vi.spyOn(
      自动播候选观察Owner,
      "同步自动播候选观察"
    );
    const 调度自动播候选 = vi.spyOn(
      自动播候选观察Owner,
      "调度自动播候选"
    );

    pane.historyHint = "正在加载更早消息";
    pane.jumpToLatestLabel = "跳到最新";
    await pane.updateComplete;

    expect(同步自动播候选观察).not.toHaveBeenCalled();
    expect(调度自动播候选).not.toHaveBeenCalled();
    pane.remove();
  });
  it("支持 IntersectionObserver 时，只根据进入视口的按钮派发自动播候选，而不会同步量测整列视频", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      创建媒体消息项(),
      {
        ...创建媒体消息项(),
        id: "m-2",
        eventPosition: 2,
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    const observedEvents: Array<CustomEvent<{ candidates: unknown[] }>> = [];
    let nextAnimationFrameId = 1;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const flushAnimationFrame = () => {
      const callbacks = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      for (const callback of callbacks) {
        callback(performance.now());
      }
    };
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    type 观察回调 = (
      entries: IntersectionObserverEntry[],
      observer: IntersectionObserver
    ) => void;
    let observerCallback: 观察回调 | null = null;
    let observerInstance: IntersectionObserver | null = null;

    class 假交叉观察器 {
      readonly root: Element | Document | null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.25, 0.5, 0.75, 1];
      readonly observe = observe;
      readonly unobserve = unobserve;
      readonly disconnect = disconnect;

      constructor(callback: 观察回调, options?: IntersectionObserverInit) {
        observerCallback = callback;
        this.root = (options?.root as Element | Document | null) ?? null;
        observerInstance = this as unknown as IntersectionObserver;
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        rafCallbacks.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        rafCallbacks.delete(id);
      })
    );
    vi.stubGlobal(
      "IntersectionObserver",
      假交叉观察器 as unknown as typeof IntersectionObserver
    );

    try {
      pane.addEventListener("room-inline-autoplay-observed", (event) => {
        observedEvents.push(event as CustomEvent<{ candidates: unknown[] }>);
      });
      document.body.appendChild(pane);
      await pane.updateComplete;

      const firstButton = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      );
      const secondButton = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-2"]'
      );
      expect(firstButton).not.toBeNull();
      expect(secondButton).not.toBeNull();

      const firstRectSpy = vi
        .spyOn(firstButton!, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 0, 320, 180));
      const secondRectSpy = vi
        .spyOn(secondButton!, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 0, 320, 180));

      flushAnimationFrame();
      observedEvents.length = 0;

      expect(observe).toHaveBeenCalledTimes(2);
      expect(firstRectSpy).not.toHaveBeenCalled();
      expect(secondRectSpy).not.toHaveBeenCalled();
      expect(observerCallback).not.toBeNull();
      expect(observerInstance).not.toBeNull();
      if (!observerCallback || !observerInstance) {
        throw new Error("IntersectionObserver 回调未就绪");
      }

      (observerCallback as 观察回调)(
        [
          {
            target: secondButton!,
            isIntersecting: true,
            intersectionRatio: 0.82,
            boundingClientRect: new DOMRect(0, 270, 320, 180),
            rootBounds: new DOMRect(0, 0, 320, 720),
            intersectionRect: new DOMRect(0, 270, 320, 180),
            time: performance.now(),
          } as IntersectionObserverEntry,
        ],
        observerInstance as IntersectionObserver
      );

      expect(observedEvents).toHaveLength(0);
      expect(rafCallbacks.size).toBe(1);

      flushAnimationFrame();

      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0]?.detail.candidates).toEqual([
        {
          attachmentId: "att-video-2",
          visibilityRatio: 1,
          distanceToViewportCenter: 0,
        },
      ]);
      expect(firstRectSpy).not.toHaveBeenCalled();
      expect(secondRectSpy).not.toHaveBeenCalled();
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });
});
