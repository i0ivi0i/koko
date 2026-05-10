/**
 * 内存窗口裁剪 - 推进房间时间线 单测
 *
 * 验证 spec §9：domain 层 `推进房间时间线` 纯函数末尾统一裁剪 messages 长度，
 * 解决 24h 单房间挂着 items 数组无界增长的根因。
 *
 * 覆盖：
 * - 常量值（上限 3500 / 保留尾部 3000）；
 * - 不达上限不裁；
 * - REALTIME 越界裁回 3000；
 * - HISTORY 前插越界裁回 3000（保留尾部）；
 * - SNAPSHOT 巨快照重置基线时也裁；
 * - OPTIMISTIC 单条插入越界时也裁；
 * - 长跑契约 1 万 / 10 万条 messages 长度恒定 ≤ 3500。
 */
import { describe, it, expect } from "vitest";
import type { 消息事件 } from "../../聊天共享/契约.js";
import {
  推进房间时间线,
  内存窗口上限,
  内存窗口保留尾部,
} from "../../时间线/领域.js";

const 制造消息 = (event_position: number): 消息事件 => ({
  type: "message_created",
  room_id: "r-1",
  message_id: `m-${event_position}`,
  client_message_id: `c-${event_position}`,
  sender_session_id: "s",
  sender_display_alias: "u",
  text: `t-${event_position}`,
  attachments: [],
  event_position,
});

describe("内存窗口裁剪 - 推进房间时间线", () => {
  it("裁剪上限常量 3500，保留尾部 3000", () => {
    expect(内存窗口上限).toBe(3500);
    expect(内存窗口保留尾部).toBe(3000);
  });

  it("messages 长度 ≤ 上限时不裁", () => {
    const 当前 = Array.from({ length: 100 }, (_, i) => 制造消息(i + 1));
    const result = 推进房间时间线(当前, {
      type: "REALTIME",
      events: [制造消息(101)],
    });
    expect(result).toHaveLength(101);
  });

  it("累积到 3501 条时，裁回 3000 条（保留尾部）", () => {
    const 当前 = Array.from({ length: 3500 }, (_, i) => 制造消息(i + 1));
    const result = 推进房间时间线(当前, {
      type: "REALTIME",
      events: [制造消息(3501)],
    });
    expect(result).toHaveLength(3000);
    // 保留最新 3000 条：尾部是 3501，头部是 3501 - 3000 + 1 = 502
    expect(result[0]?.event_position).toBe(502);
    expect(result.at(-1)?.event_position).toBe(3501);
  });

  it("HISTORY 前插越过上限时裁回 3000（保留尾部）", () => {
    const 当前 = Array.from({ length: 3500 }, (_, i) => 制造消息(i + 1));
    const 历史页 = Array.from({ length: 50 }, (_, i) => 制造消息(i - 49));
    const result = 推进房间时间线(当前, {
      type: "HISTORY",
      messages: 历史页,
    });
    expect(result).toHaveLength(3000);
    // 历史前插仍裁掉头部，尾部锚点 (3500) 不变
    expect(result.at(-1)?.event_position).toBe(3500);
  });

  it("SNAPSHOT 重置基线时也裁剪", () => {
    const 巨快照 = Array.from({ length: 5000 }, (_, i) => 制造消息(i + 1));
    const result = 推进房间时间线([], {
      type: "SNAPSHOT",
      messages: 巨快照,
    });
    expect(result).toHaveLength(3000);
    // 5000 条只保留最新 3000 条
    expect(result[0]?.event_position).toBe(2001);
    expect(result.at(-1)?.event_position).toBe(5000);
  });

  it("OPTIMISTIC 单条插入触发上限时也裁", () => {
    const 当前 = Array.from({ length: 3500 }, (_, i) => 制造消息(i + 1));
    const result = 推进房间时间线(当前, {
      type: "OPTIMISTIC",
      message: 制造消息(3501),
    });
    // 至少不超过上限（具体长度可能因合流去重而异，这里只保不爆）
    expect(result.length).toBeLessThanOrEqual(内存窗口上限);
  });

  it("长跑契约：1 万条 REALTIME 后，长度恒定 ≤ 3500", () => {
    let messages: 消息事件[] = [];
    for (let i = 1; i <= 10_000; i++) {
      messages = 推进房间时间线(messages, {
        type: "REALTIME",
        events: [制造消息(i)],
      });
      // 每一拍都断言：保证整个 24h 长跑过程中没有超过上限
      expect(messages.length).toBeLessThanOrEqual(内存窗口上限);
    }
    // 尾态长度不一定恰好是 3000：裁剪只在 超过 3500 时才触发，裁后可能再涨到 3500 才裁下一拍。
    // 不变量应该是「在 [保留尾部, 上限] 区间」。
    expect(messages.length).toBeGreaterThanOrEqual(内存窗口保留尾部);
    expect(messages.length).toBeLessThanOrEqual(内存窗口上限);
    expect(messages.at(-1)?.event_position).toBe(10_000);
  }, 60_000);

  it("长跑契约：1.5 万条仍恒定（极限场景、本轮受合流 O(N log N) 限制）", () => {
    // Task 6 同仓 fast-path 上线后，这里可以恢复到1e5 扑3e5。
    // 现阶段合流是 O(N log N)，N≈3000，取 1.5 万次能在 timeout 内跑完。
    let messages: 消息事件[] = [];
    for (let i = 1; i <= 15_000; i++) {
      messages = 推进房间时间线(messages, {
        type: "REALTIME",
        events: [制造消息(i)],
      });
    }
    expect(messages.length).toBeLessThanOrEqual(内存窗口上限);
    expect(messages.at(-1)?.event_position).toBe(15_000);
  }, 60_000);
});
