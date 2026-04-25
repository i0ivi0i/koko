import type { 媒体会话信号 } from "./媒体会话.js";
import { 媒体是否默认循环播放 } from "./媒体播放.js";
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
      },
    ],
    [
      "canplay",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
      },
    ],
    [
      "playing",
      () => {
        input.回调.标记首帧已就绪(读取当前源());
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

const 配置时间线自动播视频 = (video: HTMLVideoElement, attachmentId: string): void => {
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
  video.autoplay = true;
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
  let createVideoJsPlayerShell = deps.createVideoJsPlayerShell ?? 创建VideoJs播放器壳;
  let shell: VideoJs播放器壳实例 | null = null;
  let shellPromise: Promise<VideoJs播放器壳实例> | null = null;
  let 当前绑定清理: () => void = () => undefined;
  let 当前时间线输入: 全局唯一播放器时间线输入 | null = null;
  let 当前查看器输入: 全局唯一播放器查看器输入 | null = null;
  let 当前表面: "inline" | "viewer" | null = null;
  let 操作代次 = 0;
  let 查看器会话代次 = 0;

  const 解绑当前绑定 = (): void => {
    当前绑定清理();
    当前绑定清理 = () => undefined;
  };

  const 销毁当前播放器 = (): void => {
    解绑当前绑定();
    shell?.destroy();
    shell = null;
    shellPromise = null;
    当前表面 = null;
  };

  const 读取或创建播放器 = (
    source: VideoJs播放器源描述,
    mountTarget: HTMLElement
  ): VideoJs播放器壳实例 | Promise<VideoJs播放器壳实例> => {
    if (shell) {
      shell.挂载到宿主(mountTarget);
      return shell;
    }
    if (shellPromise) {
      return shellPromise.then((nextShell) => {
        nextShell.挂载到宿主(mountTarget);
        return nextShell;
      });
    }
    const result = createVideoJsPlayerShell(source, { mountTarget });
    if (看起来像Promise(result)) {
      shellPromise = Promise.resolve(result).then((nextShell) => {
        shell = nextShell;
        return nextShell;
      });
      return shellPromise.then((nextShell) => {
        nextShell.挂载到宿主(mountTarget);
        return nextShell;
      });
    }
    shell = result;
    result.挂载到宿主(mountTarget);
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
    const 当前操作 = ++操作代次;
    const 应用已就绪壳 = (activeShell: VideoJs播放器壳实例): void => {
      if (当前操作 !== 操作代次 || 当前时间线输入 !== 当前输入 || 当前查看器输入) {
        return;
      }
      解绑当前绑定();
      activeShell.挂载到宿主(当前输入.mountTarget!);
      activeShell.同步(当前输入.source);
      const video = activeShell.读取视频元素();
      配置时间线自动播视频(video, 当前输入.attachmentId);
      当前绑定清理 = 绑定时间线自动播信号(video, 当前输入);
      当前表面 = "inline";
      当前输入.回调.恢复播放位置(video);
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
    销毁当前播放器();
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

    同步时间线自动播(input): void {
      const 旧输入 = 当前时间线输入;
      if (
        旧输入 &&
        (!input || input.attachmentId !== 旧输入.attachmentId) &&
        当前表面 === "inline"
      ) {
        flush时间线位置(旧输入, true);
        if (input) {
          const currentVideo = shell?.读取视频元素();
          if (currentVideo && !currentVideo.paused) {
            currentVideo.pause();
          }
        }
      }
      当前时间线输入 = input;
      if (当前查看器输入) {
        return;
      }
      if (!input) {
        销毁当前播放器();
        return;
      }
      应用时间线自动播表面();
    },

    async 接管查看器(input): Promise<全局唯一播放器查看器会话> {
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
            回调: nextInput.回调,
          };
          解绑当前绑定();
          activeShell.挂载到宿主(input.mountTarget);
          activeShell.同步(nextInput.source);
          配置查看器视频(video);
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
