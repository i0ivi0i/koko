type 可监听窗口 = Pick<Window, "addEventListener">;
type 支持后台同步注册 = {
  sync?: {
    register(tag: string): Promise<unknown>;
  };
};

type 可用导航器 =
  | (Navigator & {
      onLine?: boolean;
    })
  | undefined;

export type 离线排队任务能力 = "background-sync" | "none";

export interface 离线运行时快照 {
  online: boolean;
  backgroundSyncSupported: boolean;
  queuedTaskCapability: 离线排队任务能力;
}

export interface 离线运行时依赖 {
  window?: 可监听窗口;
  navigator?: 可用导航器;
}

export interface 离线运行时 {
  就绪(input?: {
    已注册服务工作线程?: Array<支持后台同步注册 | null | undefined>;
  }): Promise<void>;
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
    queuedTaskCapability: "none",
  };

  const 更新在线状态 = (): void => {
    current = {
      ...current,
      online: navigatorTarget?.onLine !== false,
    };
  };

  const 读取后台任务能力 = (
    已注册服务工作线程: Array<支持后台同步注册 | null | undefined>
  ): 离线排队任务能力 =>
    已注册服务工作线程.some((registration) => Boolean(registration?.sync))
      ? "background-sync"
      : "none";

  windowTarget?.addEventListener("online", 更新在线状态);
  windowTarget?.addEventListener("offline", 更新在线状态);

  return {
    async 就绪(
      input: {
        已注册服务工作线程?: Array<支持后台同步注册 | null | undefined>;
      } = {}
    ): Promise<void> {
      const 已注册服务工作线程 = input.已注册服务工作线程 ?? [];
      const queuedTaskCapability = 读取后台任务能力(已注册服务工作线程);
      current = {
        ...current,
        backgroundSyncSupported: queuedTaskCapability === "background-sync",
        queuedTaskCapability,
      };
    },

    snapshot(): 离线运行时快照 {
      return { ...current };
    },
  };
}
