// 根 scope 只能有一个 service worker owner。
// 媒体 fetch / WebTorrent 逻辑继续复用既有模块，但必须并进同一个 root worker，
// 否则后注册的 media worker 会把 app shell 的导航控制权整块顶掉。
import "./media-sw";
import { clientsClaim } from "workbox-core";
import type { WorkboxPlugin } from "workbox-core/types";
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  PrecacheFallbackPlugin,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

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
// 这里主动 skipWaiting，是为了兜住“旧壳 JS 已经坏到起不来”的恢复场景：
// 浏览器即使装好了新 worker，坏壳也发不出 SKIP_WAITING；只有让新 worker 自行接管，
// 才不会把 iPhone 用户永久困在旧 controller + 旧 bundle 里。
void self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
const 预缓存应用壳回退插件实例 = new PrecacheFallbackPlugin({
  fallbackURL: "/dist/app-shell.html",
});
// Workbox 官方插件在运行时一定会注入 handlerDidError，
// 但它的 d.ts 在 exactOptionalPropertyTypes 下会把该属性写成“可能是 undefined”。
// 这里把官方回调重新投影成显式插件对象，只收口类型噪音，不改任何恢复语义。
const 预缓存应用壳回退插件: WorkboxPlugin = {
  handlerDidError: 预缓存应用壳回退插件实例.handlerDidError!,
};
const 在线优先导航策略 = new NetworkOnly({
  networkTimeoutSeconds: 4,
  plugins: [
    预缓存应用壳回退插件,
  ],
});
// 导航在线时先取服务端最新 HTML，只有离线或超时才回退到构建期生成的 app-shell.html：
// 1. 它只包含静态 HTML + 已预缓存的 JS/CSS；
// 2. `/api/*`、`/socket.io/*` 这类运行态入口继续留给真实网络或上层恢复编排裁决；
// 3. 这样既保留离线刷新，又避免旧 iOS 长期被 SW 喂旧 bundle 后停在黑屏壳。
registerRoute(
  new NavigationRoute(在线优先导航策略, {
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
