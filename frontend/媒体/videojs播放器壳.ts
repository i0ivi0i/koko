import { 媒体是否默认循环播放 } from "./媒体播放.js";
import { KokoVideoSkinTagName, 注册KokoVideoSkin元素 } from "./videojs播放器皮肤.js";

export type VideoJs播放器源描述 = {
  kind: "file";
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
  webkitEnterFullScreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
};
export type VideoJs全屏进入结果 = "standard" | "native" | "unsupported";
const 远端播放Promise契约补齐标记 = Symbol("koko-videojs-remote-playback-promise-patched");
const VideoJs播放器Provider标签 = "video-player";

type 可补齐远端播放对象 = {
  watchAvailability?: (...args: unknown[]) => unknown;
  cancelWatchAvailability?: (...args: unknown[]) => unknown;
  [远端播放Promise契约补齐标记]?: true;
};

type VideoJs播放器根节点 = {
  provider: HTMLElement;
  container: 可请求全屏容器;
  video: 可原生全屏视频元素;
  destroy?(): void;
};

export interface VideoJs播放器壳实例 {
  同步(source: VideoJs播放器源描述): void;
  挂载到宿主(mountTarget: HTMLElement): void;
  进入全屏(): Promise<VideoJs全屏进入结果>;
  读取容器元素(): 可请求全屏容器;
  读取视频元素(): 可原生全屏视频元素;
  destroy(): void;
}

export type VideoJs播放器壳依赖 = {
  /**
   * 隔离默认播放器元素注册。
   *
   * 正式链已经退到“原生 video + 本地薄壳控件”，这里仍保留可注入入口，
   * 让测试或后续平台适配可以替换默认注册逻辑，而不会把第二套播放器真相灌回主链。
   */
  registerVideoJsElements?: () => void | Promise<void>;
  /**
   * 壳层只允许维护同一套播放器 DOM。
   * 不管后面接 blob、`/webtorrent/...` 还是其他单一正式字节地址，都必须继续复用
   * 这一个 provider/container/video，不能在壳里长出第二条 source owner 链。
   */
  createPlayer?: (source: VideoJs播放器源描述) => VideoJs播放器根节点;
  mountTarget?: HTMLElement;
};

const 读取纵横比 = (source: VideoJs播放器源描述): string =>
  `${Math.max(1, source.width)}/${Math.max(1, source.height)}`;

const 格式化像素 = (value: number): string => `${Math.round(value * 1000) / 1000}px`;

const 读取正数 = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;

const 读取沉浸挂载盒尺寸 = (
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): { width: number; height: number } => {
  const rect = mountTarget?.getBoundingClientRect();
  const viewportWidth = typeof window === "undefined" ? source.width : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? source.height : window.innerHeight;
  return {
    width: 读取正数(rect?.width, 读取正数(viewportWidth, source.width)),
    height: 读取正数(rect?.height, 读取正数(viewportHeight, source.height)),
  };
};

const 计算沉浸媒体盒尺寸 = (
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): { width: number; height: number } => {
  const mount = 读取沉浸挂载盒尺寸(source, mountTarget);
  const mediaAspect = Math.max(1, source.width) / Math.max(1, source.height);
  const mountAspect = mount.width / mount.height;
  if (mediaAspect >= mountAspect) {
    return {
      width: mount.width,
      height: mount.width / mediaAspect,
    };
  }
  return {
    width: mount.height * mediaAspect,
    height: mount.height,
  };
};

const 同步播放器挂载布局 = (
  root: VideoJs播放器根节点,
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): void => {
  const 使用沉浸挂载布局 = mountTarget?.dataset.mediaViewerImmersive === "true";
  const 使用应用内沉浸适配布局 =
    使用沉浸挂载布局 && mountTarget?.dataset.mediaViewerSystemFullscreen !== "true";
  /**
   * 时间线 inline 模式下，卡片尺寸已由拼贴几何算法裁定：
   * 1. provider/container 必须铺满宿主卡片（width:100%; height:100%）；
   * 2. 禁止用 aspect-ratio 把容器限死在视频原始比例，否则横屏视频在较高的拼贴卡片里
   *    会缩成一条，露出 canonical-host 的黑色背景，并在 poster(cover) → canonical(contain) 切换时闪烁；
   * 3. video 元素的 object-fit:cover（由 配置时间线自动播视频 设置）负责裁切超出部分。
   */
  const 使用时间线内联布局 = root.provider.dataset.presentation === "inline";
  const 沉浸盒尺寸 = 使用应用内沉浸适配布局
    ? 计算沉浸媒体盒尺寸(source, mountTarget)
    : null;
  const 沉浸播放器盒样式 = 沉浸盒尺寸
    ? `display:block;width:${格式化像素(沉浸盒尺寸.width)};height:${格式化像素(
        沉浸盒尺寸.height
      )};max-width:100%;max-height:100%;background:#000;overflow:hidden;`
    : "";
  /**
   * provider/container 的尺寸真相必须跟着当前宿主走：
   * 1. 同一颗 canonical player 会在时间线宿主和查看器宿主之间迁移；
   * 2. 不能把"第一次挂载时的布局样式"偷偷残留到下一次宿主，否则时间线和沉浸层会互相污染；
   * 3. 因此每次迁移宿主后，都要按新宿主重新同步 provider/container 的唯一尺寸语义。
   *
   * 移动端应用内沉浸全屏不能再依赖浏览器原生 fullscreen 帮忙适配尺寸。
   * 这里按宿主盒和视频自然比例先算出唯一播放器盒，避免横屏视频被 `height:100%`
   * 反推出超宽容器，也避免竖屏视频为了铺满高度而横向溢出。
   */
  root.provider.style.cssText = 使用时间线内联布局
    ? "display:block;width:100%;height:100%;background:#000;"
    : 使用沉浸挂载布局
      ? 使用应用内沉浸适配布局
        ? 沉浸播放器盒样式
        : "display:block;width:100%;height:100%;max-width:100%;background:#000;"
      : "display:block;width:100%;max-width:100%;background:#000;";
  root.container.style.cssText = 使用时间线内联布局
    ? "display:block;width:100%;height:100%;background:#000;"
    : 使用沉浸挂载布局
      ? 使用应用内沉浸适配布局
        ? `${沉浸播放器盒样式}aspect-ratio:${读取纵横比(source)};`
        : `display:block;width:100%;height:100%;max-width:100%;max-height:100%;background:#000;aspect-ratio:${读取纵横比(
            source
          )};`
      : `display:block;width:100%;max-width:100%;max-height:min(calc(100vh - 40px), 100%);background:#000;aspect-ratio:${读取纵横比(
            source
          )};`;
};

const 看起来像Promise = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const 补齐RemotePlayback异步契约 = (video: 可原生全屏视频元素): void => {
  const remote = (video as 可原生全屏视频元素 & { remote?: 可补齐远端播放对象 }).remote;
  if (!remote || remote[远端播放Promise契约补齐标记]) {
    return;
  }

  const 原watchAvailability = remote.watchAvailability;
  if (typeof 原watchAvailability === "function") {
    remote.watchAvailability = ((...args: unknown[]) => {
      try {
        const result = 原watchAvailability.apply(remote, args);
        return 看起来像Promise(result) ? result : Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    }) as typeof 原watchAvailability;
  }

  const 原cancelWatchAvailability = remote.cancelWatchAvailability;
  if (typeof 原cancelWatchAvailability === "function") {
    remote.cancelWatchAvailability = ((...args: unknown[]) => {
      try {
        const result = 原cancelWatchAvailability.apply(remote, args);
        return 看起来像Promise(result) ? result : Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    }) as typeof 原cancelWatchAvailability;
  }

  /**
   * Video.js beta.22 会把 RemotePlayback 的 watch/cancel 都按 Promise 契约消费。
   * 浏览器标准也是 Promise，但 `happy-dom` 20.8.9 的 cancel 仍返回 void。
   * 这里把宿主差异收口在壳适配层，避免销毁阶段因为测试/非标运行时而炸掉整个播放会话。
   */
  remote[远端播放Promise契约补齐标记] = true;
};

const 请求原生视频真全屏 = (video: 可原生全屏视频元素): boolean => {
  if (video.webkitSupportsFullscreen === false) {
    return false;
  }
  try {
    if (typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      return true;
    }
    if (typeof video.webkitEnterFullScreen === "function") {
      video.webkitEnterFullScreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

// 播放与音量图标沿用此前播放器壳的既有视觉语义，
// 本壳只负责控件行为和布局，不再让第二链依赖决定 UI 真相。
const 注册默认VideoJs元素 = (): void => {
  /**
   * 默认注册只负责两件事：
   * 1. 定义 `video-player` provider，给唯一壳一个稳定宿主标签；
   * 2. 定义 `koko-video-skin`，把控件行为收口在本地薄壳，不再透传第二链播放器依赖。
   *
   * 测试环境里不一定存在 DOM Custom Elements/HTMLElement，
   * 这里必须先短路，避免纯 Node 路径因为“预热默认元素”而被误伤。
   */
  if (
    typeof globalThis.customElements === "undefined" ||
    typeof HTMLElement === "undefined"
  ) {
    return;
  }
  if (
    globalThis.customElements.get(VideoJs播放器Provider标签) &&
    globalThis.customElements.get(KokoVideoSkinTagName)
  ) {
    return;
  }
  if (!globalThis.customElements.get(VideoJs播放器Provider标签)) {
    class KokoVideoPlayerProviderElement extends HTMLElement {}
    globalThis.customElements.define(VideoJs播放器Provider标签, KokoVideoPlayerProviderElement);
  }
  注册KokoVideoSkin元素();
};

export const 预热默认VideoJs元素 = (): Promise<void> =>
  Promise.resolve(注册默认VideoJs元素());

const 创建默认播放器根 = (
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): VideoJs播放器根节点 => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法创建 Video.js 播放器壳");
  }

  const provider = document.createElement(VideoJs播放器Provider标签);
  注册KokoVideoSkin元素();
  const skin = document.createElement(KokoVideoSkinTagName);
  const video = document.createElement("video") as 可原生全屏视频元素;

  provider.dataset.playerShell = "videojs";
  provider.dataset.presentation = "viewer";
  /**
   * 官方文档说 `slot="media"` 已不是必需，但显式声明能让当前测试环境和部分浏览器
   * 更稳定地把真实媒体元素投影进 skin 内的 container。
   */
  video.slot = "media";
  video.setAttribute("preload", "metadata");
  video.autoplay = true;
  /**
   * 默认循环语义不属于某个来源分支，而属于统一播放策略。
   * 这里直接投影到唯一真实 video，避免消息流、查看器、HLS/file 再各补一套 loop 规则。
   */
  video.loop = 媒体是否默认循环播放("video");
  video.playsInline = true;
  video.style.cssText =
    "display:block;width:100%;height:100%;background:#000;object-fit:contain;";
  /**
   * 统一皮肤默认先按 viewer 能力创建，再由唯一播放器 owner 在 inline/viewer 之间切展示模式。
   * 这样消息流与查看器继续共享同一套 DOM/播放器壳，不会因为“无控件”再长第二模板。
   */
  skin.dataset.presentation = "viewer";
  skin.style.cssText = "display:block;width:100%;height:100%;background:#000;";

  provider.append(skin);
  skin.append(video);
  (mountTarget ?? document.body).append(provider);
  const container =
    (skin.shadowRoot?.querySelector("media-container") as 可请求全屏容器 | null) ?? provider;
  同步播放器挂载布局({ provider, container, video }, source, mountTarget);

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
  // 切源时再次同步统一循环策略，避免后续投影或 provider 切换把 loop 语义冲掉。
  root.video.loop = 媒体是否默认循环播放("video");
  if (source.posterSrc) {
    root.video.poster = source.posterSrc;
  } else {
    root.video.removeAttribute("poster");
  }
};

const 地址看起来是绝对地址 = (src: string): boolean => /^[a-zA-Z][\w+.-]*:/.test(src);

const 解析可比较媒体地址 = (src: string): URL | null => {
  if (!src) {
    return null;
  }
  try {
    const fallbackBase =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "http://127.0.0.1/";
    return new URL(src, fallbackBase);
  } catch {
    return null;
  }
};

const 是同一个文件媒体地址 = (left: string, right: string): boolean => {
  if (left === right) {
    return true;
  }
  const leftUrl = 解析可比较媒体地址(left);
  const rightUrl = 解析可比较媒体地址(right);
  if (!leftUrl || !rightUrl) {
    return false;
  }
  if (leftUrl.href === rightUrl.href) {
    return true;
  }
  /**
   * 浏览器会把 `<video>.src` 自动展开成绝对地址，但媒体会话里的播放结果常常还是相对路径。
   * 对 `/webtorrent/...` 这类同站资源来说，只要 path/query/hash 相同，就仍然代表同一份媒体字节；
   * 只有在双方都已经是绝对地址时，才继续要求 origin 也一致，避免把跨站资源误判成同一源。
   */
  const pathIdentity相同 =
    leftUrl.pathname === rightUrl.pathname &&
    leftUrl.search === rightUrl.search &&
    leftUrl.hash === rightUrl.hash;
  if (!pathIdentity相同) {
    return false;
  }
  if (!地址看起来是绝对地址(left) || !地址看起来是绝对地址(right)) {
    return true;
  }
  return leftUrl.origin === rightUrl.origin;
};

const 创建VideoJs播放器壳核心 = (
  initialSource: VideoJs播放器源描述,
  deps: VideoJs播放器壳依赖 = {}
): VideoJs播放器壳实例 => {
  const root =
    deps.createPlayer?.(initialSource) ??
    创建默认播放器根(initialSource, deps.mountTarget);
  补齐RemotePlayback异步契约(root.video);

  let 当前源 = initialSource;
  let 已销毁 = false;

  const 释放真实视频资源 = (): void => {
    try {
      root.video.pause();
    } catch {
      // 部分测试环境或平台实现可能在无源状态抛错；释放流程不能因此中断。
    }
    root.video.removeAttribute("src");
    root.video.load();
  };

  const 应用文件源 = (source: VideoJs播放器源描述): void => {
    if (!是同一个文件媒体地址(root.video.src, source.src)) {
      root.video.src = source.src;
    }
  };
  const 应用源 = (source: VideoJs播放器源描述): VideoJs播放器源描述 => {
    应用展示源(root, source);
    应用文件源(source);
    return source;
  };

  /**
   * 创建时就先把初始源挂进唯一那颗 video。
   * 后面不管切 blob、webtorrent 还是其他单一正式地址，都是同一会话里的同一颗 video，
   * 不会因为源地址变化再长出第二套播放器实现。
   */
  当前源 = 应用源(initialSource);

  return {
    同步(source) {
      if (已销毁) {
        return;
      }
      当前源 = 应用源(source);
    },
    挂载到宿主(mountTarget) {
      if (已销毁) {
        return;
      }
      /**
       * 时间线 owner 高频同步会重复命中“同一宿主、同一颗壳”：
       * 1. 这里如果继续 append，同一个 `video-player` 也会被浏览器记成一次 remove/add；
       * 2. 真正需要的只有“换宿主时迁移”，不是“同宿主时重复挂载”；
       * 3. 因此同宿主直接 no-op，只保留布局同步，避免把无意义 DOM mutation 放大成可见抽搐。
       */
      if (root.provider.parentElement === mountTarget) {
        同步播放器挂载布局(root, 当前源, mountTarget);
        return;
      }
      mountTarget.append(root.provider);
      同步播放器挂载布局(root, 当前源, mountTarget);
    },
    async 进入全屏() {
      if (已销毁) {
        return "unsupported";
      }
      /**
       * Video.js 官方 v10 建议是 container 优先、media element 回退。
       * 这条统一 intent 在桌面/Android 上通常落到标准 Fullscreen API，
       * 在 iPhone Safari 这类只给 video 原生全屏的环境里，则必须回退到 video。
       */
      if (typeof root.container.requestFullscreen === "function") {
        await root.container.requestFullscreen({ navigationUI: "hide" });
        return "standard";
      }
      if (请求原生视频真全屏(root.video)) {
        return "native";
      }
      return "unsupported";
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
      释放真实视频资源();
      root.destroy?.();
      root.provider.remove();
    },
  };
};

export function 创建VideoJs播放器壳(
  initialSource: VideoJs播放器源描述,
  deps: VideoJs播放器壳依赖 = {}
): VideoJs播放器壳实例 | Promise<VideoJs播放器壳实例> {
  const 注册结果 = (deps.registerVideoJsElements ?? 注册默认VideoJs元素)();
  if (看起来像Promise(注册结果)) {
    return Promise.resolve(注册结果)
      .then(() => 创建VideoJs播放器壳核心(initialSource, deps))
      .catch((error: unknown) => {
        console.warn("[koko:videojs-shell:register]", error);
        return 创建VideoJs播放器壳核心(initialSource, deps);
      });
  }
  return 创建VideoJs播放器壳核心(initialSource, deps);
}
