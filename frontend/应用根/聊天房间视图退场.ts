import type { 聊天本地状态补丁 } from "./聊天本地状态折叠.js";

export interface 聊天房间视图退场依赖 {
  清除当前房间标识(): void;
  清除当前房间短码(): void;
  重置编排端口(): void;
  取消挂起滚动副作用(): void;
  写入恢复补锚标记(value: boolean): void;
  清空媒体编排(): void;
  重置时间线房间视图(): void;
  同步房间时间线快照(): void;
  标记房间视图已退出(): void;
  写入本地状态(patch: 聊天本地状态补丁): void;
  同步房间视口快照(): void;
}

/**
 * 房间页退场是一个完整的收尾流程，不该继续散在聊天应用内核里“顺手做几步”：
 * 1. 先清掉房间锚点与可选短码缓存；
 * 2. 再撤销编排端口、滚动尾波和恢复补锚；
 * 3. 最后清空媒体、时间线和本地输入/未读状态。
 *
 * 这样退场 owner 就清楚了，后面要补别的退场副作用时，也不会再回到内核类里继续堆 if/switch。
 */
export function 执行聊天房间视图退场(
  deps: 聊天房间视图退场依赖,
  opts: { keepRoomCodeCache: boolean } = { keepRoomCodeCache: true }
): void {
  deps.清除当前房间标识();
  if (!opts.keepRoomCodeCache) {
    deps.清除当前房间短码();
  }
  deps.重置编排端口();
  deps.取消挂起滚动副作用();
  deps.写入恢复补锚标记(false);
  deps.清空媒体编排();
  deps.重置时间线房间视图();
  deps.同步房间时间线快照();
  deps.标记房间视图已退出();
  deps.写入本地状态({
    messageInput: "",
    lastReadEventPosition: null,
    firstUnreadEventPosition: null,
    pendingReadAnchorPosition: null,
    pending: false,
    historyLoading: false,
    historyErrorCode: "",
  });
  deps.同步房间视口快照();
}
