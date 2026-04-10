import type { Socket } from "socket.io-client";
import type { 消息事件 } from "./契约.js";
import type { 房间内核事件 } from "./房间内核.js";
import { 提取可发送图片附件标识 } from "./图像/图片草稿.js";
import type { 聊天状态 } from "./状态.js";
import { Http接口错误, type 前端传输端口 } from "./传输.js";
import type { Transport异常 } from "./房间恢复编排.js";

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

export interface 房间实时编排依赖 {
  读取状态(): 聊天状态;
  更新状态(patch: Partial<聊天状态>): void;
  transport: 前端传输端口;
  roomKernel: 房间内核端口;
  roomShellPatch(): Partial<聊天状态>;
  上报Transport异常(error: Transport异常): Promise<void>;
  处理恢复失败(error: unknown, keepRoomVisible: boolean): void;
  跟随最新消息追加后刷新视口(): Promise<void>;
}

export interface 房间实时编排端口 {
  ensureRealtimeSocket(sessionId: string): void;
  disconnect(): void;
  subscribeRoom(from: number): void;
  sendMessage(): Promise<void>;
  reconcileMessages(messages: 消息事件[]): 消息事件[];
}

function 提取消息文本(message: 消息事件): string {
  return (message.text ?? message.body ?? "").trim();
}

/**
 * 房间实时编排只负责 realtime 主通道：
 * - socket 生命周期；
 * - 订阅建立与控制面结果；
 * - 权威消息并流与乐观消息收敛。
 *
 * 它不自己刷新会话，也不自己解释房间恢复策略；
 * 那些语义统一上报给恢复编排处理。
 */
export function 创建房间实时编排(deps: 房间实时编排依赖): 房间实时编排端口 {
  let realtimeSocket: Socket | null = null;

  function 读取状态(): 聊天状态 {
    return deps.读取状态();
  }

  function 更新状态(patch: Partial<聊天状态>): void {
    deps.更新状态(patch);
  }

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

  function pickPreferredMessage(current: 消息事件, candidate: 消息事件): 消息事件 {
    const currentIsOptimistic = current.message_id.startsWith("local-");
    const candidateIsOptimistic = candidate.message_id.startsWith("local-");
    if (currentIsOptimistic !== candidateIsOptimistic) {
      return currentIsOptimistic ? candidate : current;
    }
    if (current.event_position !== candidate.event_position) {
      return current.event_position > candidate.event_position ? current : candidate;
    }
    return candidate;
  }

  function reconcileMessages(messages: 消息事件[]): 消息事件[] {
    const sorted = [...messages].sort((left, right) => left.event_position - right.event_position);
    const byClientMessageId = new Map<string, 消息事件>();
    const authoritativeByMessageId = new Map<string, 消息事件>();

    // 第一层按 client_message_id 收敛，解决“本地乐观态 later 被权威消息替换”的情况。
    for (const message of sorted) {
      const existing = byClientMessageId.get(message.client_message_id);
      byClientMessageId.set(
        message.client_message_id,
        existing ? pickPreferredMessage(existing, message) : message
      );
    }

    // 第二层按真正的 message_id 收敛，解决 snapshot / history / realtime
    // 三条路径把同一条权威消息重复送进壳层的问题。
    for (const message of byClientMessageId.values()) {
      if (message.message_id.startsWith("local-")) {
        continue;
      }
      const existing = authoritativeByMessageId.get(message.message_id);
      authoritativeByMessageId.set(
        message.message_id,
        existing ? pickPreferredMessage(existing, message) : message
      );
    }

    const out: 消息事件[] = [];
    const seenMessageIds = new Set<string>();
    for (const message of byClientMessageId.values()) {
      if (message.message_id.startsWith("local-")) {
        out.push(message);
        continue;
      }
      if (seenMessageIds.has(message.message_id)) {
        continue;
      }
      seenMessageIds.add(message.message_id);
      out.push(authoritativeByMessageId.get(message.message_id)!);
    }

    return out.sort((left, right) => left.event_position - right.event_position);
  }

  function createOptimisticMessage(clientMessageId: string, text: string): 消息事件 {
    const state = 读取状态();
    return {
      type: "message_created",
      room_id: state.roomId,
      message_id: `local-${clientMessageId}`,
      client_message_id: clientMessageId,
      sender_session_id: state.sessionId,
      sender_display_alias: state.displayAlias,
      text,
      body: text,
      attachments: [],
      event_position: state.latestEventPosition + 1,
    };
  }

  function applyAuthoritativeEvents(events: 消息事件[], latestEventPosition: number): void {
    const merged = reconcileMessages([...读取状态().messages, ...events]);
    const shouldFollowLatest = 读取状态().viewportMode === "贴底跟随";
    deps.roomKernel.send({
      type: "AUTHORITATIVE_EVENTS_ARRIVED",
      latestEventPosition,
    });
    更新状态({
      ...deps.roomShellPatch(),
      messages: merged,
      pending: false,
    });
    if (shouldFollowLatest) {
      void deps.跟随最新消息追加后刷新视口();
    }
  }

  async function handleConnectError(error: unknown): Promise<void> {
    if (!isInvalidSessionError(error)) {
      return;
    }
    await deps.上报Transport异常({
      kind: "invalid_session",
    });
  }

  async function handleControlResult(control: 控制面结果): Promise<void> {
    if (control.kind === "subscribed" && typeof control.latest_event_position === "number") {
      deps.roomKernel.send({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: control.latest_event_position,
      });
      更新状态(deps.roomShellPatch());
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

    if (!读取状态().roomId) {
      更新状态({ pending: false });
      return;
    }

    if (control.code === "invalid_session") {
      await deps.上报Transport异常({
        kind: "invalid_session",
        roomId: 读取状态().roomId,
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
      if (读取状态().roomId) {
        subscribeRoom(读取状态().latestEventPosition);
      }
    });
    socket.on("connect_error", (error: unknown) => {
      void handleConnectError(error);
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

  function disconnect(): void {
    realtimeSocket?.disconnect();
    realtimeSocket = null;
  }

  function subscribeRoom(from: number): void {
    if (!读取状态().roomId || !realtimeSocket) {
      return;
    }
    deps.roomKernel.send({ type: "SUBSCRIPTION_STARTED" });
    realtimeSocket.emit("subscribe_room_stream", {
      room_id: 读取状态().roomId,
      from,
    });
  }

  async function sendMessage(): Promise<void> {
    const state = 读取状态();
    if (!state.roomId || !realtimeSocket) {
      return;
    }
    const text = state.messageInput.trim();
    const attachmentIds = 提取可发送图片附件标识(state.composerImageDrafts);
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
    const nextMessages =
      attachmentIds.length === 0
        ? reconcileMessages([...state.messages, createOptimisticMessage(clientMessageId, text)])
        : state.messages;
    更新状态({
      messages: nextMessages,
      messageInput: "",
      composerImageDrafts: [],
      pending: true,
    });
    realtimeSocket.emit("create_message", {
      room_id: state.roomId,
      client_message_id: clientMessageId,
      text,
      attachment_ids: attachmentIds,
    });
  }

  return {
    ensureRealtimeSocket,
    disconnect,
    subscribeRoom,
    sendMessage,
    reconcileMessages,
  };
}
