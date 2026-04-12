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
      width: number;
      height: number;
    };

export type 媒体查看器打开请求 = {
  startAttachmentId: string;
  items: 媒体查看器项目[];
};

type 媒体查看器视频项目 = Extract<媒体查看器项目, { kind: "video" }>;

type GLightbox元素 = {
  href: string;
  type: "image" | "video";
  alt?: string;
  source?: "local";
  width: string;
  height: string;
  poster?: string;
};

type GLightbox选项 = {
  selector: null;
  elements: GLightbox元素[];
  touchNavigation: boolean;
  keyboardNavigation: boolean;
  closeOnOutsideClick: boolean;
  autoplayVideos: boolean;
  autofocusVideos: boolean;
  loop: boolean;
  zoomable: boolean;
  draggable: boolean;
  videosWidth: string;
  plyr: {
    config: {
      ratio: string;
      fullscreen: {
        enabled: boolean;
        iosNative: boolean;
      };
    };
  };
};

type GLightbox实例 = {
  openAt(index?: number): void;
  destroy(): void;
};

type GLightbox工厂结果 = GLightbox实例 | Promise<GLightbox实例>;
type GLightbox工厂 = (options: GLightbox选项) => GLightbox工厂结果;

export type 媒体查看器依赖 = {
  createLightbox?: GLightbox工厂;
  isMobileViewport?: () => boolean;
  openNativeVideoFullscreen?: (item: 媒体查看器视频项目) => boolean;
};

const 映射GLightbox元素 = (item: 媒体查看器项目): GLightbox元素 => {
  const base = {
    href: item.src,
    width: `${item.width}px`,
    height: `${item.height}px`,
  };
  if (item.kind === "image") {
    return {
      ...base,
      type: "image",
      alt: item.alt,
    };
  }
  return {
    ...base,
    type: "video",
    source: "local",
    ...(item.posterSrc ? { poster: item.posterSrc } : {}),
  };
};

const 创建默认Lightbox: GLightbox工厂 = async (options) => {
  const module = await import("glightbox");
  const factory = ((module as { default?: unknown }).default ?? module) as GLightbox工厂;
  return factory(options);
};

const 是异步Lightbox结果 = (result: GLightbox工厂结果): result is Promise<GLightbox实例> =>
  typeof (result as Promise<GLightbox实例>).then === "function";

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

const 读取视频方向锁 = (item: 媒体查看器视频项目): 媒体方向锁 | null => {
  if (item.height > item.width) {
    return "portrait";
  }
  if (item.width > item.height) {
    return "landscape";
  }
  return null;
};

const 读取屏幕方向 = (): 可锁定屏幕方向 | null =>
  (globalThis.screen?.orientation as 可锁定屏幕方向 | undefined) ?? null;

const 打开原生视频全屏 = (item: 媒体查看器视频项目): boolean => {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const sessionId = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const videoOrientation = 读取视频方向锁(item);
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
  };
  const startPlayback = (): void => {
    void video.play().catch(() => undefined);
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
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  container.append(video);
  document.body.append(container);
  pushMediaHistoryEntry();

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
    return true;
  }
  if (typeof video.webkitEnterFullscreen === "function") {
    lockScreenOrientation();
    startPlayback();
    video.webkitEnterFullscreen();
    return true;
  }

  cleanup();
  return false;
};

const 读取起始视频比例 = (item: 媒体查看器项目): string =>
  item.kind === "video" ? `${Math.max(1, item.width)}:${Math.max(1, item.height)}` : "16:9";

export function 创建媒体查看器(deps: 媒体查看器依赖 = {}) {
  const createLightbox = deps.createLightbox ?? 创建默认Lightbox;
  const isMobileViewport = deps.isMobileViewport ?? 是移动触屏视口;
  const openNativeVideoFullscreen = deps.openNativeVideoFullscreen ?? 打开原生视频全屏;
  let current: GLightbox实例 | null = null;
  let openGeneration = 0;

  const 打开 = (request: 媒体查看器打开请求): void => {
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
    if (startItem?.kind === "video" && isMobileViewport() && openNativeVideoFullscreen(startItem)) {
      return;
    }
    const generation = ++openGeneration;
    current?.destroy();
    current = null;
    void (async () => {
      const next = createLightbox({
        selector: null,
        elements: request.items.map(映射GLightbox元素),
        touchNavigation: true,
        keyboardNavigation: true,
        closeOnOutsideClick: true,
        autoplayVideos: true,
        autofocusVideos: false,
        loop: false,
        zoomable: true,
        draggable: true,
        videosWidth: "min(100vw, 960px)",
        plyr: {
          config: {
            ratio: 读取起始视频比例(startItem),
            fullscreen: {
              enabled: true,
              iosNative: true,
            },
          },
        },
      });
      const lightbox = 是异步Lightbox结果(next) ? await next : next;
      if (generation !== openGeneration) {
        lightbox.destroy();
        return;
      }
      current = lightbox;
      current.openAt(startAt);
    })().catch((error: unknown) => {
      console.error("打开媒体查看器失败", error);
    });
  };

  const 销毁 = (): void => {
    openGeneration += 1;
    current?.destroy();
    current = null;
  };

  return {
    打开,
    销毁,
  };
}
