import type { 房间时间线事件 } from "../时间线/运行时.js";
import type { 消息仓库端口 } from "../聊天本地缓存/消息仓库端口.js";

/**
 * 时间线事实派发到本地缓存（application 层纯函数）。
 *
 * 决定哪些时间线事件需要镜像到 IndexedDB（spec §7.3）：
 *
 * | event.type                      | 是否在此处写 IDB | 说明                                           |
 * |---------------------------------|------------------|------------------------------------------------|
 * | AUTHORITATIVE_SNAPSHOT_LOADED   | 否               | BOOTSTRAP 路径自己写（恢复/应用.ts:进入房间快照） |
 * | HISTORY_PAGE_APPENDED           | 否               | 阅读推进自己回写（请求加载更早历史 miss 路径） |
 * | REALTIME_EVENTS_RECEIVED        | 是               | 实时推送的官方真相，本地缓存唯一镜像点         |
 * | OPTIMISTIC_MESSAGE_ADDED        | 否               | 乐观消息等服务端确认后再走 REALTIME 路径写     |
 * | ROOM_SOFT_RESET                 | 否               | 房间退场，仅清状态机不动 IDB                   |
 *
 * 设计原则：
 * 1. 这是一个纯派发函数，不持有状态、不读 DOM、不直接做 IO；
 *    所有 IO 都通过注入的 `消息仓库` 端口异步触发。
 * 2. fire-and-forget：queueMicrotask 包装写入，让出当前同步路径，
 *    底层异常一律 .catch 兜底，避免 unhandled rejection 影响业务。
 * 3. 未来加新 event 类型时，必须在这个函数里显式说明镜像策略，
 *    否则默认 fall-through 到 no-op，避免静默写错路径。
 */
export function 时间线事实派发到本地缓存(input: {
  event: 房间时间线事件;
  /**
   * 当前房间标识（来自 room kernel 派生快照）。
   * 为空字符串时（房间退场或未进入房间）跳过派发，避免污染未关联房间的本地缓存。
   */
  roomId: string;
  消息仓库: 消息仓库端口;
}): void {
  const { event, roomId, 消息仓库 } = input;

  // 房间退场或未进入：跳过。messages 仍会被 actor 处理，但不镜像 IDB。
  if (!roomId) return;

  // 仅 REALTIME 事件触发镜像写入。其他类型在各自路径已写或不该写。
  if (event.type !== "REALTIME_EVENTS_RECEIVED") return;
  if (event.messages.length === 0) return;

  // 闭包捕获本批 messages，避免后续 actor 状态变化影响异步任务读取的引用。
  const 待写消息 = event.messages;
  queueMicrotask(() => {
    void 消息仓库.写入(roomId, 待写消息).catch((错误) => {
      console.warn(
        "[消息分层缓存] REALTIME 写入本地缓存失败（不影响业务）",
        错误
      );
    });
  });
}
