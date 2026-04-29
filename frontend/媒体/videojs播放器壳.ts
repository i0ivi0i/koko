import { 媒体是否默认循环播放 } from "./媒体播放.js";

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
const 远端播放Promise兼容标记 = Symbol("koko-videojs-remote-playback-promise-compat");
const VideoJs播放器Provider标签 = "video-player";
const KokoVideoSkinTagName = "koko-video-skin";
const 等待态时间推进判定阈值秒 = 0.05;

type 可兼容远端播放对象 = {
  watchAvailability?: (...args: unknown[]) => unknown;
  cancelWatchAvailability?: (...args: unknown[]) => unknown;
  [远端播放Promise兼容标记]?: true;
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

const 同步播放器挂载布局 = (
  root: VideoJs播放器根节点,
  source: VideoJs播放器源描述,
  mountTarget?: HTMLElement
): void => {
  const 使用沉浸挂载布局 = mountTarget?.dataset.mediaViewerImmersive === "true";
  /**
   * provider/container 的尺寸真相必须跟着当前宿主走：
   * 1. 同一颗 canonical player 会在时间线宿主和查看器宿主之间迁移；
   * 2. 不能把“第一次挂载时的布局样式”偷偷残留到下一次宿主，否则时间线和沉浸层会互相污染；
   * 3. 因此每次迁移宿主后，都要按新宿主重新同步 provider/container 的唯一尺寸语义。
   */
  root.provider.style.cssText = 使用沉浸挂载布局
    ? "display:block;width:100%;height:100%;max-width:100%;background:#000;"
    : "display:block;width:100%;max-width:100%;background:#000;";
  root.container.style.cssText = 使用沉浸挂载布局
    ? `display:block;width:100%;height:100%;max-width:100%;max-height:100%;background:#000;aspect-ratio:${读取纵横比(
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

const 兼容RemotePlayback异步契约 = (video: 可原生全屏视频元素): void => {
  const remote = (video as 可原生全屏视频元素 & { remote?: 可兼容远端播放对象 }).remote;
  if (!remote || remote[远端播放Promise兼容标记]) {
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
  remote[远端播放Promise兼容标记] = true;
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
const KokoVideoSkinIcons = {
  play: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path fill="currentColor" d="m13.473 10.476-6.845 4.256a1.697 1.697 0 0 1-2.364-.547 1.77 1.77 0 0 1-.264-.93v-8.51C4 3.78 4.768 3 5.714 3c.324 0 .64.093.914.268l6.845 4.255a1.763 1.763 0 0 1 0 2.953"/></svg>`,
  pause: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><rect width="4" height="12" x="3" y="3" fill="currentColor" rx="1.75"/><rect width="4" height="12" x="11" y="3" fill="currentColor" rx="1.75"/></svg>`,
  restart: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path fill="currentColor" d="M9 17a8 8 0 0 1-8-8h1.5a6.5 6.5 0 1 0 1.43-4.07l1.643 1.643A.25.25 0 0 1 5.396 7H1.25A.25.25 0 0 1 1 6.75V2.604a.25.25 0 0 1 .427-.177l1.438 1.438A8 8 0 1 1 9 17"/><path fill="currentColor" d="m11.61 9.639-3.331 2.07a.826.826 0 0 1-1.15-.266.86.86 0 0 1-.129-.452V6.849C7 6.38 7.374 6 7.834 6c.158 0 .312.045.445.13l3.331 2.071a.858.858 0 0 1 0 1.438"/></svg>`,
  volumeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path fill="currentColor" d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752M14.5 7.586l-1.768-1.768a1 1 0 1 0-1.414 1.414L13.085 9l-1.767 1.768a1 1 0 0 0 1.414 1.414l1.768-1.768 1.768 1.768a1 1 0 0 0 1.414-1.414L15.914 9l1.768-1.768a1 1 0 0 0-1.414-1.414z"/></svg>`,
  volumeLow: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path fill="currentColor" d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"/></svg>`,
  volumeHigh: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true" viewBox="0 0 18 18"><path fill="currentColor" d="M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7"/><path fill="currentColor" d="M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"/></svg>`,
} as const;

const KokoVideoSkinTemplate = `
  <style>
    :host {
      display: grid;
      width: 100%;
      height: 100%;
      color: #fff;
      font-family: inherit;
    }
    media-container {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000;
      border-radius: inherit;
    }
    ::slotted(video[slot="media"]) {
      display: block;
      width: 100%;
      height: 100%;
      background: #000;
      object-fit: contain;
    }
    media-buffering-indicator {
      position: absolute;
      inset: 0;
      display: none;
      place-items: center;
      pointer-events: none;
    }
    media-buffering-indicator[data-visible] {
      display: grid;
    }
    .koko-spinner {
      width: 2rem;
      height: 2rem;
      border: 2px solid rgb(255 255 255 / 0.25);
      border-top-color: #fff;
      border-radius: 999px;
      animation: koko-video-spin 0.8s linear infinite;
    }
    @keyframes koko-video-spin {
      to { transform: rotate(360deg); }
    }
    media-controls {
      position: absolute;
      inset-inline: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: linear-gradient(to top, rgb(0 0 0 / 0.76), rgb(0 0 0 / 0));
      opacity: var(--media-controls-opacity, 1);
      transition: opacity 160ms ease-out;
    }
    :host([data-presentation="inline"]) media-controls {
      display: none;
      pointer-events: none;
    }
    :host([data-presentation="inline"]) media-buffering-indicator {
      display: none !important;
    }
    media-controls-group {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 0;
    }
    .koko-time-controls {
      flex: 1;
      gap: 0.625rem;
    }
    media-time {
      min-width: 3.75rem;
      color: rgb(255 255 255 / 0.88);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }
    media-time-slider {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 5rem;
      height: 2.75rem;
      cursor: pointer;
      touch-action: none;
      user-select: none;
    }
    media-slider-track {
      position: relative;
      width: 100%;
      height: 0.35rem;
      overflow: hidden;
      border-radius: 999px;
      background: rgb(255 255 255 / 0.24);
    }
    media-slider-buffer,
    media-slider-fill {
      position: absolute;
      inset-block: 0;
      left: 0;
      border-radius: inherit;
      pointer-events: none;
    }
    media-slider-buffer {
      width: var(--media-slider-buffer);
      background: rgb(255 255 255 / 0.26);
    }
    media-slider-fill {
      width: var(--media-slider-fill);
      background: #fff;
    }
    media-slider-thumb {
      position: absolute;
      top: 50%;
      left: var(--media-slider-fill);
      width: 1rem;
      height: 1rem;
      border-radius: 999px;
      background: #fff;
      translate: -50% -50%;
      opacity: 0;
      transition: opacity 140ms ease-out;
    }
    media-time-slider:hover media-slider-thumb,
    media-time-slider:focus-within media-slider-thumb {
      opacity: 1;
    }
    .koko-button {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      padding: 0;
      border: 0;
      border-radius: 0.5rem;
      background: transparent;
      color: inherit;
      cursor: pointer;
      touch-action: manipulation;
    }
    .koko-button:hover,
    .koko-button:focus-visible {
      background: rgb(255 255 255 / 0.12);
      outline: none;
    }
    .koko-icon {
      display: none;
      width: 1.25rem;
      height: 1.25rem;
      line-height: 0;
    }
    .koko-icon svg {
      width: 100%;
      height: 100%;
    }
    media-play-button[data-paused] .koko-icon--play,
    media-play-button[data-ended] .koko-icon--restart,
    media-play-button:not([data-paused]):not([data-ended]) .koko-icon--pause,
    media-mute-button[data-muted] .koko-icon--volume-off,
    media-mute-button:not([data-muted])[data-volume-level="low"] .koko-icon--volume-low,
    media-mute-button:not([data-muted]):not([data-volume-level="low"]) .koko-icon--volume-high {
      display: block;
    }
  </style>
  <media-container>
    <slot name="media"></slot>
    <slot></slot>
    <media-buffering-indicator><span class="koko-spinner" aria-hidden="true"></span></media-buffering-indicator>
    <media-controls>
      <media-controls-group>
        <media-play-button class="koko-button">
          <span class="koko-icon koko-icon--play" aria-hidden="true">${KokoVideoSkinIcons.play}</span>
          <span class="koko-icon koko-icon--pause" aria-hidden="true">${KokoVideoSkinIcons.pause}</span>
          <span class="koko-icon koko-icon--restart" aria-hidden="true">${KokoVideoSkinIcons.restart}</span>
        </media-play-button>
      </media-controls-group>
      <media-controls-group class="koko-time-controls">
        <media-time type="current"></media-time>
        <media-time-slider>
          <media-slider-track>
            <media-slider-buffer></media-slider-buffer>
            <media-slider-fill></media-slider-fill>
          </media-slider-track>
          <media-slider-thumb></media-slider-thumb>
        </media-time-slider>
        <media-time type="duration"></media-time>
      </media-controls-group>
      <media-controls-group>
        <media-mute-button class="koko-button">
          <span class="koko-icon koko-icon--volume-off" aria-hidden="true">${KokoVideoSkinIcons.volumeOff}</span>
          <span class="koko-icon koko-icon--volume-low" aria-hidden="true">${KokoVideoSkinIcons.volumeLow}</span>
          <span class="koko-icon koko-icon--volume-high" aria-hidden="true">${KokoVideoSkinIcons.volumeHigh}</span>
        </media-mute-button>
      </media-controls-group>
    </media-controls>
    <media-hotkey keys="Space" action="togglePaused"></media-hotkey>
    <media-hotkey keys="k" action="togglePaused"></media-hotkey>
    <media-hotkey keys="m" action="toggleMuted"></media-hotkey>
  </media-container>
`;

const 格式化媒体时间 = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainSeconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainSeconds.toString().padStart(2, "0")}`;
};

const 约束百分比字符串 = (ratio: number): string => {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return `${clamped * 100}%`;
};

const 读取视频缓冲比例 = (video: 可原生全屏视频元素): number => {
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return 0;
  }
  try {
    if ((video.buffered?.length ?? 0) <= 0) {
      return 0;
    }
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (currentTime >= start && currentTime <= end) {
        return end / video.duration;
      }
    }
    return video.buffered.end(video.buffered.length - 1) / video.duration;
  } catch {
    return 0;
  }
};

const 绑定KokoVideoSkin控件 = (host: HTMLElement, shadowRoot: ShadowRoot): (() => void) => {
  const 媒体插槽 = shadowRoot.querySelector('slot[name="media"]') as HTMLSlotElement | null;
  const 播放按钮 = shadowRoot.querySelector("media-play-button") as HTMLElement | null;
  const 静音按钮 = shadowRoot.querySelector("media-mute-button") as HTMLElement | null;
  const 当前时间标签 = shadowRoot.querySelector('media-time[type="current"]') as HTMLElement | null;
  const 总时长标签 = shadowRoot.querySelector('media-time[type="duration"]') as HTMLElement | null;
  const 时间滑杆 = shadowRoot.querySelector("media-time-slider") as HTMLElement | null;
  const 加载指示层 = shadowRoot.querySelector("media-buffering-indicator") as HTMLElement | null;
  const 热键节点列表 = Array.from(shadowRoot.querySelectorAll("media-hotkey")) as HTMLElement[];

  let 当前视频: 可原生全屏视频元素 | null = null;
  let 解绑当前视频监听 = (): void => undefined;
  let 等待态起点时间: number | null = null;
  let 正在拖动进度 = false;
  const 解绑控件监听列表: Array<() => void> = [];

  const 监听控件事件 = (target: EventTarget | null, type: string, listener: EventListener): void => {
    if (!target) {
      return;
    }
    target.addEventListener(type, listener);
    解绑控件监听列表.push(() => target.removeEventListener(type, listener));
  };

  const 读取有效时长 = (video: HTMLVideoElement): number =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

  const 等待态已经被播放推进 = (video: HTMLVideoElement): boolean =>
    等待态起点时间 !== null &&
    Number.isFinite(video.currentTime) &&
    Math.abs(video.currentTime - 等待态起点时间) > 等待态时间推进判定阈值秒;

  const 同步控件展示 = (): void => {
    if (!播放按钮 || !静音按钮 || !当前时间标签 || !总时长标签 || !时间滑杆 || !加载指示层) {
      return;
    }
    const video = 当前视频;
    if (!video) {
      播放按钮.setAttribute("data-paused", "");
      播放按钮.removeAttribute("data-ended");
      静音按钮.setAttribute("data-muted", "");
      静音按钮.setAttribute("data-volume-level", "low");
      当前时间标签.textContent = "0:00";
      总时长标签.textContent = "0:00";
      时间滑杆.style.setProperty("--media-slider-fill", "0%");
      时间滑杆.style.setProperty("--media-slider-buffer", "0%");
      时间滑杆.setAttribute("aria-valuemin", "0");
      时间滑杆.setAttribute("aria-valuemax", "0");
      时间滑杆.setAttribute("aria-valuenow", "0");
      加载指示层.removeAttribute("data-visible");
      return;
    }

    if (等待态已经被播放推进(video)) {
      等待态起点时间 = null;
    }

    if (video.ended) {
      播放按钮.setAttribute("data-ended", "");
      播放按钮.removeAttribute("data-paused");
    } else if (video.paused) {
      播放按钮.setAttribute("data-paused", "");
      播放按钮.removeAttribute("data-ended");
    } else {
      播放按钮.removeAttribute("data-paused");
      播放按钮.removeAttribute("data-ended");
    }

    const muted = video.muted || video.volume <= 0;
    if (muted) {
      静音按钮.setAttribute("data-muted", "");
    } else {
      静音按钮.removeAttribute("data-muted");
    }
    静音按钮.setAttribute("data-volume-level", muted || video.volume < 0.5 ? "low" : "high");

    const duration = 读取有效时长(video);
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    当前时间标签.textContent = 格式化媒体时间(currentTime);
    总时长标签.textContent = 格式化媒体时间(video.duration);
    时间滑杆.style.setProperty(
      "--media-slider-fill",
      约束百分比字符串(duration > 0 ? currentTime / duration : 0)
    );
    时间滑杆.style.setProperty("--media-slider-buffer", 约束百分比字符串(读取视频缓冲比例(video)));
    时间滑杆.setAttribute("aria-valuemin", "0");
    时间滑杆.setAttribute("aria-valuemax", String(Math.round(duration)));
    时间滑杆.setAttribute("aria-valuenow", String(Math.round(currentTime)));

    /**
     * loading 圆圈只表达“播放真的卡在等待点”，不能表达“readyState 短暂低于未来帧”。
     * Video.js 官方历史修复也是等播放时间真正越过 waiting 触发点后再撤等待态；
     * 这里把等待真相收口到同一颗真实 video 的事件流，避免全屏壳层残留第二套 loading 判断。
     */
    const 缺少当前帧 = !!video.currentSrc && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;
    const 仍卡在等待点 =
      等待态起点时间 !== null &&
      !等待态已经被播放推进(video) &&
      !!video.currentSrc;
    const 应显示加载态 = !video.ended && !video.paused && (video.seeking || 缺少当前帧 || 仍卡在等待点);
    if (应显示加载态) {
      加载指示层.setAttribute("data-visible", "");
    } else {
      加载指示层.removeAttribute("data-visible");
    }
  };

  const 切到指定进度 = (clientX: number): void => {
    if (!当前视频 || !时间滑杆) {
      return;
    }
    const duration = 读取有效时长(当前视频);
    if (duration <= 0) {
      return;
    }
    const rect = 时间滑杆.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    当前视频.currentTime = duration * ratio;
    等待态起点时间 = 当前视频.currentTime;
    同步控件展示();
  };

  const 开始拖动进度 = (event: PointerEvent): void => {
    if (!当前视频 || 读取有效时长(当前视频) <= 0) {
      return;
    }
    正在拖动进度 = true;
    event.preventDefault();
    时间滑杆?.focus();
    try {
      时间滑杆?.setPointerCapture?.(event.pointerId);
    } catch {
      // 某些测试环境不实现 pointer capture；真实浏览器会用它保证拖出滑杆后仍连续 seek。
    }
    切到指定进度(event.clientX);
  };

  const 拖动进度中 = (event: PointerEvent): void => {
    if (!正在拖动进度) {
      return;
    }
    event.preventDefault();
    切到指定进度(event.clientX);
  };

  const 结束拖动进度 = (event: PointerEvent): void => {
    if (!正在拖动进度) {
      return;
    }
    event.preventDefault();
    正在拖动进度 = false;
    try {
      时间滑杆?.releasePointerCapture?.(event.pointerId);
    } catch {
      // 与 setPointerCapture 对称：没有实现时不影响点击与键盘 seek。
    }
    同步控件展示();
  };

  const 切换播放状态 = (): void => {
    if (!当前视频) {
      return;
    }
    if (当前视频.ended) {
      当前视频.currentTime = 0;
    }
    if (当前视频.paused || 当前视频.ended) {
      void 当前视频.play().catch(() => undefined);
      return;
    }
    当前视频.pause();
  };

  const 切换静音状态 = (): void => {
    if (!当前视频) {
      return;
    }
    当前视频.muted = !当前视频.muted;
    同步控件展示();
  };

  const 绑定视频监听 = (video: 可原生全屏视频元素 | null): void => {
    解绑当前视频监听();
    当前视频 = video;
    等待态起点时间 = null;
    if (!video) {
      同步控件展示();
      return;
    }

    const 解绑列表: Array<() => void> = [];
    const 监听视频事件 = (type: string, listener: EventListener): void => {
      video.addEventListener(type, listener);
      解绑列表.push(() => video.removeEventListener(type, listener));
    };

    const 更新展示 = (): void => {
      同步控件展示();
    };
    const 标记等待点 = (): void => {
      等待态起点时间 = Number.isFinite(video.currentTime) ? video.currentTime : null;
      同步控件展示();
    };
    const 标记播放推进 = (): void => {
      if (等待态已经被播放推进(video)) {
        等待态起点时间 = null;
      }
      同步控件展示();
    };
    const 清掉等待点并同步 = (): void => {
      等待态起点时间 = null;
      同步控件展示();
    };

    ["play", "pause", "ended", "volumechange", "durationchange", "loadedmetadata", "progress", "error"].forEach(
      (eventName) => 监听视频事件(eventName, 更新展示)
    );
    监听视频事件("timeupdate", 标记播放推进);
    监听视频事件("waiting", 标记等待点);
    监听视频事件("seeking", 标记等待点);
    ["seeked", "playing", "canplay", "canplaythrough"].forEach((eventName) =>
      监听视频事件(eventName, 清掉等待点并同步)
    );
    监听视频事件("emptied", 清掉等待点并同步);

    解绑当前视频监听 = (): void => {
      for (const dispose of 解绑列表) {
        dispose();
      }
      解绑列表.length = 0;
    };
    同步控件展示();
  };

  if (播放按钮) {
    播放按钮.tabIndex = 0;
    播放按钮.setAttribute("role", "button");
    播放按钮.setAttribute("aria-label", "播放或暂停");
    监听控件事件(播放按钮, "click", () => {
      切换播放状态();
    });
    监听控件事件(播放按钮, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        切换播放状态();
      }
    });
  }

  if (静音按钮) {
    静音按钮.tabIndex = 0;
    静音按钮.setAttribute("role", "button");
    静音按钮.setAttribute("aria-label", "静音");
    监听控件事件(静音按钮, "click", () => {
      切换静音状态();
    });
    监听控件事件(静音按钮, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        切换静音状态();
      }
    });
  }

  if (时间滑杆) {
    时间滑杆.tabIndex = 0;
    时间滑杆.setAttribute("role", "slider");
    时间滑杆.setAttribute("aria-label", "播放进度");
    监听控件事件(时间滑杆, "click", (event) => {
      切到指定进度((event as MouseEvent).clientX);
    });
    监听控件事件(时间滑杆, "pointerdown", (event) => {
      开始拖动进度(event as PointerEvent);
    });
    监听控件事件(时间滑杆, "pointermove", (event) => {
      拖动进度中(event as PointerEvent);
    });
    监听控件事件(时间滑杆, "pointerup", (event) => {
      结束拖动进度(event as PointerEvent);
    });
    监听控件事件(时间滑杆, "pointercancel", (event) => {
      结束拖动进度(event as PointerEvent);
    });
    监听控件事件(时间滑杆, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (!当前视频 || 读取有效时长(当前视频) <= 0) {
        return;
      }
      if (keyboardEvent.key === "ArrowLeft") {
        keyboardEvent.preventDefault();
        当前视频.currentTime = Math.max(0, 当前视频.currentTime - 5);
        同步控件展示();
      }
      if (keyboardEvent.key === "ArrowRight") {
        keyboardEvent.preventDefault();
        当前视频.currentTime = Math.min(读取有效时长(当前视频), 当前视频.currentTime + 5);
        同步控件展示();
      }
    });
  }

  if (!host.hasAttribute("tabindex")) {
    host.tabIndex = -1;
  }
  监听控件事件(host, "keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    const 命中热键动作 = 热键节点列表.find(
      (node) => (node.getAttribute("keys") ?? "").toLowerCase() === keyboardEvent.key.toLowerCase()
    );
    const action = 命中热键动作?.getAttribute("action");
    if (!action) {
      return;
    }
    if (action === "togglePaused") {
      keyboardEvent.preventDefault();
      切换播放状态();
    }
    if (action === "toggleMuted") {
      keyboardEvent.preventDefault();
      切换静音状态();
    }
  });

  const 刷新当前视频引用 = (): void => {
    const assignedCandidate = 媒体插槽
      ?.assignedElements({ flatten: true })
      .find((element): element is 可原生全屏视频元素 => element instanceof HTMLVideoElement);
    const hostCandidate = host.querySelector("video[slot='media'], video");
    绑定视频监听(
      assignedCandidate ?? (hostCandidate instanceof HTMLVideoElement ? hostCandidate : null)
    );
  };

  监听控件事件(媒体插槽, "slotchange", 刷新当前视频引用);
  刷新当前视频引用();

  return (): void => {
    解绑当前视频监听();
    当前视频 = null;
    等待态起点时间 = null;
    正在拖动进度 = false;
    for (const dispose of 解绑控件监听列表) {
      dispose();
    }
    解绑控件监听列表.length = 0;
  };
};

const 注册KokoVideoSkin元素 = (): void => {
  if (typeof globalThis.customElements === "undefined" || typeof HTMLElement === "undefined") {
    return;
  }
  if (globalThis.customElements.get(KokoVideoSkinTagName)) {
    return;
  }
  class KokoVideoSkinElement extends HTMLElement {
    private 清理控件绑定: (() => void) | null = null;

    connectedCallback() {
      const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      if (!this.shadowRoot || shadowRoot.childElementCount === 0) {
        shadowRoot.innerHTML = KokoVideoSkinTemplate;
      }
      if (!this.清理控件绑定) {
        this.清理控件绑定 = 绑定KokoVideoSkin控件(this, shadowRoot);
      }
    }

    disconnectedCallback() {
      this.清理控件绑定?.();
      this.清理控件绑定 = null;
    }
  }
  globalThis.customElements.define(KokoVideoSkinTagName, KokoVideoSkinElement);
};

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
  video.style.cssText = "display:block;width:100%;height:100%;background:#000;";
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
  兼容RemotePlayback异步契约(root.video);

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
