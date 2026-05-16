import type { 媒体资产分发表面 } from "../聊天共享/契约.js";
import type { 媒体会话信号 } from "./媒体会话.js";
import type { 媒体播放位置 } from "./媒体播放.js";
import { 创建VideoJs播放器壳, 预热默认VideoJs元素 } from "./videojs播放器壳.js";
import {
  创建全局唯一播放器,
  读取默认全局唯一播放器,
  type 全局唯一播放器依赖,
  type 全局唯一播放器端口,
  type 全局唯一播放器查看器会话,
} from "./全局唯一播放器.js";
import {
  创建默认PhotoSwipeLightbox,
  启动同会话全屏策略,
  是异步媒体查看器结果,
  映射PhotoSwipe图片,
  映射VideoJs播放源,
  type 可原生全屏容器元素,
  type 同会话全屏策略控制器,
} from "./媒体查看器全屏策略.js";
import { 创建媒体查看器历史接管 } from "./媒体查看器历史接管.js";

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
      resumePosition?: 媒体播放位置 | null;
      width: number;
      height: number;
    };

export type 媒体查看器打开请求 = {
  startAttachmentId: string;
  items: 媒体查看器项目[];
};

type 媒体查看器视频项目 = Extract<媒体查看器项目, { kind: "video" }>;
type 媒体查看器图片项目 = Extract<媒体查看器项目, { kind: "image" }>;

export type PhotoSwipe数据源项目 = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type PhotoSwipe查看器选项 = {
  dataSource: PhotoSwipe数据源项目[];
  pswpModule?: () => Promise<unknown>;
  bgOpacity: number;
  loop: boolean;
  wheelToZoom: boolean;
  closeOnVerticalDrag: boolean;
  showHideAnimationType: "zoom" | "fade" | "none";
};

export type 媒体查看器实例 = {
  init?(): void;
  loadAndOpen?(index: number): boolean | void;
  同步?(item: 媒体查看器项目): void;
  destroy(): void;
  on?(
    eventName: "close" | "destroy" | "change" | "loadComplete",
    callback: (payload?: { slide?: { index?: number }; isError?: boolean }) => void
  ): void;
};

export type 媒体查看器工厂结果 = 媒体查看器实例 | Promise<媒体查看器实例>;
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
  onMediaSessionSignal?: (attachmentId: string, signal: 媒体会话信号) => void;
  onPlaybackPositionChanged?: (attachmentId: string, position: 媒体播放位置) => void;
  onViewportCaptureStart?: () => void;
  onViewportCaptureEnd?: () => void;
};

type 媒体查看器视口占用生命周期 = {
  开始视口占用(): void;
  结束视口占用(): void;
};

const 创建默认VideoJs播放器层 = async (
  item: 媒体查看器视频项目,
  lifecycle: 媒体查看器视口占用生命周期,
  hooks: 媒体查看器运行时钩子,
  playerOwner: 全局唯一播放器端口,
  options: {
    shouldAutoEnterFullscreen: boolean;
    shouldRequestSystemFullscreen?: boolean;
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
  mount.dataset.mediaViewerSystemFullscreen =
    使用沉浸查看器布局 && options.shouldRequestSystemFullscreen !== false ? "true" : "false";
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
      resumePosition: item.resumePosition ?? null,
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
      /**
       * overlay 不立即移除，先透明化 + 禁交互 + 撤销 ARIA 语义：
       * 1. 同步 remove 会在 Lit re-render 之前暴露时间线卡片，
       *    此时冻结帧 canvas 可能因 GPU context loss 而内容为空 → 黑闪；
       * 2. 透明 overlay 保持覆盖 2-3 帧，给 Lit 足够时间重绘冻结帧/切换 autoplay 表面；
       * 3. ARIA 属性必须同步移除，否则 iOS Safari VoiceOver 会继续拦截焦点。
       */
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;opacity:0;pointer-events:none;";
      overlay.removeAttribute("role");
      overlay.removeAttribute("aria-modal");
      overlay.removeAttribute("aria-label");
      lifecycle.结束视口占用();
      const 安全移除overlay = (): void => { overlay.remove(); };
      requestAnimationFrame(() => { requestAnimationFrame(安全移除overlay); });
      setTimeout(安全移除overlay, 200);
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
          允许系统全屏: options.shouldRequestSystemFullscreen !== false,
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
          resumePosition: nextItem.resumePosition ?? null,
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
          /**
           * PhotoSwipe v5 故意不内置 history 模块，路由责任交宿主接：
           * 1. 进入查看器先把"返回键归属"压一条 pushState；
           * 2. 用户按物理返回键 / 浏览器后退时 popstate 触发，程序化 close lightbox（带 PhotoSwipe 关闭动画）而不是退出群聊；
           * 3. 用户从查看器内部关闭（点关闭按钮 / ESC / 拖拽 / 背景）时，历史接管.消费() 把入口 entry history.back 回去，保 history 干净。
           */
          const 历史接管 = 创建媒体查看器历史接管({
            sessionId: `image-${generation}`,
            onUserBackPressed: () => {
              /**
               * PhotoSwipe v5 的程序化关闭只能通过 lightbox.pswp?.close()，它走 close 动画并随后 destroy；
               * lightbox.destroy() 仅解绑 lightbox 本体的事件监听器，不会关闭打开中的 instance。
               * 真拿不到 pswp 时再回退到销毁 lightbox 自己，至少把视口让回聊天。
               */
              try {
                const lightboxWithPswp = lightbox as 媒体查看器实例 & {
                  pswp?: { close?: () => void };
                };
                if (typeof lightboxWithPswp.pswp?.close === "function") {
                  lightboxWithPswp.pswp.close();
                  return;
                }
                lightbox.destroy();
              } catch {
                // 即便关闭失败，也不能让 popstate 把整页带走；继续进入释放视口与关闭通知。
              }
            },
          });
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
            历史接管.消费();
            releaseViewport();
            通知查看器关闭();
          });
          lightbox.on?.("destroy", () => {
            历史接管.释放();
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
          历史接管.接管();
          lightbox.init?.();
          if (lightbox.loadAndOpen?.(imageStartAt) === false) {
            历史接管.释放();
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
           * 显式打开正式视频查看器，本身就是“进入沉浸观看”的明确用户意图。
           * Video.js v10 的官方 fullscreen 模型是 container-first、media element fallback：
           * 只要浏览器允许，就应让同一颗 player/container 进入系统真全屏；
           * 只有缺少系统 fullscreen 能力或失去用户激活时，才退回应用内沉浸兜底。
           */
          shouldAutoEnterFullscreen: true,
          shouldRequestSystemFullscreen: true,
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
