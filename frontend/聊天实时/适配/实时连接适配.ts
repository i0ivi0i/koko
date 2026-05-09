import { io, type Socket } from "socket.io-client";

export interface 实时连接运行时策略 {
  intent: "resume" | "suspend";
  reconnection: boolean;
  reason: "active" | "background" | "page_hidden";
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
    // 这里只显式启用当前主链可安全承受的 Socket.IO 选项。
    // `retries / ackTimeout` 仍不能开，因为服务端还没有成功 ack 协议；
    // 可靠性继续由 snapshot + 增量补洞主链保证，而不是让客户端私自重放命令。
    const socket = io(this.baseUrl, {
      transports: ["websocket"],
      reconnection: this.当前运行时策略.reconnection,
      autoConnect: this.当前运行时策略.intent !== "suspend",
      auth: { session_id: sessionId, pow_token: powToken },
    });
    this.活跃Socket表.set(socket, { 由运行时挂起: false });
    return socket;
  }

  接收运行时策略(policy: 实时连接运行时策略): void {
    this.当前运行时策略 = { ...policy };
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

  释放Socket(socket: Socket): void {
    this.活跃Socket表.delete(socket);
    socket.disconnect();
  }
}
