// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "../../媒体/媒体查看器";
import type { 房间消息窗 } from "../../房间消息窗";
import {
  安装消息窗直达全屏模拟,
  创建媒体消息窗,
  创建媒体消息项,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 查看器意图与观察调度", () => {
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

    const 同步自动播候选观察 = vi.spyOn(
      pane as unknown as {
        同步自动播候选观察(scrollContainer: HTMLElement): void;
      },
      "同步自动播候选观察"
    );
    const 调度自动播候选 = vi.spyOn(
      pane as unknown as {
        调度自动播候选(scrollContainer: HTMLElement): void;
      },
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
            originalSrc: "http://media.local/original-video-2",
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

  it("竖屏视频高度超过聊天视口时，自动播可见比例按可用视口归一化", () => {
    const pane = 创建媒体消息窗();
    const candidate = (
      pane as unknown as {
        根据矩形计算自动播候选(
          attachmentId: string,
          rect: Pick<DOMRectReadOnly, "top" | "bottom" | "height">,
          viewportRect: Pick<DOMRectReadOnly, "top" | "bottom" | "height">
        ): { attachmentId: string; visibilityRatio: number; distanceToViewportCenter: number } | null;
      }
    ).根据矩形计算自动播候选(
      "att-vertical-video",
      { top: -184, bottom: 385, height: 569 },
      { top: 54, bottom: 385, height: 331 }
    );

    expect(candidate).toMatchObject({
      attachmentId: "att-vertical-video",
      visibilityRatio: 1,
    });
  });

  it("支持 IntersectionObserver 时，贴近视口但尚未相交的视频也会保留为预热候选", async () => {
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
    const observe = vi.fn();
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
      readonly unobserve = vi.fn();
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

      const button = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      );
      expect(button).not.toBeNull();

      flushAnimationFrame();
      observedEvents.length = 0;

      expect(observe).toHaveBeenCalledTimes(1);
      expect(observerCallback).not.toBeNull();
      expect(observerInstance).not.toBeNull();
      if (!observerCallback || !observerInstance) {
        throw new Error("IntersectionObserver 回调未就绪");
      }

      /**
       * 目标视频尚未真正进入视口，但已经紧贴下沿：
       * - 这时它不该抢自动播 owner；
       * - 但应该提前进入预热候选，避免真正露头后才第一次 `img -> video` 换壳。
       */
      (observerCallback as 观察回调)(
        [
          {
            target: button!,
            isIntersecting: false,
            intersectionRatio: 0,
            boundingClientRect: new DOMRect(0, 730, 320, 180),
            rootBounds: new DOMRect(0, 0, 320, 720),
            intersectionRect: new DOMRect(0, 0, 0, 0),
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
          attachmentId: "att-video-1",
          visibilityRatio: 0,
          distanceToViewportCenter: 460,
        },
      ]);
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });

  it("支持 IntersectionObserver 时，距离视口不足一屏的未相交视频也会保留为预热候选，给正式会话留出解析提前量", async () => {
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

      constructor(callback: 观察回调, options?: IntersectionObserverInit) {
        observerCallback = callback;
        this.root = (options?.root as Element | Document | null) ?? null;
        observerInstance = this as unknown as IntersectionObserver;
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}

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

      const scrollContainer = pane.querySelector<HTMLElement>(".message-scroll");
      const videoButton = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      );
      expect(scrollContainer).not.toBeNull();
      expect(videoButton).not.toBeNull();
      vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 320, 720)
      );
      vi.spyOn(videoButton!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 980, 320, 180)
      );
      observedEvents.length = 0;
      (
        pane as unknown as {
          清理自动播候选观察(): void;
          同步自动播候选观察(scrollContainer: HTMLElement): void;
          调度自动播候选(scrollContainer: HTMLElement): void;
        }
      ).清理自动播候选观察();
      (
        pane as unknown as {
          清理自动播候选观察(): void;
          同步自动播候选观察(scrollContainer: HTMLElement): void;
          调度自动播候选(scrollContainer: HTMLElement): void;
        }
      ).同步自动播候选观察(scrollContainer!);
      expect(observerCallback).not.toBeNull();
      expect(observerInstance).not.toBeNull();
      if (!observerCallback || !observerInstance) {
        throw new Error("IntersectionObserver 回调未就绪");
      }
      (observerCallback as 观察回调)(
        [
          {
            target: videoButton!,
            isIntersecting: false,
            intersectionRatio: 0,
            boundingClientRect: new DOMRect(0, 980, 320, 180),
            rootBounds: new DOMRect(0, 0, 320, 720),
            intersectionRect: new DOMRect(0, 0, 0, 0),
            time: performance.now(),
          } as IntersectionObserverEntry,
        ],
        observerInstance
      );

      flushAnimationFrame();

      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0]?.detail.candidates).toEqual([
        {
          attachmentId: "att-video-1",
          visibilityRatio: 0,
          distanceToViewportCenter: 710,
        },
      ]);
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });

  it("房间首轮更新时，现代浏览器不再同步量测并立即派发自动播候选", async () => {
    const pane = 创建媒体消息窗();
    const observedDetails: Array<{ candidates: unknown[] }> = [];
    let nextAnimationFrameId = 1;
    const rafCallbacks = new Map<number, FrameRequestCallback>();

    class 假交叉观察器 {
      readonly root: Element | Document | null;
      readonly rootMargin = "0px";
      readonly thresholds = [0, 0.25, 0.5, 0.75, 1];

      constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = (options?.root as Element | Document | null) ?? null;
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}

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
        observedDetails.push(
          (event as CustomEvent<{ candidates: unknown[] }>).detail
        );
      });
      document.body.appendChild(pane);
      await pane.updateComplete;

      const scrollContainer = pane.querySelector<HTMLElement>(".message-scroll");
      const videoButton = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      );
      expect(scrollContainer).not.toBeNull();
      expect(videoButton).not.toBeNull();
      vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 320, 720)
      );
      vi.spyOn(videoButton!, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 980, 320, 180)
      );
      observedDetails.length = 0;

      pane.mediaPlaybackByAttachmentId = { ...pane.mediaPlaybackByAttachmentId };
      await pane.updateComplete;

      expect(videoButton!.getBoundingClientRect).not.toHaveBeenCalled();
      expect(observedDetails).toEqual([]);
      expect(rafCallbacks.size).toBe(0);
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });

  it("旧 manifest 播放快照不会再被投影成查看器正式视频源，而是等待唯一主链重裁", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1");
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items).toEqual([
      {
        attachmentId: "att-image-1",
        kind: "image",
        src: "",
        alt: "图片附件原图",
        width: 1200,
        height: 800,
      },
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "",
        posterSrc: "http://media.local/poster-video-1",
        width: 1280,
        height: 720,
      },
    ]);

    pane.remove();
  });

  it("消息快照里的旧 poster 失效时，时间线和查看器都应优先使用最新 playback.thumbnailUrl", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: "http://media.local/poster-video-1-stale",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1-fresh",
        hint: null,
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1-fresh");

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items).toEqual([
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        posterSrc: "http://media.local/poster-video-1-fresh",
        width: 1280,
        height: 720,
      },
    ]);

    pane.remove();
  });

  it("点击当前自动播 owner 视频时，也只回抛统一查看器意图，不再让消息窗直接接管原生全屏", async () => {
    const { requestFullscreen, exitFullscreen, restore } = 安装消息窗直达全屏模拟();
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    try {
      document.body.appendChild(pane);
      await pane.updateComplete;

      const preview = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      const trigger = pane.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      );
      expect(preview).not.toBeNull();
      expect(trigger).not.toBeNull();
      expect(preview?.controls).toBe(false);
      expect(preview?.muted).toBe(true);
      expect(preview?.loop).toBe(true);

      trigger?.click();
      await pane.updateComplete;

      /**
       * 当前自动播 owner 也必须走统一查看器入口：
       * 1. 消息窗只负责表达用户意图，不再自己抓原生 `<video>` 去 requestFullscreen；
       * 2. 后续是否复用同一颗 canonical Video.js player，由壳层/唯一播放器 owner 决定；
       * 3. 这样才能删掉“当前 owner 一条路、非 owner 另一条路”的双轨真相。
       */
      expect(details).toHaveLength(1);
      expect(details[0]?.startAttachmentId).toBe("att-video-1");
      expect(requestFullscreen).toHaveBeenCalledTimes(0);
      expect(document.fullscreenElement).toBeNull();
      expect(
        pane.querySelectorAll('video.message-video-preview[data-attachment-id="att-video-1"]')
      ).toHaveLength(1);
      expect(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
        )
      ).not.toBeNull();
      expect(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
        )
      ).toBeNull();
      expect(preview?.controls).toBe(false);
      expect(preview?.muted).toBe(true);
      expect(preview?.loop).toBe(true);

      await exitFullscreen();
      await pane.updateComplete;
    } finally {
      pane.remove();
      restore();
    }
  });

  it("时间线视频卡片会优先消费统一预算投影，而不是自己重算 owner 级 canonical 露出", async () => {
    const pane = 创建媒体消息窗();
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-1",
        thumbnailUrl: "http://media.local/poster-att-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/inline-owner-att-video-1",
        thumbnailUrl: "http://media.local/poster-att-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    (
      pane as unknown as {
        mediaVideoBudgetByAttachmentId: Record<
          string,
          {
            attachmentId: string;
            tier: string;
            reason: string;
            canonicalVideoSrc: string | null;
            previewVideoSrc: string | null;
            allowInlineCanonical: boolean;
            allowPreviewVideo: boolean;
            formalByteSource: string;
          }
        >;
      }
    ).mediaVideoBudgetByAttachmentId = {
      "att-video-1": {
        attachmentId: "att-video-1",
        tier: "warm_preview",
        reason: "window_preview",
        canonicalVideoSrc: null,
        previewVideoSrc: "blob:http://media.local/swarm-att-video-1",
        allowInlineCanonical: false,
        allowPreviewVideo: true,
        formalByteSource: "webtorrent_official_stream",
      },
    };
    try {
      document.body.appendChild(pane);
      await pane.updateComplete;

      const videoCard = pane.querySelector<HTMLElement>(
        '.message-video-card[data-attachment-id="att-video-1"]'
      );
      expect(videoCard?.dataset.budgetTier).toBe("warm_preview");
      expect(videoCard?.dataset.budgetReason).toBe("window_preview");
      expect(videoCard?.dataset.formalByteSource).toBe("webtorrent_official_stream");
      expect(
        pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
      ).toBeNull();
      expect(
        pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
      ).not.toBeNull();
    } finally {
      pane.remove();
    }
  });
});
