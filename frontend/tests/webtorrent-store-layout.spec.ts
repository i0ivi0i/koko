/**
 * WebTorrent ^2.8.5 store layout characterization test.
 *
 * 实测锁定 client.add(torrentBytes, { path }) 的文件查找路径。
 * sidecar 硬链接路径只能复用这里验证过的布局 builder，禁止无测试硬编码。
 *
 * 约束：
 * - 真实 WebTorrent 运行时，不能 mock
 * - 禁用 DHT/tracker/LSD，只做本地 piece verification
 * - 测试内容 < 分块阈值，确保单 piece
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * staging 布局 builder —— sidecar 和本测试共享同一规则。
 *
 * 布局：stagingRoot/<infoHash>/<torrentFileName>
 * client.add 的 { path } 设为 stagingRoot/<infoHash>。
 *
 * 这是 characterization 测试锁定的唯一正确布局。
 * sidecar 硬链接必须复用这两个 builder，禁止另行猜测。
 */
export const buildStagingDir = (
  stagingRoot: string,
  infoHash: string,
): string => path.join(stagingRoot, infoHash);

export const buildStagingFilePath = (
  stagingRoot: string,
  infoHash: string,
  torrentFileName: string,
): string => path.join(stagingRoot, infoHash, torrentFileName);

describe("WebTorrent ^2.8.5 store layout characterization", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups.reverse()) {
      await fn().catch(() => {});
    }
    cleanups.length = 0;
  });

  it("单文件 torrent: client.add(bytes, { path: dir }) 在 dir/<name> 查找文件", async () => {
    // 动态导入真实 WebTorrent（避免 vitest 静态模块解析问题）
    const mod = await import("webtorrent");
    const WebTorrent = mod.default ?? mod;

    const content = Buffer.from("koko-characterization-test-v1");
    const torrentName = "content-abc123def456.mp4";

    // ── Step 1: 生成权威 torrent bytes ──────────────────────
    const seedDir = await mkdtemp(path.join(tmpdir(), "wt-seed-"));
    cleanups.push(() => rm(seedDir, { recursive: true, force: true }));
    await writeFile(path.join(seedDir, torrentName), content);

    const seeder = new WebTorrent({ dht: false, tracker: false, lsd: false });
    cleanups.push(() =>
      new Promise<void>((resolve) => seeder.destroy(() => resolve())),
    );

    const seeded: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("seed timeout")),
        10_000,
      );
      seeder.seed(
        path.join(seedDir, torrentName),
        { announce: [] },
        (torrent: any) => {
          clearTimeout(timer);
          resolve(torrent);
        },
      );
    });

    const torrentBytes = Buffer.from(seeded.torrentFile);
    expect(torrentBytes.length).toBeGreaterThan(0);
    // torrent 内部名称应该就是文件的 basename
    expect(seeded.name).toBe(torrentName);

    const infoHash: string = seeded.infoHash;
    expect(infoHash).toMatch(/^[0-9a-f]{40}$/);

    // ── Step 2: 按 builder 规则放置文件 ─────────────────────
    const stagingRoot = await mkdtemp(path.join(tmpdir(), "wt-staging-"));
    cleanups.push(() => rm(stagingRoot, { recursive: true, force: true }));

    const stagingDir = buildStagingDir(stagingRoot, infoHash);
    await mkdir(stagingDir, { recursive: true });
    await writeFile(
      buildStagingFilePath(stagingRoot, infoHash, torrentName),
      content,
    );

    // ── Step 3: 新 client add + { path: stagingDir } ───────
    const leecher = new WebTorrent({ dht: false, tracker: false, lsd: false });
    cleanups.push(() =>
      new Promise<void>((resolve) => leecher.destroy(() => resolve())),
    );

    const added: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("add timeout")),
        10_000,
      );
      const t = leecher.add(
        torrentBytes,
        { path: stagingDir, announce: [] },
        (torrent: any) => {
          clearTimeout(timer);
          resolve(torrent);
        },
      );
      t.on("error", (err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // 本地 piece verify 应在毫秒级完成，兜底等 5 秒
    if (!added.done) {
      await new Promise<void>((resolve) => {
        const onDone = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          added.removeListener("done", onDone);
          resolve();
        }, 5_000);
        added.once("done", onDone);
      });
    }

    // ── Step 4: 锁定断言 ───────────────────────────────────
    expect(added.done).toBe(true);
    // WebTorrent 的 downloaded 计数包含本地 piece verification 字节，
    // 不能用它区分网络下载和本地校验。done === true + 无网络 (DHT/tracker/LSD 禁用)
    // 已经充分证明纯本地校验通过。
    expect(added.files).toHaveLength(1);
    // 核心断言：WebTorrent 单文件 torrent 在 { path }/<name> 查找文件
    expect(added.files[0].path).toBe(torrentName);

    console.log("[characterization] ✓ layout confirmed: path/<torrentName>");
    console.log("[characterization] files[0].path =", added.files[0].path);
    console.log("[characterization] infoHash =", infoHash);
  }, 30_000);
});
