import { expect } from "vitest";
import { 创建房间内核 } from "../../房间/运行时";
import { 初始聊天状态, type 聊天状态 } from "../../应用根/聊天状态";
import { type 消息事件 } from "../../聊天共享/契约";
import { type 房间时间线事件 } from "../../时间线/运行时";
import { 假传输 } from "./假传输.js";
import {
  创建会同步房间壳补丁的房间内核端口,
  创建会同步时间线补丁的时间线端口,
  创建房间壳补丁,
} from "./房间场景支撑.js";

export async function 读取房间实时编排工厂(): Promise<
  (deps: Record<string, unknown>) => Record<string, unknown>
> {
  let 创建房间实时编排: unknown;
  try {
    // 这里保持和恢复编排相同的相对路径规则，避免测试支架迁移后继续指向旧目录。
    const modulePath = "../../实时/应用";
    ({ 创建房间实时编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建房间实时编排 = undefined;
  }
  expect(typeof 创建房间实时编排).toBe("function");
  return 创建房间实时编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function 创建实时编排测试场景(input: {
  roomId?: string;
  roomDisplayTitle?: string;
  sessionId?: string;
  displayAlias?: string;
  latestEventPosition?: number;
  viewportMode?: 聊天状态["viewportMode"];
  messages?: 消息事件[];
  messageInput?: string;
} = {}) {
  const transport = new 假传输();
  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    messageInput: input.messageInput ?? "",
    messages: input.messages ?? [],
  };

  roomKernel.send({
    type: "BOOTSTRAP_SUCCEEDED",
    sessionId: state.sessionId,
    displayAlias: state.displayAlias,
    roomId: input.roomId ?? "",
  });
  if (input.roomId) {
    roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: input.roomId,
      roomDisplayTitle: input.roomDisplayTitle ?? "ROOM01",
      latestEventPosition: input.latestEventPosition ?? 0,
    });
  }
  state = {
    ...state,
    ...创建房间壳补丁(roomKernel),
    latestEventPosition: input.latestEventPosition ?? 0,
    viewportMode: input.viewportMode ?? "离底浏览",
  };

  const transportErrors: Array<Record<string, unknown>> = [];
  const recoveryFailures: Array<{ error: unknown; keepRoomVisible: boolean }> = [];
  const followLatestCalls: number[] = [];
  const realtimeSessionEvents: Array<Record<string, unknown>> = [];

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const 同步房间壳补丁 = (): void => {
    updateState(创建房间壳补丁(roomKernel));
  };
  const roomKernelPort = 创建会同步房间壳补丁的房间内核端口(roomKernel, 同步房间壳补丁);
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState, {
    messages: input.messages ?? [],
    latestEventPosition: input.latestEventPosition ?? 0,
  });

  const deps = {
    读取实时状态: () => state,
    写入实时状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    接收实时会话事实: (event: Record<string, unknown>) => {
      realtimeSessionEvents.push(event);
    },
    transport,
    roomKernel: roomKernelPort,
    上报Transport异常: async (error: Record<string, unknown>) => {
      transportErrors.push(error);
    },
    处理恢复失败: (error: unknown, keepRoomVisible: boolean) => {
      recoveryFailures.push({ error, keepRoomVisible });
    },
    跟随最新消息追加后刷新视口: async () => {
      followLatestCalls.push(Date.now());
    },
  };

  return {
    transport,
    roomKernel,
    读取状态: () => state,
    transportErrors,
    recoveryFailures,
    followLatestCalls,
    realtimeSessionEvents,
    deps,
  };
}
