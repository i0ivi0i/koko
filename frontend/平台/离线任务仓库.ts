import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface 平台离线任务 {
  id: string;
  kind: "create_message";
  payload: unknown;
  createdAt: number;
  retryAt: number;
  dedupeKey?: string;
}

export interface 离线任务存储实现 {
  保存(task: 平台离线任务): Promise<void>;
  删除(taskId: string): Promise<void>;
  按任务标识读取(taskId: string): Promise<平台离线任务 | null>;
  按去重键读取(dedupeKey: string): Promise<平台离线任务 | null>;
  读取到期任务(now: number): Promise<平台离线任务[]>;
}

export interface 离线任务仓库 {
  保存(task: 平台离线任务): Promise<boolean>;
  列出到期任务(now: number): Promise<平台离线任务[]>;
  删除(taskId: string): Promise<void>;
  标记重试(taskId: string, retryAt: number): Promise<void>;
}

export interface 离线任务仓库依赖 {
  存储实现?: 离线任务存储实现;
}

interface 离线任务数据库定义 extends DBSchema {
  tasks: {
    key: string;
    value: 平台离线任务;
    indexes: {
      byDedupeKey: string;
      byRetryAt: number;
    };
  };
}

const 数据库名称 = "koko-offline-tasks";
const 数据库版本 = 1;
const 任务存储名 = "tasks";
const 去重索引名 = "byDedupeKey";
const 重试时间索引名 = "byRetryAt";

const 创建内存离线任务存储实现 = (): 离线任务存储实现 => {
  const tasks = new Map<string, 平台离线任务>();

  const 复制任务 = (task: 平台离线任务): 平台离线任务 => ({ ...task });

  return {
    async 保存(task: 平台离线任务): Promise<void> {
      tasks.set(task.id, 复制任务(task));
    },

    async 删除(taskId: string): Promise<void> {
      tasks.delete(taskId);
    },

    async 按任务标识读取(taskId: string): Promise<平台离线任务 | null> {
      const task = tasks.get(taskId);
      return task ? 复制任务(task) : null;
    },

    async 按去重键读取(dedupeKey: string): Promise<平台离线任务 | null> {
      for (const task of tasks.values()) {
        if (task.dedupeKey === dedupeKey) {
          return 复制任务(task);
        }
      }
      return null;
    },

    async 读取到期任务(now: number): Promise<平台离线任务[]> {
      return Array.from(tasks.values())
        .filter((task) => task.retryAt <= now)
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((task) => 复制任务(task));
    },
  };
};

const 创建默认离线任务存储实现 = (): 离线任务存储实现 => {
  // 运行在无 IndexedDB 的测试环境时退化为内存实现，避免因为平台能力缺失导致运行时直接不可用。
  if (typeof indexedDB === "undefined" || typeof IDBKeyRange === "undefined") {
    return 创建内存离线任务存储实现();
  }

  let 数据库Promise: Promise<IDBPDatabase<离线任务数据库定义>> | null = null;
  const 读取数据库 = (): Promise<IDBPDatabase<离线任务数据库定义>> => {
    if (!数据库Promise) {
      数据库Promise = openDB<离线任务数据库定义>(数据库名称, 数据库版本, {
        upgrade(db) {
          const store = db.createObjectStore(任务存储名, { keyPath: "id" });
          store.createIndex(去重索引名, "dedupeKey", { unique: false });
          store.createIndex(重试时间索引名, "retryAt", { unique: false });
        },
      });
    }
    return 数据库Promise;
  };

  const 复制任务 = (task: 平台离线任务 | null | undefined): 平台离线任务 | null =>
    task ? { ...task } : null;

  return {
    async 保存(task: 平台离线任务): Promise<void> {
      const db = await 读取数据库();
      await db.put(任务存储名, { ...task });
    },

    async 删除(taskId: string): Promise<void> {
      const db = await 读取数据库();
      await db.delete(任务存储名, taskId);
    },

    async 按任务标识读取(taskId: string): Promise<平台离线任务 | null> {
      const db = await 读取数据库();
      return 复制任务(await db.get(任务存储名, taskId));
    },

    async 按去重键读取(dedupeKey: string): Promise<平台离线任务 | null> {
      const db = await 读取数据库();
      return 复制任务(
        await db.getFromIndex(任务存储名, 去重索引名, dedupeKey)
      );
    },

    async 读取到期任务(now: number): Promise<平台离线任务[]> {
      const db = await 读取数据库();
      const raw = await db.getAllFromIndex(
        任务存储名,
        重试时间索引名,
        IDBKeyRange.upperBound(now)
      );
      return raw
        .map((task) => ({ ...task }))
        .sort((left, right) => left.createdAt - right.createdAt);
    },
  };
};

/**
 * 离线任务仓库只做队列级别的持久化语义：
 * 1. 去重：同一 dedupeKey 只保留一条待补发任务；
 * 2. 到期读取：按 retryAt 挑出当前可重放任务；
 * 3. 重试标记：更新 retryAt，交给调度器下一轮再尝试。
 *
 * 它不判断消息是否业务成立，不解释 payload，只处理平台层队列事实。
 */
export function 创建离线任务仓库(
  deps: 离线任务仓库依赖 = {}
): 离线任务仓库 {
  const 存储实现 = deps.存储实现 ?? 创建默认离线任务存储实现();

  return {
    async 保存(task: 平台离线任务): Promise<boolean> {
      if (task.dedupeKey) {
        const duplicated = await 存储实现.按去重键读取(task.dedupeKey);
        if (duplicated) {
          return false;
        }
      }
      await 存储实现.保存(task);
      return true;
    },

    async 列出到期任务(now: number): Promise<平台离线任务[]> {
      return 存储实现.读取到期任务(now);
    },

    async 删除(taskId: string): Promise<void> {
      await 存储实现.删除(taskId);
    },

    async 标记重试(taskId: string, retryAt: number): Promise<void> {
      const task = await 存储实现.按任务标识读取(taskId);
      if (!task) {
        return;
      }
      await 存储实现.保存({
        ...task,
        retryAt,
      });
    },
  };
}
