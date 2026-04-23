import type { Socket } from "socket.io-client";
import type { 消息事件 } from "./契约.js";
import type { 房间内核事件 } from "./房间内核.js";
import type { 房间时间线事件 } from "./房间时间线运行时.js";
import type { 实时会话事件 } from "./实时会话运行时.js";
import {
  创建乐观房间消息,
} from "./房间时间线.js";
import { 提取可发送媒体附件标识 } from "./媒体/媒体草稿.js";
import {
  处理实时控制面结果,
  处理连接错误,
  type 实时控制面结果,
} from "./聊天实时/壳层/实时控制面协作.js";
import {
  登记待补发创建消息,
  重放待补发创建消息,
} from "./聊天实时/壳层/待补发消息协作.js";
import type { 聊天实时连接端口 } from "./聊天共享/适配/聊天实时连接端口.js";
import type { 聊天状态 } from "./状态.js";
import type { Transport异常 } from "./房间恢复编排.js";
import type { 平台离线任务 } from "./平台/index.js";

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
  | "pending"
>;

export interface 房间实时编排依赖 {
  读取实时状态(): 实时编排状态;
  写入实时状态(patch: Partial<实时编排状态>): void;
  接收时间线事实(event: 房间时间线事件): void;
  接收实时会话事实(event: 实时会话事件): void;
  transport: 聊天实时连接端口;
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
      void 处理连接错误(error, {
        接收实时会话事实: deps.接收实时会话事实,
        上报Transport异常: deps.上报Transport异常,
      });
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
    socket.on("control_result", (control: 实时控制面结果) => {
      void 处理实时控制面结果(control, {
        读取当前房间Id: () => deps.读取实时状态().roomId,
        清除发送中: () => deps.写入实时状态({ pending: false }),
        接收实时会话事实: deps.接收实时会话事实,
        推进订阅已建立: (latestEventPosition) => {
          deps.接收实时会话事实({
            type: "SUBSCRIPTION_ESTABLISHED",
            latestEventPosition,
          });
          deps.roomKernel.send({
            type: "SUBSCRIPTION_ESTABLISHED",
            latestEventPosition,
          });
        },
        上报Transport异常: deps.上报Transport异常,
        处理恢复失败: deps.处理恢复失败,
      });
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
     * - 不可即时发送时只委托待补发协作登记 command，不在这里发明第二套业务协议。
     */
    if (!当前可即时发送()) {
      const 入队成功 = await 登记待补发创建消息(
        {
          roomId: state.roomId,
          clientMessageId,
          text,
          attachmentIds,
        },
        {
          读取当前时间,
          登记待补发任务: deps.登记待补发任务,
          请求后台补发同步: deps.请求后台补发同步,
          清空发送草稿: () => {
            deps.写入实时状态({
              messageInput: "",
              composerMediaDrafts: [],
              pending: false,
            });
          },
        }
      );
      if (!入队成功) {
        return;
      }
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
    return 重放待补发创建消息(task, {
      当前可即时发送,
      读取当前房间Id: () => deps.读取实时状态().roomId,
      发送创建消息: (payload) => {
        realtimeSocket?.emit("create_message", payload);
      },
    });
  }

  return {
    ensureRealtimeSocket,
    disconnect,
    subscribeRoom,
    sendMessage,
    重放待补发任务,
  };
}
