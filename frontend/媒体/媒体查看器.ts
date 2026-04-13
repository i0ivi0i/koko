import type { 媒体资产分发表面 } from "../契约.js";
import type { 媒体会话信号 } from "./媒体会话.js";

export type 媒体查看器项目 =
  | {
      kind: "image";
      attachmentId: string;
      src: string;
      contentHash?: string | null;
      distribution?: 媒体资产分发表面 | null;
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
  on?(
    eventName: "close" | "destroy" | "change" | "loadComplete",
    callback: (payload?: { slide?: { index?: number }; isError?: boolean }) => void
  ): void;
};

type 媒体查看器工厂结果 = 媒体查看器实例 | Promise<媒体查看器实例>;
type 媒体查看器运行时钩子 = {
  发出媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
};
type PhotoSwipe查看器工厂 = (options: PhotoSwipe查看器选项) => 媒体查看器工厂结果;
type Hls构造器 = typeof import("hls.js").default;
type Hls视频覆盖层依赖 = {
  loadHlsConstructor?: () => Promise<Hls构造器>;
};
type Hls视频覆盖层工厂 = (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子,
  deps?: Hls视频覆盖层依赖
) => 媒体查看器工厂结果;
type Vidstack视频覆盖层工厂 = (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子
) => 媒体查看器工厂结果;

export type 媒体查看器依赖 = {
  createPhotoSwipeLightbox?: PhotoSwipe查看器工厂;
  createHlsVideoOverlay?: Hls视频覆盖层工厂;
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

export const 创建默认Hls视频覆盖层: Hls视频覆盖层工厂 = async (
  item,
  lifecycle,
  hooks,
  deps: Hls视频覆盖层依赖 = {}
) => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法打开 HLS 媒体层");
  }

  const HlsFromDeps = deps.loadHlsConstructor ? await deps.loadHlsConstructor() : null;
  const Hls: Hls构造器 = HlsFromDeps ?? (await import("hls.js").then((module) => module.default));
  const overlay = document.createElement("div");
  const video = document.createElement("video");
  const closeButton = document.createElement("button");
  const 解绑媒体运行时信号 = 绑定媒体运行时信号(video, item.attachmentId, hooks);
  let hls实例: InstanceType<Hls构造器> | null = null;
  let cleaned = false;
  let 当前播放源 = item.src;

  const 尝试开始播放 = (): void => {
    void video.play().catch(() => undefined);
  };
  const 使用原生Hls主链 = (): void => {
    video.src = 当前播放源;
    video.load();
  };

  overlay.dataset.mediaViewerMode = "video";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "视频查看器");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:20px;";

  video.dataset.mediaViewerPlayer = "hls";
  video.controls = true;
  video.autoplay = true;
  video.preload = "auto";
  video.playsInline = true;
  video.style.cssText =
    "width:min(100%,1120px);max-height:calc(100vh - 40px);background:#000;object-fit:contain;";
  if (item.posterSrc) {
    video.poster = item.posterSrc;
  }

  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.setAttribute("aria-label", "关闭视频查看器");
  closeButton.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:1;border:1px solid rgb(255 255 255 / 0.35);border-radius:8px;background:rgb(0 0 0 / 0.7);color:white;padding:8px 12px;font:inherit;";

  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    closeButton.removeEventListener("click", cleanup);
    overlay.removeEventListener("click", closeWhenClickingBackdrop);
    document.removeEventListener("keydown", closeWhenPressingEscape);
    解绑媒体运行时信号();
    if (hls实例) {
      hls实例.destroy();
      hls实例 = null;
    }
    video.removeAttribute("src");
    video.load();
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

  // 中文注释：
  // 1. 这里的正式播放链只负责把 HLS 真正挂进最终 <video>；
  // 2. swarm/backfill/presence 仍由聊天媒体编排与协作分发 runtime 掌握；
  // 3. 不能再让 P2P 增强层决定“首播能不能起来”。
  if (typeof Hls.isSupported === "function" && Hls.isSupported()) {
    hls实例 = new Hls({
      lowLatencyMode: false,
      backBufferLength: 90,
    });
    hls实例.attachMedia(video);
    if (typeof hls实例.on === "function" && Hls.Events?.MANIFEST_PARSED) {
      hls实例.on(Hls.Events.MANIFEST_PARSED, 尝试开始播放);
    }
    if (typeof hls实例.on === "function" && Hls.Events?.ERROR) {
      hls实例.on(Hls.Events.ERROR, (_event, data: { fatal?: boolean } | undefined) => {
        if (data?.fatal) {
          hooks.发出媒体会话信号(item.attachmentId, { type: "PLAYER_ERROR" });
        }
      });
    }
    hls实例.loadSource(当前播放源);
  } else {
    使用原生Hls主链();
    video.addEventListener("loadedmetadata", 尝试开始播放, { once: true });
  }

  overlay.append(video, closeButton);
  closeButton.addEventListener("click", cleanup);
  overlay.addEventListener("click", closeWhenClickingBackdrop);
  document.addEventListener("keydown", closeWhenPressingEscape);
  document.body.append(overlay);
  lifecycle.开始视口占用();
  closeButton.focus();

  return {
    同步(nextItem) {
      if (nextItem.kind !== "video") {
        return;
      }
      const 播放源发生变化 = 当前播放源 !== nextItem.src;
      当前播放源 = nextItem.src;
      if (nextItem.posterSrc) {
        video.poster = nextItem.posterSrc;
      } else {
        video.removeAttribute("poster");
      }
      if (hls实例 && 是Hls主清单地址(nextItem.src)) {
        /**
         * HLS overlay 的同步会被聊天媒体编排频繁调用。
         *
         * 如果这里不先比较 src，而是每次都重新 `loadSource`，
         * 浏览器里的真实表现就是：
         * - 当前 `<video>` 刚进入 `playing`
         * - 立刻又被 `emptied -> loadstart -> waiting`
         * - 最终用户看到的就是黑屏转圈，像永远播不起来
         *
         * 所以只有“正式播放主链真的变了”时，才允许重载 HLS 源；
         * 单纯的会话快照同步、poster 更新、backfill 状态推进，都不能打断首播。
         */
        if (!播放源发生变化) {
          return;
        }
        hls实例.loadSource(nextItem.src);
        return;
      }
      if (播放源发生变化 && video.src !== nextItem.src) {
        video.src = nextItem.src;
        video.load();
        尝试开始播放();
      }
    },
    destroy: cleanup,
  };
};

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
  const createHlsVideoOverlay =
    deps.createHlsVideoOverlay ?? 创建默认Hls视频覆盖层;
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
  let 当前查看器渲染类型: "image" | "native_video" | "hls_video" | "video" | null = null;

  /**
   * 查看器选哪一类 renderer，必须只由“当前起点附件的正式播放形态”决定。
   *
   * 这里单独抽成稳定裁决函数，是为了堵住一个真实竞态：
   * - 用户刚点开视频时，时间线可能还只拿着旧 `originalSrc`；
   * - 片刻后媒体会话把正式 `master.m3u8` 同步回来；
   * - 如果我们只给旧 overlay 改 `src`，却不重建 renderer，Vidstack 实例就会继续抱着错误链路。
   *
   * 所以“当前应该是 HLS overlay 还是普通 video overlay”，必须成为可复用的单点裁决。
   */
  const 读取查看器渲染类型 = (
    item: 媒体查看器项目
  ): "image" | "native_video" | "hls_video" | "video" => {
    if (item.kind === "image") {
      return "image";
    }
    if (是Hls主清单地址(item.src)) {
      return "hls_video";
    }
    if (isMobileViewport()) {
      return "native_video";
    }
    return "video";
  };

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
    当前查看器渲染类型 = 读取查看器渲染类型(startItem);
    if (当前查看器渲染类型 === "native_video" && startItem.kind === "video") {
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

    if (当前查看器渲染类型 === "image" && startItem.kind === "image") {
      const imageEntries = request.items
        .filter((item): item is 媒体查看器图片项目 => item.kind === "image")
        .map((item) => ({
          attachmentId: item.attachmentId,
          contentHash: item.contentHash ?? null,
          distribution: item.distribution ?? null,
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
          const 已通知补齐中 = new Set<string>();
          const 已通知补齐完成 = new Set<string>();
          const 通知图片补齐中 = (index: number): void => {
            const entry = imageEntries[index];
            if (!entry || 已通知补齐中.has(entry.attachmentId)) {
              return;
            }
            已通知补齐中.add(entry.attachmentId);
            // 图片 full/original 的加载信号只能来自查看器 adapter；
            // 这里先把“正在补齐完整资产”的事实回流给媒体会话 owner。
            运行时钩子.发出媒体会话信号(entry.attachmentId, {
              type: "ASSET_BACKFILLING",
            });
          };
          const 通知图片补齐完成 = (index: number): void => {
            const entry = imageEntries[index];
            if (!entry || 已通知补齐完成.has(entry.attachmentId)) {
              return;
            }
            已通知补齐完成.add(entry.attachmentId);
            运行时钩子.发出媒体会话信号(entry.attachmentId, {
              type: "ASSET_COMPLETE",
            });
          };
          lightbox.on?.("close", releaseViewport);
          lightbox.on?.("destroy", releaseViewport);
          lightbox.on?.("change", (payload) => {
            const activeIndex = payload?.slide?.index;
            if (typeof activeIndex === "number") {
              通知图片补齐中(activeIndex);
            }
          });
          lightbox.on?.("loadComplete", (payload) => {
            const loadedIndex = payload?.slide?.index;
            if (typeof loadedIndex !== "number" || payload?.isError) {
              return;
            }
            // PhotoSwipe 可能为邻近图片提前 preload；只要完整图已经成功加载，
            // 就可以把它视为“当前浏览器端已完整持有”的候选事实。
            通知图片补齐中(loadedIndex);
            通知图片补齐完成(loadedIndex);
          });
          lightbox.init?.();
          if (lightbox.loadAndOpen?.(imageStartAt) === false) {
            lightbox.destroy();
            releaseViewport();
            return lightbox;
          }
          通知图片补齐中(imageStartAt);
          return lightbox;
        })()
      );
      return;
    }

    if (当前查看器渲染类型 === "hls_video" && startItem.kind === "video") {
      接管当前查看器(
        generation,
        (async () => {
          const overlay = createHlsVideoOverlay(startItem, 视口占用生命周期, 运行时钩子);
          const hlsOverlay = 是异步媒体查看器结果(overlay) ? await overlay : overlay;
          hlsOverlay.on?.("close", () => {
            视口占用生命周期.结束视口占用();
          });
          hlsOverlay.on?.("destroy", () => {
            视口占用生命周期.结束视口占用();
          });
          return hlsOverlay;
        })()
      );
      return;
    }

    if (startItem.kind !== "video") {
      视口占用生命周期.结束视口占用();
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
    const nextRenderer = 读取查看器渲染类型(activeItem);
    if (nextRenderer !== 当前查看器渲染类型) {
      /**
       * 这里不能只把新 src 塞给旧 overlay。
       *
       * 真实场景里，视频可能先用旧 `originalSrc` 打开，随后媒体会话才把正式 `master.m3u8`
       * 回推回来；如果 renderer 仍停留在旧实例上，HLS 主链就永远挂不到正确的 `<video>`。
       * 因此只要渲染类型变了，就必须整实例重建。
       */
      打开(request);
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
    当前查看器渲染类型 = null;
    视口占用生命周期.结束视口占用();
  };

  return {
    打开,
    同步,
    销毁,
  };
}
