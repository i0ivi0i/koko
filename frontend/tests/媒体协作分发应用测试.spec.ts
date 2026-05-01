import { describe, expect, it, vi } from "vitest";

import { 创建媒体协作分发应用 } from "../媒体/协作分发/应用.js";
import type { 媒体定位结果 } from "../契约.js";
import type { 资产协作分发运行时端口 } from "../媒体/资产协作分发运行时.js";

describe("媒体协作分发应用", () => {
  it("解析协作分发源时，会把 join ticket 刷新职责固定绑定到定位 owner", async () => {
    const refreshJoinTicket = vi.fn();
    const runtime = {
      send: vi.fn(),
      snapshot: vi.fn(),
      读取会话状态: vi.fn(),
      读取预算: vi.fn(),
      解析协作分发源: vi.fn(async (input) => input),
      释放协作分发消费者: vi.fn(),
      重置: vi.fn(),
      销毁: vi.fn(),
    } as unknown as 资产协作分发运行时端口;
    const app = 创建媒体协作分发应用({
      创建运行时: () => runtime,
      refreshJoinTicket,
    });

    await app.解析协作分发源({
      attachmentId: "att-video-1",
      kind: "video",
      locator: {
        kind: "video",
        status: "ready",
        thumbnail_url: null,
        distribution: {
          content_id: "content-att-video-1",
          content_hash: "content-att-video-1",
          swarm_id: "swarm-att-video-1",
          web_seed_until: "2099-01-01T00:00:00Z",
          torrent_url: null,
          torrent_info_hash: "hash-att-video-1",
          announce_urls: [],
          web_seed_url: "https://peer.example/download",
          join_ticket: "ticket-1",
          ticket_expires_at: "2099-01-01T00:00:00Z",
          media_state: {
            code: "MEDIA_READY",
            retry_after_ms: null,
          },
          survival_mode: "peer_only_after_expiry",
        },
      } as unknown as 媒体定位结果,
      consumerId: "viewer:att-video-1",
      eagerCompleting: true,
    });

    expect(runtime.解析协作分发源).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-video-1",
        consumerId: "viewer:att-video-1",
        eagerCompleting: true,
        refreshJoinTicket,
      })
    );
  });

  it("会把预算、会话状态、释放和生命周期动作委托给唯一协作分发运行时", () => {
    const snapshot = { context: { sessions: {} } } as ReturnType<
      资产协作分发运行时端口["snapshot"]
    >;
    const runtime = {
      send: vi.fn(),
      snapshot: vi.fn(() => snapshot),
      读取会话状态: vi.fn(() => ({ swarmId: "swarm-att-1" })),
      读取预算: vi.fn(() => ({ activeSwarmCount: 1 })),
      解析协作分发源: vi.fn(),
      释放协作分发消费者: vi.fn(),
      重置: vi.fn(),
      销毁: vi.fn(),
    } as unknown as 资产协作分发运行时端口;
    const app = 创建媒体协作分发应用({
      创建运行时: () => runtime,
      refreshJoinTicket: vi.fn(),
    });

    app.send({ type: "RESET" });
    expect(app.snapshot()).toBe(snapshot);
    expect(app.读取会话状态("swarm-att-1")).toEqual({ swarmId: "swarm-att-1" });
    expect(app.读取预算()).toEqual({ activeSwarmCount: 1 });

    app.释放协作分发消费者({ attachmentId: "att-1", consumerId: "viewer:att-1" });
    app.重置();
    app.销毁();

    expect(runtime.send).toHaveBeenCalledWith({ type: "RESET" });
    expect(runtime.读取会话状态).toHaveBeenCalledWith("swarm-att-1");
    expect(runtime.读取预算).toHaveBeenCalledWith();
    expect(runtime.释放协作分发消费者).toHaveBeenCalledWith({
      attachmentId: "att-1",
      consumerId: "viewer:att-1",
    });
    expect(runtime.重置).toHaveBeenCalledTimes(1);
    expect(runtime.销毁).toHaveBeenCalledTimes(1);
  });
});
