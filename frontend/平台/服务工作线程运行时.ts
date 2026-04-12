export interface 服务工作线程快照 {
  appShellRegistered: boolean;
  mediaWorkerRegistered: boolean;
  persistentStorageRequested: boolean;
}

type 可注册服务工作线程 = {
  register(url: string, options: { scope: string }): Promise<unknown>;
};

type 可持久化存储 = {
  persist(): Promise<unknown>;
};

type 平台导航器 =
  | (Navigator & {
      serviceWorker?: 可注册服务工作线程;
      storage?: NavigatorStorage["storage"] & 可持久化存储;
    })
  | undefined;

export interface 服务工作线程运行时依赖 {
  navigator?: 平台导航器;
}

export interface 服务工作线程运行时 {
  启动(): Promise<void>;
  snapshot(): 服务工作线程快照;
}

/**
 * 这里统一接管页面和浏览器平台能力的握手：
 * - 注册 app shell worker
 * - 注册 media worker
 * - best-effort 申请持久化存储
 *
 * 它不判断聊天业务该不该缓存、该不该通知；只做浏览器运行时层面的动作。
 */
export function 创建服务工作线程运行时(
  deps: 服务工作线程运行时依赖 = {}
): 服务工作线程运行时 {
  const platformNavigator =
    deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

  let current: 服务工作线程快照 = {
    appShellRegistered: false,
    mediaWorkerRegistered: false,
    persistentStorageRequested: false,
  };

  return {
    async 启动(): Promise<void> {
      if (
        platformNavigator?.serviceWorker &&
        typeof platformNavigator.serviceWorker.register === "function"
      ) {
        try {
          await platformNavigator.serviceWorker.register("/app-sw.js", { scope: "/" });
          current = { ...current, appShellRegistered: true };
        } catch {
          // best-effort：这里不把浏览器平台失败升级成聊天业务失败。
        }

        try {
          await platformNavigator.serviceWorker.register("/media-sw.js", { scope: "/" });
          current = { ...current, mediaWorkerRegistered: true };
        } catch {
          // media worker 失败同样只留在平台层快照里，不污染业务语义。
        }
      }

      if (
        platformNavigator?.storage &&
        typeof platformNavigator.storage.persist === "function"
      ) {
        try {
          await platformNavigator.storage.persist();
          current = { ...current, persistentStorageRequested: true };
        } catch {
          // 持久化申请失败不阻塞应用启动，只保留为平台层状态。
        }
      }
    },

    snapshot(): 服务工作线程快照 {
      return { ...current };
    },
  };
}
