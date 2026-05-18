import { Http接口错误 } from "../../平台/传输.js";
import type { Transport异常 } from "../../恢复/壳层/房间恢复编排.js";
import type { 实时会话事件 } from "../../实时/会话运行时.js";

export type 实时控制面结果 = {
  kind?: string;
  latest_event_position?: number;
  code?: string;
  room_id?: string;
};

type 恢复失败 = Error & {
  status?: number;
  code?: string;
};

export interface 处理连接错误依赖 {
  接收实时会话事实(event: 实时会话事件): void;
  上报Transport异常(error: Transport异常): Promise<void>;
}

export interface 处理实时控制面结果依赖 {
  读取当前房间Id(): string | null | undefined;
  清除发送中(): void;
  接收实时会话事实(event: 实时会话事件): void;
  推进订阅已建立(latestEventPosition: number): void;
  上报Transport异常(error: Transport异常): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
}

function 归一化恢复失败(error: unknown): 恢复失败 {
  if (error instanceof Http接口错误) {
    return error;
  }
  return error as 恢复失败;
}

function 读取恢复错误代码(error: unknown): string | undefined {
  const failure = 归一化恢复失败(error);
  if (typeof failure.code === "string" && failure.code.trim()) {
    return failure.code;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return undefined;
}

/**
 * connect_error 只负责把 socket 级异常翻译成稳定的恢复信号，
 * 不在这里刷新会话，也不在这里偷做房间恢复。
 *
 * 调用前提：调用方已通过 socket.active 确认这是服务端拒绝（非传输层暂时失败）。
 * 因此此函数对所有错误码统一升级到 session refresh 路径。
 */
export async function 处理连接错误(
  error: unknown,
  deps: 处理连接错误依赖
): Promise<void> {
  const code = 读取恢复错误代码(error) || "unknown_rejection";
  deps.接收实时会话事实({
    type: "SOCKET_DISCONNECTED",
    code,
  });
  await deps.上报Transport异常({
    kind: "invalid_session",
    keepRoomVisible: true,
  });
}

/**
 * control_result 只做协议结果翻译：
 * - 订阅成功推进 realtime/session owner；
 * - 需要重拉快照或会话失效上报 recovery owner；
 * - 其他 hard failure 交回恢复编排决定。
 */
export async function 处理实时控制面结果(
  control: 实时控制面结果,
  deps: 处理实时控制面结果依赖
): Promise<void> {
  if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
    deps.推进订阅已建立(control.latest_event_position);
    return;
  }

  if (control.kind === "need_snapshot_reload" && control.room_id) {
    await deps.上报Transport异常({
      kind: "need_snapshot_reload",
      roomId: control.room_id,
    });
    return;
  }

  if (control.kind !== "rejected" && control.kind !== "error") {
    return;
  }

  const currentRoomId = deps.读取当前房间Id();
  if (!currentRoomId) {
    deps.清除发送中();
    return;
  }

  if (control.code === "invalid_session") {
    deps.接收实时会话事实({
      type: "SOCKET_DISCONNECTED",
      code: "invalid_session",
    });
    await deps.上报Transport异常({
      kind: "invalid_session",
      roomId: currentRoomId,
      keepRoomVisible: true,
    });
    return;
  }

  deps.处理恢复失败(control, true);
}
