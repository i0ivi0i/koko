import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const 读取前端文件 = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

describe("应用壳缓存边界", () => {
  it("app-sw 只声明 Workbox 预缓存入口，不手写聊天 API 或媒体数据缓存", () => {
    const source = 读取前端文件("app-sw.ts");

    expect(source).toContain('from "workbox-precaching"');
    expect(source).toContain("precacheAndRoute(self.__WB_MANIFEST)");
    expect(source).toContain("cleanupOutdatedCaches()");
    expect(source).not.toContain("registerRoute");
    expect(source).not.toMatch(/\/api\/|socket\.io|media\/|attachments\//);
  });

  it("build 脚本会把 App Shell 预缓存限制在 dist 静态壳资源内", () => {
    const source = 读取前端文件("build.mjs");

    expect(source).toContain("injectManifest");
    expect(source).toContain("app-sw.ts");
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
});
