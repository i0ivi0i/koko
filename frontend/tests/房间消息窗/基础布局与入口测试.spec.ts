// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../../媒体/媒体查看器";
import type { 媒体会话信号 } from "../../媒体/媒体会话";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import {
  创建单视频消息项,
  创建媒体消息窗,
  创建媒体消息项,
  创建五附件拼贴消息项,
} from "../common/房间消息窗媒体支架";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("房间消息窗媒体查看器 - 基础布局与入口", () => {
  it("房间消息窗 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("房间消息窗/壳.ts");
    const shellSource = 读取前端源码("总装/聊天壳.ts");

    expect(existsSync(resolve(process.cwd(), "房间消息窗.ts"))).toBe(false);
    expect(ownerSource).toContain("export class 房间消息窗 extends LitElement");
    expect(shellSource).toContain('import "../房间消息窗/壳.js";');
    expect(shellSource).not.toContain('import "./房间消息窗.js";');
  });

  it("IntersectionObserver 首次接管时，不再同步量测视口，候选由观察器回调给出", async () => {
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
      const videoRectSpy = vi
        .spyOn(videoButton!, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 270, 320, 180));
      observedEvents.length = 0;
      const 自动播候选观察Owner = (
        pane as unknown as {
          自动播候选观察Owner: {
            清理自动播候选观察(): void;
            同步自动播候选观察(scrollContainer: HTMLElement): void;
          };
        }
      ).自动播候选观察Owner;
      自动播候选观察Owner.清理自动播候选观察();
      自动播候选观察Owner.同步自动播候选观察(scrollContainer!);

      expect(videoRectSpy).not.toHaveBeenCalled();
      expect(observedEvents).toHaveLength(0);
      expect(observerCallback).not.toBeNull();
      expect(observerInstance).not.toBeNull();
      if (!observerCallback || !observerInstance) {
        throw new Error("IntersectionObserver 回调未就绪");
      }
      (observerCallback as 观察回调)(
        [
          {
            target: videoButton!,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: new DOMRect(0, 270, 320, 180),
            rootBounds: new DOMRect(0, 0, 320, 720),
            intersectionRect: new DOMRect(0, 270, 320, 180),
            time: performance.now(),
          } as IntersectionObserverEntry,
        ],
        observerInstance
      );
      flushAnimationFrame();

      expect(observedEvents.at(-1)?.detail.candidates).toEqual([
        {
          attachmentId: "att-video-1",
          visibilityRatio: 1,
          distanceToViewportCenter: 0,
        },
      ]);
    } finally {
      pane.remove();
      vi.unstubAllGlobals();
    }
  });

  it("虚拟消息行渲染不再调用 measureElement 同步量 DOM", async () => {
    const pane = 创建媒体消息窗();
    pane.items = Array.from({ length: 8 }, (_, index) =>
      创建单视频消息项(`att-no-measure-${index + 1}`, index + 1)
    );
    const virtualizer = (
      pane as unknown as {
        读取消息虚拟器(): { measureElement(element: HTMLElement): void };
      }
    ).读取消息虚拟器();
    const measureElement = vi.spyOn(virtualizer, "measureElement");

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(measureElement).not.toHaveBeenCalled();

    pane.remove();
  });

  it("虚拟消息行高度估算必须覆盖多附件拼贴完整网格，避免消息互相压住", () => {
    const pane = 创建媒体消息窗();
    const collage = 创建五附件拼贴消息项();
    pane.items = [collage];

    const estimatedHeight = (
      pane as unknown as {
        估算消息行高度(index: number): number;
      }
    ).估算消息行高度(0);
    const expectedGridHeight = 3 * 240 + 2 * 8;

    expect(estimatedHeight).toBeGreaterThanOrEqual(22 + expectedGridHeight);

    pane.remove();
  });

  it("群友昵称会渲染在气泡外层，而不是继续被气泡宽度一起挤折", async () => {
    const pane = 创建媒体消息窗();
    document.body.appendChild(pane);
    await pane.updateComplete;

    const stack = pane.querySelector<HTMLElement>(".message-row.other .message-stack");
    const alias = pane.querySelector<HTMLElement>(".message-row.other .message-alias");
    const surface = pane.querySelector<HTMLElement>(".message-row.other .message-surface");
    expect(stack).not.toBeNull();
    expect(alias).not.toBeNull();
    expect(surface).not.toBeNull();
    expect(stack?.firstElementChild).toBe(alias);
    expect(surface?.querySelector(".message-alias")).toBeNull();

    pane.remove();
  });

  it("拼贴模板和槽位元数据会从 presenter 透传到 DOM，而不是在 renderer 里重新猜多附件布局", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    pane.items = [创建五附件拼贴消息项()];
    document.body.appendChild(pane);
    await pane.updateComplete;

    const grid = pane.querySelector<HTMLElement>(".message-attachment-grid");
    expect(grid?.dataset.attachmentTemplate).toBe("hero-strip");
    expect(grid?.style.getPropertyValue("--attachment-grid-columns")).toBe("2");
    expect(grid?.style.getPropertyValue("--attachment-grid-row-height")).toBe("240px");

    const heroCard = pane.querySelector<HTMLElement>(
      '.message-attachment-card[data-attachment-id="att-hero"]'
    );
    const lowerVideoCard = pane.querySelector<HTMLElement>(
      '.message-attachment-card[data-attachment-id="att-video-4"]'
    );
    expect(heroCard?.dataset.gridColumnSpan).toBe("1");
    expect(heroCard?.dataset.gridRowStart).toBe("1");
    expect(heroCard?.dataset.gridRowSpan).toBe("2");
    expect(heroCard?.style.getPropertyValue("grid-column")).toBe("1 / span 1");
    expect(heroCard?.style.getPropertyValue("grid-row")).toBe("1 / span 2");
    expect(lowerVideoCard?.dataset.gridColumnStart).toBe("1");
    expect(lowerVideoCard?.dataset.gridRowStart).toBe("3");
    expect(lowerVideoCard?.style.getPropertyValue("grid-row")).toBe("3 / span 1");

    pane.remove();
  });

  it("点击图片和视频入口时只抛出 viewer 意图，并优先使用 WebTorrent swarm 播放源", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-video-1",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    const scrollIntentEvents: Event[] = [];
    pane.addEventListener("room-scroll-intent", (event) =>
      scrollIntentEvents.push(event)
    );
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    const expectedItems = [
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
        src: "blob:http://media.local/webtorrent-video-1",
        posterSrc: "http://media.local/poster-video-1",
        width: 1280,
        height: 720,
      },
    ];
    expect(details).toHaveLength(2);
    expect(details.map((detail) => detail.startAttachmentId)).toEqual([
      "att-video-1",
      "att-image-1",
    ]);
    expect(details.map((detail) => detail.items)).toEqual([
      expectedItems,
      expectedItems,
    ]);
    expect(scrollIntentEvents).toHaveLength(0);
    expect(pane.querySelector('[data-video-preview="att-video-1"]')).toBeNull();

    pane.remove();
  });

  it("点击媒体入口后，消息窗内部仍然不会偷偷创建正式播放器壳", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    // 消息窗只负责预览与查看器意图，不允许自己长成第二套正式播放器实现。
    expect(pane.querySelector("video-player[data-player-shell='videojs']")).toBeNull();

    pane.remove();
  });

  it("图片时间线一旦拿到 WebTorrent 播放真相，就直接显示 swarm 源而不是继续吃缩略图冷源", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-image-1": {
        mode: "swarm",
        attachmentId: "att-image-1",
        kind: "image",
        src: "blob:http://media.local/webtorrent-image-1",
        thumbnailUrl: "http://media.local/thumb-image-1",
        contentHash: "hash-image-1",
        distribution: {
          swarm_id: "swarm-image-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-1/original.png",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        hint: null,
        formalByteSource: "webtorrent_official_stream",
      } satisfies 媒体播放结果,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );

    expect(preview?.getAttribute("src")).toBe(
      "blob:http://media.local/webtorrent-image-1"
    );

    pane.remove();
  });

  it("图片尚未拿到播放真相时，时间线保持本地占位而不是抢跑 original 冷源", async () => {
    const pane = 创建媒体消息窗();
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );

    expect(preview?.getAttribute("src")).not.toBe("http://media.local/original-image-1");
    expect(preview?.getAttribute("src")).not.toBe("http://media.local/thumb-image-1");
    expect(preview?.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);

    pane.remove();
  });

  it("点按媒体入口不应被误判成滚动意图，避免触发顶部补历史", async () => {
    const pane = 创建媒体消息窗();

    const scrollIntentEvents: Event[] = [];
    pane.addEventListener("room-scroll-intent", (event) =>
      scrollIntentEvents.push(event)
    );
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));

    expect(scrollIntentEvents).toHaveLength(0);

    pane
      .querySelector<HTMLElement>("#messageScroll")
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));

    expect(scrollIntentEvents).toHaveLength(1);

    pane.remove();
  });

  it("默认静态视频封面不会偷偷挂真实 video 预览", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
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
    expect(信号记录).toEqual([]);

    pane.remove();
  });

  it("非自动播视频在没有 poster 但已有 swarm 可播源时，应回退到首帧预览而不是静态占位图", async () => {
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
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(previewVideo?.hasAttribute("autoplay")).toBe(false);
    expect(previewVideo?.getAttribute("preload")).toBe("metadata");
    expect(previewVideo?.getAttribute("poster")).toBeNull();
    expect(previewPoster).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });
});
