type 媒体缓存存储源 = Pick<Storage, "getItem" | "setItem"> | Partial<Storage> | undefined;

export type 媒体缓存记录 = {
  attachmentId: string;
  complete: boolean;
  contentHash: string | null;
  completedAt: number | null;
};

export interface 媒体缓存仓库 {
  读取(attachmentId: string): Promise<媒体缓存记录 | null>;
  保存(record: 媒体缓存记录): Promise<void>;
  列出(): Promise<媒体缓存记录[]>;
}

export type 媒体缓存快照 = Record<string, 媒体缓存记录>;

type 媒体缓存依赖 = {
  repo: 媒体缓存仓库;
  now?: () => number;
};

const 媒体缓存存储键 = "koko_media_asset_records";

const 读取仓库快照 = (storage: 媒体缓存存储源): 媒体缓存快照 => {
  const raw = storage?.getItem?.(媒体缓存存储键);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as 媒体缓存快照;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const 写入仓库快照 = (storage: 媒体缓存存储源, snapshot: 媒体缓存快照): void => {
  storage?.setItem?.(媒体缓存存储键, JSON.stringify(snapshot));
};

export function 创建浏览器媒体缓存仓库(
  storage: 媒体缓存存储源 = typeof window !== "undefined" ? window.localStorage : undefined
): 媒体缓存仓库 {
  return {
    async 读取(attachmentId: string): Promise<媒体缓存记录 | null> {
      return 读取仓库快照(storage)[attachmentId] ?? null;
    },

    async 保存(record: 媒体缓存记录): Promise<void> {
      const current = 读取仓库快照(storage);
      写入仓库快照(storage, {
        ...current,
        [record.attachmentId]: record,
      });
    },

    async 列出(): Promise<媒体缓存记录[]> {
      return Object.values(读取仓库快照(storage));
    },
  };
}

export function 创建内存媒体缓存仓库(
  seed: 媒体缓存快照 = {}
): 媒体缓存仓库 {
  const records = new Map<string, 媒体缓存记录>(Object.entries(seed));
  return {
    async 读取(attachmentId: string): Promise<媒体缓存记录 | null> {
      return records.get(attachmentId) ?? null;
    },

    async 保存(record: 媒体缓存记录): Promise<void> {
      records.set(record.attachmentId, record);
    },

    async 列出(): Promise<媒体缓存记录[]> {
      return Array.from(records.values());
    },
  };
}

/**
 * 媒体缓存 owner 只回答“哪条附件已经被我们认定为本地完整资产”。
 *
 * 它不保存媒体字节，也不决定播放恢复策略。
 * 这样缓存 owner 只管完整度真相，媒体会话 owner 只管播放/恢复真相，两边边界不会重新糊回一坨。
 */
export function 创建媒体缓存(deps: 媒体缓存依赖) {
  const now = deps.now ?? (() => Date.now());
  let current: 媒体缓存快照 = {};

  return {
    async 启动(): Promise<void> {
      current = {};
      for (const record of await deps.repo.列出()) {
        current[record.attachmentId] = record;
      }
    },

    async 标记完整(
      attachmentId: string,
      input: { contentHash?: string | null } = {}
    ): Promise<void> {
      const next: 媒体缓存记录 = {
        attachmentId,
        complete: true,
        contentHash: input.contentHash ?? null,
        completedAt: now(),
      };
      current = {
        ...current,
        [attachmentId]: next,
      };
      await deps.repo.保存(next);
    },

    snapshot(): 媒体缓存快照 {
      return { ...current };
    },
  };
}

export type { 媒体缓存依赖 };
