import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
  skipWaiting(): Promise<void>;
};

// App Shell worker 只缓存构建期静态壳资源；聊天 API、socket 和媒体业务数据不进入这里。
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
void self.skipWaiting();
clientsClaim();
