import type { 媒体定位结果 } from "../契约.js";

type 媒体定位缓存存储源 = Pick<Storage, "getItem" | "setItem"> | Partial<Storage> | undefined;

export interface 媒体定位缓存记录 {
  attachmentId: string;
  value: 媒体定位结果;
  stale: boolean;
}

export interface 媒体定位缓存仓库 {
  读取(attachmentId: string): Promise<媒体定位缓存记录 | null>;
  保存(record: 媒体定位缓存记录): Promise<void>;
}

type 媒体定位器依赖 = {
  getSessionId(): string;
  loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果>;
  repo?: 媒体定位缓存仓库;
};

type 定位缓存项 = 媒体定位缓存记录;
type 媒体定位缓存快照 = Record<string, 媒体定位缓存记录>;

const 媒体定位缓存存储键 = "koko_media_locators";

type 原始媒体定位缓存记录 = Partial<媒体定位缓存记录> & {
  attachmentId?: unknown;
  value?: unknown;
  stale?: unknown;
};

const 规范化媒体定位结果 = (
  value: unknown,
  fallbackAttachmentId?: string
): 媒体定位结果 | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<媒体定位结果>;
  const attachmentId =
    typeof candidate.attachment_id === "string" && candidate.attachment_id.trim()
      ? candidate.attachment_id
      : fallbackAttachmentId;
  if (!attachmentId) {
    return null;
  }
  if (
    (candidate.kind !== "image" && candidate.kind !== "video") ||
    typeof candidate.status !== "string"
  ) {
    return null;
  }
  return {
    ...candidate,
    attachment_id: attachmentId,
  } as 媒体定位结果;
};

const 规范化媒体定位缓存记录 = (
  raw: unknown,
  fallbackAttachmentId?: string
): 媒体定位缓存记录 | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as 原始媒体定位缓存记录;
  const attachmentId =
    typeof candidate.attachmentId === "string" && candidate.attachmentId.trim()
      ? candidate.attachmentId
      : fallbackAttachmentId;
  if (!attachmentId) {
    return null;
  }
  const value = 规范化媒体定位结果(candidate.value, attachmentId);
  if (!value) {
    return null;
  }
  return {
    attachmentId,
    value,
    stale: candidate.stale === true,
  };
};

const 读取仓库快照 = (storage: 媒体定位缓存存储源): 媒体定位缓存快照 => {
  const raw = storage?.getItem?.(媒体定位缓存存储键);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized: 媒体定位缓存快照 = {};
    for (const [attachmentId, value] of Object.entries(parsed)) {
      const record = 规范化媒体定位缓存记录(value, attachmentId);
      if (record) {
        normalized[attachmentId] = record;
      }
    }
    return normalized;
  } catch {
    return {};
  }
};

const 写入仓库快照 = (storage: 媒体定位缓存存储源, snapshot: 媒体定位缓存快照): void => {
  storage?.setItem?.(媒体定位缓存存储键, JSON.stringify(snapshot));
};

export function 创建浏览器媒体定位缓存仓库(
  storage: 媒体定位缓存存储源
): 媒体定位缓存仓库 {
  return {
    async 读取(attachmentId: string): Promise<媒体定位缓存记录 | null> {
      return 读取仓库快照(storage)[attachmentId] ?? null;
    },

    async 保存(record: 媒体定位缓存记录): Promise<void> {
      const normalized = 规范化媒体定位缓存记录(record, record.attachmentId);
      if (!normalized) {
        return;
      }
      const current = 读取仓库快照(storage);
      写入仓库快照(storage, {
        ...current,
        [record.attachmentId]: normalized,
      });
    },
  };
}

export function 创建内存媒体定位缓存仓库(
  seed: 媒体定位缓存快照 = {}
): 媒体定位缓存仓库 {
  const records = new Map<string, 媒体定位缓存记录>();
  for (const [attachmentId, record] of Object.entries(seed)) {
    const normalized = 规范化媒体定位缓存记录(record, attachmentId);
    if (normalized) {
      records.set(attachmentId, normalized);
    }
  }
  return {
    async 读取(attachmentId: string): Promise<媒体定位缓存记录 | null> {
      return records.get(attachmentId) ?? null;
    },

    async 保存(record: 媒体定位缓存记录): Promise<void> {
      const normalized = 规范化媒体定位缓存记录(record, record.attachmentId);
      if (!normalized) {
        return;
      }
      records.set(record.attachmentId, normalized);
    },
  };
}

/**
 * 媒体定位器只负责一件事：把 attachment_id 解析成当前会话下可用的 locator。
 * 它不做播放、不做降级判定，也不在这里塞 WebTorrent 运行态。
 */
export function 创建媒体定位器(deps: 媒体定位器依赖) {
  const repo = deps.repo ?? 创建内存媒体定位缓存仓库();
  const cache = new Map<string, 定位缓存项>();
  const inflight = new Map<string, Promise<媒体定位结果>>();

  const 读取缓存 = (attachmentId: string): 媒体定位结果 | null =>
    cache.get(attachmentId)?.value ?? null;

  const 读取或恢复缓存 = async (
    attachmentId: string
  ): Promise<定位缓存项 | null> => {
    const memoryCached = cache.get(attachmentId);
    if (memoryCached) {
      return memoryCached;
    }
    const persisted = await repo.读取(attachmentId);
    if (!persisted) {
      return null;
    }
    cache.set(attachmentId, persisted);
    return persisted;
  };

  const 标记过期 = (attachmentId: string): void => {
    const cached = cache.get(attachmentId);
    if (!cached) {
      return;
    }
    const next = {
      ...cached,
      stale: true,
    };
    cache.set(attachmentId, next);
    // 这里只把“这条 locator 已经过期”同步回仓库；
    // 真正何时重签，仍然由下一次获取定位时的 owner 决定。
    void repo.保存(next);
  };

  const 清空 = (): void => {
    cache.clear();
    inflight.clear();
  };

  const 获取定位 = async (
    attachmentId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<媒体定位结果> => {
    const cached = await 读取或恢复缓存(attachmentId);
    if (cached && !cached.stale && !options.forceRefresh) {
      return cached.value;
    }
    const inflightRequest = inflight.get(attachmentId);
    if (inflightRequest) {
      return inflightRequest;
    }
    let request!: Promise<媒体定位结果>;
    request = (async () => {
      try {
        const locator = await deps.loadMediaLocator(deps.getSessionId(), attachmentId);
        const next = {
          attachmentId,
          value: locator,
          stale: false,
        };
        cache.set(attachmentId, next);
        await repo.保存(next);
        return locator;
      } catch (error) {
        if (cached) {
          return cached.value;
        }
        throw error;
      } finally {
        if (inflight.get(attachmentId) === request) {
          inflight.delete(attachmentId);
        }
      }
    })();
    inflight.set(attachmentId, request);
    try {
      return await request;
    } finally {
      if (inflight.get(attachmentId) === request) {
        inflight.delete(attachmentId);
      }
    }
  };

  return {
    读取缓存,
    获取定位,
    标记过期,
    清空,
  };
}
