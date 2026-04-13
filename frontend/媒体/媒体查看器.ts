import type { 媒体资产分发表面 } from "../契约.js";
import type { 媒体会话信号 } from "./媒体会话.js";

export type 媒体查看器项目 =
  | {
      kind: "image";
      attachmentId: string;
      src: string;
      alt: string;
      width: number;
      height: number;
    }
  | {
      kind: "video";
      attachmentId: string;
      src: string;
      posterSrc: string | null;
      streamingDistribution?: 媒体资产分发表面 | null;
      width: number;
      height: number;
    };

export type 媒体查看器打开请求 = {
  startAttachmentId: string;
  items: 媒体查看器项目[];
};

type 媒体查看器视频项目 = Extract<媒体查看器项目, { kind: "video" }>;
type 媒体查看器图片项目 = Extract<媒体查看器项目, { kind: "image" }>;

type PhotoSwipe数据源项目 = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

type PhotoSwipe查看器选项 = {
  dataSource: PhotoSwipe数据源项目[];
  pswpModule?: () => Promise<unknown>;
  bgOpacity: number;
  loop: boolean;
  wheelToZoom: boolean;
  closeOnVerticalDrag: boolean;
  showHideAnimationType: "zoom" | "fade" | "none";
};

type 媒体查看器实例 = {
  init?(): void;
  loadAndOpen?(index: number): boolean | void;
  同步?(item: 媒体查看器项目): void;
  destroy(): void;
  on?(eventName: "close" | "destroy", callback: () => void): void;
};

type 媒体查看器工厂结果 = 媒体查看器实例 | Promise<媒体查看器实例>;
type 媒体查看器运行时钩子 = {
  发出媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
};
type PhotoSwipe查看器工厂 = (options: PhotoSwipe查看器选项) => 媒体查看器工厂结果;
type Vidstack视频覆盖层工厂 = (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子
) => 媒体查看器工厂结果;

type VidstackHlsProvider详情 = {
  type?: string;
  library?: unknown;
  config?: Record<string, unknown>;
};

export type 媒体查看器依赖 = {
  createPhotoSwipeLightbox?: PhotoSwipe查看器工厂;
  createVidstackVideoOverlay?: Vidstack视频覆盖层工厂;
  isMobileViewport?: () => boolean;
  openNativeVideoFullscreen?: (
    item: 媒体查看器视频项目,
    lifecycle: 媒体查看器视口占用生命周期,
    hooks: 媒体查看器运行时钩子
  ) => boolean | 媒体查看器实例;
  onMediaSessionSignal?: (attachmentId: string, signal: 媒体会话信号) => void;
  onViewportCaptureStart?: () => void;
  onViewportCaptureEnd?: () => void;
};

type 媒体查看器视口占用生命周期 = {
  开始视口占用(): void;
  结束视口占用(): void;
};

type PhotoSwipeLightbox构造器 = new (
  options: PhotoSwipe查看器选项
) => 媒体查看器实例;

const 映射PhotoSwipe图片 = (item: 媒体查看器图片项目): PhotoSwipe数据源项目 => ({
  src: item.src,
  width: Math.max(1, item.width),
  height: Math.max(1, item.height),
  alt: item.alt,
});

const 创建默认PhotoSwipeLightbox: PhotoSwipe查看器工厂 = async (options) => {
  const module = await import("photoswipe/lightbox");
  const Lightbox = module.default as unknown as PhotoSwipeLightbox构造器;
  return new Lightbox(options);
};

const 构造Vidstack流媒体P2P配置 = (
  distribution: 媒体资产分发表面 | null | undefined
): Record<string, unknown> | null => {
  if (!distribution) {
    return null;
  }
  return {
    p2p: {
      core: {
        swarmId: distribution.swarm_id,
        announceTrackers: distribution.announce_urls,
      },
    },
  };
};

const 是异步媒体查看器结果 = (
  result: 媒体查看器工厂结果
): result is Promise<媒体查看器实例> =>
  typeof (result as Promise<媒体查看器实例>).then === "function";

type 可原生全屏视频元素 = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type 可原生全屏容器元素 = HTMLDivElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};
type 媒体方向锁 = "portrait" | "landscape";
type 可锁定屏幕方向 = ScreenOrientation & {
  lock?: (orientation: 媒体方向锁) => Promise<void>;
  unlock?: () => void;
};

const 媒体全屏历史键 = "__kokoMediaFullscreenSession";

const 是移动触屏视口 = (): boolean => {
  const hasCoarsePointer = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchPoints = globalThis.navigator?.maxTouchPoints ?? 0;
  return hasCoarsePointer || touchPoints > 0;
};

const 读取宽高方向锁 = (width: number, height: number): 媒体方向锁 | null => {
  if (height > width) {
    return "portrait";
  }
  if (width > height) {
    return "landscape";
  }
  return null;
};

const 读取视频方向锁 = (item: 媒体查看器视频项目): 媒体方向锁 | null =>
  读取宽高方向锁(item.width, item.height);

const 读取视频元素方向锁 = (video: HTMLVideoElement): 媒体方向锁 | null => {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }
  return 读取宽高方向锁(video.videoWidth, video.videoHeight);
};

const 读取屏幕方向 = (): 可锁定屏幕方向 | null =>
  (globalThis.screen?.orientation as 可锁定屏幕方向 | undefined) ?? null;

const 绑定媒体运行时信号 = (
  target: EventTarget,
  attachmentId: string,
  hooks: 媒体查看器运行时钩子
): (() => void) => {
  const listeners: Array<[string, EventListener]> = [
    [
      "playing",
      () => {
        hooks.发出媒体会话信号(attachmentId, { type: "PLAYER_PLAYING" });
      },
    ],
    [
      "waiting",
      () => {
        hooks.发出媒体会话信号(attachmentId, { type: "PLAYER_WAITING" });
      },
    ],
    [
      "stalled",
      () => {
        hooks.发出媒体会话信号(attachmentId, { type: "PLAYER_STALLED" });
      },
    ],
    [
      "error",
      () => {
        hooks.发出媒体会话信号(attachmentId, { type: "PLAYER_ERROR" });
      },
    ],
  ];
  for (const [eventName, listener] of listeners) {
    target.addEventListener(eventName, listener);
  }
  return () => {
    for (const [eventName, listener] of listeners) {
      target.removeEventListener(eventName, listener);
    }
  };
};

const 打开原生视频全屏 = (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子
): boolean | 媒体查看器实例 => {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const sessionId = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let videoOrientation = 读取视频方向锁(item);
  const container = document.createElement("div") as 可原生全屏容器元素;
  const video = document.createElement("video") as 可原生全屏视频元素;
  container.dataset.videoOrientation = videoOrientation ?? "natural";
  container.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;background:#000;display:grid;place-items:center;z-index:2147483647;";
  video.src = item.src;
  video.controls = true;
  video.autoplay = true;
  video.preload = "metadata";
  video.playsInline = true;
  // 这个元素会被浏览器放进原生全屏层，不能藏成 1px，否则回退路径会出现黑屏/假全屏。
  video.style.cssText =
    "width:100vw;height:100vh;background:#000;object-fit:contain;";
  if (item.posterSrc) {
    video.poster = item.posterSrc;
  }

  let cleaned = false;
  let historyPushed = false;
  let historyConsumedByUser = false;
  let historyCleanupInProgress = false;
  let historyCleanupTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const 解绑媒体运行时信号 = 绑定媒体运行时信号(video, item.attachmentId, hooks);

  const lockScreenOrientation = (): void => {
    if (!videoOrientation) {
      return;
    }
    const screenOrientation = 读取屏幕方向();
    try {
      void screenOrientation?.lock?.(videoOrientation).catch(() => undefined);
    } catch {
      // 方向锁是体验增强，浏览器拒绝时不能影响 WebTorrent 视频播放主路径。
    }
  };
  const unlockScreenOrientation = (): void => {
    try {
      读取屏幕方向()?.unlock?.();
    } catch {
      // 忽略不支持 unlock 的浏览器差异，退出全屏清理仍继续执行。
    }
  };
  const removePopStateListener = (): void => {
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", handlePopState);
    }
  };
  const closeFullscreen = (): void => {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(cleanup);
      return;
    }
    cleanup();
  };
  const handlePopState = (): void => {
    if (historyCleanupInProgress) {
      historyCleanupInProgress = false;
      removePopStateListener();
      return;
    }
    historyConsumedByUser = true;
    closeFullscreen();
  };
  const handleFullscreenChange = (): void => {
    if (!document.fullscreenElement) {
      cleanup();
    }
  };
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (historyCleanupTimer) {
      globalThis.clearTimeout(historyCleanupTimer);
      historyCleanupTimer = null;
    }
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    video.removeEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
    解绑媒体运行时信号();
    unlockScreenOrientation();
    video.pause();
    container.remove();
    if (
      historyPushed &&
      !historyConsumedByUser &&
      typeof history !== "undefined" &&
      typeof history.back === "function" &&
      (history.state as Record<string, unknown> | null)?.[媒体全屏历史键] === sessionId
    ) {
      historyCleanupInProgress = true;
      history.back();
      historyCleanupTimer = globalThis.setTimeout(removePopStateListener, 0);
      return;
    }
    removePopStateListener();
    lifecycle.结束视口占用();
  };
  const startPlayback = (): void => {
    void video.play().catch(() => undefined);
  };
  const syncOrientationFromVideoMetadata = (): void => {
    const metadataOrientation = 读取视频元素方向锁(video);
    if (!metadataOrientation || metadataOrientation === videoOrientation) {
      return;
    }
    // 已发出的旧附件可能只保存了编码宽高；播放元数据读到展示宽高后，以展示方向为准。
    videoOrientation = metadataOrientation;
    container.dataset.videoOrientation = metadataOrientation;
    lockScreenOrientation();
  };
  const pushMediaHistoryEntry = (): void => {
    if (
      typeof window === "undefined" ||
      typeof history === "undefined" ||
      typeof history.pushState !== "function"
    ) {
      return;
    }
    try {
      const currentState =
        history.state && typeof history.state === "object" ? history.state : {};
      history.pushState(
        { ...currentState, [媒体全屏历史键]: sessionId },
        "",
        window.location.href
      );
      historyPushed = true;
      window.addEventListener("popstate", handlePopState);
    } catch {
      // History 入口只是让手机返回键更像 App；失败时仍保留系统全屏退出路径。
    }
  };

  video.addEventListener("ended", cleanup, { once: true });
  video.addEventListener("webkitendfullscreen", cleanup, { once: true });
  video.addEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  container.append(video);
  document.body.append(container);
  pushMediaHistoryEntry();
  lifecycle.开始视口占用();

  if (typeof container.requestFullscreen === "function") {
    startPlayback();
    void container
      .requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        lockScreenOrientation();
        startPlayback();
      })
      .catch(() => {
        if (typeof video.webkitEnterFullscreen === "function") {
          lockScreenOrientation();
          startPlayback();
          video.webkitEnterFullscreen();
          return;
        }
        cleanup();
      });
    return {
      destroy: cleanup,
      同步(nextItem) {
        if (nextItem.kind !== "video") {
          return;
        }
        if (video.src !== nextItem.src) {
          video.src = nextItem.src;
          startPlayback();
        }
        video.poster = nextItem.posterSrc ?? "";
      },
    };
  }
  if (typeof video.webkitEnterFullscreen === "function") {
    lockScreenOrientation();
    startPlayback();
    video.webkitEnterFullscreen();
    return {
      destroy: cleanup,
      同步(nextItem) {
        if (nextItem.kind !== "video") {
          return;
        }
        if (video.src !== nextItem.src) {
          video.src = nextItem.src;
          startPlayback();
        }
        video.poster = nextItem.posterSrc ?? "";
      },
    };
  }

  cleanup();
  return false;
};

const 读取Vidstack纵横比 = (item: 媒体查看器视频项目): string =>
  `${Math.max(1, item.width)}/${Math.max(1, item.height)}`;

const 是Hls主清单地址 = (src: string): boolean => /\.m3u8(?:$|\?)/.test(src);

const 创建默认Vidstack视频覆盖层: Vidstack视频覆盖层工厂 = async (
  item,
  lifecycle,
  hooks
) => {
  const { defineCustomElements } = await import("vidstack/elements");
  await defineCustomElements();
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法打开 Vidstack 媒体层");
  }

  const overlay = document.createElement("div");
  const player = document.createElement("media-player");
  const outlet = document.createElement("media-outlet");
  const skin = document.createElement("media-community-skin");
  const closeButton = document.createElement("button");
  let cleaned = false;
  const 解绑媒体运行时信号 = 绑定媒体运行时信号(player, item.attachmentId, hooks);
  const 绑定HlsProvider到本地依赖 = (event: Event): void => {
    const provider = (event as CustomEvent<VidstackHlsProvider详情>).detail;
    if (provider?.type !== "hls") {
      return;
    }
    const p2pConfig = 构造Vidstack流媒体P2P配置(item.streamingDistribution);
    if (p2pConfig) {
      provider.config = {
        ...(provider.config ?? {}),
        ...p2pConfig,
      };
    }
    // Vidstack 官方建议本地集成时显式把 provider.library 指到本地 `hls.js` 依赖，
    // 这里进一步把 Hls.js 升级成带 P2P mixin 的构造器，让主播放链直接站到成熟分片级 P2P 轮子上。
    provider.library = async () => {
      const [{ default: Hls }, p2pModule] = await Promise.all([
        import("hls.js"),
        import("p2p-media-loader-hlsjs"),
      ]);
      const { HlsJsP2PEngine } = p2pModule as unknown as {
        HlsJsP2PEngine: { injectMixin(hls: typeof Hls): unknown };
      };
      return p2pConfig ? HlsJsP2PEngine.injectMixin(Hls) : Hls;
    };
  };

  overlay.dataset.mediaViewerMode = "video";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "视频查看器");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:20px;";

  player.setAttribute("src", item.src);
  player.setAttribute("load", "eager");
  player.setAttribute("autoplay", "");
  player.setAttribute("aspect-ratio", 读取Vidstack纵横比(item));
  player.setAttribute("data-media-viewer-player", "video");
  player.addEventListener("provider-change", 绑定HlsProvider到本地依赖 as EventListener);
  player.style.cssText =
    "width:min(100%,1120px);max-height:calc(100vh - 40px);--media-max-height:calc(100vh - 40px);";
  if (item.posterSrc) {
    player.setAttribute("poster", item.posterSrc);
  }

  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.setAttribute("aria-label", "关闭视频查看器");
  closeButton.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:1;border:1px solid rgb(255 255 255 / 0.35);border-radius:8px;background:rgb(0 0 0 / 0.7);color:white;padding:8px 12px;font:inherit;";

  // Vidstack 只负责桌面视频播放能力；关闭、Esc 和外层点击仍然由应用壳层掌握，
  // 避免播放器组件反向拥有聊天视口的滚动真相。
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    closeButton.removeEventListener("click", cleanup);
    overlay.removeEventListener("click", closeWhenClickingBackdrop);
    document.removeEventListener("keydown", closeWhenPressingEscape);
    player.removeEventListener(
      "provider-change",
      绑定HlsProvider到本地依赖 as EventListener
    );
    解绑媒体运行时信号();
    overlay.remove();
    lifecycle.结束视口占用();
  };
  const closeWhenClickingBackdrop = (event: MouseEvent): void => {
    if (event.target === overlay) {
      cleanup();
    }
  };
  const closeWhenPressingEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      cleanup();
    }
  };

  player.append(outlet, skin);
  overlay.append(player, closeButton);
  closeButton.addEventListener("click", cleanup);
  overlay.addEventListener("click", closeWhenClickingBackdrop);
  document.addEventListener("keydown", closeWhenPressingEscape);
  document.body.append(overlay);
  closeButton.focus();

  return {
    同步(nextItem) {
      if (nextItem.kind !== "video") {
        return;
      }
      player.setAttribute("src", nextItem.src);
      player.setAttribute("aspect-ratio", 读取Vidstack纵横比(nextItem));
      if (nextItem.posterSrc) {
        player.setAttribute("poster", nextItem.posterSrc);
      } else {
        player.removeAttribute("poster");
      }
    },
    destroy: cleanup,
  };
};

export function 创建媒体查看器(deps: 媒体查看器依赖 = {}) {
  const createPhotoSwipeLightbox =
    deps.createPhotoSwipeLightbox ?? 创建默认PhotoSwipeLightbox;
  const createVidstackVideoOverlay =
    deps.createVidstackVideoOverlay ?? 创建默认Vidstack视频覆盖层;
  const isMobileViewport = deps.isMobileViewport ?? 是移动触屏视口;
  const openNativeVideoFullscreen = deps.openNativeVideoFullscreen ?? 打开原生视频全屏;
  const 运行时钩子: 媒体查看器运行时钩子 = {
    发出媒体会话信号: (attachmentId, signal) => {
      deps.onMediaSessionSignal?.(attachmentId, signal);
    },
  };
  let current: 媒体查看器实例 | null = null;
  let openGeneration = 0;
  let 正在占用聊天视口 = false;
  let 当前起点附件标识: string | null = null;
  let 当前查看器请求: 媒体查看器打开请求 | null = null;

  const 视口占用生命周期: 媒体查看器视口占用生命周期 = {
    开始视口占用: () => {
      if (正在占用聊天视口) {
        return;
      }
      正在占用聊天视口 = true;
      deps.onViewportCaptureStart?.();
    },
    结束视口占用: () => {
      if (!正在占用聊天视口) {
        return;
      }
      正在占用聊天视口 = false;
      deps.onViewportCaptureEnd?.();
    },
  };

  const 接管当前查看器 = (
    generation: number,
    result: 媒体查看器工厂结果
  ): void => {
    void (async () => {
      const next = 是异步媒体查看器结果(result) ? await result : result;
      if (generation !== openGeneration) {
        next.destroy();
        视口占用生命周期.结束视口占用();
        return;
      }
      current = next;
    })().catch((error: unknown) => {
      视口占用生命周期.结束视口占用();
      console.error("打开媒体查看器失败", error);
    });
  };

  const 打开 = (request: 媒体查看器打开请求): void => {
    当前查看器请求 = request;
    当前起点附件标识 = request.startAttachmentId;
    const startAt = request.items.findIndex(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (startAt < 0) {
      return;
    }
  const startItem = request.items[startAt];
  if (!startItem) {
    return;
  }
  if (
    startItem?.kind === "video" &&
    isMobileViewport() &&
    !是Hls主清单地址(startItem.src)
  ) {
      const nativeViewer = openNativeVideoFullscreen(
        startItem,
        视口占用生命周期,
        运行时钩子
      );
      if (!nativeViewer) {
        // 移动端全屏路径不可用时，才回退到桌面 overlay；不能先占用一次再重复创建。
      } else {
        if (typeof nativeViewer === "object" && "destroy" in nativeViewer) {
          current = nativeViewer;
        }
        return;
      }
    }
    const generation = ++openGeneration;
    current?.destroy();
    current = null;
    视口占用生命周期.开始视口占用();

    if (startItem.kind === "image") {
      const imageEntries = request.items
        .filter((item): item is 媒体查看器图片项目 => item.kind === "image")
        .map((item) => ({
          attachmentId: item.attachmentId,
          data: 映射PhotoSwipe图片(item),
        }));
      const imageStartAt = imageEntries.findIndex(
        (entry) => entry.attachmentId === startItem.attachmentId
      );
      if (imageStartAt < 0) {
        视口占用生命周期.结束视口占用();
        return;
      }
      接管当前查看器(
        generation,
        (async () => {
          const photoSwipe = createPhotoSwipeLightbox({
            dataSource: imageEntries.map((entry) => entry.data),
            pswpModule: () => import("photoswipe"),
            bgOpacity: 0.92,
            loop: false,
            wheelToZoom: true,
            closeOnVerticalDrag: true,
            showHideAnimationType: "zoom",
          });
          const lightbox = 是异步媒体查看器结果(photoSwipe)
            ? await photoSwipe
            : photoSwipe;
          const releaseViewport = (): void => {
            视口占用生命周期.结束视口占用();
          };
          lightbox.on?.("close", releaseViewport);
          lightbox.on?.("destroy", releaseViewport);
          lightbox.init?.();
          if (lightbox.loadAndOpen?.(imageStartAt) === false) {
            lightbox.destroy();
            releaseViewport();
          }
          return lightbox;
        })()
      );
      return;
    }

    接管当前查看器(
      generation,
      (async () => {
        const overlay = createVidstackVideoOverlay(startItem, 视口占用生命周期, 运行时钩子);
        const videoOverlay = 是异步媒体查看器结果(overlay) ? await overlay : overlay;
        videoOverlay.on?.("close", () => {
          视口占用生命周期.结束视口占用();
        });
        videoOverlay.on?.("destroy", () => {
          视口占用生命周期.结束视口占用();
        });
        return videoOverlay;
      })()
    );
  };

  const 同步 = (request: 媒体查看器打开请求): void => {
    当前查看器请求 = request;
    const currentAttachmentId = 当前起点附件标识;
    if (!currentAttachmentId) {
      return;
    }
    const activeItem = request.items.find((item) => item.attachmentId === currentAttachmentId);
    if (!activeItem) {
      return;
    }
    current?.同步?.(activeItem);
  };

  const 销毁 = (): void => {
    openGeneration += 1;
    current?.destroy();
    current = null;
    当前起点附件标识 = null;
    当前查看器请求 = null;
    视口占用生命周期.结束视口占用();
  };

  return {
    打开,
    同步,
    销毁,
  };
}
