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
    expect(source).toContain("PrecacheFallbackPlugin");
    expect(source).toContain("NavigationRoute");
    expect(source).toContain("registerRoute");
    expect(source).toContain('from "workbox-strategies"');
    expect(source).toContain("NetworkOnly");
    expect(source).toContain("networkTimeoutSeconds");
    expect(source).toContain("denylist");
    expect(source).not.toContain("createHandlerBoundToURL(");
    expect(source).not.toContain("caches.open(");
    expect(source).not.toContain("/api/rooms/");
    expect(source).not.toContain("/api/media/");
    expect(source).not.toContain("/api/attachments/");
  });

  it("app-sw 会在新壳安装后立即接管，同时保留显式接受更新入口，避免坏壳把旧 controller 卡死", () => {
    const source = 读取前端文件("app-sw.ts");

    expect(source).toContain('if (payload?.type === "SKIP_WAITING")');
    expect(source).toContain('if (payload?.type === "CLAIM_CLIENTS")');
    expect(source.match(/void self\.skipWaiting\(\);/g)?.length ?? 0).toBe(2);
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

  it("build 脚本会统一降到 iPhone Safari 可解析的语法目标，避免旧 WebKit 在启动前黑屏", () => {
    const source = 读取前端文件("build.mjs");

    expect(source).toMatch(/const 浏览器构建目标 = \[\s*'safari14'\s*\]/);
    expect(source).toMatch(/const 浏览器构建能力覆盖 = \{\s*destructuring: true\s*\}/);
    expect(source.match(/target: 浏览器构建目标/g)?.length ?? 0).toBe(4);
    expect(source.match(/supported: 浏览器构建能力覆盖/g)?.length ?? 0).toBe(4);
    expect(source).not.toContain("target: 'es2022'");
    expect(source).not.toContain('target: "es2022"');
  });

  it("build 脚本会把 source hash worker 作为独立产物构建并在 app 清理时保留", () => {
    const source = 读取前端文件("build.mjs");

    expect(source).toContain("source-hash-worker.js");
    expect(source).toContain("媒体/源文件哈希.worker.ts");
    expect(source).toContain("sourceHashWorkerOutputFiles");
    expect(source).toContain("sourceHashWorkerBuildOptions");
    expect(source).toContain("...sourceHashWorkerOutputFiles");
  });

  it("media-sw 已退回官方 WebTorrent worker，不再偷偷接管 blob canonical 第二主链", () => {
    const source = 读取前端文件("media-sw.ts");

    expect(source).toContain("webtorrent/dist/sw.min.js");
    expect(source).not.toContain("addEventListener(\"fetch\"");
    expect(source).not.toContain("\\/blob\\/");
    expect(source).not.toContain("caches.open");
  });

  it("app-sw 会合并媒体 fetch 逻辑，避免两个根 scope worker 互相抢页面控制权", () => {
    const source = 读取前端文件("app-sw.ts");

    expect(source).toContain('import "./media-sw"');
  });

  it("watch 模式下 app hash 变化后会同步刷新 app-sw 预缓存，避免 service worker 持续引用陈旧 dist 产物", () => {
    const source = 读取前端文件("build.mjs");

    expect(source).toContain("app-sw.raw.js");
    expect(source).toContain("是否存在应用壳预缓存原始入口");
    expect(source).toContain("await 注入应用壳预缓存清单()");
    expect(source).toContain("if (!watchMode) {");
    expect(source).toContain("rmSync(path.join(distDir, 'app-sw.raw.js'), { force: true })");
  });
});
