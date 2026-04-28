import type { 媒体资产分发表面 } from "../契约.js";
import type { 媒体会话信号 } from "./媒体会话.js";
import type { 媒体播放位置 } from "./媒体播放.js";
import type {
  VideoJs播放器源描述,
  VideoJs全屏进入结果,
} from "./videojs播放器壳.js";
import { 创建VideoJs播放器壳, 预热默认VideoJs元素 } from "./videojs播放器壳.js";
import {
  创建全局唯一播放器,
  读取默认全局唯一播放器,
  type 全局唯一播放器依赖,
  type 全局唯一播放器端口,
  type 全局唯一播放器查看器会话,
} from "./全局唯一播放器.js";

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
  广播播放位置(attachmentId: string, position: 媒体播放位置): void;
  通知查看器已关闭?(): void;
};
type PhotoSwipe查看器工厂 = (options: PhotoSwipe查看器选项) => 媒体查看器工厂结果;
type VideoJs播放器壳工厂 = NonNullable<全局唯一播放器依赖["createVideoJsPlayerShell"]>;

export type 媒体查看器依赖 = {
  createPhotoSwipeLightbox?: PhotoSwipe查看器工厂;
  createVideoJsPlayerShell?: VideoJs播放器壳工厂;
  globalVideoPlayer?: 全局唯一播放器端口;
  isMobileViewport?: () => boolean;
  onMediaSessionSignal?: (attachmentId: string, signal: 媒体会话信号) => void;
  onPlaybackPositionChanged?: (attachmentId: string, position: 媒体播放位置) => void;
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
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
};
type 可原生全屏容器元素 = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};
type 媒体方向锁 = "portrait" | "landscape";
type 同会话全屏策略控制器 = {
  清理(): void;
  请求关闭(): void;
};
type 可锁定屏幕方向 = ScreenOrientation & {
  lock?: (orientation: 媒体方向锁) => Promise<void>;
  unlock?: () => void;
};

const 媒体全屏历史键 = "__kokoMediaFullscreenSession";

const 退出原生视频真全屏 = (video: 可原生全屏视频元素): boolean => {
  try {
    if (typeof video.webkitExitFullscreen === "function") {
      video.webkitExitFullscreen();
      return true;
    }
    if (typeof video.webkitExitFullScreen === "function") {
      video.webkitExitFullScreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

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

/**
 * 显式关闭旧查看器后，浏览器的系统全屏退场可能会晚于壳层 owner 收尾。
 * 在这段窗口里，新会话必须先保证应用内沉浸布局可用，而不是继续把“马上再拿到系统全屏”
 * 当成唯一真相，否则移动端就会出现首击像没进全屏、等一会再点一次才恢复的错觉。
 */
let 存在待结算的系统全屏退出 = false;

const 读取视频元素方向锁 = (video: HTMLVideoElement): 媒体方向锁 | null => {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }
  return 读取宽高方向锁(video.videoWidth, video.videoHeight);
};

const 读取屏幕方向 = (): 可锁定屏幕方向 | null =>
  (globalThis.screen?.orientation as 可锁定屏幕方向 | undefined) ?? null;

const 映射VideoJs播放源 = (item: 媒体查看器视频项目): VideoJs播放器源描述 => ({
  kind: "file",
  src: item.src,
  posterSrc: item.posterSrc,
  width: item.width,
  height: item.height,
});

const 启动同会话全屏策略 = (
  读取当前项目: () => 媒体查看器视频项目,
  container: 可原生全屏容器元素,
  video: 可原生全屏视频元素,
  请求播放器壳进入全屏: () => Promise<VideoJs全屏进入结果>,
  回收查看器: () => void,
  options: {
    同步沉浸查看器显示阶段?: (phase: "pending" | "active") => void;
  } = {}
): 同会话全屏策略控制器 => {
  const sessionId = `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const 读取全屏Owner链 = (target: Element | null): Element[] => {
    if (!target) {
      return [];
    }
    const owners: Element[] = [target];
    let 当前节点: Element | null = target;
    while (当前节点) {
      const root: Node | null =
        typeof 当前节点.getRootNode === "function" ? 当前节点.getRootNode() : null;
      if (typeof ShadowRoot === "undefined" || !(root instanceof ShadowRoot)) {
        break;
      }
      const host: Element | null = root.host;
      if (!host || owners.includes(host)) {
        break;
      }
      /**
       * 浏览器可能把 shadow 内部节点的系统全屏状态上卷到 host（如 video-skin）。
       * owner 判定必须沿 host 链展开，避免“明明进了全屏却被误判没接管”。
       */
      owners.push(host);
      当前节点 = host;
    }
    return owners;
  };
  const 主目标Owner链 = 读取全屏Owner链(container);
  const 主目标Owner集合 = new Set<Element>(主目标Owner链);
  const 元素落在Owner链里 = (element: Element | null, owners: Set<Element>): boolean => {
    if (!element || owners.size === 0) {
      return false;
    }
    return 读取全屏Owner链(element).some((owner) => owners.has(owner));
  };
  const 是主全屏目标 = (element: Element | null): boolean =>
    元素落在Owner链里(element, 主目标Owner集合);
  const 是本会话全屏元素 = (element: Element | null): boolean => 是主全屏目标(element);
  const 同步沉浸查看器显示阶段 = (phase: "pending" | "active"): void => {
    options.同步沉浸查看器显示阶段?.(phase);
  };
  let cleaned = false;
  let 本会话已接管系统全屏 = 是本会话全屏元素(document.fullscreenElement);
  let 本会话正在原生视频全屏 = false;
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
  const handleNativeVideoFullscreenStart = (): void => {
    本会话已接管系统全屏 = true;
    本会话正在原生视频全屏 = true;
    同步沉浸查看器显示阶段("active");
    lockScreenOrientation();
  };
  const handleNativeVideoFullscreenEnd = (): void => {
    if (!本会话正在原生视频全屏 && !video.webkitDisplayingFullscreen) {
      return;
    }
    本会话正在原生视频全屏 = false;
    cleanup();
    回收查看器();
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
    video.removeEventListener("webkitbeginfullscreen", handleNativeVideoFullscreenStart);
    video.removeEventListener("webkitendfullscreen", handleNativeVideoFullscreenEnd);
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
      /**
       * 标准 Fullscreen API 的迟到 `fullscreenchange` 需要继续走全局“待结算退出”保护，
       * 否则上一条视频的退出事件会误打到下一条会话。
       * 这里沿用既有真相：先标记待结算，再启动浏览器退出，查看器本体立即回收；
       * 真正迟到的浏览器事件只负责清标志，不再二次驱动关闭。
       */
      存在待结算的系统全屏退出 = true;
      void document.exitFullscreen()
        .catch(() => undefined)
        .finally(() => {
          存在待结算的系统全屏退出 = false;
        });
      cleanup();
      回收查看器();
      return;
    }
    if (
      (本会话正在原生视频全屏 || video.webkitDisplayingFullscreen) &&
      退出原生视频真全屏(video)
    ) {
      return;
    }
    cleanup();
    回收查看器();
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
    if (是主全屏目标(document.fullscreenElement)) {
      本会话已接管系统全屏 = true;
      同步沉浸查看器显示阶段("active");
      lockScreenOrientation();
      startPlayback();
      return;
    }
    if (存在待结算的系统全屏退出 && !document.fullscreenElement) {
      return;
    }
    /**
     * 移动端第一次申请系统全屏、或上一会话迟到的退出事件，都可能抛出
     * `fullscreenchange` 但当前会话其实还没真正接管系统全屏。
     * 只有本会话确认进过系统全屏后，`null` 才代表“用户退出了当前会话”。
     */
    if (!本会话已接管系统全屏) {
      return;
    }
    if (!document.fullscreenElement) {
      if (本会话正在原生视频全屏 || video.webkitDisplayingFullscreen) {
        return;
      }
      cleanup();
      回收查看器();
    }
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
  const 处理播放器壳进入全屏结果 = (result: VideoJs全屏进入结果): void => {
    if (cleaned) {
      return;
    }
    if (result === "standard") {
      本会话已接管系统全屏 = 是本会话全屏元素(document.fullscreenElement);
    } else if (result === "native") {
      本会话已接管系统全屏 = true;
      本会话正在原生视频全屏 = true;
    }
    同步沉浸查看器显示阶段("active");
    lockScreenOrientation();
    startPlayback();
  };

  container.dataset.videoOrientation = videoOrientation ?? "natural";
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  video.addEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
  video.addEventListener("webkitbeginfullscreen", handleNativeVideoFullscreenStart);
  video.addEventListener("webkitendfullscreen", handleNativeVideoFullscreenEnd);
  pushMediaHistoryEntry();

  startPlayback();
  /**
   * 即便上一会话的 exitFullscreen 仍在浏览器结算窗口里，新会话首击也必须尝试一次真全屏。
   * 具体的 container-first / media-fallback 进入动作交给 Video.js 播放器壳，
   * viewer 这里只维护聊天应用需要的会话、history、显示阶段和回收顺序。
   */
  const 标准全屏可能挂起 = typeof container.requestFullscreen === "function";
  const 当前明确缺少用户激活 = globalThis.navigator?.userActivation?.isActive === false;
  /**
   * 自动化脚本触发的 click 没有浏览器瞬时激活，继续 requestFullscreen 只会制造控制台噪音；
   * 真实用户点击和不支持 userActivation 的运行时仍按原全屏链路执行。
   */
  同步沉浸查看器显示阶段(
    标准全屏可能挂起 &&
      !当前明确缺少用户激活 &&
      !本会话已接管系统全屏 &&
      !本会话正在原生视频全屏
      ? "pending"
      : "active"
  );
  if (!当前明确缺少用户激活) {
    void 请求播放器壳进入全屏()
      .then(处理播放器壳进入全屏结果)
      .catch(() => {
        同步沉浸查看器显示阶段("active");
      });
  }

  return {
    清理: cleanup,
    请求关闭: closeFullscreen,
  };
};

const 创建默认VideoJs播放器层 = async (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子,
  playerOwner: 全局唯一播放器端口,
  options: {
    shouldAutoEnterFullscreen: boolean;
  }
): Promise<媒体查看器实例> => {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("当前环境没有可用的浏览器文档，无法打开 Video.js 媒体层");
  }

  const overlay = document.createElement("div") as 可原生全屏容器元素;
  const mount = document.createElement("div");
  const closeButton = document.createElement("button");
  let 关闭按钮宿主: HTMLElement = overlay;
  let 关闭按钮已挂载 = false;
  const 使用沉浸查看器布局 = options.shouldAutoEnterFullscreen;
  const 沉浸查看器可见样式 =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:0;opacity:1;pointer-events:auto;";
  const 沉浸查看器待接管样式 =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:transparent;padding:0;opacity:0;pointer-events:none;";
  const 对话查看器样式 =
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgb(0 0 0 / 0.92);padding:20px;";
  const 挂载关闭按钮 = (): void => {
    if (closeButton.parentElement === 关闭按钮宿主) {
      关闭按钮已挂载 = true;
      return;
    }
    closeButton.remove();
    关闭按钮宿主.append(closeButton);
    关闭按钮已挂载 = true;
  };
  const 卸载关闭按钮 = (): void => {
    if (!关闭按钮已挂载) {
      return;
    }
    closeButton.remove();
    关闭按钮已挂载 = false;
  };
  const 切换关闭按钮宿主 = (host: HTMLElement): void => {
    if (关闭按钮宿主 === host) {
      return;
    }
    /**
     * 关闭按钮必须跟着真正的 fullscreen owner 走：
     * 1. 真实浏览器的命中测试只认 top layer，不认“视觉上像在上面”的 document.body 叠层；
     * 2. 但 viewer 退场前又必须先把按钮从容器摘掉，不能跟着 canonical player 迁回时间线；
     * 3. 因此这里单独维护宿主切换，而不是把按钮永远钉死在 body overlay。
     */
    关闭按钮宿主 = host;
    if (关闭按钮已挂载) {
      挂载关闭按钮();
    }
  };
  const 同步沉浸查看器显示阶段 = (phase: "pending" | "active"): void => {
    if (!使用沉浸查看器布局) {
      overlay.dataset.mediaViewerFullscreenPhase = "active";
      overlay.style.cssText = 对话查看器样式;
      overlay.removeAttribute("aria-hidden");
      挂载关闭按钮();
      closeButton.style.opacity = "1";
      closeButton.style.pointerEvents = "auto";
      return;
    }
    /**
     * 沉浸查看器必须等待系统 fullscreen owner 真正接管后再亮起。
     * 否则在 requestFullscreen 挂起窗口里会先看到“放大一下 + 右上角关闭按钮”的脏动作。
     */
    overlay.dataset.mediaViewerFullscreenPhase = phase;
    overlay.style.cssText = phase === "active" ? 沉浸查看器可见样式 : 沉浸查看器待接管样式;
    if (phase === "active") {
      overlay.removeAttribute("aria-hidden");
      挂载关闭按钮();
      closeButton.style.opacity = "1";
      closeButton.style.pointerEvents = "auto";
      if (closeButton.isConnected && document.activeElement !== closeButton) {
        closeButton.focus();
      }
      return;
    }
    overlay.setAttribute("aria-hidden", "true");
    卸载关闭按钮();
  };

  overlay.dataset.mediaViewerMode = "video";
  overlay.dataset.mediaViewerPresentation = 使用沉浸查看器布局 ? "immersive" : "dialog";
  mount.dataset.mediaViewerMount = "video";
  mount.dataset.mediaViewerImmersive = 使用沉浸查看器布局 ? "true" : "false";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "视频查看器");
  overlay.style.cssText = 使用沉浸查看器布局 ? 沉浸查看器待接管样式 : 对话查看器样式;
  /**
   * 查看器必须先给播放器壳一个明确的挂载盒子：
   * 1. 尺寸上限属于查看器 overlay，本身就是 shell 的职责；
   * 2. provider/container/video 之后都只跟这一个盒子算宽高；
   * 3. 避免父盒子是 auto/0 宽时，下面一整串媒体节点一起塌成 0x0。
   */
  mount.style.cssText = 使用沉浸查看器布局
    ? "display:grid;place-items:center;width:100%;height:100%;max-width:100%;min-width:0;"
    : "display:block;width:100%;max-width:1120px;min-width:0;";

  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.setAttribute("aria-label", "关闭视频查看器");
  closeButton.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;border:1px solid rgb(255 255 255 / 0.35);border-radius:8px;background:rgb(0 0 0 / 0.7);color:white;padding:8px 12px;font:inherit;";
  同步沉浸查看器显示阶段(使用沉浸查看器布局 ? "pending" : "active");

  overlay.append(mount);
  document.body.append(overlay);
  lifecycle.开始视口占用();

  let 当前视频项目 = item;
  let cleaned = false;
  let 清理全屏策略: 同会话全屏策略控制器 = {
    清理: () => undefined,
    请求关闭: () => undefined,
  };
  let 当前查看器会话: 全局唯一播放器查看器会话 | null = null;
  const 广播当前播放位置 = (
    attachmentId: string,
    video: HTMLVideoElement,
    force = false
  ): void => {
    const src = video.currentSrc || video.getAttribute("src") || 当前视频项目.src;
    if (!src || !Number.isFinite(video.currentTime) || video.currentTime < 0) {
      return;
    }
    /**
     * viewer 与时间线虽然展示态不同，但都共享同一颗 canonical player 的时间轴真相。
     * 因此这里直接把当前 video 的事实往外回灌，而不是在查看器里另存一份“退出前位置”私货。
     *
     * `force` 当前只作为语义文档：调用方在关闭/切源前会显式要求 flush；
     * 实际去重与“更晚事实”判断仍交给外层运行时完成，避免这里再长第二套节流真相。
     */
    void force;
    hooks.广播播放位置(attachmentId, {
      src,
      currentTime: video.currentTime,
      updatedAt: Date.now(),
    });
  };

  try {
    当前查看器会话 = await playerOwner.接管查看器({
      attachmentId: item.attachmentId,
      mountTarget: mount,
      source: 映射VideoJs播放源(item),
      回调: {
        广播媒体会话信号: (signal) => {
          hooks.发出媒体会话信号(item.attachmentId, signal);
        },
        广播播放位置: (video, force = false) => {
          广播当前播放位置(item.attachmentId, video, force);
        },
      },
    });
    const video = 当前查看器会话.读取视频元素();
    const container = 当前查看器会话.读取容器元素();
    if (!video || !container) {
      throw new Error("全局唯一播放器未能返回可用的 Video.js 宿主表面");
    }
    if (使用沉浸查看器布局) {
      切换关闭按钮宿主(container);
    }

    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      /**
       * 先回收外层 owner，再做浏览器和播放器收尾。
       * 这样即便系统全屏、history 或自定义元素销毁还在晚一拍结算，
       * 新会话也不会再误复用这颗已经进入退场链路的旧实例。
       */
      hooks.通知查看器已关闭?.();
      closeButton.removeEventListener("click", 请求关闭);
      overlay.removeEventListener("click", closeWhenClickingBackdrop);
      document.removeEventListener("keydown", closeWhenPressingEscape);
      清理全屏策略.清理();
      卸载关闭按钮();
      切换关闭按钮宿主(overlay);
      当前查看器会话?.关闭();
      video.pause();
      overlay.remove();
      lifecycle.结束视口占用();
    };
    清理全屏策略.请求关闭 = cleanup;
    const 请求关闭 = (): void => {
      /**
       * 所有“关闭当前视频查看器”的用户意图，都先交回同一条全屏策略 owner 链。
       * 这样标准 Fullscreen API、iPhone 的原生 webkit fullscreen，以及无全屏能力的普通对话框，
       * 都只维护一套退出与回收顺序，不会再出现壳层直接 cleanup、策略层却还没退全屏的双真相。
       */
      清理全屏策略.请求关闭();
    };
    const closeWhenClickingBackdrop = (event: MouseEvent): void => {
      if (event.target === overlay) {
        请求关闭();
      }
    };
    const closeWhenPressingEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        请求关闭();
      }
    };

    if (options.shouldAutoEnterFullscreen) {
      /**
       * 移动端允许 native fullscreen，但它必须只是同一壳上的展示策略。
       * 这里继续复用同一个查看器 surface + container/video，不再额外创建第二颗 video。
       */
      清理全屏策略 = 启动同会话全屏策略(
        () => 当前视频项目,
        container,
        video,
        () => 当前查看器会话?.进入全屏() ?? Promise.resolve("unsupported"),
        cleanup,
        {
          同步沉浸查看器显示阶段,
        }
      );
    }

    closeButton.addEventListener("click", 请求关闭);
    overlay.addEventListener("click", closeWhenClickingBackdrop);
    document.addEventListener("keydown", closeWhenPressingEscape);
    if (closeButton.isConnected) {
      closeButton.focus();
    }

    return {
      同步(nextItem) {
        if (nextItem.kind !== "video") {
          return;
        }
        当前视频项目 = nextItem;
        void 当前查看器会话?.同步({
          attachmentId: nextItem.attachmentId,
          source: 映射VideoJs播放源(nextItem),
          回调: {
            广播媒体会话信号: (signal) => {
              hooks.发出媒体会话信号(nextItem.attachmentId, signal);
            },
            广播播放位置: (video, force = false) => {
              广播当前播放位置(nextItem.attachmentId, video, force);
            },
          },
        });
      },
      destroy: cleanup,
    };
  } catch (error) {
    清理全屏策略.清理();
    当前查看器会话?.关闭();
    overlay.remove();
    lifecycle.结束视口占用();
    throw error;
  }
};

export function 创建媒体查看器(deps: 媒体查看器依赖 = {}) {
  /**
   * 提前把 Video.js 自定义元素注册好，避免用户首次点击视频时才触发动态 import，
   * 导致壳创建跨出手势窗口、后续容器全屏请求被浏览器按“无激活”拒绝。
   */
  void 预热默认VideoJs元素().catch(() => undefined);
  const createPhotoSwipeLightbox =
    deps.createPhotoSwipeLightbox ?? 创建默认PhotoSwipeLightbox;
  const globalVideoPlayer =
    deps.globalVideoPlayer ??
    (deps.createVideoJsPlayerShell
      ? 创建全局唯一播放器({
          createVideoJsPlayerShell: deps.createVideoJsPlayerShell,
        })
      : 读取默认全局唯一播放器());
  globalVideoPlayer.配置壳工厂((source, shellDeps = {}) =>
    (deps.createVideoJsPlayerShell ?? 创建VideoJs播放器壳)(source, {
      ...shellDeps,
    })
  );
  let current: 媒体查看器实例 | null = null;
  let openGeneration = 0;
  let 正在占用聊天视口 = false;
  let 当前起点附件标识: string | null = null;
  let 当前查看器请求: 媒体查看器打开请求 | null = null;
  let 当前查看器渲染类型: "image" | "video" | null = null;

  const 读取查看器渲染类型 = (item: 媒体查看器项目): "image" | "video" =>
    item.kind === "image" ? "image" : "video";
  const 读取查看器起点项目 = (
    request: 媒体查看器打开请求
  ): 媒体查看器项目 | null => {
    const startAt = request.items.findIndex(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (startAt < 0) {
      return null;
    }
    return request.items[startAt] ?? null;
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

  const 清空当前查看器状态 = (): void => {
    current = null;
    当前起点附件标识 = null;
    当前查看器请求 = null;
    当前查看器渲染类型 = null;
  };

  const 创建运行时钩子 = (generation: number): 媒体查看器运行时钩子 => ({
    发出媒体会话信号: (attachmentId, signal) => {
      deps.onMediaSessionSignal?.(attachmentId, signal);
    },
    广播播放位置: (attachmentId, position) => {
      deps.onPlaybackPositionChanged?.(attachmentId, position);
    },
    通知查看器已关闭: () => {
      /**
       * 只有当前仍然活着的那一代查看器，才有资格回收 owner。
       * 旧实例的异步收尾不允许把后来已经打开的新查看器一起清空。
       */
      if (generation !== openGeneration) {
        return;
      }
      清空当前查看器状态();
      视口占用生命周期.结束视口占用();
    },
  });

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
      const 最新起点项目 = 当前查看器请求
        ? 读取查看器起点项目(当前查看器请求)
        : null;
      /**
       * 异步工厂解析期间，上游可能只是在同一附件上刷新最新播放源。
       * 这里接管完成后立刻回放最新 request，避免 pending 窗口内再次 `打开`
       * 才能吃到新 src，或者被迫额外创建第二代查看器会话。
       */
      if (
        最新起点项目 &&
        读取查看器渲染类型(最新起点项目) === 当前查看器渲染类型 &&
        next.同步
      ) {
        当前起点附件标识 = 最新起点项目.attachmentId;
        next.同步(最新起点项目);
      }
    })().catch((error: unknown) => {
      if (generation === openGeneration) {
        清空当前查看器状态();
      }
      视口占用生命周期.结束视口占用();
      console.error("打开媒体查看器失败", error);
    });
  };

  const 打开 = (request: 媒体查看器打开请求): void => {
    const startItem = 读取查看器起点项目(request);
    if (!startItem) {
      return;
    }

    const nextRenderer = 读取查看器渲染类型(startItem);
    /**
     * 上游即使因为时序窗口再次发来 `打开`，同 renderer 且当前实例支持同步时，
     * 查看器自己也必须守住“同会话秒切不重建壳”的不变量。
     */
    if (current && nextRenderer === 当前查看器渲染类型 && current.同步) {
      当前查看器渲染类型 = nextRenderer;
      current.同步(startItem);
      return;
    }
    if (
      !current &&
      当前查看器请求 &&
      当前起点附件标识 === request.startAttachmentId &&
      nextRenderer === 当前查看器渲染类型
    ) {
      /**
       * 真正的查看器实例还在异步接管时，上游可能因为播放真相更新再次发来同附件 `打开`。
       * 这时只能刷新 pending request，不能再长出第二个 overlay / fullscreen session。
       */
      当前查看器请求 = request;
      当前起点附件标识 = request.startAttachmentId;
      当前查看器渲染类型 = nextRenderer;
      return;
    }

    const generation = ++openGeneration;
    const 运行时钩子 = 创建运行时钩子(generation);
    current?.destroy();
    清空当前查看器状态();
    当前查看器请求 = request;
    当前起点附件标识 = request.startAttachmentId;
    当前查看器渲染类型 = nextRenderer;

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
          let 已通知查看器关闭 = false;
          const 通知查看器关闭 = (): void => {
            if (已通知查看器关闭) {
              return;
            }
            已通知查看器关闭 = true;
            运行时钩子.通知查看器已关闭?.();
          };
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

          lightbox.on?.("close", () => {
            releaseViewport();
            通知查看器关闭();
          });
          lightbox.on?.("destroy", () => {
            releaseViewport();
            通知查看器关闭();
          });
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
            通知查看器关闭();
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
      创建默认VideoJs播放器层(
        startItem,
        视口占用生命周期,
        运行时钩子,
        globalVideoPlayer,
        {
          /**
           * 从消息流显式打开正式视频查看器，本身就是“进入沉浸观看”的明确用户意图。
           * 真全屏不该只在移动端成立；桌面端也沿同一条容器 owner 链尝试系统 fullscreen，
           * 失败时再自然回落到同一个查看器表面，而不是另起一套“桌面放大卡片”的假分支。
           */
          shouldAutoEnterFullscreen: true,
        }
      )
    );
  };

  const 同步 = (request: 媒体查看器打开请求): void => {
    当前查看器请求 = request;
    const nextAttachmentId = request.startAttachmentId;
    if (!nextAttachmentId) {
      return;
    }
    const activeItem = request.items.find((item) => item.attachmentId === nextAttachmentId);
    if (!activeItem) {
      return;
    }
    const nextRenderer = 读取查看器渲染类型(activeItem);
    if (nextRenderer !== 当前查看器渲染类型) {
      打开(request);
      return;
    }
    if (!current) {
      打开(request);
      return;
    }
    /**
     * 同 renderer 的附件切换不能再退回“销毁再打开”。
     * 只有当前实例根本不支持同步时，才允许重新打开。
     */
    if (nextAttachmentId !== 当前起点附件标识 && !current.同步) {
      打开(request);
      return;
    }
    当前起点附件标识 = nextAttachmentId;
    当前查看器渲染类型 = nextRenderer;
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
