import type { 媒体协作分发定位片段, 媒体定位结果 } from "../契约.js";

export interface WebTorrent浏览器客户端 {
  createServer(options: { controller?: unknown }): unknown;
}

type WebTorrent浏览器构造器 = new () => WebTorrent浏览器客户端;

export interface 协作分发浏览器运行时 {
  client: WebTorrent浏览器客户端;
  streamServer: unknown;
}

let 协作分发浏览器运行时Promise: Promise<协作分发浏览器运行时> | null = null;

async function 默认加载WebTorrent浏览器构造器(): Promise<WebTorrent浏览器构造器> {
  const mod = await import("webtorrent/dist/webtorrent.min.js");
  return (mod.default ?? mod) as WebTorrent浏览器构造器;
}

/**
 * WebTorrent 浏览器侧 stream server 要拿的是已经激活的 registration。
 * 如果只把当前页面 controller 塞进去，首次激活和真实 streamURL 会直接失真。
 */
async function 获取已激活媒体ServiceWorker注册(): Promise<ServiceWorkerRegistration> {
  if (!navigator.serviceWorker?.ready) {
    throw new Error("当前环境不支持 media service worker");
  }
  const registration = await navigator.serviceWorker.ready;
  if (registration.active?.state !== "activated") {
    throw new Error("media service worker 尚未激活");
  }
  return registration;
}

/**
 * Phase 2 先把“浏览器运行时底座”收口在这里：
 * 1. 页面内只创建一个 WebTorrent client；
 * 2. stream server 也跟着 client 单例复用；
 * 3. 真正的 torrent 会话与时间线接线放到后续任务再接，不在这里提前把业务逻辑写死。
 */
export function 读取协作分发定位片段(
  locator: 媒体定位结果
): 媒体协作分发定位片段 | null {
  return locator.distribution ?? null;
}

export async function 获取或创建协作分发浏览器运行时(
  loadCtor: () => Promise<WebTorrent浏览器构造器> = 默认加载WebTorrent浏览器构造器
): Promise<协作分发浏览器运行时> {
  if (!协作分发浏览器运行时Promise) {
    协作分发浏览器运行时Promise = (async () => {
      const WebTorrentCtor = await loadCtor();
      const serviceWorkerRegistration = await 获取已激活媒体ServiceWorker注册();
      const client = new WebTorrentCtor();
      const streamServer = client.createServer({
        controller: serviceWorkerRegistration,
      });
      return { client, streamServer };
    })();
  }
  return 协作分发浏览器运行时Promise;
}

export function 重置协作分发浏览器运行时() {
  协作分发浏览器运行时Promise = null;
}
