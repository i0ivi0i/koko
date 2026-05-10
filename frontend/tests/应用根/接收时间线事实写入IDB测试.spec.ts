/**
 * 时间线事实派发到本地缓存 单测
 *
 * 验证派发纯函数对各 event 类型的镜像策略：
 *
 * | event.type                      | 是否在此处写 IDB | 原因                                                |
 * |---------------------------------|------------------|-----------------------------------------------------|
 * | AUTHORITATIVE_SNAPSHOT_LOADED   | 否               | BOOTSTRAP 路径自己写（恢复/应用.ts:进入房间快照）   |
 * | HISTORY_PAGE_APPENDED           | 否               | 阅读推进自己回写（请求加载更早历史 miss 路径）      |
 * | REALTIME_EVENTS_RECEIVED        | 是               | 实时推送的官方真相，本地缓存唯一镜像点              |
 * | OPTIMISTIC_MESSAGE_ADDED        | 否               | 乐观消息等服务端确认后走 REALTIME 路径再写          |
 * | ROOM_SOFT_RESET                 | 否               | 房间退场，仅清状态机不动 IDB                        |
 *
 * 此外验证：空 messages 不调用写入；底层异常被吞掉不抛。
 */
import { describe, it, expect } from "vitest";
import { 时间线事实派发到本地缓存 } from "../../应用根/时间线事实派发到本地缓存.js";
import type { 消息仓库端口 } from "../../聊天本地缓存/消息仓库端口.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

const 制造消息 = (room_id: string, p: number): 消息事件 => ({
  type: "message_created",
  room_id,
  message_id: `m-${p}`,
  client_message_id: `c-${p}`,
  sender_session_id: "s",
  sender_display_alias: "u",
  text: `t-${p}`,
  attachments: [],
  event_position: p,
});

const 制造仓库桩 = () => {
  const 写入调用: Array<{ roomId: string; messages: 消息事件[] }> = [];
  const 仓库: 消息仓库端口 = {
    async 写入(roomId, messages) {
      写入调用.push({ roomId, messages });
    },
    async 读取窗口() {
      return [];
    },
    async 清空房间() {},
  };
  return { 仓库, 写入调用 };
};

/** 等待 microtask flush 两轮，让 fire-and-forget 真正跑完。 */
async function 等待异步派发(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("时间线事实派发到本地缓存", () => {
  it("AUTHORITATIVE_SNAPSHOT_LOADED 不在此处写（BOOTSTRAP 路径自己写）", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    时间线事实派发到本地缓存({
      event: {
        type: "AUTHORITATIVE_SNAPSHOT_LOADED",
        messages: [制造消息("r-1", 1)],
        latestEventPosition: 1,
        hasMoreBefore: false,
      },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });

  it("HISTORY_PAGE_APPENDED 不在此处写（阅读推进自己回写）", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    时间线事实派发到本地缓存({
      event: {
        type: "HISTORY_PAGE_APPENDED",
        messages: [制造消息("r-1", 1)],
        hasMoreBefore: true,
      },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });

  it("REALTIME_EVENTS_RECEIVED 触发异步写", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    const msg = 制造消息("r-1", 99);
    时间线事实派发到本地缓存({
      event: {
        type: "REALTIME_EVENTS_RECEIVED",
        messages: [msg],
        latestEventPosition: 99,
      },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toEqual([{ roomId: "r-1", messages: [msg] }]);
  });

  it("REALTIME_EVENTS_RECEIVED 空 messages 不调用写入", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    时间线事实派发到本地缓存({
      event: {
        type: "REALTIME_EVENTS_RECEIVED",
        messages: [],
        latestEventPosition: 0,
      },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });

  it("OPTIMISTIC_MESSAGE_ADDED 不写（等服务端确认）", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    时间线事实派发到本地缓存({
      event: { type: "OPTIMISTIC_MESSAGE_ADDED", message: 制造消息("r-1", 1) },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });

  it("ROOM_SOFT_RESET 不写（仅清状态机）", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    时间线事实派发到本地缓存({
      event: { type: "ROOM_SOFT_RESET" },
      roomId: "r-1",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });

  it("仓库写入异常被吞掉，不抛出", () => {
    const 仓库: 消息仓库端口 = {
      async 写入() {
        throw new Error("idb fail");
      },
      async 读取窗口() {
        return [];
      },
      async 清空房间() {},
    };
    expect(() =>
      时间线事实派发到本地缓存({
        event: {
          type: "REALTIME_EVENTS_RECEIVED",
          messages: [制造消息("r-1", 1)],
          latestEventPosition: 1,
        },
        roomId: "r-1",
        消息仓库: 仓库,
      })
    ).not.toThrow();
  });

  it("无 roomId（房间退场）时跳过派发", async () => {
    const { 仓库, 写入调用 } = 制造仓库桩();
    // roomId 为空字符串：派发函数不应崩溃，也不写本地缓存（避免污染未关联房间）。
    时间线事实派发到本地缓存({
      event: {
        type: "REALTIME_EVENTS_RECEIVED",
        messages: [制造消息("r-1", 1)],
        latestEventPosition: 1,
      },
      roomId: "",
      消息仓库: 仓库,
    });
    await 等待异步派发();
    expect(写入调用).toHaveLength(0);
  });
});
