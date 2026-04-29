type 预览缓存存储源 = Pick<Storage, "getItem" | "setItem"> | Partial<Storage> | undefined;

export type 预览缓存记录 = {
  contentHash: string;
  objectUrl: string | null;
  source: "embedded_hint" | "early_frame" | "rvfc";
  width: number | null;
  height: number | null;
  updatedAt: number;
};

type 原始预览缓存记录 = Partial<预览缓存记录> & {
  contentHash?: unknown;
  objectUrl?: unknown;
  source?: unknown;
  width?: unknown;
  height?: unknown;
  updatedAt?: unknown;
};

type 预览缓存快照 = Record<string, 预览缓存记录>;
type 附件预览索引快照 = Record<string, string>;

const 预览缓存记录键 = "koko_video_preview_records";
const 预览缓存附件索引键 = "koko_video_preview_attachment_index";

const 读取可空数字 = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const 规范化预览缓存记录 = (raw: unknown): 预览缓存记录 | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as 原始预览缓存记录;
  if (typeof candidate.contentHash !== "string" || candidate.contentHash.length === 0) {
    return null;
  }
  if (
    candidate.source !== "embedded_hint" &&
    candidate.source !== "early_frame" &&
    candidate.source !== "rvfc"
  ) {
    return null;
  }
  return {
    contentHash: candidate.contentHash,
    objectUrl: typeof candidate.objectUrl === "string" ? candidate.objectUrl : null,
    source: candidate.source,
    width: 读取可空数字(candidate.width),
    height: 读取可空数字(candidate.height),
    updatedAt: 读取可空数字(candidate.updatedAt) ?? Date.now(),
  };
};

const 读取记录快照 = (storage: 预览缓存存储源): 预览缓存快照 => {
  const raw = storage?.getItem?.(预览缓存记录键);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized: 预览缓存快照 = {};
    for (const [contentHash, value] of Object.entries(parsed)) {
      const record = 规范化预览缓存记录({
        ...(typeof value === "object" && value ? value : {}),
        contentHash,
      });
      if (record) {
        normalized[contentHash] = record;
      }
    }
    return normalized;
  } catch {
    return {};
  }
};

const 写入记录快照 = (storage: 预览缓存存储源, snapshot: 预览缓存快照): void => {
  storage?.setItem?.(预览缓存记录键, JSON.stringify(snapshot));
};

const 读取附件索引快照 = (storage: 预览缓存存储源): 附件预览索引快照 => {
  const raw = storage?.getItem?.(预览缓存附件索引键);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized: 附件预览索引快照 = {};
    for (const [attachmentId, contentHash] of Object.entries(parsed)) {
      if (typeof contentHash === "string" && contentHash.length > 0) {
        normalized[attachmentId] = contentHash;
      }
    }
    return normalized;
  } catch {
    return {};
  }
};

const 写入附件索引快照 = (
  storage: 预览缓存存储源,
  snapshot: 附件预览索引快照
): void => {
  storage?.setItem?.(预览缓存附件索引键, JSON.stringify(snapshot));
};

export interface 预览缓存端口 {
  保存(record: 预览缓存记录): Promise<void>;
  写入附件索引(attachmentId: string, contentHash: string): Promise<void>;
  按内容读取(contentHash: string): Promise<预览缓存记录 | null>;
  按附件读取(attachmentId: string): Promise<预览缓存记录 | null>;
  snapshot(): {
    recordsByContentHash: 预览缓存快照;
    attachmentToContentHash: 附件预览索引快照;
  };
}

/**
 * preview cache owner 只回答两件事：
 * 1. 某个 content hash 是否已经派生过 preview；
 * 2. 某条附件当前该映射到哪个 content hash。
 *
 * 它不拥有播放链，也不负责决定“现在要不要打开 video”。
 */
export function 创建浏览器预览缓存(
  storage: 预览缓存存储源
): 预览缓存端口 {
  let recordsCache: 预览缓存快照 | null = null;
  let attachmentIndexCache: 附件预览索引快照 | null = null;
  const 读取缓存内记录快照 = (): 预览缓存快照 => {
    recordsCache ??= 读取记录快照(storage);
    return recordsCache;
  };
  const 读取缓存内附件索引快照 = (): 附件预览索引快照 => {
    attachmentIndexCache ??= 读取附件索引快照(storage);
    return attachmentIndexCache;
  };

  return {
    async 保存(record: 预览缓存记录): Promise<void> {
      /**
       * 预览缓存里可能含 dataURL。浏览器 localStorage 是同步 API，滚动热路径上
       * 反复 getItem + JSON.parse 大字符串会直接造成长任务。仓库实例内保留一次
       * 规范化快照，写入时同步更新内存 owner，再落本地持久化。
       */
      const current = 读取缓存内记录快照();
      recordsCache = {
        ...current,
        [record.contentHash]: record,
      };
      写入记录快照(storage, recordsCache);
    },

    async 写入附件索引(attachmentId: string, contentHash: string): Promise<void> {
      const current = 读取缓存内附件索引快照();
      attachmentIndexCache = {
        ...current,
        [attachmentId]: contentHash,
      };
      写入附件索引快照(storage, attachmentIndexCache);
    },

    async 按内容读取(contentHash: string): Promise<预览缓存记录 | null> {
      return 读取缓存内记录快照()[contentHash] ?? null;
    },

    async 按附件读取(attachmentId: string): Promise<预览缓存记录 | null> {
      const contentHash = 读取缓存内附件索引快照()[attachmentId];
      if (!contentHash) {
        return null;
      }
      return 读取缓存内记录快照()[contentHash] ?? null;
    },

    snapshot() {
      return {
        recordsByContentHash: 读取缓存内记录快照(),
        attachmentToContentHash: 读取缓存内附件索引快照(),
      };
    },
  };
}

export function 创建内存预览缓存(
  seed: {
    recordsByContentHash?: 预览缓存快照;
    attachmentToContentHash?: 附件预览索引快照;
  } = {}
): 预览缓存端口 {
  const records = new Map<string, 预览缓存记录>();
  const attachmentIndex = new Map<string, string>();
  for (const [contentHash, record] of Object.entries(seed.recordsByContentHash ?? {})) {
    const normalized = 规范化预览缓存记录({
      ...record,
      contentHash,
    });
    if (normalized) {
      records.set(contentHash, normalized);
    }
  }
  for (const [attachmentId, contentHash] of Object.entries(seed.attachmentToContentHash ?? {})) {
    if (typeof contentHash === "string" && contentHash.length > 0) {
      attachmentIndex.set(attachmentId, contentHash);
    }
  }
  return {
    async 保存(record: 预览缓存记录): Promise<void> {
      records.set(record.contentHash, record);
    },

    async 写入附件索引(attachmentId: string, contentHash: string): Promise<void> {
      attachmentIndex.set(attachmentId, contentHash);
    },

    async 按内容读取(contentHash: string): Promise<预览缓存记录 | null> {
      return records.get(contentHash) ?? null;
    },

    async 按附件读取(attachmentId: string): Promise<预览缓存记录 | null> {
      const contentHash = attachmentIndex.get(attachmentId);
      if (!contentHash) {
        return null;
      }
      return records.get(contentHash) ?? null;
    },

    snapshot() {
      return {
        recordsByContentHash: Object.fromEntries(records),
        attachmentToContentHash: Object.fromEntries(attachmentIndex),
      };
    },
  };
}
