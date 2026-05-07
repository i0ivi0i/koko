import type { 媒体会话信号 } from "./媒体会话.js";
import { 媒体是否默认循环播放, type 媒体播放位置 } from "./媒体播放.js";
import { 判定播放连续性表面 } from "./全局丝滑自动播.js";
import {
  创建VideoJs播放器壳,
  type VideoJs全屏进入结果,
  type VideoJs播放器壳依赖,
  type VideoJs播放器壳实例,
  type VideoJs播放器源描述,
} from "./videojs播放器壳.js";

type 时间线自动播回调 = {
  恢复播放位置(video: HTMLVideoElement): void;
  标记首帧已就绪(src: string | null): void;
  标记可见接管已就绪?(video: HTMLVideoElement): void;
  标记可见宿主已出帧?(video: HTMLVideoElement): void;
  广播播放位置(
    video: HTMLVideoElement,
    force?: boolean,
    allowReleasedOwner?: boolean
  ): void;
  广播媒体会话信号(signal: 媒体会话信号): void;
};

type 查看器媒体回调 = {
  广播媒体会话信号(signal: 媒体会话信号): void;
  广播播放位置(video: HTMLVideoElement, force?: boolean): void;
};

export type 全局唯一播放器时间线输入 = {
  attachmentId: string;
  mountTarget: HTMLElement | null;
  source: VideoJs播放器源描述;
  回调: 时间线自动播回调;
};

export type 全局唯一播放器查看器输入 = {
  attachmentId: string;
  mountTarget: HTMLElement;
  source: VideoJs播放器源描述;
  resumePosition?: 媒体播放位置 | null;
  回调: 查看器媒体回调;
};

export type 全局唯一播放器查看器会话 = {
  同步(input: Omit<全局唯一播放器查看器输入, "mountTarget">): Promise<void>;
  进入全屏(): Promise<VideoJs全屏进入结果>;
  读取视频元素(): HTMLVideoElement | null;
  读取容器元素(): HTMLElement | null;
  关闭(): void;
};

export type 全局唯一播放器依赖 = {
  createVideoJsPlayerShell?: (
    initialSource: VideoJs播放器源描述,
    deps?: VideoJs播放器壳依赖
  ) => VideoJs播放器壳实例 | Promise<VideoJs播放器壳实例>;
};

export type 全局唯一播放器端口 = {
  配置壳工厂(
    factory: NonNullable<全局唯一播放器依赖["createVideoJsPlayerShell"]>
  ): void;
  冲刷当前时间线播放位置(): void;
  暂停当前时间线播放(): void;
  同步时间线自动播(input: 全局唯一播放器时间线输入 | null): void;
  接管查看器(input: 全局唯一播放器查看器输入): Promise<全局唯一播放器查看器会话>;
  读取视频元素(): HTMLVideoElement | null;
  读取容器元素(): HTMLElement | null;
  销毁(): void;
};

const 看起来像Promise = <T>(value: T | Promise<T>): value is Promise<T> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const 同步播放器展示模式 = (
  video: HTMLVideoElement,
  presentation: "inline" | "viewer"
): void => {
  /**
   * 唯一播放器在消息流/查看器之间迁移时，允许切展示模式，但不允许切第二套壳：
   * 1. `koko-video-skin` 继续是同一个宿主表面；
   * 2. inline 只是在同一壳上声明“消息流无控件”；
   * 3. provider 上同步一份 dataset，便于测试与调试直接读出当前表面语义。
   */
  const skin = video.closest<HTMLElement>("koko-video-skin, video-skin");
  skin?.setAttribute("data-presentation", presentation);
  skin?.parentElement?.setAttribute("data-presentation", presentation);
};

const 是时间线隐藏预热宿主 = (mountTarget: HTMLElement | null | undefined): boolean =>
  mountTarget?.dataset.stageHost === "true";

const 归一化播放器播放源 = (src: string | null): string | null => {
  if (!src) {
    return null;
  }
  try {
    const base =
      typeof window !== "undefined" && window.location?.href
        ? window.location.href
        : "http://localhost/";
    return new URL(src, base).href;
  } catch {
    return src;
  }
};

const 是同一播放器播放源 = (left: string | null, right: string | null): boolean => {
  const normalizedLeft = 归一化播放器播放源(left);
  const normalizedRight = 归一化播放器播放源(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const 应用查看器播放连续性 = (
  input: 全局唯一播放器查看器输入,
  video: HTMLVideoElement
): void => {
  const currentSrc = video.currentSrc || video.getAttribute("src") || input.source.src;
  const sourceMatches = 是同一播放器播放源(input.resumePosition?.src ?? null, currentSrc);
  const decision = 判定播放连续性表面({
    attachmentId: input.attachmentId,
    ownerAttachmentId: input.attachmentId,
    surface: "viewer",
    source: { src: currentSrc },
    savedPosition: input.resumePosition ?? null,
    dom: {
      previewReadyState: video.readyState,
      canonicalReadyState: video.readyState,
      previewCommitted: video.readyState >= 2,
      canonicalCommitted: video.readyState >= 2,
      sourceMatches,
    },
    host: {
      exists: video.isConnected,
      hasStableFrame: sourceMatches || video.readyState >= 2,
    },
    frameEvidence:
      sourceMatches && video.readyState >= 2 && Number.isFinite(video.currentTime)
        ? {
            kind: "canonical_frame",
            src: currentSrc,
            currentTime: video.currentTime,
          }
        : { kind: "none" },
    intent: { viewerOpen: true, fullscreen: false },
  });
  if (
    decision.kind !== "viewer_handoff" ||
    !Number.isFinite(decision.targetCurrentTime) ||
    decision.targetCurrentTime <= 0
  ) {
    return;
  }
  if (Math.abs(video.currentTime - decision.targetCurrentTime) < 0.05) {
    return;
  }
  /**
   * 查看器冷开和时间线归位复用同一条位置真相：
   * 1. 只吃外层已经按同源校验过的 `resumePosition`；
   * 2. 只在全局状态链判定为 viewer handoff 时 seek；
   * 3. 不在查看器里另存“退出前位置”，位置 owner 仍是唯一播放器回调。
   */
  try {
    video.currentTime = decision.targetCurrentTime;
  } catch {
    // 少数浏览器在 metadata 前拒绝 seek；后续 loadedmetadata 会继续由壳层事件回灌。
  }
};

const 绑定查看器媒体信号 = (
  video: HTMLVideoElement,
  回调: 查看器媒体回调
): (() => void) => {
  const listeners: Array<[keyof HTMLMediaElementEventMap, EventListener]> = [
    [
      "playing",
      () => {
        回调.广播媒体会话信号({ type: "PLAYER_PLAYING" });
      },
    ],
    [
      "waiting",
      () => {
        回调.广播媒体会话信号({ type: "PLAYER_WAITING" });
      },
    ],
    [
      "stalled",
      () => {
        回调.广播媒体会话信号({ type: "PLAYER_STALLED" });
      },
    ],
    [
      "error",
      () => {
        回调.广播媒体会话信号({ type: "PLAYER_ERROR" });
      },
    ],
    [
      "pause",
      () => {
        回调.广播播放位置(video, true);
      },
    ],
  ];
  for (const [eventName, listener] of listeners) {
    video.addEventListener(eventName, listener);
  }
  return () => {
    for (const [eventName, listener] of listeners) {
      video.removeEventListener(eventName, listener);
    }
  };
};

const 绑定时间线自动播信号 = (
  video: HTMLVideoElement,
  input: 全局唯一播放器时间线输入
): (() => void) => {
  const 读取当前源 = (): string | null => video.currentSrc || video.getAttribute("src");
  const 挂载时是否隐藏预热 = 是时间线隐藏预热宿主(input.mountTarget);
  const 广播可见接管已就绪 = (): void => {
    if (!挂载时是否隐藏预热) {
      return;
    }
    input.回调.标记可见接管已就绪?.(video);
  };
  let 可见宿主首帧已确认 = false;
  let 可见宿主首帧确认已挂起 = false;
  const 广播可见宿主已出帧 = (
    sourceEvent: "loadeddata" | "canplay" | "seeked" | "playing"
  ): void => {
    if (挂载时是否隐藏预热 || 可见宿主首帧已确认 || 可见宿主首帧确认已挂起) {
      return;
    }
    const 提交已出帧 = (): void => {
      可见宿主首帧确认已挂起 = false;
      if (可见宿主首帧已确认) {
        return;
      }
      可见宿主首帧已确认 = true;
      input.回调.标记可见宿主已出帧?.(video);
    };
    if ("requestVideoFrameCallback" in video && typeof video.requestVideoFrameCallback === "function") {
      可见宿主首帧确认已挂起 = true;
      video.requestVideoFrameCallback(() => {
        提交已出帧();
      });
      return;
    }
    if (sourceEvent === "playing") {
      提交已出帧();
    }
  };
  const listeners: Array<[keyof HTMLMediaElementEventMap, EventListener]> = [
    [
      "loadedmetadata",
      () => {
        input.回调.恢复播放位置(video);
      },
    ],
    [
      "loadeddata",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
        广播可见接管已就绪();
        广播可见宿主已出帧("loadeddata");
      },
    ],
    [
      "canplay",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
        广播可见接管已就绪();
        广播可见宿主已出帧("canplay");
      },
    ],
    [
      "seeked",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
        广播可见接管已就绪();
        广播可见宿主已出帧("seeked");
      },
    ],
    [
      "playing",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
        广播可见接管已就绪();
        广播可见宿主已出帧("playing");
        input.回调.广播媒体会话信号({ type: "PLAYER_PLAYING" });
      },
    ],
    [
      "timeupdate",
      () => {
        input.回调.广播播放位置(video);
      },
    ],
    [
      "pause",
      () => {
        input.回调.广播播放位置(video, true);
      },
    ],
    [
      "waiting",
      () => {
        input.回调.广播媒体会话信号({ type: "PLAYER_WAITING" });
      },
    ],
    [
      "stalled",
      () => {
        input.回调.广播媒体会话信号({ type: "PLAYER_STALLED" });
      },
    ],
    [
      "error",
      () => {
        input.回调.广播媒体会话信号({ type: "PLAYER_ERROR" });
      },
    ],
  ];
  for (const [eventName, listener] of listeners) {
    video.addEventListener(eventName, listener);
  }
  return () => {
    for (const [eventName, listener] of listeners) {
      video.removeEventListener(eventName, listener);
    }
  };
};

const 配置时间线自动播视频 = (
  video: HTMLVideoElement,
  attachmentId: string,
  options: { stageOnly?: boolean } = {}
): void => {
  /**
   * 时间线 owner 槽位里的 canonical player 仍然要伪装成原来的预览表面：
   * 1. 消息窗现有查询、节流和回归测试都围绕 `.message-video-preview` 这条壳层约定；
   * 2. 这里复用同一颗正式 player，但把它投影成同一个 DOM 语义，避免再长“时间线专用第二播放器”；
   * 3. 进入查看器后，这些预览态属性会被显式撤掉，避免把消息流约束污染到沉浸层。
   */
  video.className = "message-video-preview";
  video.dataset.attachmentId = attachmentId;
  video.dataset.canonicalPlayer = "true";
  video.muted = true;
  video.loop = 媒体是否默认循环播放("video");
  /**
   * 时间线 owner 交接时，canonical player 可能先被挂到隐藏预热宿主：
   * 1. 这个阶段只允许它后台切源、seek、等首帧就绪；
   * 2. 禁止在 hidden stage 上直接开播，否则时间轴会在揭帘前偷偷往前跑；
   * 3. 真正开始播放只允许发生在可见 inline host 上。
   */
  video.autoplay = !options.stageOnly;
  video.preload = options.stageOnly ? "auto" : "metadata";
  video.controls = false;
  video.playsInline = true;
  video.setAttribute("disablepictureinpicture", "");
  video.setAttribute("disableremoteplayback", "");
  video.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
  video.setAttribute("tabindex", "-1");
  video.setAttribute("aria-hidden", "true");
  video.style.pointerEvents = "none";
  video.style.objectFit = "cover";
  video.style.background = "#000";
  video.style.display = "block";
  video.style.width = "100%";
  video.style.height = "100%";
  同步播放器展示模式(video, "inline");
};

const 配置查看器视频 = (video: HTMLVideoElement): void => {
  video.classList.remove("message-video-preview", "message-video-preview--gated");
  delete video.dataset.attachmentId;
  delete video.dataset.canonicalPlayer;
  video.muted = false;
  /**
   * 查看器和时间线共用同一颗 canonical player 时，循环语义也必须继续来自统一播放策略：
   * 1. 不能因为切到查看器就偷偷改成另一套 loop 真相；
   * 2. 否则同一会话在时间线/查看器之间迁移时会出现同源不同播放策略；
   * 3. 需要关闭循环的地方应由更上层策略显式决定，而不是在宿主迁移时隐式改写。
   */
  video.loop = 媒体是否默认循环播放("video");
  video.autoplay = true;
  video.controls = false;
  video.removeAttribute("disablepictureinpicture");
  video.removeAttribute("disableremoteplayback");
  video.removeAttribute("controlslist");
  video.removeAttribute("tabindex");
  video.removeAttribute("aria-hidden");
  video.style.pointerEvents = "auto";
  video.style.objectFit = "contain";
  video.style.background = "#000";
  video.style.display = "block";
  video.style.width = "100%";
  video.style.height = "100%";
  同步播放器展示模式(video, "viewer");
};

export function 创建全局唯一播放器(
  deps: 全局唯一播放器依赖 = {}
): 全局唯一播放器端口 {
  const 查看器归位等待毫秒 = 120;
  const 时间线交接等待毫秒 = 16;
  let createVideoJsPlayerShell = deps.createVideoJsPlayerShell ?? 创建VideoJs播放器壳;
  let shell: VideoJs播放器壳实例 | null = null;
  let shellPromise: Promise<VideoJs播放器壳实例> | null = null;
  let 当前绑定清理: () => void = () => undefined;
  let 当前时间线输入: 全局唯一播放器时间线输入 | null = null;
  let 当前查看器输入: 全局唯一播放器查看器输入 | null = null;
  let 当前表面: "inline" | "viewer" | null = null;
  let 操作代次 = 0;
  let 查看器会话代次 = 0;
  let 待归位销毁定时器: ReturnType<typeof setTimeout> | null = null;
  let 待归位销毁代次 = 0;
  let 待归位附件Id: string | null = null;

  const 解绑当前绑定 = (): void => {
    当前绑定清理();
    当前绑定清理 = () => undefined;
  };

  const 取消待归位销毁 = (): void => {
    if (待归位销毁定时器 !== null) {
      clearTimeout(待归位销毁定时器);
      待归位销毁定时器 = null;
    }
  };

  const 销毁当前播放器 = (): void => {
    取消待归位销毁();
    解绑当前绑定();
    shell?.destroy();
    shell = null;
    shellPromise = null;
    当前表面 = null;
    待归位附件Id = null;
  };

  const 启动待销毁等待 = (等待毫秒: number): void => {
    取消待归位销毁();
    const 当前归位代次 = ++待归位销毁代次;
    /**
     * 统一“短暂销毁观察窗”只解决一种问题：壳仍然有效，但下一条有效 inline 宿主/输入可能马上回来。
     * 1. viewer 关闭归位时，这是等待消息流 owner 回灌的窗口；
     * 2. inline owner 交接时，这是吸收一拍 `host 暂空 -> 下一拍新 host 到达` 的窗口；
     * 3. 观察窗只暂缓 destroy，不额外制造第二颗 player，也不保存第二份业务真相。
     */
    待归位销毁定时器 = setTimeout(() => {
      if (当前归位代次 !== 待归位销毁代次) {
        return;
      }
      待归位销毁定时器 = null;
      if (当前查看器输入) {
        return;
      }
      if (当前时间线输入?.mountTarget && 当前时间线输入.mountTarget.isConnected) {
        应用时间线自动播表面();
        return;
      }
      销毁当前播放器();
    }, 等待毫秒);
  };

  const 读取或创建播放器 = (
    source: VideoJs播放器源描述,
    mountTarget: HTMLElement
  ): VideoJs播放器壳实例 | Promise<VideoJs播放器壳实例> => {
    if (shell) {
      return shell;
    }
    if (shellPromise) {
      return shellPromise;
    }
    const result = createVideoJsPlayerShell(source, { mountTarget });
    if (看起来像Promise(result)) {
      shellPromise = Promise.resolve(result).then((nextShell) => {
        shell = nextShell;
        return nextShell;
      });
      return shellPromise;
    }
    shell = result;
    return result;
  };

  const flush时间线位置 = (
    input: 全局唯一播放器时间线输入 | null = 当前时间线输入,
    allowReleasedOwner = true
  ): void => {
    if (当前表面 !== "inline" || !input || !shell) {
      return;
    }
    input.回调.广播播放位置(shell.读取视频元素(), true, allowReleasedOwner);
  };

  const 应用时间线自动播表面 = (): void => {
    const 当前输入 = 当前时间线输入;
    if (!当前输入?.mountTarget || !当前输入.mountTarget.isConnected) {
      if (!当前查看器输入) {
        销毁当前播放器();
      }
      return;
    }
    取消待归位销毁();
    const 当前操作 = ++操作代次;
    const 应用已就绪壳 = (activeShell: VideoJs播放器壳实例): void => {
      if (当前操作 !== 操作代次 || 当前时间线输入 !== 当前输入 || 当前查看器输入) {
        return;
      }
      const mountTarget = 当前输入.mountTarget;
      if (!mountTarget) {
        return;
      }
      const 隐藏预热宿主 = 是时间线隐藏预热宿主(mountTarget);
      const 现有视频 = activeShell.读取视频元素();
      const 当前宿主仍是同一条活时间线 =
        当前表面 === "inline" &&
        !隐藏预热宿主 &&
        现有视频.isConnected &&
        现有视频.dataset.attachmentId === 当前输入.attachmentId &&
        mountTarget.contains(现有视频) &&
        是同一播放器播放源(
          当前输入.source.src,
          现有视频.currentSrc || 现有视频.getAttribute("src")
        ) &&
        !现有视频.paused;
      const 当前可见宿主仍在稳态播放 =
        当前表面 === "inline" &&
        隐藏预热宿主 &&
        现有视频.isConnected &&
        现有视频.dataset.attachmentId === 当前输入.attachmentId &&
        是同一播放器播放源(
        当前输入.source.src,
          现有视频.currentSrc || 现有视频.getAttribute("src")
        ) &&
        !现有视频.paused &&
        !mountTarget.contains(现有视频);
      if (当前宿主仍是同一条活时间线 || 当前可见宿主仍在稳态播放) {
        /**
         * 纯滚动 / resize 会不断把同一条时间线 owner 重新送进同步入口。
         * 这类几何更新如果再走一遍 mount -> sync source -> restore currentTime，
         * 就会把正在播放的 canonical 画面硬拉回旧时间点，形成“边播边抽”。
         *
         * 这里的 fast path 只覆盖最严格的一种情况：
         * 1. 同一 attachmentId；
         * 2. 同一 mountTarget；
         * 3. 同一 source；
         * 4. 同一颗 live video 仍在播放。
         *
         * 另外，若当前可见宿主已经在稳态播放，同附件的 hidden stage 只是瞬时预热壳，
         * 也绝不能把这颗 live player 从用户眼前搬走。
         *
         * 满足这些条件时，只需要更新监听绑定和输入引用，不能再做任何播放动作。
         */
        解绑当前绑定();
        配置时间线自动播视频(现有视频, 当前输入.attachmentId, {
          stageOnly: false,
        });
        当前绑定清理 = 绑定时间线自动播信号(现有视频, 当前输入);
        当前表面 = "inline";
        待归位附件Id = null;
        return;
      }
      解绑当前绑定();
      activeShell.挂载到宿主(mountTarget);
      activeShell.同步(当前输入.source);
      const video = activeShell.读取视频元素();
      配置时间线自动播视频(video, 当前输入.attachmentId, {
        stageOnly: 隐藏预热宿主,
      });
      当前绑定清理 = 绑定时间线自动播信号(video, 当前输入);
      当前表面 = "inline";
      待归位附件Id = null;
      当前输入.回调.恢复播放位置(video);
      if (隐藏预热宿主) {
        当前输入.回调.标记可见接管已就绪?.(video);
        /**
         * hidden stage 的职责只有“把同一颗 canonical player 预热到可见切换前的正确 source/time”：
         * 1. 这里显式 pause，防止浏览器沿着 muted autoplay 在幕后先偷偷播放；
         * 2. 某些同源切换场景不会再触发 `loadeddata/canplay/seeked`，所以上面要主动补一次 ready 探测；
         * 3. 如果当前位置/seek 还没对齐，消息窗侧的 reveal gate 会继续拒绝，不会因为这次主动探测误开门；
         * 2. 等消息窗确认 canonical 已 ready 并把 mountTarget 切成可见 host 后，
         *    才允许后续那次 `同步时间线自动播` 重新 `play()`；
         * 3. 这样用户看到的就不再是“可见表面上的 loadstart + seek”，而是准备好后再揭帘。
         */
        video.pause();
        return;
      }
      /**
       * 时间线 owner 接管后即便浏览器表面上已经把 `autoplay` 置真，也不能假设它一定会立刻恢复播放：
       * 1. 同源续播、宿主迁移、测试环境 stub 都可能让 `paused`/实际播放状态短暂失真；
       * 2. 这里统一补一发 `play()`，把“正式开始播放”的决定收口到唯一播放器 owner；
       * 3. 失败只代表浏览器暂时拒绝自动播，不把它升级成第二套恢复链。
       */
      void video.play().catch(() => undefined);
    };
    const shell结果 = 读取或创建播放器(当前输入.source, 当前输入.mountTarget);
    if (看起来像Promise(shell结果)) {
      void shell结果.then(应用已就绪壳).catch(() => undefined);
      return;
    }
    应用已就绪壳(shell结果);
  };

  const 释放查看器并尝试归位时间线 = (): void => {
    当前查看器输入 = null;
    if (当前时间线输入?.mountTarget && 当前时间线输入.mountTarget.isConnected) {
      应用时间线自动播表面();
      return;
    }
    if (!待归位附件Id) {
      销毁当前播放器();
      return;
    }
    启动待销毁等待(查看器归位等待毫秒);
  };

  return {
    配置壳工厂(factory): void {
      /**
       * 默认全局 owner 只允许持有一条“如何创建那颗 canonical shell”的窄依赖缝：
       * 1. room pane 和 viewer 必须共享同一颗 player，但 HLS/P2P 增强的挂接时机仍由上层外部配置；
       * 2. 这里不新增第二个 manager，只允许在首次建壳前把工厂收口到同一个 owner；
       * 3. 壳已经创建后不回头重建，避免为了切配置再制造第二颗 live player。
       */
      createVideoJsPlayerShell = factory;
    },

    冲刷当前时间线播放位置(): void {
      /**
       * 房间消息窗在 owner 退场前，需要拿到“这一拍 canonical player 的最终时间”：
       * 1. 如果等到 host 已经撤掉后再 flush，旧卡片露出的 preview 底板还会再 seek 一下；
       * 2. flush 之后还要立刻 pause，防止 canonical 在 host 拿走前继续往前跑一小段，
       *    结果 preview 底板又在可见态补第二次 seek；
       * 3. 这里只暴露一个极窄的提前 flush/freeze 口，不让房间消息窗接管播放真相；
       * 4. 真正位置 owner 仍然在这颗全局唯一播放器里，消息窗只是在退场前借它对齐同一卡片的底板像素。
       */
      flush时间线位置(当前时间线输入, true);
      const currentVideo = shell?.读取视频元素();
      if (当前表面 === "inline" && currentVideo && !currentVideo.paused) {
        currentVideo.pause();
      }
    },

    暂停当前时间线播放(): void {
      const currentVideo = shell?.读取视频元素();
      if (当前表面 === "inline" && currentVideo && !currentVideo.paused) {
        currentVideo.pause();
      }
    },

    同步时间线自动播(input): void {
      const 旧输入 = 当前时间线输入;
      if (
        旧输入 &&
        (!input || input.attachmentId !== 旧输入.attachmentId) &&
        当前表面 === "inline"
      ) {
        flush时间线位置(旧输入, true);
        const currentVideo = shell?.读取视频元素();
        if (currentVideo && !currentVideo.paused) {
          /**
           * 旧 owner 退场时要先停住当前像素，再决定是迁移还是释放：
           * 1. 交给新 owner 时，暂停能避免旧卡片继续偷偷播；
           * 2. 暂时收到一拍 `null` 时，暂停能保证“壳还在，但旧会话已经停住”；
           * 3. 这样零闪烁不依赖第二表面，也不会把短暂保留误变成继续播放。
           */
          currentVideo.pause();
        }
      }
      if (当前查看器输入) {
        /**
         * 只有“同一条时间线 owner 被 viewer 暂时接管”才允许进入归位桥：
         * 1. viewer 打开后 runtime 会先把 inline owner 清空；
         * 2. 如果被清空的正是当前 viewer 这条附件，就在关闭时给它一个短暂的回挂窗口；
         * 3. viewer 真正退场前，消息窗可能会因为重渲染再次上报一轮 `null`；
         *    这时旧输入已经被上一轮清空，但待归位桥不能因此被误擦掉；
         * 4. 其他情况一律不保留桥，避免把完整关闭后的新会话误复用成旧壳续命。
         */
        待归位附件Id =
          !input &&
          (旧输入?.attachmentId === 当前查看器输入.attachmentId ||
            待归位附件Id === 当前查看器输入.attachmentId)
            ? 当前查看器输入.attachmentId
            : null;
      }
      当前时间线输入 = input;
      if (input) {
        取消待归位销毁();
      }
      if (当前查看器输入) {
        return;
      }
      if (!input) {
        if (待归位附件Id && shell) {
          /**
           * viewer 已退场但消息流宿主还没重新挂好时，房间消息窗会继续上报 `null`。
           * 这类 `null` 仍属于同一条归位链，不该把刚保下来的 canonical 壳立刻销毁；
           * 真正是否销毁，交给那条短暂归位窗口统一裁决。
           */
          启动待销毁等待(查看器归位等待毫秒);
          return;
        }
        if (shell && 当前表面 === "inline") {
          /**
           * 消息流滚动交接时，房间消息窗可能先给出一拍 `null`，下一拍马上补上新的 owner 宿主：
           * 1. 这类 `null` 不是“会话真的结束”，而是 host 正在从旧卡片迁到新卡片；
           * 2. 如果这里立刻 destroy，就会把同一颗 canonical player 退化成“旧壳销毁 + 新壳重建”；
           * 3. 因此只给一个极短的一帧观察窗，等下一次有效 inline 输入；超时后仍无输入再释放。
           */
          启动待销毁等待(时间线交接等待毫秒);
          return;
        }
        销毁当前播放器();
        return;
      }
      应用时间线自动播表面();
    },

    async 接管查看器(input): Promise<全局唯一播放器查看器会话> {
      if (待归位附件Id && !当前查看器输入) {
        /**
         * 这里代表上一条 viewer 已经完整关闭，只是还在等待 inline owner 是否回归。
         * 如果此时用户直接打开一条新的 viewer，会话语义已经变成“新开一条正式查看链”，
         * 不能把这次打开偷做成旧桥复用，否则关闭-重开会和现有测试/交互契约冲突。
         */
        销毁当前播放器();
      }
      取消待归位销毁();
      当前查看器输入 = input;
      const 会话代次 = ++查看器会话代次;
      const 当前时间线附件 = 当前时间线输入?.attachmentId ?? null;
      if (当前表面 === "inline" && shell) {
        flush时间线位置(当前时间线输入, true);
        if (当前时间线附件 && 当前时间线附件 !== input.attachmentId) {
          const currentVideo = shell.读取视频元素();
          if (!currentVideo.paused) {
            currentVideo.pause();
          }
        }
      }
      const 当前操作 = ++操作代次;
      const activeShell = await 读取或创建播放器(input.source, input.mountTarget);
      if (当前操作 !== 操作代次 || 当前查看器输入 !== input) {
        return {
          同步: async () => undefined,
          进入全屏: async () => "unsupported",
          读取视频元素: () => null,
          读取容器元素: () => null,
          关闭: () => undefined,
        };
      }
      解绑当前绑定();
      activeShell.挂载到宿主(input.mountTarget);
      activeShell.同步(input.source);
      const video = activeShell.读取视频元素();
      配置查看器视频(video);
      应用查看器播放连续性(input, video);
      当前绑定清理 = 绑定查看器媒体信号(video, input.回调);
      当前表面 = "viewer";
      return {
        同步: async (nextInput): Promise<void> => {
          if (查看器会话代次 !== 会话代次 || !当前查看器输入) {
            return;
          }
          /**
           * 切 viewer 源前先把上一条视频的最新时间写回外层唯一位置真相。
           * 否则同一会话在查看器内部切附件时，前一条视频只会留下进入 viewer 时的旧快照。
           */
          当前查看器输入.回调.广播播放位置(video, true);
          当前查看器输入 = {
            attachmentId: nextInput.attachmentId,
            mountTarget: input.mountTarget,
            source: nextInput.source,
            resumePosition: nextInput.resumePosition ?? null,
            回调: nextInput.回调,
          };
          解绑当前绑定();
          activeShell.挂载到宿主(input.mountTarget);
          activeShell.同步(nextInput.source);
          配置查看器视频(video);
          应用查看器播放连续性(当前查看器输入, video);
          当前绑定清理 = 绑定查看器媒体信号(video, nextInput.回调);
          当前表面 = "viewer";
        },
        进入全屏: () => activeShell.进入全屏(),
        读取视频元素: () => activeShell.读取视频元素(),
        读取容器元素: () => activeShell.读取容器元素() as HTMLElement,
        关闭: () => {
          if (查看器会话代次 !== 会话代次) {
            return;
          }
          /**
           * viewer 退场前必须先把当前 canonical player 的最新位置回灌出去。
           * 这一步缺失时，inline 归位只会拿到“进入 viewer 前那次 flush”的旧时间点。
           */
          当前查看器输入?.回调.广播播放位置(video, true);
          释放查看器并尝试归位时间线();
        },
      };
    },

    读取视频元素(): HTMLVideoElement | null {
      return shell?.读取视频元素() ?? null;
    },

    读取容器元素(): HTMLElement | null {
      return (shell?.读取容器元素() as HTMLElement | undefined) ?? null;
    },

    销毁(): void {
      当前时间线输入 = null;
      当前查看器输入 = null;
      销毁当前播放器();
    },
  };
}

let 默认全局唯一播放器: 全局唯一播放器端口 | null = null;

export const 读取默认全局唯一播放器 = (): 全局唯一播放器端口 => {
  if (!默认全局唯一播放器) {
    默认全局唯一播放器 = 创建全局唯一播放器();
  }
  return 默认全局唯一播放器;
};
