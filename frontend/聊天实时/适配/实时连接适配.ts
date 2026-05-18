import { io, type Socket } from "socket.io-client";

export interface 实时连接运行时策略 {
  intent: "resume" | "suspend";
  reconnection: boolean;
  reason: "active" | "background" | "page_hidden";
  powRequired?: boolean;
}

export const 默认实时连接运行时策略: 实时连接运行时策略 = {
  intent: "resume",
  reconnection: true,
  reason: "active",
};

/**
 * 这个适配器只拥有 socket 生命周期和浏览器运行时策略。
 * 它不解释房间恢复、不碰 HTTP，也不承载消息成立语义。
 */
export class 实时连接适配 {
  private 当前运行时策略: 实时连接运行时策略 = 默认实时连接运行时策略;
  private readonly 活跃Socket表 = new Map<Socket, { 由运行时挂起: boolean }>();

  constructor(private readonly baseUrl: string) {}

  createSocket(sessionId: string, powToken?: string): Socket {
    // reconnection 强制 true：Socket.IO 的自动重连是传输层健壮性基石，
    // 运行时策略只能通过 suspend/resume 控制连接行为，不能关闭自动重连能力。
    const socket = io(this.baseUrl, {
      transports: ["websocket"],
      reconnection: true,
      autoConnect: this.当前运行时策略.intent !== "suspend",
      auth: { session_id: sessionId, pow_token: powToken },
    });
    this.活跃Socket表.set(socket, { 由运行时挂起: false });
    return socket;
  }

  接收运行时策略(policy: 实时连接运行时策略): void {
    this.当前运行时策略 = { ...this.当前运行时策略, ...policy };
    for (const [socket, state] of this.活跃Socket表.entries()) {
      if (policy.intent === "suspend") {
        if (!state.由运行时挂起) {
          state.由运行时挂起 = true;
          socket.disconnect();
        }
        continue;
      }
      if (state.由运行时挂起 && typeof socket.connect === "function") {
        state.由运行时挂起 = false;
        socket.connect();
      }
    }
  }

  读取运行时策略(): 实时连接运行时策略 {
    return { ...this.当前运行时策略 };
  }

  读取Socket运行时挂起状态(socket: Socket): boolean {
    return this.活跃Socket表.get(socket)?.由运行时挂起 === true;
  }

  释放Socket(socket: Socket): void {
    this.活跃Socket表.delete(socket);
    socket.disconnect();
  }
}
