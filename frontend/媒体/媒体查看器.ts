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

const 是移动触屏视口 = (): boolean => {
  const hasCoarsePointer = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchPoints = globalThis.navigator?.maxTouchPoints ?? 0;
  return hasCoarsePointer || touchPoints > 0;
};

const 打开原生视频全屏 = (item: 媒体查看器视频项目): boolean => {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const video = document.createElement("video") as 可原生全屏视频元素;
  video.src = item.src;
  video.controls = true;
  video.autoplay = true;
  video.preload = "metadata";
  video.playsInline = false;
  // 这个元素会被浏览器放进原生全屏层，不能藏成 1px，否则回退路径会出现黑屏/假全屏。
  video.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;background:#000;object-fit:contain;z-index:2147483647;";
  if (item.posterSrc) {
    video.poster = item.posterSrc;
  }

  const handleFullscreenChange = (): void => {
    if (!document.fullscreenElement) {
      cleanup();
    }
  };
  const cleanup = (): void => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    video.remove();
  };
  const startPlayback = (): void => {
    void video.play().catch(() => undefined);
  };

  video.addEventListener("ended", cleanup, { once: true });
  video.addEventListener("webkitendfullscreen", cleanup, { once: true });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.body.append(video);

  if (typeof video.webkitEnterFullscreen === "function") {
    startPlayback();
    video.webkitEnterFullscreen();
    return true;
  }
  if (typeof video.requestFullscreen === "function") {
    startPlayback();
    void video.requestFullscreen().then(startPlayback).catch(cleanup);
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
