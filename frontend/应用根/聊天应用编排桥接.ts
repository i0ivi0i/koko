import {
  创建房间恢复编排,
  type 房间恢复编排依赖,
  type 房间恢复编排端口,
} from "../恢复/壳层/房间恢复编排.js";
import {
  创建实时应用,
  type 实时应用依赖 as 房间实时编排依赖,
  type 实时应用端口 as 房间实时编排端口,
} from "../实时/应用.js";
import {
  创建阅读推进编排,
  type 阅读推进编排依赖,
  type 阅读推进编排端口,
} from "../房间/壳层/阅读推进.js";
import type {
  媒体缓存仓库,
  媒体定位缓存仓库,
  预览缓存端口,
} from "../媒体/index.js";
import type {
  浏览器应用平台,
  浏览器应用平台命令,
  浏览器应用平台快照,
  平台离线任务,
} from "../平台/index.js";
import {
  type 媒体传输端口,
  type 聊天实时连接端口,
  type 聊天房间传输端口,
} from "../平台/传输.js";
import type { 前端存储端口 } from "../平台/存储.js";

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

export type 聊天内核平台快照 = Pick<
  浏览器应用平台快照,
  "lifecycle" | "multiContext" | "notification"
>;

export type 聊天内核平台命令 = Extract<
  浏览器应用平台命令,
  | { type: "SHOW_NOTIFICATION" }
  | { type: "SET_BADGE" }
  | { type: "CLEAR_BADGE" }
>;

export interface 聊天内核平台端口 {
  聊天房间传输(): 聊天房间传输端口;
  聊天实时连接(): 聊天实时连接端口;
  媒体传输(): 媒体传输端口;
  壳层记忆(): 前端存储端口;
  媒体资产仓库?(): 媒体缓存仓库;
  媒体定位仓库?(): 媒体定位缓存仓库;
  视频预览仓库?(): 预览缓存端口;
  登记待补发任务?(task: 平台离线任务): Promise<boolean>;
  请求后台补发同步?(tag: string): Promise<boolean>;
  排空到期任务?(
    handler: (task: 平台离线任务) => Promise<"done" | "retry">
  ): Promise<void>;
  snapshot(): 聊天内核平台快照;
  dispatch(command: 聊天内核平台命令): Promise<boolean | void>;
}

/**
 * 这层桥接属于应用根 owner：
 * 1. 它只负责把平台、恢复、实时、阅读推进这些现成 owner 串给聊天内核；
 * 2. 它不拥有聊天业务真相，只提供窄口和组合；
 * 3. 因此真实实现应留在 `frontend/应用根/`，不能继续散在根目录。
 */
export function 创建聊天内核平台桥接(
  platform: 浏览器应用平台
): 聊天内核平台端口 {
  return {
    聊天房间传输(): 聊天房间传输端口 {
      return platform.transport.聊天房间传输();
    },

    聊天实时连接(): 聊天实时连接端口 {
      return platform.transport.聊天实时连接();
    },

    媒体传输(): 媒体传输端口 {
      return platform.transport.媒体传输();
    },

    壳层记忆(): 前端存储端口 {
      return platform.storage.壳层记忆();
    },

    ...(platform.storage.媒体资产仓库
      ? {
          媒体资产仓库: () => platform.storage.媒体资产仓库!(),
        }
      : {}),
    ...(platform.storage.媒体定位仓库
      ? {
          媒体定位仓库: () => platform.storage.媒体定位仓库!(),
        }
      : {}),
    ...(platform.storage.视频预览仓库
      ? {
          视频预览仓库: () => platform.storage.视频预览仓库!(),
        }
      : {}),
    ...(platform.offline.登记待补发任务
      ? {
          登记待补发任务: (task: 平台离线任务) =>
            platform.offline.登记待补发任务!(task),
        }
      : {}),
    ...(platform.offline.请求后台补发同步
      ? {
          请求后台补发同步: (tag: string) =>
            platform.offline.请求后台补发同步!(tag),
        }
      : {}),
    ...(platform.offline.排空到期任务
      ? {
          排空到期任务: (
            handler: (task: 平台离线任务) => Promise<"done" | "retry">
          ) => platform.offline.排空到期任务!(handler),
        }
      : {}),

    snapshot(): 聊天内核平台快照 {
      const snapshot = platform.snapshot();
      return {
        lifecycle: snapshot.lifecycle,
        multiContext: snapshot.multiContext,
        notification: snapshot.notification,
      };
    },

    dispatch(command: 聊天内核平台命令): Promise<boolean | void> {
      return platform.dispatch(command);
    },
  };
}

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
  return 创建实时应用({
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
