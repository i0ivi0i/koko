/**
 * HISTORY 路径 IDB 优先 + miss 回写 集成测试
 *
 * 验证 `请求加载更早历史` 函数的 4 种行为：
 * 1. IDB 完全命中（≥ 55 条）：直接前插内存，不调用服务端；
 * 2. IDB 命中不足（< 55 条）：走服务端，把服务端结果回写 IDB；
 * 3. IDB 完全空：走服务端 + 回写；
 * 4. IDB 异常：被 catch 视为 cache miss，照常走服务端，不影响业务。
 *
 * 性能动机（spec §8）：万人房 N=3000 + 24h 上滑场景，命中本地缓存可大幅减少
 * 服务端请求频率，降低后端压力同时让用户感知"瞬时回滚"。
 */
import { describe, it, expect, vi } from "vitest";
import { 创建阅读推进编排 } from "../../房间/壳层/阅读推进.js";
import type { 消息仓库端口 } from "../../聊天本地缓存/消息仓库端口.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

const 数量 = 55;

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

/**
 * 制造测试装配：阅读推进编排 + 仓库桩 + transport 桩 + state 字典。
 *
 * - 仓库读取窗口结果：模拟 IDB 命中数据；
 * - 服务端历史结果：模拟 transport.loadRoomHistory 返回；
 * - state 用普通对象，所有 stub 都对它读写以模拟真实 messages 拼接。
 */
function 制造装配(opts: {
  仓库读取窗口结果: 消息事件[];
  服务端历史结果?: 消息事件[];
}) {
  const transportLoadRoomHistory = vi.fn(async () => ({
    room_id: "r-1",
    messages: opts.服务端历史结果 ?? [],
  }));
  const 读取窗口 = vi.fn(async () => opts.仓库读取窗口结果);
  const 写入 = vi.fn(async () => {});
  const 仓库: 消息仓库端口 = {
    写入,
    读取窗口,
    清空房间: vi.fn(async () => {}),
  };

  const state = {
    roomId: "r-1",
    sessionId: "s-1",
    latestEventPosition: 100,
    viewportMode: "离底浏览" as const,
    candidateReadAnchorPosition: null,
    messages: [制造消息(100)] as 消息事件[],
    hasMoreBefore: true,
    historyLoading: false,
    historyErrorCode: "",
    lastReadEventPosition: null,
    firstUnreadEventPosition: null,
    initialUnreadSettled: true,
    scrollPhase: "idle" as const,
    pendingReadAnchorPosition: null,
  };

  const 接收时间线事实 = vi.fn();

  const 编排 = 创建阅读推进编排({
    读取阅读状态: () => state,
    写入阅读状态: (patch) => Object.assign(state, patch),
    接收时间线事实,
    transport: {
      loadRoomHistory: transportLoadRoomHistory,
      updateRoomReadAnchor: vi.fn(async () => {}),
    } as never,
    roomScroller: {
      读取当前可见阅读锚点: () => null,
      读取历史补偿上下文: () => ({}) as never,
      应用历史补偿: vi.fn(async () => {}),
    },
    上报历史前插开始: vi.fn(),
    withSessionRefreshOnInvalid: async <T,>(op: (sid: string) => Promise<T>) => op("s-1"),
    等待壳渲染完成: async () => {},
    滚到最新位置: async () => {},
    消息仓库: 仓库,
  });

  return { 编排, transportLoadRoomHistory, 读取窗口, 写入, 接收时间线事实, state };
}

/** 等待两轮 microtask flush，让 fire-and-forget 的回写跑完。 */
async function 等待异步回写(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("HISTORY 路径 IDB 优先", () => {
  it("IDB 完全命中（>= 数量）时不调用服务端", async () => {
    const 命中 = Array.from({ length: 数量 }, (_, i) => 制造消息(i + 1));
    const { 编排, transportLoadRoomHistory, 接收时间线事实 } = 制造装配({
      仓库读取窗口结果: 命中,
    });
    await 编排.请求加载更早历史();
    expect(transportLoadRoomHistory).not.toHaveBeenCalled();
    expect(接收时间线事实).toHaveBeenCalledWith(
      expect.objectContaining({ type: "HISTORY_PAGE_APPENDED", messages: 命中 })
    );
  });

  it("IDB 命中不足（< 数量）时走服务端 + 回写 IDB", async () => {
    const 部分 = [制造消息(1), 制造消息(2)];
    const 服务端 = Array.from({ length: 数量 }, (_, i) => 制造消息(i + 50));
    const { 编排, transportLoadRoomHistory, 写入 } = 制造装配({
      仓库读取窗口结果: 部分,
      服务端历史结果: 服务端,
    });
    await 编排.请求加载更早历史();
    expect(transportLoadRoomHistory).toHaveBeenCalledOnce();
    await 等待异步回写();
    expect(写入).toHaveBeenCalledWith("r-1", 服务端);
  });

  it("IDB 完全空时走服务端 + 回写 IDB", async () => {
    const 服务端 = [制造消息(1), 制造消息(2)];
    const { 编排, transportLoadRoomHistory, 写入 } = 制造装配({
      仓库读取窗口结果: [],
      服务端历史结果: 服务端,
    });
    await 编排.请求加载更早历史();
    expect(transportLoadRoomHistory).toHaveBeenCalledOnce();
    await 等待异步回写();
    expect(写入).toHaveBeenCalledWith("r-1", 服务端);
  });

  it("IDB 异常被 catch 视为 cache miss，走服务端", async () => {
    const 服务端 = [制造消息(1)];
    const 仓库: 消息仓库端口 = {
      async 写入() {},
      async 读取窗口() {
        // 模拟 IDB 内部错误（例如 quota 超限）
        throw new Error("idb broken");
      },
      async 清空房间() {},
    };
    const transportLoadRoomHistory = vi.fn(async () => ({
      room_id: "r-1",
      messages: 服务端,
    }));
    const state = {
      roomId: "r-1",
      sessionId: "s-1",
      latestEventPosition: 100,
      viewportMode: "离底浏览" as const,
      candidateReadAnchorPosition: null,
      messages: [制造消息(100)] as 消息事件[],
      hasMoreBefore: true,
      historyLoading: false,
      historyErrorCode: "",
      lastReadEventPosition: null,
      firstUnreadEventPosition: null,
      initialUnreadSettled: true,
      scrollPhase: "idle" as const,
      pendingReadAnchorPosition: null,
    };
    const 编排 = 创建阅读推进编排({
      读取阅读状态: () => state,
      写入阅读状态: (patch) => Object.assign(state, patch),
      接收时间线事实: vi.fn(),
      transport: { loadRoomHistory: transportLoadRoomHistory } as never,
      roomScroller: {
        读取当前可见阅读锚点: () => null,
        读取历史补偿上下文: () => ({}) as never,
        应用历史补偿: vi.fn(async () => {}),
      },
      withSessionRefreshOnInvalid: async <T,>(op: (sid: string) => Promise<T>) => op("s-1"),
      等待壳渲染完成: async () => {},
      滚到最新位置: async () => {},
      消息仓库: 仓库,
    });
    await 编排.请求加载更早历史();
    expect(transportLoadRoomHistory).toHaveBeenCalledOnce();
  });
});
