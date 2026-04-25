// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器";
import type { 媒体会话信号 } from "../媒体/媒体会话";
import type { 房间消息窗 } from "../房间消息窗";
import type { 消息展示项 } from "../视图";
import "../房间消息窗";

const 空文本布局 = {
  height: 0,
  lineCount: 0,
  naturalWidth: 0,
  maxLineWidth: 0,
  lines: [],
};

const 创建媒体消息项 = (): 消息展示项 => ({
  kind: "message",
  id: "m-1",
  owner: "other",
  body: "",
  hasText: false,
  layout: 空文本布局,
  bubbleWidth: 320,
  senderDisplayAlias: "冷静的水獭",
  showAlias: true,
  eventPosition: 1,
  attachments: [
    {
      kind: "image",
      attachmentId: "att-image-1",
      width: 1200,
      height: 800,
      displayWidth: 320,
      displayHeight: 213,
      thumbnailSrc: "http://media.local/thumb-image-1",
      originalSrc: "http://media.local/original-image-1",
    },
    {
      kind: "video",
      attachmentId: "att-video-1",
      width: 1280,
      height: 720,
      displayWidth: 320,
      displayHeight: 180,
      originalSrc: "http://media.local/original-video-1",
      posterSrc: "http://media.local/poster-video-1",
    },
  ],
});

const 创建五附件拼贴消息项 = (): 消息展示项 => ({
  kind: "message",
  id: "m-collage-1",
  owner: "other",
  body: "",
  hasText: false,
  layout: 空文本布局,
  bubbleWidth: 384,
  senderDisplayAlias: "冷静的水獭",
  showAlias: true,
  eventPosition: 1,
  attachmentLayout: {
    template: "hero-strip",
    columnCount: 2,
    gap: 8,
    rowHeight: 240,
    contentWidth: 384,
  },
  attachments: [
    {
      kind: "image",
      attachmentId: "att-hero",
      width: 1200,
      height: 800,
      gridColumnStart: 1,
      gridColumnSpan: 1,
      gridRowStart: 1,
      gridRowSpan: 2,
      displayWidth: 188,
      displayHeight: 488,
      thumbnailSrc: "http://media.local/thumb-hero",
      originalSrc: "http://media.local/original-hero",
    },
    {
      kind: "video",
      attachmentId: "att-video-2",
      width: 1280,
      height: 720,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 1,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      originalSrc: "http://media.local/original-video-2",
      posterSrc: "http://media.local/poster-video-2",
    },
    {
      kind: "image",
      attachmentId: "att-image-3",
      width: 1200,
      height: 800,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 2,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      thumbnailSrc: "http://media.local/thumb-image-3",
      originalSrc: "http://media.local/original-image-3",
    },
    {
      kind: "video",
      attachmentId: "att-video-4",
      width: 1280,
      height: 720,
      gridColumnStart: 1,
      gridColumnSpan: 1,
      gridRowStart: 3,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      originalSrc: "http://media.local/original-video-4",
      posterSrc: "http://media.local/poster-video-4",
    },
    {
      kind: "image",
      attachmentId: "att-image-5",
      width: 1200,
      height: 800,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 3,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      thumbnailSrc: "http://media.local/thumb-image-5",
      originalSrc: "http://media.local/original-image-5",
    },
  ],
});

const 创建媒体消息窗 = (): 房间消息窗 => {
  // 阶段 0 的保护测试共用同一条“图片 + 视频”消息，防止两条入口的 fixture 漂移。
  const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
  pane.items = [创建媒体消息项()];
  return pane;
};

describe("房间消息窗媒体查看器", () => {
  it("IntersectionObserver 首次接管前，也会先用当前视口量测给出可见自动播候选", async () => {
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
      (
        pane as unknown as {
          清理自动播候选观察(): void;
          同步自动播候选观察(scrollContainer: HTMLElement): void;
          调度自动播候选(scrollContainer: HTMLElement): void;
        }
      ).调度自动播候选(scrollContainer!);

      flushAnimationFrame();

      expect(videoRectSpy).toHaveBeenCalled();
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
        src: "http://media.local/original-image-1",
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
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
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

  it("无 poster 视频在首帧未就绪时应先显示轻量 guard，并在首帧事件后再揭开视频像素", async () => {
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
    const firstFrameGuard = pane.querySelector<HTMLImageElement>(
      'img.message-video-first-frame-guard[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.classList.contains("message-video-preview--gated")).toBe(true);
    expect(firstFrameGuard).not.toBeNull();
    expect(firstFrameGuard?.getAttribute("src")).toContain("data:image/svg+xml");

    previewVideo?.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    await pane.updateComplete;

    expect(
      pane.querySelector('img.message-video-first-frame-guard[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(previewVideo?.classList.contains("message-video-preview--gated")).toBe(false);

    pane.remove();
  });

  it("非自动播视频在没有 poster 但已解析 runtime preview 时，应直接显示 preview 图而不是继续等待 autoplay owner", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<
          string,
          { phase: "ready"; src: string; source: "cache" | "embedded_hint" | "early_frame" | "rvfc" }
        >;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": {
        phase: "ready",
        src: "blob:preview-att-video-1",
        source: "early_frame",
      },
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toBe("blob:preview-att-video-1");

    pane.remove();
  });

  it("无 poster 视频已命中 runtime preview 且 playback 可用时，切到自动播 owner 应复用同一 video 节点避免闪烁", async () => {
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
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<
          string,
          { phase: "ready"; src: string; source: "cache" | "embedded_hint" | "early_frame" | "rvfc" }
        >;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": {
        phase: "ready",
        src: "blob:preview-att-video-1",
        source: "early_frame",
      },
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerVideo?.getAttribute("poster")).toBe("blob:preview-att-video-1");
    expect(beforeOwnerVideo?.autoplay).toBe(false);

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
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).toBe(beforeOwnerVideo);
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);

    pane.remove();
  });

  it("非自动播视频在没有 poster 且尚未注入 playback 时，会保持静态占位而不是读取 originalSrc", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });

  it("无 poster 视频在 playback 首次解析到 swarm 后，会从静态占位升级为 swarm 首帧预览", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewBeforeUpgrade = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const posterBeforeUpgrade = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewBeforeUpgrade).toBeNull();
    expect(posterBeforeUpgrade).not.toBeNull();

    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: "正在协作分发",
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const previewAfterUpgrade = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewAfterUpgrade).not.toBeNull();
    expect(previewAfterUpgrade?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(previewAfterUpgrade?.autoplay).toBe(false);

    pane.remove();
  });

  it("视频在没有 playback 真相时，抛出的 viewer request 不会偷带 originalSrc", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
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

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      startAttachmentId: "att-video-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "",
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });

    pane.remove();
  });

  it("同屏多个视频时，只会给当前自动播 owner 渲染一颗轻量 video", async () => {
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
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-2";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": {
        mode: "swarm",
        attachmentId: "att-video-2",
        kind: "video",
        src: "http://media.local/swarm-video-2",
        thumbnailUrl: "http://media.local/poster-video-2",
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const inlineVideos = pane.querySelectorAll<HTMLVideoElement>("video.message-video-preview");
    expect(inlineVideos).toHaveLength(1);
    expect(inlineVideos[0]?.getAttribute("data-attachment-id")).toBe("att-video-2");
    expect(inlineVideos[0]?.loop).toBe(true);
    expect(inlineVideos[0]?.hasAttribute("disablepictureinpicture")).toBe(true);
    expect(inlineVideos[0]?.hasAttribute("disableremoteplayback")).toBe(true);
    expect(inlineVideos[0]?.getAttribute("controlslist")).toBe(
      "nodownload nofullscreen noremoteplayback"
    );
    expect(inlineVideos[0]?.getAttribute("tabindex")).toBe("-1");
    expect(inlineVideos[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-2"]')
    ).toBeNull();

    pane.remove();
  });

  it("无 poster 视频从首帧预览切到自动播 owner 时应复用同一 video 节点，避免闪烁重建", async () => {
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

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.autoplay).toBe(false);
    expect(beforeOwnerVideo?.getAttribute("poster")).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

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
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).toBe(beforeOwnerVideo);
    expect(ownerVideo?.autoplay).toBe(true);
    expect(ownerVideo?.getAttribute("poster")).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).toBeNull();

    pane.remove();
  });

  it("无 poster 视频在自动播 owner 释放后应保持已解析预览源，避免回切原始源闪烁", async () => {
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
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(previewVideo?.autoplay).toBe(false);

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
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).toBe(previewVideo);
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).toBe(ownerVideo);
    expect(releasedVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(releasedVideo?.autoplay).toBe(false);
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });

  it("无 poster 视频进入自动播 owner 时应优先复用当前 swarm 预览源，避免切源闪烁", async () => {
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

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerVideo?.autoplay).toBe(false);

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
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).toBe(beforeOwnerVideo);
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);

    pane.remove();
  });

  it("无 poster 视频切到自动播 owner 且沿用同一条 swarm 预览源时，会显式触发 play 以避免 autoplay 失效", async () => {
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

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerVideo?.autoplay).toBe(false);

    const playSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(beforeOwnerVideo!, "play", {
      configurable: true,
      value: playSpy,
    });

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
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).toBe(beforeOwnerVideo);
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);

    pane.remove();
  });

  it("自动播视频 DOM 重挂载后会从运行时回灌的时间戳续播，而不是从头播放", async () => {
    const pane = 创建媒体消息窗();
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const 创建单视频消息 = (id: string): 消息展示项 => ({
      ...创建媒体消息项(),
      id,
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
    });
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
      const positionEvent = event as CustomEvent<{
        attachmentId: string;
        position: 媒体播放位置;
      }>;
      positionEvents.push(positionEvent);
      pane.inlineAutoplayPositionByAttachmentId = {
        [positionEvent.detail.attachmentId]: positionEvent.detail.position,
      };
    });
    pane.items = [创建单视频消息("m-video-before")];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": autoplayPlayback,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeRemountVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeRemountVideo).not.toBeNull();
    beforeRemountVideo!.currentTime = 18.25;
    beforeRemountVideo!.dispatchEvent(new Event("timeupdate"));
    expect(positionEvents).toHaveLength(1);
    const firstPositionEvent = positionEvents[0];
    expect(firstPositionEvent).toBeDefined();
    expect(firstPositionEvent!.detail).toMatchObject({
      attachmentId: "att-video-1",
      position: {
        src: "http://media.local/swarm-video-1",
        currentTime: 18.25,
      },
    });

    pane.items = [创建单视频消息("m-video-after")];
    await pane.updateComplete;

    const afterRemountVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(afterRemountVideo).not.toBeNull();
    expect(afterRemountVideo).not.toBe(beforeRemountVideo);
    afterRemountVideo!.dispatchEvent(new Event("loadedmetadata"));

    expect(afterRemountVideo!.currentTime).toBeCloseTo(18.25, 2);

    pane.remove();
  });

  it("自动播时间戳上报只允许当前 owner，并对高频 timeupdate 做节流", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    try {
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
      pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
        positionEvents.push(
          event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
        );
      });
      pane.mediaPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      document.body.appendChild(pane);
      await pane.updateComplete;

      const nonOwnerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(nonOwnerVideo).not.toBeNull();
      nonOwnerVideo!.currentTime = 8;
      nonOwnerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(0);

      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      await pane.updateComplete;

      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();
      ownerVideo!.currentTime = 10;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(1_500);
      ownerVideo!.currentTime = 10.5;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(2_000);
      ownerVideo!.currentTime = 11;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(2);

      nowSpy.mockReturnValue(2_100);
      ownerVideo!.currentTime = 11.1;
      ownerVideo!.dispatchEvent(new Event("pause"));
      expect(positionEvents).toHaveLength(3);
      const flushedPositionEvent = positionEvents[2];
      expect(flushedPositionEvent).toBeDefined();
      expect(flushedPositionEvent!.detail.position.currentTime).toBeCloseTo(11.1, 2);
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("自动播 owner 释放时会在暂停前强制 flush 最新时间戳", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3_000);
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    try {
      pane.addEventListener("room-inline-autoplay-position-changed", (event) => {
        positionEvents.push(
          event as CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
        );
      });
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
        "att-video-1": autoplayPlayback,
      };
      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      pane.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-1": autoplayPlayback,
      };
      document.body.appendChild(pane);
      await pane.updateComplete;

      const pauseSpy = vi
        .spyOn(HTMLMediaElement.prototype, "pause")
        .mockImplementation(() => undefined);
      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();
      ownerVideo!.currentTime = 42.5;

      pane.inlineAutoplayOwnerAttachmentId = null;
      await pane.updateComplete;

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(positionEvents).toHaveLength(1);
      const releaseFlushEvent = positionEvents[0];
      expect(releaseFlushEvent).toBeDefined();
      expect(releaseFlushEvent!.detail.position.currentTime).toBeCloseTo(42.5, 2);
      pauseSpy.mockRestore();
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("有 poster 的视频释放自动播 owner 后仍显示保存时间点的视频帧", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建媒体消息项()];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 24.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBeNull();
    expect(ownerVideo?.autoplay).toBe(true);

    pane.inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(releasedVideo?.autoplay).toBe(false);
    expect(releasedVideo?.getAttribute("poster")).toBeNull();

    releasedVideo!.dispatchEvent(new Event("loadedmetadata"));
    expect(releasedVideo!.currentTime).toBeCloseTo(24.5, 2);

    pane.remove();
  });

  it("有 poster 的视频保存位置为 currentSrc 绝对地址时，也能匹配相对 swarm 源显示保存帧", async () => {
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
        currentTime: 19.75,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(preview?.autoplay).toBe(false);

    preview!.dispatchEvent(new Event("loadedmetadata"));
    expect(preview!.currentTime).toBeCloseTo(19.75, 2);

    pane.remove();
  });

  it("自动播 owner 暂退且播放快照还未回灌时，仍用保存的同源视频帧而不是退回 poster", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [创建媒体消息项()];
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.mediaPlaybackByAttachmentId = {};
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: "http://media.local/swarm-video-1",
        currentTime: 31.25,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const restoredVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(restoredVideo).not.toBeNull();
    expect(restoredVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(restoredVideo?.autoplay).toBe(false);
    expect(restoredVideo?.getAttribute("poster")).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    restoredVideo!.dispatchEvent(new Event("loadedmetadata"));
    expect(restoredVideo!.currentTime).toBeCloseTo(31.25, 2);

    pane.remove();
  });

  it("有 poster 的视频保存位置源不匹配时仍回退 poster，禁止偷用旧播放帧", async () => {
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

    const poster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(poster).not.toBeNull();
    expect(poster?.getAttribute("src")).toBe("http://media.local/poster-video-1");
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();

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
          visibilityRatio: 0.82,
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

  it("视频已经切到 HLS manifest 主链时，消息卡片继续用 poster 占位，但查看器要拿到 manifest 地址", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
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
        src: "http://media.local/original-image-1",
        alt: "图片附件原图",
        width: 1200,
        height: 800,
      },
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        posterSrc: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
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

  it("视频已经切到 HLS manifest 主链且没有 poster 时，消息卡片会退到静态占位，而不是把 m3u8 塞给原生 video", async () => {
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
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: null,
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
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
    expect(previewPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    const placeholderSvg = decodeURIComponent(
      previewPoster?.getAttribute("src")?.split(",")[1] ?? ""
    );
    expect(placeholderSvg).not.toContain("<polygon");
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
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        posterSrc: null,
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        width: 1280,
        height: 720,
      },
    ]);

    pane.remove();
  });

  it("图片预览加载失败时也会回抛媒体会话信号，而不是继续让旧 src 静默失效", async () => {
    const pane = 创建媒体消息窗();
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );
    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

    pane.remove();
  });

  it("非自动播 owner 的时间线视频触发 error 时，不应广播 PLAYER_ERROR 干扰会话恢复链路", async () => {
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
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview).not.toBeNull();

    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([]);

    pane.remove();
  });

  it("自动播 owner 的时间线视频触发 error 时，必须继续广播 PLAYER_ERROR 给媒体会话 owner", async () => {
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
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;
    // 自动播 owner 可能在挂载后立即回抛一次 PLAYER_PLAYING，这里清空只看 error 语义。
    信号记录.length = 0;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview).not.toBeNull();

    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

    pane.remove();
  });

  it("视频封面加载失败时会回抛恢复信号并退回静态占位，新 thumbnail 到达后应恢复展示", async () => {
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
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1-stale",
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

    const stalePoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(stalePoster?.getAttribute("src")).toBe("http://media.local/poster-video-1-stale");

    stalePoster?.dispatchEvent(new Event("error"));
    await pane.updateComplete;

    const placeholderPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(placeholderPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

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
    await pane.updateComplete;

    const refreshedPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(refreshedPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1-fresh");

    pane.remove();
  });

  it("视频降级为 no_online_seed 时会显示手动重试入口，并回抛 ENTER_RECOVERING 信号", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-no-seed-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-no-seed-1",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-no-seed-1": {
        mode: "degraded",
        attachmentId: "att-video-no-seed-1",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        reason: "no_online_seed",
        hint: "当前没有在线种子，等待群友上线",
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

    const retryButton = pane.querySelector<HTMLButtonElement>(
      'button.message-media-retry-trigger[data-attachment-id="att-video-no-seed-1"]'
    );
    expect(retryButton).not.toBeNull();

    retryButton?.click();

    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-no-seed-1",
        signal: { type: "ENTER_RECOVERING" },
      },
    ]);

    pane.remove();
  });

  it("图片走 canonical 锚点主链时，卡片继续吃 preview，查看器会拿 canonical 原图", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-image-1": {
        mode: "anchor",
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/blob/att-image-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-1/preview.webp",
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
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );
    expect(preview?.getAttribute("src")).toBe(
      "http://media.local/blob/att-image-1/preview.webp"
    );

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items[0]).toEqual({
      attachmentId: "att-image-1",
      kind: "image",
      src: "http://media.local/blob/att-image-1/full.webp",
      contentHash: "hash-image-1",
      distribution: {
        swarm_id: "swarm-image-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/blob/att-image-1/original.png",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted" as const,
      },
      alt: "图片附件原图",
      width: 1200,
      height: 800,
    });

    pane.remove();
  });
});
