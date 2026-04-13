type 媒体缓存存储源 = Pick<Storage, "getItem" | "setItem"> | Partial<Storage> | undefined;

export type 媒体资产种类 = "image" | "video";

export type 媒体缓存记录 = {
  attachmentId: string;
  complete: boolean;
  kind: 媒体资产种类 | null;
  contentHash: string | null;
  retainedAt: number | null;
  lastAccessAt: number | null;
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

type 原始媒体缓存记录 = Partial<媒体缓存记录> & {
  attachmentId?: unknown;
  complete?: unknown;
  kind?: unknown;
  contentHash?: unknown;
  retainedAt?: unknown;
  lastAccessAt?: unknown;
  completedAt?: unknown;
};

const 读取可空时间戳 = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const 规范化媒体缓存记录 = (
  raw: unknown,
  fallbackAttachmentId?: string
): 媒体缓存记录 | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as 原始媒体缓存记录;
  const attachmentId =
    typeof candidate.attachmentId === "string" && candidate.attachmentId.length > 0
      ? candidate.attachmentId
      : fallbackAttachmentId;
  if (!attachmentId) {
    return null;
  }
  const retainedAt =
    读取可空时间戳(candidate.retainedAt) ?? 读取可空时间戳(candidate.completedAt);
  return {
    attachmentId,
    complete: candidate.complete === true,
    kind: candidate.kind === "image" || candidate.kind === "video" ? candidate.kind : null,
    contentHash: typeof candidate.contentHash === "string" ? candidate.contentHash : null,
    retainedAt,
    lastAccessAt: 读取可空时间戳(candidate.lastAccessAt) ?? retainedAt,
  };
};

const 读取仓库快照 = (storage: 媒体缓存存储源): 媒体缓存快照 => {
  const raw = storage?.getItem?.(媒体缓存存储键);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized: 媒体缓存快照 = {};
    for (const [attachmentId, value] of Object.entries(parsed)) {
      const record = 规范化媒体缓存记录(value, attachmentId);
      if (record) {
        normalized[attachmentId] = record;
      }
    }
    return normalized;
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
  const records = new Map<string, 媒体缓存记录>();
  for (const [attachmentId, record] of Object.entries(seed)) {
    const normalized = 规范化媒体缓存记录(record, attachmentId);
    if (normalized) {
      records.set(attachmentId, normalized);
    }
  }
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
      input: { kind?: 媒体资产种类 | null; contentHash?: string | null } = {}
    ): Promise<void> {
      const previous = current[attachmentId];
      const currentEpoch = now();
      const next: 媒体缓存记录 = {
        attachmentId,
        complete: true,
        kind: input.kind ?? previous?.kind ?? null,
        contentHash: input.contentHash ?? previous?.contentHash ?? null,
        // retainedAt 表示“我们第一次把它认定为可长期保留的完整资产”的时刻，
        // 不应该因为重复 complete 事件就被反复覆盖。
        retainedAt: previous?.retainedAt ?? currentEpoch,
        lastAccessAt: currentEpoch,
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
