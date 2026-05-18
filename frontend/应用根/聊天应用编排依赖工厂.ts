import type {
  房间恢复编排依赖,
  Transport异常,
} from "../恢复/壳层/房间恢复编排.js";
import type { 阅读推进编排依赖 } from "../房间/壳层/阅读推进.js";
import type { 房间内核事件 } from "../房间/运行时.js";
import type { 附件状态变更事件, 消息事件 } from "../聊天共享/契约.js";
import type { 平台离线任务 } from "../平台/index.js";
import type { 实时会话事件 } from "../实时/会话运行时.js";
import type { 房间时间线事件 } from "../时间线/运行时.js";
import type { 房间滚动器 } from "../时间线/滚动器.js";
import type { 聊天内核平台端口 } from "./聊天应用编排桥接.js";
import type { 聊天应用编排协调器依赖 } from "./聊天应用编排协调器.js";
import type { 聊天应用本地状态协调器 } from "./聊天应用本地状态协调器.js";
import type { 消息仓库端口 } from "../聊天本地缓存/消息仓库端口.js";

export interface 聊天应用编排依赖工厂输入 {
  状态协调器: 聊天应用本地状态协调器;
  接收时间线事实(event: 房间时间线事件): void;
  接收实时会话事实(event: 实时会话事件): void;
  读取房间传输(): ReturnType<聊天内核平台端口["聊天房间传输"]>;
  读取实时传输(): ReturnType<聊天内核平台端口["聊天实时连接"]>;
  storage: ReturnType<聊天内核平台端口["壳层记忆"]>;
  roomKernel: {
    send(event: 房间内核事件): void;
  };
  roomScroller: 房间滚动器;
  ensureRealtimeSocket(sessionId: string): void | Promise<void>;
  subscribeRoom(from: number): void;
  取消待刷新已读锚点(): void;
  取消待跟随最新采样(): void;
  exitCurrentRoomView(opts?: { keepRoomCodeCache: boolean }): void;
  disconnectRealtime(): void;
  写入恢复补锚标记(value: boolean): void;
  等待壳渲染完成(): Promise<void>;
  上报Transport异常(error: Transport异常): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
  跟随最新消息追加后刷新视口(): Promise<void>;
  接收权威事件后副作用(events: 消息事件[]): void;
  接收附件升级后副作用(event: 附件状态变更事件): void;
  登记待补发任务?(task: 平台离线任务): Promise<boolean>;
  请求后台补发同步?(tag: string): Promise<boolean>;
  读取当前时间(): number;
  上报历史前插开始(): void;
  withSessionRefreshOnInvalid<T>(operation: (sessionId: string) => Promise<T>): Promise<T>;
  排空到期任务?: 聊天应用编排协调器依赖["排空到期任务"];
  /**
   * 消息仓库读取器：每次懒创建恢复编排时读取当前仓库实例，
   * 与 `读取房间传输()` / `读取实时传输()` 同样采用函数闭包以适应 “重置端口后不多带陈旧实例” 的变更。
   */
  读取消息仓库(): 消息仓库端口;
}

/**
 * 这层工厂只负责把 recovery / realtime / 阅读推进 三条编排口所需依赖装成窄桥接对象。
 * 真正的命令处理、状态写入和退场收尾仍各归自己的 helper owner。
 */
export function 创建聊天应用编排协调器依赖(
  input: 聊天应用编排依赖工厂输入
): 聊天应用编排协调器依赖 {
  return {
    创建恢复编排依赖: () => ({
      读取恢复状态: () => input.状态协调器.读取恢复状态(),
      写入恢复状态: (patch) => input.状态协调器.写入恢复状态(patch),
      接收时间线事实: (event) => input.接收时间线事实(event),
      /**
       * 测试支架切换假 transport 时会先 `重置端口()`，再把内核当前 transport 指针切到替身。
       * 因此这里绝不能继续闭包捕获旧 transport 实例，而要在每次懒创建恢复编排时读取当前值。
       */
      transport: input.读取房间传输(),
      storage: input.storage,
      roomKernel: input.roomKernel,
      roomScroller: input.roomScroller as 房间恢复编排依赖["roomScroller"],
      ensureRealtimeSocket: (sessionId) => input.ensureRealtimeSocket(sessionId),
      subscribeRoom: (from) => input.subscribeRoom(from),
      取消待刷新已读锚点: () => input.取消待刷新已读锚点(),
      取消待跟随最新采样: () => input.取消待跟随最新采样(),
      exitCurrentRoomView: (opts) => input.exitCurrentRoomView(opts),
      disconnectRealtime: () => input.disconnectRealtime(),
      写入恢复补锚标记: (value) => input.写入恢复补锚标记(value),
      等待壳渲染完成: async () => {
        await input.等待壳渲染完成();
      },
      消息仓库: input.读取消息仓库(),
    }),
    创建实时编排依赖: () => ({
      读取实时状态: () => input.状态协调器.读取实时状态(),
      写入实时状态: (patch) => input.状态协调器.写入实时状态(patch),
      接收时间线事实: (event) => input.接收时间线事实(event),
      接收实时会话事实: (event) => input.接收实时会话事实(event),
      transport: input.读取实时传输(),
      roomKernel: input.roomKernel,
      上报Transport异常: async (error) => {
        await input.上报Transport异常(error);
      },
      处理恢复失败: (error, keepRoomVisible) => {
        input.处理恢复失败(error, keepRoomVisible);
      },
      跟随最新消息追加后刷新视口: async () => {
        await input.跟随最新消息追加后刷新视口();
      },
      接收权威事件后副作用: (events) => {
        input.接收权威事件后副作用(events);
      },
      接收附件升级后副作用: (event: 附件状态变更事件) => {
        input.接收附件升级后副作用(event);
      },
      登记待补发任务: input.登记待补发任务,
      请求后台补发同步: input.请求后台补发同步,
      读取当前时间: () => input.读取当前时间(),
    }),
    创建阅读推进依赖: () => ({
      读取阅读状态: () => input.状态协调器.读取阅读状态(),
      写入阅读状态: (patch) => input.状态协调器.写入阅读状态(patch),
      接收时间线事实: (event) => input.接收时间线事实(event),
      transport: input.读取房间传输(),
      上报历史前插开始: () => input.上报历史前插开始(),
      roomScroller: input.roomScroller as 阅读推进编排依赖["roomScroller"],
      withSessionRefreshOnInvalid: input.withSessionRefreshOnInvalid,
      等待壳渲染完成: async () => {
        await input.等待壳渲染完成();
      },
      滚到最新位置: () => input.roomScroller.滚到最新位置(),
      消息仓库: input.读取消息仓库(),
    }),
    排空到期任务: input.排空到期任务,
  };
}
