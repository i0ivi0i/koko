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
};

const 读取纵横比 = (source: VideoJs播放器源描述): string =>
  `${Math.max(1, source.width)}/${Math.max(1, source.height)}`;

const 创建默认播放器根 = (source: VideoJs播放器源描述): VideoJs播放器根节点 => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法创建 Video.js 播放器壳");
  }

  const provider = document.createElement("video-player");
  const skin = document.createElement("video-skin");
  const container = document.createElement("media-container") as 可请求全屏容器;
  const video = document.createElement("video") as 可原生全屏视频元素;

  provider.dataset.playerShell = "videojs";
  provider.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:20px;";
  container.style.cssText =
    `width:min(100%,1120px);max-height:calc(100vh - 40px);aspect-ratio:${读取纵横比(source)};`;
  video.controls = true;
  video.autoplay = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.style.cssText =
    "width:100%;height:100%;max-height:calc(100vh - 40px);background:#000;object-fit:contain;";

  provider.append(skin);
  skin.append(container);
  container.append(video);
  document.body.append(provider);

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
  await deps.registerVideoJsElements?.();

  const root = (deps.createPlayer ?? 创建默认播放器根)(initialSource);
  const Hls =
    deps.loadHlsConstructor != null
      ? await deps.loadHlsConstructor()
      : await import("hls.js").then((module) => module.default);

  let 当前源 = initialSource;
  let 已销毁 = false;
  let hls实例: InstanceType<Hls构造器> | null = null;

  const 销毁Hls实例 = (): void => {
    if (!hls实例) {
      return;
    }
    hls实例.destroy();
    hls实例 = null;
  };

  const 应用文件源 = (source: VideoJs播放器源描述): void => {
    销毁Hls实例();
    if (root.video.src !== source.src) {
      root.video.src = source.src;
    }
  };

  const 应用Hls源 = (source: VideoJs播放器源描述): void => {
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
      if (当前源.kind !== "hls" || 当前源.src !== source.src) {
        hls实例.loadSource(source.src);
      }
      return;
    }

    root.video.src = source.src;
  };

  const 应用源 = (source: VideoJs播放器源描述): void => {
    应用展示源(root, source);
    if (source.kind === "hls") {
      应用Hls源(source);
      return;
    }
    应用文件源(source);
  };

  /**
   * 创建时就先把初始源挂进唯一那颗 video。
   * 这样后面的 file -> HLS / HLS -> file 只是在同一会话里切 provider，
   * 不会重新长出第二套播放器实现。
   */
  应用源(initialSource);

  return {
    同步(source) {
      if (已销毁) {
        return;
      }
      应用源(source);
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
