import type { 平台离线任务 } from "../../平台/index.js";

const 默认后台补发同步标识 = "koko-queue-main";

export type 待补发创建消息载荷 = {
  roomId: string;
  clientMessageId: string;
  text: string;
  attachmentIds: string[];
};

export interface 登记待补发创建消息依赖 {
  读取当前时间(): number;
  登记待补发任务?: ((task: 平台离线任务) => Promise<boolean>) | undefined;
  请求后台补发同步?: ((tag: string) => Promise<boolean>) | undefined;
  清空发送草稿(): void;
  后台补发同步标识?: string;
}

export interface 重放待补发创建消息依赖 {
  当前可即时发送(): boolean;
  读取当前房间Id(): string | null | undefined;
  发送创建消息(payload: {
    room_id: string;
    client_message_id: string;
    text: string;
    attachment_ids: string[];
  }): void;
}

function 解析待补发创建消息载荷(payload: unknown): 待补发创建消息载荷 | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as {
    roomId?: unknown;
    clientMessageId?: unknown;
    text?: unknown;
    attachmentIds?: unknown;
  };
  const roomId = typeof candidate.roomId === "string" ? candidate.roomId : "";
  const clientMessageId =
    typeof candidate.clientMessageId === "string" ? candidate.clientMessageId : "";
  if (!roomId || !clientMessageId) {
    return null;
  }
  return {
    roomId,
    clientMessageId,
    text: typeof candidate.text === "string" ? candidate.text : "",
    attachmentIds: Array.isArray(candidate.attachmentIds)
      ? candidate.attachmentIds.map((attachmentId) => String(attachmentId))
      : [],
  };
}

/**
 * 离线补发只登记“未来还要重放的 command”，
 * 不在这里生成第二套消息业务语义，也不提前宣称发送成功。
 */
export async function 登记待补发创建消息(
  payload: 待补发创建消息载荷,
  deps: 登记待补发创建消息依赖
): Promise<boolean> {
  const 当前时间 = deps.读取当前时间();
  const 入队成功 =
    (await deps.登记待补发任务?.({
      id: `offline-${payload.clientMessageId}`,
      kind: "create_message",
      payload,
      createdAt: 当前时间,
      retryAt: 当前时间,
      dedupeKey: payload.clientMessageId,
    })) ?? false;
  if (!入队成功) {
    return false;
  }
  deps.清空发送草稿();
  await deps.请求后台补发同步?.(deps.后台补发同步标识 ?? 默认后台补发同步标识);
  return true;
}

/**
 * 待补发重放只负责把离线 command 重新投回当前 realtime 主通道。
 * 只要当前房间不是权威目标房间，就继续等待，不在这里跨房间乱投。
 */
export async function 重放待补发创建消息(
  task: 平台离线任务,
  deps: 重放待补发创建消息依赖
): Promise<"done" | "retry"> {
  if (task.kind !== "create_message") {
    return "done";
  }
  if (!deps.当前可即时发送()) {
    return "retry";
  }
  const payload = 解析待补发创建消息载荷(task.payload);
  if (!payload) {
    return "done";
  }
  if (deps.读取当前房间Id() !== payload.roomId) {
    return "retry";
  }
  deps.发送创建消息({
    room_id: payload.roomId,
    client_message_id: payload.clientMessageId,
    text: payload.text,
    attachment_ids: payload.attachmentIds,
  });
  return "done";
}
