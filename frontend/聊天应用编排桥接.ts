import {
  创建房间恢复编排,
  type 房间恢复编排依赖,
  type 房间恢复编排端口,
} from "./房间恢复编排.js";
import {
  创建房间实时编排,
  type 房间实时编排依赖,
  type 房间实时编排端口,
} from "./房间实时编排.js";
import {
  创建阅读推进编排,
  type 阅读推进编排依赖,
  type 阅读推进编排端口,
} from "./阅读推进编排.js";

export interface 内核恢复编排桥接依赖 {
  读取恢复状态: 房间恢复编排依赖["读取恢复状态"];
  写入恢复状态: 房间恢复编排依赖["写入恢复状态"];
  接收时间线事实: 房间恢复编排依赖["接收时间线事实"];
  transport: 房间恢复编排依赖["transport"];
  storage: 房间恢复编排依赖["storage"];
  roomKernel: 房间恢复编排依赖["roomKernel"];
  roomScroller: 房间恢复编排依赖["roomScroller"];
  取消待刷新已读锚点(): void;
  取消待跟随最新采样(): void;
  ensureRealtimeSocket(sessionId: string): void;
  subscribeRoom(from: number): void;
  exitCurrentRoomView(opts?: { keepRoomCodeCache: boolean }): void;
  disconnectRealtime(): void;
  写入恢复补锚标记(value: boolean): void;
  等待壳渲染完成(): Promise<void>;
}

export interface 内核实时编排桥接依赖 {
  读取实时状态: 房间实时编排依赖["读取实时状态"];
  写入实时状态: 房间实时编排依赖["写入实时状态"];
  接收时间线事实: 房间实时编排依赖["接收时间线事实"];
  接收实时会话事实: 房间实时编排依赖["接收实时会话事实"];
  transport: 房间实时编排依赖["transport"];
  roomKernel: 房间实时编排依赖["roomKernel"];
  上报Transport异常: 房间实时编排依赖["上报Transport异常"];
  处理恢复失败: 房间实时编排依赖["处理恢复失败"];
  跟随最新消息追加后刷新视口: 房间实时编排依赖["跟随最新消息追加后刷新视口"];
  接收权威事件后副作用: 房间实时编排依赖["接收权威事件后副作用"];
  登记待补发任务: 房间实时编排依赖["登记待补发任务"];
  请求后台补发同步: 房间实时编排依赖["请求后台补发同步"];
  读取当前时间: 房间实时编排依赖["读取当前时间"];
}

export interface 内核阅读推进编排桥接依赖 {
  读取阅读状态: 阅读推进编排依赖["读取阅读状态"];
  写入阅读状态: 阅读推进编排依赖["写入阅读状态"];
  接收时间线事实: 阅读推进编排依赖["接收时间线事实"];
  transport: 阅读推进编排依赖["transport"];
  上报历史前插开始: 阅读推进编排依赖["上报历史前插开始"];
  roomScroller: 阅读推进编排依赖["roomScroller"];
  withSessionRefreshOnInvalid: 阅读推进编排依赖["withSessionRefreshOnInvalid"];
  等待壳渲染完成: 阅读推进编排依赖["等待壳渲染完成"];
  滚到最新位置: 阅读推进编排依赖["滚到最新位置"];
}

/**
 * 这层桥接只负责把聊天应用内核已有的 owner 串起来：
 * - realtime 继续拥有 socket 主链；
 * - recovery 继续拥有 invalid_session / snapshot reload 恢复语义；
 * - 阅读推进继续只拥有补锚和历史分页。
 *
 * 内核只保留组合与本地状态，不再把三条编排线的细节都摊在同一个类里。
 */
export function 创建内核恢复编排端口(
  deps: 内核恢复编排桥接依赖
): 房间恢复编排端口 {
  return 创建房间恢复编排({
    读取恢复状态: deps.读取恢复状态,
    写入恢复状态: deps.写入恢复状态,
    接收时间线事实: deps.接收时间线事实,
    transport: deps.transport,
    storage: deps.storage,
    roomKernel: deps.roomKernel,
    roomScroller: deps.roomScroller,
    ensureRealtimeSocket: deps.ensureRealtimeSocket,
    subscribeRoom: deps.subscribeRoom,
    cancelPendingReadAnchorFlush: deps.取消待刷新已读锚点,
    cancelPendingFollowLatestReadSample: deps.取消待跟随最新采样,
    exitCurrentRoomView: deps.exitCurrentRoomView,
    disconnectRealtime: deps.disconnectRealtime,
    写入恢复补锚标记: deps.写入恢复补锚标记,
    等待壳渲染完成: deps.等待壳渲染完成,
  });
}

export function 创建内核实时编排端口(
  deps: 内核实时编排桥接依赖
): 房间实时编排端口 {
  return 创建房间实时编排({
    读取实时状态: deps.读取实时状态,
    写入实时状态: deps.写入实时状态,
    接收时间线事实: deps.接收时间线事实,
    接收实时会话事实: deps.接收实时会话事实,
    transport: deps.transport,
    roomKernel: deps.roomKernel,
    上报Transport异常: deps.上报Transport异常,
    处理恢复失败: deps.处理恢复失败,
    跟随最新消息追加后刷新视口: deps.跟随最新消息追加后刷新视口,
    ...(deps.接收权威事件后副作用
      ? { 接收权威事件后副作用: deps.接收权威事件后副作用 }
      : {}),
    ...(deps.登记待补发任务 ? { 登记待补发任务: deps.登记待补发任务 } : {}),
    ...(deps.请求后台补发同步 ? { 请求后台补发同步: deps.请求后台补发同步 } : {}),
    ...(deps.读取当前时间 ? { 读取当前时间: deps.读取当前时间 } : {}),
  });
}

export function 创建内核阅读推进编排端口(
  deps: 内核阅读推进编排桥接依赖
): 阅读推进编排端口 {
  return 创建阅读推进编排({
    读取阅读状态: deps.读取阅读状态,
    写入阅读状态: deps.写入阅读状态,
    接收时间线事实: deps.接收时间线事实,
    transport: deps.transport,
    ...(deps.上报历史前插开始 ? { 上报历史前插开始: deps.上报历史前插开始 } : {}),
    roomScroller: deps.roomScroller,
    withSessionRefreshOnInvalid: deps.withSessionRefreshOnInvalid,
    等待壳渲染完成: deps.等待壳渲染完成,
    滚到最新位置: deps.滚到最新位置,
  });
}
