import { describe, expect, it, vi } from "vitest";
import { 零引用完成会话保留上限 } from "../../媒体/资产协作分发生命周期.js";
import { 近视口活视频会话预算上限 } from "../../房间消息窗/媒体窗口.js";
import {
  获取或创建协作分发浏览器运行时,
  重置协作分发浏览器运行时,
} from "../../媒体/媒体协作分发.js";
import type { WebTorrent浏览器客户端 } from "../../媒体/媒体协作分发.js";
import {
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册资产协作分发测试基线,
  解析协作分发源,
} from "./测试支撑.js";

describe("配置调优", () => {
  注册资产协作分发测试基线();
  /**
   * 零引用做种上限从 128 提升到 256：
   * 让更多曾经观看过的视频在后台继续帮群友做种，
   * 提升万人群聊场景下的 P2P 命中率。
   */
  it("零引用完成会话保留上限应为 256", () => {
    expect(零引用完成会话保留上限).toBe(256);
  });

  /**
   * maxConns 从默认 55 提升到 128：
   * 万人 swarm 中允许单客户端同时维护更多 peer 连接，
   * 提升下载速度和做种覆盖率。
   */
  it("WebTorrent 客户端应以 maxConns=128 构造", async () => {
    重置协作分发浏览器运行时();
    const registration = 准备已激活媒体ServiceWorker注册();
    const add = vi.fn();
    const { ctor, lastInstance } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(
      async () => ctor,
      async () => registration
    );
    expect(lastInstance()?._opts).toEqual(
      expect.objectContaining({ maxConns: 128 })
    );
    重置协作分发浏览器运行时();
  });

  /**
   * storeCacheSlots 从默认 20 提升到 150：
   * 做种时内存中缓存更多 piece，减少 IndexedDB 随机读 IO，
   * 提升上传吞吐量（尤其在多 peer 并发拉取时）。
   */
  it("client.add() 应传入 storeCacheSlots=150", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:test-store-cache");
    const add = vi.fn(((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-cache-test",
      kind: "video",
      locator: 准备好的定位结果("att-cache-test"),
      consumerId: "session:att-cache-test",
    });

    expect(add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeCacheSlots: 150 }),
      expect.any(Function),
    );
  });

  /**
   * 近视口活视频会话预算从 4 提升到 12：
   * 允许更多视频同时维持 WebTorrent 会话（含 prefetch 预连接），
   * 滚动浏览时秒播率大幅提升。
   */
  it("近视口活视频会话预算上限应为 12", () => {
    expect(近视口活视频会话预算上限).toBe(12);
  });
});
