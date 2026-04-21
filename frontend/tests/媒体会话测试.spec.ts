import { describe, expect, it, vi } from "vitest";
import { 创建媒体会话 } from "../媒体/媒体会话";
import type { 媒体播放结果 } from "../媒体/媒体播放";

const 创建锚点播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "anchor",
  attachmentId,
  kind: "video",
  src: `http://media.local/original-${attachmentId}`,
  thumbnailUrl: null,
  hint: null,
});

const 创建流媒体播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "manifest",
  attachmentId,
  kind: "video",
  src: `http://media.local/stream/${attachmentId}/master.m3u8`,
  thumbnailUrl: `http://media.local/poster-${attachmentId}`,
  streamingDistribution: {
    swarm_id: `swarm-${attachmentId}`,
    announce_urls: ["http://media.local/announce"],
    web_seed_url: "http://media.local/web-seed",
    join_ticket: null,
    survival_mode: "server_assisted",
  },
  hint: null,
});

describe("媒体会话", () => {
  it("启动与恢复解析时，会携带稳定的 session consumerId", async () => {
    const 解析播放结果 = vi.fn().mockResolvedValue(创建锚点播放结果("att-video-session-1"));
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-session-1",
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    expect(解析播放结果).toHaveBeenNthCalledWith(1, {
      attachmentId: "att-video-session-1",
      kind: "video",
      consumerId: "session:att-video-session-1",
    });

    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).toHaveBeenLastCalledWith({
      attachmentId: "att-video-session-1",
      kind: "video",
      consumerId: "session:att-video-session-1",
    });
  });

  it("后端冷源失效后会从 playing 进入 recovering，而不是继续卡死在旧 src", async () => {
    const 解析播放结果 = vi.fn().mockResolvedValue(创建锚点播放结果("att-video-1"));
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-1",
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    会话.send({ type: "PLAYER_PLAYING" });
    expect(会话.snapshot().status).toBe("playing");

    会话.send({ type: "PLAYER_WAITING" });
    expect(会话.snapshot().status).toBe("recovering");
  });

  it("已进入恢复链路后重复收到 PLAYER_WAITING，不会反复重跑恢复解析", async () => {
    const 解析播放结果 = vi.fn().mockResolvedValue(创建锚点播放结果("att-video-storm-1"));
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-storm-1",
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    解析播放结果.mockClear();
    会话.send({ type: "PLAYER_PLAYING" });

    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(解析播放结果).toHaveBeenCalledTimes(1);

    // 第一次恢复结束后快照通常会回到 bootstrapping；这里模拟播放器持续抖动重复上报 waiting。
    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();
    expect(解析播放结果).toHaveBeenCalledTimes(1);
  });

  it("recovering 期间没有 peer 和冷源时进入 waiting_for_peer_or_network", async () => {
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-2",
      kind: "video",
      解析播放结果: vi.fn().mockResolvedValue(创建锚点播放结果("att-video-2")),
    });

    会话.send({ type: "ENTER_RECOVERING" });
    会话.send({ type: "SWARM_NO_PEERS" });
    会话.send({ type: "ORIGIN_UNAVAILABLE" });

    expect(会话.snapshot().status).toBe("waiting_for_peer_or_network");
  });

  it("asset complete 后会进入 locally_complete 并保留完整资产真相", async () => {
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-3",
      kind: "video",
      解析播放结果: vi.fn().mockResolvedValue(创建锚点播放结果("att-video-3")),
    });

    会话.send({ type: "ASSET_BACKFILLING" });
    会话.send({ type: "ASSET_COMPLETE" });

    expect(会话.snapshot()).toMatchObject({
      status: "locally_complete",
      locallyComplete: true,
    });
  });

  it("会话已经稳定在 manifest 后，后续 SWARM_ACTIVE 只保留后台补齐机会，不会热切回 swarm", async () => {
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValue(创建流媒体播放结果("att-video-manifest-1"));
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-manifest-1",
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    会话.send({ type: "PLAYER_PLAYING" });
    const 稳定后快照 = 会话.snapshot();

    会话.send({ type: "SWARM_ACTIVE" });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).toHaveBeenCalledTimes(1);
    expect(会话.snapshot()).toMatchObject({
      status: "playing",
      playback: {
        mode: "manifest",
        src: "http://media.local/stream/att-video-manifest-1/master.m3u8",
      },
      sourceVersion: 稳定后快照.sourceVersion,
      lastSignal: "SWARM_ACTIVE",
    });
  });

  it("SWARM_TICKET_INVALID 会触发一次恢复解析，而不是继续抱着过期 join_ticket 卡在旧会话里", async () => {
    const 解析播放结果 = vi.fn().mockResolvedValue(创建锚点播放结果("att-video-ticket-1"));
    const 会话 = 创建媒体会话({
      attachmentId: "att-video-ticket-1",
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    解析播放结果.mockClear();
    会话.send({ type: "PLAYER_PLAYING" });

    会话.send({ type: "SWARM_TICKET_INVALID" });
    expect(会话.snapshot().status).toBe("recovering");
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).toHaveBeenCalledTimes(1);
    expect(解析播放结果).toHaveBeenCalledWith({
      attachmentId: "att-video-ticket-1",
      kind: "video",
      consumerId: "session:att-video-ticket-1",
    });
    expect(会话.snapshot().lastSignal).toBe("SWARM_TICKET_INVALID");
  });
});
