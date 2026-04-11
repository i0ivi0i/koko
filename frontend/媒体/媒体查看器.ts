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

export function 创建媒体查看器(deps: 媒体查看器依赖 = {}) {
  const createLightbox = deps.createLightbox ?? 创建默认Lightbox;
  let current: GLightbox实例 | null = null;
  let openGeneration = 0;

  const 打开 = (request: 媒体查看器打开请求): void => {
    const startAt = request.items.findIndex(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (startAt < 0) {
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
            ratio: "16:9",
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
