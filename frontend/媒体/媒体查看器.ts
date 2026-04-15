import type { 媒体资产分发表面 } from "../契约.js";
import type { 媒体会话信号 } from "./媒体会话.js";
import {
  创建VideoJs播放器壳,
  type VideoJs播放器源描述,
} from "./videojs播放器壳.js";

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
type VideoJs播放器壳工厂 = (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子
) => 媒体查看器工厂结果;

export type 媒体查看器依赖 = {
  createPhotoSwipeLightbox?: PhotoSwipe查看器工厂;
  createVideoJsPlayerShell?: VideoJs播放器壳工厂;
  isMobileViewport?: () => boolean;
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

type 可原生全屏视频元素 = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type 可原生全屏容器元素 = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};
type 媒体方向锁 = "portrait" | "landscape";
type 可锁定屏幕方向 = ScreenOrientation & {
  lock?: (orientation: 媒体方向锁) => Promise<void>;
  unlock?: () => void;
};

const 媒体全屏历史键 = "__kokoMediaFullscreenSession";

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

const 映射VideoJs播放源 = (item: 媒体查看器视频项目): VideoJs播放器源描述 => ({
  kind: /\.m3u8(?:$|\?)/.test(item.src) ? "hls" : "file",
  src: item.src,
  posterSrc: item.posterSrc,
  width: item.width,
  height: item.height,
});

const 启动同会话全屏策略 = (
  读取当前项目: () => 媒体查看器视频项目,
  container: 可原生全屏容器元素,
  video: 可原生全屏视频元素,
  请求关闭查看器: () => void
): (() => void) => {
  const sessionId = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let cleaned = false;
  let historyPushed = false;
  let historyConsumedByUser = false;
  let historyCleanupInProgress = false;
  let historyCleanupTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let videoOrientation = 读取视频方向锁(读取当前项目());

  const startPlayback = (): void => {
    void video.play().catch(() => undefined);
  };
  const lockScreenOrientation = (): void => {
    if (!videoOrientation) {
      return;
    }
    try {
      void 读取屏幕方向()?.lock?.(videoOrientation).catch(() => undefined);
    } catch {
      // 方向锁只是体验增强；失败时不能回退成第二套播放器实现。
    }
  };
  const unlockScreenOrientation = (): void => {
    try {
      读取屏幕方向()?.unlock?.();
    } catch {
      // 部分浏览器不支持 unlock，忽略即可。
    }
  };
  const removePopStateListener = (): void => {
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", handlePopState);
    }
  };
  const syncOrientationFromVideoMetadata = (): void => {
    const metadataOrientation = 读取视频元素方向锁(video);
    if (!metadataOrientation || metadataOrientation === videoOrientation) {
      return;
    }
    // 编码宽高可能没带展示方向；元数据一旦更可信，就以视频真实方向重锁。
    videoOrientation = metadataOrientation;
    container.dataset.videoOrientation = metadataOrientation;
    lockScreenOrientation();
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
    video.removeEventListener("webkitendfullscreen", handleWebkitEndFullscreen);
    video.removeEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
    unlockScreenOrientation();
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
  const closeFullscreen = (): void => {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(() => {
        cleanup();
        请求关闭查看器();
      });
      return;
    }
    cleanup();
    请求关闭查看器();
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
      请求关闭查看器();
    }
  };
  const handleWebkitEndFullscreen = (): void => {
    cleanup();
    请求关闭查看器();
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
      // 这里失败也不能回退成旧原生全屏旁路；只是少一层返回键接管。
    }
  };

  container.dataset.videoOrientation = videoOrientation ?? "natural";
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  video.addEventListener("webkitendfullscreen", handleWebkitEndFullscreen);
  video.addEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
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
        }
      });
    return cleanup;
  }

  if (typeof video.webkitEnterFullscreen === "function") {
    lockScreenOrientation();
    startPlayback();
    video.webkitEnterFullscreen();
  }

  return cleanup;
};

const 创建默认VideoJs播放器层 = async (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子,
  options: { shouldAutoEnterFullscreen: boolean }
): Promise<媒体查看器实例> => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法打开 Video.js 媒体层");
  }

  const overlay = document.createElement("div");
  const mount = document.createElement("div");
  const closeButton = document.createElement("button");

  overlay.dataset.mediaViewerMode = "video";
  mount.dataset.mediaViewerMount = "video";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "视频查看器");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:20px;";
  /**
   * 查看器必须先给播放器壳一个明确的挂载盒子：
   * 1. 尺寸上限属于查看器 overlay，本身就是 shell 的职责；
   * 2. provider/container/video 之后都只跟这一个盒子算宽高；
   * 3. 避免父盒子是 auto/0 宽时，下面一整串媒体节点一起塌成 0x0。
   */
  mount.style.cssText = "display:block;width:100%;max-width:1120px;min-width:0;";

  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.setAttribute("aria-label", "关闭视频查看器");
  closeButton.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:1;border:1px solid rgb(255 255 255 / 0.35);border-radius:8px;background:rgb(0 0 0 / 0.7);color:white;padding:8px 12px;font:inherit;";

  overlay.append(mount, closeButton);
  document.body.append(overlay);
  lifecycle.开始视口占用();

  let 当前视频项目 = item;
  let cleaned = false;
  let 解绑媒体运行时信号: () => void = () => undefined;
  let 清理全屏策略: () => void = () => undefined;

  try {
    const shell = await 创建VideoJs播放器壳(映射VideoJs播放源(item), {
      mountTarget: mount,
    });
    const video = shell.读取视频元素();
    const container = shell.读取容器元素();
    解绑媒体运行时信号 = 绑定媒体运行时信号(video, item.attachmentId, hooks);

    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => undefined);
      }
      closeButton.removeEventListener("click", cleanup);
      overlay.removeEventListener("click", closeWhenClickingBackdrop);
      document.removeEventListener("keydown", closeWhenPressingEscape);
      解绑媒体运行时信号();
      清理全屏策略();
      video.pause();
      shell.destroy();
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

    if (options.shouldAutoEnterFullscreen) {
      /**
       * 移动端允许 native fullscreen，但它必须只是同一壳上的展示策略。
       * 这里继续复用同一个 container/video，不再额外创建第二颗 video。
       */
      清理全屏策略 = 启动同会话全屏策略(
        () => 当前视频项目,
        container,
        video,
        cleanup
      );
    }

    closeButton.addEventListener("click", cleanup);
    overlay.addEventListener("click", closeWhenClickingBackdrop);
    document.addEventListener("keydown", closeWhenPressingEscape);
    closeButton.focus();

    return {
      同步(nextItem) {
        if (nextItem.kind !== "video") {
          return;
        }
        当前视频项目 = nextItem;
        shell.同步(映射VideoJs播放源(nextItem));
      },
      destroy: cleanup,
    };
  } catch (error) {
    解绑媒体运行时信号();
    清理全屏策略();
    overlay.remove();
    lifecycle.结束视口占用();
    throw error;
  }
};

export function 创建媒体查看器(deps: 媒体查看器依赖 = {}) {
  const createPhotoSwipeLightbox =
    deps.createPhotoSwipeLightbox ?? 创建默认PhotoSwipeLightbox;
  const isMobileViewport = deps.isMobileViewport ?? 是移动触屏视口;
  const createVideoJsPlayerShell =
    deps.createVideoJsPlayerShell ??
    ((item, lifecycle, hooks) =>
      创建默认VideoJs播放器层(item, lifecycle, hooks, {
        shouldAutoEnterFullscreen: isMobileViewport(),
      }));
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
  let 当前查看器渲染类型: "image" | "video" | null = null;

  const 读取查看器渲染类型 = (item: 媒体查看器项目): "image" | "video" =>
    item.kind === "image" ? "image" : "video";

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

    const generation = ++openGeneration;
    current?.destroy();
    current = null;
    当前查看器渲染类型 = 读取查看器渲染类型(startItem);

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
        return;
      }
      视口占用生命周期.开始视口占用();
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

    if (startItem.kind !== "video") {
      return;
    }

    接管当前查看器(
      generation,
      createVideoJsPlayerShell(startItem, 视口占用生命周期, 运行时钩子)
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
