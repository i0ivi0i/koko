import { vi } from "vitest";

import { 读取默认全局唯一播放器 } from "../../媒体/全局唯一播放器";

export const 安装方向模拟 = () => {
  const lock = vi.fn(() => Promise.resolve());
  const unlock = vi.fn();
  Object.defineProperty(globalThis.screen, "orientation", {
    configurable: true,
    value: { lock, unlock, type: "portrait-primary" },
  });
  return { lock, unlock };
};

export const 安装全屏DOM模拟 = () => {
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
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        Object.assign(element, { play, pause });
      }
      return element;
    }) as typeof document.createElement
  );
  return { requestFullscreen, exitFullscreen, play, pause };
};

export const 安装严格瞬时激活全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  let 当前存在瞬时激活 = false;
  const 激活快照: boolean[] = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    激活快照.push(当前存在瞬时激活);
    if (!当前存在瞬时激活) {
      return Promise.reject(new Error("Fullscreen requires transient activation"));
    }
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });

  return {
    requestFullscreen,
    exitFullscreen,
    激活快照,
    以瞬时激活执行<T>(action: () => T): T {
      当前存在瞬时激活 = true;
      try {
        return action();
      } finally {
        当前存在瞬时激活 = false;
      }
    },
  };
};

export const 安装延迟退出全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  let 待完成退出: (() => void) | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        待完成退出 = resolve;
      })
  );
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  return {
    requestFullscreen,
    exitFullscreen,
    完成退出(): void {
      fullscreenElement = null;
      待完成退出?.();
      待完成退出 = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
};

export const 安装手动进入全屏模拟 = () => {
  let fullscreenElement: Element | null = null;
  const 待完成进入请求: Array<{
    target: Element;
    resolve: () => void;
    reject: (error?: unknown) => void;
  }> = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    return new Promise<void>((resolve, reject) => {
      待完成进入请求.push({
        target: this,
        resolve: () => {
          fullscreenElement = this;
          document.dispatchEvent(new Event("fullscreenchange"));
          resolve();
        },
        reject: (error?: unknown) => {
          reject(error);
        },
      });
    });
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        Object.assign(element, { play, pause });
      }
      return element;
    }) as typeof document.createElement
  );
  return {
    requestFullscreen,
    exitFullscreen,
    play,
    pause,
    待完成进入请求,
    完成进入(index = 0): void {
      待完成进入请求[index]?.resolve();
    },
    拒绝进入(index = 0, error: unknown = new Error("Fullscreen request rejected")): void {
      待完成进入请求[index]?.reject(error);
    },
  };
};

export const 安装可回退全屏堆栈模拟 = () => {
  const stack: Element[] = [];
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => stack.at(-1) ?? null,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    stack.push(this);
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    stack.pop();
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  return { requestFullscreen, exitFullscreen };
};

export const 安装ShadowHost全屏DOM模拟 = () => {
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    const root = this.getRootNode?.();
    if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
      fullscreenElement = root.host;
    } else {
      fullscreenElement = this;
    }
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(() => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        Object.assign(element, { play, pause });
      }
      return element;
    }) as typeof document.createElement
  );
  return { requestFullscreen, exitFullscreen, play, pause };
};

export const 读取VideoJs媒体容器 = (): HTMLElement | null => {
  const skin = document.body.querySelector("koko-video-skin, video-skin");
  return skin?.shadowRoot?.querySelector("media-container") ?? null;
};

export const 查询查看器关闭按钮 = (): HTMLButtonElement | null => {
  const directButton = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭视频查看器"]'
  );
  if (directButton) {
    return directButton;
  }
  const fullscreenButton = document.fullscreenElement?.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭视频查看器"]'
  );
  if (fullscreenButton) {
    return fullscreenButton;
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

export const 等待查询查看器关闭按钮 = async (maxTurns = 40): Promise<HTMLButtonElement | null> => {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const button = 查询查看器关闭按钮();
    if (button) {
      return button;
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
};

export const 等待查询元素 = async <T extends Element>(
  selector: string,
  maxAttempts = 30
): Promise<T | null> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const element = document.body.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return document.body.querySelector<T>(selector);
};

export const 等待查看器任务完成 = async (turns = 4): Promise<void> => {
  /**
   * 唯一播放器现在允许异步建壳/接管。
   * 这些等待点只负责让测试追上真实 owner 链的微任务结算，
   * 不改变任何运行时行为。
   */
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
};

export const 清理媒体查看器测试环境 = () => {
  读取默认全局唯一播放器().销毁();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
  Reflect.deleteProperty(document, "exitFullscreen");
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: null,
  });
};
