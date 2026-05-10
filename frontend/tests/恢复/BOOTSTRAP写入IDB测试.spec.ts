/**
 * BOOTSTRAP 路径写入 IndexedDB 集成测试
 *
 * 验证 `进入房间快照` 函数末尾的 fire-and-forget 仓库写入：
 * 1. 有 snapshot_messages 时会调用 消息仓库.写入；
 * 2. 仓库.写入 抛错不会阻断主流程（业务真相在服务端，仓库只是体验缓存）；
 * 3. 空 snapshot_messages 不调用仓库（避免无谓 IDB transaction）。
 *
 * 测试用最小 stub 满足 `房间快照恢复协作依赖` 接口，仅断言"消息仓库.写入 是否被调用"，
 * 不依赖真 IDB / 真 transport / 真 storage。
 */
import { describe, it, expect } from "vitest";
import { 创建恢复应用 } from "../../恢复/应用.js";
import type { 消息仓库端口 } from "../../聊天本地缓存/消息仓库端口.js";
import type { 消息事件, 房间快照 } from "../../聊天共享/契约.js";

const 制造快照 = (room_id: string, msgs: 消息事件[]): 房间快照 => ({
  room_id,
  latest_event_position: msgs.at(-1)?.event_position ?? 0,
  last_read_event_position: null,
  first_unread_event_position: null,
  snapshot_messages: msgs,
  has_more_before: false,
});

const 制造消息 = (room_id: string, event_position: number): 消息事件 => ({
  type: "message_created",
  room_id,
  message_id: `m-${event_position}`,
  client_message_id: `c-${event_position}`,
  sender_session_id: "s",
  sender_display_alias: "u",
  text: `t-${event_position}`,
  attachments: [],
  event_position,
});

const 制造仓库桩 = () => {
  const 写入调用记录: Array<{ roomId: string; messages: 消息事件[] }> = [];
  const 仓库: 消息仓库端口 = {
    async 写入(roomId, messages) {
      写入调用记录.push({ roomId, messages });
    },
    async 读取窗口() {
      return [];
    },
    async 清空房间() {},
    async flush() {},
  };
  return { 仓库, 写入调用记录 };
};

/**
 * 用最小 stub 凑齐 `房间快照恢复协作依赖`，仅暴露我们关心的"消息仓库被调用"信号。
 * 其他字段都是 no-op，既保证 `进入房间快照` 能跑通，又不引入与本测试无关的副作用。
 */
function 创建最小协作(opts: { 消息仓库: 消息仓库端口 }) {
  // 用最小 stub 满足 `房间快照恢复协作依赖` 接口契约
  const stubs = {
    cancelPendingReadAnchorFlush: () => {},
    cancelPendingFollowLatestReadSample: () => {},
    roomScroller: {
      安排首屏定位: () => {},
      取消挂起滚动副作用: () => {},
    },
    写入恢复补锚标记: () => {},
    storage: {
      读取首页房间历史: () => [],
      读取当前房间短码: () => "",
      读取当前房间标识: () => "",
      读取当前房间恢复快照: () => null,
      写入当前房间标识: () => {},
      写入当前房间短码: () => {},
      写入当前房间恢复快照: () => {},
      清除当前房间恢复快照: () => {},
      写入或更新首页房间历史条目: () => {},
      按房间标识删除首页房间历史条目: () => {},
    } as never,
    roomKernel: { send: () => {} },
    写入恢复状态: () => {},
    接收时间线事实: () => {},
    读取恢复状态: () => ({
      roomId: "",
      sessionId: "",
      homeSessionItems: [],
      hasUserScrollIntent: false,
    }),
    ensureRealtimeSocket: async () => {},
    withSessionRefreshOnInvalid: async <T,>(op: (sid: string) => Promise<T>) => op(""),
    loadRoomSnapshot: async () => ({}) as never,
    loadRoomEvents: async () => ({ events: [] as 消息事件[], latest_event_position: 0 }),
    subscribeRoom: () => {},
    exitCurrentRoomView: () => {},
    消息仓库: opts.消息仓库,
  } as const;
  return 创建恢复应用(stubs as never);
}

describe("BOOTSTRAP 写入 IDB", () => {
  it("进入房间快照 末尾会异步把 snapshot_messages 写入消息仓库", async () => {
    const { 仓库, 写入调用记录 } = 制造仓库桩();
    const snapshot = 制造快照("r-1", [制造消息("r-1", 1), 制造消息("r-1", 2)]);
    const 协作 = 创建最小协作({ 消息仓库: 仓库 });
    协作.进入房间快照(snapshot);
    // 等待 microtask + promise 解析两轮，让 fire-and-forget 写入完成
    await Promise.resolve();
    await Promise.resolve();
    expect(写入调用记录).toHaveLength(1);
    expect(写入调用记录[0]?.roomId).toBe("r-1");
    expect(写入调用记录[0]?.messages).toEqual(snapshot.snapshot_messages);
  });

  it("消息仓库.写入 抛错不会阻断 进入房间快照", async () => {
    const 仓库: 消息仓库端口 = {
      async 写入() {
        throw new Error("idb fail");
      },
      async 读取窗口() {
        return [];
      },
      async 清空房间() {},
      async flush() {},
    };
    const snapshot = 制造快照("r-2", [制造消息("r-2", 1)]);
    const 协作 = 创建最小协作({ 消息仓库: 仓库 });
    // 同步抛错保护：fire-and-forget 内部应该 catch 住
    expect(() => 协作.进入房间快照(snapshot)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("空 snapshot_messages 不调用 消息仓库.写入", async () => {
    const { 仓库, 写入调用记录 } = 制造仓库桩();
    const snapshot = 制造快照("r-3", []);
    const 协作 = 创建最小协作({ 消息仓库: 仓库 });
    协作.进入房间快照(snapshot);
    await Promise.resolve();
    await Promise.resolve();
    // 空数组：避免无谓 IDB transaction
    expect(写入调用记录).toHaveLength(0);
  });
});
