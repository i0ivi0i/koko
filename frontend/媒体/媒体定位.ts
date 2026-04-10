import type { 媒体定位结果 } from "../契约.js";

type 媒体定位器依赖 = {
  getSessionId(): string;
  loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果>;
};

type 定位缓存项 = {
  value: 媒体定位结果;
  stale: boolean;
};

/**
 * 媒体定位器只负责一件事：把 attachment_id 解析成当前会话下可用的 locator。
 * 它不做播放、不做降级判定，也不在这里塞 WebTorrent 运行态。
 */
export function 创建媒体定位器(deps: 媒体定位器依赖) {
  const cache = new Map<string, 定位缓存项>();

  const 读取缓存 = (attachmentId: string): 媒体定位结果 | null =>
    cache.get(attachmentId)?.value ?? null;

  const 标记过期 = (attachmentId: string): void => {
    const cached = cache.get(attachmentId);
    if (!cached) {
      return;
    }
    cache.set(attachmentId, {
      ...cached,
      stale: true,
    });
  };

  const 清空 = (): void => {
    cache.clear();
  };

  const 获取定位 = async (
    attachmentId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<媒体定位结果> => {
    const cached = cache.get(attachmentId);
    if (cached && !cached.stale && !options.forceRefresh) {
      return cached.value;
    }
    const locator = await deps.loadMediaLocator(deps.getSessionId(), attachmentId);
    cache.set(attachmentId, {
      value: locator,
      stale: false,
    });
    return locator;
  };

  return {
    读取缓存,
    获取定位,
    标记过期,
    清空,
  };
}
