import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webtorrent/dist/sw.min.js", () => ({}));

type Fetch监听器 = (event: {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}) => void;

type 假缓存对象 = {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const 读取缓存键 = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const 创建假缓存 = (初始响应: Array<[string, Response]> = []): 假缓存对象 & { store: Map<string, Response> } => {
  const store = new Map<string, Response>(初始响应);
  return {
    store,
    match: vi.fn(async (input: RequestInfo | URL) => store.get(读取缓存键(input))),
    put: vi.fn(async (input: RequestInfo | URL, response: Response) => {
      store.set(读取缓存键(input), response);
    }),
  };
};

async function 准备媒体服务工作线程(input?: {
  缓存?: 假缓存对象 & { store: Map<string, Response> };
  fetch?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const 监听器表 = new Map<string, Fetch监听器[]>();
  const 缓存 = input?.缓存 ?? 创建假缓存();
  const fetchMock =
    input?.fetch ??
    vi.fn(async () => new Response("network", { status: 200, headers: { "content-type": "text/plain" } }));
  vi.stubGlobal("caches", {
    open: vi.fn(async () => 缓存),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("addEventListener", ((type: string, listener: Fetch监听器) => {
    const listeners = 监听器表.get(type) ?? [];
    listeners.push(listener);
    监听器表.set(type, listeners);
  }) as typeof addEventListener);

  await import("../media-sw");

  return {
    缓存,
    fetchMock,
    async 执行请求(request: Request): Promise<Response> {
      const fetchHandler = 监听器表.get("fetch")?.at(-1);
      let responsePromise: Promise<Response> | null = null;
      fetchHandler?.({
        request,
        respondWith(response) {
          responsePromise = Promise.resolve(response);
        },
      });
      if (!responsePromise) {
        throw new Error(`media-sw 未接管请求: ${request.url}`);
      }
      return responsePromise;
    },
  };
}

describe("媒体服务工作线程", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("不再接管图片 canonical blob 资产缓存，避免它继续充当新图片正式主链", async () => {
    const url = "http://media.local/api/media/att-image-1/blob/canonical";
    const cache = 创建假缓存([[url, new Response("cached-image", { status: 200 })]]);
    const runtime = await 准备媒体服务工作线程({ 缓存: cache });

    await expect(runtime.执行请求(new Request(url))).rejects.toThrow(
      "media-sw 未接管请求"
    );
    expect(runtime.fetchMock).not.toHaveBeenCalled();
  });

  it("不再接管 HLS/CMAF segment 请求，避免 Service Worker 缓存长成第二正式链", async () => {
    const url = "http://media.local/api/media/att-video-1/stream/hls/video/1.m4s?session_id=s-1";
    const cache = 创建假缓存([[url, new Response("cached-segment", { status: 200 })]]);
    const runtime = await 准备媒体服务工作线程({ 缓存: cache });

    await expect(runtime.执行请求(new Request(url))).rejects.toThrow(
      "media-sw 未接管请求"
    );
    expect(runtime.fetchMock).not.toHaveBeenCalled();
  });

  it("不再接管 manifest 请求，避免 CacheStorage 命中被误记成正式播放成功", async () => {
    const url = "http://media.local/api/media/att-video-1/stream/hls/master.m3u8?session_id=s-1";
    const cache = 创建假缓存([[url, new Response("#EXTM3U\n# cached", { status: 200 })]]);
    const runtime = await 准备媒体服务工作线程({
      缓存: cache,
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });

    await expect(runtime.执行请求(new Request(url))).rejects.toThrow(
      "media-sw 未接管请求"
    );
    expect(runtime.fetchMock).not.toHaveBeenCalled();
  });

  it("不再替流媒体 Range 请求切 206 响应，避免 workbox-range-requests 继续充当正式读取真相", async () => {
    const url = "http://media.local/api/media/att-video-1/stream/dash/video/1.m4s?session_id=s-1";
    const bytes = Uint8Array.from([10, 20, 30, 40]);
    const cache = 创建假缓存([[url, new Response(bytes, { status: 200 })]]);
    const runtime = await 准备媒体服务工作线程({ 缓存: cache });

    await expect(
      runtime.执行请求(
        new Request(url, {
          headers: {
            Range: "bytes=1-2",
          },
        })
      )
    ).rejects.toThrow("media-sw 未接管请求");
    expect(runtime.fetchMock).not.toHaveBeenCalled();
  });
});
