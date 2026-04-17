export interface 服务工作线程快照 {
  appShellRegistered: boolean;
  mediaWorkerRegistered: boolean;
  persistentStorageRequested: boolean;
  controllerAttached: boolean;
  appShellWaiting: boolean;
  mediaWorkerWaiting: boolean;
  lastMessageType: string | null;
  lastMessage: unknown | null;
}

export type 服务工作线程运行时事件 =
  | { type: "SERVICE_WORKER_UPDATE_READY"; scope: "app" | "media" }
  | { type: "SERVICE_WORKER_CONTROLLER_READY" }
  | { type: "BACKGROUND_DRAIN_REQUESTED" };

type 可监听事件目标 = {
  addEventListener?(type: string, listener: (event?: unknown) => void): void;
};

type 可投递消息服务工作线程 = {
  postMessage?(message: unknown): void;
};

export type 服务工作线程注册结果 = 可监听事件目标 & {
  active?: {
    state?: string;
  } | null;
  waiting?: 可投递消息服务工作线程 | null;
  sync?: {
    register(tag: string): Promise<unknown>;
  };
};

type 可注册服务工作线程 = {
  controller?: 可投递消息服务工作线程 | null;
  register(
    url: string,
    options: { scope: string }
  ): Promise<服务工作线程注册结果 | unknown>;
} & 可监听事件目标;

type 平台导航器 =
  | (Navigator & {
      serviceWorker?: 可注册服务工作线程;
    })
  | undefined;

export interface 服务工作线程运行时依赖 {
  navigator?: 平台导航器;
}

export interface 服务工作线程运行时 {
  启动(): Promise<void>;
  snapshot(): 服务工作线程快照;
  订阅事件?(listener: (event: 服务工作线程运行时事件) => void): () => void;
  接受更新?(): boolean;
  发送消息?(message: unknown): boolean;
  写入持久化存储结果?(persisted: boolean): void;
  读取注册(kind: "app" | "media"): 服务工作线程注册结果 | null;
}

const 读取消息类型 = (message: unknown): string | null => {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return null;
  }
  const value = (message as { type?: unknown }).type;
  return typeof value === "string" ? value : null;
};

const 是可注册结果 = (value: unknown): value is 服务工作线程注册结果 =>
  typeof value === "object" && value !== null;

/**
 * 这里统一接管页面和浏览器平台能力的握手：
 * - 注册根 scope worker
 * - best-effort 申请持久化存储
 *
 * 它不判断聊天业务该不该缓存、该不该通知；只做浏览器运行时层面的动作。
 */
export function 创建服务工作线程运行时(
  deps: 服务工作线程运行时依赖 = {}
): 服务工作线程运行时 {
  const platformNavigator =
    deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);
  let started = false;
  let appRegistration: 服务工作线程注册结果 | null = null;
  let mediaRegistration: 服务工作线程注册结果 | null = null;
  const 事件监听器 = new Set<(event: 服务工作线程运行时事件) => void>();

  let current: 服务工作线程快照 = {
    appShellRegistered: false,
    mediaWorkerRegistered: false,
    persistentStorageRequested: false,
    controllerAttached: false,
    appShellWaiting: false,
    mediaWorkerWaiting: false,
    lastMessageType: null,
    lastMessage: null,
  };

  const 更新快照 = (patch: Partial<服务工作线程快照>): void => {
    current = { ...current, ...patch };
  };

  const 发布事件 = (event: 服务工作线程运行时事件): void => {
    for (const listener of 事件监听器) {
      listener(event);
    }
  };

  /**
   * 页面与 SW 的控制权会在首次激活、升级接管、标签恢复时变化。
   * 这里统一把 controller 是否存在收进平台快照，避免壳层自己猜。
   */
  const 同步Controller状态 = (): void => {
    更新快照({
      controllerAttached: Boolean(platformNavigator?.serviceWorker?.controller),
    });
  };

  const 同步共享Worker等待状态 = (registration: unknown): void => {
    const hasWaiting = 是可注册结果(registration) ? Boolean(registration.waiting) : false;
    更新快照({
      appShellWaiting: hasWaiting,
      mediaWorkerWaiting: hasWaiting,
    });
    if (hasWaiting) {
      // 现在根 scope 只有一个 worker owner。
      // 这里仍保留 app/media 两组快照字段，只是把“更新已就绪”统一按 app scope 对外广播。
      发布事件({
        type: "SERVICE_WORKER_UPDATE_READY",
        scope: "app",
      });
    }
  };

  const 绑定容器事件 = (): void => {
    if (!platformNavigator?.serviceWorker?.addEventListener) {
      return;
    }
    platformNavigator.serviceWorker.addEventListener("message", (event) => {
      const payload = (event as { data?: unknown } | undefined)?.data ?? null;
      更新快照({
        lastMessage: payload,
        lastMessageType: 读取消息类型(payload),
      });
      if (读取消息类型(payload) === "BACKGROUND_DRAIN_REQUESTED") {
        发布事件({ type: "BACKGROUND_DRAIN_REQUESTED" });
      }
    });
    platformNavigator.serviceWorker.addEventListener("controllerchange", () => {
      同步Controller状态();
      if (Boolean(platformNavigator?.serviceWorker?.controller)) {
        发布事件({ type: "SERVICE_WORKER_CONTROLLER_READY" });
      }
    });
  };

  return {
    async 启动(): Promise<void> {
      if (started) {
        同步Controller状态();
        return;
      }
      started = true;
      绑定容器事件();
      同步Controller状态();

      if (
        platformNavigator?.serviceWorker &&
        typeof platformNavigator.serviceWorker.register === "function"
      ) {
        try {
          const nextAppRegistration = await platformNavigator.serviceWorker.register("/app-sw.js", {
            scope: "/",
          });
          更新快照({
            appShellRegistered: true,
            mediaWorkerRegistered: true,
          });
          appRegistration = 是可注册结果(nextAppRegistration) ? nextAppRegistration : null;
          mediaRegistration = appRegistration;
          同步共享Worker等待状态(nextAppRegistration);
          if (
            是可注册结果(nextAppRegistration) &&
            typeof nextAppRegistration.addEventListener === "function"
          ) {
            nextAppRegistration.addEventListener("updatefound", () => {
              同步共享Worker等待状态(nextAppRegistration);
            });
          }
        } catch {
          // best-effort：这里不把浏览器平台失败升级成聊天业务失败。
        }
      }

    },

    snapshot(): 服务工作线程快照 {
      return { ...current };
    },

    订阅事件(listener: (event: 服务工作线程运行时事件) => void): () => void {
      事件监听器.add(listener);
      return () => {
        事件监听器.delete(listener);
      };
    },

    接受更新(): boolean {
      let accepted = false;
      // 兼容字段仍保留 app/media 两个入口，但根 scope 实际只有一个 worker owner。
      for (const registration of new Set([appRegistration, mediaRegistration])) {
        const waiting = registration?.waiting;
        if (waiting && typeof waiting.postMessage === "function") {
          waiting.postMessage({ type: "SKIP_WAITING" });
          accepted = true;
        }
      }
      return accepted;
    },

    发送消息(message: unknown): boolean {
      const controller = platformNavigator?.serviceWorker?.controller;
      if (!controller || typeof controller.postMessage !== "function") {
        同步Controller状态();
        return false;
      }
      controller.postMessage(message);
      return true;
    },

    写入持久化存储结果(persisted: boolean): void {
      更新快照({
        persistentStorageRequested: persisted,
      });
    },

    读取注册(kind: "app" | "media"): 服务工作线程注册结果 | null {
      return kind === "app" ? appRegistration : mediaRegistration;
    },
  };
}
