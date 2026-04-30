import { vi } from "vitest";

import type {
  VideoJs全屏进入结果,
  VideoJs播放器壳实例,
  VideoJs播放器源描述,
} from "../../媒体/videojs播放器壳";

export const 创建测试VideoJs进入全屏 = (container: HTMLElement) =>
  vi.fn(async () => {
    if (typeof container.requestFullscreen === "function") {
      await container.requestFullscreen({ navigationUI: "hide" });
      return "standard" as const;
    }
    return "unsupported" as const;
  });

export const 创建测试VideoJs播放器壳 = (options: {
  mountTarget?: HTMLElement;
  video?: HTMLVideoElement;
  container?: HTMLElement;
  同步?: (source: VideoJs播放器源描述) => void;
  destroy?: () => void;
  进入全屏?: () => Promise<VideoJs全屏进入结果>;
  初始源?: VideoJs播放器源描述;
} = {}): VideoJs播放器壳实例 => {
  const video = options.video ?? document.createElement("video");
  const container = options.container ?? document.createElement("div");
  const 外部同步回调 = options.同步 ?? vi.fn<(source: VideoJs播放器源描述) => void>();
  const destroy = options.destroy ?? vi.fn<() => void>();
  const 进入全屏 = options.进入全屏 ?? 创建测试VideoJs进入全屏(container);
  /**
   * 测试壳也要尽量贴近真实壳语义：
   * 1. 同步播放源时直接驱动唯一 video 的 src/poster；
   * 2. 外部传进来的 spy 只负责观测，不替代真实 DOM 变化；
   * 3. 这样 pending/open/sync 测试就不会因为测试替身过于空心而误判实现。
   */
  const 应用测试播放源 = (source: VideoJs播放器源描述): void => {
    video.src = source.src;
    if (source.posterSrc) {
      video.poster = source.posterSrc;
    } else {
      video.removeAttribute("poster");
    }
  };
  const 同步 = (source: VideoJs播放器源描述): void => {
    应用测试播放源(source);
    外部同步回调(source);
  };
  const 挂载到宿主 = (mountTarget: HTMLElement): void => {
    mountTarget.append(container);
    if (!container.contains(video)) {
      container.append(video);
    }
  };
  if (options.mountTarget) {
    挂载到宿主(options.mountTarget);
  }
  if (options.初始源) {
    应用测试播放源(options.初始源);
  }
  return {
    destroy,
    同步,
    挂载到宿主,
    进入全屏,
    读取视频元素: () => video,
    读取容器元素: () => container,
  };
};
