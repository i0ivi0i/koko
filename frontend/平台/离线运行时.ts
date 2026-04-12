type 可监听窗口 = Pick<Window, "addEventListener">;
type 支持后台同步注册 = {
  sync?: {
    register(tag: string): Promise<unknown>;
  };
};

type 可用ServiceWorker =
  | {
      ready?: Promise<ServiceWorkerRegistration & 支持后台同步注册>;
    }
  | undefined;

type 可用导航器 =
  | (Navigator & {
      onLine?: boolean;
      serviceWorker?: 可用ServiceWorker;
    })
  | undefined;

export interface 离线运行时快照 {
  online: boolean;
  backgroundSyncSupported: boolean;
}

export interface 离线运行时依赖 {
  window?: 可监听窗口;
  navigator?: 可用导航器;
}

export interface 离线运行时 {
  就绪(): Promise<void>;
  snapshot(): 离线运行时快照;
}

/**
 * 离线运行时只回答“浏览器现在是否在线，以及是否具备 Background Sync 能力”。
 * 它不把离线直接解释成消息失败或消息成立，只给平台层提供运行时事实。
 */
export function 创建离线运行时(
  deps: 离线运行时依赖 = {}
): 离线运行时 {
  const windowTarget = deps.window ?? (typeof window !== "undefined" ? window : undefined);
  const navigatorTarget =
    deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

  let current: 离线运行时快照 = {
    online: navigatorTarget?.onLine !== false,
    backgroundSyncSupported: false,
  };

  const 更新在线状态 = (): void => {
    current = {
      ...current,
      online: navigatorTarget?.onLine !== false,
    };
  };

  windowTarget?.addEventListener("online", 更新在线状态);
  windowTarget?.addEventListener("offline", 更新在线状态);

  return {
    async 就绪(): Promise<void> {
      const registration = (await navigatorTarget?.serviceWorker?.ready) as
        | (ServiceWorkerRegistration & 支持后台同步注册)
        | undefined;
      current = {
        ...current,
        backgroundSyncSupported: Boolean(registration?.sync),
      };
    },

    snapshot(): 离线运行时快照 {
      return { ...current };
    },
  };
}
