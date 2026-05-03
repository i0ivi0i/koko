// 不手搓 WebTorrent 浏览器侧 worker 协议，直接复用官方 sw 入口。
import "webtorrent/dist/sw.min.js";

type 媒体Fetch事件 = {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
};

const 图片Blob资产缓存名 = "koko-image-blob-assets";
const 图片Blob资产路径模式 = /^\/api\/media\/[^/]+\/blob\/canonical$/;
const 媒体Worker全局 = globalThis as typeof globalThis & {
  addEventListener(type: "fetch", listener: (event: 媒体Fetch事件) => void): void;
};

const 是图片Blob资产请求 = (request: Request): boolean => {
  if (request.method !== "GET") {
    return false;
  }
  try {
    return 图片Blob资产路径模式.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
};

const 命中或回填图片资产缓存 = async (request: Request): Promise<Response> => {
  const cache = await caches.open(图片Blob资产缓存名);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
};

// 这里只给图片 blob 资产补一个受控缓存命中点：
// 1. 命中时直接复用浏览器 CacheStorage；
// 2. miss 时仍走真实网络请求并回填缓存；
// 3. 其它媒体/P2P 请求继续交给官方 WebTorrent worker，不再私造第二套缓存框架。
//
// 这里显式不再接管 `/stream/*`：
// 1. manifest、segment、Range/206 命中一旦留在自定义 SW 里，就会长成第二正式读取真相；
// 2. 新版裁决要求正式视频字节只认 WebTorrent whole-file 主链，HLS/DASH 只能退到退役基准；
// 3. 因此前端 worker 现在只缓存图片 canonical blob，不再替流媒体做任何“帮忙成功”。
媒体Worker全局.addEventListener("fetch", (event) => {
  if (是图片Blob资产请求(event.request)) {
    event.respondWith(命中或回填图片资产缓存(event.request));
  }
});
