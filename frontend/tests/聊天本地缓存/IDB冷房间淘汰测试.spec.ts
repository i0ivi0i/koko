/**
 * IndexedDB 消息仓库 — 每房间容量淘汰测试
 *
 * 验证 flush 后自动淘汰超出上限的最旧消息。
 * 使用 fake-indexeddb/auto 隔离环境。
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { 创建IndexedDB消息仓库 } from "../../聊天本地缓存/IndexedDB消息仓库.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

const 制造消息 = (roomId: string, position: number): 消息事件 =>
  ({
    type: "message_created",
    room_id: roomId,
    message_id: `m-${position}`,
    client_message_id: `c-${position}`,
    sender_session_id: "s-1",
    sender_display_alias: "测试",
    text: `msg ${position}`,
    attachments: [],
    event_position: position,
  }) as 消息事件;

/** 重置全局 indexedDB 保证测试隔离。 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

// 测试用小上限（50），避免 fake-indexeddb 写 5000+ 条太慢。
const TEST_LIMIT = 50;

describe("IndexedDB 消息仓库 — 每房间容量淘汰", () => {
  it("写入超过每房间上限后自动删除最旧条目", async () => {
    const 仓库 = 创建IndexedDB消息仓库({ maxPerRoom: TEST_LIMIT });
    const excess = 10;
    const total = TEST_LIMIT + excess; // 60
    const batch = Array.from({ length: total }, (_, i) =>
      制造消息("r-1", i + 1)
    );
    await 仓库.写入("r-1", batch);
    await 仓库.flush();

    const all = await 仓库.读取窗口("r-1", {
      上界event_position: Number.MAX_SAFE_INTEGER,
      数量: total + 100,
    });
    expect(all.length).toBe(TEST_LIMIT);
    // 保留的是最新的（event_position 最大的），最旧的被淘汰
    expect(all[0]!.event_position).toBe(excess + 1);
    expect(all[all.length - 1]!.event_position).toBe(total);
  });

  it("不同房间互不影响", async () => {
    const 仓库 = 创建IndexedDB消息仓库({ maxPerRoom: TEST_LIMIT });
    const total = TEST_LIMIT + 5;
    const batch1 = Array.from({ length: total }, (_, i) =>
      制造消息("r-1", i + 1)
    );
    await 仓库.写入("r-1", batch1);
    const batch2 = Array.from({ length: 10 }, (_, i) =>
      制造消息("r-2", i + 1)
    );
    await 仓库.写入("r-2", batch2);
    await 仓库.flush();

    const r2 = await 仓库.读取窗口("r-2", {
      上界event_position: Number.MAX_SAFE_INTEGER,
      数量: 100,
    });
    expect(r2.length).toBe(10);
  });

  it("未超限的房间不触发淘汰", async () => {
    const 仓库 = 创建IndexedDB消息仓库({ maxPerRoom: TEST_LIMIT });
    const batch = Array.from({ length: 30 }, (_, i) =>
      制造消息("r-1", i + 1)
    );
    await 仓库.写入("r-1", batch);
    await 仓库.flush();

    const all = await 仓库.读取窗口("r-1", {
      上界event_position: Number.MAX_SAFE_INTEGER,
      数量: 200,
    });
    expect(all.length).toBe(30);
  });
});
