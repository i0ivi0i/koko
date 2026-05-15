// 不手搓 WebTorrent 浏览器侧 worker 协议，继续直接复用官方 sw 入口。
import "webtorrent/dist/sw.min.js";

declare const self: typeof globalThis & {
  clients: {
    matchAll(): Promise<Array<{ postMessage(message: unknown): void }>>;
  };
};

type GoldenRetriever缓存文件 = {
  id: string;
  data: Blob;
};

type GoldenRetriever消息 =
  | { type: "uppy/ADD_FILE"; store: string; file: GoldenRetriever缓存文件 }
  | { type: "uppy/REMOVE_FILE"; store: string; fileID: string }
  | { type: "uppy/GET_FILES"; store: string };

const goldenRetriever文件缓存表 = new Map<string, Record<string, Blob>>();

const 读取GoldenRetriever缓存 = (store: string): Record<string, Blob> => {
  const existing = goldenRetriever文件缓存表.get(store);
  if (existing) {
    return existing;
  }
  const next: Record<string, Blob> = {};
  goldenRetriever文件缓存表.set(store, next);
  return next;
};

const 是GoldenRetriever消息 = (value: unknown): value is GoldenRetriever消息 => {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "uppy/ADD_FILE" || type === "uppy/REMOVE_FILE" || type === "uppy/GET_FILES";
};

self.addEventListener("message", (event) => {
  const data = (event as { data?: unknown }).data;
  if (!是GoldenRetriever消息(data)) {
    return;
  }
  const cache = 读取GoldenRetriever缓存(data.store);
  if (data.type === "uppy/ADD_FILE") {
    cache[data.file.id] = data.file.data;
    return;
  }
  if (data.type === "uppy/REMOVE_FILE") {
    delete cache[data.fileID];
    return;
  }
  void self.clients.matchAll().then((clients) => {
    for (const client of clients) {
      client.postMessage({
        type: "uppy/ALL_FILES",
        store: data.store,
        files: { ...cache },
      });
    }
  });
});

/**
 * 2026-05-05 收尾裁决：
 * 1. 新附件正式图片/视频字节只认同一条 WebTorrent 主链；
 * 2. 因此前端不再额外接管 `/api/media/.../blob/canonical`，避免 CacheStorage 继续长成第二正式读取面；
 * 3. 历史图片若还需要冷备/迁移兼容，应由显式 legacy 路径承接，而不是偷偷复活这里的 fetch hook。
 *
 * 这里故意不注册自定义 `fetch` 监听：
 * - 正式媒体字节读取交给官方 WebTorrent worker；
 * - 非正式 legacy HTTP 读取由正常网络栈处理；
 * - 自定义媒体缓存逻辑在这一步先整体退场，避免继续制造“看起来更快、其实是第二主链”的假成功。
 */
