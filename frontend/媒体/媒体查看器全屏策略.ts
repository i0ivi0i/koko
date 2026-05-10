import type { VideoJs全屏进入结果, VideoJs播放器源描述 } from "./videojs播放器壳.js";
import { 判定播放连续性表面 } from "./视频可见槽位协议.js";
import {
  创建媒体查看器历史接管,
  type 媒体查看器历史接管,
} from "./媒体查看器历史接管.js";
import type {
  PhotoSwipe数据源项目,
  PhotoSwipe查看器选项,
  媒体查看器工厂结果,
  媒体查看器实例,
  媒体查看器项目,
} from "./媒体查看器.js";

type 媒体查看器视频项目 = Extract<媒体查看器项目, { kind: "video" }>;
type 媒体查看器图片项目 = Extract<媒体查看器项目, { kind: "image" }>;

type PhotoSwipe查看器工厂 = (options: PhotoSwipe查看器选项) => 媒体查看器工厂结果;
type PhotoSwipeLightbox构造器 = new (options: PhotoSwipe查看器选项) => 媒体查看器实例;
type 可原生全屏视频元素 = HTMLVideoElement & {
  webkitExitFullscreen?: () => void;
  webkitExitFullScreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
};
export type 可原生全屏容器元素 = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};
type 媒体方向锁 = "portrait" | "landscape";
export type 同会话全屏策略控制器 = {
  清理(): void;
  请求关闭(): void;
};
type 可锁定屏幕方向 = ScreenOrientation & {
  lock?: (orientation: 媒体方向锁) => Promise<void>;
  unlock?: () => void;
};

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

export const 映射PhotoSwipe图片 = (item: 媒体查看器图片项目): PhotoSwipe数据源项目 => ({
  src: item.src,
  width: Math.max(1, item.width),
  height: Math.max(1, item.height),
  alt: item.alt,
});

export const 创建默认PhotoSwipeLightbox: PhotoSwipe查看器工厂 = async (options) => {
  const module = await import("photoswipe/lightbox");
  const Lightbox = module.default as unknown as PhotoSwipeLightbox构造器;
  return new Lightbox(options);
};

export const 是异步媒体查看器结果 = <T>(result: T | Promise<T>): result is Promise<T> =>
  typeof (result as Promise<T>).then === "function";

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
 * 在这段窗口里，新会话仍要尝试 Video.js container-first 真全屏，
 * 同时保证沉浸布局先可用；否则首击会像没进全屏，等一会再点一次才恢复。
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

export const 映射VideoJs播放源 = (item: 媒体查看器视频项目): VideoJs播放器源描述 => ({
  kind: "file",
  src: item.src,
  posterSrc: item.posterSrc,
  width: item.width,
  height: item.height,
});

export const 启动同会话全屏策略 = (
  读取当前项目: () => 媒体查看器视频项目,
  container: 可原生全屏容器元素,
  video: 可原生全屏视频元素,
  请求播放器壳进入全屏: () => Promise<VideoJs全屏进入结果>,
  回收查看器: () => void,
  options: {
    允许系统全屏?: boolean;
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
  const 历史接管: 媒体查看器历史接管 = 创建媒体查看器历史接管({
    sessionId,
    onUserBackPressed: () => {
      closeFullscreen();
    },
  });
  let videoOrientation = 读取视频方向锁(读取当前项目());
  const 允许系统全屏 = options.允许系统全屏 !== false;

  const startPlayback = (): void => {
    const currentItem = 读取当前项目();
    const currentSrc = video.currentSrc || video.getAttribute("src") || currentItem.src;
    const currentPosition =
      currentSrc && Number.isFinite(video.currentTime) && video.currentTime >= 0
        ? { src: currentSrc, currentTime: video.currentTime, updatedAt: Date.now() }
        : null;
    const decision = 判定播放连续性表面({
      attachmentId: currentItem.attachmentId,
      ownerAttachmentId: currentItem.attachmentId,
      surface: "fullscreen",
      source: { src: currentSrc },
      savedPosition: currentPosition,
      dom: {
        previewReadyState: video.readyState,
        canonicalReadyState: video.readyState,
        previewCommitted: video.readyState >= 2,
        canonicalCommitted: video.readyState >= 2,
        sourceMatches: Boolean(currentSrc),
      },
      host: {
        exists: container.isConnected,
        hasStableFrame: video.readyState >= 2 || Boolean(currentPosition),
      },
      frameEvidence:
        Boolean(currentSrc) && video.readyState >= 2 && Number.isFinite(video.currentTime)
          ? {
              kind: "canonical_frame",
              src: currentSrc,
              currentTime: video.currentTime,
            }
          : { kind: "none" },
      intent: { viewerOpen: false, fullscreen: true },
    });
    if (decision.kind === "cold_placeholder" || decision.kind === "retire") {
      return;
    }
    /**
     * 全屏不是第二套播放模型，只是当前 viewer 会话的展示意图。
     * 因此是否继续播放也先过全局连续性状态链：无源、宿主未挂载或退场时不抢播；
     * 有同源当前位置时继续同一颗 video，不重建、不清零、不另开原生旁路。
     */
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
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    video.removeEventListener("loadedmetadata", syncOrientationFromVideoMetadata);
    video.removeEventListener("webkitbeginfullscreen", handleNativeVideoFullscreenStart);
    video.removeEventListener("webkitendfullscreen", handleNativeVideoFullscreenEnd);
    unlockScreenOrientation();
    历史接管.消费();
  };
  const closeFullscreen = (): void => {
    if (
      是本会话全屏元素(document.fullscreenElement) &&
      typeof document.exitFullscreen === "function"
    ) {
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
  历史接管.接管();

  startPlayback();
  /**
   * 即便上一会话的 exitFullscreen 仍在浏览器结算窗口里，新会话首击也必须尝试一次真全屏。
   * 具体的 container-first / media-fallback 进入动作交给 Video.js 播放器壳，
   * viewer 这里只维护聊天应用需要的会话、history、显示阶段和回收顺序。
   */
  const 标准全屏可能挂起 =
    允许系统全屏 && typeof container.requestFullscreen === "function";
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
  if (!允许系统全屏) {
    /**
     * 只有系统 fullscreen 不可用或被调用方显式关闭时，才退回应用内沉浸会话。
     * 方向锁仍作为最佳努力增强，失败时浏览器会安静拒绝。
     */
    lockScreenOrientation();
  }
  if (允许系统全屏 && !当前明确缺少用户激活) {
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
