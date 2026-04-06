import { io, type Socket } from "socket.io-client";
import type {
  匿名身份引导结果,
  增量事件快照,
  阅读推进请求,
  房间历史页,
  房间快照,
  后台概览,
  后台房间列表,
  后台房间详情,
  后台登录结果,
} from "./契约.js";

type 接口错误响应 = {
  code?: string;
  message?: string;
};

/**
 * HTTP 失败要把状态码和稳定错误码一起带回壳层。
 * 这样恢复分类器才能区分“硬失效”与“临时失败”，而不是只看到一串模糊字符串。
 */
export class Http接口错误 extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "Http接口错误";
  }
}

export interface 前端传输端口 {
  bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果>;
  joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照>;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void>;
  loadRoomEvents(roomId: string, sessionId: string, from: number): Promise<增量事件快照>;
  loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页>;
  loadAdminOverview(token: string): Promise<后台概览>;
  adminLogin(username: string, password: string): Promise<后台登录结果>;
  adminRooms(token: string): Promise<后台房间列表>;
  adminRoomDetail(token: string, roomId: string): Promise<后台房间详情>;
  createSocket(sessionId: string): Socket;
}

export class HttpRealtime传输 implements 前端传输端口 {
  constructor(private readonly baseUrl: string) {}

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    return this.post("/api/session/bootstrap", {
      device_anonymous_token: deviceToken,
    });
  }

  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    return this.post("/api/rooms/join-or-create", {
      session_id: sessionId,
      room_code: roomCode,
    });
  }

  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    return this.get(`/api/rooms/${roomId}/snapshot?session_id=${sessionId}`);
  }

  async updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void> {
    const payload: 阅读推进请求 = {
      session_id: sessionId,
      last_read_event_position: lastReadEventPosition,
    };
    // 阅读推进属于冷路径写接口：
    // 它只上报“这个身份已确认读到哪里”，不借道 realtime，也不和进房快照混用。
    await this.post(`/api/rooms/${roomId}/read-anchor`, payload);
  }

  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    return this.get(`/api/rooms/${roomId}/events?session_id=${sessionId}&from=${from}`);
  }

  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    return this.get(
      `/api/rooms/${roomId}/history?session_id=${sessionId}&before_event_position=${beforeEventPosition}&limit=${limit}`
    );
  }

  async loadAdminOverview(token: string): Promise<后台概览> {
    return this.get("/api/admin/overview", { "x-admin-token": token });
  }

  async adminLogin(username: string, password: string): Promise<后台登录结果> {
    return this.post("/api/admin/login", { username, password });
  }

  async adminRooms(token: string): Promise<后台房间列表> {
    return this.get("/api/admin/rooms", { "x-admin-token": token });
  }

  async adminRoomDetail(token: string, roomId: string): Promise<后台房间详情> {
    return this.get(`/api/admin/rooms/${roomId}`, { "x-admin-token": token });
  }

  createSocket(sessionId: string): Socket {
    return io(this.baseUrl, {
      transports: ["websocket"],
      auth: { session_id: sessionId },
    });
  }

  private async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw await this.buildHttpError("GET", path, response);
    }
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await this.buildHttpError("POST", path, response);
    }
    return (await response.json()) as T;
  }

  private async buildHttpError(
    method: "GET" | "POST",
    path: string,
    response: Response
  ): Promise<Http接口错误> {
    let code = `http_${response.status}`;
    let message = `${method} ${path} failed: ${response.status}`;
    try {
      const payload = (await response.json()) as 接口错误响应;
      if (typeof payload.code === "string" && payload.code.trim()) {
        code = payload.code;
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // 某些 5xx 可能没有 JSON；此时退回通用 HTTP 错误即可。
    }
    return new Http接口错误(response.status, code, message);
  }
}
