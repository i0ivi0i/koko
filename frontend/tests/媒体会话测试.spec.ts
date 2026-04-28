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

const 创建旧清单锚点播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "anchor",
  attachmentId,
  kind: "video",
  src: `http://media.local/stream/${attachmentId}/master.m3u8`,
  thumbnailUrl: `http://media.local/poster-${attachmentId}`,
  hint: null,
});

const 创建协作分发播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "swarm",
  attachmentId,
  kind: "video",
  src: `blob:https://localhost/swarm-${attachmentId}`,
  thumbnailUrl: `http://media.local/poster-${attachmentId}`,
  hint: "正在协作分发",
});

const 创建降级播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "degraded",
  attachmentId,
  kind: "video",
  src: "",
  thumbnailUrl: null,
  reason: "anchor_unavailable",
  hint: "附件当前不可获取",
});

const 创建连接群友降级播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "degraded",
  attachmentId,
  kind: "video",
  src: "",
  thumbnailUrl: null,
  reason: "connecting_to_peers",
  hint: "正在尝试连接群友",
});

const 创建无在线种子降级播放结果 = (attachmentId: string): 媒体播放结果 => ({
  mode: "degraded",
  attachmentId,
  kind: "video",
  src: "",
  thumbnailUrl: null,
  reason: "no_online_seed",
  hint: "当前没有在线种子，等待群友上线",
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

  it("swarm 视频收到 PLAYER_WAITING/PLAYER_STALLED 时不会误触发 locator 恢复链路", async () => {
    const attachmentId = "att-video-swarm-waiting-gate-1";
    const 解析播放结果 = vi.fn().mockResolvedValue(创建协作分发播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    会话.send({ type: "PLAYER_PLAYING" });
    解析播放结果.mockClear();

    会话.send({ type: "PLAYER_WAITING" });
    会话.send({ type: "PLAYER_STALLED" });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).not.toHaveBeenCalled();
    expect(会话.snapshot().status).toBe("playing");
  });

  it("恢复后仍是 degraded 时，误报 PLAYER_PLAYING 不会重置恢复门禁并触发重试", async () => {
    const attachmentId = "att-video-degraded-no-fake-playing-1";
    const 解析播放结果 = vi.fn().mockResolvedValue(创建降级播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    解析播放结果.mockClear();

    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();
    expect(解析播放结果).not.toHaveBeenCalled();

    会话.send({ type: "PLAYER_PLAYING" });
    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).not.toHaveBeenCalled();
    expect(会话.snapshot().status).toBe("degraded");
  });

  it("degraded 阶段即使收到 SWARM_ACTIVE 后再来 PLAYER_WAITING，也不会盲目重跑恢复解析", async () => {
    const attachmentId = "att-video-degraded-waiting-gate-1";
    const 解析播放结果 = vi.fn().mockResolvedValue(创建降级播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    解析播放结果.mockClear();
    expect(会话.snapshot().status).toBe("degraded");

    会话.send({ type: "SWARM_ACTIVE" });
    会话.send({ type: "PLAYER_WAITING" });
    await Promise.resolve();
    await Promise.resolve();

    expect(解析播放结果).not.toHaveBeenCalled();
    expect(会话.snapshot().status).toBe("degraded");
  });

  it("稳定 swarm 播放期间重复 SWARM_ACTIVE 不会重置恢复门禁，避免 PLAYER_ERROR 被放大成恢复风暴", async () => {
    const attachmentId = "att-video-swarm-active-error-gate-1";
    const 解析播放结果 = vi.fn().mockResolvedValue(创建协作分发播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    会话.send({ type: "PLAYER_PLAYING" });
    解析播放结果.mockClear();

    // 第一次错误触发一次恢复解析。
    会话.send({ type: "PLAYER_ERROR" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(解析播放结果).toHaveBeenCalledTimes(1);
    expect(会话.snapshot().status).toBe("backfilling");

    // 恢复尚未被“真实播放恢复事件”确认前，重复 SWARM_ACTIVE 不应重置恢复门禁。
    会话.send({ type: "SWARM_ACTIVE" });
    会话.send({ type: "PLAYER_ERROR" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(解析播放结果).toHaveBeenCalledTimes(1);
  });

  it("播放结果为 connecting_to_peers 时，会按 2 秒节奏自动触发恢复重试", async () => {
    const attachmentId = "att-video-connecting-retry-1";
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValueOnce(创建连接群友降级播放结果(attachmentId))
      .mockResolvedValueOnce(创建锚点播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    vi.useFakeTimers();
    try {
      await 会话.启动();
      expect(会话.snapshot().status).toBe("degraded");
      expect(解析播放结果).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_999);
      await Promise.resolve();
      await Promise.resolve();
      expect(解析播放结果).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(解析播放结果).toHaveBeenCalledTimes(2);
      expect(会话.snapshot().playback).toMatchObject({
        mode: "anchor",
        attachmentId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("播放结果为 no_online_seed 时，会按 15 秒节奏自动触发下一轮恢复重试", async () => {
    const attachmentId = "att-video-no-seed-retry-1";
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValueOnce(创建无在线种子降级播放结果(attachmentId))
      .mockResolvedValueOnce(创建连接群友降级播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    vi.useFakeTimers();
    try {
      await 会话.启动();
      expect(会话.snapshot().status).toBe("degraded");
      expect(解析播放结果).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(14_999);
      await Promise.resolve();
      await Promise.resolve();
      expect(解析播放结果).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(解析播放结果).toHaveBeenCalledTimes(2);
      expect(会话.snapshot().playback).toMatchObject({
        mode: "degraded",
        reason: "connecting_to_peers",
      });
    } finally {
      vi.useRealTimers();
    }
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

  it("会话已经稳定在旧清单锚点后，后续 SWARM_ACTIVE 只保留后台补齐机会，不会热切回 swarm", async () => {
    const 解析播放结果 = vi
      .fn()
      .mockResolvedValue(创建旧清单锚点播放结果("att-video-manifest-1"));
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
        mode: "anchor",
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

  it("恢复解析返回同一播放源时，不会把 sourceVersion 无意义地持续递增", async () => {
    const attachmentId = "att-video-source-version-stable-1";
    const 解析播放结果 = vi.fn().mockResolvedValue(创建锚点播放结果(attachmentId));
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    await 会话.启动();
    const 启动后版本 = 会话.snapshot().sourceVersion;

    会话.send({ type: "ENTER_RECOVERING" });
    await Promise.resolve();
    await Promise.resolve();

    expect(会话.snapshot().sourceVersion).toBe(启动后版本);
    expect(解析播放结果).toHaveBeenCalledTimes(2);
  });

  it("启动解析晚到时不会覆盖更晚代次的恢复结果", async () => {
    const attachmentId = "att-video-startup-race-1";
    let 第一次解析完成: ((value: 媒体播放结果) => void) | null = null;
    let 第二次解析完成: ((value: 媒体播放结果) => void) | null = null;
    let 调用次数 = 0;
    const 解析播放结果 = vi.fn(() => {
      调用次数 += 1;
      if (调用次数 === 1) {
        return new Promise<媒体播放结果>((resolve) => {
          第一次解析完成 = resolve;
        });
      }
      return new Promise<媒体播放结果>((resolve) => {
        第二次解析完成 = resolve;
      });
    });
    const 会话 = 创建媒体会话({
      attachmentId,
      kind: "video",
      解析播放结果,
    });

    const 启动任务 = 会话.启动();
    会话.send({ type: "SWARM_NO_PEERS" });
    会话.send({ type: "ORIGIN_UNAVAILABLE" });
    会话.send({ type: "ORIGIN_AVAILABLE" });

    expect(第二次解析完成).toBeTypeOf("function");
    第二次解析完成!(创建旧清单锚点播放结果(attachmentId));
    await Promise.resolve();
    await Promise.resolve();

    expect(会话.snapshot().playback).toMatchObject({
      mode: "anchor",
      src: `http://media.local/stream/${attachmentId}/master.m3u8`,
    });

    expect(第一次解析完成).toBeTypeOf("function");
    第一次解析完成!(创建锚点播放结果(attachmentId));
    await 启动任务;
    await Promise.resolve();
    await Promise.resolve();

    expect(会话.snapshot().playback).toMatchObject({
      mode: "anchor",
      src: `http://media.local/stream/${attachmentId}/master.m3u8`,
    });
  });
});
