// 不手搓 WebTorrent 浏览器侧 worker 协议，直接复用官方 sw 入口。
import "webtorrent/dist/sw.min.js";
import { createPartialResponse } from "workbox-range-requests";

type 媒体Fetch事件 = {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
};

const 图片Blob资产缓存名 = "koko-image-blob-assets";
const 图片Blob资产路径模式 = /^\/api\/media\/[^/]+\/blob\/canonical$/;
const 流媒体清单缓存名 = "koko-streaming-manifests";
const 流媒体分段缓存名 = "koko-streaming-segments";
const 流媒体资产路径模式 = /^\/api\/media\/[^/]+\/stream\/.+$/;
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

const 是流媒体请求 = (request: Request): boolean => {
  if (request.method !== "GET") {
    return false;
  }
  try {
    return 流媒体资产路径模式.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
};

const 是流媒体清单请求 = (request: Request): boolean => {
  try {
    return /\.(m3u8|mpd)(?:$|\?)/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
};

const 是流媒体分段请求 = (request: Request): boolean => {
  try {
    return /\.(m4s|mp4|ts)(?:$|\?)/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
};

const 读取流媒体缓存键 = (request: Request): string => request.url;

const 读取缓存中的分段响应 = async (
  cache: Cache,
  request: Request
): Promise<Response | null> => {
  const cached = await cache.match(读取流媒体缓存键(request));
  if (!cached) {
    return null;
  }
  // 浏览器 `<video>` / MSE 会用 Range 只取需要的字节。
  // 这里直接从已缓存的完整分段里切片，避免“明明本地有完整响应，却又重新打网络”。
  if (request.headers.has("range")) {
    return createPartialResponse(request, cached);
  }
  return cached;
};

const 命中或回填流媒体清单缓存 = async (request: Request): Promise<Response> => {
  const cache = await caches.open(流媒体清单缓存名);
  const cacheKey = 读取流媒体缓存键(request);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
    throw error;
  }
};

const 命中或回填流媒体分段缓存 = async (request: Request): Promise<Response> => {
  const cache = await caches.open(流媒体分段缓存名);
  const cached = await 读取缓存中的分段响应(cache, request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  // 只有完整分段才值得落盘；206 partial content 不能冒充“已经拿到完整可复用资产”。
  if (response.ok && response.status !== 206 && !request.headers.has("range")) {
    await cache.put(读取流媒体缓存键(request), response.clone());
  }
  return response;
};

// 这里只给图片 blob 资产补一个受控缓存命中点：
// 1. 命中时直接复用浏览器 CacheStorage；
// 2. miss 时仍走真实网络请求并回填缓存；
// 3. 其它媒体/P2P 请求继续交给官方 WebTorrent worker，不再私造第二套缓存框架。
媒体Worker全局.addEventListener("fetch", (event) => {
  if (是图片Blob资产请求(event.request)) {
    event.respondWith(命中或回填图片资产缓存(event.request));
    return;
  }
  if (!是流媒体请求(event.request)) {
    return;
  }
  // 标准流媒体链只补浏览器级缓存契约：
  // 1. manifest 走 network-first，尽量尊重服务端最新裁决；
  // 2. segment 走 cache-first，重复观看时优先命中本地；
  // 3. 其它 `/webtorrent/*` 与官方 worker 路径保持分离，不在这里混成第二套真相。
  if (是流媒体清单请求(event.request)) {
    event.respondWith(命中或回填流媒体清单缓存(event.request));
    return;
  }
  if (是流媒体分段请求(event.request)) {
    event.respondWith(命中或回填流媒体分段缓存(event.request));
  }
});
