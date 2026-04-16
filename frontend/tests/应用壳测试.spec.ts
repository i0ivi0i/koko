import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const 读取前端文件 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

describe("应用壳缓存边界", () => {
  it("app-sw 会用预缓存应用壳接住导航离线重载，但不手写聊天 API 或媒体数据缓存", () => {
    const source = 读取前端文件("app-sw.ts");

    expect(source).toContain('from "workbox-precaching"');
    expect(source).toContain('from "workbox-routing"');
    expect(source).toContain("precacheAndRoute(self.__WB_MANIFEST)");
    expect(source).toContain("cleanupOutdatedCaches()");
    expect(source).toContain("createHandlerBoundToURL");
    expect(source).toContain("NavigationRoute");
    expect(source).toContain("registerRoute");
    expect(source).toContain("denylist");
    expect(source).not.toContain("caches.open(");
    expect(source).not.toContain("/api/rooms/");
    expect(source).not.toContain("/api/media/");
    expect(source).not.toContain("/api/attachments/");
  });

  it("build 脚本会把 App Shell 预缓存限制在 dist 静态壳资源内", () => {
    const source = 读取前端文件("build.mjs");

    expect(source).toContain("injectManifest");
    expect(source).toContain("modifyURLPrefix");
    expect(source).toContain("'/dist/'");
    expect(source).toContain("app-sw.ts");
    expect(source).toContain("app-shell.html");
    expect(source).toContain("**/*.{html,js,css,png,jpg,jpeg,webp,gif,svg,woff,woff2}");
    expect(source).toContain("media-sw.js");
    expect(source).toContain("asset-manifest.json");
    expect(source).toContain("**/api/**");
    expect(source).toContain("**/socket.io/**");
    expect(source).toContain("**/media/**");
    expect(source).toContain("**/attachments/**");
  });

  it("media-sw 会给图片 blob 受控路由留出缓存命中入口，而不是只剩裸 WebTorrent worker import", () => {
    const source = 读取前端文件("media-sw.ts");

    expect(source).toContain("webtorrent/dist/sw.min.js");
    expect(source).toContain("addEventListener(\"fetch\"");
    expect(source).toContain("\\/blob\\/");
    expect(source).toContain("caches.open");
  });

  it("app-sw 会合并媒体 fetch 逻辑，避免两个根 scope worker 互相抢页面控制权", () => {
    const source = 读取前端文件("app-sw.ts");

    expect(source).toContain('import "./media-sw"');
  });
});
