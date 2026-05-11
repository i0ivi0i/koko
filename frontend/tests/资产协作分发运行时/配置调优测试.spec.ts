import { describe, expect, it, vi } from "vitest";
import { 零引用完成会话保留上限 } from "../../媒体/资产协作分发生命周期.js";
import {
  获取或创建协作分发浏览器运行时,
  重置协作分发浏览器运行时,
} from "../../媒体/媒体协作分发.js";
import {
  创建假WebTorrent构造器,
  准备已激活媒体ServiceWorker注册,
} from "./测试支撑.js";

describe("配置调优", () => {
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
});
