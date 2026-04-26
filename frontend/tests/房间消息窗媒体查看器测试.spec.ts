// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器";
import type { 媒体会话信号 } from "../媒体/媒体会话";
import { 读取默认全局唯一播放器 } from "../媒体/全局唯一播放器";
import { 创建VideoJs播放器壳 } from "../媒体/videojs播放器壳.js";
import type { 房间消息窗 } from "../房间消息窗";
import type { 消息展示项 } from "../视图";
import "../房间消息窗";

const 安装消息窗直达全屏模拟 = () => {
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
  const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "requestFullscreen"
  );
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  const restore = () => {
    if (fullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (exitFullscreenDescriptor) {
      Object.defineProperty(document, "exitFullscreen", exitFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "exitFullscreen");
    }
    if (requestFullscreenDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", requestFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
  };
  return { requestFullscreen, exitFullscreen, restore };
};

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

const 创建媒体消息窗 = (
  options: {
    createVideoJsPlayerShell?: typeof 创建VideoJs播放器壳;
  } = {}
): 房间消息窗 => {
  const 全局唯一播放器 = 读取默认全局唯一播放器();
  全局唯一播放器.销毁();
  if (options.createVideoJsPlayerShell) {
    全局唯一播放器.配置壳工厂((initialSource, deps = {}) =>
      options.createVideoJsPlayerShell!(initialSource, deps)
    );
  } else {
    全局唯一播放器.配置壳工厂((initialSource, deps = {}) => {
      const video = document.createElement("video");
      const container = document.createElement("div");
      const 挂载到宿主 = (mountTarget: HTMLElement): void => {
        mountTarget.append(container);
        if (!container.contains(video)) {
          container.append(video);
        }
      };
      const 同步源 = (source = initialSource): void => {
        video.src = source.src;
        if (source.posterSrc) {
          video.poster = source.posterSrc;
        } else {
          video.removeAttribute("poster");
        }
      };
      if (deps.mountTarget) {
        挂载到宿主(deps.mountTarget);
      }
      同步源(initialSource);
      return {
        destroy() {
          video.pause();
          container.remove();
        },
        同步: 同步源,
        挂载到宿主,
        进入全屏: async () => "standard",
        读取视频元素: () => video,
        读取容器元素: () => container,
      };
    });
  }
  // 阶段 0 的保护测试共用同一条“图片 + 视频”消息，防止两条入口的 fixture 漂移。
  const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
  pane.items = [创建媒体消息项()];
  return pane;
};

const 等待时间线唯一播放器挂载 = async (
  pane: 房间消息窗,
  maxTurns = 40
): Promise<void> => {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    await pane.updateComplete;
    if (
      pane.querySelector("koko-video-skin") &&
      pane.querySelector('video.message-video-preview[data-canonical-player="true"]')
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const 驱动时间线Canonical就绪 = async (
  pane: 房间消息窗,
  attachmentId: string
): Promise<HTMLVideoElement | null> => {
  const canonicalVideo = pane.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
  );
  if (!canonicalVideo) {
    return null;
  }
  Object.defineProperty(canonicalVideo, "readyState", {
    configurable: true,
    value: 3,
  });
  canonicalVideo.dispatchEvent(new Event("loadedmetadata"));
  canonicalVideo.dispatchEvent(new Event("seeked"));
  canonicalVideo.dispatchEvent(new Event("canplay"));
  await pane.updateComplete;
  await 等待时间线唯一播放器挂载(pane);
  return pane.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
  );
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

  it("无 poster 视频已命中 runtime preview 且 playback 可用时，非 owner 必须继续显示 runtime preview overlay，而不是裸露 swarm 冷帧", async () => {
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
    const beforeOwnerPreviewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerPreviewPoster).not.toBeNull();
    expect(beforeOwnerPreviewPoster?.getAttribute("src")).toBe("blob:preview-att-video-1");

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

    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("时间线 owner 复用 canonical player 时，会把统一壳标记成 inline 消息流表面", async () => {
    const pane = 创建媒体消息窗({
      createVideoJsPlayerShell: 创建VideoJs播放器壳,
    });
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "m-inline-skin-owner-1",
        attachments: [
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
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-inline-skin-owner-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-inline-skin-owner-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    document.body.appendChild(pane);
    await 等待时间线唯一播放器挂载(pane);

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const skin = pane.querySelector<HTMLElement>("koko-video-skin");

    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.controls).toBe(false);
    expect(skin).not.toBeNull();
    expect(skin?.dataset.presentation).toBe("inline");

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

  it("同屏多个视频时，当前自动播 owner 仍只有一颗 canonical video，但在揭帘前允许保留自己的 preview overlay", async () => {
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
    const canonicalVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    const previewSurface = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );
    expect(inlineVideos).toHaveLength(1);
    expect(canonicalVideo).not.toBeNull();
    expect(previewSurface).toBeNull();
    expect(canonicalVideo?.loop).toBe(true);
    expect(canonicalVideo?.hasAttribute("disablepictureinpicture")).toBe(true);
    expect(canonicalVideo?.hasAttribute("disableremoteplayback")).toBe(true);
    expect(canonicalVideo?.getAttribute("controlslist")).toBe(
      "nodownload nofullscreen noremoteplayback"
    );
    expect(canonicalVideo?.getAttribute("tabindex")).toBe("-1");
    expect(canonicalVideo?.getAttribute("aria-hidden")).toBe("true");
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-2"]')
    ).not.toBeNull();

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
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
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
    expect(ownerVideo).not.toBe(previewVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
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
    expect(releasedVideo).not.toBe(ownerVideo);
    expect(releasedVideo?.dataset.canonicalPlayer).toBeUndefined();
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
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
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

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

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
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);

    playSpy.mockRestore();
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
    expect(afterRemountVideo).toBe(beforeRemountVideo);
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
      await 等待时间线唯一播放器挂载(pane);

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

  it("自动播时间戳在同一秒内发生自然 loop 大跳变时，也会上报新的 0.x 事实", async () => {
    const pane = 创建媒体消息窗();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_000);
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
      pane.items = [创建媒体消息项()];
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
      pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
      document.body.appendChild(pane);
      await pane.updateComplete;

      const ownerVideo = pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]'
      );
      expect(ownerVideo).not.toBeNull();

      ownerVideo!.currentTime = 58.5;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));
      expect(positionEvents).toHaveLength(1);

      nowSpy.mockReturnValue(5_200);
      ownerVideo!.currentTime = 0.35;
      ownerVideo!.dispatchEvent(new Event("timeupdate"));

      expect(positionEvents).toHaveLength(2);
      expect(positionEvents[1]?.detail.position.currentTime).toBeCloseTo(0.35, 2);
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

      expect(pauseSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(positionEvents.length).toBeGreaterThan(0);
      const releaseFlushEvent = positionEvents.at(-1);
      expect(releaseFlushEvent).toBeDefined();
      expect(releaseFlushEvent!.detail.position.currentTime).toBeCloseTo(42.5, 2);
      pauseSpy.mockRestore();
    } finally {
      nowSpy.mockRestore();
      pane.remove();
    }
  });

  it("自动播时间戳上报会优先使用模板里的 canonical src，而不是浏览器展开后的 currentSrc 绝对地址", async () => {
    const pane = 创建媒体消息窗();
    const positionEvents: Array<
      CustomEvent<{ attachmentId: string; position: 媒体播放位置 }>
    > = [];
    const autoplayPlayback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash/content-demo.mp4",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBeNull();
    Object.defineProperty(ownerVideo!, "currentSrc", {
      configurable: true,
      value: new URL(autoplayPlayback.src, window.location.href).href,
    });
    ownerVideo!.currentTime = 12.5;
    ownerVideo!.dispatchEvent(new Event("timeupdate"));

    expect(positionEvents).toHaveLength(1);
    expect(positionEvents[0]?.detail).toMatchObject({
      attachmentId: "att-video-1",
      position: {
        src: autoplayPlayback.src,
        currentTime: 12.5,
      },
    });

    pane.remove();
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
    const 就绪后的OwnerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(就绪后的OwnerVideo?.autoplay).toBe(true);

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

  it("视频已经成为自动播 owner 且 canonical 就绪后，卡片仍保留同一张暂停 preview 底板", async () => {
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

    const ownerPreviewBeforeCanonical = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(ownerPreviewBeforeCanonical).not.toBeNull();
    ownerPreviewBeforeCanonical!.dispatchEvent(new Event("loadedmetadata"));
    expect(ownerPreviewBeforeCanonical?.autoplay).toBe(false);
    expect(ownerPreviewBeforeCanonical?.currentTime).toBeCloseTo(24.5, 2);

    const canonicalVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    const ownerPreviewAfterCanonical = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 真实房间里旧 owner 退场的闪烁，根因就是 canonical 就绪后把底板 preview 整个删掉了。
     * 这里必须先锁死：owner 期间 preview 底板也要继续活着，后续退场时才能直接露出来。
     */
    expect(canonicalVideo?.dataset.canonicalPlayer).toBe("true");
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(ownerPreviewAfterCanonical).toBe(ownerPreviewBeforeCanonical);
    expect(ownerPreviewAfterCanonical?.dataset.canonicalPlayer).toBeUndefined();
    expect(ownerPreviewAfterCanonical?.autoplay).toBe(false);
    expect(ownerPreviewAfterCanonical?.currentTime).toBeCloseTo(24.5, 2);

    pane.remove();
  });

  it("双视频 owner 交接时，旧 owner 退场后会直接复用原底板 preview", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: "http://media.local/poster-video-1",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback1.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
      "att-video-2": {
        src: playback2.src,
        currentTime: 12.5,
        updatedAt: 100,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const oldOwnerPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(oldOwnerPreview).not.toBeNull();
    oldOwnerPreview!.dispatchEvent(new Event("loadedmetadata"));
    await 驱动时间线Canonical就绪(pane, "att-video-1");

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    const releasedPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 这条回归直接锁真实 root cause：
     * 1. 旧 owner 退场时不能重建 preview 节点；
     * 2. runtime snapshot 晚一拍时，也必须优先拿到本地刚 flush 的更近时间；
     * 3. 否则用户看到的就是“先闪一下新 preview，再跳回正确位置”。
     */
    expect(releasedPreview).toBe(oldOwnerPreview);
    expect(releasedPreview?.dataset.canonicalPlayer).toBeUndefined();
    expect(releasedPreview?.autoplay).toBe(false);
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("双视频 owner 交接时，会先向唯一播放器拿到最后一拍 flush，再对齐旧 owner 的 preview 底板", async () => {
    const pane = 创建媒体消息窗();
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: "http://media.local/poster-video-1",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback1.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
      "att-video-2": {
        src: playback2.src,
        currentTime: 12.5,
        updatedAt: 100,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const oldOwnerPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(oldOwnerPreview).not.toBeNull();
    oldOwnerPreview!.dispatchEvent(new Event("loadedmetadata"));
    await 驱动时间线Canonical就绪(pane, "att-video-1");

    const pane内部探针 = pane as any as {
      自动播位置上报记录: Map<
        string,
        { src: string; currentTime: number; reportedAt: number }
      >;
    };
    const 冲刷时间线位置Spy = vi
      .spyOn(全局唯一播放器, "冲刷当前时间线播放位置")
      .mockImplementation(() => {
        pane内部探针.自动播位置上报记录.set("att-video-1", {
          src: playback1.src,
          currentTime: 36.5,
          reportedAt: 200,
        });
      });

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    const releasedPreview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );

    /**
     * 这条测试直接锁 sequecing root cause：
     * 1. 如果不先 flush，旧 preview 会先按旧时间露出来；
     * 2. 然后再吃到更近位置，用户就看到“退场时抽一下”；
     * 3. 正确顺序必须是：先 flush -> 再对齐底板 -> 再撤可见 canonical host。
     */
    expect(冲刷时间线位置Spy).toHaveBeenCalledTimes(1);
    expect(releasedPreview).toBe(oldOwnerPreview);

    冲刷时间线位置Spy.mockRestore();
    pane.remove();
  });

  it("读取自动播恢复位置时，同源本地位置桥会压过慢一拍的外层 snapshot", async () => {
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
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 31.25,
        updatedAt: 100,
      },
    };

    const pane内部探针 = pane as any as {
      自动播位置上报记录: Map<
        string,
        { src: string; currentTime: number; reportedAt: number }
      >;
      读取自动播恢复位置(attachmentId: string, src: string | null): 媒体播放位置 | null;
    };
    pane内部探针.自动播位置上报记录.set("att-video-1", {
      src: playback.src,
      currentTime: 36.5,
      reportedAt: 200,
    });

    /**
     * 这条测试只锁位置桥裁决本身，不和 owner 交接副作用绑在一起：
     * - 外层 snapshot 慢一拍时；
     * - 本地刚 flush 的同源位置更近；
     * - 读取恢复位置必须优先拿本地那条。
     */
    expect(
      pane内部探针.读取自动播恢复位置("att-video-1", playback.src)?.currentTime
    ).toBeCloseTo(36.5, 2);
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

  it("有保存位置时，自动播 owner 切换前后仍保持同一条 canonical swarm src，不在绝对/相对地址之间抖动", async () => {
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
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBeNull();
    const 就绪后的OwnerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(就绪后的OwnerVideo?.autoplay).toBe(true);
    expect(ownerVideo?.getAttribute("src")).toBe(playback.src);

    pane.inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).not.toBe(ownerVideo);
    expect(releasedVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(releasedVideo?.autoplay).toBe(false);
    expect(releasedVideo?.getAttribute("src")).toBe(playback.src);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;
    await 驱动时间线Canonical就绪(pane, "att-video-1");

    const reacquiredVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    /**
     * 归位零闪烁场景允许继续复用同一个预览节点：
     * 我们真正关心的是 canonical 标记和 swarm src 不要抖动，
     * 不是“必须重建一个新 DOM 节点”。反过来说，能复用旧节点更接近真实丝滑体验。
     */
    expect(reacquiredVideo?.dataset.canonicalPlayer).toBe("true");
    expect(reacquiredVideo?.autoplay).toBe(true);
    expect(reacquiredVideo?.getAttribute("src")).toBe(playback.src);

    pane.remove();
  });

  it("双视频自动播 owner 交接时，两边都保持 canonical swarm src，不在绝对/相对地址之间互相抖动", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "/webtorrent/demo-infohash-1/content-demo-1.mp4",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "/webtorrent/demo-infohash-2/content-demo-2.mp4",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
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
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
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
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: new URL(playback1.src, window.location.href).href,
        currentTime: 11.25,
        updatedAt: Date.now(),
      },
      "att-video-2": {
        src: new URL(playback2.src, window.location.href).href,
        currentTime: 22.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const firstOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const secondPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
      )?.autoplay
    ).toBe(true);
    expect(firstOwnerVideo?.getAttribute("src")).toBe(playback1.src);
    expect(secondPreviewVideo?.autoplay).toBe(false);
    expect(secondPreviewVideo?.getAttribute("src")).toBe(playback2.src);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;
    await 驱动时间线Canonical就绪(pane, "att-video-2");

    const firstReleasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const secondOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    expect(firstReleasedVideo).not.toBe(firstOwnerVideo);
    expect(firstReleasedVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(firstReleasedVideo?.autoplay).toBe(false);
    expect(firstReleasedVideo?.getAttribute("src")).toBe(playback1.src);
    /**
     * 新 owner 这侧允许继续复用原来的预览节点，把 canonical 标记和 autoplay 直接提升上去；
     * 只要 swarm src 没抖、且最终只有一颗 canonical player，就比“先删预览再插入新节点”更丝滑。
     */
    expect(secondOwnerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(secondOwnerVideo?.autoplay).toBe(true);
    expect(secondOwnerVideo?.getAttribute("src")).toBe(playback2.src);

    pane.remove();
  });

  it("双视频自动播 owner 交接时，即便新 owner 的 autoplay playback 晚一拍回灌，也不会先删除目标卡片自己的预览帧", async () => {
    const pane = 创建媒体消息窗();
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    const 同步时间线自动播Spy = vi.spyOn(全局唯一播放器, "同步时间线自动播");
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
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
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
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
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-2": {
        src: playback2.src,
        currentTime: 22.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 切换前预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    expect(切换前预览视频).not.toBeNull();
    切换前预览视频!.dispatchEvent(new Event("loadedmetadata"));
    expect(切换前预览视频?.currentTime).toBeCloseTo(22.5, 2);

    同步时间线自动播Spy.mockClear();
    /**
     * 真实闪烁链就是这里：
     * 1. 旧 owner 已经退场；
     * 2. 新 owner 的 autoplay playback 结果还没回灌；
     * 3. 但它其实已经有同文件 swarm 预览源，不该先把唯一播放器打成 null。
     */
    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    const 交接调用序列 = 同步时间线自动播Spy.mock.calls.map(([input]) =>
      input ? input.attachmentId : null
    );
    const 新Owner可见宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-2"]'
    );
    const 新Owner隐藏预热宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
    );
    const 新Owner预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );
    const 新Owner播放指示器 = pane.querySelector(
      '.message-video-card[data-attachment-id="att-video-2"] .message-video-play-indicator'
    );

    expect(交接调用序列).not.toContain(null);
    expect(交接调用序列.at(-1)).toBe("att-video-2");
    expect(新Owner可见宿主).toBeNull();
    expect(新Owner隐藏预热宿主).not.toBeNull();
    expect(新Owner隐藏预热宿主?.dataset.videoSrc).toBe(playback2.src);
    expect(新Owner隐藏预热宿主?.dataset.stageHost).toBe("true");
    expect(新Owner预览视频).toBe(切换前预览视频);
    expect(新Owner预览视频?.autoplay).toBe(false);
    expect(新Owner预览视频?.getAttribute("src")).toBe(playback2.src);
    expect(新Owner预览视频?.currentTime).toBeCloseTo(22.5, 2);
    expect(新Owner播放指示器).toBeNull();

    pane.remove();
  });

  it("双视频自动播 owner 交接时，如果目标卡片的预览真相仍是 missing_source，就禁止拿冷 playback video 当隐藏接管 cover", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
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
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<string, { phase: "missing_source" }>;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-2": { phase: "missing_source" },
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-2"]')
    ).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-2"]')
    ).not.toBeNull();
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
      )
    ).toBeNull();

    pane.remove();
  });

  it("missing_source 卡片即使保留了历史续播位置，也禁止把它泄漏成通用 preview 底板", async () => {
    const pane = 创建媒体消息窗();
    const playback = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: null,
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
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
      "att-video-1": playback,
    };
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<string, { phase: "missing_source" }>;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": { phase: "missing_source" },
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: playback.src,
        currentTime: 18.6,
        updatedAt: 1_715_000_000_000,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
      )
    ).toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.remove();
  });

  it("双视频自动播 owner 交接时，只要目标卡片已经有同源预览视频，也必须先走隐藏预热宿主而不是直接显露 canonical host", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-1",
            posterSrc: "http://media.local/poster-video-1",
          },
        ],
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 720,
            height: 1280,
            displayWidth: 180,
            displayHeight: 320,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 切换前预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    expect(切换前预览视频).not.toBeNull();
    expect(切换前预览视频?.dataset.canonicalPlayer).toBeUndefined();
    expect(切换前预览视频?.getAttribute("src")).toBe(playback2.src);
    Object.defineProperty(切换前预览视频!, "readyState", {
      configurable: true,
      value: 2,
    });

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;

    /**
     * 真实房间里很多切换目标卡片没有保存续播点，但已经有同源 preview `<video>`。
     * 如果这里仍然直接显露 canonical host，唯一播放器就会在用户眼前现场 loadstart/seeking。
     */
    expect(
      pane.querySelector(
        '.message-video-canonical-host[data-attachment-id="att-video-2"]'
      )
    ).toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).not.toBeNull();
    expect(
      pane.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
      )
    ).toBe(切换前预览视频);

    pane.remove();
  });

  it("双视频自动播 owner 再次切回旧附件时，禁止复用上一次遗留的可见接管就绪缓存", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
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
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 720,
            height: 1280,
            displayWidth: 320,
            displayHeight: 569,
            originalSrc: "http://media.local/original-video-2",
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 切换前预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]'
    );
    expect(切换前预览视频).not.toBeNull();
    Object.defineProperty(切换前预览视频!, "readyState", {
      configurable: true,
      value: 2,
    });

    const 旧附件残留就绪源 = new URL(playback2.src, window.location.href).href;
    const pane内部探针 = pane as any as {
      时间线唯一播放器可见接管就绪源: Map<string, string>;
    };
    pane内部探针.时间线唯一播放器可见接管就绪源.set(
      "att-video-2",
      旧附件残留就绪源
    );

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": playback2,
    };
    await pane.updateComplete;

    /**
     * 真实房间里同一条附件会多次进出 owner。
     * reveal gate 只能认“这一次 handoff 刚刚确认就绪”的事实，
     * 绝不能拿上一轮遗留缓存直接显露 canonical host。
     */
    expect(
      pane.querySelector(
        '.message-video-canonical-host[data-attachment-id="att-video-2"]'
      )
    ).toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).not.toBeNull();

    pane.remove();
  });

  it("双视频自动播 owner 交接时，会等 canonical 在隐藏预热宿主上就绪后才揭帘到新卡片", async () => {
    const pane = 创建媒体消息窗();
    const playback1 = {
      mode: "swarm",
      attachmentId: "att-video-1",
      kind: "video",
      src: "http://media.local/swarm-video-1",
      thumbnailUrl: "http://media.local/poster-video-1",
      hint: null,
    } satisfies 媒体播放结果;
    const playback2 = {
      mode: "swarm",
      attachmentId: "att-video-2",
      kind: "video",
      src: "http://media.local/swarm-video-2",
      thumbnailUrl: "http://media.local/poster-video-2",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
        attachments: [
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
      },
      {
        ...创建媒体消息项(),
        id: "message-video-2",
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
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": playback1,
      "att-video-2": playback2,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback1,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-2": {
        src: playback2.src,
        currentTime: 22.5,
        updatedAt: Date.now(),
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 隐藏预热视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    expect(隐藏预热视频).not.toBeNull();

    Object.defineProperty(隐藏预热视频!, "readyState", {
      configurable: true,
      value: 1,
    });
    隐藏预热视频!.dispatchEvent(new Event("loadedmetadata"));
    隐藏预热视频!.dispatchEvent(new Event("seeked"));
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-2"]')
    ).toBeNull();
    expect(
      pane.querySelector(
        '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
      )
    ).not.toBeNull();

    Object.defineProperty(隐藏预热视频!, "readyState", {
      configurable: true,
      value: 3,
    });
    隐藏预热视频!.dispatchEvent(new Event("canplay"));
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const 揭帘后可见宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-host[data-attachment-id="att-video-2"]'
    );
    const 揭帘后隐藏预热宿主 = pane.querySelector<HTMLElement>(
      '.message-video-canonical-stage-host[data-attachment-id="att-video-2"]'
    );
    const 揭帘后Canonical视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    const 揭帘后预览视频 = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );

    expect(揭帘后可见宿主).not.toBeNull();
    expect(揭帘后隐藏预热宿主).toBeNull();
    expect(揭帘后Canonical视频).toBe(隐藏预热视频);
    expect(揭帘后Canonical视频?.autoplay).toBe(true);
    expect(揭帘后Canonical视频?.currentTime).toBeCloseTo(22.5, 2);
    expect(揭帘后预览视频).not.toBeNull();
    expect(揭帘后预览视频?.autoplay).toBe(false);

    pane.remove();
  });

  it("有 poster 的 swarm 视频在未成为 owner 前继续显示 poster overlay，不裸露 playback.src 冷帧", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe(playback.src);
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1");

    pane.remove();
  });

  it("有 poster 的 swarm 视频成为 owner 前后，会先保留 poster 直到 canonical ready", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;

    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("poster")).toBeNull();
    expect(ownerVideo?.autoplay).toBe(true);
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("有 poster 的 swarm 视频进入自动播预热窗口时，会把同一颗 video 提前提升到 auto preload", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const trigger = pane.querySelector<HTMLButtonElement>(
      'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
    );
    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(trigger).not.toBeNull();
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.preload).toBe("metadata");

    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_METADATA,
    });
    Object.defineProperty(previewVideo!, "networkState", {
      configurable: true,
      value: HTMLMediaElement.NETWORK_IDLE,
    });
    const loadSpy = vi.spyOn(previewVideo!, "load").mockImplementation(() => {});

    (
      pane as unknown as {
        预热时间线视频首帧(button: HTMLButtonElement, attachmentId: string): void;
      }
    ).预热时间线视频首帧(trigger!, "att-video-1");

    expect(previewVideo?.preload).toBe("auto");
    expect(loadSpy).toHaveBeenCalledTimes(1);

    loadSpy.mockRestore();
    pane.remove();
  });

  it("有 poster 的 swarm 视频首帧事件回抛 currentSrc 绝对地址时，也能识别为同源并移除 poster", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("poster")).toBe("http://media.local/poster-video-1");

    Object.defineProperty(previewVideo!, "currentSrc", {
      configurable: true,
      value: new URL(playback.src, window.location.href).href,
    });
    previewVideo!.dispatchEvent(new Event("loadeddata"));
    await pane.updateComplete;

    const readyPreviewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(readyPreviewVideo?.getAttribute("poster")).toBeNull();

    pane.remove();
  });

  it("有 poster 的 swarm 视频从预览切到自动播时复用同一颗 video 节点", async () => {
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

    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.autoplay).toBe(false);

    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    await pane.updateComplete;

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBe(previewVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

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
      (
        pane as unknown as {
          清理自动播候选观察(): void;
          同步自动播候选观察(scrollContainer: HTMLElement): void;
          调度自动播候选(scrollContainer: HTMLElement): void;
        }
      ).调度自动播候选(scrollContainer!);

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

  it("房间首轮更新时，近视口预热候选会立即派发，而不是再额外等一帧 rAF", async () => {
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

      expect(observedDetails).toEqual([
        {
          candidates: [
            {
              attachmentId: "att-video-1",
              visibilityRatio: 0,
              distanceToViewportCenter: 710,
            },
          ],
        },
      ]);
      expect(rafCallbacks.size).toBe(0);
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
      ).toHaveLength(2);
      expect(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
        )
      ).not.toBeNull();
      expect(
        pane.querySelector(
          'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
        )
      ).not.toBeNull();
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

  it("点击非自动播 owner 视频时，仍然继续走查看器冷开请求", async () => {
    const { requestFullscreen, restore } = 安装消息窗直达全屏模拟();
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
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.inlineAutoplayOwnerAttachmentId = null;
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    try {
      document.body.appendChild(pane);
      await pane.updateComplete;

      pane
        .querySelector<HTMLButtonElement>(
          'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
        )
        ?.click();
      await pane.updateComplete;

      expect(requestFullscreen).toHaveBeenCalledTimes(0);
      expect(details).toHaveLength(1);
      expect(details[0]?.startAttachmentId).toBe("att-video-1");
    } finally {
      pane.remove();
      restore();
    }
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
