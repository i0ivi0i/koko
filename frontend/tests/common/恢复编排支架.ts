import { expect, vi } from "vitest";
import { 创建浏览器存储 } from "../../平台/存储";
import { 创建房间内核 } from "../../房间/运行时";
import { 初始聊天状态, type 聊天状态 } from "../../应用根/聊天状态";
import { type 房间时间线事件 } from "../../时间线/运行时";
import { createFakeStorage } from "./假存储.js";
import { 假传输 } from "./假传输.js";
import {
  创建会同步房间壳补丁的房间内核端口,
  创建会同步时间线补丁的时间线端口,
  创建房间壳补丁,
  创建房间视图重置补丁,
} from "./房间场景支撑.js";

export async function 读取房间恢复编排工厂(): Promise<
  (deps: Record<string, unknown>) => Record<string, unknown>
> {
  let 创建房间恢复编排: unknown;
  try {
    // 公共测试支架已经下沉到 tests/common，动态导入要同步回到 frontend 根上的真实模块位置。
    const modulePath = "../../恢复/壳层/房间恢复编排";
    ({ 创建房间恢复编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建房间恢复编排 = undefined;
  }
  expect(typeof 创建房间恢复编排).toBe("function");
  return 创建房间恢复编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function 创建恢复编排测试场景(input: {
  roomId?: string;
  roomCode?: string;
  sessionId?: string;
  displayAlias?: string;
  homeSessionItems?: Array<{ roomId: string; roomCode: string; lastEnteredAt: number }>;
  skipInitialBootstrap?: boolean;
} = {}) {
  const rawStorage = createFakeStorage();
  const storage = 创建浏览器存储(rawStorage);
  const roomId = input.roomId ?? "";
  const roomCode = input.roomCode ?? "";
  if (roomId) {
    rawStorage.setItem("koko_current_room_id", roomId);
  }
  if (roomCode) {
    rawStorage.setItem("koko_current_room_code", roomCode);
  }
  for (const item of input.homeSessionItems ?? []) {
    storage.写入或更新首页房间历史条目(item);
  }

  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    homeSessionItems: storage.读取首页房间历史(),
  };

  if (!input.skipInitialBootstrap) {
    roomKernel.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: state.sessionId,
      displayAlias: state.displayAlias,
      roomId,
    });
    state = {
      ...state,
      ...创建房间壳补丁(roomKernel),
    };
  }

  const transport = new 假传输();
  const ensureRealtimeSocketCalls: string[] = [];
  const subscribeCalls: number[] = [];
  let shouldPrimeReadAnchorAfterInitialSettle = false;
  const roomScroller = {
    安排首屏定位: vi.fn(),
    取消挂起滚动副作用: vi.fn(),
  };
  const disconnectRealtime = vi.fn();
  const cancelPendingReadAnchorFlush = vi.fn();
  const cancelPendingFollowLatestReadSample = vi.fn();

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const 同步房间壳补丁 = (): void => {
    updateState(创建房间壳补丁(roomKernel));
  };
  const roomKernelPort = 创建会同步房间壳补丁的房间内核端口(roomKernel, 同步房间壳补丁);
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState);

  const deps = {
    读取恢复状态: () => state,
    写入恢复状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    transport,
    storage,
    roomKernel: roomKernelPort,
    roomScroller,
    ensureRealtimeSocket: (sessionId: string) => {
      ensureRealtimeSocketCalls.push(sessionId);
    },
    subscribeRoom: (from: number) => {
      subscribeCalls.push(from);
    },
    cancelPendingReadAnchorFlush,
    cancelPendingFollowLatestReadSample,
    exitCurrentRoomView: (
      opts: {
        keepRoomCodeCache?: boolean;
      } = {}
    ) => {
      storage.清除当前房间标识();
      if (!opts.keepRoomCodeCache) {
        storage.清除当前房间短码();
      }
      updateState(创建房间视图重置补丁());
    },
    disconnectRealtime: () => {
      disconnectRealtime();
    },
    写入恢复补锚标记: (value: boolean) => {
      shouldPrimeReadAnchorAfterInitialSettle = value;
    },
    等待壳渲染完成: async () => {},
    读取恢复补锚标记: () => shouldPrimeReadAnchorAfterInitialSettle,
  };

  return {
    transport,
    storage,
    rawStorage,
    roomKernel,
    roomScroller,
    ensureRealtimeSocketCalls,
    subscribeCalls,
    disconnectRealtime,
    cancelPendingReadAnchorFlush,
    cancelPendingFollowLatestReadSample,
    读取状态: () => state,
    deps,
  };
}
