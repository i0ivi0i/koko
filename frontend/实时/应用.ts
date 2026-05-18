import type { Socket } from "socket.io-client";
import type { 附件状态变更事件, 消息事件, 房间事件 } from "../聊天共享/契约.js";
import type { 房间内核事件 } from "../房间/运行时.js";
import type { 房间时间线事件 } from "../时间线/运行时.js";
import type { 实时会话事件 } from "./会话运行时.js";
import { 创建乐观房间消息 } from "../时间线/领域.js";
import { 提取可发送媒体附件标识, 提取可发送媒体附件元数据 } from "../媒体/媒体草稿.js";
import {
  处理实时控制面结果,
  处理连接错误,
  type 实时控制面结果,
} from "../聊天实时/壳层/实时控制面协作.js";
import {
  登记待补发创建消息,
  重放待补发创建消息,
} from "../聊天实时/壳层/待补发消息协作.js";
import type { 聊天实时连接端口 } from "../聊天共享/适配/聊天实时连接端口.js";
import type { 聊天状态 } from "../应用根/聊天状态.js";
import type { Transport异常 } from "../恢复/壳层/房间恢复编排.js";
import type { 平台离线任务 } from "../平台/index.js";

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
  | "mediaSelectionPendingCount"
  | "pending"
>;

export interface 实时应用依赖 {
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
  接收附件升级后副作用?(event: 附件状态变更事件): void;
  登记待补发任务?(task: 平台离线任务): Promise<boolean>;
  请求后台补发同步?(tag: string): Promise<boolean>;
  读取当前时间?(): number;
}

export interface 实时应用端口 {
  ensureRealtimeSocket(sessionId: string): void | Promise<void>;
  disconnect(): void;
  subscribeRoom(from: number): void;
  sendMessage(): Promise<void>;
  重放待补发任务?(task: 平台离线任务): Promise<"done" | "retry">;
}

export type 房间实时编排依赖 = 实时应用依赖;
export type 房间实时编排端口 = 实时应用端口;

/**
 * 实时应用拥有“socket 事件如何变成房间时间线/会话事实”这条前端应用真相：
 * 1. 连接、订阅、控制面结果和权威消息的接入顺序；
 * 2. 实时可用性与离线补发队列之间的衔接；
 * 3. 只把 transport 异常上报给恢复 owner，不自己刷新会话或判房间资格。
 */
export function 创建实时应用(deps: 实时应用依赖): 实时应用端口 {
  let realtimeSocket: Socket | null = null;
  // P0 修复：追踪上次订阅的房间 ID，切换房间时先通知服务端 leave 旧房间。
  let 上次订阅房间Id: string | null = null;
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

  async function ensureRealtimeSocket(sessionId: string): Promise<void> {
    if (realtimeSocket) {
      return;
    }
    // PoW 门禁：防御启用时先获取 token，再建连。
    // 正常用户首次 ~20-100ms（Worker 解题），后续复用缓存 token 零开销。
    let powToken: string | undefined;
    const powRequired = deps.transport.读取运行时策略?.().powRequired === true;
    if (powRequired && deps.transport.获取PowToken) {
      try {
        powToken = await deps.transport.获取PowToken();
      } catch (err) {
        deps.接收实时会话事实({
          type: "SOCKET_DISCONNECTED",
          code: "pow_failed",
        });
        return;
      }
    }
    const socket = deps.transport.createSocket(sessionId, powToken);
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
    socket.on("room_event", (event: 房间事件) => {
      if (event.type === "attachment_status_changed") {
        deps.接收时间线事实({
          type: "ATTACHMENT_STATUS_UPGRADED",
          messageId: event.message_id,
          attachmentId: event.attachment_id,
          patch: {
            status: event.status,
            ...(event.attachment?.distribution_hint
              ? { distribution_hint: event.attachment.distribution_hint }
              : {}),
            ...(event.attachment?.has_preview_asset !== undefined
              ? { has_preview_asset: event.attachment.has_preview_asset }
              : {}),
            ...(event.attachment?.preview_asset !== undefined
              ? { preview_asset: event.attachment.preview_asset }
              : {}),
          },
        });
        deps.接收附件升级后副作用?.(event);
        return;
      }
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
    上次订阅房间Id = null;
    if (realtimeSocket) {
      deps.transport.释放Socket?.(realtimeSocket);
      realtimeSocket = null;
    }
  }

  function subscribeRoom(from: number): void {
    const roomId = deps.读取实时状态().roomId;
    if (!roomId || !realtimeSocket) {
      return;
    }
    // P0 修复：切换房间前先通知服务端离开旧房间，防止订阅泄漏。
    // 同房间重复订阅（断线重连）不发 unsubscribe。
    if (上次订阅房间Id && 上次订阅房间Id !== roomId) {
      realtimeSocket.emit("unsubscribe_room_stream", {
        room_id: 上次订阅房间Id,
      });
    }
    上次订阅房间Id = roomId;
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
    // 这里和输入框门禁保持同一份过渡态真相，避免其他发送入口绕过 picker -> 草稿注册窗口。
    if (state.mediaSelectionPendingCount > 0) {
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

    // 所有消息都创建乐观占位，包括带附件的消息。
    // 附件元数据从 ready 草稿提取，让发送者立即看到消息 + 媒体卡片。
    deps.接收时间线事实({
      type: "OPTIMISTIC_MESSAGE_ADDED",
      message: 创建乐观房间消息({
        roomId: state.roomId,
        sessionId: state.sessionId,
        displayAlias: state.displayAlias,
        clientMessageId,
        text,
        latestEventPosition: state.latestEventPosition,
        attachments: 提取可发送媒体附件元数据(state.composerMediaDrafts) ?? [],
      }),
    });
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

// 旧“房间实时编排”命名只在真实 realtime owner 内收口，避免根目录重建同一能力。
export const 创建房间实时编排 = 创建实时应用;
