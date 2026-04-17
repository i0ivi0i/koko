import type { Socket } from "socket.io-client";
import type { 消息事件 } from "./契约.js";
import type { 房间内核事件 } from "./房间内核.js";
import type { 房间时间线事件 } from "./房间时间线运行时.js";
import type { 实时会话事件 } from "./实时会话运行时.js";
import {
  创建乐观房间消息,
} from "./房间时间线.js";
import { 提取可发送媒体附件标识 } from "./媒体/媒体草稿.js";
import type { 聊天状态 } from "./状态.js";
import { Http接口错误, type 前端传输端口 } from "./传输.js";
import type { Transport异常 } from "./房间恢复编排.js";
import type { 平台离线任务 } from "./平台/index.js";

type 控制面结果 = {
  kind?: string;
  latest_event_position?: number;
  code?: string;
  room_id?: string;
};

type 恢复失败 = Error & {
  status?: number;
  code?: string;
};

type 房间内核端口 = {
  send(event: 房间内核事件): void;
};

type 实时编排状态 = Pick<
  聊天状态,
  | "displayAlias"
  | "sessionId"
  | "roomId"
  | "latestEventPosition"
  | "viewportMode"
  | "messageInput"
  | "composerMediaDrafts"
  | "messages"
  | "pending"
>;

export interface 房间实时编排依赖 {
  读取实时状态(): 实时编排状态;
  写入实时状态(patch: Partial<实时编排状态>): void;
  接收时间线事实(event: 房间时间线事件): void;
  接收实时会话事实(event: 实时会话事件): void;
  transport: 前端传输端口;
  roomKernel: 房间内核端口;
  上报Transport异常(error: Transport异常): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
  跟随最新消息追加后刷新视口(): Promise<void>;
  接收权威事件后副作用?(events: 消息事件[]): void;
  登记待补发任务?(task: 平台离线任务): Promise<boolean>;
  请求后台补发同步?(tag: string): Promise<boolean>;
  读取当前时间?(): number;
}

export interface 房间实时编排端口 {
  ensureRealtimeSocket(sessionId: string): void;
  disconnect(): void;
  subscribeRoom(from: number): void;
  sendMessage(): Promise<void>;
  重放待补发任务?(task: 平台离线任务): Promise<"done" | "retry">;
}

/**
 * 房间实时编排只负责 realtime 主通道：
 * - socket 生命周期；
 * - 订阅建立与控制面结果；
 * - 把权威 socket 事件转交给房间时间线 owner。
 *
 * 它不自己刷新会话，也不自己解释房间恢复策略；
 * 那些语义统一上报给恢复编排处理。
 */
export function 创建房间实时编排(deps: 房间实时编排依赖): 房间实时编排端口 {
  let realtimeSocket: Socket | null = null;
  const 读取当前时间 = deps.读取当前时间 ?? (() => Date.now());
  const 后台补发同步标识 = "koko-queue-main";

  function asRecoveryFailure(error: unknown): 恢复失败 {
    if (error instanceof Http接口错误) {
      return error;
    }
    return error as 恢复失败;
  }

  function recoveryCodeOf(error: unknown): string | undefined {
    const failure = asRecoveryFailure(error);
    if (typeof failure.code === "string" && failure.code.trim()) {
      return failure.code;
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return undefined;
  }

  function isInvalidSessionError(error: unknown): boolean {
    return recoveryCodeOf(error) === "invalid_session";
  }

  function applyAuthoritativeEvents(events: 消息事件[], latestEventPosition: number): void {
    const shouldFollowLatest = deps.读取实时状态().viewportMode === "贴底跟随";
    deps.接收时间线事实({
      type: "REALTIME_EVENTS_RECEIVED",
      messages: events,
      latestEventPosition,
    });
    deps.写入实时状态({
      pending: false,
    });
    deps.接收权威事件后副作用?.(events);
    if (shouldFollowLatest) {
      void deps.跟随最新消息追加后刷新视口();
    }
  }

  async function handleConnectError(error: unknown): Promise<void> {
    if (!isInvalidSessionError(error)) {
      return;
    }
    deps.接收实时会话事实({
      type: "SOCKET_DISCONNECTED",
      code: "invalid_session",
    });
    await deps.上报Transport异常({
      kind: "invalid_session",
    });
  }

  async function handleControlResult(control: 控制面结果): Promise<void> {
    if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
      deps.接收实时会话事实({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: control.latest_event_position,
      });
      deps.roomKernel.send({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: control.latest_event_position,
      });
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

    const currentRoomId = deps.读取实时状态().roomId;
    if (!currentRoomId) {
      deps.写入实时状态({ pending: false });
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

  function ensureRealtimeSocket(sessionId: string): void {
    if (realtimeSocket) {
      return;
    }
    const socket = deps.transport.createSocket(sessionId);
    socket.on("connect", () => {
      const state = deps.读取实时状态();
      if (state.roomId) {
        subscribeRoom(state.latestEventPosition);
      }
    });
    socket.on("connect_error", (error: unknown) => {
      void handleConnectError(error);
    });
    socket.on("disconnect", (reason: string) => {
      deps.接收实时会话事实({
        type: "SOCKET_DISCONNECTED",
        code: String(reason || "disconnect"),
      });
    });
    socket.on("room_events", (events: { latest_event_position: number; events: 消息事件[] }) => {
      applyAuthoritativeEvents(events.events, events.latest_event_position);
    });
    socket.on("room_event", (event: 消息事件) => {
      applyAuthoritativeEvents([event], event.event_position);
    });
    socket.on("control_result", (control: 控制面结果) => {
      void handleControlResult(control);
    });
    realtimeSocket = socket;
  }

  const 当前可即时发送 = (): boolean => {
    if (!realtimeSocket) {
      return false;
    }
    const 连接态 = (realtimeSocket as Socket & { connected?: boolean }).connected;
    return 连接态 !== false;
  };

  function disconnect(): void {
    if (realtimeSocket) {
      deps.transport.释放Socket?.(realtimeSocket);
      realtimeSocket = null;
      return;
    }
    realtimeSocket = null;
  }

  function subscribeRoom(from: number): void {
    const roomId = deps.读取实时状态().roomId;
    if (!roomId || !realtimeSocket) {
      return;
    }
    deps.接收实时会话事实({
      type: "SUBSCRIPTION_STARTED",
    });
    deps.roomKernel.send({ type: "SUBSCRIPTION_STARTED" });
    realtimeSocket.emit("subscribe_room_stream", {
      room_id: roomId,
      from,
    });
  }

  async function sendMessage(): Promise<void> {
    const state = deps.读取实时状态();
    if (!state.roomId) {
      return;
    }
    const text = state.messageInput.trim();
    const attachmentIds = 提取可发送媒体附件标识(state.composerMediaDrafts);
    if (attachmentIds === null) {
      return;
    }
    if (!text && attachmentIds.length === 0) {
      return;
    }
    const clientMessageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}`;
    const createMessagePayload = {
      room_id: state.roomId,
      client_message_id: clientMessageId,
      text,
      attachment_ids: attachmentIds,
    };

    /**
     * 这里把“发送时机”与“消息业务语义”解耦：
     * - payload 是否可发送（文本/附件 ready）由聊天编排判断；
     * - 当前是否能走实时通道由平台运行时判断；
     * - 不可即时发送时只入离线队列，不在这里发明第二套业务协议。
     */
    if (!当前可即时发送()) {
      const 入队成功 =
        (await deps.登记待补发任务?.({
          id: `offline-${clientMessageId}`,
          kind: "create_message",
          payload: {
            roomId: state.roomId,
            clientMessageId,
            text,
            attachmentIds,
          },
          createdAt: 读取当前时间(),
          retryAt: 读取当前时间(),
          dedupeKey: clientMessageId,
        })) ?? false;
      if (!入队成功) {
        return;
      }
      deps.写入实时状态({
        messageInput: "",
        composerMediaDrafts: [],
        pending: false,
      });
      await deps.请求后台补发同步?.(后台补发同步标识);
      return;
    }

    if (attachmentIds.length === 0) {
      deps.接收时间线事实({
        type: "OPTIMISTIC_MESSAGE_ADDED",
        message: 创建乐观房间消息({
          roomId: state.roomId,
          sessionId: state.sessionId,
          displayAlias: state.displayAlias,
          clientMessageId,
          text,
          latestEventPosition: state.latestEventPosition,
        }),
      });
    }
    deps.写入实时状态({
      messageInput: "",
      composerMediaDrafts: [],
      pending: true,
    });
    realtimeSocket?.emit("create_message", createMessagePayload);
  }

  async function 重放待补发任务(task: 平台离线任务): Promise<"done" | "retry"> {
    if (task.kind !== "create_message") {
      return "done";
    }
    if (!当前可即时发送()) {
      return "retry";
    }
    const payload = task.payload as
      | {
          roomId?: unknown;
          clientMessageId?: unknown;
          text?: unknown;
          attachmentIds?: unknown;
        }
      | null
      | undefined;
    if (!payload || typeof payload !== "object") {
      return "done";
    }
    const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
    const clientMessageId =
      typeof payload.clientMessageId === "string" ? payload.clientMessageId : "";
    if (!roomId || !clientMessageId) {
      return "done";
    }
    if (deps.读取实时状态().roomId !== roomId) {
      return "retry";
    }
    const text = typeof payload.text === "string" ? payload.text : "";
    const attachmentIds = Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.map((attachmentId) => String(attachmentId))
      : [];
    realtimeSocket?.emit("create_message", {
      room_id: roomId,
      client_message_id: clientMessageId,
      text,
      attachment_ids: attachmentIds,
    });
    return "done";
  }

  return {
    ensureRealtimeSocket,
    disconnect,
    subscribeRoom,
    sendMessage,
    重放待补发任务,
  };
}
