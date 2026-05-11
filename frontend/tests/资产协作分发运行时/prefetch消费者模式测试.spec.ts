import { describe, expect, it, vi } from "vitest";
import type { WebTorrent浏览器客户端 } from "../../媒体/媒体协作分发.js";
import { 获取或创建协作分发浏览器运行时 } from "../../媒体/媒体协作分发.js";
import {
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册资产协作分发测试基线,
  解析协作分发源,
  读取协作分发会话状态,
} from "./测试支撑.js";

describe("prefetch 消费者模式", () => {
  注册资产协作分发测试基线();

  /**
   * prefetch 模式的核心语义：
   * - 提前 join swarm 建立 peer 连接，但不下载任何 piece
   * - eagerCompleting = false（不急着补齐整文件）
   * - 已获得帮助资格 = false（不向外上报"我在帮忙"）
   */
  it("prefetch 消费者不应 eagerComplete、不应拥有帮助资格", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:prefetch-test-1");
    const add = vi.fn(
      ((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
        onTorrent(torrent);
        return torrent;
      }) as WebTorrent浏览器客户端["add"]
    );
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-prefetch-1",
      kind: "video",
      locator: 准备好的定位结果("att-prefetch-1"),
      consumerId: "prefetch:att-prefetch-1",
    });

    const state = 读取协作分发会话状态("swarm-att-prefetch-1");
    expect(state).toMatchObject({
      eagerCompleting: false,
      已获得帮助资格: false,
      refs: 1,
    });
  });

  /**
   * prefetch 消费者创建会话时应传 deselect:true 给 client.add()，
   * 这样 WebTorrent 加入 swarm 但不选择任何 piece 下载。
   */
  it("client.add() 应对 prefetch 传入 deselect:true", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:prefetch-deselect-1");
    const add = vi.fn(
      ((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
        onTorrent(torrent);
        return torrent;
      }) as WebTorrent浏览器客户端["add"]
    );
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    await 解析协作分发源({
      attachmentId: "att-prefetch-deselect-1",
      kind: "video",
      locator: 准备好的定位结果("att-prefetch-deselect-1"),
      consumerId: "prefetch:att-prefetch-deselect-1",
    });

    expect(add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deselect: true }),
      expect.any(Function),
    );
  });

  /**
   * prefetch→viewer 升级：
   * 1. prefetch 先建会话（join swarm，不下载）
   * 2. viewer 绑定到同一 swarm → 复用同一底层 torrent（不二次 client.add）
   * 3. 升级后 eagerCompleting=true、已获得帮助资格=true、refs=2
   */
  it("prefetch 会话被 viewer 升级时应复用同一 swarm 会话并启用 piece selection", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:prefetch-upgrade-1");
    const add = vi.fn(
      ((_torrentId: unknown, _options: unknown, onTorrent: (t: unknown) => void) => {
        onTorrent(torrent);
        return torrent;
      }) as WebTorrent浏览器客户端["add"]
    );
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    // Step 1: prefetch 先建会话
    await 解析协作分发源({
      attachmentId: "att-upgrade-1",
      kind: "video",
      locator: 准备好的定位结果("att-upgrade-1"),
      consumerId: "prefetch:att-upgrade-1",
    });
    expect(add).toHaveBeenCalledTimes(1);

    // Step 2: viewer 绑定到同一附件 → 复用同一底层 torrent
    await 解析协作分发源({
      attachmentId: "att-upgrade-1",
      kind: "video",
      locator: 准备好的定位结果("att-upgrade-1"),
      consumerId: "viewer:att-upgrade-1",
    });
    // 不应再次调用 client.add()（复用已有 swarm 会话）
    expect(add).toHaveBeenCalledTimes(1);

    const state = 读取协作分发会话状态("swarm-att-upgrade-1");
    expect(state).toMatchObject({
      eagerCompleting: true,
      已获得帮助资格: true,
      refs: 2,
    });
  });
});
