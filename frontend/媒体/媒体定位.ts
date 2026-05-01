import type { 媒体定位结果 } from "../聊天共享/契约.js";

type 媒体定位缓存存储源 = Pick<Storage, "getItem" | "setItem"> | Partial<Storage> | undefined;

export interface 媒体定位缓存记录 {
  attachmentId: string;
  sessionId?: string | null;
  value: 媒体定位结果;
  stale: boolean;
}

export interface 媒体定位缓存仓库 {
  读取(attachmentId: string): Promise<媒体定位缓存记录 | null>;
  保存(record: 媒体定位缓存记录): Promise<void>;
}

type 媒体定位器依赖 = {
  getSessionId(): string;
  loadMediaLocator(
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<媒体定位结果>;
  repo?: 媒体定位缓存仓库;
};

type 定位缓存项 = 媒体定位缓存记录;
type 媒体定位缓存快照 = Record<string, 媒体定位缓存记录>;
type 进行中定位请求 = {
  promise: Promise<媒体定位结果>;
  controller: AbortController;
  requestVersion: number;
};

const 媒体定位缓存存储键 = "koko_media_locators";

type 原始媒体定位缓存记录 = Partial<媒体定位缓存记录> & {
  attachmentId?: unknown;
  sessionId?: unknown;
  value?: unknown;
  stale?: unknown;
};

const 读取可空会话编号 = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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
    sessionId: 读取可空会话编号(candidate.sessionId),
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
  const inflight = new Map<string, 进行中定位请求>();
  const requestVersionByAttachment = new Map<string, number>();

  const 创建定位中止错误 = (): Error => {
    const error = new Error("media locator request aborted");
    error.name = "AbortError";
    return error;
  };

  const 是否定位中止错误 = (error: unknown): boolean =>
    error instanceof Error && error.name === "AbortError";

  /**
   * 每个 attachment 的 locator 请求都带独立代次：
   * 1. 单附件退场时要允许只作废这一条旧请求，而不是把整个定位器全清；
   * 2. 即使底层 transport/mock 没有真的响应 AbortSignal，旧请求回来的时候也必须识别为过期；
   * 3. 因此“signal.abort + requestVersion 失效”两层同时保留，避免 stale locator 回写缓存。
   */
  const 推进定位请求代次 = (attachmentId: string): number => {
    const nextVersion = (requestVersionByAttachment.get(attachmentId) ?? 0) + 1;
    requestVersionByAttachment.set(attachmentId, nextVersion);
    return nextVersion;
  };

  const 读取定位请求代次 = (attachmentId: string): number =>
    requestVersionByAttachment.get(attachmentId) ?? 0;

  /**
   * locator 缓存必须跟 session 一起收口：
   * 1. ticket / 可访问地址天然属于当前会话；
   * 2. 旧 session 的 locator 不能在新 session 里冒充仍然可用；
   * 3. 因此内存态和持久态都只允许命中当前 session。
   */
  const 缓存命中当前会话 = (
    record: 定位缓存项 | null | undefined,
    sessionId: string
  ): record is 定位缓存项 => Boolean(record && record.sessionId === sessionId);

  const 读取缓存 = (attachmentId: string): 媒体定位结果 | null => {
    const currentSessionId = deps.getSessionId();
    const cached = cache.get(attachmentId);
    return 缓存命中当前会话(cached, currentSessionId) ? cached.value : null;
  };

  const 读取或恢复缓存 = async (
    attachmentId: string,
    sessionId: string
  ): Promise<定位缓存项 | null> => {
    const memoryCached = cache.get(attachmentId);
    if (缓存命中当前会话(memoryCached, sessionId)) {
      return memoryCached;
    }
    if (memoryCached) {
      cache.delete(attachmentId);
    }
    const persisted = await repo.读取(attachmentId);
    if (!缓存命中当前会话(persisted, sessionId)) {
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

  const 放弃未完成定位 = (attachmentId: string): void => {
    const request = inflight.get(attachmentId);
    if (!request) {
      return;
    }
    inflight.delete(attachmentId);
    推进定位请求代次(attachmentId);
    request.controller.abort();
  };

  const 清空 = (): void => {
    for (const attachmentId of Array.from(inflight.keys())) {
      放弃未完成定位(attachmentId);
    }
    cache.clear();
    inflight.clear();
    requestVersionByAttachment.clear();
  };

  const 获取定位 = async (
    attachmentId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<媒体定位结果> => {
    const currentSessionId = deps.getSessionId();
    const cached = await 读取或恢复缓存(attachmentId, currentSessionId);
    if (cached && !cached.stale && !options.forceRefresh) {
      return cached.value;
    }
    const inflightRequest = inflight.get(attachmentId);
    if (inflightRequest) {
      return inflightRequest.promise;
    }
    const requestVersion = 推进定位请求代次(attachmentId);
    const controller = new AbortController();
    let requestState!: 进行中定位请求;
    let request!: Promise<媒体定位结果>;
    request = (async () => {
      try {
        const locator = await deps.loadMediaLocator(
          currentSessionId,
          attachmentId,
          controller.signal
        );
        if (
          controller.signal.aborted ||
          读取定位请求代次(attachmentId) !== requestVersion
        ) {
          throw 创建定位中止错误();
        }
        const next = {
          attachmentId,
          sessionId: currentSessionId,
          value: locator,
          stale: false,
        };
        cache.set(attachmentId, next);
        await repo.保存(next);
        return locator;
      } catch (error) {
        if (
          controller.signal.aborted ||
          读取定位请求代次(attachmentId) !== requestVersion
        ) {
          throw (是否定位中止错误(error) ? error : 创建定位中止错误());
        }
        if (cached) {
          return cached.value;
        }
        throw error;
      } finally {
        if (inflight.get(attachmentId) === requestState) {
          inflight.delete(attachmentId);
        }
      }
    })();
    requestState = {
      promise: request,
      controller,
      requestVersion,
    };
    inflight.set(attachmentId, requestState);
    try {
      return await request;
    } finally {
      if (inflight.get(attachmentId) === requestState) {
        inflight.delete(attachmentId);
      }
    }
  };

  return {
    读取缓存,
    获取定位,
    标记过期,
    放弃未完成定位,
    清空,
  };
}
