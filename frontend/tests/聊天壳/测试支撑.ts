import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, vi } from "vitest";
import { 读取默认全局唯一播放器 } from "../../媒体/全局唯一播放器";
import type { 聊天列表展示项 } from "../../房间消息窗/视图";
import { createFakeStorage } from "../common/聊天测试支架";

const 当前测试文件目录 = dirname(fileURLToPath(import.meta.url));

export const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(当前测试文件目录, "../..", relativePath), "utf8");

export const 查询查看器关闭按钮 = (): HTMLButtonElement | null => {
  const directButton = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭视频查看器"]'
  );
  if (directButton) {
    return directButton;
  }
  const skins = document.body.querySelectorAll("koko-video-skin, video-skin");
  for (const skin of skins) {
    const button = skin.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭视频查看器"]'
    );
    if (button) {
      return button;
    }
  }
  return null;
};

export const 安装聊天壳直达全屏模拟 = () => {
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "requestFullscreen"
  );
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const restore = () => {
    if (fullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (requestFullscreenDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", requestFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
  };
  return { requestFullscreen, restore };
};

const 安装聊天壳测试唯一播放器桩 = (): void => {
  const 全局唯一播放器 = 读取默认全局唯一播放器();
  全局唯一播放器.销毁();
  全局唯一播放器.配置壳工厂((initialSource, deps = {}) => {
    const video = document.createElement("video");
    const container = document.createElement("div");
    const 挂载到宿主 = (mountTarget: HTMLElement): void => {
      mountTarget.append(container);
      if (!container.contains(video)) {
        container.append(video);
      }
    };
    /**
     * 这里维持聊天壳集成测试的最小播放器真相：
     * 1. 壳必须真的把播放器节点挂进 DOM；
     * 2. source/pointer 的迁移仍然走真实接口；
     * 3. 但不在聊天壳 spec 里复制 Video.js 内部实现。
     */
    const 同步源 = (source = initialSource): void => {
      video.src = source.src;
      if (source.posterSrc) {
        video.poster = source.posterSrc;
      } else {
        video.removeAttribute("poster");
      }
    };
    if (deps.mountTarget) {
      挂载到宿主(deps.mountTarget);
    }
    同步源(initialSource);
    return {
      destroy() {
        video.pause();
        container.remove();
      },
      同步: 同步源,
      挂载到宿主,
      进入全屏: async () => "standard",
      读取视频元素: () => video,
      读取容器元素: () => container,
    };
  });
};

/**
 * 所有聊天壳集成拆分 spec 都共享同一套基线环境：
 * 1. 每次都重置 localStorage，避免首页/恢复状态串到别的 spec；
 * 2. 每次都重建唯一播放器壳，防止查看器残留污染下一条测试；
 * 3. 测后清掉预算探针，保持壳层对外表面纯净。
 */
export function 注册聊天壳集成测试基线(): void {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createFakeStorage(),
      configurable: true,
    });
    vi.restoreAllMocks();
    安装聊天壳测试唯一播放器桩();
  });

  afterEach(() => {
    读取默认全局唯一播放器().销毁();
    globalThis.__kokoBudgetSnapshot = undefined;
  });
}

export const 创建假媒体发布器 = () => ({
  处理选择媒体文件: vi.fn().mockResolvedValue(undefined),
  移除草稿: vi.fn(),
  继续上传草稿: vi.fn().mockResolvedValue(undefined),
  重新上传草稿: vi.fn().mockResolvedValue(undefined),
  清空: vi.fn(),
  销毁: vi.fn(),
});

export const 创建大量消息展示项 = (count: number): 聊天列表展示项[] => {
  // 这里只喂 Presenter 输出，避免大体量列表测试被文本排版成本淹没。
  const layout = {
    height: 20,
    lineCount: 1,
    naturalWidth: 80,
    maxLineWidth: 80,
    lines: [
      {
        index: 0,
        width: 80,
        text: "消息",
        segments: [{ kind: "text" as const, text: "消息" }],
      },
    ],
  };
  return Array.from({ length: count }, (_, index) => ({
    kind: "message" as const,
    id: `m-${index + 1}`,
    owner: index % 2 === 0 ? ("mine" as const) : ("other" as const),
    body: `消息-${index + 1}`,
    hasText: true,
    attachments: [],
    layout,
    bubbleWidth: 120,
    senderDisplayAlias: index % 2 === 0 ? "暴躁的企鹅" : "冷静的水獭",
    showAlias: index % 2 !== 0,
    eventPosition: index + 1,
  }));
};

export async function 等待查看器壳出现(maxAttempts = 20): Promise<Element | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const shell = document.body.querySelector("video-player[data-player-shell='videojs']");
    if (shell) {
      return shell;
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return document.body.querySelector("video-player[data-player-shell='videojs']");
}

export async function 等待查看器壳消失(maxAttempts = 20): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!document.body.querySelector("video-player[data-player-shell='videojs']")) {
      return;
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
