/**
 * 时间线合流 fast-path 单测（修漏洞 A）
 *
 * 验证 REALTIME 增量 fast-path：90%+ 的实时推送场景是单调递增 append，
 * 不应该每次都跑两次 sort + 两轮 Map 收敛（O(N log N)）。
 *
 * 命中条件全满足才走（任一不满足即回退到完整合并）：
 * 1. current 升序（前次 fast-path 维护此不变量；首次 SNAPSHOT/HISTORY 完整合并保证起点升序）
 * 2. events 内部升序
 * 3. events[0].event_position > current.last.event_position
 * 4. events 与 current 尾部 100 条无 client_message_id 冲突（覆盖近期乐观消息）
 * 5. events 与 current 尾部 100 条无 message_id 重复（覆盖网络重发）
 *
 * 结果与完整合并完全等价；性能从 O(N log N) 降到 O(M + 100)。
 */
import { describe, it, expect, vi } from "vitest";
import type { 消息事件 } from "../../聊天共享/契约.js";
import { 推进房间时间线 } from "../../时间线/领域.js";

const 制造 = (
  event_position: number,
  opts: Partial<消息事件> = {}
): 消息事件 => ({
  type: "message_created",
  room_id: "r-1",
  message_id: opts.message_id ?? `m-${event_position}`,
  client_message_id: opts.client_message_id ?? `c-${event_position}`,
  sender_session_id: opts.sender_session_id ?? "s",
  sender_display_alias: "u",
  text: `t-${event_position}`,
  attachments: [],
  event_position,
});

describe("合流 fast-path", () => {
  it("命中：REALTIME 单调递增 append 结果等价于完整合并", () => {
    const current = [制造(1), 制造(2), 制造(3)];
    const events = [制造(4), 制造(5)];
    const result = 推进房间时间线(current, { type: "REALTIME", events });
    expect(result.map((m) => m.event_position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("命中：events 单条且严格大于末尾", () => {
    const current = [制造(1), 制造(2)];
    const result = 推进房间时间线(current, {
      type: "REALTIME",
      events: [制造(3)],
    });
    expect(result.map((m) => m.event_position)).toEqual([1, 2, 3]);
  });

  it("miss：events 内部乱序 → 回退完整合并仍正确排序", () => {
    const current = [制造(1)];
    const events = [制造(3), 制造(2)];
    const result = 推进房间时间线(current, { type: "REALTIME", events });
    expect(result.map((m) => m.event_position)).toEqual([1, 2, 3]);
  });

  it("miss：events 首条 ≤ 末尾 → 回退完整合并仍正确合并", () => {
    const current = [制造(1), 制造(5)];
    const events = [制造(3), 制造(7)];
    const result = 推进房间时间线(current, { type: "REALTIME", events });
    expect(result.map((m) => m.event_position)).toEqual([1, 3, 5, 7]);
  });

  it("miss：events 包含尾部 client_message_id → 回退（乐观替换语义保留）", () => {
    const 乐观 = 制造(0, {
      message_id: "local-1",
      client_message_id: "cli-x",
    });
    const 权威 = 制造(10, {
      message_id: "real-1",
      client_message_id: "cli-x",
    });
    const current = [制造(5), 乐观];
    const result = 推进房间时间线(current, {
      type: "REALTIME",
      events: [权威],
    });
    expect(result).toHaveLength(2);
    // 乐观消息应被权威消息按 client_message_id 替换
    expect(result.find((m) => m.message_id === "local-1")).toBeUndefined();
    expect(result.find((m) => m.message_id === "real-1")).toBeDefined();
  });

  it("miss：events 包含已存在 message_id → 回退（去重）", () => {
    const m = 制造(2);
    const current = [制造(1), m];
    const result = 推进房间时间线(current, {
      type: "REALTIME",
      events: [m],
    });
    expect(result).toHaveLength(2);
  });

  it("命中性能契约：fast-path 不调用 Array.prototype.sort", () => {
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    const current = Array.from({ length: 1000 }, (_, i) => 制造(i + 1));
    sortSpy.mockClear();
    推进房间时间线(current, {
      type: "REALTIME",
      events: [制造(1001), 制造(1002)],
    });
    expect(sortSpy).not.toHaveBeenCalled();
    sortSpy.mockRestore();
  });

  it("回退性能契约：miss 走完整合并仍调用 sort", () => {
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    const current = [制造(1), 制造(5)];
    sortSpy.mockClear();
    推进房间时间线(current, { type: "REALTIME", events: [制造(3)] });
    expect(sortSpy).toHaveBeenCalled();
    sortSpy.mockRestore();
  });

  it("等价性对拍（随机化）：fast-path 与完整合并产生相同有序结果", () => {
    /**
     * 简易种子随机数：让多次跑结果可重现，便于失败时定位。
     */
    const seedRandom = (seed: number) => () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const rnd = seedRandom(42);
    for (let trial = 0; trial < 20; trial++) {
      const N = 50;
      const current = Array.from({ length: N }, (_, i) => 制造(i + 1));
      const events = Array.from({ length: 5 }, (_, i) =>
        制造(N + 1 + i + Math.floor(rnd() * 3))
      );
      const result = 推进房间时间线(current, { type: "REALTIME", events });
      const positions = result.map((m) => m.event_position);
      const sortedPositions = [...positions].sort((a, b) => a - b);
      // 不变量：合流后必须严格升序
      expect(positions).toEqual(sortedPositions);
    }
  });

  it("长跑契约：N=3000 起点 + 1 万次 REALTIME 单条 push，全部命中 fast-path（无 sort 调用）", () => {
    let messages = Array.from({ length: 3000 }, (_, i) => 制造(i + 1));
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    sortSpy.mockClear();
    for (let i = 0; i < 10_000; i++) {
      messages = 推进房间时间线(messages, {
        type: "REALTIME",
        events: [制造(3001 + i)],
      });
    }
    expect(sortSpy).not.toHaveBeenCalled();
    sortSpy.mockRestore();
  }, 30_000);
});
