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
});
