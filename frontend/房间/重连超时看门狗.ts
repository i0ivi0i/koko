/**
 * 重连超时看门狗：防止房间编排机永久停留在"重连中"状态。
 *
 * 职责：
 * - 进入重连中时启动定时器（默认 30s）
 * - 离开重连中时清除定时器
 * - 超时触发时：若 session refresh 正在进行则续等一轮，否则派发 RECONNECT_TIMEOUT
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

export interface 重连超时看门狗选项 {
  /** 单轮超时毫秒数，默认 30s */
  timeoutMs?: number;
  /** 若返回 true 则超时时续等一轮而非立即触发 */
  是否在刷新会话?: () => boolean;
}

export function 创建重连超时看门狗(
  roomKernel: RoomKernelRef,
  options: 重连超时看门狗选项 = {}
): 重连超时看门狗端口 {
  const { timeoutMs = 30_000, 是否在刷新会话 } = options;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  function 清除计时器(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function 启动计时器(): void {
    清除计时器();
    timerId = setTimeout(() => {
      timerId = null;
      // session refresh 进行中时不宣告超时，续等一轮
      if (是否在刷新会话?.()) {
        启动计时器();
        return;
      }
      roomKernel.send({ type: "RECONNECT_TIMEOUT" });
    }, timeoutMs);
  }

  return {
    进入重连中() {
      启动计时器();
    },

    离开重连中() {
      清除计时器();
    },

    dispose() {
      清除计时器();
    },
  };
}
