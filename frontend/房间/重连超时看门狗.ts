/**
 * 重连超时看门狗：防止房间编排机永久停留在"重连中"状态。
 *
 * 职责：
 * - 进入重连中时启动定时器（默认 15s）
 * - 离开重连中时清除定时器
 * - 超时后向 roomKernel 派发 RECONNECT_TIMEOUT
 *
 * 生命周期由 聊天应用内核 管理，在 dispose 时调用 watchdog.dispose() 清理。
 */
export interface 重连超时看门狗端口 {
  进入重连中(): void;
  离开重连中(): void;
  dispose(): void;
}

interface RoomKernelRef {
  send(event: { type: "RECONNECT_TIMEOUT" }): void;
}

export function 创建重连超时看门狗(
  roomKernel: RoomKernelRef,
  timeoutMs = 15_000
): 重连超时看门狗端口 {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  function 清除计时器(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return {
    进入重连中() {
      清除计时器();
      timerId = setTimeout(() => {
        timerId = null;
        roomKernel.send({ type: "RECONNECT_TIMEOUT" });
      }, timeoutMs);
    },

    离开重连中() {
      清除计时器();
    },

    dispose() {
      清除计时器();
    },
  };
}
