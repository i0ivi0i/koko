import { expect, vi } from "vitest";
import { 创建房间内核 } from "../../房间/运行时";
import { 初始聊天状态, type 聊天状态 } from "../../应用根/聊天状态";
import { type 消息事件 } from "../../聊天共享/契约";
import { type 房间时间线事件 } from "../../时间线/运行时";
import { 假传输 } from "./假传输.js";
import {
  创建会同步时间线补丁的时间线端口,
  创建房间壳补丁,
} from "./房间场景支撑.js";

export async function 读取阅读推进编排工厂(): Promise<
  (deps: Record<string, unknown>) => Record<string, unknown>
> {
  let 创建阅读推进编排: unknown;
  try {
    // 阅读推进 owner 已经收进房间壳层，测试只直接连接真实 owner。
    const modulePath = "../../房间/壳层/阅读推进";
    ({ 创建阅读推进编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建阅读推进编排 = undefined;
  }
  expect(typeof 创建阅读推进编排).toBe("function");
  return 创建阅读推进编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function 创建阅读推进测试场景(input: {
  roomId?: string;
  roomDisplayTitle?: string;
  sessionId?: string;
  displayAlias?: string;
  latestEventPosition?: number;
  viewportMode?: 聊天状态["viewportMode"];
  lastReadEventPosition?: number | null;
  firstUnreadEventPosition?: number | null;
  initialUnreadSettled?: boolean;
  hasMoreBefore?: boolean;
  messages?: 消息事件[];
} = {}) {
  const transport = new 假传输();
  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    lastReadEventPosition: input.lastReadEventPosition ?? null,
    firstUnreadEventPosition: input.firstUnreadEventPosition ?? null,
    initialUnreadSettled: input.initialUnreadSettled ?? true,
    hasMoreBefore: input.hasMoreBefore ?? false,
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

  const 历史补偿调用: Array<{
    context: {
      旧滚动高度: number;
      锚点消息位置: number | null;
      锚点距容器顶部: number | null;
    };
    inserted: boolean;
  }> = [];
  const 滚到最新调用: number[] = [];
  const roomScroller = {
    读取当前可见阅读锚点: vi.fn(() => 8),
    读取当前是否接近底部: vi.fn(() => false),
    读取历史补偿上下文: vi.fn(() => ({
      旧滚动高度: 320,
      锚点消息位置: 2,
      锚点距容器顶部: 18,
    })),
    应用历史补偿: vi.fn(
      async (
        context: {
          旧滚动高度: number;
          锚点消息位置: number | null;
          锚点距容器顶部: number | null;
        },
        inserted: boolean
      ) => {
        历史补偿调用.push({ context, inserted });
      }
    ),
  };

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState, {
    messages: input.messages ?? [],
    latestEventPosition: input.latestEventPosition ?? 0,
    hasMoreBefore: input.hasMoreBefore ?? false,
  });

  /**
   * 阅读推进编排现在要求注入 消息仓库（application port，HISTORY 分层缓存入口）。
   * 测试只关心传输/视口编排，所以这里用最小空实现兜底：
   * - 读取窗口 始终返回空数组 → 走服务端 fallback 路径，行为等价于"没有本地缓存"；
   * - 写入 / 清空 都是 no-op，避免触发 IDB；
   * - 这样既不破坏既有测试（依然按服务端 transport 流程跑），又不引入对真 IDB 的依赖。
   */
  const 空消息仓库 = {
    async 写入(): Promise<void> {},
    async 读取窗口(): Promise<消息事件[]> {
      return [];
    },
    async 清空房间(): Promise<void> {},
  };

  const deps = {
    读取阅读状态: () => state,
    写入阅读状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    transport,
    roomScroller,
    withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
      operation(state.sessionId),
    等待壳渲染完成: async () => {},
    滚到最新位置: async () => {
      滚到最新调用.push(Date.now());
    },
    消息仓库: 空消息仓库,
  };

  return {
    transport,
    roomKernel,
    roomScroller,
    读取状态: () => state,
    历史补偿调用,
    滚到最新调用,
    deps,
  };
}
