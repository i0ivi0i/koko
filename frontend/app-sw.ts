// 根 scope 只能有一个 service worker owner。
// 媒体 fetch / WebTorrent 逻辑继续复用既有模块，但必须并进同一个 root worker，
// 否则后注册的 media worker 会把 app shell 的导航控制权整块顶掉。
import "./media-sw";
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

type 可通信窗口客户端 = {
  postMessage(message: unknown): void;
};

type 可匹配客户端集合 = {
  matchAll(options?: { type?: "window" | "worker" | "sharedworker" | "all"; includeUncontrolled?: boolean }): Promise<
    可通信窗口客户端[]
  >;
};

type 可监听消息事件 = {
  data?: unknown;
};

type 可监听同步事件 = {
  tag?: string;
  waitUntil(promise: Promise<unknown>): void;
};

declare const self: {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  clients: 可匹配客户端集合;
  skipWaiting(): Promise<void>;
  addEventListener(type: "message", listener: (event: 可监听消息事件) => void): void;
  addEventListener(type: "sync", listener: (event: 可监听同步事件) => void): void;
};

const 向受控页面广播后台补发请求 = async (): Promise<void> => {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage({ type: "BACKGROUND_DRAIN_REQUESTED" });
  }
};

// App Shell worker 只缓存构建期静态壳资源；聊天 API、socket 和媒体业务数据不进入这里。
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// 离线导航只回退到构建期生成的 app-shell.html：
// 1. 它只包含静态 HTML + 已预缓存的 JS/CSS；
// 2. `/api/*`、`/socket.io/*` 这类运行态入口继续留给真实网络或上层恢复编排裁决；
// 3. 这样离线刷新至少能重新拉起应用壳，不会直接掉进 chrome-error 页面。
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/dist/app-shell.html"), {
    denylist: [
      /^\/api\//,
      /^\/socket\.io\//,
      /^\/app-sw\.js$/,
      /^\/media-sw\.js$/,
    ],
  })
);
clientsClaim();

self.addEventListener("message", (event) => {
  const payload = event.data as { type?: string } | null | undefined;
  if (payload?.type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }
  if (payload?.type === "REQUEST_BACKGROUND_DRAIN") {
    void 向受控页面广播后台补发请求();
  }
});

self.addEventListener("sync", (event) => {
  if (typeof event.tag === "string" && event.tag.startsWith("koko-queue-")) {
    event.waitUntil(向受控页面广播后台补发请求());
  }
});
