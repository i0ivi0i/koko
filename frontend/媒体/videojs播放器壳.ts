type Hls构造器 = typeof import("hls.js").default;

export type VideoJs播放器源描述 =
  | {
      kind: "file";
      src: string;
      posterSrc: string | null;
      width: number;
      height: number;
    }
  | {
      kind: "hls";
      src: string;
      posterSrc: string | null;
      width: number;
      height: number;
    };

type 可请求全屏容器 = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};

type 可原生全屏视频元素 = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

type VideoJs播放器根节点 = {
  provider: HTMLElement;
  container: 可请求全屏容器;
  video: 可原生全屏视频元素;
  destroy?(): void;
};

export interface VideoJs播放器壳实例 {
  同步(source: VideoJs播放器源描述): void;
  进入全屏(): Promise<void>;
  读取容器元素(): 可请求全屏容器;
  读取视频元素(): 可原生全屏视频元素;
  destroy(): void;
}

export type VideoJs播放器壳依赖 = {
  /**
   * 隔离 Video.js v10 beta 的 custom elements 注册。
   *
   * Task 2 先让壳层接口站住，不把 beta 依赖直接灌进主链；Task 4 再在这里接官方
   * `@videojs/html/video/player` 注册逻辑。
   */
  registerVideoJsElements?: () => Promise<void>;
  /**
   * 这里只允许返回同一套播放器 DOM。
   * 不管后面接 file、blob 还是 HLS，都必须继续复用这一个 provider/container/video。
   */
  createPlayer?: (source: VideoJs播放器源描述) => VideoJs播放器根节点;
  loadHlsConstructor?: () => Promise<Hls构造器>;
  mountTarget?: HTMLElement;
};

const 读取纵横比 = (source: VideoJs播放器源描述): string =>
  `${Math.max(1, source.width)}/${Math.max(1, source.height)}`;

const 注册默认VideoJs元素 = async (): Promise<void> => {
  /**
   * Video.js v10 官方 HTML 路线把 player 和 skin 拆成独立 define 模块。
   * 这里统一在壳适配层完成注册，业务链路只拿到稳定壳接口，
   * 不直接感知 beta API 的模块粒度和命名细节。
   */
  await import("@videojs/html/video/player");
  await import("@videojs/html/video/skin");
};

const 创建默认播放器根 = (
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): VideoJs播放器根节点 => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法创建 Video.js 播放器壳");
  }

  const provider = document.createElement("video-player");
  const skin = document.createElement("video-skin");
  const video = document.createElement("video") as 可原生全屏视频元素;

  provider.dataset.playerShell = "videojs";
  provider.style.cssText = "display:block;width:min(100%,1120px);max-width:100%;";
  /**
   * 官方文档说 `slot="media"` 已不是必需，但显式声明能让当前测试环境和部分浏览器
   * 更稳定地把真实媒体元素投影进 skin 内的 container。
   */
  video.slot = "media";
  video.setAttribute("preload", "metadata");
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = "background:#000;";

  provider.append(skin);
  skin.append(video);
  (mountTarget ?? document.body).append(provider);
  const container =
    (skin.shadowRoot?.querySelector("media-container") as 可请求全屏容器 | null) ?? provider;
  container.style.cssText =
    `width:100%;max-height:calc(100vh - 40px);aspect-ratio:${读取纵横比(source)};`;

  return {
    provider,
    container,
    video,
    destroy() {
      provider.remove();
    },
  };
};

const 应用展示源 = (root: VideoJs播放器根节点, source: VideoJs播放器源描述): void => {
  root.container.style.aspectRatio = 读取纵横比(source);
  if (source.posterSrc) {
    root.video.poster = source.posterSrc;
  } else {
    root.video.removeAttribute("poster");
  }
};

export async function 创建VideoJs播放器壳(
  initialSource: VideoJs播放器源描述,
  deps: VideoJs播放器壳依赖 = {}
): Promise<VideoJs播放器壳实例> {
  await (deps.registerVideoJsElements ?? 注册默认VideoJs元素)();

  const root =
    deps.createPlayer?.(initialSource) ??
    创建默认播放器根(initialSource, deps.mountTarget);

  let 当前源 = initialSource;
  let 已销毁 = false;
  let hls构造器Promise: Promise<Hls构造器> | null = null;
  let hls实例: InstanceType<Hls构造器> | null = null;

  const 销毁Hls实例 = (): void => {
    if (!hls实例) {
      return;
    }
    hls实例.destroy();
    hls实例 = null;
  };
  const 读取Hls构造器 = (): Promise<Hls构造器> => {
    if (!hls构造器Promise) {
      hls构造器Promise =
        deps.loadHlsConstructor != null
          ? deps.loadHlsConstructor()
          : import("hls.js").then((module) => module.default);
    }
    return hls构造器Promise;
  };

  const 应用文件源 = (source: VideoJs播放器源描述): void => {
    销毁Hls实例();
    if (root.video.src !== source.src) {
      root.video.src = source.src;
    }
  };

  const 应用Hls源 = async (
    source: VideoJs播放器源描述,
    previousSource: VideoJs播放器源描述 | null
  ): Promise<void> => {
    const Hls = await 读取Hls构造器();
    if (typeof Hls.isSupported === "function" && Hls.isSupported()) {
      if (!hls实例) {
        hls实例 = new Hls();
        hls实例.attachMedia(root.video);
      }
      /**
       * HLS 主链同步必须只在正式源变化时重载。
       * 否则媒体会话每次投影快照，都会把同一条 manifest 重新 loadSource 一遍，
       * 用户看到的就会是“明明是同一个会话，却不停转圈重连”。
       */
      if (!previousSource || previousSource.kind !== "hls" || previousSource.src !== source.src) {
        hls实例.loadSource(source.src);
      }
      return;
    }

    root.video.src = source.src;
  };

  const 应用源 = (
    source: VideoJs播放器源描述,
    previousSource: VideoJs播放器源描述 | null
  ): void => {
    应用展示源(root, source);
    if (source.kind === "hls") {
      void 应用Hls源(source, previousSource);
      return;
    }
    应用文件源(source);
  };

  /**
   * 创建时就先把初始源挂进唯一那颗 video。
   * 这样后面的 file -> HLS / HLS -> file 只是在同一会话里切 provider，
   * 不会重新长出第二套播放器实现。
   */
  应用源(initialSource, null);

  return {
    同步(source) {
      if (已销毁) {
        return;
      }
      const previousSource = 当前源;
      应用源(source, previousSource);
      当前源 = source;
    },
    async 进入全屏() {
      if (已销毁) {
        return;
      }
      /**
       * 官方文档要求 fullscreen 以 container 为准，而不是 video 元素。
       * 但移动端原生播放器只要是对同一颗 video 的平台展示策略，仍然算单会话。
       */
      if (typeof root.container.requestFullscreen === "function") {
        await root.container.requestFullscreen({ navigationUI: "hide" });
        return;
      }
      root.video.webkitEnterFullscreen?.();
    },
    读取容器元素() {
      return root.container;
    },
    读取视频元素() {
      return root.video;
    },
    destroy() {
      if (已销毁) {
        return;
      }
      已销毁 = true;
      销毁Hls实例();
      root.destroy?.();
      root.provider.remove();
    },
  };
}
