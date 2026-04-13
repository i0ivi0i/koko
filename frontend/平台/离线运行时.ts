import {
  创建离线任务仓库,
  type 平台离线任务,
  type 离线任务仓库,
} from "./离线任务仓库.js";

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
  仓库?: 离线任务仓库;
  now?: () => number;
}

export interface 离线运行时 {
  就绪(input?: {
    已注册服务工作线程?: Array<支持后台同步注册 | null | undefined>;
  }): Promise<void>;
  订阅?(listener: (snapshot: 离线运行时快照) => void): () => void;
  登记待补发任务?(task: 平台离线任务): Promise<boolean>;
  排空到期任务?(
    handler: (task: 平台离线任务) => Promise<"done" | "retry">
  ): Promise<void>;
  请求后台补发同步?(tag: string): Promise<boolean>;
  snapshot(): 离线运行时快照;
}

/**
 * 离线运行时是平台层的离线调度器：
 * 1. 维护在线状态与 background sync 能力快照；
 * 2. 维护待补发任务队列的登记、排空、重试；
 * 3. 只处理时机与队列，不解释聊天业务 payload。
 */
export function 创建离线运行时(
  deps: 离线运行时依赖 = {}
): 离线运行时 {
  const windowTarget = deps.window ?? (typeof window !== "undefined" ? window : undefined);
  const navigatorTarget =
    deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);
  const now = deps.now ?? (() => Date.now());
  const 仓库 = deps.仓库 ?? 创建离线任务仓库();
  let 已注册服务工作线程: Array<支持后台同步注册 | null | undefined> = [];
  const 默认重试间隔毫秒 = 3_000;

  let current: 离线运行时快照 = {
    online: navigatorTarget?.onLine !== false,
    backgroundSyncSupported: false,
    queuedTaskCapability: "none",
  };
  const 监听器 = new Set<(snapshot: 离线运行时快照) => void>();

  const 发布快照 = (): void => {
    const snapshot = { ...current };
    for (const listener of 监听器) {
      listener(snapshot);
    }
  };

  const 更新在线状态 = (): void => {
    const nextOnline = navigatorTarget?.onLine !== false;
    if (current.online === nextOnline) {
      return;
    }
    current = {
      ...current,
      online: nextOnline,
    };
    发布快照();
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
      已注册服务工作线程 = input.已注册服务工作线程 ?? [];
      const queuedTaskCapability = 读取后台任务能力(已注册服务工作线程);
      current = {
        ...current,
        backgroundSyncSupported: queuedTaskCapability === "background-sync",
        queuedTaskCapability,
      };
    },

    订阅(listener: (snapshot: 离线运行时快照) => void): () => void {
      监听器.add(listener);
      return () => {
        监听器.delete(listener);
      };
    },

    async 登记待补发任务(task: 平台离线任务): Promise<boolean> {
      return 仓库.保存(task);
    },

    async 排空到期任务(
      handler: (task: 平台离线任务) => Promise<"done" | "retry">
    ): Promise<void> {
      const 到期任务 = await 仓库.列出到期任务(now());
      for (const task of 到期任务) {
        try {
          const out = await handler(task);
          if (out === "done") {
            await 仓库.删除(task.id);
            continue;
          }
        } catch {
          // 失败会回到统一重试路径，避免把错误吞到业务层再重复判定。
        }
        await 仓库.标记重试(task.id, now() + 默认重试间隔毫秒);
      }
    },

    async 请求后台补发同步(tag: string): Promise<boolean> {
      for (const registration of 已注册服务工作线程) {
        if (typeof registration?.sync?.register !== "function") {
          continue;
        }
        try {
          await registration.sync.register(tag);
          return true;
        } catch {
          // 某个 registration 注册失败时继续尝试其他 worker registration。
        }
      }
      return false;
    },

    snapshot(): 离线运行时快照 {
      return { ...current };
    },
  };
}
